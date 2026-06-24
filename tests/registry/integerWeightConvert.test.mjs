/**
 * tests/registry/integerWeightConvert.test.mjs
 *
 * UQ-DEEP-AL · FIX-C · per-element integer-weight conversion test suite.
 *
 * Covers ≥ 15 cases:
 *   1. convertToServerValuesPerElement returns {values, scales, schemaVersion}
 *   2. [33.33, 0.5] → values=[3333, 5], scales=[100, 10] (IGT canonical)
 *   3. [0.1, 0.2, 0.3] → values=[1, 2, 3], scales=[10, 10, 10]
 *   4. [1e-7, 1e-6, 1e-5] → values=[1, 1, 1], scales=[1e7, 1e6, 1e5]
 *   5. [42, 3.14, 0.0001] → per-element scales
 *   6. restoreFloatsFromServerValuesPerElement round-trip exact
 *   7. Empty array → empty result + schemaVersion present
 *   8. Single element → values=[N], scales=[10^k]
 *   9. Mixed integer + float → integer scale = 1
 *  10. Negative numbers handled
 *  11. Old convertToServerValues still works (back-compat)
 *  12. Old function emits @deprecated marker in JSDoc
 *  13. IGT-bug-compat getDecimalsCountForNumberIgtCompat(1e-7) === 0
 *  14. Standard getDecimalsCountForNumber(1e-7) === 7
 *  15. schemaVersion stamped on all new outputs
 *
 *  Extras (defensive coverage):
 *  16. Non-finite element (NaN/Infinity) coerced to 0 with scale=1
 *  17. restoreFloatsFromServerValuesPerElement defensive on missing scales
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  convertToServerValuesPerElement,
  restoreFloatsFromServerValuesPerElement,
  getDecimalsCountForNumberIgtCompat,
  getDecimalsCountForNumber,
  convertToServerValues,
  restoreFloatsFromServerValues,
  maxDecimalsInArray,
} from '../../src/registry/integerWeightConvert.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── 1. Shape + schemaVersion ───────────────────────────────────────── */
test('UQ-DEEP-AL · #1 · convertToServerValuesPerElement returns {values, scales, schemaVersion}', () => {
  const r = convertToServerValuesPerElement([0.5, 0.25]);
  assert.ok(Array.isArray(r.values), 'values is array');
  assert.ok(Array.isArray(r.scales), 'scales is array');
  assert.equal(r.schemaVersion, '1', 'schemaVersion stamped');
  assert.equal(r.values.length, r.scales.length, 'parallel arrays');
});

/* ── 2. IGT canonical example ───────────────────────────────────────── */
test('UQ-DEEP-AL · #2 · [33.33, 0.5] → values=[3333, 5], scales=[100, 10]', () => {
  const r = convertToServerValuesPerElement([33.33, 0.5]);
  assert.deepEqual(r.values, [3333, 5], 'per-element integer values');
  assert.deepEqual(r.scales, [100, 10], 'per-element scale factors');
});

/* ── 3. Uniform decimals ────────────────────────────────────────────── */
test('UQ-DEEP-AL · #3 · [0.1, 0.2, 0.3] → values=[1, 2, 3], scales=[10, 10, 10]', () => {
  const r = convertToServerValuesPerElement([0.1, 0.2, 0.3]);
  assert.deepEqual(r.values, [1, 2, 3]);
  assert.deepEqual(r.scales, [10, 10, 10]);
});

/* ── 4. Scientific notation magnitudes ──────────────────────────────── */
test('UQ-DEEP-AL · #4 · [1e-7, 1e-6, 1e-5] → values=[1, 1, 1], scales=[1e7, 1e6, 1e5]', () => {
  const r = convertToServerValuesPerElement([1e-7, 1e-6, 1e-5]);
  assert.deepEqual(r.values, [1, 1, 1], 'each scaled to 1');
  assert.deepEqual(r.scales, [1e7, 1e6, 1e5], 'per-element 10^k scales');
});

/* ── 5. Mixed integer + float + tiny float ──────────────────────────── */
test('UQ-DEEP-AL · #5 · [42, 3.14, 0.0001] → per-element scales', () => {
  const r = convertToServerValuesPerElement([42, 3.14, 0.0001]);
  assert.deepEqual(r.values, [42, 314, 1]);
  assert.deepEqual(r.scales, [1, 100, 10000]);
});

