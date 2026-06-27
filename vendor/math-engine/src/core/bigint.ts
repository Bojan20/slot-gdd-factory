/**
 * SLOT MATH EXACT - BigInt Utilities
 *
 * Handles large integer operations for:
 * - Total cycle counts (can exceed 2^53)
 * - Combination calculations
 * - Overflow-safe accumulation
 */

import { Decimal, dec, ZERO as DEC_ZERO, safeDivide } from './decimal.js';

/** BigInt zero */
export const ZERO = 0n;

/** BigInt one */
export const ONE = 1n;

/**
 * Convert various types to BigInt
 */
export function toBigInt(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`Cannot convert non-integer ${value} to BigInt`);
    }
    return BigInt(value);
  }
  return BigInt(value);
}

/**
 * Convert BigInt to Decimal for precise division
 */
export function bigIntToDecimal(value: bigint): Decimal {
  return dec(value.toString());
}

/**
 * Safe BigInt division returning Decimal
 */
export function bigIntDivide(numerator: bigint, denominator: bigint): Decimal {
  if (denominator === ZERO) {
    throw new Error('Division by zero');
  }
  return safeDivide(bigIntToDecimal(numerator), bigIntToDecimal(denominator));
}

/**
 * Integer division (floor)
 */
export function bigIntFloorDiv(a: bigint, b: bigint): bigint {
  if (b === ZERO) {
    throw new Error('Division by zero');
  }
  return a / b;
}

/**
 * Modulo operation
 */
export function bigIntMod(a: bigint, b: bigint): bigint {
  if (b === ZERO) {
    throw new Error('Modulo by zero');
  }
  return a % b;
}

/**
 * Power operation
 */
export function bigIntPow(base: bigint, exponent: bigint): bigint {
  if (exponent < ZERO) {
    throw new Error('Negative exponent not supported for BigInt');
  }

  if (exponent === ZERO) return ONE;
  if (exponent === ONE) return base;

  let result = ONE;
  let b = base;
  let e = exponent;

  while (e > ZERO) {
    if (e % 2n === ONE) {
      result *= b;
    }
    b *= b;
    e /= 2n;
  }

  return result;
}

/**
 * Factorial using BigInt
 */
export function factorial(n: number | bigint): bigint {
  const num = typeof n === 'bigint' ? n : BigInt(n);

  if (num < ZERO) {
    throw new Error('Factorial of negative number');
  }

  if (num === ZERO || num === ONE) return ONE;

  let result = ONE;
  for (let i = 2n; i <= num; i++) {
    result *= i;
  }

  return result;
}

/**
 * Greatest Common Divisor
 */
export function gcd(a: bigint, b: bigint): bigint {
  a = a < ZERO ? -a : a;
  b = b < ZERO ? -b : b;

  while (b !== ZERO) {
    const temp = b;
    b = a % b;
    a = temp;
  }

  return a;
}

/**
 * Least Common Multiple
 */
export function lcm(a: bigint, b: bigint): bigint {
  if (a === ZERO || b === ZERO) return ZERO;

  const absA = a < ZERO ? -a : a;
  const absB = b < ZERO ? -b : b;

  return (absA * absB) / gcd(absA, absB);
}

/**
 * Check if a BigInt is within safe JavaScript number range
 */
export function isSafeInteger(value: bigint): boolean {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
         value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/**
 * Convert BigInt to number if safe, throw otherwise
 */
export function toSafeNumber(value: bigint): number {
  if (!isSafeInteger(value)) {
    throw new Error(`BigInt ${value} exceeds safe integer range`);
  }
  return Number(value);
}

/**
 * Sum an array of BigInts
 */
export function sumBigInt(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, ZERO);
}

/**
 * Product of an array of BigInts
 */
export function productBigInt(values: bigint[]): bigint {
  if (values.length === 0) return ONE;
  return values.reduce((acc, v) => acc * v, ONE);
}

/**
 * Maximum of BigInts
 */
export function maxBigInt(...values: bigint[]): bigint {
  if (values.length === 0) {
    throw new Error('Cannot find max of empty array');
  }
  return values.reduce((a, b) => (a > b ? a : b));
}

/**
 * Minimum of BigInts
 */
export function minBigInt(...values: bigint[]): bigint {
  if (values.length === 0) {
    throw new Error('Cannot find min of empty array');
  }
  return values.reduce((a, b) => (a < b ? a : b));
}

/**
 * Streaming BigInt sum for overflow prevention
 */
export class BigIntAccumulator {
  private value: bigint = ZERO;
  private count: bigint = ZERO;

  add(n: bigint | number): void {
    this.value += typeof n === 'bigint' ? n : BigInt(n);
    this.count += ONE;
  }

  addSquared(n: bigint | number): void {
    const val = typeof n === 'bigint' ? n : BigInt(n);
    this.value += val * val;
    this.count += ONE;
  }

  getValue(): bigint {
    return this.value;
  }

  getCount(): bigint {
    return this.count;
  }

  toDecimal(): Decimal {
    return bigIntToDecimal(this.value);
  }

  merge(other: BigIntAccumulator): void {
    this.value += other.value;
    this.count += other.count;
  }

  reset(): void {
    this.value = ZERO;
    this.count = ZERO;
  }

  /**
   * Serialize to string for worker transfer
   */
  serialize(): string {
    return JSON.stringify({
      value: this.value.toString(),
      count: this.count.toString()
    });
  }

  /**
   * Deserialize from string
   */
  static deserialize(json: string): BigIntAccumulator {
    const data = JSON.parse(json) as { value: string; count: string };
    const acc = new BigIntAccumulator();
    acc.value = BigInt(data.value);
    acc.count = BigInt(data.count);
    return acc;
  }
}

/**
 * Format BigInt with thousand separators
 */
export function formatBigInt(value: bigint): string {
  const str = value.toString();
  const parts: string[] = [];

  for (let i = str.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    parts.unshift(str.slice(start, i));
  }

  // Handle negative sign
  if (parts[0]?.startsWith('-')) {
    parts[0] = parts[0].slice(1);
    return '-' + parts.join(',');
  }

  return parts.join(',');
}
