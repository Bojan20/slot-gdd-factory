/**
 * src/registry/distributionBoundsChecker.mjs
 *
 * UQ-DEEP-AN · AN-5 · Distribution bounds checker (Pearson χ² weighted
 * distribution sanity).
 *
 * QA-A IGT_FILE_INDEX P0 gap: IGT SymbolWeightService exposes profile
 * switching but ships NO statistical sanity layer — there is no Wilson CI
 * bound, no variance budget, no anti-correlation guard. A degenerate weight
 * table (e.g. one symbol dominates 99% of the strip) is accepted silently
 * by the live engine and produces a "broken" math game in production.
 *
 * This module fills the gap with two pure validators that any consumer
 * (parser, blockMapper, GDD ingest, math compliance gate) can call:
 *
 *   validateDistribution(weights)
 *     - Generic sanity: positive numbers, non-degenerate sum, dominant
 *       symbol guard, Shannon entropy floor, Pearson χ² goodness-of-fit
 *       against a uniform expected distribution (statistical bias detection).
 *
 *   validateDistributionByClass(symbolWeights)
 *     - Per-class variance budget (high/mid/low/wild/scatter) — surfaces
 *       the common mis-bucket where, e.g., wild weight is set as high
 *       as a low symbol (RTP explosion) or scatter is too frequent
 *       (free-spin trigger over-fires).
 *
 * Vendor-neutral implementation. Output frozen + schemaVersion stamped
 * so downstream gates can detect schema drift without runtime sniffing.
 *
 * ── Math notes ─────────────────────────────────────────────────────────
 *
 *   Shannon entropy (bits): H = -Σ p_i * log2(p_i),  p_i = w_i / Σw
 *   Range: [0, log2(n)]. We normalize to a [0, 1] fraction-of-max so the
 *   "low entropy" floor is grid-size independent.
 *
 *   Pearson χ² goodness-of-fit vs uniform:
 *     χ² = Σ (o_i - e_i)² / e_i   where e_i = Σw / n
 *   df = n - 1.
 *
 *   P-value: we use the regularized upper incomplete gamma function
 *     Q(s, x) = Γ(s, x) / Γ(s)
 *   so p = Q(df/2, χ²/2). Implemented via Lanczos for Γ(s) and a
 *   continued-fraction expansion for Γ(s, x) (Numerical Recipes §6.2,
 *   stable for x > s+1). For x < s+1 we use the complementary series
 *   expansion of the lower incomplete gamma. Result is accurate to
 *   ≥ 6 significant digits for the df range we hit in practice
 *   (df ∈ [1, ~256] — slot strips are short, paytables small).
 *
 *   We DO NOT pre-bake a χ² table: that approach loses precision at
 *   non-standard df and silently fails when a future GDD introduces
 *   a symbol count we did not anticipate.
 *
 * ── Public surface ─────────────────────────────────────────────────────
 *
 *   SCHEMA_VERSION                           — '1' (bumped on shape change)
 *   validateDistribution(weights)            — generic sanity + χ²
 *   validateDistributionByClass(symbolWts)   — per-kind variance budget
 */

export const SCHEMA_VERSION = '1';

/* ── Tunable thresholds (frozen) ───────────────────────────────────────
 *
 * These are intentionally conservative. The intent is to FLAG genuine
 * design accidents, not to police every legal-but-skewed strip.
 */
const THRESHOLDS = Object.freeze({
  DOMINANT_RATIO_WARN: 0.95,   /* single symbol > 95% of weight → warn */
  DOMINANT_RATIO_ERROR: 0.99,  /* single symbol > 99% of weight → fail */
  LOW_ENTROPY_FRAC: 0.5,       /* H / log2(n) < 0.5 → warn (concentrated) */
  P_VALUE_WEAK: 0.05,          /* statistically significant non-uniform */
  P_VALUE_STRONG: 0.001,       /* strongly biased — almost certainly designed */

  /* Per-class expected ratio centers + std budget (fraction of mean). */
  CLASS_HIGH_MEAN: 0.05,
  CLASS_HIGH_STD_FRAC: 0.5,
  CLASS_MID_MEAN: 0.10,
  CLASS_MID_STD_FRAC: 0.5,
  CLASS_LOW_MEAN: 0.20,
  CLASS_LOW_STD_FRAC: 0.5,
  CLASS_WILD_MAX_RATIO: 0.05,
  CLASS_SCATTER_MAX_RATIO: 0.02,
});

