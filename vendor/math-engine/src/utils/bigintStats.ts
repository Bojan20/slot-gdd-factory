/**
 * SLOT MATH ENGINE TEMPLATE - BigInt Statistics
 *
 * For large simulations (>1B spins), standard number type can overflow
 * when calculating sum of squared wins for variance.
 *
 * Example:
 * - 1B spins × avg win 100 credits × avg win 100 credits = 10^22
 * - Number.MAX_SAFE_INTEGER = ~9 × 10^15
 * - OVERFLOW!
 *
 * This module provides bigint-based accumulators for:
 * - sumWinSquared (variance calculation)
 * - sumWinCredits (RTP calculation at extreme scale)
 */

/**
 * BigInt accumulator for sum of squared wins
 * Used for variance calculation at >1B spin scale
 */
export class BigIntSumSquared {
  private value: bigint = 0n;

  /**
   * Add (win^2) to the accumulator
   * @param win Win amount (credits or multiplier × scale)
   */
  add(win: number): void {
    // Convert to bigint and square
    const winBig = BigInt(Math.round(win));
    this.value += winBig * winBig;
  }

  /**
   * Add pre-squared value (for merging)
   */
  addSquared(squaredValue: bigint): void {
    this.value += squaredValue;
  }

  /**
   * Get raw bigint value
   */
  getValue(): bigint {
    return this.value;
  }

  /**
   * Convert to number (for final variance calculation)
   * Note: May lose precision if value > Number.MAX_SAFE_INTEGER
   * but variance calculation divides by N, bringing it back to safe range
   */
  toNumber(): number {
    return Number(this.value);
  }

  /**
   * Serialize for worker transfer
   */
  serialize(): string {
    return this.value.toString();
  }

  /**
   * Deserialize from worker data
   */
  static deserialize(serialized: string): BigIntSumSquared {
    const instance = new BigIntSumSquared();
    instance.value = BigInt(serialized);
    return instance;
  }

  /**
   * Merge with another accumulator
   */
  merge(other: BigIntSumSquared): void {
    this.value += other.value;
  }

  /**
   * Reset accumulator
   */
  reset(): void {
    this.value = 0n;
  }
}

/**
 * BigInt accumulator for sum of wins
 * Used when total win could exceed MAX_SAFE_INTEGER
 * (e.g., 10B spins × 10 avg win × 100 credit scale = 10^13, safe but close)
 */
export class BigIntSum {
  private value: bigint = 0n;
  private count: bigint = 0n;

  add(value: number): void {
    this.value += BigInt(Math.round(value));
    this.count += 1n;
  }

  getValue(): bigint {
    return this.value;
  }

  getCount(): bigint {
    return this.count;
  }

  toNumber(): number {
    return Number(this.value);
  }

  getCountAsNumber(): number {
    return Number(this.count);
  }

  serialize(): { value: string; count: string } {
    return {
      value: this.value.toString(),
      count: this.count.toString()
    };
  }

  static deserialize(data: { value: string; count: string }): BigIntSum {
    const instance = new BigIntSum();
    instance.value = BigInt(data.value);
    instance.count = BigInt(data.count);
    return instance;
  }

  merge(other: BigIntSum): void {
    this.value += other.value;
    this.count += other.count;
  }

  reset(): void {
    this.value = 0n;
    this.count = 0n;
  }
}

/**
 * Calculate variance using bigint sum of squares
 * @param sumSq Sum of squared values (bigint)
 * @param sum Sum of values
 * @param count Number of samples
 * @returns Variance as number
 */
export function calculateVarianceBigInt(
  sumSq: bigint,
  sum: number,
  count: number
): number {
  if (count < 2) return 0;

  // E[X^2] - E[X]^2
  const meanSq = Number(sumSq) / count;
  const mean = sum / count;
  const variance = meanSq - mean * mean;

  return Math.max(0, variance); // Ensure non-negative due to floating point
}

/**
 * Safe check if number needs bigint treatment
 */
export function needsBigInt(value: number): boolean {
  return Math.abs(value) > Number.MAX_SAFE_INTEGER * 0.9;
}

/**
 * Threshold for when to use bigint accumulators
 * At 100M spins with 1000x max win, sumWinSq could reach ~10^16
 * At 1B spins, definitely need bigint
 */
export const BIGINT_SPIN_THRESHOLD = 100_000_000;

/**
 * Helper to determine if simulation scale needs bigint
 */
export function shouldUseBigInt(spinCount: number, maxExpectedWin: number): boolean {
  // Estimate: spinCount × (avgWin)^2 for sumSq
  // Conservative: use maxWin as proxy for avgWin^2 contribution
  const estimatedSumSq = spinCount * maxExpectedWin * maxExpectedWin;
  return estimatedSumSq > Number.MAX_SAFE_INTEGER * 0.5;
}
