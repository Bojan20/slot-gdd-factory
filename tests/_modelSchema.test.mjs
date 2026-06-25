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
} from '../src/registry/modelMigrations.mjs';
import { parseGDD } from '../src/parser.mjs';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
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
t('buildSchemaEnvelope has version + ISO-8601 generatedAt', () => {
  const env = buildSchemaEnvelope();
  assert.equal(env.version, MODEL_SCHEMA_VERSION);
  assert.match(env.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  /* Must round-trip through Date */
  const d = new Date(env.generatedAt);
  assert.ok(!Number.isNaN(d.getTime()));
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

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
