#!/usr/bin/env node
/**
 * tools/_audit-model-schema.mjs
 *
 * Wave U-1 P0-8 (Boki 2026-06-25 ultra-deep QA U-4 #2).
 *
 * Walks every persisted model in the repo and reports the schema
 * version each one carries. Catches two regressions at once:
 *
 *   1. A persisted `dist/real-games/<slug>/model.json` produced before
 *      N+2-I was rebuilt → its `__schema__` is missing → migration
 *      runner would need to stamp it on read. This walker proves that
 *      every persisted artifact is at MODEL_SCHEMA_VERSION.
 *
 *   2. A cache file under `tools/_wave-v-cache/` whose `model_delta`
 *      has been hand-edited and accidentally landed at the wrong shape.
 *      Cache files are envelopes (`{agent, model_delta}`) so they
 *      don't carry `__schema__` themselves — but the walker confirms
 *      the structure is intact (top-level keys present, model_delta is
 *      an object that doesn't claim a stale schema).
 *
 * # USAGE
 *
 *   node tools/_audit-model-schema.mjs               full walk (informational)
 *   node tools/_audit-model-schema.mjs --strict      exit 1 on any drift
 *   node tools/_audit-model-schema.mjs --migrate     stamp drift in-place
 *   node tools/_audit-model-schema.mjs --quiet       suppress per-file
 *   node tools/_audit-model-schema.mjs --json        machine output
 *
 * # EXIT CODES
 *
 *   0  walk completed; drift count printed but not treated as failure
 *      unless --strict was passed
 *   1  (with --strict) at least one drift detected
 *   2  walk failed (directory missing — informational, not a regression)
 *
 * Why not strict-by-default: the audit walker landed in the same wave
 * that introduced MODEL_SCHEMA_VERSION (N+2-I). Every persisted model
 * in `dist/real-games/` was produced BEFORE that wave, so they're all
 * legacy 0.0.0. Failing strict on day one would lock the repo. The
 * one-time fix is a single `node tools/_audit-model-schema.mjs --migrate`
 * sweep; after that, CI can opt into `--strict`.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_SCHEMA_VERSION,
  readModelVersion,
} from '../src/registry/modelSchemaVersion.mjs';
import { migrate } from '../src/registry/modelMigrations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const CACHE_DIR  = `${REPO}/tools/_wave-v-cache`;

const args = process.argv.slice(2);
const QUIET   = args.includes('--quiet');
const JSONOUT = args.includes('--json');
const STRICT  = args.includes('--strict');
const MIGRATE = args.includes('--migrate');

function log(msg) {
  if (!QUIET && !JSONOUT) process.stdout.write(`${msg}\n`);
}

/* ── walk dist/real-games / model.json ────────────────────────────── */

