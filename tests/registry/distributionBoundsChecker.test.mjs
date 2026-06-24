/**
 * tests/registry/distributionBoundsChecker.test.mjs
 *
 * UQ-DEEP-AN · AN-5 · Distribution bounds checker (Pearson χ²) tests.
 *
 * Covers ≥ 20 cases:
 *   1. SCHEMA_VERSION === '1'
 *   2. uniform input → ok=true, pearsonChi2 ≈ 0, p-value high
 *   3. [100,1,1,1] → ok=true, warning DOMINANT
 *   4. [1000,1,1,1] → ok=false, error DEGENERATE_SINGLE_SYMBOL
 *   5. empty array → error EMPTY_DISTRIBUTION
 *   6. all-zero array → error DEGENERATE_DISTRIBUTION_SUM_ZERO
 *   7. negative weight → error NEGATIVE_WEIGHT
 *   8. entropy bounded in [0, log2(n)]
 *   9. pearsonChi2 ≥ 0
 *  10. pearsonPValue ∈ [0, 1]
 *  11. validateDistributionByClass returns 5 class buckets
 *  12. wild ratio > 0.05 → bucket.ok=false
 *  13. scatter ratio > 0.02 → bucket.ok=false
 *  14. Industry-typical 5×3 distribution → buckets healthy
 *  15. Output frozen
 *  16. schemaVersion stamped on both validators
 *  17. Empty symbolWeights → all classes return ratio=0
 *  18. Single-symbol input → degenerate detected
 *  19. 100-symbol input → numeric stability (no NaN/Infinity)
 *  20. Pearson χ² is computed (not 0 for non-uniform)
 *
 *  Extras (defensive coverage):
 *  21. Non-array input → INVALID_INPUT_NOT_ARRAY
 *  22. NaN element → NON_FINITE_WEIGHT error
 *  23. Strongly biased distribution → STRONGLY_BIASED_DISTRIBUTION warning
 *  24. Multiple wild symbols summed into single ratio
 *  25. Class buckets contain warnings array
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SCHEMA_VERSION,
  validateDistribution,
  validateDistributionByClass,
} from '../../src/registry/distributionBoundsChecker.mjs';

/* ── 1. Schema version ─────────────────────────────────────────────── */
test('UQ-DEEP-AN · #1 · SCHEMA_VERSION === "1"', () => {
  assert.equal(SCHEMA_VERSION, '1');
});

/* ── 2. Uniform input is healthy ───────────────────────────────────── */
test('UQ-DEEP-AN · #2 · uniform [1,1,1,1] → ok, chi2 ≈ 0, p ≈ 1', () => {
  const r = validateDistribution([1, 1, 1, 1]);
  assert.equal(r.ok, true, 'uniform passes');
  assert.equal(r.errors.length, 0);
  assert.ok(r.stats.pearsonChi2 < 1e-9, `chi2≈0 got ${r.stats.pearsonChi2}`);
  assert.ok(r.stats.pearsonPValue > 0.99, `p≈1 got ${r.stats.pearsonPValue}`);
  assert.equal(r.stats.n, 4);
  assert.equal(r.stats.sum, 4);
  assert.equal(r.stats.maxRatio, 0.25);
});

/* ── 3. Heavy-but-allowed skew → warning, not error ─────────────────── */
test('UQ-DEEP-AN · #3 · [100,1,1,1] → ok=true, warning DOMINANT_SYMBOL', () => {
  const r = validateDistribution([100, 1, 1, 1]);
  assert.equal(r.ok, true, 'still ok (97% < 99%)');
  const warns = r.warnings.join('|');
  assert.match(warns, /DOMINANT_SYMBOL/, `expect DOMINANT_SYMBOL warning got: ${warns}`);
});

/* ── 4. Truly degenerate → error ───────────────────────────────────── */
test('UQ-DEEP-AN · #4 · [10000,1,1,1] → ok=false, error DEGENERATE_SINGLE_SYMBOL', () => {
  const r = validateDistribution([10000, 1, 1, 1]);
  assert.equal(r.ok, false);
  const errs = r.errors.join('|');
  assert.match(errs, /DEGENERATE_SINGLE_SYMBOL/, `got: ${errs}`);
});

/* ── 5. Empty array → error ─────────────────────────────────────────── */
test('UQ-DEEP-AN · #5 · empty array → error EMPTY_DISTRIBUTION', () => {
  const r = validateDistribution([]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('EMPTY_DISTRIBUTION'));
});