/* ── 6. Round-trip exact ────────────────────────────────────────────── */
test('UQ-DEEP-AL · #6 · round-trip exact for canonical input', () => {
  const orig = [33.33, 0.5, 0.1, 42, 0.0001];
  const r = convertToServerValuesPerElement(orig);
  const back = restoreFloatsFromServerValuesPerElement(r.values, r.scales);
  /* Within IEEE-754 ulp, byte-exact for these magnitudes. */
  for (let i = 0; i < orig.length; i++) {
    assert.ok(Math.abs(back[i] - orig[i]) < 1e-10, `idx ${i}: ${back[i]} ≈ ${orig[i]}`);
  }
});

/* ── 7. Empty array ─────────────────────────────────────────────────── */
test('UQ-DEEP-AL · #7 · empty array → empty result with schemaVersion', () => {
  const r = convertToServerValuesPerElement([]);
  assert.deepEqual(r.values, []);
  assert.deepEqual(r.scales, []);
  assert.equal(r.schemaVersion, '1');
});

/* ── 8. Single element ──────────────────────────────────────────────── */
test('UQ-DEEP-AL · #8 · single element [0.125] → values=[125], scales=[1000]', () => {
  const r = convertToServerValuesPerElement([0.125]);
  assert.deepEqual(r.values, [125]);
  assert.deepEqual(r.scales, [1000]);
  assert.equal(r.schemaVersion, '1');
});

/* ── 9. Mixed integer + float (integer scale = 1) ───────────────────── */
test('UQ-DEEP-AL · #9 · mixed integer + float → integer scale = 1', () => {
  const r = convertToServerValuesPerElement([1, 2.5, 3, 4.75]);
  assert.deepEqual(r.values, [1, 25, 3, 475]);
  assert.deepEqual(r.scales, [1, 10, 1, 100]);
});

/* ── 10. Negatives ──────────────────────────────────────────────────── */
test('UQ-DEEP-AL · #10 · negative numbers handled', () => {
  const r = convertToServerValuesPerElement([-0.5, -33.33, -7]);
  assert.deepEqual(r.values, [-5, -3333, -7]);
  assert.deepEqual(r.scales, [10, 100, 1]);
  const back = restoreFloatsFromServerValuesPerElement(r.values, r.scales);
  assert.deepEqual(back, [-0.5, -33.33, -7]);
});

/* ── 11. Legacy convertToServerValues still works ───────────────────── */
test('UQ-DEEP-AL · #11 · legacy convertToServerValues back-compat preserved', () => {
  const r = convertToServerValues([0.5, 0.25, 0.125]);
  assert.deepEqual(r.values, [500, 250, 125], 'array-wide scaling unchanged');
  assert.equal(r.scale, 1000);
  assert.equal(r.max_decimals, 3);
  /* Legacy inverse still works. */
  const back = restoreFloatsFromServerValues(r);
  assert.deepEqual(back, [0.5, 0.25, 0.125]);
});

/* ── 12. Legacy function carries @deprecated JSDoc marker ───────────── */
test('UQ-DEEP-AL · #12 · legacy convertToServerValues marked @deprecated in source', () => {
  const srcPath = resolve(__dirname, '../../src/registry/integerWeightConvert.mjs');
  const src = readFileSync(srcPath, 'utf8');
  /* Find the block immediately preceding `export function convertToServerValues(`. */
  const idx = src.indexOf('export function convertToServerValues(arr)');
  assert.ok(idx > 0, 'legacy function present');
  const before = src.slice(0, idx);
  /* Walk backward to find the nearest JSDoc opener. */
  const jsdocOpen = before.lastIndexOf('/**');
  assert.ok(jsdocOpen > 0, 'JSDoc block precedes legacy function');
  const jsdocBlock = before.slice(jsdocOpen);
  assert.match(jsdocBlock, /@deprecated/i, 'JSDoc contains @deprecated marker');
  assert.match(
    jsdocBlock,
    /convertToServerValuesPerElement/,
    'JSDoc points callers to per-element variant'
  );
});

