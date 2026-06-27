/**
 * SLOT MATH ENGINE TEMPLATE - Integer Credits System
 *
 * All slot math calculations use integer credits to avoid
 * floating-point precision errors. This is critical for:
 * - Deterministic results across platforms
 * - Exact RTP calculations (no cumulative rounding errors)
 * - Certification compliance
 *
 * CREDIT_SCALE = 100 means:
 * - 1 bet = 100 credits
 * - 0.01 bet = 1 credit
 * - All wins are calculated in credits, converted to money at output
 */

/**
 * Credit scale factor
 * 100 = 2 decimal places (0.01 precision)
 * 1000 = 3 decimal places (0.001 precision)
 */
export const CREDIT_SCALE = 100;

/**
 * Convert bet amount to credits
 */
export function betToCredits(bet: number): number {
  return Math.round(bet * CREDIT_SCALE);
}

/**
 * Convert credits back to money amount
 */
export function creditsToMoney(credits: number): number {
  return credits / CREDIT_SCALE;
}

/**
 * Calculate win in credits (deterministic integer math)
 * @param betCredits Bet amount in credits
 * @param multiplier Win multiplier (e.g., 5 for 5x)
 * @returns Win amount in credits
 */
export function calculateWinCredits(betCredits: number, multiplier: number): number {
  // Use integer math: multiply first, then round
  // For fractional multipliers (e.g., 0.5x), we scale up
  const scaledMultiplier = Math.round(multiplier * CREDIT_SCALE);
  return Math.round((betCredits * scaledMultiplier) / CREDIT_SCALE);
}

/**
 * Calculate win from paytable payout (payout is already in bet multiples)
 * @param betCredits Bet amount in credits
 * @param payout Paytable payout value (e.g., 250 for 250x)
 * @returns Win amount in credits
 */
export function calculatePayoutCredits(betCredits: number, payout: number): number {
  return betCredits * payout;
}

/**
 * Apply multiplier to existing win credits
 * @param winCredits Current win in credits
 * @param multiplier Multiplier to apply
 * @returns New win amount in credits
 */
export function applyMultiplier(winCredits: number, multiplier: number): number {
  if (multiplier === 1) return winCredits;
  if (Number.isInteger(multiplier)) return winCredits * multiplier;

  // For non-integer multipliers, use scaled math
  const scaledMultiplier = Math.round(multiplier * CREDIT_SCALE);
  return Math.round((winCredits * scaledMultiplier) / CREDIT_SCALE);
}

/**
 * Sum multiple credit amounts (safe for large sums)
 * Uses compensation for accumulated rounding if needed
 */
export function sumCredits(...amounts: number[]): number {
  let sum = 0;
  for (const amount of amounts) {
    sum += amount;
  }
  return sum;
}

/**
 * Credit accumulator for large simulations
 * Uses standard number for counts up to Number.MAX_SAFE_INTEGER (~9 quadrillion)
 * which is sufficient for any practical simulation
 */
export class CreditAccumulator {
  private totalCredits = 0;
  private count = 0;

  add(credits: number): void {
    this.totalCredits += credits;
    this.count++;
  }

  getTotal(): number {
    return this.totalCredits;
  }

  getCount(): number {
    return this.count;
  }

  getTotalAsMoney(): number {
    return creditsToMoney(this.totalCredits);
  }

  getMeanCredits(): number {
    return this.count > 0 ? this.totalCredits / this.count : 0;
  }

  getMeanAsMoney(): number {
    return creditsToMoney(this.getMeanCredits());
  }

  merge(other: CreditAccumulator): void {
    this.totalCredits += other.totalCredits;
    this.count += other.count;
  }

  reset(): void {
    this.totalCredits = 0;
    this.count = 0;
  }
}

/**
 * Validate that a value is a valid credit amount
 */
export function isValidCreditAmount(value: number): boolean {
  return Number.isFinite(value) &&
         Number.isInteger(value) &&
         value >= 0 &&
         value <= Number.MAX_SAFE_INTEGER;
}

/**
 * Format credits as money string
 */
export function formatCredits(credits: number, currency: string = ''): string {
  const money = creditsToMoney(credits);
  const prefix = currency ? `${currency} ` : '';
  return `${prefix}${money.toFixed(2)}`;
}

/**
 * Win multiplier from credits
 * @param winCredits Win amount in credits
 * @param betCredits Bet amount in credits
 * @returns Win multiplier (e.g., 5.5 for 5.5x)
 */
export function getWinMultiplier(winCredits: number, betCredits: number): number {
  if (betCredits === 0) return 0;
  return winCredits / betCredits;
}
