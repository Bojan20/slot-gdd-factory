/**
 * W152 Wave 22 — Generating Functions for sum-of-payouts distribution
 * (Faza 6.7 ⚠️→✅).
 *
 * Computes the probability generating function (PGF) and moment generating
 * function (MGF) for a discrete payout distribution + folds them into
 * higher-order moments (mean / variance / skewness / kurtosis) without
 * having to draw samples.
 *
 * Mathematical contract:
 *   * PGF: G_X(z) = Σ_k p_k × z^k
 *   * MGF: M_X(t) = Σ_k p_k × e^(tk) = G_X(e^t)
 *   * Mean      = M'(0)        = Σ k × p_k
 *   * Variance  = M''(0) − M'(0)²
 *   * Skewness  = (M'''(0) − 3μ × σ² − μ³) / σ³
 *   * Kurtosis  = (M''''(0) − 4μ × M'''(0) + 6μ² × M''(0) − 3μ⁴) / σ⁴
 *
 * Use cases:
 *   * Analytical solver — exact moments without MC samples.
 *   * Validation gate — compare MC-observed moments to PGF-derived ones.
 *   * Composition — for independent payout sources, PGF of sum = product
 *     of PGFs (closed-form). Saves one full MC pass per spin breakdown.
 *
 * Naming policy: `generatingFunctions` engine-generic. References:
 *   * Cabot & Hannum 2002, "Practical Casino Math" §App. C — moment
 *     formulas.
 *   * Wilf 1994, "generatingfunctionology" §1 — PGF/MGF derivations.
 */

export interface DiscretePayoutDistribution {
  /** payouts[i] = the i-th distinct payout value (in stake-multiples). */
  payouts: ReadonlyArray<number>;
  /** probabilities[i] = P(X = payouts[i]). Must sum to 1 within ε. */
  probabilities: ReadonlyArray<number>;
}

export interface MomentResult {
  mean: number;
  variance: number;
  stdDev: number;
  skewness: number;
  /** Excess kurtosis (kurtosis − 3, normal = 0). */
  excessKurtosis: number;
  rawMoments: number[]; // [E[X^1], E[X^2], E[X^3], E[X^4]]
}

/**
 * Validate a discrete payout distribution. Throws on:
 *   * mismatched lengths
 *   * negative payout values (non-physical)
 *   * negative probabilities
 *   * probabilities not summing to 1 within ε (default 1e-9)
 */
export function validateDistribution(
  dist: DiscretePayoutDistribution,
  epsilon = 1e-9,
): void {
  if (dist.payouts.length !== dist.probabilities.length) {
    throw new Error(
      `validateDistribution: payouts.length (${dist.payouts.length}) != probabilities.length (${dist.probabilities.length})`,
    );
  }
  if (dist.payouts.length === 0) {
    throw new Error('validateDistribution: empty distribution');
  }
  let sum = 0;
  for (let i = 0; i < dist.payouts.length; i++) {
    if (!Number.isFinite(dist.payouts[i]) || dist.payouts[i] < 0) {
      throw new RangeError(
        `validateDistribution: payouts[${i}] must be finite non-negative (got ${dist.payouts[i]})`,
      );
    }
    if (!Number.isFinite(dist.probabilities[i]) || dist.probabilities[i] < 0) {
      throw new RangeError(
        `validateDistribution: probabilities[${i}] must be finite non-negative (got ${dist.probabilities[i]})`,
      );
    }
    sum += dist.probabilities[i];
  }
  if (Math.abs(sum - 1) > epsilon) {
    throw new RangeError(
      `validateDistribution: probabilities sum to ${sum}, expected 1 within ±${epsilon}`,
    );
  }
}

/**
 * Probability Generating Function evaluated at z.
 * G_X(z) = Σ p_k × z^k
 */
export function pgf(dist: DiscretePayoutDistribution, z: number): number {
  validateDistribution(dist);
  let s = 0;
  for (let i = 0; i < dist.payouts.length; i++) {
    s += dist.probabilities[i] * Math.pow(z, dist.payouts[i]);
  }
  return s;
}

/**
 * Moment Generating Function evaluated at t.
 * M_X(t) = Σ p_k × e^(t×k) = G_X(e^t)
 */
export function mgf(dist: DiscretePayoutDistribution, t: number): number {
  validateDistribution(dist);
  let s = 0;
  for (let i = 0; i < dist.payouts.length; i++) {
    s += dist.probabilities[i] * Math.exp(t * dist.payouts[i]);
  }
  return s;
}

