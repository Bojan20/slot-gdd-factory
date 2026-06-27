/**
 * SLOT MATH EXACT - Combinatorics Library
 *
 * Pure BigInt combinatorics for exact slot calculations:
 * - Combinations (n choose k)
 * - Permutations
 * - Multinomial coefficients
 * - Cycle counting for reels
 */

import { ZERO, ONE, factorial, bigIntPow, toBigInt, productBigInt, gcd } from './bigint.js';
import { Decimal, dec, safeDivide } from './decimal.js';

/**
 * Binomial coefficient: C(n, k) = n! / (k! * (n-k)!)
 * Computed efficiently without full factorial calculation
 */
export function binomial(n: number | bigint, k: number | bigint): bigint {
  const N = typeof n === 'bigint' ? n : BigInt(n);
  const K = typeof k === 'bigint' ? k : BigInt(k);

  if (K < ZERO || K > N) return ZERO;
  if (K === ZERO || K === N) return ONE;

  // Use symmetry: C(n,k) = C(n, n-k)
  const kToUse = K > N - K ? N - K : K;

  let result = ONE;
  for (let i = ZERO; i < kToUse; i += ONE) {
    result = result * (N - i) / (i + ONE);
  }

  return result;
}

/**
 * Permutations: P(n, k) = n! / (n-k)!
 */
export function permutations(n: number | bigint, k: number | bigint): bigint {
  const N = typeof n === 'bigint' ? n : BigInt(n);
  const K = typeof k === 'bigint' ? k : BigInt(k);

  if (K < ZERO || K > N) return ZERO;
  if (K === ZERO) return ONE;

  let result = ONE;
  for (let i = ZERO; i < K; i += ONE) {
    result *= (N - i);
  }

  return result;
}

/**
 * Multinomial coefficient: n! / (k1! * k2! * ... * km!)
 * where k1 + k2 + ... + km = n
 */
export function multinomial(n: number | bigint, ks: (number | bigint)[]): bigint {
  const N = typeof n === 'bigint' ? n : BigInt(n);
  const Ks = ks.map(k => typeof k === 'bigint' ? k : BigInt(k));

  // Verify sum of ks equals n
  const sum = Ks.reduce((acc, k) => acc + k, ZERO);
  if (sum !== N) {
    throw new Error(`Multinomial: sum of k values (${sum}) must equal n (${N})`);
  }

  // Calculate n! / (k1! * k2! * ... * km!)
  let result = factorial(N);
  for (const k of Ks) {
    result = result / factorial(k);
  }

  return result;
}

/**
 * Calculate total cycle size for a set of reels
 * Total = reel1Length * reel2Length * ... * reelNLength
 */
export function totalCycleSize(reelLengths: number[]): bigint {
  if (reelLengths.length === 0) return ONE;
  return productBigInt(reelLengths.map(l => BigInt(l)));
}

/**
 * Calculate number of ways to get specific symbols on reels
 * Given symbol counts per reel, returns product of counts
 */
export function symbolCombinations(countsPerReel: number[]): bigint {
  if (countsPerReel.length === 0) return ONE;
  return productBigInt(countsPerReel.map(c => BigInt(c)));
}

/**
 * Calculate weighted probability
 * Returns: (product of weights) / (product of reel lengths)
 */
export function weightedProbability(
  weights: number[],
  reelLengths: number[]
): Decimal {
  if (weights.length !== reelLengths.length) {
    throw new Error('Weights and reel lengths must have same length');
  }

  const numerator = productBigInt(weights.map(w => BigInt(w)));
  const denominator = totalCycleSize(reelLengths);

  return safeDivide(dec(numerator.toString()), dec(denominator.toString()));
}

/**
 * Calculate ways to place k items in n positions
 * (with or without replacement)
 */
export function placementCount(
  n: number | bigint,
  k: number | bigint,
  withReplacement: boolean = false
): bigint {
  const N = typeof n === 'bigint' ? n : BigInt(n);
  const K = typeof k === 'bigint' ? k : BigInt(k);

  if (withReplacement) {
    // n^k placements
    return bigIntPow(N, K);
  } else {
    // n! / (n-k)! placements (same as permutations)
    return permutations(N, K);
  }
}