/* ── 6. All zeros → degenerate sum ─────────────────────────────────── */
test('UQ-DEEP-AN · #6 · [0,0,0] → error DEGENERATE_DISTRIBUTION_SUM_ZERO', () => {
  const r = validateDistribution([0, 0, 0]);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.includes('DEGENERATE_DISTRIBUTION_SUM_ZERO'),
    `errors: ${r.errors.join('|')}`
  );
});

/* ── 7. Negative weight rejected ───────────────────────────────────── */
test('UQ-DEEP-AN · #7 · [-1, 1] → error NEGATIVE_WEIGHT', () => {
  const r = validateDistribution([-1, 1]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('NEGATIVE_WEIGHT'), `errors: ${r.errors.join('|')}`);
});

/* ── 8. Entropy bounded [0, log2(n)] ───────────────────────────────── */
test('UQ-DEEP-AN · #8 · stats.entropy bounded in [0, log2(n)]', () => {
  const r = validateDistribution([1, 2, 3, 4, 5]);
  const maxH = Math.log2(5);
  assert.ok(r.stats.entropy >= 0, `entropy ≥ 0: ${r.stats.entropy}`);
  assert.ok(r.stats.entropy <= maxH + 1e-12, `entropy ≤ log2(5): ${r.stats.entropy}`);
});

/* ── 9. Chi-square non-negative ────────────────────────────────────── */
test('UQ-DEEP-AN · #9 · stats.pearsonChi2 ≥ 0 across many inputs', () => {
  const inputs = [[1, 1, 1], [1, 2, 3, 4], [10, 1, 1, 1, 1], [5, 5, 5, 5, 5, 5]];
  for (const w of inputs) {
    const r = validateDistribution(w);
    assert.ok(r.stats.pearsonChi2 >= 0, `chi2 ≥ 0 for ${JSON.stringify(w)}`);
  }
});

/* ── 10. P-value in [0, 1] ─────────────────────────────────────────── */
test('UQ-DEEP-AN · #10 · stats.pearsonPValue ∈ [0, 1]', () => {
  const inputs = [
    [1, 1, 1, 1],
    [100, 1, 1, 1],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [50, 50, 1],
  ];
  for (const w of inputs) {
    const r = validateDistribution(w);
    assert.ok(
      r.stats.pearsonPValue >= 0 && r.stats.pearsonPValue <= 1,
      `p ∈ [0,1] for ${JSON.stringify(w)}: got ${r.stats.pearsonPValue}`
    );
  }
});

/* ── 11. Class report shape ────────────────────────────────────────── */
test('UQ-DEEP-AN · #11 · validateDistributionByClass returns 5 class buckets', () => {
  const r = validateDistributionByClass([
    { id: 'H1', kind: 'high', weight: 5 },
    { id: 'M1', kind: 'mid', weight: 10 },
    { id: 'L1', kind: 'low', weight: 20 },
    { id: 'W', kind: 'wild', weight: 3 },
    { id: 'S', kind: 'scatter', weight: 1 },
  ]);
  for (const cls of ['high', 'mid', 'low', 'wild', 'scatter']) {
    assert.ok(cls in r, `bucket ${cls} present`);
  }
});

/* ── 12. Wild over budget ──────────────────────────────────────────── */
test('UQ-DEEP-AN · #12 · wild ratio > 0.05 → bucket.ok=false', () => {
  /* Total weight = 100. Wild = 10 → ratio 0.10 (over 0.05 budget). */
  const r = validateDistributionByClass([
    { id: 'A', kind: 'low', weight: 30 },
    { id: 'B', kind: 'low', weight: 30 },
    { id: 'C', kind: 'mid', weight: 20 },
    { id: 'D', kind: 'high', weight: 10 },
    { id: 'W', kind: 'wild', weight: 10 },
  ]);
  assert.equal(r.wild.ok, false, `wild bucket should fail, got ${JSON.stringify(r.wild)}`);
  assert.ok(r.wild.warnings.some((w) => /WILD_RATIO_EXCEEDS_BUDGET/.test(w)));
});

/* ── 13. Scatter over budget ───────────────────────────────────────── */
test('UQ-DEEP-AN · #13 · scatter ratio > 0.02 → bucket.ok=false', () => {
  /* Total weight = 100. Scatter = 5 → ratio 0.05 (over 0.02 budget). */
  const r = validateDistributionByClass([
    { id: 'A', kind: 'low', weight: 40 },
    { id: 'B', kind: 'mid', weight: 30 },
    { id: 'C', kind: 'high', weight: 25 },
    { id: 'S', kind: 'scatter', weight: 5 },
  ]);
  assert.equal(r.scatter.ok, false, `scatter bucket should fail, got ${JSON.stringify(r.scatter)}`);
  assert.ok(r.scatter.warnings.some((w) => /SCATTER_RATIO_EXCEEDS_BUDGET/.test(w)));
});