/* ── Lanczos approximation for Γ(z) ────────────────────────────────────
 *
 * g=7, n=9 coefficients (Spouge form, accurate to ~15 digits across
 * positive reals we care about). We never call this with z ≤ 0 because
 * df/2 ≥ 0.5 for n ≥ 2 and we early-return for n < 2.
 */
const LANCZOS_G = 7;
const LANCZOS_COEFFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function logGamma(z) {
  /* Reflection formula for z < 0.5 — not used in practice but defensive. */
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_COEFFS[0];
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/* ── Regularized upper incomplete gamma Q(s, x) ────────────────────────
 *
 * P(s, x) = γ(s, x) / Γ(s)    (lower)
 * Q(s, x) = Γ(s, x) / Γ(s)    (upper)
 * P + Q = 1
 *
 * For x < s + 1: series expansion of γ(s, x) converges fast.
 * For x ≥ s + 1: Lentz continued fraction for Γ(s, x) converges fast.
 *
 * Both branches return Q (we want a right-tail p-value for χ²).
 */
function regularizedUpperIncompleteGamma(s, x) {
  if (x < 0 || s <= 0) return Number.NaN;
  if (x === 0) return 1;
  if (x < s + 1) {
    /* Series for P, then return 1 - P. */
    const p = gammaSeriesP(s, x);
    return 1 - p;
  }
  return gammaContinuedFractionQ(s, x);
}

function gammaSeriesP(s, x) {
  const MAX_ITER = 200;
  const EPS = 1e-15;
  let ap = s;
  let sum = 1 / s;
  let del = sum;
  for (let i = 0; i < MAX_ITER; i++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) {
      return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
    }
  }
  /* Convergence failure: return best-effort. */
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

function gammaContinuedFractionQ(s, x) {
  /* Modified Lentz's method (Numerical Recipes §5.2). */
  const MAX_ITER = 200;
  const EPS = 1e-15;
  const FPMIN = 1e-300;
  let b = x + 1 - s;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITER; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

/* ── Public: generic distribution validator ────────────────────────────
 *
 * Returns a FROZEN report object. Callers should treat it as read-only.
 */
export function validateDistribution(weights) {
  const errors = [];
  const warnings = [];
  const stats = {
    n: 0,
    sum: 0,
    maxRatio: 0,
    entropy: 0,
    pearsonChi2: 0,
    pearsonPValue: 1,
  };

  if (!Array.isArray(weights)) {
    errors.push('INVALID_INPUT_NOT_ARRAY');
    return freezeReport({ ok: false, warnings, errors, stats });
  }

  if (weights.length === 0) {
    errors.push('EMPTY_DISTRIBUTION');
    return freezeReport({ ok: false, warnings, errors, stats });
  }

  stats.n = weights.length;

  /* Type / sign check + sum accumulation in one pass. */
  let sum = 0;
  let hasNegative = false;
  let hasNonFinite = false;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      hasNonFinite = true;
      continue;
    }
    if (w < 0) {
      hasNegative = true;
      continue;
    }
    sum += w;
  }
  if (hasNonFinite) errors.push('NON_FINITE_WEIGHT');
  if (hasNegative) errors.push('NEGATIVE_WEIGHT');

  stats.sum = sum;

  if (sum <= 0) {
    errors.push('DEGENERATE_DISTRIBUTION_SUM_ZERO');
    return freezeReport({ ok: false, warnings, errors, stats });
  }

  /* Compute max ratio + Shannon entropy in one pass. */
  let maxRatio = 0;
  let maxIdx = -1;
  let entropy = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) continue;
    const p = w / sum;
    if (p > maxRatio) {
      maxRatio = p;
      maxIdx = i;
    }
    if (p > 0) entropy += -p * Math.log2(p);
  }
  stats.maxRatio = maxRatio;
  stats.entropy = entropy;

  /* Dominant-symbol guard. */
  if (maxRatio > THRESHOLDS.DOMINANT_RATIO_ERROR) {
    errors.push(`DEGENERATE_SINGLE_SYMBOL:idx=${maxIdx}:ratio=${maxRatio.toFixed(4)}`);
  } else if (maxRatio > THRESHOLDS.DOMINANT_RATIO_WARN) {
    warnings.push(`DOMINANT_SYMBOL:idx=${maxIdx}:ratio=${maxRatio.toFixed(4)}`);
  }

  /* Entropy floor (normalized to [0,1] so it is grid-size independent). */
  const maxEntropy = stats.n > 1 ? Math.log2(stats.n) : 1;
  const entropyFrac = entropy / maxEntropy;
  if (stats.n > 1 && entropyFrac < THRESHOLDS.LOW_ENTROPY_FRAC) {
    warnings.push(`LOW_ENTROPY_DISTRIBUTION:frac=${entropyFrac.toFixed(4)}`);
  }

  /* Pearson χ² vs uniform expected. */
  const expected = sum / stats.n;
  let chi2 = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) continue;
    const diff = w - expected;
    chi2 += (diff * diff) / expected;
  }
  stats.pearsonChi2 = chi2;

  /* P-value via regularized upper incomplete gamma. df = n - 1. */
  if (stats.n > 1) {
    const df = stats.n - 1;
    const p = regularizedUpperIncompleteGamma(df / 2, chi2 / 2);
    /* Defensive clamp into [0, 1]. */
    stats.pearsonPValue = Math.min(1, Math.max(0, p));
  } else {
    stats.pearsonPValue = 1;
  }

  if (stats.pearsonPValue < THRESHOLDS.P_VALUE_STRONG) {
    warnings.push(`STRONGLY_BIASED_DISTRIBUTION:p=${stats.pearsonPValue.toExponential(2)}`);
  } else if (stats.pearsonPValue < THRESHOLDS.P_VALUE_WEAK) {
    warnings.push(`NON_UNIFORM_DISTRIBUTION:p=${stats.pearsonPValue.toFixed(4)}`);
  }

  const ok = errors.length === 0;
  return freezeReport({ ok, warnings, errors, stats });
}