/**
 * Stirling numbers of the second kind S(n, k)
 * Number of ways to partition n elements into k non-empty subsets
 */
export function stirling2(n: number, k: number): bigint {
  if (k === 0) return n === 0 ? ONE : ZERO;
  if (k === 1 || k === n) return ONE;
  if (k > n) return ZERO;

  // Use recurrence: S(n,k) = k*S(n-1,k) + S(n-1,k-1)
  const dp: bigint[][] = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(k + 1).fill(ZERO);
  }

  const firstRow = dp[0];
  if (firstRow) {
    firstRow[0] = ONE;
  }

  for (let i = 1; i <= n; i++) {
    const row = dp[i];
    if (!row) continue;

    for (let j = 1; j <= Math.min(i, k); j++) {
      const prevRow = dp[i - 1];
      if (!prevRow) continue;

      const term1 = prevRow[j] ?? ZERO;
      const term2 = prevRow[j - 1] ?? ZERO;
      row[j] = BigInt(j) * term1 + term2;
    }
  }

  return dp[n]?.[k] ?? ZERO;
}

/**
 * Bell numbers B(n)
 * Total number of partitions of a set of n elements
 */
export function bell(n: number): bigint {
  if (n === 0) return ONE;

  let sum = ZERO;
  for (let k = 1; k <= n; k++) {
    sum += stirling2(n, k);
  }

  return sum;
}

/**
 * Derangement count D(n)
 * Number of permutations with no fixed points
 */
export function derangements(n: number): bigint {
  if (n === 0) return ONE;
  if (n === 1) return ZERO;

  // D(n) = (n-1) * (D(n-1) + D(n-2))
  let prev2 = ONE;  // D(0)
  let prev1 = ZERO; // D(1)

  for (let i = 2; i <= n; i++) {
    const current = BigInt(i - 1) * (prev1 + prev2);
    prev2 = prev1;
    prev1 = current;
  }

  return prev1;
}

/**
 * Catalan number C(n)
 * Counts many combinatorial structures
 */
export function catalan(n: number): bigint {
  if (n <= 1) return ONE;

  // C(n) = C(2n, n) / (n + 1)
  return binomial(2 * n, n) / BigInt(n + 1);
}

/**
 * Calculate cluster combinations
 * For cluster pay mechanics - number of ways to form clusters of size k
 * on an NxM grid
 */
export function clusterWays(
  gridRows: number,
  gridCols: number,
  clusterSize: number
): bigint {
  // This is a simplified approximation
  // Real cluster counting requires graph enumeration
  const totalCells = gridRows * gridCols;

  if (clusterSize > totalCells) return ZERO;
  if (clusterSize <= 0) return ZERO;

  // Approximate: C(totalCells, clusterSize) * connectivity factor
  // Real implementation would use polyomino enumeration
  return binomial(totalCells, clusterSize);
}

/**
 * Calculate ways to hit k specific positions on n reels
 * with m rows per reel (for ways-to-win evaluation)
 */
export function waysToWin(
  symbolCountsPerReel: number[]
): bigint {
  if (symbolCountsPerReel.length === 0) return ZERO;

  // Filter out zeros - no ways if any reel has 0 symbols
  if (symbolCountsPerReel.some(c => c === 0)) return ZERO;

  return productBigInt(symbolCountsPerReel.map(c => BigInt(c)));
}

/**
 * Calculate total combinations for a variable-ways spin.
 * Each reel can land a different number of symbol rows (e.g. 2-7),
 * so total combinations = product of per-reel row counts.
 */
export function variableWaysCombinations(symbolsPerReel: number[]): bigint {
  return productBigInt(symbolsPerReel.map(s => BigInt(s)));
}

/**
 * Reduce a fraction to lowest terms
 */
export function reduceFraction(numerator: bigint, denominator: bigint): [bigint, bigint] {
  if (denominator === ZERO) {
    throw new Error('Denominator cannot be zero');
  }

  const g = gcd(numerator, denominator);

  let num = numerator / g;
  let den = denominator / g;

  // Ensure denominator is positive
  if (den < ZERO) {
    num = -num;
    den = -den;
  }

  return [num, den];
}
