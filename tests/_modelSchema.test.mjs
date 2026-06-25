/**
 * tests/_modelSchema.test.mjs
 *
 * N+2 atom I (Boki 2026-06-25) — Contract tests for the top-level
 * model.json schema versioning + migration runner.
 *
 * Covers:
 *   1. MODEL_SCHEMA_VERSION exports as a valid semver string
 *   2. parseSemver / compareSemver round-trip + ordering
 *   3. buildSchemaEnvelope shape + ISO-8601 timestamp
 *   4. readModelVersion handles missing / malformed / valid envelopes
 *   5. freshModel() (via parseGDD) stamps __schema__ on outputs
 *   6. parseGDD on real markdown stamps __schema__.version === current
 *   7. migrate() on a legacy (no-envelope) model stamps current version
 *   8. migrate() is idempotent (twice = once)
 *   9. migrate() does not mutate the input object
 *  10. planMigration throws on downgrade attempts
 *  11. planMigration returns empty chain for same-version
 *  12. CLI: --list prints registry; --version reads file; round-trip OK
 */

import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MODEL_SCHEMA_VERSION,
  buildSchemaEnvelope,
  readModelVersion,
  parseSemver,
  compareSemver,
} from '../src/registry/modelSchemaVersion.mjs';
import {
  migrate,
  planMigration,
  listMigrations,
  register,
  _resetRegistryForTests,
} from '../src/registry/modelMigrations.mjs';
import { parseGDD } from '../src/parser.mjs';

let pass = 0;
let fail = 0;
/* UQ-U-7 atom #14 (Boki 2026-06-25 audit #8 P1 VERIFIED): t() now runs
   fn() inside try/finally so an optional `cleanup` arg always fires —
   even when fn throws. Eliminates the cross-test contamination risk
   where a BFS / migration test would leave _registry mutated for any
   subsequent in-process test if the assert.throws regex mismatched. */
function t(name, fn, cleanup) {
  try {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      pass++;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`      ${err.message}`);
      fail++;
    }
  } finally {
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (cleanupErr) {
        console.log(`      (cleanup failed: ${cleanupErr.message})`);
      }
    }
  }
}

console.log('modelSchema contract suite');

