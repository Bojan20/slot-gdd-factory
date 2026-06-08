/* eslint-disable no-console */
/**
 * tests/_gen-block-manifest.test.mjs — Wave Z.1 unit suite
 *
 * Asserts the contract of `blocks/_manifest.json` so the Playground
 * front-end (playground.js) can trust the shape it consumes. We do
 * NOT regenerate the manifest in CI — instead we verify the checked-in
 * file matches a fresh run (via `--check` mode) so a forgotten regen
 * fails the gate loudly.
 *
 * Coverage matrix:
 *   • Manifest exists at expected path + parses as JSON
 *   • Top-level shape: { generatedAt, blocksDir, totalBlocks, blocks[] }
 *   • totalBlocks matches blocks.length
 *   • Every src/blocks/*.mjs file has exactly one manifest entry
 *   • Per-entry shape:
 *       name, file, testFile|null, category, description,
 *       exports[], lifecycleHooks[], emittedEvents[],
 *       defaultConfig (any), loc (int)
 *   • No vendor / game-specific strings leak into descriptions
 *   • Categories live in the canonical enum (no typos)
 *   • Blocks are sorted alphabetically by name
 *   • hookBus block is the sole owner of canonical event names
 *     listed in HOOK_EVENTS — i.e. emit-side single ownership
 *     across the manifest is preserved (cross-checked against LEGO
 *     gate output but does NOT replace it)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = resolvePath(REPO, 'blocks/_manifest.json');
const BLOCKS_DIR    = resolvePath(REPO, 'src/blocks');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
}
function eq(a, b, m = '') {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`);
}
function ok(v, m = '') { if (!v) throw new Error(`expected truthy — ${m}`); }
function nct(s, n, m = '') {
  if (String(s).toLowerCase().includes(String(n).toLowerCase()))
    throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`);
}

console.log('— tools/gen-block-manifest.mjs —');

const raw = readFileSync(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(raw);
const sourceFiles = readdirSync(BLOCKS_DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));

/* ── top-level shape ── */

t('manifest parses as JSON object', () => { ok(manifest && typeof manifest === 'object'); });

t('has generatedAt ISO timestamp', () => {
  ok(typeof manifest.generatedAt === 'string');
  ok(!Number.isNaN(Date.parse(manifest.generatedAt)));
});

t('has blocksDir = "src/blocks"', () => {
  eq(manifest.blocksDir, 'src/blocks');
});

t('totalBlocks matches blocks.length', () => {
  ok(Array.isArray(manifest.blocks));
  eq(manifest.totalBlocks, manifest.blocks.length);
});

t('totalBlocks matches src/blocks/*.mjs file count', () => {
  eq(manifest.totalBlocks, sourceFiles.length);
});

/* ── per-block entry shape ── */

const CANONICAL_CATEGORIES = new Set([
  'engine', 'wild', 'multiplier', 'fs', 'round-control',
  'evaluator', 'feature', 'ui', 'audit', 'uncategorised',
]);

t('every entry has the required keys', () => {
  for (const b of manifest.blocks) {
    for (const k of ['name','file','testFile','category','description',
                     'exports','lifecycleHooks','emittedEvents','loc']) {
      ok(Object.prototype.hasOwnProperty.call(b, k), `${b.name} missing key ${k}`);
    }
  }
});

t('every entry has a recognised category', () => {
  for (const b of manifest.blocks) {
    ok(CANONICAL_CATEGORIES.has(b.category), `${b.name} → unknown category "${b.category}"`);
  }
});

t('every entry.file resolves to a real source file', () => {
  const fileNames = new Set(sourceFiles.map((f) => 'src/blocks/' + f));
  for (const b of manifest.blocks) {
    ok(fileNames.has(b.file), `${b.name} → ${b.file} not in src/blocks/`);
  }
});

t('every entry.exports is a sorted-unique array', () => {
  for (const b of manifest.blocks) {
    ok(Array.isArray(b.exports), `${b.name} exports not array`);
    const sorted = [...b.exports].sort();
    eq(JSON.stringify(b.exports), JSON.stringify(sorted), `${b.name} exports not sorted`);
    eq(new Set(b.exports).size, b.exports.length, `${b.name} exports has duplicates`);
  }
});

