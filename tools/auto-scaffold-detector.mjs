#!/usr/bin/env node
/**
 * tools/auto-scaffold-detector.mjs
 *
 * N+2 G (2026-06-23) — Auto-scaffold pipeline for unknown feature kinds.
 *
 * Purpose
 *   When ingest parses a GDD and the resulting model carries feature
 *   kinds that are NOT in the block catalog, this detector:
 *
 *     1. Identifies unknown kinds via findUnknownFeatures (registry)
 *     2. For each, runs suggestArchetype to find closest catalog match
 *     3. If confidence ≥ AUTO_SCAFFOLD_THRESHOLD (0.7), generates a
 *        STUB block + test fixture via reused emitBlockSource/emitTestSource
 *     4. Writes stub to src/blocks/_auto-scaffolded/<kind>.mjs with
 *        @status STUB header marker so reviewer can audit before promote
 *     5. Logs entry to reports/auto-scaffold-pending.json (rolling list)
 *
 * Caps + safety
 *   - max 5 scaffolds per single ingest (sigurnosni cap; ostalo log-uje
 *     ali ne kreira). Prevents explosion if GDD declares 50 unknown kinds.
 *   - Skips if stub already exists (idempotent).
 *   - NEVER blocks ingest — every error path is soft-fail.
 *   - dryRun mode returns plan WITHOUT writing files.
 *
 * Anti-vendor (HARD RULE #1)
 *   Generated stub source uses ONLY the kind ID + archetype id. No
 *   vendor product names ever surface in the output file. The detector
 *   also rejects unknown kinds that match the banned-name regex (defense
 *   in depth — the parser should not produce such kinds, but if it did,
 *   we don't auto-scaffold them).
 *
 * Public API
 *   - loadCatalogKinds() -> Set<string>
 *   - planScaffolds(model, opts) -> { plan, skipped, blocked }
 *   - runScaffolds(model, opts) -> Promise<Receipt>
 *
 * Receipt = {
 *   ok: boolean
 *   ranAt: ISO string
 *   plan: [{ kind, archetype, confidence, reason }]
 *   created: [{ kind, path, archetype }]
 *   skipped: [{ kind, reason }]
 *   capExceeded: number
 *   pending: PendingEntry[]      // backlog snapshot post-run
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = resolve(__filename, '..');
const REPO       = resolve(__dirname, '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks/_auto-scaffolded');
const TESTS_DIR  = resolve(REPO, 'tests/blocks/_auto-scaffolded');
const PENDING_JSON = resolve(REPO, 'reports/auto-scaffold-pending.json');
const CATALOG    = resolve(REPO, 'src/registry/blockCatalog.json');

const AUTO_SCAFFOLD_THRESHOLD = 0.7;
const MAX_SCAFFOLDS_PER_INGEST = 5;
const BANNED_VENDOR_RX = /eldritch|woo[\s_-]?wrath|wrath[\s_-]?of[\s_-]?olympus|crystal[\s_-]?forge[\s_-]?adb/i;

/* ── catalog kinds discovery ─────────────────────────────────────────── */

let _kindsCache = null;
let _kindsCacheMtime = 0;
let _kindsCacheSize = 0;
let _kindsCacheTime = 0;
const KINDS_CACHE_TTL_MS = 30_000; /* M9: TTL bound on mtime cache */

/**
 * Load the set of known feature kinds from blockCatalog.json.
 * Cached by file mtime so repeated calls within a single ingest are free.
 * Returns Set<string> of kinds (both camelCase + snake_case forms).
 */
export function loadCatalogKinds() {
  if (!existsSync(CATALOG)) return new Set();
  try {
    const st = statSync(CATALOG);
    /* M9 audit fix: combine mtime + size + TTL. mtime alone has 1s
     * resolution on some filesystems; size guards against in-place
     * rewrites within the same second; TTL forces re-read every 30s
     * to catch any case mtime + size both unchanged but content drifted. */
    const now = Date.now();
    if (_kindsCache &&
        _kindsCacheMtime === st.mtimeMs &&
        _kindsCacheSize === st.size &&
        (now - _kindsCacheTime) < KINDS_CACHE_TTL_MS) {
      return _kindsCache;
    }
    _kindsCacheMtime = st.mtimeMs;
    _kindsCacheSize  = st.size;
    _kindsCacheTime  = now;
  } catch { /* stat failed — re-parse */ }
  let parsed;
  try { parsed = JSON.parse(readFileSync(CATALOG, 'utf8')); }
  catch { return new Set(); }
  const kinds = new Set();
  for (const b of (parsed.catalog || [])) {
    if (Array.isArray(b.featureKinds)) for (const k of b.featureKinds) kinds.add(k);
    if (b.kind) kinds.add(b.kind);
  }
  /* Also add the snake_case form of each camelCase kind so model.features
   * declared in snake_case match. */
  for (const k of Array.from(kinds)) {
    const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    if (snake !== k) kinds.add(snake);
  }
  _kindsCache = kinds;
  return kinds;
}