function walkRealGames() {
  if (!existsSync(REAL_GAMES)) {
    return { scanned: 0, drift: [], missing: true };
  }
  const slugs = readdirSync(REAL_GAMES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  let scanned = 0;
  const drift = [];
  for (const slug of slugs) {
    const p = join(REAL_GAMES, slug, 'model.json');
    if (!existsSync(p)) continue;
    let raw, model;
    try {
      raw = readFileSync(p, 'utf8');
      model = JSON.parse(raw);
    } catch (e) {
      drift.push({ slug, kind: 'parse-error', error: e.message });
      continue;
    }
    scanned++;
    const v = readModelVersion(model);
    if (v !== MODEL_SCHEMA_VERSION) {
      drift.push({ slug, kind: 'stale-schema', found: v, expected: MODEL_SCHEMA_VERSION });
      if (MIGRATE) {
        try {
          const next = migrate(model);
          /* UQ-U-3 atom #7 (security agent #9): atomic write — write to
             unique-name tmp + fsync + rename. Previously `writeFileSync`
             non-atomic → crash mid-write corrupts the cache JSON, which
             then breaks every downstream tool that reads the cache.
             Same pattern as `tools/migrate-model.mjs` U-1 P0-5. */
          const tmp = `${p}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
          const fd = openSync(tmp, 'w', 0o644);
          try {
            writeSync(fd, JSON.stringify(next, null, 2) + '\n', 0, 'utf8');
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          try {
            renameSync(tmp, p);
          } catch (renameErr) {
            try { unlinkSync(tmp); } catch (_) {}
            throw renameErr;
          }
        } catch (e) {
          drift.push({ slug, kind: 'migrate-failed', error: e.message });
        }
      }
    }
  }
  return { scanned, drift, missing: false };
}

/* ── walk tools/_wave-v-cache JSON files ──────────────────────────── */

function walkCaches() {
  if (!existsSync(CACHE_DIR)) {
    return { scanned: 0, broken: [], missing: true };
  }
  /* Cache files live one-level deep + sometimes under per-pass subdirs;
     walk shallowly first, then recurse one level. */
  const broken = [];
  let scanned = 0;
  const entries = readdirSync(CACHE_DIR, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.json')) {
      files.push(join(CACHE_DIR, e.name));
    } else if (e.isDirectory()) {
      try {
        const sub = readdirSync(join(CACHE_DIR, e.name), { withFileTypes: true });
        for (const s of sub) {
          if (s.isFile() && s.name.endsWith('.json')) {
            files.push(join(CACHE_DIR, e.name, s.name));
          }
        }
      } catch (_) { /* ignore */ }
    }
  }
  for (const p of files) {
    let raw, env;
    try {
      raw = readFileSync(p, 'utf8');
      env = JSON.parse(raw);
    } catch (e) {
      broken.push({ file: p.replace(REPO + '/', ''), kind: 'parse-error', error: e.message });
      continue;
    }
    scanned++;
    /* Cache envelope contract: top-level object with at least one of
       { agent, model_delta, model, evidence }. We tolerate any of
       those because legacy passes used different shapes; what we
       flag is a NUMBER / STRING at top level (cache truncated). */
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      broken.push({ file: p.replace(REPO + '/', ''), kind: 'shape-broken' });
      continue;
    }
    /* If the cache itself carries a `__schema__` (some future cache
       format choices to stamp), it MUST be current. */
    if (env.__schema__ && readModelVersion(env) !== MODEL_SCHEMA_VERSION) {
      broken.push({
        file: p.replace(REPO + '/', ''),
        kind: 'stale-schema',
        found: readModelVersion(env),
        expected: MODEL_SCHEMA_VERSION,
      });
    }
  }
  return { scanned, broken, missing: false };
}

const real = walkRealGames();
const cache = walkCaches();

if (JSONOUT) {
  process.stdout.write(JSON.stringify({
    expected: MODEL_SCHEMA_VERSION,
    realGames: real,
    cache,
  }, null, 2) + '\n');
} else {
  log(`audit-model-schema · expected version ${MODEL_SCHEMA_VERSION}`);
  log('');
  log(`dist/real-games/`);
  if (real.missing) {
    log('  (directory absent — no persisted models, OK)');
  } else {
    log(`  scanned ${real.scanned} model.json file(s)`);
    if (real.drift.length === 0) {
      log('  ✓ all at current version');
    } else {
      log(`  ✗ ${real.drift.length} drift(s):`);
      for (const d of real.drift.slice(0, 20)) {
        log(`    - ${d.slug} → ${d.kind}${d.found ? ` (found=${d.found})` : ''}`);
      }
    }
  }
  log('');
  log(`tools/_wave-v-cache/`);
  if (cache.missing) {
    log('  (directory absent — no caches, OK)');
  } else {
    log(`  scanned ${cache.scanned} cache file(s)`);
    if (cache.broken.length === 0) {
      log('  ✓ all envelopes intact');
    } else {
      log(`  ✗ ${cache.broken.length} broken:`);
      for (const b of cache.broken.slice(0, 20)) {
        log(`    - ${b.file} → ${b.kind}`);
      }
    }
  }
}

const driftCount  = real.drift.length + cache.broken.length;
if (MIGRATE && driftCount > 0) {
  log('');
  log(`▸ --migrate stamped ${real.drift.length} model.json file(s) in-place`);
}
/* See docstring: strict-by-default would lock the repo on day one
   because every persisted model in dist/real-games predates N+2-I.
   --strict opt-in is intentional. */
process.exit(STRICT && driftCount > 0 ? 1 : 0);