t('every entry.lifecycleHooks is a sorted-unique array', () => {
  for (const b of manifest.blocks) {
    ok(Array.isArray(b.lifecycleHooks), `${b.name} hooks not array`);
    const sorted = [...b.lifecycleHooks].sort();
    eq(JSON.stringify(b.lifecycleHooks), JSON.stringify(sorted));
    eq(new Set(b.lifecycleHooks).size, b.lifecycleHooks.length);
  }
});

t('every entry.emittedEvents is a sorted-unique array', () => {
  for (const b of manifest.blocks) {
    ok(Array.isArray(b.emittedEvents), `${b.name} emits not array`);
    const sorted = [...b.emittedEvents].sort();
    eq(JSON.stringify(b.emittedEvents), JSON.stringify(sorted));
    eq(new Set(b.emittedEvents).size, b.emittedEvents.length);
  }
});

t('every entry.loc is a positive integer', () => {
  for (const b of manifest.blocks) {
    ok(Number.isInteger(b.loc) && b.loc > 0, `${b.name} loc=${b.loc}`);
  }
});

t('every entry.description is a non-empty string', () => {
  for (const b of manifest.blocks) {
    ok(typeof b.description === 'string' && b.description.length > 0, `${b.name} description empty`);
  }
});

t('blocks are sorted alphabetically by name', () => {
  const names = manifest.blocks.map((b) => b.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  eq(JSON.stringify(names), JSON.stringify(sorted));
});

t('vendor-neutral: descriptions contain no vendor names', () => {
  const banned = ['gates of olympus','reactoonz','megaways','wrath of olympus',
                  'sweet bonanza','pragmatic','microgaming','netent','playa-slot',
                  'cleopatra','buffalo','cash eruption'];
  for (const b of manifest.blocks) {
    for (const bn of banned) nct(b.description, bn, `${b.name} → "${bn}"`);
  }
});

/* ── emit ownership: cross-checked via the LEGO gate ──────────
 *
 * The strict single-emitter business rule is enforced by
 * `tools/lego-gate.mjs` (invariant #4), which has its own AST-aware
 * scanner. Here we only sanity-check that EVERY block listed in the
 * manifest as an emitter actually has at least one `HookBus.emit(`
 * call in its source — i.e. no manifest-level false positives. */

t('emit ownership: manifest-listed emitters all have source-level emit', () => {
  for (const b of manifest.blocks) {
    if (!b.emittedEvents.length) continue;
    const src = readFileSync(resolvePath(REPO, b.file), 'utf8');
    ok(/HookBus\.emit\(/.test(src), `${b.name} listed as emitter but no HookBus.emit(...) in source`);
  }
});

/* ── --check mode passes (manifest is fresh on disk) ── */

t('manifest is fresh — `gen-block-manifest.mjs --check` would pass', () => {
  /* Re-run the generator into memory and compare. We use spawnSync
   * with --print so we don't overwrite the file mid-test. The two
   * snapshots are byte-comparable after trimming the generatedAt
   * (which changes per-run by design). */
  /* Default spawnSync maxBuffer is 1MB on modern Node, but explicit is
   * safer: the manifest size grew past 64KB once Wave P8 landed and the
   * truncation surfaced as "Unterminated string in JSON". 8MB is well
   * above any plausible block manifest size. */
  const r = spawnSync('node', ['tools/gen-block-manifest.mjs', '--print'], {
    cwd: REPO,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`generator exited with ${r.status}: ${r.stderr}`);
  const fresh = JSON.parse(r.stdout.toString('utf8'));
  /* Compare everything except generatedAt */
  delete fresh.generatedAt;
  const stable = JSON.parse(raw);
  delete stable.generatedAt;
  /* Block defaultConfig fields are deep-equal sensitive to key ordering;
   * normalise via JSON.stringify round-trip. */
  eq(JSON.stringify(fresh), JSON.stringify(stable),
     'manifest on disk differs from a fresh generator run — `node tools/gen-block-manifest.mjs`');
});

/* ── summary ── */

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
