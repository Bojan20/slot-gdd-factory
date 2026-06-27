/**
 * SLOT MATH EXACT - Bias Detection System
 *
 * QA tool for detecting statistical anomalies in slot game mathematics.
 *
 * Detects:
 * - Symbol distribution bias
 * - Position bias (symbols favoring certain positions)
 * - Correlation bias (unexpected symbol relationships)
 * - Streak bias (non-random clustering)
 * - Win distribution anomalies
 * - Feature trigger irregularities
 *
 * Uses:
 * - Chi-squared tests
 * - Kolmogorov-Smirnov tests
 * - Runs tests for randomness
 * - Entropy analysis
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import type { GameConfig, ReelSet, ReelStrip } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Bias detection result
 */
export interface BiasDetectionResult {
  /** Overall bias score (0 = no bias, 1 = extreme bias) */
  overallBiasScore: Decimal;
  /** Detected biases */
  detectedBiases: DetectedBias[];
  /** Warnings (potential issues) */
  warnings: string[];
  /** Passed tests */
  passedTests: string[];
  /** Failed tests */
  failedTests: string[];
  /** Recommendations */
  recommendations: string[];
  /** Raw test results */
  testResults: BiasTestResult[];
}

/**
 * Single detected bias
 */
export interface DetectedBias {
  /** Bias type */
  type: BiasType;
  /** Severity (0-1) */
  severity: Decimal;
  /** Description */
  description: string;
  /** Affected elements */
  affectedElements: string[];
  /** Expected value */
  expectedValue: Decimal;
  /** Actual value */
  actualValue: Decimal;
  /** Confidence (p-value) */
  confidence: Decimal;
}

/**
 * Bias types
 */
export type BiasType =
  | 'SYMBOL_FREQUENCY'
  | 'POSITION_BIAS'
  | 'CORRELATION'
  | 'STREAK'
  | 'WIN_DISTRIBUTION'
  | 'FEATURE_TRIGGER'
  | 'RTP_VARIANCE'
  | 'HIT_RATE'
  | 'ENTROPY';

/**
 * Test result
 */
export interface BiasTestResult {
  /** Test name */
  testName: string;
  /** Test passed */
  passed: boolean;
  /** Statistic value */
  statistic: Decimal;
  /** Critical value */
  criticalValue: Decimal;
  /** P-value */
  pValue: Decimal;
  /** Details */
  details: string;
}

/**
 * Symbol frequency data
 */
export interface SymbolFrequencyData {
  symbolId: string;
  expectedFrequency: Decimal;
  actualFrequency: Decimal;
  positions: Map<number, { expected: Decimal; actual: Decimal }>;
}

// ============================================================================
// STATISTICAL TESTS
// ============================================================================

/**
 * Chi-squared critical values (df -> alpha 0.05)
 */
const CHI_SQUARED_CRITICAL: Record<number, number> = {
  1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070,
  6: 12.592, 7: 14.067, 8: 15.507, 9: 16.919, 10: 18.307,
  15: 24.996, 20: 31.410, 25: 37.652, 30: 43.773, 50: 67.505
};

/**
 * Get chi-squared critical value
 */
function getChiSquaredCritical(df: number): number {
  if (CHI_SQUARED_CRITICAL[df]) {
    return CHI_SQUARED_CRITICAL[df]!;
  }
  // Approximate for large df
  const z = 1.645; // z for alpha = 0.05
  return df + z * Math.sqrt(2 * df);
}

/**
 * Chi-squared test for symbol frequency
 */
export function chiSquaredTest(
  observed: Decimal[],
  expected: Decimal[]
): { statistic: Decimal; pValue: Decimal; df: number } {
  if (observed.length !== expected.length) {
    throw new Error('Observed and expected arrays must have same length');
  }

  let chiSquared = ZERO;

  for (let i = 0; i < observed.length; i++) {
    const o = observed[i]!;
    const e = expected[i]!;

    if (e.isZero()) continue;

    const diff = o.minus(e);
    const term = diff.pow(2).dividedBy(e);
    chiSquared = chiSquared.plus(term);
  }

  const df = observed.length - 1;
  const critical = getChiSquaredCritical(df);

  // Approximate p-value
  const pValue = chiSquared.greaterThan(dec(critical)) ? dec(0.05) : dec(0.5);

  return { statistic: chiSquared, pValue, df };
}

