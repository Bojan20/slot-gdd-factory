/**
 * SLOT MATH EXACT - Core Module Exports
 */

// Decimal exports
export {
  Decimal,
  ZERO,
  ONE,
  HUNDRED,
  dec,
  safeDivide,
  isValidProbability,
  assertProbability,
  probabilitiesSumToOne,
  assertProbabilitiesSum,
  normalizeProbabilities,
  weightedAverage,
  toPercent,
  fromPercent,
  formatDecimal,
  formatPercent,
  approxEqual,
  clamp,
  sum,
  product,
  max,
  min,
  isValidRTP,
  assertValidRTP
} from './decimal.js';

// Type exports
export type { DecimalValue } from './decimal.js';

// BigInt exports (with prefixed names)
export {
  ZERO as BIGINT_ZERO,
  ONE as BIGINT_ONE,
  toBigInt,
  bigIntToDecimal,
  bigIntDivide,
  bigIntFloorDiv,
  bigIntMod,
  bigIntPow,
  factorial,
  gcd,
  lcm,
  isSafeInteger,
  toSafeNumber,
  sumBigInt,
  productBigInt,
  maxBigInt,
  minBigInt,
  BigIntAccumulator,
  formatBigInt
} from './bigint.js';

// Combinatorics exports
export {
  binomial,
  permutations,
  multinomial,
  totalCycleSize,
  symbolCombinations,
  weightedProbability,
  placementCount,
  stirling2,
  bell,
  derangements,
  catalan,
  clusterWays,
  waysToWin,
  variableWaysCombinations,
  reduceFraction
} from './combinatorics.js';
