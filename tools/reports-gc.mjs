#!/usr/bin/env node
/**
 * tools/reports-gc.mjs
 *
 * UQ-DEEP-A 2026-06-23 — Reports directory garbage collector.
 *
 * Purpose
 * -------
 * The orchestrators (V8 assembly, V9 visual QA, stress-test, agent
 * calibration) emit timestamped report files into `reports/`. With no
 * retention policy, the directory has ballooned to **3.3 GB / 17k+ files**.
 * That hits dashboard load time (findLatestInDir scans the whole dir),
 * git status responsiveness, and developer terminal grep speed.
 *
 * This tool prunes older reports per-prefix, keeping the N newest of
 * each family. Telemetry-rolling files (`*-history.json`, `*-series.json`)
 * are NEVER touched — they have internal rolling windows already.
 *
 * Usage
 * -----
 *   node tools/reports-gc.mjs            # dry-run, show what would delete
 *   node tools/reports-gc.mjs --apply    # actually delete
 *   node tools/reports-gc.mjs --keep 50  # override per-family retention
 *
 * Exit
 * ----
 *   0  — dry-run complete or apply succeeded with no errors
 *   1  — any rm failed (partial cleanup)
 *
 * Senior-grade discipline
 * -----------------------
 *   - NEVER deletes outside `reports/` (resolved + boundary checked).
 *   - NEVER deletes telemetry rolling files (deny-list).
 *   - Dry-run is the DEFAULT — operator must explicit `--apply`.
 *   - Per-prefix grouping: a new orchestrator family (future) inherits
 *     the same N-newest policy without code change (auto-detection).
 *   - Sorted by mtime DESC, not by name — handles future ts format
 *     changes gracefully.
 */

import { readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REPORTS    = join(REPO, 'reports');

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag);
  return idx === -1 ? null : args[idx + 1];
};

const APPLY = args.includes('--apply');
const KEEP_DEFAULT = parseInt(argVal('--keep') || '20', 10);
const QUIET = args.includes('--quiet');

/* Files NEVER pruned (telemetry + curated outputs). */
const DENY_LIST = new Set([
  'audit-summary.json',
  'portfolio-report.json',
  'declared-vs-measured-audit.json',
  'declared-vs-measured-audit.md',
  'calibration-history.json',
  'orchestrator-e2e-series.json',
  'uq-cover-series.json',
  'UCBA-multi-role-qa.md',
]);

/* Suffix patterns to skip — keep ALL telemetry/history/series files. */
const DENY_SUFFIXES = ['-history.json', '-series.json', '-rolling.json'];

/* Prefix → keep count override (some families need shallower / deeper
 * retention than the global default). */
const PER_PREFIX_KEEP = {
  'v8-assembly-':       KEEP_DEFAULT,
  'v9-visual-qa-':      KEEP_DEFAULT,
  'agent-calibration-': KEEP_DEFAULT,
  'stress-test-ingest-': KEEP_DEFAULT * 2,  /* keep more because each run is rare */
  'cross-game-':        KEEP_DEFAULT,
};

/* Group files in REPORTS root by leading prefix-up-to-timestamp. */
function groupByPrefix() {
  if (!REPORTS.startsWith(REPO + '/')) {
    throw new Error('REPORTS not inside REPO — refusing to proceed (safety check)');
  }
  const entries = readdirSync(REPORTS, { withFileTypes: true })
    .filter(e => e.isFile() || (e.isDirectory() === false))
    .map(e => e.name);

  /* Prefix extraction: anything before a date-shaped sequence */
  const groups = new Map();
  for (const name of entries) {
    if (DENY_LIST.has(name)) continue;
    if (DENY_SUFFIXES.some(s => name.endsWith(s))) continue;
    const m = name.match(/^(.+?)\d{4}-\d{2}-\d{2}/);
    const prefix = m ? m[1] : name.replace(/\.(json|md|html|txt)$/, '');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(name);
  }
  return groups;
}

/* For each family, sort by mtime DESC, drop the newest N, return the
 * rest as the deletion candidates. */
function planDeletions(groups) {
  const toDelete = [];
  for (const [prefix, names] of groups) {
    if (names.length <= 1) continue;
    const keep = PER_PREFIX_KEEP[prefix] || KEEP_DEFAULT;
    if (names.length <= keep) continue;
    const stamped = names.map(n => {
      const p = join(REPORTS, n);
      return { name: n, path: p, mt: statSync(p).mtimeMs, size: statSync(p).size };
    }).sort((a, b) => b.mt - a.mt);
    const victims = stamped.slice(keep);
    for (const v of victims) toDelete.push({ ...v, prefix });
  }
  return toDelete;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const groups = groupByPrefix();
const toDelete = planDeletions(groups);
const totalBytes = toDelete.reduce((s, v) => s + v.size, 0);

if (!QUIET) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`reports-gc · ${groups.size} family/-ies · ${toDelete.length} files to prune · ${fmtBytes(totalBytes)} freed`);
  console.log(`mode: ${APPLY ? 'APPLY (rm enabled)' : 'DRY-RUN (no rm)'} · keep ≥ ${KEEP_DEFAULT} newest per family`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  /* Per-family summary table. */
  const familyTotals = {};
  for (const v of toDelete) {
    familyTotals[v.prefix] = familyTotals[v.prefix] || { count: 0, bytes: 0 };
    familyTotals[v.prefix].count += 1;
    familyTotals[v.prefix].bytes += v.size;
  }
  if (Object.keys(familyTotals).length > 0) {
    for (const [pfx, t] of Object.entries(familyTotals).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${pfx.padEnd(28)} ${String(t.count).padStart(6)} files · ${fmtBytes(t.bytes).padStart(8)}`);
    }
  }
}

if (toDelete.length === 0) {
  if (!QUIET) console.log('✓ nothing to prune (retention satisfied)');
  process.exit(0);
}

if (!APPLY) {
  if (!QUIET) console.log('\n(dry-run · pass --apply to actually delete)');
  process.exit(0);
}

let removed = 0, failed = 0;
for (const v of toDelete) {
  /* Boundary check — path MUST be inside REPORTS dir. */
  if (!v.path.startsWith(REPORTS + '/')) {
    if (!QUIET) console.error(`  ✗ refused (outside reports/): ${v.path}`);
    failed++;
    continue;
  }
  try { rmSync(v.path, { force: true }); removed++; }
  catch (e) {
    if (!QUIET) console.error(`  ✗ rm failed: ${basename(v.path)} (${e.message})`);
    failed++;
  }
}

if (!QUIET) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✓ removed ${removed} files · ${fmtBytes(totalBytes)} freed${failed > 0 ? ` · ${failed} failed` : ''}`);
}

process.exit(failed > 0 ? 1 : 0);