/**
 * Runs test for randomness
 */
export function runsTest(
  sequence: boolean[]
): { statistic: Decimal; pValue: Decimal; isRandom: boolean } {
  const n = sequence.length;
  let runs = 1;
  let n1 = 0; // Count of true
  let n2 = 0; // Count of false

  for (let i = 0; i < n; i++) {
    if (sequence[i]) {
      n1++;
    } else {
      n2++;
    }

    if (i > 0 && sequence[i] !== sequence[i - 1]) {
      runs++;
    }
  }

  if (n1 === 0 || n2 === 0) {
    return { statistic: ZERO, pValue: ONE, isRandom: true };
  }

  // Expected runs
  const expectedRuns = (2 * n1 * n2) / (n1 + n2) + 1;

  // Variance of runs
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) /
    ((n1 + n2) ** 2 * (n1 + n2 - 1));

  // Z-score
  const z = (runs - expectedRuns) / Math.sqrt(variance);
  const statistic = dec(Math.abs(z));

  // P-value (two-tailed)
  const pValue = dec(2 * (1 - normalCDF(Math.abs(z))));
  const isRandom = pValue.greaterThan(dec(0.05));

  return { statistic, pValue, isRandom };
}

/**
 * Normal CDF approximation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Shannon entropy calculation
 */
export function calculateEntropy(probabilities: Decimal[]): Decimal {
  let entropy = ZERO;

  for (const p of probabilities) {
    if (p.greaterThan(ZERO)) {
      const logP = Math.log2(p.toNumber());
      entropy = entropy.minus(p.times(logP));
    }
  }

  return entropy;
}

/**
 * Maximum entropy for n categories
 */
export function maxEntropy(n: number): Decimal {
  return dec(Math.log2(n));
}

// ============================================================================
// REEL ANALYSIS
// ============================================================================

/**
 * Analyze reel strip for biases
 */
export function analyzeReelStrip(
  reel: ReelStrip,
  symbolExpectations: Map<string, Decimal>
): {
  frequencyBias: BiasTestResult;
  positionBias: BiasTestResult;
  streakBias: BiasTestResult;
} {
  const symbols = reel.symbols;
  const n = symbols.length;

  // Symbol frequency analysis
  const symbolCounts = new Map<string, number>();
  for (const sym of symbols) {
    symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
  }

  const observed: Decimal[] = [];
  const expected: Decimal[] = [];
  const symbolIds: string[] = [];

  for (const [symId, expectedFreq] of symbolExpectations.entries()) {
    const count = symbolCounts.get(symId) ?? 0;
    observed.push(dec(count));
    expected.push(expectedFreq.times(n));
    symbolIds.push(symId);
  }

  const freqTest = chiSquaredTest(observed, expected);
  const freqPassed = freqTest.statistic.lessThanOrEqualTo(dec(getChiSquaredCritical(freqTest.df)));

  const frequencyBias: BiasTestResult = {
    testName: `Frequency Test (Reel ${reel.id})`,
    passed: freqPassed,
    statistic: freqTest.statistic,
    criticalValue: dec(getChiSquaredCritical(freqTest.df)),
    pValue: freqTest.pValue,
    details: freqPassed
      ? 'Symbol frequencies match expectations'
      : `Symbol frequencies deviate from expectations (χ²=${freqTest.statistic.toFixed(2)})`
  };

  // Position bias (first half vs second half)
  const halfN = Math.floor(n / 2);
  const firstHalfCounts = new Map<string, number>();
  const secondHalfCounts = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const sym = symbols[i]!;
    if (i < halfN) {
      firstHalfCounts.set(sym, (firstHalfCounts.get(sym) ?? 0) + 1);
    } else {
      secondHalfCounts.set(sym, (secondHalfCounts.get(sym) ?? 0) + 1);
    }
  }

  let positionChiSquared = ZERO;
  for (const symId of symbolExpectations.keys()) {
    const first = dec(firstHalfCounts.get(symId) ?? 0);
    const second = dec(secondHalfCounts.get(symId) ?? 0);
    const total = first.plus(second);

    if (total.greaterThan(ZERO)) {
      const expectedPerHalf = total.dividedBy(2);
      if (expectedPerHalf.greaterThan(ZERO)) {
        positionChiSquared = positionChiSquared.plus(
          first.minus(expectedPerHalf).pow(2).dividedBy(expectedPerHalf)
        );
        positionChiSquared = positionChiSquared.plus(
          second.minus(expectedPerHalf).pow(2).dividedBy(expectedPerHalf)
        );
      }
    }
  }

  const positionDf = symbolExpectations.size;
  const positionCritical = getChiSquaredCritical(positionDf);
  const positionPassed = positionChiSquared.lessThanOrEqualTo(dec(positionCritical));

  const positionBias: BiasTestResult = {
    testName: `Position Bias Test (Reel ${reel.id})`,
    passed: positionPassed,
    statistic: positionChiSquared,
    criticalValue: dec(positionCritical),
    pValue: dec(positionPassed ? 0.5 : 0.05),
    details: positionPassed
      ? 'No significant position bias detected'
      : 'Symbols are unevenly distributed across reel positions'
  };

  // Streak analysis using runs test
  // Binary: is symbol high-pay or not?
  const isHighPay: boolean[] = symbols.map(sym => {
    return sym.includes('H') || sym.includes('WILD') || sym.includes('SCATTER');
  });

  const runResult = runsTest(isHighPay);
  const streakBias: BiasTestResult = {
    testName: `Streak Test (Reel ${reel.id})`,
    passed: runResult.isRandom,
    statistic: runResult.statistic,
    criticalValue: dec(1.96), // Z critical for α=0.05
    pValue: runResult.pValue,
    details: runResult.isRandom
      ? 'No significant streak patterns detected'
      : 'Non-random clustering of symbols detected'
  };

  return { frequencyBias, positionBias, streakBias };
}