/* ── 14. Industry-typical distribution → all healthy ───────────────── */
test('UQ-DEEP-AN · #14 · industry-typical 5×3 paytable → all buckets ok', () => {
  /* 4 high (5% each), 4 mid (10% each), 2 low (15% each), 1 wild (4%), 1 scatter (1%).
   * Total = 4*5 + 4*10 + 2*15 + 4 + 1 = 20 + 40 + 30 + 5 = 95. */
  const r = validateDistributionByClass([
    { id: 'H1', kind: 'high', weight: 5 },
    { id: 'H2', kind: 'high', weight: 5 },
    { id: 'H3', kind: 'high', weight: 5 },
    { id: 'H4', kind: 'high', weight: 5 },
    { id: 'M1', kind: 'mid', weight: 10 },
    { id: 'M2', kind: 'mid', weight: 10 },
    { id: 'M3', kind: 'mid', weight: 10 },
    { id: 'M4', kind: 'mid', weight: 10 },
    { id: 'L1', kind: 'low', weight: 15 },
    { id: 'L2', kind: 'low', weight: 15 },
    { id: 'W', kind: 'wild', weight: 4 },
    { id: 'S', kind: 'scatter', weight: 1 },
  ]);
  assert.equal(r.high.ok, true, `high ok, got ${JSON.stringify(r.high)}`);
  assert.equal(r.mid.ok, true, `mid ok, got ${JSON.stringify(r.mid)}`);
  assert.equal(r.low.ok, true, `low ok, got ${JSON.stringify(r.low)}`);
  assert.equal(r.wild.ok, true, `wild ok, got ${JSON.stringify(r.wild)}`);
  assert.equal(r.scatter.ok, true, `scatter ok, got ${JSON.stringify(r.scatter)}`);
});

/* ── 15. Output frozen ─────────────────────────────────────────────── */
test('UQ-DEEP-AN · #15 · output reports are frozen (immutable)', () => {
  const r = validateDistribution([1, 2, 3, 4]);
  assert.ok(Object.isFrozen(r), 'top-level report frozen');
  assert.ok(Object.isFrozen(r.stats), 'stats sub-object frozen');
  assert.ok(Object.isFrozen(r.warnings), 'warnings array frozen');
  assert.ok(Object.isFrozen(r.errors), 'errors array frozen');
  assert.throws(() => {
    r.ok = !r.ok;
  }, /./);

  const c = validateDistributionByClass([{ id: 'A', kind: 'high', weight: 1 }]);
  assert.ok(Object.isFrozen(c), 'class report frozen');
  assert.ok(Object.isFrozen(c.high), 'high bucket frozen');
});

/* ── 16. schemaVersion stamped ─────────────────────────────────────── */
test('UQ-DEEP-AN · #16 · schemaVersion stamped on both validator outputs', () => {
  assert.equal(validateDistribution([1, 1, 1]).schemaVersion, '1');
  assert.equal(validateDistribution([]).schemaVersion, '1');
  assert.equal(validateDistributionByClass([]).schemaVersion, '1');
  assert.equal(
    validateDistributionByClass([{ id: 'A', kind: 'high', weight: 1 }]).schemaVersion,
    '1'
  );
});

/* ── 17. Empty class input → ratio=0 everywhere ────────────────────── */
test('UQ-DEEP-AN · #17 · empty symbolWeights → all class ratios 0', () => {
  const r = validateDistributionByClass([]);
  assert.equal(r.high.meanRatio, 0);
  assert.equal(r.mid.meanRatio, 0);
  assert.equal(r.low.meanRatio, 0);
  assert.equal(r.wild.ratio, 0);
  assert.equal(r.scatter.ratio, 0);
  for (const cls of ['high', 'mid', 'low', 'wild', 'scatter']) {
    assert.equal(r[cls].ok, true, `${cls} ok when empty`);
  }
});

/* ── 18. Single symbol → degenerate ────────────────────────────────── */
test('UQ-DEEP-AN · #18 · single-symbol input → degenerate detected', () => {
  const r = validateDistribution([42]);
  /* n=1, maxRatio=1.0 → triggers DEGENERATE_SINGLE_SYMBOL. */
  assert.equal(r.ok, false);
  const errs = r.errors.join('|');
  assert.match(errs, /DEGENERATE_SINGLE_SYMBOL/, `got: ${errs}`);
  assert.equal(r.stats.maxRatio, 1);
});

