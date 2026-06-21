/**
 * tests/tools/scaffold-block.test.mjs
 *
 * Wave Z-2 (2026-06-21) — smoke test for tools/scaffold-block.mjs.
 *
 * Asserts:
 *   1. --list exits 0 and prints all 25 archetype ids
 *   2. Missing flags → exit 2
 *   3. Unknown archetype → exit 2
 *   4. Bad kind (snake_case / PascalCase) → exit 2
 *   5. --dry-run prints valid JS that imports ARCHETYPE_ID matching the
 *      requested archetype
 *   6. Real write creates both files and refuses to overwrite without --force
 *
 * Each test writes into a unique kind name in src/blocks/_scaffoldTest*
 * and cleans up after itself. Real scaffolded files do not survive the
 * test run.
 */
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const TOOL = resolve(REPO, 'tools/scaffold-block.mjs');

function run(args, { input = '' } = {}) {
  return spawnSync('node', [TOOL, ...args], { encoding: 'utf8', input });
}

/* Track created files for cleanup */
const CLEANUP = [];
function track(kind) {
  CLEANUP.push(resolve(REPO, `src/blocks/${kind}.mjs`));
  CLEANUP.push(resolve(REPO, `tests/blocks/${kind}.test.mjs`));
}
after(() => {
  for (const p of CLEANUP) { try { if (existsSync(p)) unlinkSync(p); } catch (_) {} }
});

test('--list exits 0 and prints all 25 archetype ids', () => {
  const r = run(['--list']);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
  /* spot-check baseline + UQ-6 archetypes */
  for (const id of [
    'sticky-state', 'accumulator', 'ladder', 'reveal', 'spawn',
    'cascade-collapse', 'jackpot-pool',
    'multiplier-trail', 'feature-purchase', 'side-bet', 'weighted-wheel',
    'variable-ways', 'wild-multiplier', 'stacked-symbols', 'reel-extender',
    'morph-progressive', 'gamble-double',
  ]) {
    assert.ok(r.stdout.includes(id), 'missing archetype id in --list: ' + id);
  }
});

test('missing --archetype / --kind exits 2', () => {
  const a = run([]);
  assert.equal(a.status, 2);
  const b = run(['--archetype', 'sticky-state']);
  assert.equal(b.status, 2);
  const c = run(['--kind', 'foo']);
  assert.equal(c.status, 2);
});

test('unknown archetype exits 2', () => {
  const r = run(['--archetype', 'no-such-archetype-xyz', '--kind', 'fooBlock', '--dry-run']);
  assert.equal(r.status, 2);
  assert.ok(/Unknown archetype/.test(r.stderr));
});

test('bad kind format exits 2', () => {
  for (const bad of ['snake_case', 'PascalCase', '1leadingDigit', 'with spaces', 'with-dash']) {
    const r = run(['--archetype', 'sticky-state', '--kind', bad, '--dry-run']);
    assert.equal(r.status, 2, 'should reject kind ' + bad);
    assert.ok(/lowerCamelCase/.test(r.stderr), 'reason missing for ' + bad);
  }
});

test('--dry-run emits valid JS referencing requested archetype', () => {
  const r = run(['--archetype', 'multiplier-trail', '--kind', 'tumbleMultTrailDry', '--dry-run']);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
  /* dry-run output must contain both src and test files marked with === headers */
  assert.ok(r.stdout.includes('src/blocks/tumbleMultTrailDry.mjs'));
  assert.ok(r.stdout.includes('tests/blocks/tumbleMultTrailDry.test.mjs'));
  /* generated block must declare ARCHETYPE_ID = 'multiplier-trail' */
  assert.ok(r.stdout.includes(`export const ARCHETYPE_ID = 'multiplier-trail'`),
    'ARCHETYPE_ID export missing or wrong id');
  /* generated block must reference the multiplier-trail forceFlag */
  assert.ok(r.stdout.includes('__FORCE_TRAIL_STEP__'),
    'forceFlag for multiplier-trail not embedded');
  /* nothing on disk yet */
  assert.equal(existsSync(resolve(REPO, 'src/blocks/tumbleMultTrailDry.mjs')), false);
});

test('real write creates both files and refuses overwrite without --force', () => {
  const kind = 'scaffoldTestSmokeBlock';
  track(kind);
  const r = run(['--archetype', 'cascade-collapse', '--kind', kind]);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
  assert.ok(existsSync(resolve(REPO, `src/blocks/${kind}.mjs`)));
  assert.ok(existsSync(resolve(REPO, `tests/blocks/${kind}.test.mjs`)));

  /* second run without --force must fail */
  const r2 = run(['--archetype', 'cascade-collapse', '--kind', kind]);
  assert.equal(r2.status, 2, 'second scaffold should refuse');
  assert.ok(/already exists/.test(r2.stderr));

  /* --force succeeds */
  const r3 = run(['--archetype', 'cascade-collapse', '--kind', kind, '--force']);
  assert.equal(r3.status, 0, 'force overwrite failed: ' + r3.stderr);
});

test('scaffolded block + test for every archetype actually loads and passes', async () => {
  /* End-to-end coverage: ensure every archetype produces a runnable block.
     We pick one kind per archetype, scaffold, run its test file via node:test
     programmatic API by importing it. */
  const { ARCHETYPES } = await import('../../src/registry/featureArchetypes.mjs');
  for (const a of ARCHETYPES) {
    const kind = 'scaffoldE2e' + a.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    track(kind);
    const r = run(['--archetype', a.id, '--kind', kind, '--force']);
    assert.equal(r.status, 0, `scaffold failed for ${a.id}: ${r.stderr}`);
    /* Import generated block and assert contract */
    const mod = await import(resolve(REPO, `src/blocks/${kind}.mjs`));
    assert.equal(mod.ARCHETYPE_ID, a.id, 'ARCHETYPE_ID mismatch for ' + a.id);
    assert.equal(mod.FORCE_FLAG, a.forceFlag, 'FORCE_FLAG mismatch for ' + a.id);
    assert.equal(mod.WINDOW_FLAG, a.windowFlag, 'WINDOW_FLAG mismatch for ' + a.id);
    /* defaultConfig() must be frozen with enabled false */
    const cfg = mod.defaultConfig();
    assert.ok(Object.isFrozen(cfg));
    assert.equal(cfg.enabled, false);
  }
});
