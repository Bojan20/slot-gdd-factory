#!/usr/bin/env node
/**
 * CORTI 200.6-DEVOPS — IR schema migration tool.
 *
 * Detects each file's `schema_version` and applies registered migration
 * steps until it reaches the latest target version. Validates the
 * result, and rolls back on failure (the file on disk is replaced only
 * after the full migration + validation passes — original is kept in
 * a `.bak` sibling).
 *
 * Migration registry is sparse and forward-only:
 *   "0.9.x" → "1.0.0"   (insert `schema_version` field, normalize meta)
 *   "1.0.0" → "1.1.0"   (placeholder for future fields — currently a no-op
 *                        passthrough that bumps the version stamp)
 *
 * Usage:
 *   node scripts/migrate-ir.mjs --file path/to/game.ir.json
 *   node scripts/migrate-ir.mjs --batch web/studio/ir-library/
 *   node scripts/migrate-ir.mjs --batch web/studio/ir-library/ --dry-run
 *   node scripts/migrate-ir.mjs --batch web/studio/ir-library/ --target 1.1.0
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

export const LATEST_VERSION = '1.1.0';

/**
 * Migration registry. Each entry knows its source version and produces
 * the next version's shape. Add new entries here when the IR schema
 * evolves — never edit existing ones (round-trip determinism).
 */
export const MIGRATIONS = [
  {
    from: '0.9.x',
    to: '1.0.0',
    matches: (v) => !v || /^0\.9\.\d+$/.test(v),
    apply(ir) {
      const out = { ...ir, schema_version: '1.0.0' };
      if (!out.meta && ir.metadata) {
        out.meta = ir.metadata;
        delete out.metadata;
      }
      out.meta = out.meta ?? {};
      // Ensure topology object exists (some 0.9 files used `grid` directly).
      if (!out.topology && ir.grid) {
        out.topology = { kind: 'rectangular', ...ir.grid };
        delete out.grid;
      }
      return out;
    },
  },
  {
    from: '1.0.0',
    to: '1.1.0',
    matches: (v) => v === '1.0.0',
    apply(ir) {
      // 1.1 introduces optional `governance` block + bumps the stamp.
      return {
        ...ir,
        schema_version: '1.1.0',
        governance: ir.governance ?? { jurisdiction_tags: [], reviewer_ids: [] },
      };
    },
  },
];

/** Minimal IR validator — enough to catch corruption from a bad migration. */
export function validateIr(ir) {
  const errors = [];
  if (!ir || typeof ir !== 'object') return ['ir_not_object'];
  if (typeof ir.schema_version !== 'string') errors.push('missing_schema_version');
  if (!ir.meta || typeof ir.meta !== 'object') errors.push('missing_meta');
  else {
    if (typeof ir.meta.id !== 'string') errors.push('meta.id_missing');
    if (typeof ir.meta.name !== 'string') errors.push('meta.name_missing');
  }
  if (!ir.topology || typeof ir.topology !== 'object') errors.push('missing_topology');
  return errors;
}

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Apply every migration whose `from` version is <= ir.schema_version
 *  AND whose `to` is <= target. Stops when target reached. */
export function migrateIr(ir, target = LATEST_VERSION) {
  let current = { ...ir };
  let guard = 0;
  while (compareVersions(current.schema_version ?? '0.9.0', target) < 0) {
    const v = current.schema_version ?? '0.9.0';
    const step = MIGRATIONS.find((m) => m.matches(v) && compareVersions(m.to, target) <= 0);
    if (!step) break;
    current = step.apply(current);
    guard++;
    if (guard > MIGRATIONS.length + 1) {
      throw new Error('migration_loop_detected');
    }
  }
  return current;
}

function listIrFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const found = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const stat = statSync(dir);
    if (stat.isFile()) {
      if (dir.endsWith('.ir.json')) found.push(dir);
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue;
      if (entry === 'node_modules' || entry === 'dist') continue;
      stack.push(join(dir, entry));
    }
  }
  return found.sort();
}

/** Migrate a single file. Returns a report object. */
export function migrateFile(filePath, opts = {}) {
  const { dryRun = false, target = LATEST_VERSION } = opts;
  const raw = readFileSync(filePath, 'utf8');
  let ir;
  try {
    ir = JSON.parse(raw);
  } catch (err) {
    return { filePath, ok: false, reason: `invalid_json: ${err.message}` };
  }
  const fromVersion = ir.schema_version ?? '0.9.0';
  if (compareVersions(fromVersion, target) >= 0) {
    return { filePath, ok: true, skipped: true, fromVersion, toVersion: fromVersion };
  }
  let migrated;
  try {
    migrated = migrateIr(ir, target);
  } catch (err) {
    return { filePath, ok: false, reason: `migration_threw: ${err.message}` };
  }
  const errors = validateIr(migrated);
  if (errors.length > 0) {
    return { filePath, ok: false, reason: `validation_failed: ${errors.join(',')}` };
  }
  if (!dryRun) {
    const bak = filePath + '.bak';
    try {
      copyFileSync(filePath, bak);
      writeFileSync(filePath, JSON.stringify(migrated, null, 2) + '\n', 'utf8');
    } catch (err) {
      // Rollback: if .bak exists, restore.
      if (existsSync(bak)) copyFileSync(bak, filePath);
      return { filePath, ok: false, reason: `write_failed: ${err.message}` };
    }
  }
  return {
    filePath,
    ok: true,
    skipped: false,
    fromVersion,
    toVersion: migrated.schema_version,
    dryRun,
  };
}

export function parseArgs(argv) {
  const out = {
    file: null,
    batch: null,
    dryRun: false,
    target: LATEST_VERSION,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--file': out.file = next; i++; break;
      case '--batch': out.batch = next; i++; break;
      case '--dry-run': out.dryRun = true; break;
      case '--target': out.target = next; i++; break;
      case '--help':
      case '-h':
        console.log(`migrate-ir — bump IR schema_version.

  --file <path>     Migrate a single IR file.
  --batch <dir>     Recursively migrate every *.ir.json under <dir>.
  --target <ver>    Stop at this version (default ${LATEST_VERSION}).
  --dry-run         Print what would change without writing.`);
        process.exit(0);
    }
  }
  return out;
}

export function runMigrate(args) {
  const reports = [];
  if (args.file) {
    reports.push(migrateFile(resolve(args.file), { dryRun: args.dryRun, target: args.target }));
  } else if (args.batch) {
    const root = resolve(args.batch);
    const files = listIrFiles(root);
    for (const f of files) {
      reports.push(migrateFile(f, { dryRun: args.dryRun, target: args.target }));
    }
  } else {
    throw new Error('migrate-ir: provide --file or --batch');
  }
  return reports;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let reports;
  try {
    reports = runMigrate(args);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
  const failed = reports.filter((r) => !r.ok);
  const migrated = reports.filter((r) => r.ok && !r.skipped);
  const skipped = reports.filter((r) => r.ok && r.skipped);
  console.log(`migrate-ir: ${migrated.length} migrated, ${skipped.length} skipped, ${failed.length} failed`);
  for (const r of reports) {
    if (!r.ok) console.error(`  FAIL ${r.filePath}: ${r.reason}`);
    else if (!r.skipped) console.log(`  ok  ${r.filePath}: ${r.fromVersion} → ${r.toVersion}${r.dryRun ? ' (dry)' : ''}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(2);
  });
}
