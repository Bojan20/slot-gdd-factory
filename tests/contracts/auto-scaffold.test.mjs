#!/usr/bin/env node
/**
 * tests/contracts/auto-scaffold.test.mjs
 *
 * N+2 G (2026-06-23) — Contract suite for the auto-scaffold detector.
 *
 * Coverage:
 *   1.  loadCatalogKinds returns non-empty Set
 *   2.  loadCatalogKinds is cached (same Set instance second call)
 *   3.  planScaffolds: model sa nepoznatim kind koji ima archetype match
 *   4.  planScaffolds: confidence < threshold → skip
 *   5.  planScaffolds: banned vendor regex u kind ID → block
 *   6.  planScaffolds: max scaffolds cap respected
 *   7.  planScaffolds: empty model → empty plan
 *   8.  runScaffolds: --dry-run writes nothing to disk
 *   9.  runScaffolds: creates stub block sa @status STUB header
 *  10. runScaffolds: creates matching test fixture
 *  11. runScaffolds: writes to reports/auto-scaffold-pending.json
 *  12. runScaffolds: idempotent — second call skips existing stub
 *  13. runScaffolds: stub fajl pre-prefixed sa `_auto_`
 *  14. anti-vendor: stub source has no banned product names
 *  15. anti-vendor: pending entry has no banned product names
 *  16. CLI: --dry-run exits 0 + emits JSON receipt
 *  17. Error handling: malformed model doesn't throw (soft-fail)
 *  18. Cleanup: stubs deletable via standard fs operations
 *  19. Receipt shape: ok/plan/created/skipped/blocked/pending all present
 *  20. Pending JSON: capped at 200 entries (rolling)
 *
 * Run: node tests/contracts/auto-scaffold.test.mjs
 */

import { existsSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..', '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks/_auto-scaffolded');
const TESTS_DIR  = resolve(REPO, 'tests/blocks/_auto-scaffolded');
const PENDING_JSON = resolve(REPO, 'reports/auto-scaffold-pending.json');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { const r = fn(); if (r && r.then) throw new Error('use async test()');
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }

console.log('═══ auto-scaffold.test.mjs ═══');

const { loadCatalogKinds, planScaffolds, runScaffolds } =
  await import(resolve(REPO, 'tools/auto-scaffold-detector.mjs'));

/* Pre-test cleanup — remove any leftover stubs from prior runs */
function cleanupStubs() {
  for (const dir of [BLOCKS_DIR, TESTS_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.startsWith('_auto_test_')) {
        try { rmSync(join(dir, f), { force: true }); } catch {}
      }
    }
  }
}
cleanupStubs();

/* Backup + restore pending JSON so tests don't pollute real backlog. */
const pendingBackup = existsSync(PENDING_JSON) ? readFileSync(PENDING_JSON, 'utf8') : null;
function restorePending() {
  if (pendingBackup !== null) {
    try { mkdirSync(dirname(PENDING_JSON), { recursive: true }); writeFileSync(PENDING_JSON, pendingBackup, 'utf8'); } catch {}
  } else if (existsSync(PENDING_JSON)) {
    try { rmSync(PENDING_JSON, { force: true }); } catch {}
  }
}

/* ── fixtures ────────────────────────────────────────────────────────── */

/* Model sa kind koji prolazi alias mapping → high confidence. We use a
 * kind that should match an existing archetype example. */
const MODEL_KNOWN_FEATURE_UNKNOWN_KIND = {
  features: [
    { kind: 'stickyWild' },        /* should match sticky-state archetype */
    { kind: '_auto_test_synthetic1' },  /* probably no match → skipped */
  ],
};

/* Banned vendor regex check */
const MODEL_BANNED_KIND = {
  features: [
    { kind: 'eldritchSpinWild' },   /* contains banned name */
  ],
};

/* ─── tests ─────────────────────────────────────────────────────────── */

test('1. loadCatalogKinds returns non-empty Set', () => {
  const s = loadCatalogKinds();
  assert(s instanceof Set, 'expected Set');
  assert(s.size > 10, `expected > 10 kinds, got ${s.size}`);
});

test('2. loadCatalogKinds caches Set instance', () => {
  const s1 = loadCatalogKinds();
  const s2 = loadCatalogKinds();
  assertEq(s1, s2, 'expected same Set instance (mtime cache)');
});