/* ── 13. IGT bug-compat decimal counter ─────────────────────────────── */
test('UQ-DEEP-AL · #13 · getDecimalsCountForNumberIgtCompat(1e-7) === 0 (bug-compat)', () => {
  /* JavaScript serializes 1e-7 as "1e-7" — no dot, split('.') returns one
   * segment, IGT counts 0 decimals. This matches their reference impl. */
  assert.equal(getDecimalsCountForNumberIgtCompat(1e-7), 0);
  /* 1e-6 also serializes scientific (string "0.000001" only kicks in ≥ 1e-6
   * in some engines; check actual). */
  const s = (1e-6).toString();
  const expected = s.indexOf('.') < 0 ? 0 : s.length - s.indexOf('.') - 1;
  assert.equal(getDecimalsCountForNumberIgtCompat(1e-6), expected);
  /* Regular decimals work the same in bug-compat mode. */
  assert.equal(getDecimalsCountForNumberIgtCompat(0.5), 1);
  assert.equal(getDecimalsCountForNumberIgtCompat(33.33), 2);
});

/* ── 14. Standard decimal counter (correct mode) ────────────────────── */
test('UQ-DEEP-AL · #14 · getDecimalsCountForNumber(1e-7) === 7 (correct mode)', () => {
  assert.equal(getDecimalsCountForNumber(1e-7), 7);
  assert.equal(getDecimalsCountForNumber(1e-6), 6);
  assert.equal(getDecimalsCountForNumber(0.5), 1);
  assert.equal(getDecimalsCountForNumber(33.33), 2);
  assert.equal(getDecimalsCountForNumber(0), 0);
  assert.equal(getDecimalsCountForNumber(42), 0);
});

/* ── 15. schemaVersion stamped on all new outputs ───────────────────── */
test('UQ-DEEP-AL · #15 · schemaVersion stamped on every per-element output', () => {
  assert.equal(convertToServerValuesPerElement([]).schemaVersion, '1');
  assert.equal(convertToServerValuesPerElement([1]).schemaVersion, '1');
  assert.equal(convertToServerValuesPerElement([0.5, 0.25]).schemaVersion, '1');
  assert.equal(convertToServerValuesPerElement([1e-7]).schemaVersion, '1');
});

/* ── 16. Defensive: non-finite element coerced ──────────────────────── */
test('UQ-DEEP-AL · #16 · non-finite element (NaN/Infinity) coerced to 0/scale=1', () => {
  const r = convertToServerValuesPerElement([NaN, Infinity, 0.5, -Infinity]);
  assert.equal(r.values[0], 0);
  assert.equal(r.scales[0], 1);
  assert.equal(r.values[1], 0);
  assert.equal(r.scales[1], 1);
  assert.equal(r.values[2], 5);
  assert.equal(r.scales[2], 10);
  assert.equal(r.values[3], 0);
  assert.equal(r.scales[3], 1);
});

/* ── 17. Defensive restore: missing scales array ────────────────────── */
test('UQ-DEEP-AL · #17 · restore defensive on missing/short scales', () => {
  /* No scales → treat as scale=1 per element. */
  assert.deepEqual(restoreFloatsFromServerValuesPerElement([100, 200], undefined), [100, 200]);
  /* Short scales → missing elements default to 1. */
  assert.deepEqual(restoreFloatsFromServerValuesPerElement([100, 200], [10]), [10, 200]);
  /* Zero scale → defensive divide by 1. */
  assert.deepEqual(restoreFloatsFromServerValuesPerElement([100], [0]), [100]);
  /* Non-array values → empty. */
  assert.deepEqual(restoreFloatsFromServerValuesPerElement(null, []), []);
});

/* ── 18. maxDecimalsInArray still works (legacy helper) ─────────────── */
test('UQ-DEEP-AL · #18 · maxDecimalsInArray legacy helper preserved', () => {
  assert.equal(maxDecimalsInArray([0.5, 0.25, 0.125]), 3);
  assert.equal(maxDecimalsInArray([1, 2, 3]), 0);
  assert.equal(maxDecimalsInArray([]), 0);
  assert.equal(maxDecimalsInArray([33.33, 0.5]), 2);
});