/* ── Public: per-class variance budget ─────────────────────────────────
 *
 * Input shape: array of { id, kind, weight }
 *   kind ∈ { 'high', 'mid', 'low', 'wild', 'scatter', ... }
 * Unknown kinds are ignored (so e.g. 'bonus' or vendor-specific kinds
 * don't break the budget).
 *
 * Output: per-class buckets with mean/std ratio and an `ok` flag.
 * wild/scatter buckets carry a single `ratio` (not mean) — they are
 * conventionally one symbol per paytable.
 */
export function validateDistributionByClass(symbolWeights) {
  const buckets = {
    high: { meanRatio: 0, stdRatio: 0, ok: true, warnings: [] },
    mid: { meanRatio: 0, stdRatio: 0, ok: true, warnings: [] },
    low: { meanRatio: 0, stdRatio: 0, ok: true, warnings: [] },
    wild: { ratio: 0, ok: true, warnings: [] },
    scatter: { ratio: 0, ok: true, warnings: [] },
  };

  if (!Array.isArray(symbolWeights) || symbolWeights.length === 0) {
    return freezeClassReport(buckets);
  }

  /* Compute total weight across ALL kinds (denominator for ratios). */
  let total = 0;
  for (const s of symbolWeights) {
    if (!s || typeof s.weight !== 'number' || !Number.isFinite(s.weight) || s.weight < 0) continue;
    total += s.weight;
  }
  if (total <= 0) {
    return freezeClassReport(buckets);
  }

  /* Group ratios per class. */
  const groups = { high: [], mid: [], low: [], wild: [], scatter: [] };
  for (const s of symbolWeights) {
    if (!s || typeof s.weight !== 'number' || !Number.isFinite(s.weight) || s.weight < 0) continue;
    if (!Object.prototype.hasOwnProperty.call(groups, s.kind)) continue;
    groups[s.kind].push(s.weight / total);
  }

  /* high/mid/low: mean + std + budget check. */
  for (const cls of ['high', 'mid', 'low']) {
    const arr = groups[cls];
    if (arr.length === 0) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    let variance = 0;
    for (const r of arr) variance += (r - mean) * (r - mean);
    variance = arr.length > 1 ? variance / arr.length : 0;
    const std = Math.sqrt(variance);
    buckets[cls].meanRatio = mean;
    buckets[cls].stdRatio = std;
    const meanTarget = THRESHOLDS[`CLASS_${cls.toUpperCase()}_MEAN`];
    const stdBudget = mean * THRESHOLDS[`CLASS_${cls.toUpperCase()}_STD_FRAC`];
    if (std > stdBudget && stdBudget > 0) {
      buckets[cls].ok = false;
      buckets[cls].warnings.push(
        `CLASS_${cls.toUpperCase()}_VARIANCE_EXCEEDS_BUDGET:std=${std.toFixed(4)}:budget=${stdBudget.toFixed(4)}`
      );
    }
    /* Mean too far from target → also warn (but don't flip ok unless gross). */
    if (mean > meanTarget * 3 || mean < meanTarget / 3) {
      buckets[cls].warnings.push(
        `CLASS_${cls.toUpperCase()}_MEAN_OUTSIDE_BAND:mean=${mean.toFixed(4)}:target=${meanTarget}`
      );
    }
  }

  /* wild: single ratio. If multiple wild symbols, sum them. */
  if (groups.wild.length > 0) {
    const ratio = groups.wild.reduce((a, b) => a + b, 0);
    buckets.wild.ratio = ratio;
    if (ratio > THRESHOLDS.CLASS_WILD_MAX_RATIO) {
      buckets.wild.ok = false;
      buckets.wild.warnings.push(
        `WILD_RATIO_EXCEEDS_BUDGET:ratio=${ratio.toFixed(4)}:max=${THRESHOLDS.CLASS_WILD_MAX_RATIO}`
      );
    }
  }

  /* scatter: single ratio. If multiple scatters (rare), sum them. */
  if (groups.scatter.length > 0) {
    const ratio = groups.scatter.reduce((a, b) => a + b, 0);
    buckets.scatter.ratio = ratio;
    if (ratio > THRESHOLDS.CLASS_SCATTER_MAX_RATIO) {
      buckets.scatter.ok = false;
      buckets.scatter.warnings.push(
        `SCATTER_RATIO_EXCEEDS_BUDGET:ratio=${ratio.toFixed(4)}:max=${THRESHOLDS.CLASS_SCATTER_MAX_RATIO}`
      );
    }
  }

  return freezeClassReport(buckets);
}

/* ── Helpers ───────────────────────────────────────────────────────────
 *
 * freeze the nested stats object too so consumers can't mutate fields
 * (caught me once: a downstream gate overwrote stats.pearsonPValue and
 * regression-failed silently three commits later).
 */
function freezeReport(r) {
  r.stats = Object.freeze(r.stats);
  r.warnings = Object.freeze(r.warnings);
  r.errors = Object.freeze(r.errors);
  r.schemaVersion = SCHEMA_VERSION;
  return Object.freeze(r);
}

function freezeClassReport(buckets) {
  for (const k of Object.keys(buckets)) {
    buckets[k].warnings = Object.freeze(buckets[k].warnings);
    buckets[k] = Object.freeze(buckets[k]);
  }
  buckets.schemaVersion = SCHEMA_VERSION;
  return Object.freeze(buckets);
}