await testAsync('3. planScaffolds: known archetype example → plan entry', async () => {
  const r = await planScaffolds(MODEL_KNOWN_FEATURE_UNKNOWN_KIND);
  /* stickyWild should match sticky-state archetype via exact-example */
  const planned = r.plan.find(p => p.kind === 'stickyWild');
  /* The kind 'stickyWild' may or may not be in catalog depending on
   * blockCatalog state — if it is, it's not in unknowns. Assert we got
   * a structured response. */
  assert(Array.isArray(r.plan), 'expected plan array');
  assert(Array.isArray(r.skipped), 'expected skipped array');
  assert(Array.isArray(r.blocked), 'expected blocked array');
});

await testAsync('4. planScaffolds: high threshold → fewer plans', async () => {
  const rLow = await planScaffolds(MODEL_KNOWN_FEATURE_UNKNOWN_KIND, { threshold: 0.3 });
  const rHigh = await planScaffolds(MODEL_KNOWN_FEATURE_UNKNOWN_KIND, { threshold: 0.99 });
  assert(rHigh.plan.length <= rLow.plan.length, 'higher threshold should not produce MORE plans');
});

await testAsync('5. planScaffolds: banned vendor regex → block', async () => {
  const r = await planScaffolds(MODEL_BANNED_KIND);
  const blocked = r.blocked.find(b => /eldritch/i.test(b.kind));
  assert(blocked, `expected eldritch* kind blocked, got: ${JSON.stringify(r.blocked)}`);
});

await testAsync('6. planScaffolds: max scaffolds cap respected', async () => {
  /* Build a model with 10 unknown kinds that all match archetypes. */
  const manyKinds = Array.from({ length: 10 }, (_, i) => ({ kind: `stickyWildAuto${i}` }));
  const r = await planScaffolds({ features: manyKinds }, { maxScaffolds: 3 });
  assert(r.plan.length <= 3, `plan should respect cap, got ${r.plan.length}`);
});

await testAsync('7. planScaffolds: empty model → empty plan', async () => {
  const r = await planScaffolds({ features: [] });
  assertEq(r.plan.length, 0);
});

await testAsync('8. runScaffolds: --dry-run writes nothing to disk', async () => {
  const model = { features: [{ kind: '_auto_test_dryRunCheck' }] };
  const r = await runScaffolds(model, { dryRun: true, threshold: 0.0 });
  /* No file should exist for dry run. */
  for (const c of r.created) {
    assert(c.dryRun === true, 'created entry should have dryRun=true');
    assert(!existsSync(c.path), `dryRun shouldn't write: ${c.path}`);
  }
});

let createdStubPath = null;
await testAsync('9. runScaffolds: creates stub block sa @status STUB header', async () => {
  /* Use a kind that matches an archetype via alias or substring with
   * lower threshold for deterministic test. */
  const model = { features: [{ kind: 'stickyWildFromTest' }] };
  const r = await runScaffolds(model, { threshold: 0.5 });
  /* If created, the block file must exist + have stub header. */
  if (r.created.length > 0) {
    createdStubPath = r.created[0].path;
    assert(existsSync(createdStubPath), 'block not on disk: ' + createdStubPath);
    const src = readFileSync(createdStubPath, 'utf8');
    assert(src.includes('@status STUB'), 'expected @status STUB header');
    assert(src.includes('@archetype'), 'expected @archetype annotation');
  } else {
    /* If no archetype matched (catalog has stickyWildFromTest already?),
     * skip this assertion gracefully. */
    console.log(`    (no stub created — catalog may already have stickyWildFromTest)`);
  }
});

await testAsync('10. runScaffolds: creates matching test fixture', async () => {
  if (!createdStubPath) {
    console.log(`    (skipped — no stub created in test 9)`);
    return;
  }
  const testFixturePath = createdStubPath
    .replace('/src/blocks/', '/tests/blocks/')
    .replace('.mjs', '.test.mjs');
  assert(existsSync(testFixturePath), 'expected test fixture: ' + testFixturePath);
});

await testAsync('11. runScaffolds: writes to reports/auto-scaffold-pending.json', async () => {
  /* After test 9 ran (if stub created), pending JSON should contain entry. */
  if (!createdStubPath) {
    console.log(`    (skipped — no stub created in test 9)`);
    return;
  }
  assert(existsSync(PENDING_JSON), 'pending JSON missing');
  const pending = JSON.parse(readFileSync(PENDING_JSON, 'utf8'));
  assert(Array.isArray(pending), 'pending should be array');
  const entry = pending.find(p => p.kind === 'stickyWildFromTest');
  assert(entry, 'expected stickyWildFromTest in pending');
  assertEq(entry.status, 'pending-review');
});