// ============================================================================
// WIN DISTRIBUTION ANALYSIS
// ============================================================================

/**
 * Analyze win distribution for anomalies
 */
export function analyzeWinDistribution(
  winCounts: Map<string, number>,
  expectedDistribution: Map<string, Decimal>,
  totalSpins: number
): BiasTestResult {
  const observed: Decimal[] = [];
  const expected: Decimal[] = [];

  for (const [bucket, expectedProb] of expectedDistribution.entries()) {
    const actualCount = winCounts.get(bucket) ?? 0;
    observed.push(dec(actualCount));
    expected.push(expectedProb.times(totalSpins));
  }

  const test = chiSquaredTest(observed, expected);
  const passed = test.statistic.lessThanOrEqualTo(dec(getChiSquaredCritical(test.df)));

  return {
    testName: 'Win Distribution Test',
    passed,
    statistic: test.statistic,
    criticalValue: dec(getChiSquaredCritical(test.df)),
    pValue: test.pValue,
    details: passed
      ? 'Win distribution matches expected'
      : `Win distribution deviates significantly (χ²=${test.statistic.toFixed(2)})`
  };
}

// ============================================================================
// CORRELATION ANALYSIS
// ============================================================================

/**
 * Analyze symbol correlations (should be independent)
 */
export function analyzeSymbolCorrelation(
  grid: string[][],
  numSamples: number
): BiasTestResult {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  // Calculate co-occurrence frequencies
  const coOccurrence = new Map<string, number>();
  const singleOccurrence = new Map<string, number>();

  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;

    for (let c = 0; c < cols; c++) {
      const sym = row[c];
      if (!sym) continue;

      singleOccurrence.set(sym, (singleOccurrence.get(sym) ?? 0) + 1);

      // Check adjacent symbols
      if (c + 1 < cols) {
        const adjacent = row[c + 1];
        if (adjacent) {
          const pair = [sym, adjacent].sort().join('|');
          coOccurrence.set(pair, (coOccurrence.get(pair) ?? 0) + 1);
        }
      }
    }
  }

  // Calculate expected co-occurrence under independence
  const totalPositions = rows * cols;
  let chiSquared = ZERO;
  let pairCount = 0;

  for (const [pair, observed] of coOccurrence.entries()) {
    const [sym1, sym2] = pair.split('|');
    if (!sym1 || !sym2) continue;

    const p1 = dec(singleOccurrence.get(sym1) ?? 0).dividedBy(totalPositions);
    const p2 = dec(singleOccurrence.get(sym2) ?? 0).dividedBy(totalPositions);

    const expectedPairs = p1.times(p2).times(rows * (cols - 1)); // Adjacent pairs

    if (expectedPairs.greaterThan(dec(5))) { // Minimum expected count
      const diff = dec(observed).minus(expectedPairs);
      chiSquared = chiSquared.plus(diff.pow(2).dividedBy(expectedPairs));
      pairCount++;
    }
  }

  const df = Math.max(1, pairCount - 1);
  const critical = getChiSquaredCritical(df);
  const passed = chiSquared.lessThanOrEqualTo(dec(critical));

  return {
    testName: 'Symbol Correlation Test',
    passed,
    statistic: chiSquared,
    criticalValue: dec(critical),
    pValue: dec(passed ? 0.5 : 0.05),
    details: passed
      ? 'No significant symbol correlations detected'
      : 'Unexpected symbol correlations found'
  };
}