/* 1 */
t('MODEL_SCHEMA_VERSION is a valid MAJOR.MINOR.PATCH semver', () => {
  assert.match(MODEL_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

/* 2 */
t('parseSemver returns [0,0,0] for garbage, triple for valid', () => {
  assert.deepEqual(parseSemver(null), [0, 0, 0]);
  assert.deepEqual(parseSemver('not-a-version'), [0, 0, 0]);
  assert.deepEqual(parseSemver('1.0.0'), [1, 0, 0]);
  assert.deepEqual(parseSemver('  2.5.10  '), [2, 5, 10]);
});

t('compareSemver orders correctly', () => {
  assert.ok(compareSemver('0.0.0', '1.0.0') < 0);
  assert.ok(compareSemver('1.0.0', '1.0.0') === 0);
  assert.ok(compareSemver('1.1.0', '1.0.5') > 0);
  /* major beats minor beats patch */
  assert.ok(compareSemver('2.0.0', '1.99.99') > 0);
});

/* 3 */
t('buildSchemaEnvelope has version only (deterministic — no generatedAt)', () => {
  /* Wave U-1 P0-2 (audit U-2 #21) — `generatedAt` removed from the
     envelope so the parser output is byte-stable across runs. Audit
     timestamps live in sidecar logs (e.g. migration runner), not in
     the model itself. */
  const env = buildSchemaEnvelope();
  assert.equal(env.version, MODEL_SCHEMA_VERSION);
  assert.equal(env.generatedAt, undefined, 'envelope must not stamp generatedAt');
  /* Two consecutive calls must be deep-equal — that's the whole point
     of dropping the timestamp. */
  assert.deepEqual(buildSchemaEnvelope(), buildSchemaEnvelope());
});

/* 4 */
t('readModelVersion handles missing / malformed / valid', () => {
  assert.equal(readModelVersion(null), '0.0.0');
  assert.equal(readModelVersion({}), '0.0.0');
  assert.equal(readModelVersion({ __schema__: null }), '0.0.0');
  assert.equal(readModelVersion({ __schema__: { version: 123 } }), '0.0.0');
  assert.equal(readModelVersion({ __schema__: { version: 'not-semver' } }), '0.0.0');
  assert.equal(readModelVersion({ __schema__: { version: '1.0.0' } }), '1.0.0');
  assert.equal(readModelVersion({ __schema__: { version: '  1.2.3  ' } }), '1.2.3');
});

/* 5 */
t('parseGDD stamps __schema__ on its output (smoke / null input path)', () => {
  /* null input → freshModel() with _failures recorded */
  const m = parseGDD(null);
  assert.ok(m.__schema__, '__schema__ missing on null-input model');
  assert.equal(m.__schema__.version, MODEL_SCHEMA_VERSION);
});

/* 6 */
t('parseGDD on real markdown stamps current version', () => {
  const md = `# Test Slot

## Topology
| Reels | 5 |
| Rows  | 3 |
| Paylines | 10 |
`;
  const m = parseGDD(md, 'md');
  assert.ok(m.__schema__, '__schema__ missing on parsed markdown');
  assert.equal(m.__schema__.version, MODEL_SCHEMA_VERSION);
  /* topology is still parsed; the stamp didn't break anything */
  assert.equal(m.topology.reels, 5);
});

/* 7 */
t('migrate() on legacy (no-envelope) model stamps current version', () => {
  const legacy = { name: 'Old Slot', topology: { reels: 5, rows: 3 } };
  const next = migrate(legacy);
  assert.equal(next.__schema__.version, MODEL_SCHEMA_VERSION);
  /* Existing fields preserved */
  assert.equal(next.name, 'Old Slot');
  assert.equal(next.topology.reels, 5);
});

/* 8 */
t('migrate() is idempotent (twice = once)', () => {
  const legacy = { name: 'Idempotent', topology: { reels: 5 } };
  const once = migrate(legacy);
  const twice = migrate(once);
  assert.equal(twice.__schema__.version, once.__schema__.version);
  /* Critical: re-running on already-stamped model is a no-op chain
     (planMigration returns []) so the SAME object is returned. */
  assert.strictEqual(twice, once);
});

/* 9 */
t('migrate() does not mutate the input object', () => {
  const legacy = { name: 'No Mutate', topology: { reels: 5 } };
  const snapshot = JSON.stringify(legacy);
  migrate(legacy);
  assert.equal(JSON.stringify(legacy), snapshot);
  assert.ok(!legacy.__schema__, 'input was mutated');
});

/* 10 */
t('planMigration throws on downgrade attempts', () => {
  assert.throws(() => planMigration('1.0.0', '0.0.0'), /downgrade/);
});

/* 11 */
t('planMigration returns [] for same-version', () => {
  assert.deepEqual(planMigration('1.0.0', '1.0.0'), []);
});

/* 12 */
t('CLI: --list prints registry; --version reads file; round-trip OK', () => {
  const here = new URL('.', import.meta.url).pathname;
  const bin = join(here, '..', 'tools', 'migrate-model.mjs');
  /* --list */
  const listed = execSync(`node ${bin} --list`, { encoding: 'utf8' });
  assert.ok(listed.includes('0.0.0->1.0.0'), '--list missing registered step');

  /* round-trip */
  const dir = mkdtempSync(join(tmpdir(), 'modelmig-'));
  const inFile = join(dir, 'legacy.json');
  const outFile = join(dir, 'migrated.json');
  writeFileSync(inFile, JSON.stringify({ name: 'CLI Test', topology: { reels: 5 } }));

  /* --version on legacy file → 0.0.0 */
  const verLegacy = execSync(`node ${bin} --version ${inFile}`, { encoding: 'utf8' }).trim();
  assert.equal(verLegacy, '0.0.0');

  /* Migrate to out file */
  execSync(`node ${bin} --in ${inFile} --out ${outFile} --quiet`);
  const migrated = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.equal(migrated.__schema__.version, MODEL_SCHEMA_VERSION);
  assert.equal(migrated.name, 'CLI Test');

  /* --version on migrated file → current */
  const verNew = execSync(`node ${bin} --version ${outFile}`, { encoding: 'utf8' }).trim();
  assert.equal(verNew, MODEL_SCHEMA_VERSION);

  /* Re-run on already-current file → exits 0, no rewrite */
  execSync(`node ${bin} --in ${outFile} --quiet`);

  /* Registry list non-empty */
  assert.ok(listMigrations().length >= 1);

  rmSync(dir, { recursive: true, force: true });
});

/* ─── UQ-U-2 atom #11 (pre-release semver) ─────────────────────────── */
t('compareSemver: pre-release ordering per SemVer 2.0 §11', () => {
  /* Any pre-release < the release without pre-release */
  assert.ok(compareSemver('1.0.0-rc1', '1.0.0') < 0);
  assert.ok(compareSemver('1.0.0', '1.0.0-rc1') > 0);
  /* Numeric identifier ordering inside pre-release */
  assert.ok(compareSemver('1.0.0-rc1', '1.0.0-rc2') < 0);
  /* Alphabetic identifier ordering */
  assert.ok(compareSemver('1.0.0-alpha', '1.0.0-beta') < 0);
  /* Same pre-release equal */
  assert.equal(compareSemver('1.0.0-rc1', '1.0.0-rc1'), 0);
  /* Build metadata ignored per §10 */
  assert.equal(compareSemver('1.0.0+build1', '1.0.0+build2'), 0);
});

t('parseSemver strict mode throws on garbage', () => {
  /* Default (non-strict) returns [0,0,0] for back-compat */
  assert.deepEqual(parseSemver('not-a-version'), [0, 0, 0]);
  /* Strict mode throws */
  assert.throws(() => parseSemver('not-a-version', { strict: true }), /not a valid semver/);
  assert.throws(() => parseSemver('1.2', { strict: true }), /not a valid semver/);
  /* Valid + strict returns triple */
  assert.deepEqual(parseSemver('2.3.4', { strict: true }), [2, 3, 4]);
  /* Pre-release also valid in strict (suffix dropped from tuple) */
  assert.deepEqual(parseSemver('1.0.0-rc1', { strict: true }), [1, 0, 0]);
});

/* ─── UQ-U-2 atom #10 (BFS planner) ─────────────────────────────────── */
t('planMigration BFS finds shortest path through multi-hop chain', () => {
  _resetRegistryForTests();
  register('1.0.0', '1.1.0', (m) => ({ ...m, __schema__: { version: '1.1.0' } }));
  register('1.1.0', '1.2.0', (m) => ({ ...m, __schema__: { version: '1.2.0' } }));
  const chain = planMigration('1.0.0', '1.2.0');
  assert.deepEqual(chain, ['1.0.0->1.1.0', '1.1.0->1.2.0']);
}, _resetRegistryForTests);

/* ─── UQ-U-3 atom #10: planMigration cycle / no-path detection ──────── */
t('planMigration throws clearly when no path exists', () => {
  _resetRegistryForTests();
  /* Registry has 0.0.0->1.0.0 only; target 5.0.0 is unreachable. */
  assert.throws(
    () => planMigration('0.0.0', '5.0.0'),
    /no path|visited/,
  );
}, _resetRegistryForTests);

t('migrate detects fn that returns wrong __schema__.version', () => {
  _resetRegistryForTests();
  /* Register a deliberately broken migration that "claims" 1.0.0->1.1.0
     but stamps the wrong version. UQ-U-3 atom #5 must catch this. */
  register('1.0.0', '1.1.0', (m) => ({ ...m, __schema__: { version: '0.9.0' } }));
  const legacy = { name: 'X', __schema__: { version: '1.0.0' } };
  assert.throws(
    () => migrate(legacy, '1.1.0'),
    /produced model\.__schema__\.version=0\.9\.0, expected 1\.1\.0/,
  );
}, _resetRegistryForTests);

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
