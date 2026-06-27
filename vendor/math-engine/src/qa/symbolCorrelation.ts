/**
 * SLOT MATH EXACT - Symbol Correlation Matrix
 *
 * Analyzes correlations between symbols across reels.
 * Important for:
 * - Detecting unintended symbol interactions
 * - Verifying independence assumptions
 * - Identifying clustering issues
 * - Win frequency validation
 *
 * A well-designed slot should have minimal cross-reel correlation
 * for truly random outcomes.
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import type { GameConfig, ReelSet } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Symbol pair correlation
 */
export interface SymbolPairCorrelation {
  /** First symbol */
  symbol1: string;
  /** Second symbol */
  symbol2: string;
  /** Observed co-occurrence probability */
  observed: Decimal;
  /** Expected co-occurrence probability (independence) */
  expected: Decimal;
  /** Correlation coefficient (-1 to 1) */
  correlation: Decimal;
  /** Chi-squared statistic */
  chiSquared: Decimal;
  /** P-value */
  pValue: Decimal;
  /** Is correlation significant? */
  significant: boolean;
  /** Interpretation */
  interpretation: 'POSITIVE' | 'NEGATIVE' | 'NONE';
}

/**
 * Full correlation matrix
 */
export interface CorrelationMatrix {
  /** Symbols in matrix (row/column headers) */
  symbols: string[];
  /** Matrix values (correlation coefficients) */
  matrix: Decimal[][];
  /** Significant correlations */
  significantPairs: SymbolPairCorrelation[];
  /** Overall independence score (0-1, 1 = fully independent) */
  independenceScore: Decimal;
  /** Largest positive correlation */
  maxPositiveCorrelation: SymbolPairCorrelation | null;
  /** Largest negative correlation */
  maxNegativeCorrelation: SymbolPairCorrelation | null;
}

/**
 * Cross-reel correlation analysis
 */
export interface CrossReelAnalysis {
  /** Reel pair (e.g., [0, 1] for reels 1-2) */
  reelPair: [number, number];
  /** Symbol correlations between these reels */
  symbolCorrelations: SymbolPairCorrelation[];
  /** Overall reel independence */
  reelIndependence: Decimal;
  /** Issues found */
  issues: string[];
}

/**
 * Complete symbol correlation result
 */
export interface SymbolCorrelationResult {
  /** Per-reel symbol frequency */
  reelFrequencies: Map<number, Map<string, Decimal>>;
  /** Cross-reel correlation matrices */
  crossReelMatrices: Map<string, CorrelationMatrix>;
  /** Cross-reel analyses */
  crossReelAnalyses: CrossReelAnalysis[];
  /** Symbol win correlation (which symbols appear together in wins) */
  winCorrelation: WinCorrelation;
  /** Overall assessment */
  assessment: CorrelationAssessment;
}

/**
 * Win correlation analysis
 */
export interface WinCorrelation {
  /** Symbols that frequently co-occur in wins */
  frequentWinPairs: Array<{
    symbols: [string, string];
    winFrequency: Decimal;
    expectedFrequency: Decimal;
    lift: Decimal;  // actual / expected
  }>;
  /** Symbols that rarely co-occur in wins (anti-correlation) */
  rareWinPairs: Array<{
    symbols: [string, string];
    winFrequency: Decimal;
    expectedFrequency: Decimal;
    lift: Decimal;
  }>;
}

/**
 * Overall correlation assessment
 */
export interface CorrelationAssessment {
  /** Pass/fail */
  passed: boolean;
  /** Independence score (0-100) */
  score: number;
  /** Issues found */
  issues: string[];
  /** Recommendations */
  recommendations: string[];
  /** Detailed checks */
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
}

// ============================================================================
// CORRELATION CALCULATOR
// ============================================================================

/**
 * Analyze symbol correlations in a game
 */
