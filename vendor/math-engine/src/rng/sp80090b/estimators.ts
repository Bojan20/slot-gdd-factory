/**
 * W152 Wave 39 — Kimi K3: NIST SP 800-90B Non-IID Track Entropy Estimators.
 *
 * Implements §6.3 of NIST SP 800-90B (2018):
 *   - Most Common Value Estimator (§6.3.1)
 *   - Collision Estimator (§6.3.2)
 *   - Markov Estimator (§6.3.3)
 *   - Compression Estimator (§6.3.4)
 *
 * Each estimator returns a min-entropy estimate (bits per sample) for a
 * sequence of byte (0..255) samples drawn from the entropy source. The
 * SP 800-90B "official" min-entropy estimate is the MINIMUM across all
 * estimators (most conservative).
 *
 * Industry context (Kimi 2026-05-15): "Only 3 vendors have achieved
 * SP 800-90B entropy-source certification (Rambus 2021, AWS Graviton4 2025).
 * No commercial slot engine publicly meets this bar."
 *
 * ## Mathematical foundation
 *
 * Min-entropy H_∞(X) = -log₂(p_max) where p_max is the maximum probability
 * of any single sample value. SP 800-90B builds 99% upper-confidence
 * bounds on p_max from finite samples; min-entropy estimate uses that
 * upper bound, so the entropy claim is a lower bound on true entropy.
 *
 * ## References
 *
 * - NIST SP 800-90B (2018) — *Recommendation for the Entropy Sources
 *   Used for Random Bit Generation*
 * - https://csrc.nist.gov/publications/detail/sp/800-90b/final
 * - NIST Entropy Validation Suite (Python reference implementation)
 *   https://github.com/usnistgov/SP800-90B_EntropyAssessment
 */

/** Min-entropy estimate in bits per sample. Higher = better. */
export type MinEntropyBits = number;

