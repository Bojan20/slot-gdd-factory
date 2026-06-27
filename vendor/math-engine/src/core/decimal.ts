/**
 * SLOT MATH EXACT - Arbitrary Precision Decimal Wrapper
 *
 * Wraps Decimal.js for exact slot math calculations.
 * - 50 decimal places precision (configurable)
 * - No floating point errors
 * - Probability validation
 * - RTP calculations with perfect accuracy
 */

import { Decimal } from 'decimal.js';

// Re-export types
export type DecimalValue = string | number | bigint | Decimal;

// Configure Decimal.js for maximum precision
Decimal.set({
  precision: 50,           // 50 significant digits
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -50,
  toExpPos: 50,
  minE: -9e15,
  maxE: 9e15
});

/** Epsilon for probability comparisons */
const EPSILON = new Decimal('1e-40');

/** Zero constant */
export const ZERO = new Decimal(0);

/** One constant */
export const ONE = new Decimal(1);

/** Hundred constant (for percentage conversion) */
export const HUNDRED = new Decimal(100);

/**
 * Create a Decimal from various inputs
 */
export function dec(value: DecimalValue): Decimal {
  return new Decimal(value);
}

/**
 * Safe division - throws on division by zero
 */
export function safeDivide(numerator: Decimal, denominator: Decimal): Decimal {
  if (denominator.isZero()) {
    throw new Error('Division by zero');
  }
  return numerator.dividedBy(denominator);
}

/**
 * Check if a value is a valid probability (0 <= p <= 1)
 */
export function isValidProbability(p: Decimal): boolean {
  return p.greaterThanOrEqualTo(ZERO) && p.lessThanOrEqualTo(ONE);
}

/**
 * Assert a value is a valid probability
 */
export function assertProbability(p: Decimal, name: string = 'probability'): void {
  if (!isValidProbability(p)) {
    throw new Error(`Invalid ${name}: ${p.toString()} (must be 0 <= p <= 1)`);
  }
}

/**
 * Check if probabilities sum to 1 (within epsilon)
 */
export function probabilitiesSumToOne(probabilities: Decimal[]): boolean {
  const total = probabilities.reduce((acc, p) => acc.plus(p), ZERO);
  return total.minus(ONE).abs().lessThan(EPSILON);
}

/**
 * Assert probabilities sum to 1
 */
export function assertProbabilitiesSum(probabilities: Decimal[], name: string = 'probabilities'): void {
  const total = probabilities.reduce((acc, p) => acc.plus(p), ZERO);
  const diff = total.minus(ONE).abs();

  if (diff.greaterThanOrEqualTo(EPSILON)) {
    throw new Error(
      `${name} do not sum to 1: sum=${total.toString()}, diff=${diff.toString()}`
    );
  }
}

/**
 * Normalize probabilities to sum exactly to 1
 */
export function normalizeProbabilities(probabilities: Decimal[]): Decimal[] {
  const total = probabilities.reduce((acc, p) => acc.plus(p), ZERO);

  if (total.isZero()) {
    throw new Error('Cannot normalize: sum is zero');
  }

  return probabilities.map(p => safeDivide(p, total));
}

/**
 * Calculate weighted average
 */
export function weightedAverage(values: Decimal[], weights: Decimal[]): Decimal {
  if (values.length !== weights.length) {
    throw new Error('Values and weights must have same length');
  }

  if (values.length === 0) {
    throw new Error('Cannot calculate weighted average of empty arrays');
  }

  const totalWeight = weights.reduce((acc, w) => acc.plus(w), ZERO);

  if (totalWeight.isZero()) {
    throw new Error('Total weight is zero');
  }

  const weightedSum = values.reduce((acc, v, i) => {
    const weight = weights[i];
    if (weight === undefined) {
      throw new Error(`Missing weight at index ${i}`);
    }
    return acc.plus(v.times(weight));
  }, ZERO);

  return safeDivide(weightedSum, totalWeight);
}

/**
 * Convert to percentage (multiply by 100)
 */
export function toPercent(value: Decimal): Decimal {
  return value.times(HUNDRED);
}

/**
 * Convert from percentage (divide by 100)
 */
export function fromPercent(percent: Decimal): Decimal {
  return safeDivide(percent, HUNDRED);
}

/**
 * Format Decimal for display
 */
export function formatDecimal(value: Decimal, decimalPlaces: number = 6): string {
  return value.toFixed(decimalPlaces);
}

/**
 * Format as percentage string
 */
export function formatPercent(value: Decimal, decimalPlaces: number = 4): string {
  return `${toPercent(value).toFixed(decimalPlaces)}%`;
}

/**
 * Check if two decimals are equal within epsilon
 */
export function approxEqual(a: Decimal, b: Decimal, epsilon: Decimal = EPSILON): boolean {
  return a.minus(b).abs().lessThan(epsilon);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: Decimal, min: Decimal, max: Decimal): Decimal {
  if (value.lessThan(min)) return min;
  if (value.greaterThan(max)) return max;
  return value;
}

/**
 * Sum an array of Decimals
 */
export function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/**
 * Product of an array of Decimals
 */
export function product(values: Decimal[]): Decimal {
  if (values.length === 0) return ONE;
  return values.reduce((acc, v) => acc.times(v), ONE);
}

/**
 * Maximum of Decimals
 */
export function max(...values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error('Cannot find max of empty array');
  }
  return values.reduce((a, b) => (a.greaterThan(b) ? a : b));
}

/**
 * Minimum of Decimals
 */
export function min(...values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error('Cannot find min of empty array');
  }
  return values.reduce((a, b) => (a.lessThan(b) ? a : b));
}

/**
 * Check if value is in valid RTP range (typically 80% - 120%)
 */
export function isValidRTP(rtp: Decimal): boolean {
  const minRTP = dec('0.80');  // 80%
  const maxRTP = dec('1.20');  // 120%
  return rtp.greaterThanOrEqualTo(minRTP) && rtp.lessThanOrEqualTo(maxRTP);
}

/**
 * Assert RTP is in valid range
 */
export function assertValidRTP(rtp: Decimal, name: string = 'RTP'): void {
  if (!isValidRTP(rtp)) {
    throw new Error(
      `Invalid ${name}: ${formatPercent(rtp)} (must be between 80% and 120%)`
    );
  }
}

// Re-export Decimal class for advanced usage
export { Decimal };