export function analyzeSymbolCorrelation(
  config: GameConfig,
  reelSetId: string,
  grids?: Array<{ grid: string[][]; weight: bigint }>
): SymbolCorrelationResult {
  const reelSet = config.reelSets.find(rs => rs.id === reelSetId);
  if (!reelSet) {
    throw new Error(`Reel set not found: ${reelSetId}`);
  }

  const symbols = config.symbols.map(s => s.id);

  // Calculate per-reel frequencies
  const reelFrequencies = calculateReelFrequencies(reelSet, symbols);

  // Calculate cross-reel correlation matrices
  const crossReelMatrices = new Map<string, CorrelationMatrix>();
  const crossReelAnalyses: CrossReelAnalysis[] = [];

  const numReels = reelSet.reels.length;
  for (let i = 0; i < numReels - 1; i++) {
    for (let j = i + 1; j < numReels; j++) {
      const key = `${i}-${j}`;
      const matrix = calculateCrossReelMatrix(
        reelSet,
        i,
        j,
        symbols,
        reelFrequencies
      );
      crossReelMatrices.set(key, matrix);

      // Analyze this reel pair
      const analysis = analyzeCrossReelPair(matrix, i, j);
      crossReelAnalyses.push(analysis);
    }
  }

  // Win correlation (if grids provided)
  const winCorrelation = grids
    ? analyzeWinCorrelation(config, grids)
    : { frequentWinPairs: [], rareWinPairs: [] };

  // Overall assessment
  const assessment = assessCorrelation(
    crossReelAnalyses,
    winCorrelation,
    reelFrequencies
  );

  return {
    reelFrequencies,
    crossReelMatrices,
    crossReelAnalyses,
    winCorrelation,
    assessment
  };
}

/**
 * Calculate symbol frequencies per reel
 */
function calculateReelFrequencies(
  reelSet: ReelSet,
  symbols: string[]
): Map<number, Map<string, Decimal>> {
  const frequencies = new Map<number, Map<string, Decimal>>();

  for (let reelIdx = 0; reelIdx < reelSet.reels.length; reelIdx++) {
    const reel = reelSet.reels[reelIdx];
    if (!reel) continue;
    const reelLength = reel.symbols.length;
    const symbolCounts = new Map<string, number>();

    // Count symbols
    for (const sym of reel.symbols) {
      symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
    }

    // Convert to frequencies
    const reelFreqs = new Map<string, Decimal>();
    for (const sym of symbols) {
      const count = symbolCounts.get(sym) ?? 0;
      reelFreqs.set(sym, dec(count).dividedBy(reelLength));
    }

    frequencies.set(reelIdx, reelFreqs);
  }

  return frequencies;
}

/**
 * Calculate cross-reel correlation matrix
 */