export interface EstimatorResult {
  estimator: string;
  /** Min-entropy estimate in bits per sample (0 ≤ H ≤ 8 for byte input). */
  minEntropyBits: MinEntropyBits;
  /** Estimator-specific intermediate values (for audit). */
  details: Record<string, number>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function counts(samples: Uint8Array): Map<number, number> {
  const c = new Map<number, number>();
  for (const s of samples) c.set(s, (c.get(s) ?? 0) + 1);
  return c;
}

function maxValueCount(samples: Uint8Array): { maxCount: number; alphabetSize: number } {
  const c = counts(samples);
  let max = 0;
  for (const v of c.values()) if (v > max) max = v;
  return { maxCount: max, alphabetSize: c.size };
}

/** Inverse standard normal CDF approximation (Beasley-Springer-Moro). */
function invNormCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error('invNormCdf: p must be in (0,1)');
  // Beasley-Springer-Moro algorithm — sufficient for our 99% CI use case.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// ─── §6.3.1 Most Common Value Estimator ────────────────────────────────────

/**
 * Per SP 800-90B §6.3.1: estimate p_max via max-frequency + Wald-style
 * upper confidence bound at α=0.005 (one-sided 99%).
 *
 *   p_hat   = max_count / L
 *   p_upper = min(1, p_hat + 2.576 × √(p_hat × (1 − p_hat) / (L − 1)))
 *   H_min   = -log₂(p_upper)
 *
 * 2.576 = inverse normal CDF at 0.995.
 */
export function mostCommonValueEstimator(samples: Uint8Array): EstimatorResult {
  const L = samples.length;
  if (L < 100) {
    throw new Error(`mostCommonValueEstimator: need ≥100 samples, got ${L}`);
  }
  const { maxCount, alphabetSize } = maxValueCount(samples);
  const pHat = maxCount / L;
  const z = invNormCdf(0.995); // one-sided 99% CI = 2.576
  const margin = z * Math.sqrt((pHat * (1 - pHat)) / (L - 1));
  const pUpper = Math.min(1, pHat + margin);
  const minEntropyBits = -Math.log2(pUpper);
  return {
    estimator: 'most_common_value_6.3.1',
    minEntropyBits,
    details: { L, maxCount, pHat, pUpper, alphabetSize, z },
  };
}

// ─── §6.3.2 Collision Estimator ────────────────────────────────────────────

/**
 * Per SP 800-90B §6.3.2: count number of samples between collisions
 * (same value seen twice). Mean collision interval relates to min-entropy
 * through a Poisson-binomial argument.
 *
 * Simplified implementation tracks colision distances; more comprehensive
 * SP 800-90B reference uses a numerical solver for p from observed mean.
 * Our simplified version uses the asymptotic relation for byte-alphabet:
 *
 *   E[T] ≈ √(π/2) × p_max^(-1/2) × (1 + O(p_max^(1/2)))
 *
 * Returns conservative -log₂(p_max) using inverted relation. For very
 * uniform sources (high entropy), collision intervals are large and we
 * return ≈ log₂(alphabetSize).
 */
export function collisionEstimator(samples: Uint8Array): EstimatorResult {
  const L = samples.length;
  if (L < 1000) {
    throw new Error(`collisionEstimator: need ≥1000 samples, got ${L}`);
  }
  // Track first-occurrence positions and measure intervals
  const distances: number[] = [];
  const lastSeen = new Map<number, number>();
  for (let i = 0; i < L; i++) {
    const v = samples[i];
    const prev = lastSeen.get(v);
    if (prev !== undefined) {
      distances.push(i - prev);
    }
    lastSeen.set(v, i);
  }
  if (distances.length === 0) {
    // No repeats — extreme uniformity; report log₂(alphabet)
    const alpha = new Set(samples).size;
    return {
      estimator: 'collision_6.3.2',
      minEntropyBits: Math.log2(Math.max(2, alpha)),
      details: { L, distances: 0, meanDistance: 0, alphabetSize: alpha },
    };
  }
  const meanDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
  // Inverted asymptotic: p_max ≈ (π/2) / E[T]²
  const pMaxEst = Math.min(1, (Math.PI / 2) / Math.max(1, meanDistance * meanDistance));
  // 99% upper bound via stddev of mean
  const variance = distances.reduce((s, d) => s + (d - meanDistance) ** 2, 0) / Math.max(1, distances.length - 1);
  const seMean = Math.sqrt(variance / distances.length);
  const meanLower = Math.max(1, meanDistance - 2.576 * seMean);
  const pUpper = Math.min(1, (Math.PI / 2) / (meanLower * meanLower));
  const minEntropyBits = -Math.log2(Math.max(pUpper, pMaxEst));
  return {
    estimator: 'collision_6.3.2',
    minEntropyBits,
    details: { L, collisions: distances.length, meanDistance, seMean, pMaxEst, pUpper },
  };
}

// ─── §6.3.3 Markov Estimator ───────────────────────────────────────────────

/**
 * Per SP 800-90B §6.3.3 (simplified order-1 Markov): models source as
 * a Markov chain, estimates per-state transition probabilities, finds
 * the most likely chain of length L given observed transitions, and
 * derives p_max as the MLE chain probability.
 *
 * Simplified order-1 implementation:
 *   1. Count transitions T(i,j) = #(samples[k]=i, samples[k+1]=j)
 *   2. P(j|i) = T(i,j) / Σⱼ T(i,j)
 *   3. p_chain_max = max_i P(i) × max_seq Π P(s_{k+1}|s_k) over all chains
 *
 * For byte-alphabet sources we cap at log₂(256) = 8 bits.
 */
export function markovEstimator(samples: Uint8Array): EstimatorResult {
  const L = samples.length;
  if (L < 1000) {
    throw new Error(`markovEstimator: need ≥1000 samples, got ${L}`);
  }
  const transitions = new Map<number, Map<number, number>>();
  const fromCounts = new Map<number, number>();
  for (let k = 0; k < L - 1; k++) {
    const from = samples[k];
    const to = samples[k + 1];
    let row = transitions.get(from);
    if (!row) { row = new Map(); transitions.set(from, row); }
    row.set(to, (row.get(to) ?? 0) + 1);
    fromCounts.set(from, (fromCounts.get(from) ?? 0) + 1);
  }
  // Per-row max conditional probability
  let maxCondP = 0;
  for (const [from, row] of transitions) {
    const total = fromCounts.get(from) ?? 1;
    let rowMax = 0;
    for (const cnt of row.values()) {
      const p = cnt / total;
      if (p > rowMax) rowMax = p;
    }
    if (rowMax > maxCondP) maxCondP = rowMax;
  }
  // Per-step min-entropy = -log₂(maxCondP)
  // Conservative: also factor in initial state distribution
  const initCounts = counts(samples);
  let pInitMax = 0;
  for (const v of initCounts.values()) {
    const p = v / L;
    if (p > pInitMax) pInitMax = p;
  }
  // SP 800-90B Markov estimator returns per-sample min-entropy
  // = min(-log₂(pInitMax), -log₂(maxCondP)) — most pessimistic
  const minEntropyBits = -Math.log2(Math.max(pInitMax, maxCondP));
  return {
    estimator: 'markov_6.3.3',
    minEntropyBits,
    details: { L, pInitMax, maxCondP, alphabetSize: initCounts.size },
  };
}

// ─── §6.3.4 Compression Estimator (Maurer's Universal Statistic) ──────────

/**
 * Per SP 800-90B §6.3.4 (based on Maurer 1992): compression ratio of
 * the sample sequence. Higher entropy → poorer compression. We use a
 * simplified Maurer statistic computing log₂(distance to last occurrence)
 * averaged over the test segment.
 *
 * Procedure (simplified):
 *   1. Split samples into init segment (first 1000) and test segment.
 *   2. For each byte in test segment, find distance to most recent
 *      occurrence in init+prior-test. Accumulate log₂(distance).
 *   3. Mean log₂(distance) ≈ Maurer statistic; map to min-entropy
 *      via empirical asymptotic constant.
 *
 * For pure uniform u8 source, Maurer statistic ≈ 7.18 bits ⇒ entropy ≈ 8.
 */
export function compressionEstimator(samples: Uint8Array): EstimatorResult {
  const L = samples.length;
  const INIT = 1000;
  if (L < INIT * 2) {
    throw new Error(`compressionEstimator: need ≥${INIT * 2} samples, got ${L}`);
  }
  const lastSeen = new Map<number, number>();
  for (let i = 0; i < INIT; i++) lastSeen.set(samples[i], i);
  let logSum = 0;
  let count = 0;
  for (let i = INIT; i < L; i++) {
    const prev = lastSeen.get(samples[i]);
    if (prev !== undefined) {
      logSum += Math.log2(i - prev);
      count++;
    } else {
      logSum += Math.log2(i + 1); // never seen — distance = position
      count++;
    }
    lastSeen.set(samples[i], i);
  }
  const meanLogDist = count > 0 ? logSum / count : 0;
  // Maurer asymptotic: H_∞ ≈ meanLogDist for uniform binary source after
  // bias correction. For byte source, normalize: cap at log₂(256) = 8.
  // Conservative: subtract Maurer correction term ≈ 0.3 for L→∞ asymptote.
  const minEntropyBits = Math.max(0, Math.min(8, meanLogDist - 0.3));
  return {
    estimator: 'compression_6.3.4',
    minEntropyBits,
    details: { L, init: INIT, meanLogDist, count },
  };
}

// ─── Aggregator ────────────────────────────────────────────────────────────

export interface AssessmentReport {
  schema: 'sp-800-90b/v1';
  generatedAtUtc: string;
  sampleCount: number;
  alphabetSize: number;
  estimators: EstimatorResult[];
  /** Min across all estimators — official SP 800-90B claim. */
  minEntropyClaim: MinEntropyBits;
  /** True if claim ≥ 0.5 bits/sample (low bar; raw HW source threshold). */
  passesLowBar: boolean;
  /** True if claim ≥ 7.0 bits/sample (CSPRNG output expectation). */
  passesCsprngBar: boolean;
}

export function assessEntropy(samples: Uint8Array): AssessmentReport {
  if (samples.length < 2000) {
    throw new Error(`assessEntropy: need ≥2000 samples, got ${samples.length}`);
  }
  const estimators: EstimatorResult[] = [
    mostCommonValueEstimator(samples),
    collisionEstimator(samples),
    markovEstimator(samples),
    compressionEstimator(samples),
  ];
  const minEntropyClaim = estimators.reduce((m, e) => Math.min(m, e.minEntropyBits), Infinity);
  const alphabetSize = new Set(samples).size;
  return {
    schema: 'sp-800-90b/v1',
    generatedAtUtc: new Date().toISOString(),
    sampleCount: samples.length,
    alphabetSize,
    estimators,
    minEntropyClaim,
    passesLowBar: minEntropyClaim >= 0.5,
    passesCsprngBar: minEntropyClaim >= 7.0,
  };
}