/* ── 19. 100-symbol input → numeric stability ──────────────────────── */
test('UQ-DEEP-AN · #19 · 100-symbol input → no NaN/Infinity in stats', () => {
  const w = [];
  for (let i = 1; i <= 100; i++) w.push(i);
  const r = validateDistribution(w);
  assert.ok(Number.isFinite(r.stats.pearsonChi2), `chi2 finite: ${r.stats.pearsonChi2}`);
  assert.ok(Number.isFinite(r.stats.entropy), `entropy finite: ${r.stats.entropy}`);
  assert.ok(Number.isFinite(r.stats.pearsonPValue), `p finite: ${r.stats.pearsonPValue}`);
  assert.ok(r.stats.pearsonPValue >= 0 && r.stats.pearsonPValue <= 1, 'p in [0,1]');
});

/* ── 20. Non-uniform produces non-zero χ² ──────────────────────────── */
test('UQ-DEEP-AN · #20 · Pearson χ² > 0 for non-uniform distribution', () => {
  const r = validateDistribution([1, 2, 3, 4, 5]);
  assert.ok(r.stats.pearsonChi2 > 0, `chi2 > 0 for skewed: ${r.stats.pearsonChi2}`);
  /* Known value: sum=15, expected=3, χ² = (4+1+0+1+4)/3 = 10/3 ≈ 3.333 */
  assert.ok(
    Math.abs(r.stats.pearsonChi2 - 10 / 3) < 1e-9,
    `chi2 ≈ 10/3 for [1..5]: ${r.stats.pearsonChi2}`
  );
});

/* ── 21. Non-array input rejected ──────────────────────────────────── */
test('UQ-DEEP-AN · #21 · non-array input → INVALID_INPUT_NOT_ARRAY', () => {
  for (const bad of [null, undefined, 42, 'abc', {}]) {
    const r = validateDistribution(bad);
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.includes('INVALID_INPUT_NOT_ARRAY'),
      `errors for ${typeof bad}: ${r.errors.join('|')}`
    );
  }
});

/* ── 22. NaN element flagged ───────────────────────────────────────── */
test('UQ-DEEP-AN · #22 · NaN element → NON_FINITE_WEIGHT error', () => {
  const r = validateDistribution([1, NaN, 2]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('NON_FINITE_WEIGHT'), `errors: ${r.errors.join('|')}`);

  const r2 = validateDistribution([1, Infinity, 2]);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.includes('NON_FINITE_WEIGHT'));
});

/* ── 23. Strongly biased distribution → strong warning ─────────────── */
test('UQ-DEEP-AN · #23 · strongly biased distribution → STRONGLY_BIASED_DISTRIBUTION warning', () => {
  /* Very skewed but not single-symbol degenerate. */
  const r = validateDistribution([1000, 100, 50, 10, 5, 1]);
  const warns = r.warnings.join('|');
  assert.match(warns, /STRONGLY_BIASED_DISTRIBUTION|NON_UNIFORM_DISTRIBUTION/, `warns: ${warns}`);
  assert.ok(r.stats.pearsonPValue < 0.05, `p < 0.05: ${r.stats.pearsonPValue}`);
});

/* ── 24. Multiple wild symbols summed ──────────────────────────────── */
test('UQ-DEEP-AN · #24 · multiple wild symbols summed into single ratio', () => {
  /* Total = 100. Two wilds: 3 + 4 = 7 → ratio 0.07 > 0.05 budget → fail. */
  const r = validateDistributionByClass([
    { id: 'A', kind: 'low', weight: 30 },
    { id: 'B', kind: 'mid', weight: 30 },
    { id: 'C', kind: 'high', weight: 33 },
    { id: 'W1', kind: 'wild', weight: 3 },
    { id: 'W2', kind: 'wild', weight: 4 },
  ]);
  assert.ok(
    Math.abs(r.wild.ratio - 0.07) < 1e-9,
    `wild ratio = 0.07: ${r.wild.ratio}`
  );
  assert.equal(r.wild.ok, false);
});

/* ── 25. Class buckets carry warnings array ────────────────────────── */
test('UQ-DEEP-AN · #25 · class buckets contain warnings array (frozen)', () => {
  const r = validateDistributionByClass([{ id: 'A', kind: 'high', weight: 1 }]);
  for (const cls of ['high', 'mid', 'low', 'wild', 'scatter']) {
    assert.ok(Array.isArray(r[cls].warnings), `${cls}.warnings is array`);
    assert.ok(Object.isFrozen(r[cls].warnings), `${cls}.warnings frozen`);
  }
});