function calculateCrossReelMatrix(
  reelSet: ReelSet,
  reel1Idx: number,
  reel2Idx: number,
  symbols: string[],
  frequencies: Map<number, Map<string, Decimal>>
): CorrelationMatrix {
  const n = symbols.length;
  const matrix: Decimal[][] = Array(n).fill(null).map(() => Array(n).fill(ZERO));
  const significantPairs: SymbolPairCorrelation[] = [];

  const reel1Freqs = frequencies.get(reel1Idx)!;
  const reel2Freqs = frequencies.get(reel2Idx)!;

  // Calculate co-occurrence for each symbol pair
  // For reel strips, we compare corresponding positions
  const r1 = reelSet.reels[reel1Idx];
  const r2 = reelSet.reels[reel2Idx];
  if (!r1 || !r2) {
    return { symbols, matrix, significantPairs: [], independenceScore: ONE, maxPositiveCorrelation: null, maxNegativeCorrelation: null };
  }
  const reel1 = r1.symbols;
  const reel2 = r2.symbols;
  const minLength = Math.min(reel1.length, reel2.length);

  // Count co-occurrences
  const coOccurrences = new Map<string, number>();
  for (let pos = 0; pos < minLength; pos++) {
    const key = `${reel1[pos]}|${reel2[pos]}`;
    coOccurrences.set(key, (coOccurrences.get(key) ?? 0) + 1);
  }

  let maxPositive: SymbolPairCorrelation | null = null;
  let maxNegative: SymbolPairCorrelation | null = null;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const sym1 = symbols[i];
      const sym2 = symbols[j];
      if (!sym1 || !sym2) continue;

      const observed = dec(coOccurrences.get(`${sym1}|${sym2}`) ?? 0).dividedBy(minLength);
      const p1 = reel1Freqs.get(sym1) ?? ZERO;
      const p2 = reel2Freqs.get(sym2) ?? ZERO;
      const expected = p1.times(p2);

      // Calculate correlation (phi coefficient for binary)
      let correlation = ZERO;
      if (expected.greaterThan(ZERO)) {
        const diff = observed.minus(expected);
        const denom = expected.times(ONE.minus(p1)).times(ONE.minus(p2)).sqrt();
        correlation = denom.greaterThan(ZERO) ? safeDivide(diff, denom) : ZERO;
      }

      const matrixRow = matrix[i];
      if (matrixRow) {
        matrixRow[j] = correlation;
      }

      // Chi-squared test
      const chiSquared = calculateChiSquared(observed, expected, minLength);
      const pValue = calculatePValue(chiSquared, 1);
      const significant = pValue.lessThan(dec(0.05));

      if (significant || correlation.abs().greaterThan(dec(0.1))) {
        const pair: SymbolPairCorrelation = {
          symbol1: sym1,
          symbol2: sym2,
          observed,
          expected,
          correlation,
          chiSquared,
          pValue,
          significant,
          interpretation: correlation.greaterThan(dec(0.05)) ? 'POSITIVE' :
                          correlation.lessThan(dec(-0.05)) ? 'NEGATIVE' : 'NONE'
        };

        if (significant) {
          significantPairs.push(pair);
        }

        if (correlation.greaterThan(ZERO) &&
            (!maxPositive || correlation.greaterThan(maxPositive.correlation))) {
          maxPositive = pair;
        }

        if (correlation.lessThan(ZERO) &&
            (!maxNegative || correlation.lessThan(maxNegative.correlation))) {
          maxNegative = pair;
        }
      }
    }
  }

  // Independence score (1 - average absolute correlation)
  let totalAbsCorr = ZERO;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const matrixRow = matrix[i];
        const val = matrixRow?.[j];
        if (val) {
          totalAbsCorr = totalAbsCorr.plus(val.abs());
        }
        count++;
      }
    }
  }
  const avgAbsCorr = count > 0 ? totalAbsCorr.dividedBy(count) : ZERO;
  const independenceScore = ONE.minus(Decimal.min(avgAbsCorr, ONE));

  return {
    symbols,
    matrix,
    significantPairs: significantPairs.sort((a, b) =>
      b.correlation.abs().minus(a.correlation.abs()).toNumber()
    ),
    independenceScore,
    maxPositiveCorrelation: maxPositive,
    maxNegativeCorrelation: maxNegative
  };
}

/**
 * Calculate chi-squared statistic
 */
function calculateChiSquared(
  observed: Decimal,
  expected: Decimal,
  n: number
): Decimal {
  if (expected.isZero()) return ZERO;

  const diff = observed.minus(expected);
  return diff.pow(2).dividedBy(expected).times(n);
}

/**
 * Calculate p-value from chi-squared (approximation)
 */
function calculatePValue(chiSquared: Decimal, df: number): Decimal {
  // Use normal approximation for chi-squared
  const z = chiSquared.sqrt();
  const pValue = 2 * (1 - normalCDF(z.toNumber()));
  return dec(Math.max(0, Math.min(1, pValue)));
}

/**
 * Normal CDF approximation
 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Analyze a cross-reel pair
 */
function analyzeCrossReelPair(
  matrix: CorrelationMatrix,
  reel1: number,
  reel2: number
): CrossReelAnalysis {
  const issues: string[] = [];

  // Check for strong correlations
  for (const pair of matrix.significantPairs) {
    if (pair.correlation.abs().greaterThan(dec(0.2))) {
      issues.push(
        `Strong ${pair.interpretation.toLowerCase()} correlation between ${pair.symbol1} (reel ${reel1 + 1}) and ${pair.symbol2} (reel ${reel2 + 1}): ${pair.correlation.toFixed(3)}`
      );
    }
  }

  // Overall independence
  if (matrix.independenceScore.lessThan(dec(0.9))) {
    issues.push(`Low independence score (${matrix.independenceScore.toFixed(3)}) between reels ${reel1 + 1} and ${reel2 + 1}`);
  }

  return {
    reelPair: [reel1, reel2],
    symbolCorrelations: matrix.significantPairs,
    reelIndependence: matrix.independenceScore,
    issues
  };
}

/**
 * Analyze win correlation
 */