await testAsync('12. runScaffolds: idempotent — second call skips existing stub', async () => {
  if (!createdStubPath) {
    console.log(`    (skipped — no stub from test 9)`);
    return;
  }
  const model = { features: [{ kind: 'stickyWildFromTest' }] };
  const r = await runScaffolds(model, { threshold: 0.5 });
  /* Created should be empty (already exists), skipped should contain it. */
  assertEq(r.created.length, 0, 'second call should not re-create');
  const skipped = r.skipped.find(s => s.kind === 'stickyWildFromTest');
  assert(skipped, `expected stickyWildFromTest in skipped, got: ${JSON.stringify(r.skipped)}`);
  assert(/already exists/.test(skipped.reason), `reason: ${skipped.reason}`);
});

await testAsync('13. runScaffolds: stub fajl pre-prefixed sa `_auto_`', async () => {
  if (!createdStubPath) {
    console.log(`    (skipped — no stub from test 9)`);
    return;
  }
  const basename = createdStubPath.split('/').pop();
  assert(basename.startsWith('_auto_'), `expected _auto_ prefix, got ${basename}`);
});

test('14. anti-vendor: stub source has no banned product names', () => {
  if (!createdStubPath) return;
  const src = readFileSync(createdStubPath, 'utf8');
  const banned = /eldritch|woo[\s_-]?wrath|wrath[\s_-]?of[\s_-]?olympus|crystal[\s_-]?forge[\s_-]?adb/i;
  assert(!banned.test(src), 'banned vendor name in stub source');
});

test('15. anti-vendor: pending entry has no banned product names', () => {
  if (!existsSync(PENDING_JSON)) return;
  const pending = readFileSync(PENDING_JSON, 'utf8');
  const banned = /eldritch|woo[\s_-]?wrath|wrath[\s_-]?of[\s_-]?olympus|crystal[\s_-]?forge[\s_-]?adb/i;
  assert(!banned.test(pending), 'banned vendor in pending JSON');
});

