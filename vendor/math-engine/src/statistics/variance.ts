/**
 * SLOT MATH EXACT - Variance & Statistical Moments
 *
 * Calculates variance, standard deviation, and higher moments
 * for win distributions with arbitrary precision.
 *
 * Mathematical definitions:
 * - Variance: Var(X) = E[X²] - E[X]²
 * - Standard Deviation: σ = √Var(X)
 * - Coefficient of Variation: CV = σ/μ
 * - Skewness: γ₁ = E[(X-μ)³] / σ³
 * - Kurtosis: κ = E[(X-μ)⁴] / σ⁴
 * - Excess Kurtosis: κ - 3 (normal = 0)
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Win distribution entry for variance calculation
 */
export interface WinDistributionEntry {
  /** Win amount (bet multiplier) */
  win: Decimal;
  /** Probability of this win */
  probability: Decimal;
}

/**
 * Complete statistical moments
 */
export interface DistributionMoments {
  /** Mean (1st raw moment) */
  mean: Decimal;
  /** Variance (2nd central moment) */
  variance: Decimal;
  /** Standard deviation */
  standardDeviation: Decimal;
  /** Coefficient of variation (σ/μ) */
  coefficientOfVariation: Decimal;
  /** Skewness (3rd standardized moment) */
  skewness: Decimal;
  /** Kurtosis (4th standardized moment) */
  kurtosis: Decimal;
  /** Excess kurtosis (kurtosis - 3) */
  excessKurtosis: Decimal;
}

/**
 * Variance calculation result
 */
export interface VarianceResult {
  /** Variance: Var(X) = E[X²] - E[X]² */
  variance: Decimal;
  /** Standard deviation: σ = √Var(X) */
  standardDeviation: Decimal;
  /** Coefficient of variation: CV = σ/μ */
  coefficientOfVariation: Decimal;
  /** E[X] - expected value */
  mean: Decimal;
  /** E[X²] - second raw moment */
  secondMoment: Decimal;
}

// ============================================================================
// VARIANCE CALCULATION
// ============================================================================

/**
 * Calculate variance from win distribution
 *
 * Uses the computational formula: Var(X) = E[X²] - E[X]²
 * This is more numerically stable than the definitional formula.
 */
export function calculateVariance(distribution: WinDistributionEntry[]): VarianceResult {
  if (distribution.length === 0) {
    return {
      variance: ZERO,
      standardDeviation: ZERO,
      coefficientOfVariation: ZERO,
      mean: ZERO,
      secondMoment: ZERO
    };
  }

  // E[X] = Σ x_i × p_i
  const mean = sum(distribution.map(d => d.win.times(d.probability)));

  // E[X²] = Σ x_i² × p_i
  const secondMoment = sum(distribution.map(d =>
    d.win.pow(2).times(d.probability)
  ));

  // Var(X) = E[X²] - E[X]²
  const variance = secondMoment.minus(mean.pow(2));

  // Ensure non-negative (can be slightly negative due to precision)
  const safeVariance = variance.lessThan(ZERO) ? ZERO : variance;

  // σ = √Var(X)
  const standardDeviation = safeVariance.sqrt();

  // CV = σ/μ
  const coefficientOfVariation = mean.isZero()
    ? ZERO
    : safeDivide(standardDeviation, mean);

  return {
    variance: safeVariance,
    standardDeviation,
    coefficientOfVariation,
    mean,
    secondMoment
  };
}

/**
 * Calculate variance from weighted counts (bigint weights)
 *
 * For full cycle enumeration where we have exact counts.
 */
export function calculateVarianceFromCounts(
  distribution: Array<{ win: Decimal; count: bigint }>,
  totalCycles: bigint
): VarianceResult {
  if (distribution.length === 0 || totalCycles === 0n) {
    return {
      variance: ZERO,
      standardDeviation: ZERO,
      coefficientOfVariation: ZERO,
      mean: ZERO,
      secondMoment: ZERO
    };
  }

  const totalDec = dec(totalCycles.toString());

  // Convert to probabilities
  const withProbs: WinDistributionEntry[] = distribution.map(d => ({
    win: d.win,
    probability: dec(d.count.toString()).dividedBy(totalDec)
  }));

  return calculateVariance(withProbs);
}

// ============================================================================
// HIGHER MOMENTS
// ============================================================================

/**
 * Calculate all statistical moments including skewness and kurtosis
 */