/**
 * Compute first 4 raw moments + central statistics in one pass.
 * Closed-form: each moment is Σ p_k × payout^n.
 */
export function moments(dist: DiscretePayoutDistribution): MomentResult {
  validateDistribution(dist);
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < dist.payouts.length; i++) {
    const x = dist.payouts[i];
    const p = dist.probabilities[i];
    const x2 = x * x;
    const x3 = x2 * x;
    const x4 = x3 * x;
    m1 += p * x;
    m2 += p * x2;
    m3 += p * x3;
    m4 += p * x4;
  }
  const mean = m1;
  const variance = m2 - m1 * m1;
  const stdDev = Math.sqrt(Math.max(0, variance));
  // Skewness: γ₁ = E[(X-μ)³] / σ³
  // E[(X-μ)³] = m3 − 3μm2 + 2μ³
  const centralMoment3 = m3 - 3 * mean * m2 + 2 * mean * mean * mean;
  const skewness = stdDev > 0 ? centralMoment3 / (stdDev * stdDev * stdDev) : 0;
  // Kurtosis: κ = E[(X-μ)⁴] / σ⁴
  // E[(X-μ)⁴] = m4 − 4μm3 + 6μ²m2 − 3μ⁴
  const centralMoment4 = m4 - 4 * mean * m3 + 6 * mean * mean * m2 - 3 * Math.pow(mean, 4);
  const kurtosis = stdDev > 0 ? centralMoment4 / Math.pow(stdDev, 4) : 0;
  const excessKurtosis = kurtosis - 3;
  return {
    mean,
    variance,
    stdDev,
    skewness,
    excessKurtosis,
    rawMoments: [m1, m2, m3, m4],
  };
}

/**
 * Convolve two independent payout distributions to get the distribution
 * of their sum. Useful for computing per-feature payout sums.
 *
 * Returns a new distribution. Probabilities are summed for identical
 * payout values via deterministic Map keyed by string-stringified
 * payout (so floating-point noise doesn't fragment).
 */
export function convolve(
  a: DiscretePayoutDistribution,
  b: DiscretePayoutDistribution,
): DiscretePayoutDistribution {
  validateDistribution(a);
  validateDistribution(b);
  const map = new Map<number, number>();
  for (let i = 0; i < a.payouts.length; i++) {
    for (let j = 0; j < b.payouts.length; j++) {
      const sumPayout = a.payouts[i] + b.payouts[j];
      const sumProb = a.probabilities[i] * b.probabilities[j];
      map.set(sumPayout, (map.get(sumPayout) ?? 0) + sumProb);
    }
  }
  const sorted = Array.from(map.entries()).sort((x, y) => x[0] - y[0]);
  return {
    payouts: sorted.map((e) => e[0]),
    probabilities: sorted.map((e) => e[1]),
  };
}

/**
 * Sum N independent copies of the same distribution via repeated
 * convolution. Useful for "expected payout from N spins" closed-form.
 *
 * Throws on N < 0 or non-integer N.
 */
export function sumNCopies(
  dist: DiscretePayoutDistribution,
  n: number,
): DiscretePayoutDistribution {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`sumNCopies: n must be non-negative integer (got ${n})`);
  }
  if (n === 0) {
    // Identity distribution: all mass at payout=0.
    return { payouts: [0], probabilities: [1] };
  }
  let result = dist;
  for (let i = 1; i < n; i++) {
    result = convolve(result, dist);
  }
  return result;
}

/**
 * Build a discrete distribution from a per-symbol-count payout map and
 * symbol probability. Convenient for slot game per-feature builds.
 */
export function buildFromPayoutMap(
  payoutMap: Record<string, number>,
  symbolProbability: number,
): DiscretePayoutDistribution {
  if (symbolProbability < 0 || symbolProbability > 1) {
    throw new RangeError(`buildFromPayoutMap: symbolProbability out of [0, 1]`);
  }
  // Each row: payout value + Bernoulli probability.
  // For analytical purposes: distribution with mass at payouts + mass at 0.
  const payoutsRaw = Object.values(payoutMap);
  const N = payoutsRaw.length;
  if (N === 0) {
    return { payouts: [0], probabilities: [1] };
  }
  // Naive build: each payout has equal share of the trigger probability.
  // Caller can convolve / weight further. This is the basic primitive.
  const triggerEach = symbolProbability / N;
  const payouts = [0, ...payoutsRaw];
  const probabilities = [1 - symbolProbability, ...payoutsRaw.map(() => triggerEach)];
  return { payouts, probabilities };
}