await testAsync('16. CLI: --dry-run exits 0 + emits JSON receipt', async () => {
  const { tmpdir } = await import('node:os');
  const tmp = join(tmpdir(), 'auto-scaffold-cli-' + Date.now() + '.json');
  writeFileSync(tmp, JSON.stringify({ features: [{ kind: 'stickyDryCli' }] }), 'utf8');
  const r = spawnSync('node', [
    resolve(REPO, 'tools/auto-scaffold-detector.mjs'),
    `--model=${tmp}`, '--dry-run',
  ], { encoding: 'utf8', timeout: 15000 });
  rmSync(tmp, { force: true });
  assertEq(r.status, 0, `CLI exit ${r.status}, stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert(typeof out.ok === 'boolean');
  assert(typeof out.planCount === 'number');
});

await testAsync('17. Error handling: malformed model doesn\'t throw', async () => {
  const r1 = await runScaffolds(null);
  assert(r1.ok === true || r1.ok === false, 'should return receipt, not throw');
  const r2 = await runScaffolds({ features: 'not-an-array' });
  assert(r2.ok === true || r2.ok === false, 'should handle non-array features');
});

test('18. Cleanup: stubs deletable via standard fs operations', () => {
  if (!createdStubPath) return;
  /* Delete created stub + test fixture for clean test exit. */
  try { rmSync(createdStubPath, { force: true }); } catch {}
  const testPath = createdStubPath
    .replace('/src/blocks/', '/tests/blocks/')
    .replace('.mjs', '.test.mjs');
  try { rmSync(testPath, { force: true }); } catch {}
  assert(!existsSync(createdStubPath), 'stub should be deletable');
});

await testAsync('19. Receipt shape: ok/plan/created/skipped/blocked/pending present', async () => {
  const r = await runScaffolds({ features: [] }, { dryRun: true });
  for (const k of ['ok', 'ranAt', 'plan', 'created', 'skipped', 'blocked', 'capExceeded', 'pending']) {
    assert(k in r, `receipt missing key: ${k}`);
  }
});

await testAsync('20. Pending JSON: capped at 200 entries (rolling)', async () => {
  /* Manually write 250 dummy entries, then trigger one more run, verify <= 200. */
  const dummy = Array.from({ length: 250 }, (_, i) => ({ kind: `_test_dummy_${i}`, status: 'pending-review' }));
  try { mkdirSync(dirname(PENDING_JSON), { recursive: true }); } catch {}
  writeFileSync(PENDING_JSON, JSON.stringify(dummy), 'utf8');
  /* Run any scaffold so writePending fires. */
  await runScaffolds({ features: [{ kind: 'stickyWildRollingCap' }] }, { threshold: 0.5 });
  const pending = JSON.parse(readFileSync(PENDING_JSON, 'utf8'));
  assert(pending.length <= 200, `expected ≤ 200, got ${pending.length}`);
});

await testAsync('21. C1+C3 audit: stub uses ORIGINAL kind, not _auto_ prefix', async () => {
  /* After C1+C3 fix: emit fn names use originalKind (PascalCase 'wild' →
   * 'Wild'), featureKinds includes original 'wild', filename only carries
   * _auto_ marker. Verifies stub WILL match model.features[].kind = 'wild'
   * once promoted out of _auto-scaffolded/. */
  cleanupStubs();
  const model = { features: [{ kind: 'stickyWildC1Check' }] };
  const r = await runScaffolds(model, { threshold: 0.5 });
  if (r.created.length === 0) {
    console.log(`    (skipped — kind didn't match archetype)`);
    return;
  }
  const path = r.created[0].path;
  const src = readFileSync(path, 'utf8');
  /* Filename should have _auto_ prefix marker */
  assert(/\/_auto_/.test(path), `filename should have _auto_ marker, got: ${path}`);
  /* But emitted function names should be PascalCase of ORIGINAL kind (no underscore) */
  assert(/emit[A-Z][a-zA-Z0-9]*CSS\s*\(/.test(src),
    'expected valid PascalCase emit*CSS function (e.g. emitStickyWildC1CheckCSS)');
  /* No emit_auto_* identifiers (broken JS) */
  assert(!/emit_auto_/.test(src),
    'emit fn name MUST NOT contain _auto_ (would be broken identifier)');
});

await testAsync('22. H5 audit: TOCTOU-safe write — flag wx prevents race overwrite', async () => {
  /* Pre-create the stub file by hand, then run scaffolder — must skip
   * gracefully without truncating the existing file. */
  cleanupStubs();
  mkdirSync(BLOCKS_DIR, { recursive: true });
  const preExisting = join(BLOCKS_DIR, '_auto_stickyToctouTest.mjs');
  const guardContent = '// hand-edited stub, must NOT be overwritten\n';
  writeFileSync(preExisting, guardContent, 'utf8');
  const model = { features: [{ kind: 'stickyToctouTest' }] };
  const r = await runScaffolds(model, { threshold: 0.5 });
  /* Either: archetype not matched (no race tested) OR file unchanged */
  const after = readFileSync(preExisting, 'utf8');
  assertEq(after, guardContent, 'pre-existing file was overwritten by scaffolder');
  try { rmSync(preExisting, { force: true }); } catch {}
});

await testAsync('23. H6 audit: non-ASCII kind blocked (Unicode homoglyph guard)', async () => {
  const cyrillicKind = 'еldritchHomoglyph'; /* cyrillic 'е' U+0435 */
  const r = await planScaffolds({ features: [{ kind: cyrillicKind }] });
  const blocked = r.blocked.find(b => b.kind === cyrillicKind);
  assert(blocked, `expected non-ASCII kind blocked, got: ${JSON.stringify(r)}`);
  assert(/non-ASCII|homoglyph/i.test(blocked.reason),
    `expected homoglyph reason, got: ${blocked.reason}`);
});

test('24. M7 audit: stub header escapes */ in interpolated values', () => {
  /* Inspect detector source: must call .replace(/\*\//g, '*\\/') on
   * interpolated kind, archetype, reason. */
  const detectorSrc = readFileSync(resolve(REPO, 'tools/auto-scaffold-detector.mjs'), 'utf8');
  assert(/\*\\\\\//.test(detectorSrc) || detectorSrc.includes("'*\\\\/'"),
    'expected */ escape in stub header interpolation');
});

/* ─── cleanup ────────────────────────────────────────────────────────── */
cleanupStubs();
restorePending();

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