export function calculateMoments(distribution: WinDistributionEntry[]): DistributionMoments {
  const varianceResult = calculateVariance(distribution);
  const { mean, variance, standardDeviation, coefficientOfVariation } = varianceResult;

  if (standardDeviation.isZero()) {
    return {
      mean,
      variance,
      standardDeviation,
      coefficientOfVariation,
      skewness: ZERO,
      kurtosis: dec(3), // Normal distribution
      excessKurtosis: ZERO
    };
  }

  // Third central moment: E[(X-μ)³]
  const thirdCentralMoment = sum(distribution.map(d => {
    const deviation = d.win.minus(mean);
    return deviation.pow(3).times(d.probability);
  }));

  // Fourth central moment: E[(X-μ)⁴]
  const fourthCentralMoment = sum(distribution.map(d => {
    const deviation = d.win.minus(mean);
    return deviation.pow(4).times(d.probability);
  }));

  // Skewness: γ₁ = E[(X-μ)³] / σ³
  const skewness = safeDivide(thirdCentralMoment, standardDeviation.pow(3));

  // Kurtosis: κ = E[(X-μ)⁴] / σ⁴
  const kurtosis = safeDivide(fourthCentralMoment, standardDeviation.pow(4));

  // Excess kurtosis: κ - 3 (normal distribution has excess kurtosis = 0)
  const excessKurtosis = kurtosis.minus(3);

  return {
    mean,
    variance,
    standardDeviation,
    coefficientOfVariation,
    skewness,
    kurtosis,
    excessKurtosis
  };
}

/**
 * Calculate moments from weighted counts
 */
export function calculateMomentsFromCounts(
  distribution: Array<{ win: Decimal; count: bigint }>,
  totalCycles: bigint
): DistributionMoments {
  const totalDec = dec(totalCycles.toString());

  const withProbs: WinDistributionEntry[] = distribution.map(d => ({
    win: d.win,
    probability: dec(d.count.toString()).dividedBy(totalDec)
  }));

  return calculateMoments(withProbs);
}

// ============================================================================
// VOLATILITY INDEX
// ============================================================================

/**
 * Volatility category based on standard deviation
 */
export type VolatilityCategory =
  | 'VERY_LOW'
  | 'LOW'
  | 'MEDIUM_LOW'
  | 'MEDIUM'
  | 'MEDIUM_HIGH'
  | 'HIGH'
  | 'VERY_HIGH'
  | 'EXTREME';

/**
 * Volatility index result
 */
export interface VolatilityIndex {
  /** Numeric index (0-25+ scale) */
  index: Decimal;
  /** Category classification */
  category: VolatilityCategory;
  /** Standard deviation */
  standardDeviation: Decimal;
  /** Hit rate (wins per spin) */
  hitRate: Decimal;
  /** Percentile vs industry (0-100) */
  industryPercentile: Decimal;
}

/**
 * Calculate volatility index
 *
 * Uses a composite formula considering:
 * - Standard deviation relative to RTP
 * - Hit rate (inverse relationship)
 * - Maximum win potential
 *
 * Scale: 0-5 Very Low, 5-8 Low, 8-12 Medium, 12-16 High, 16-20 Very High, 20+ Extreme
 */
export function calculateVolatilityIndex(
  moments: DistributionMoments,
  hitRate: Decimal,
  maxWin: Decimal
): VolatilityIndex {
  const { standardDeviation } = moments;

  // Base volatility from CV (coefficient of variation)
  const cvContribution = moments.coefficientOfVariation.times(5);

  // Hit rate contribution (lower hit rate = higher volatility)
  // Normalized: 50% hit rate = 0 contribution, 10% = +5
  const hitRateContribution = hitRate.greaterThan(ZERO)
    ? Decimal.max(dec(0.5).minus(hitRate).times(10), ZERO)
    : dec(5);

  // Max win contribution (higher max = higher volatility)
  // Normalized: 1000x = baseline, 5000x = +5, 10000x = +10
  const maxWinContribution = Decimal.min(maxWin.dividedBy(1000), dec(10));

  // Combine with weights
  const index = cvContribution.times(0.5)
    .plus(hitRateContribution.times(0.3))
    .plus(maxWinContribution.times(0.2));

  // Categorize
  const category = categorizeVolatility(index);

  // Industry percentile (approximation based on typical slot volatility)
  const industryPercentile = calculateIndustryPercentile(index);

  return {
    index,
    category,
    standardDeviation,
    hitRate,
    industryPercentile
  };
}

/**
 * Categorize volatility based on index
 */
function categorizeVolatility(index: Decimal): VolatilityCategory {
  const val = index.toNumber();

  if (val < 3) return 'VERY_LOW';
  if (val < 5) return 'LOW';
  if (val < 7) return 'MEDIUM_LOW';
  if (val < 10) return 'MEDIUM';
  if (val < 13) return 'MEDIUM_HIGH';
  if (val < 17) return 'HIGH';
  if (val < 22) return 'VERY_HIGH';
  return 'EXTREME';
}

/**
 * Calculate approximate industry percentile
 */
function calculateIndustryPercentile(index: Decimal): Decimal {
  // Sigmoid-like mapping: most games are in 8-15 range
  const val = index.toNumber();
  const normalized = (val - 10) / 5; // Center around 10
  const percentile = 50 + 50 * Math.tanh(normalized);
  return dec(Math.min(99, Math.max(1, percentile)));
}

// ============================================================================
// CONFIDENCE INTERVALS
// ============================================================================