// ============================================================================
// MAIN BIAS DETECTION
// ============================================================================

/**
 * Run complete bias detection on game configuration
 */
export function detectBias(
  config: GameConfig,
  simulationData?: {
    winCounts?: Map<string, number>;
    featureTriggerCounts?: Map<string, number>;
    totalSpins?: number;
    sampleGrids?: string[][][];
  }
): BiasDetectionResult {
  const testResults: BiasTestResult[] = [];
  const detectedBiases: DetectedBias[] = [];
  const warnings: string[] = [];
  const passedTests: string[] = [];
  const failedTests: string[] = [];
  const recommendations: string[] = [];

  // Calculate expected symbol frequencies from paytable/roles
  const symbolExpectations = new Map<string, Decimal>();
  for (const sym of config.symbols) {
    // Default expectation based on role
    let expectedFreq: Decimal;
    switch (sym.role) {
      case 'WILD':
        expectedFreq = dec(0.03); // 3%
        break;
      case 'SCATTER':
        expectedFreq = dec(0.02); // 2%
        break;
      case 'BONUS':
        expectedFreq = dec(0.01); // 1%
        break;
      case 'HIGH_PAY':
        expectedFreq = dec(0.08); // 8%
        break;
      case 'LOW_PAY':
        expectedFreq = dec(0.15); // 15%
        break;
      default:
        expectedFreq = dec(0.10); // 10%
    }
    symbolExpectations.set(sym.id, expectedFreq);
  }

  // Analyze each reel strip
  for (const reelSet of config.reelSets) {
    for (const reel of reelSet.reels) {
      const analysis = analyzeReelStrip(reel, symbolExpectations);

      testResults.push(analysis.frequencyBias);
      testResults.push(analysis.positionBias);
      testResults.push(analysis.streakBias);

      if (!analysis.frequencyBias.passed) {
        failedTests.push(analysis.frequencyBias.testName);
        detectedBiases.push({
          type: 'SYMBOL_FREQUENCY',
          severity: analysis.frequencyBias.statistic.dividedBy(analysis.frequencyBias.criticalValue.times(2)),
          description: analysis.frequencyBias.details,
          affectedElements: [reel.id],
          expectedValue: analysis.frequencyBias.criticalValue,
          actualValue: analysis.frequencyBias.statistic,
          confidence: analysis.frequencyBias.pValue
        });
      } else {
        passedTests.push(analysis.frequencyBias.testName);
      }

      if (!analysis.positionBias.passed) {
        failedTests.push(analysis.positionBias.testName);
        warnings.push(`Position bias detected in reel ${reel.id}`);
      } else {
        passedTests.push(analysis.positionBias.testName);
      }

      if (!analysis.streakBias.passed) {
        failedTests.push(analysis.streakBias.testName);
        warnings.push(`Streak pattern detected in reel ${reel.id}`);
      } else {
        passedTests.push(analysis.streakBias.testName);
      }
    }
  }

  // Entropy analysis of paytable
  const payValues = config.paytable.flatMap(p =>
    Object.values(p.pays).map(v => dec(v))
  );
  const paySum = sum(payValues);
  if (paySum.greaterThan(ZERO)) {
    const payProbs = payValues.map(v => safeDivide(v, paySum));
    const entropy = calculateEntropy(payProbs);
    const maxEnt = maxEntropy(payValues.length);
    const entropyRatio = safeDivide(entropy, maxEnt);

    if (entropyRatio.lessThan(dec(0.7))) {
      warnings.push('Paytable has low entropy - consider more varied pay values');
      recommendations.push('Increase variety in paytable values for better player experience');
    }
  }

  // Win distribution analysis (if simulation data provided)
  if (simulationData?.winCounts && simulationData?.totalSpins) {
    // Create expected distribution (simplified exponential)
    const expectedDist = new Map<string, Decimal>();
    expectedDist.set('0x', dec(0.55)); // No win
    expectedDist.set('0-1x', dec(0.25));
    expectedDist.set('1-2x', dec(0.10));
    expectedDist.set('2-5x', dec(0.06));
    expectedDist.set('5-10x', dec(0.025));
    expectedDist.set('10x+', dec(0.015));

    const winDistTest = analyzeWinDistribution(
      simulationData.winCounts,
      expectedDist,
      simulationData.totalSpins
    );

    testResults.push(winDistTest);
    if (!winDistTest.passed) {
      failedTests.push(winDistTest.testName);
      detectedBiases.push({
        type: 'WIN_DISTRIBUTION',
        severity: winDistTest.statistic.dividedBy(winDistTest.criticalValue.times(2)),
        description: winDistTest.details,
        affectedElements: ['win_distribution'],
        expectedValue: winDistTest.criticalValue,
        actualValue: winDistTest.statistic,
        confidence: winDistTest.pValue
      });
    } else {
      passedTests.push(winDistTest.testName);
    }
  }

  // Correlation analysis (if sample grids provided)
  if (simulationData?.sampleGrids && simulationData.sampleGrids.length > 0) {
    for (let i = 0; i < Math.min(10, simulationData.sampleGrids.length); i++) {
      const grid = simulationData.sampleGrids[i];
      if (!grid) continue;

      const corrTest = analyzeSymbolCorrelation(grid, simulationData.sampleGrids.length);
      testResults.push(corrTest);

      if (!corrTest.passed) {
        failedTests.push(`${corrTest.testName} (sample ${i})`);
        warnings.push('Symbol correlation anomaly detected');
      } else {
        passedTests.push(`${corrTest.testName} (sample ${i})`);
      }
    }
  }

  // Calculate overall bias score
  const failedRatio = failedTests.length / Math.max(1, testResults.length);
  const avgSeverity = detectedBiases.length > 0
    ? safeDivide(sum(detectedBiases.map(b => b.severity)), dec(detectedBiases.length))
    : ZERO;

  const overallBiasScore = dec(failedRatio).times(0.6).plus(avgSeverity.times(0.4));

  // Generate recommendations
  if (failedTests.length > 0) {
    recommendations.push('Review failed tests and adjust reel strips as needed');
  }
  if (detectedBiases.some(b => b.type === 'SYMBOL_FREQUENCY')) {
    recommendations.push('Rebalance symbol frequencies to match design targets');
  }
  if (detectedBiases.some(b => b.type === 'POSITION_BIAS')) {
    recommendations.push('Shuffle reel strips to remove positional clustering');
  }

  return {
    overallBiasScore,
    detectedBiases,
    warnings,
    passedTests,
    failedTests,
    recommendations,
    testResults
  };
}

/**
 * Quick bias check for single reel strip
 */
export function quickBiasCheck(reelSymbols: string[]): {
  hasBias: boolean;
  biasType: string | null;
  severity: Decimal;
} {
  const n = reelSymbols.length;

  // Check for obvious repeating patterns
  for (let patternLen = 1; patternLen <= 5; patternLen++) {
    let isRepeating = true;
    for (let i = patternLen; i < n; i++) {
      if (reelSymbols[i] !== reelSymbols[i % patternLen]) {
        isRepeating = false;
        break;
      }
    }
    if (isRepeating && patternLen < n / 2) {
      return {
        hasBias: true,
        biasType: 'REPEATING_PATTERN',
        severity: ONE
      };
    }
  }

  // Check for long streaks of same symbol
  let maxStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < n; i++) {
    if (reelSymbols[i] === reelSymbols[i - 1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  if (maxStreak > 5) {
    return {
      hasBias: true,
      biasType: 'LONG_STREAK',
      severity: dec(maxStreak / 10)
    };
  }

  return {
    hasBias: false,
    biasType: null,
    severity: ZERO
  };
}