function analyzeWinCorrelation(
  config: GameConfig,
  grids: Array<{ grid: string[][]; weight: bigint }>
): WinCorrelation {
  // Track symbol co-occurrences in winning grids
  const pairCounts = new Map<string, bigint>();
  const symbolCounts = new Map<string, bigint>();
  let totalWeight = 0n;

  for (const { grid, weight } of grids) {
    // Check if grid is a win (simplified: any matching symbols)
    const symbols = grid.flat();
    const uniqueSymbols = [...new Set(symbols)];

    // Count individual symbols
    for (const sym of uniqueSymbols) {
      symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0n) + weight);
    }

    // Count pairs
    for (let i = 0; i < uniqueSymbols.length; i++) {
      for (let j = i + 1; j < uniqueSymbols.length; j++) {
        const pair = [uniqueSymbols[i], uniqueSymbols[j]].sort().join('|');
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0n) + weight);
      }
    }

    totalWeight += weight;
  }

  if (totalWeight === 0n) {
    return { frequentWinPairs: [], rareWinPairs: [] };
  }

  // Calculate expected pair frequencies
  const frequentWinPairs: WinCorrelation['frequentWinPairs'] = [];
  const rareWinPairs: WinCorrelation['rareWinPairs'] = [];

  for (const [pair, count] of pairCounts) {
    const [sym1, sym2] = pair.split('|');
    if (!sym1 || !sym2) continue;
    const p1 = Number(symbolCounts.get(sym1) ?? 0n) / Number(totalWeight);
    const p2 = Number(symbolCounts.get(sym2) ?? 0n) / Number(totalWeight);

    const winFrequency = dec(count.toString()).dividedBy(totalWeight.toString());
    const expectedFrequency = dec(p1 * p2);
    const lift = expectedFrequency.greaterThan(ZERO)
      ? safeDivide(winFrequency, expectedFrequency)
      : ZERO;

    const entry = {
      symbols: [sym1, sym2] as [string, string],
      winFrequency,
      expectedFrequency,
      lift
    };

    if (lift.greaterThan(dec(1.5))) {
      frequentWinPairs.push(entry);
    } else if (lift.lessThan(dec(0.5)) && expectedFrequency.greaterThan(dec(0.01))) {
      rareWinPairs.push(entry);
    }
  }

  // Sort by lift
  frequentWinPairs.sort((a, b) => b.lift.minus(a.lift).toNumber());
  rareWinPairs.sort((a, b) => a.lift.minus(b.lift).toNumber());

  return {
    frequentWinPairs: frequentWinPairs.slice(0, 10),
    rareWinPairs: rareWinPairs.slice(0, 10)
  };
}

/**
 * Overall correlation assessment
 */