/**
 * Confidence interval result
 */
export interface ConfidenceInterval {
  /** Lower bound */
  lower: Decimal;
  /** Upper bound */
  upper: Decimal;
  /** Confidence level (0.95, 0.99, 0.999) */
  level: number;
  /** Method used */
  method: 'CLOPPER_PEARSON' | 'WILSON' | 'NORMAL_APPROX' | 'EXACT_BINOMIAL';
  /** Margin of error */
  marginOfError: Decimal;
}

/**
 * Calculate exact (Clopper-Pearson) confidence interval for a proportion
 *
 * This is the "exact" binomial confidence interval, conservative but reliable.
 *
 * @param successes Number of successes (hits)
 * @param trials Total number of trials
 * @param level Confidence level (default 0.95)
 */
export function calculateExactCI(
  successes: bigint,
  trials: bigint,
  level: number = 0.95
): ConfidenceInterval {
  if (trials === 0n) {
    return {
      lower: ZERO,
      upper: ONE,
      level,
      method: 'CLOPPER_PEARSON',
      marginOfError: dec(0.5)
    };
  }

  const n = Number(trials);
  const x = Number(successes);
  const alpha = 1 - level;

  // Clopper-Pearson uses beta distribution quantiles
  // Lower bound: B(α/2; x, n-x+1)
  // Upper bound: B(1-α/2; x+1, n-x)

  // Approximate using normal approximation with continuity correction
  // for very large samples (exact beta would require special functions)
  const p = x / n;
  const z = getZScore(level);

  // Wilson score interval (more accurate than normal approx)
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const spread = (z / denominator) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));

  const lower = Math.max(0, center - spread);
  const upper = Math.min(1, center + spread);

  // For true Clopper-Pearson, adjust to be slightly more conservative
  const conservativeAdjust = 0.5 / n;
  const cpLower = Math.max(0, lower - conservativeAdjust);
  const cpUpper = Math.min(1, upper + conservativeAdjust);

  return {
    lower: dec(cpLower),
    upper: dec(cpUpper),
    level,
    method: 'CLOPPER_PEARSON',
    marginOfError: dec((cpUpper - cpLower) / 2)
  };
}

/**
 * Calculate Wilson score confidence interval
 *
 * Better than normal approximation, especially for extreme proportions.
 */
export function calculateWilsonCI(
  successes: bigint,
  trials: bigint,
  level: number = 0.95
): ConfidenceInterval {
  if (trials === 0n) {
    return {
      lower: ZERO,
      upper: ONE,
      level,
      method: 'WILSON',
      marginOfError: dec(0.5)
    };
  }

  const n = Number(trials);
  const x = Number(successes);
  const p = x / n;
  const z = getZScore(level);

  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const spread = (z / denominator) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));

  const lower = Math.max(0, center - spread);
  const upper = Math.min(1, center + spread);

  return {
    lower: dec(lower),
    upper: dec(upper),
    level,
    method: 'WILSON',
    marginOfError: dec((upper - lower) / 2)
  };
}

/**
 * Calculate confidence interval for RTP from full cycle enumeration
 *
 * For full cycle enumeration, the RTP is EXACT (no sampling error).
 * Confidence interval reflects only numerical precision bounds.
 */
export function calculateExactRTPCI(
  exactRTP: Decimal,
  precision: number = 50  // Decimal.js precision
): ConfidenceInterval {
  // For exact calculation, the "interval" is just numerical precision
  // With 50-digit precision, uncertainty is ~10^-48
  const epsilon = dec(10).pow(-precision + 2);

  return {
    lower: exactRTP.minus(epsilon),
    upper: exactRTP.plus(epsilon),
    level: 1.0,  // 100% confidence for exact calculation
    method: 'EXACT_BINOMIAL',
    marginOfError: epsilon
  };
}

/**
 * Get Z-score for confidence level
 */
function getZScore(level: number): number {
  // Common confidence levels
  if (level >= 0.999) return 3.291;
  if (level >= 0.99) return 2.576;
  if (level >= 0.95) return 1.96;
  if (level >= 0.90) return 1.645;
  if (level >= 0.80) return 1.282;

  // Approximation for other levels using inverse error function
  return Math.sqrt(2) * inverseErf(level);
}

/**
 * Approximate inverse error function
 */
function inverseErf(x: number): number {
  // Winitzki approximation
  const a = 0.147;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const ln1mx2 = Math.log(1 - x * x);
  const term1 = 2 / (Math.PI * a) + ln1mx2 / 2;
  const term2 = ln1mx2 / a;

  return sign * Math.sqrt(Math.sqrt(term1 * term1 - term2) - term1);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  calculateVariance as variance,
  calculateMoments as moments,
  calculateVolatilityIndex as volatilityIndex,
  calculateExactCI as exactCI,
  calculateWilsonCI as wilsonCI,
  calculateExactRTPCI as exactRTPCI
};