/* ── pending backlog (rolling JSON) ──────────────────────────────────── */

function readPending() {
  if (!existsSync(PENDING_JSON)) return [];
  try {
    const arr = JSON.parse(readFileSync(PENDING_JSON, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writePending(entries) {
  /* Cap retention at 200 most-recent to prevent unbounded growth.
   * H4 audit fix: atomic write (tmp + rename) so concurrent ingest
   * read-modify-writes don't truncate to partial JSON if one crashes
   * mid-write. Atomic rename is POSIX-guaranteed on same filesystem. */
  const tail = entries.slice(-200);
  try {
    mkdirSync(dirname(PENDING_JSON), { recursive: true });
    const tmp = PENDING_JSON + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(tail, null, 2), 'utf8');
    renameSync(tmp, PENDING_JSON);
  } catch { /* non-fatal */ }
}

/* ── planning ────────────────────────────────────────────────────────── */

/**
 * Decide which unknown kinds qualify for auto-scaffold.
 *
 * @param {object} model parser model
 * @param {object} [opts] { threshold, maxScaffolds }
 * @returns {{ plan, skipped, blocked, capExceeded }}
 */
export async function planScaffolds(model, opts = {}) {
  const threshold = opts.threshold ?? AUTO_SCAFFOLD_THRESHOLD;
  const cap = opts.maxScaffolds ?? MAX_SCAFFOLDS_PER_INGEST;
  const catalogKinds = loadCatalogKinds();
  const { findUnknownFeatures } = await import(
    resolve(REPO, 'src/registry/featureArchetypes.mjs'));
  /* Defensive: normalize model.features to array. findUnknownFeatures
   * upstream assumes Array — malformed input could throw. We catch all
   * errors and return empty plan rather than poison the ingest. */
  let unknowns = [];
  try {
    const safeModel = (model && typeof model === 'object') ? { ...model } : {};
    if (!Array.isArray(safeModel.features)) safeModel.features = [];
    if (!Array.isArray(safeModel.__activeFeatures__)) safeModel.__activeFeatures__ = [];
    unknowns = findUnknownFeatures(safeModel, catalogKinds);
  } catch (_e) {
    /* Malformed model — emit empty plan rather than crash ingest. */
    unknowns = [];
  }

  const plan = [];
  const skipped = [];
  const blocked = [];

  for (const u of unknowns) {
    /* H6 audit fix: kind IDs must be ASCII-only. Non-ASCII characters
     * are either Unicode homoglyph bypass attempts (cyrillic 'е' U+0435
     * masquerading as latin 'e' U+0065) or pathological GDD inputs.
     * The catalog itself is 100% ASCII lowerCamelCase, so blocking
     * non-ASCII is zero-cost for legitimate use. */
    const kindStr = String(u.kind || '');
    if (/[^\x00-\x7F]/.test(kindStr)) {
      blocked.push({ kind: u.kind, reason: 'kind id contains non-ASCII (Unicode homoglyph guard)' });
      continue;
    }
    if (BANNED_VENDOR_RX.test(kindStr)) {
      blocked.push({ kind: u.kind, reason: 'banned vendor pattern in kind id' });
      continue;
    }
    if (!u.suggestion || !u.suggestion.archetype) {
      skipped.push({ kind: u.kind, reason: 'no archetype suggestion' });
      continue;
    }
    if (u.suggestion.confidence < threshold) {
      skipped.push({
        kind: u.kind,
        reason: `confidence ${u.suggestion.confidence.toFixed(2)} < ${threshold}`,
      });
      continue;
    }
    plan.push({
      kind: u.kind,
      archetype: u.suggestion.archetype.id,
      confidence: u.suggestion.confidence,
      reason: u.suggestion.reason,
    });
  }
  const capExceeded = Math.max(0, plan.length - cap);
  return { plan: plan.slice(0, cap), skipped, blocked, capExceeded };
}

/* ── kind normalization ──────────────────────────────────────────────── */

function toLowerCamel(s) {
  return String(s || 'unknownKind')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/[_-]+([a-z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/[_-]+$/, '');
}

/* ── scaffold execution ──────────────────────────────────────────────── */

/**
 * Run the auto-scaffold pass on a parser model.
 * Generates STUB block + test files for qualifying unknown kinds.
 * Updates reports/auto-scaffold-pending.json with new entries.
 *
 * @param {object} model parser model
 * @param {object} [opts] { threshold, maxScaffolds, dryRun, slug }
 * @returns {Promise<Receipt>}
 */
export async function runScaffolds(model, opts = {}) {
  const ranAt = new Date().toISOString();
  const { plan, skipped, blocked, capExceeded } = await planScaffolds(model, opts);
  const created = [];
  const errors = [];

  /* Idempotent housekeeping: enforce 200-entry rolling cap on EVERY run
   * (not just when scaffolds are created). Without this, a manually-
   * seeded pending JSON > 200 entries would stay over cap forever. */
  if (!opts.dryRun) {
    const existing = readPending();
    if (existing.length > 200) writePending(existing);
  }

  if (plan.length === 0) {
    return { ok: true, ranAt, plan: [], created, skipped, blocked, capExceeded, pending: readPending() };
  }

  /* Lazy import emitter — keep cost zero when no plan. */
  let emitBlockSource, emitTestSource, getArchetype;
  try {
    ({ emitBlockSource, emitTestSource } = await import(resolve(REPO, 'tools/scaffold-block.mjs')));
    ({ getArchetype } = await import(resolve(REPO, 'src/registry/featureArchetypes.mjs')));
  } catch (e) {
    return {
      ok: false, ranAt, plan, created, skipped, blocked, capExceeded,
      pending: readPending(), reason: `template import failed: ${e.message}`,
    };
  }

  /* Ensure output dirs exist. */
  try { mkdirSync(BLOCKS_DIR, { recursive: true }); } catch {}
  try { mkdirSync(TESTS_DIR, { recursive: true }); } catch {}

  const newPendingEntries = [];

  for (const item of plan) {
    const archetype = getArchetype(item.archetype);
    if (!archetype) {
      errors.push({ kind: item.kind, error: `archetype ${item.archetype} not registered` });
      continue;
    }
    /* C1 + C3 audit fix: separate filename marker from kind ID.
     *
     * Previously safeKind = '_auto_' + toLowerCamel(item.kind) was passed
     * as the FIRST argument of emitBlockSource — which produces a block
     * whose featureKinds = ['_auto_wild'] and emit functions named
     * 'emit_auto_wildCSS' (broken identifier with underscores). Result:
     * model.features[].kind = 'wild' NEVER matches '_auto_wild' so the
     * generated block is dead-on-arrival even when its file is on disk.
     *
     * Fix: use ORIGINAL kind for emit (so featureKinds includes the real
     * 'wild' and PascalCase functions are valid identifiers like
     * emitWildCSS), and use `_auto_` ONLY as the filename marker so
     * reviewer can grep for auto-generated stubs. */
    const originalKind = toLowerCamel(item.kind);
    const fileBaseName = '_auto_' + originalKind;
    const blockPath = join(BLOCKS_DIR, `${fileBaseName}.mjs`);
    const testPath  = join(TESTS_DIR, `${fileBaseName}.test.mjs`);

    if (existsSync(blockPath)) {
      skipped.push({ kind: item.kind, reason: `stub already exists: ${basename(blockPath)}` });
      continue;
    }

    if (opts.dryRun) {
      created.push({ kind: item.kind, path: blockPath, archetype: item.archetype, dryRun: true });
      continue;
    }

    let blockSrc, testSrc;
    try {
      /* Use originalKind so featureKinds + emit fn names are valid
       * identifiers matching what model.features[].kind will be. */
      blockSrc = emitBlockSource(originalKind, archetype);
      testSrc  = emitTestSource(originalKind, archetype);
    } catch (e) {
      errors.push({ kind: item.kind, error: `emit failed: ${e.message}` });
      continue;
    }

    /* Inject STUB warning header into block source so reviewer immediately
     * sees this needs validation.
     *
     * C2 audit note: stubs are NOT auto-registered in blockMapper.mjs or
     * blockCatalog.json. To wire a stub into the runtime, reviewer must:
     *   1. Promote file from src/blocks/_auto-scaffolded/_auto_<kind>.mjs
     *      to src/blocks/<kind>.mjs (drop _auto_ prefix from filename)
     *   2. Add entry to src/registry/blockCatalog.json featureKinds
     *   3. Wire into blockMapper.mjs CANONICAL_BLOCKS map
     * Until reviewer takes those steps, the stub is REVIEW-ONLY artifact
     * (audit trail that "we saw this unknown kind and have a starting
     * point"). Auto-discovery of _auto-scaffolded/ at runtime would
     * require blockMapper refactor — tracked as G-followup. */
    const stubHeader = [
      '/**',
      ` * @status STUB — auto-generated by tools/auto-scaffold-detector.mjs`,
      ` * @generatedFor unknownKind="${String(item.kind).replace(/\*\//g, '*\\/')}"`,
      ` * @archetype ${String(item.archetype).replace(/\*\//g, '*\\/')}`,
      ` * @confidence ${item.confidence.toFixed(2)}`,
      ` * @reason ${String(item.reason).replace(/\*\//g, '*\\/')}`,
      ` * @reviewBacklog reports/auto-scaffold-pending.json`,
      ' * ',
      ' * MANUAL REVIEW REQUIRED before relying on this block. Defaults are',
      ' * conservative archetype templates; feature-specific behavior MUST be',
      ' * validated against the originating GDD before promoting out of the',
      ' * _auto-scaffolded/ subtree.',
      ' * ',
      ' * NOT RUNTIME-WIRED: stubs in _auto-scaffolded/ are review artifacts',
      ' * only. To wire into runtime, promote file out of _auto-scaffolded/',
      ' * + register in blockMapper.mjs + blockCatalog.json.',
      ' */',
      '',
    ].join('\n');

    try {
      /* H5 audit fix: TOCTOU-safe write — flag 'wx' fails if file exists
       * (atomic exclusive create). Catches race where two concurrent
       * ingests see existsSync()=false then both write. */
      try {
        writeFileSync(blockPath, stubHeader + blockSrc, { encoding: 'utf8', flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') {
          skipped.push({ kind: item.kind, reason: 'stub race: another writer created stub first' });
          continue;
        }
        throw e;
      }
      try {
        writeFileSync(testPath, testSrc, { encoding: 'utf8', flag: 'wx' });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      created.push({ kind: item.kind, path: blockPath, archetype: item.archetype });
      newPendingEntries.push({
        kind: item.kind,
        originalKind,
        fileBaseName,
        archetype: item.archetype,
        confidence: item.confidence,
        reason: item.reason,
        blockPath: blockPath.replace(REPO + '/', ''),
        testPath: testPath.replace(REPO + '/', ''),
        scaffoldedAt: ranAt,
        slug: opts.slug || null,
        status: 'pending-review',
      });
    } catch (e) {
      errors.push({ kind: item.kind, error: `write failed: ${e.message}` });
    }
  }

  /* Update pending log. */
  if (newPendingEntries.length > 0 && !opts.dryRun) {
    const all = readPending().concat(newPendingEntries);
    writePending(all);
  }

  return {
    ok: errors.length === 0,
    ranAt,
    plan,
    created,
    skipped,
    blocked,
    capExceeded,
    errors,
    pending: readPending(),
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('auto-scaffold-detector.mjs')) {
  const args = process.argv.slice(2);
  const modelPath = args.find(a => a.startsWith('--model='))?.slice(8);
  const dryRun = args.includes('--dry-run');
  if (!modelPath) {
    console.error('Usage: node tools/auto-scaffold-detector.mjs --model=PATH [--dry-run]');
    process.exit(2);
  }
  if (!existsSync(modelPath)) { console.error(`model missing: ${modelPath}`); process.exit(1); }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const r = await runScaffolds(model, { dryRun });
  console.log(JSON.stringify({
    ok: r.ok,
    ranAt: r.ranAt,
    planCount: r.plan.length,
    createdCount: r.created.length,
    skippedCount: r.skipped.length,
    blockedCount: r.blocked.length,
    capExceeded: r.capExceeded,
    pendingTotal: r.pending.length,
    created: r.created,
  }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