function assessCorrelation(
  crossReelAnalyses: CrossReelAnalysis[],
  winCorrelation: WinCorrelation,
  reelFrequencies: Map<number, Map<string, Decimal>>
): CorrelationAssessment {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const checks: CorrelationAssessment['checks'] = [];

  // Check 1: Cross-reel independence
  const avgIndependence = crossReelAnalyses.length > 0
    ? crossReelAnalyses.reduce((sum, a) => sum + a.reelIndependence.toNumber(), 0) / crossReelAnalyses.length
    : 1;

  const independencePassed = avgIndependence >= 0.85;
  checks.push({
    name: 'Cross-Reel Independence',
    passed: independencePassed,
    detail: `Average independence: ${(avgIndependence * 100).toFixed(1)}%`
  });

  if (!independencePassed) {
    issues.push('Low cross-reel independence detected');
    recommendations.push('Review reel strip construction for unintended correlations');
  }

  // Check 2: Significant correlations
  const totalSignificant = crossReelAnalyses.reduce(
    (sum, a) => sum + a.symbolCorrelations.length, 0
  );
  const significantThreshold = crossReelAnalyses.length * 5; // Allow some significant pairs

  const significantPassed = totalSignificant <= significantThreshold;
  checks.push({
    name: 'Significant Correlations',
    passed: significantPassed,
    detail: `Found ${totalSignificant} significant correlations (threshold: ${significantThreshold})`
  });

  if (!significantPassed) {
    issues.push(`Too many significant correlations (${totalSignificant})`);
    recommendations.push('Randomize symbol positions on reel strips');
  }

  // Check 3: Win correlation
  const hasExtremeWinCorr = winCorrelation.frequentWinPairs.some(p => p.lift.greaterThan(dec(3))) ||
                            winCorrelation.rareWinPairs.some(p => p.lift.lessThan(dec(0.2)));

  checks.push({
    name: 'Win Correlation Balance',
    passed: !hasExtremeWinCorr,
    detail: hasExtremeWinCorr
      ? 'Extreme win correlations detected'
      : 'Win correlations within normal range'
  });

  if (hasExtremeWinCorr) {
    issues.push('Extreme win correlations may indicate design bias');
    recommendations.push('Review paytable and symbol placement for balance');
  }

  // Check 4: Symbol distribution uniformity
  let distributionIssues = 0;
  for (const [reelIdx, freqs] of reelFrequencies) {
    const values = Array.from(freqs.values());
    const maxFreq = Math.max(...values.map(v => v.toNumber()));
    const minFreq = Math.min(...values.filter(v => v.greaterThan(ZERO)).map(v => v.toNumber()));

    if (maxFreq / minFreq > 10) {
      distributionIssues++;
    }
  }

  const distributionPassed = distributionIssues === 0;
  checks.push({
    name: 'Symbol Distribution',
    passed: distributionPassed,
    detail: distributionIssues > 0
      ? `${distributionIssues} reels have highly uneven distribution`
      : 'Symbol distributions are balanced'
  });

  if (!distributionPassed) {
    issues.push('Highly uneven symbol distribution on some reels');
    recommendations.push('Consider adjusting symbol frequencies for better balance');
  }

  // Collect all issues from analyses
  for (const analysis of crossReelAnalyses) {
    issues.push(...analysis.issues);
  }

  // Overall score
  const passedChecks = checks.filter(c => c.passed).length;
  const score = Math.round((passedChecks / checks.length) * 100);

  return {
    passed: passedChecks === checks.length,
    score,
    issues: [...new Set(issues)].slice(0, 10),
    recommendations: [...new Set(recommendations)],
    checks
  };
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate correlation report
 */
export function generateCorrelationReport(result: SymbolCorrelationResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '              SYMBOL CORRELATION ANALYSIS REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Overall Score: ${result.assessment.score}/100`,
    `Status: ${result.assessment.passed ? '✓ PASSED' : '✗ FAILED'}`,
    ''
  ];

  // Checks
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('COMPLIANCE CHECKS');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const check of result.assessment.checks) {
    const icon = check.passed ? '✓' : '✗';
    lines.push(`${icon} ${check.name}: ${check.detail}`);
  }

  // Cross-reel analyses
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('CROSS-REEL INDEPENDENCE');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const analysis of result.crossReelAnalyses) {
    lines.push(`\nReels ${analysis.reelPair[0] + 1} - ${analysis.reelPair[1] + 1}:`);
    lines.push(`  Independence: ${(analysis.reelIndependence.toNumber() * 100).toFixed(1)}%`);
    lines.push(`  Significant correlations: ${analysis.symbolCorrelations.length}`);

    if (analysis.symbolCorrelations.length > 0) {
      lines.push('  Top correlations:');
      for (const corr of analysis.symbolCorrelations.slice(0, 3)) {
        lines.push(`    ${corr.symbol1} ↔ ${corr.symbol2}: ${corr.correlation.toFixed(3)} (${corr.interpretation})`);
      }
    }
  }

  // Win correlations
  if (result.winCorrelation.frequentWinPairs.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('WIN CORRELATION ANALYSIS');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('\nFrequently co-occurring in wins:');

    for (const pair of result.winCorrelation.frequentWinPairs.slice(0, 5)) {
      lines.push(`  ${pair.symbols[0]} + ${pair.symbols[1]}: lift = ${pair.lift.toFixed(2)}x`);
    }

    if (result.winCorrelation.rareWinPairs.length > 0) {
      lines.push('\nRarely co-occurring in wins:');
      for (const pair of result.winCorrelation.rareWinPairs.slice(0, 5)) {
        lines.push(`  ${pair.symbols[0]} + ${pair.symbols[1]}: lift = ${pair.lift.toFixed(2)}x`);
      }
    }
  }

  // Issues and recommendations
  if (result.assessment.issues.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('ISSUES FOUND');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const issue of result.assessment.issues) {
      lines.push(`  • ${issue}`);
    }
  }

  if (result.assessment.recommendations.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('RECOMMENDATIONS');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const rec of result.assessment.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  analyzeSymbolCorrelation as analyze,
  generateCorrelationReport as report
};
