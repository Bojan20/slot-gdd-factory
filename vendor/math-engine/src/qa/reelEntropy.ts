/**
 * SLOT MATH EXACT - Reel Strip Entropy Analysis
 *
 * Analyzes the entropy (information content) of reel strips.
 * Important for:
 * - RNG quality verification
 * - Detecting artificial clustering
 * - Symbol distribution uniformity
 * - Pattern detection
 *
 * High entropy = more random, lower predictability
 * Low entropy = patterns, clustering, potential bias
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import type { GameConfig, ReelStrip, ReelSet } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Entropy analysis result for a single reel
 */
export interface ReelEntropyResult {
  /** Reel index */
  reelIndex: number;
  /** Shannon entropy (bits) */
  shannonEntropy: Decimal;
  /** Maximum possible entropy */
  maxEntropy: Decimal;
  /** Entropy ratio (actual / max) */
  entropyRatio: Decimal;
  /** Symbol distribution */
  symbolDistribution: Map<string, Decimal>;
  /** Gini coefficient (inequality measure) */
  giniCoefficient: Decimal;
  /** Run length analysis */
  runLengthStats: RunLengthStats;
  /** Pattern detection results */
  patternAnalysis: PatternAnalysis;
  /** Compliance assessment */
  compliance: EntropyCompliance;
}

/**
 * Run length statistics
 */
export interface RunLengthStats {
  /** Average run length */
  averageRunLength: Decimal;
  /** Maximum run length */
  maxRunLength: number;
  /** Run length distribution */
  runLengthDistribution: Map<number, number>;
  /** Expected run length (for random distribution) */
  expectedRunLength: Decimal;
  /** Deviation from expected */
  deviation: Decimal;
}

/**
 * Pattern analysis results
 */
export interface PatternAnalysis {
  /** Detected repeating patterns */
  repeatingPatterns: Pattern[];
  /** Symbol pair frequencies */
  pairFrequencies: Map<string, Decimal>;
  /** Autocorrelation at lag 1 */
  autocorrelation: Decimal;
  /** Is distribution suspicious? */
  suspicious: boolean;
  /** Suspicion reasons */
  suspicionReasons: string[];
}

/**
 * Detected pattern
 */
export interface Pattern {
  /** Pattern symbols */
  symbols: string[];
  /** Number of occurrences */
  occurrences: number;
  /** Expected occurrences (random) */
  expectedOccurrences: Decimal;
  /** Significance (z-score) */
  zScore: Decimal;
}

/**
 * Entropy compliance result
 */
export interface EntropyCompliance {
  /** Overall pass/fail */
  passed: boolean;
  /** Entropy ratio check */
  entropyCheck: {
    passed: boolean;
    threshold: number;
    actual: number;
  };
  /** Gini check */
  giniCheck: {
    passed: boolean;
    threshold: number;
    actual: number;
  };
  /** Pattern check */
  patternCheck: {
    passed: boolean;
    suspiciousPatterns: number;
  };
  /** Issues found */
  issues: string[];
}

/**
 * Full reel set entropy analysis
 */
export interface ReelSetEntropyResult {
  /** Per-reel results */
  reels: ReelEntropyResult[];
  /** Overall entropy score */
  overallScore: Decimal;
  /** Overall compliance */
  overallCompliance: boolean;
  /** Cross-reel correlation */
  crossReelCorrelation: Decimal;
  /** Summary statistics */
  summary: EntropySummary;
}

/**
 * Entropy summary
 */
export interface EntropySummary {
  /** Average entropy ratio across reels */
  averageEntropyRatio: Decimal;
  /** Minimum entropy ratio */
  minEntropyRatio: Decimal;
  /** Reel with lowest entropy */
  lowestEntropyReel: number;
  /** Total suspicious patterns found */
  totalSuspiciousPatterns: number;
  /** Recommendations */
  recommendations: string[];
}

// ============================================================================
// ENTROPY CALCULATOR
// ============================================================================

/**
 * Calculate entropy for a single reel strip
 */
export function analyzeReelEntropy(
  reel: ReelStrip,
  reelIndex: number,
  allSymbols: string[]
): ReelEntropyResult {
  const symbols = reel.symbols;
  const n = symbols.length;

  // Calculate symbol frequencies
  const symbolCounts = new Map<string, number>();
  for (const sym of symbols) {
    symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
  }

  // Convert to probabilities
  const symbolDistribution = new Map<string, Decimal>();
  for (const [sym, count] of symbolCounts) {
    symbolDistribution.set(sym, dec(count).dividedBy(n));
  }

  // Shannon entropy: H = -Σ p(x) × log2(p(x))
  let shannonEntropy = ZERO;
  for (const [, prob] of symbolDistribution) {
    if (prob.greaterThan(ZERO)) {
      const logProb = Math.log2(prob.toNumber());
      shannonEntropy = shannonEntropy.minus(prob.times(logProb));
    }
  }

  // Maximum entropy (uniform distribution over all symbols that appear)
  const uniqueSymbols = symbolCounts.size;
  const maxEntropy = dec(Math.log2(uniqueSymbols));

  // Entropy ratio
  const entropyRatio = maxEntropy.greaterThan(ZERO)
    ? safeDivide(shannonEntropy, maxEntropy)
    : ONE;

  // Gini coefficient
  const giniCoefficient = calculateGiniCoefficient(
    Array.from(symbolCounts.values())
  );

  // Run length analysis
  const runLengthStats = analyzeRunLengths(symbols);

  // Pattern analysis
  const patternAnalysis = analyzePatterns(symbols, symbolDistribution);

  // Compliance check
  const compliance = checkEntropyCompliance(
    entropyRatio,
    giniCoefficient,
    patternAnalysis
  );

  return {
    reelIndex,
    shannonEntropy,
    maxEntropy,
    entropyRatio,
    symbolDistribution,
    giniCoefficient,
    runLengthStats,
    patternAnalysis,
    compliance
  };
}

/**
 * Calculate Gini coefficient for distribution inequality
 *
 * 0 = perfect equality (all symbols equally frequent)
 * 1 = perfect inequality (one symbol dominates)
 */
function calculateGiniCoefficient(counts: number[]): Decimal {
  const n = counts.length;
  if (n <= 1) return ZERO;

  const sorted = [...counts].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);

  if (total === 0) return ZERO;

  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (2 * (i + 1) - n - 1) * (sorted[i] ?? 0);
  }

  return dec(numerator).dividedBy(n * total);
}

/**
 * Analyze run lengths in reel strip
 *
 * A "run" is a consecutive sequence of the same symbol.
 * Long runs indicate clustering, short runs indicate alternation.
 */
function analyzeRunLengths(symbols: string[]): RunLengthStats {
  if (symbols.length === 0) {
    return {
      averageRunLength: ZERO,
      maxRunLength: 0,
      runLengthDistribution: new Map(),
      expectedRunLength: ZERO,
      deviation: ZERO
    };
  }

  const runs: number[] = [];
  let currentRun = 1;
  let maxRun = 1;

  for (let i = 1; i < symbols.length; i++) {
    if (symbols[i] === symbols[i - 1]) {
      currentRun++;
    } else {
      runs.push(currentRun);
      if (currentRun > maxRun) maxRun = currentRun;
      currentRun = 1;
    }
  }
  runs.push(currentRun);
  if (currentRun > maxRun) maxRun = currentRun;

  // Distribution
  const runLengthDistribution = new Map<number, number>();
  for (const run of runs) {
    runLengthDistribution.set(run, (runLengthDistribution.get(run) ?? 0) + 1);
  }

  // Average
  const averageRunLength = dec(runs.reduce((a, b) => a + b, 0)).dividedBy(runs.length);

  // Expected run length for random sequence
  // E[run length] = 1 / (1 - p_same) where p_same = Σ p_i²
  const symbolCounts = new Map<string, number>();
  for (const sym of symbols) {
    symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
  }

  let pSame = 0;
  for (const count of symbolCounts.values()) {
    const p = count / symbols.length;
    pSame += p * p;
  }

  const expectedRunLength = pSame < 1 ? dec(1 / (1 - pSame)) : dec(symbols.length);

  // Deviation
  const deviation = averageRunLength.minus(expectedRunLength);

  return {
    averageRunLength,
    maxRunLength: maxRun,
    runLengthDistribution,
    expectedRunLength,
    deviation
  };
}

/**
 * Analyze patterns in reel strip
 */
function analyzePatterns(
  symbols: string[],
  distribution: Map<string, Decimal>
): PatternAnalysis {
  const n = symbols.length;
  const suspicious: string[] = [];

  // Pair frequencies
  const pairCounts = new Map<string, number>();
  for (let i = 0; i < n - 1; i++) {
    const pair = `${symbols[i]}-${symbols[i + 1]}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }

  const pairFrequencies = new Map<string, Decimal>();
  for (const [pair, count] of pairCounts) {
    pairFrequencies.set(pair, dec(count).dividedBy(n - 1));
  }

  // Check for non-random pair frequencies
  for (const [pair, freq] of pairFrequencies) {
    const [sym1, sym2] = pair.split('-');
    if (!sym1 || !sym2) continue;
    const p1 = distribution.get(sym1) ?? ZERO;
    const p2 = distribution.get(sym2) ?? ZERO;
    const expected = p1.times(p2);

    if (expected.greaterThan(dec(0.001))) {
      const ratio = safeDivide(freq, expected);
      if (ratio.greaterThan(dec(2)) || ratio.lessThan(dec(0.5))) {
        suspicious.push(`Pair ${pair} frequency ratio: ${ratio.toFixed(2)}`);
      }
    }
  }

  // Detect repeating patterns (length 2-5)
  const repeatingPatterns: Pattern[] = [];

  for (let patternLength = 2; patternLength <= 5; patternLength++) {
    const patternCounts = new Map<string, number>();

    for (let i = 0; i <= n - patternLength; i++) {
      const pattern = symbols.slice(i, i + patternLength).join('-');
      patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
    }

    // Check each pattern against expected frequency
    for (const [patternStr, count] of patternCounts) {
      const patternSymbols = patternStr.split('-');

      // Expected: product of individual probabilities
      let expected = ONE;
      for (const sym of patternSymbols) {
        expected = expected.times(distribution.get(sym) ?? ZERO);
      }
      expected = expected.times(n - patternLength + 1);

      if (expected.greaterThan(dec(0.5))) {
        const zScore = safeDivide(
          dec(count).minus(expected),
          expected.sqrt()
        );

        if (zScore.abs().greaterThan(dec(3))) {
          repeatingPatterns.push({
            symbols: patternSymbols,
            occurrences: count,
            expectedOccurrences: expected,
            zScore
          });

          if (zScore.greaterThan(dec(5))) {
            suspicious.push(
              `Pattern ${patternStr} appears ${count} times (expected ${expected.toFixed(1)})`
            );
          }
        }
      }
    }
  }

  // Autocorrelation at lag 1
  const autocorrelation = calculateAutocorrelation(symbols, distribution);

  return {
    repeatingPatterns: repeatingPatterns.sort((a, b) =>
      b.zScore.abs().minus(a.zScore.abs()).toNumber()
    ).slice(0, 10),
    pairFrequencies,
    autocorrelation,
    suspicious: suspicious.length > 0,
    suspicionReasons: suspicious
  };
}

/**
 * Calculate autocorrelation at lag 1
 *
 * High positive autocorrelation = clustering
 * High negative autocorrelation = alternation
 * Near zero = random
 */
function calculateAutocorrelation(
  symbols: string[],
  distribution: Map<string, Decimal>
): Decimal {
  const n = symbols.length;
  if (n <= 1) return ZERO;

  // Convert symbols to numeric values (index in sorted unique list)
  const uniqueSymbols = [...new Set(symbols)].sort();
  const symbolToNum = new Map<string, number>();
  uniqueSymbols.forEach((sym, idx) => symbolToNum.set(sym, idx));

  const numericValues = symbols.map(s => symbolToNum.get(s) ?? 0);

  // Mean and variance
  const mean = numericValues.reduce((a, b) => a + b, 0) / n;
  const variance = numericValues.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;

  if (variance === 0) return ZERO;

  // Autocorrelation at lag 1
  let autoCorr = 0;
  for (let i = 0; i < n - 1; i++) {
    autoCorr += ((numericValues[i] ?? 0) - mean) * ((numericValues[i + 1] ?? 0) - mean);
  }
  autoCorr /= (n - 1) * variance;

  return dec(autoCorr);
}

/**
 * Check entropy compliance
 */
function checkEntropyCompliance(
  entropyRatio: Decimal,
  giniCoefficient: Decimal,
  patternAnalysis: PatternAnalysis
): EntropyCompliance {
  const issues: string[] = [];

  // Entropy ratio threshold (should be > 0.85 for good randomness)
  const entropyThreshold = 0.85;
  const entropyPassed = entropyRatio.greaterThanOrEqualTo(dec(entropyThreshold));
  if (!entropyPassed) {
    issues.push(`Entropy ratio (${entropyRatio.toFixed(3)}) below threshold (${entropyThreshold})`);
  }

  // Gini threshold (should be < 0.4 for reasonable distribution)
  const giniThreshold = 0.4;
  const giniPassed = giniCoefficient.lessThanOrEqualTo(dec(giniThreshold));
  if (!giniPassed) {
    issues.push(`Gini coefficient (${giniCoefficient.toFixed(3)}) above threshold (${giniThreshold})`);
  }

  // Pattern check
  const suspiciousPatterns = patternAnalysis.repeatingPatterns.filter(
    p => p.zScore.abs().greaterThan(dec(4))
  ).length;
  const patternPassed = suspiciousPatterns === 0;
  if (!patternPassed) {
    issues.push(`Found ${suspiciousPatterns} suspicious patterns`);
  }

  return {
    passed: entropyPassed && giniPassed && patternPassed,
    entropyCheck: {
      passed: entropyPassed,
      threshold: entropyThreshold,
      actual: entropyRatio.toNumber()
    },
    giniCheck: {
      passed: giniPassed,
      threshold: giniThreshold,
      actual: giniCoefficient.toNumber()
    },
    patternCheck: {
      passed: patternPassed,
      suspiciousPatterns
    },
    issues
  };
}

// ============================================================================
// REEL SET ANALYSIS
// ============================================================================

/**
 * Analyze entropy for entire reel set
 */
export function analyzeReelSetEntropy(
  config: GameConfig,
  reelSetId: string
): ReelSetEntropyResult {
  const reelSet = config.reelSets.find(rs => rs.id === reelSetId);
  if (!reelSet) {
    throw new Error(`Reel set not found: ${reelSetId}`);
  }

  const allSymbols = config.symbols.map(s => s.id);

  // Analyze each reel
  const reels = reelSet.reels.map((reel, idx) =>
    analyzeReelEntropy(reel, idx, allSymbols)
  );

  // Overall compliance
  const overallCompliance = reels.every(r => r.compliance.passed);

  // Cross-reel correlation
  const crossReelCorrelation = calculateCrossReelCorrelation(reelSet.reels);

  // Summary
  const entropyRatios = reels.map(r => r.entropyRatio);
  const minEntropyRatio = entropyRatios.reduce((min, r) =>
    r.lessThan(min) ? r : min, entropyRatios[0] ?? ONE
  );
  const lowestEntropyReel = reels.findIndex(r => r.entropyRatio.equals(minEntropyRatio));

  const averageEntropyRatio = safeDivide(
    sum(entropyRatios),
    dec(entropyRatios.length)
  );

  const totalSuspiciousPatterns = reels.reduce(
    (sum, r) => sum + r.patternAnalysis.repeatingPatterns.filter(
      p => p.zScore.abs().greaterThan(dec(4))
    ).length,
    0
  );

  // Generate recommendations
  const recommendations: string[] = [];

  if (!overallCompliance) {
    recommendations.push('Review reel strips with failed compliance checks');
  }

  if (minEntropyRatio.lessThan(dec(0.8))) {
    recommendations.push(`Reel ${lowestEntropyReel + 1} has low entropy - consider redistributing symbols`);
  }

  if (crossReelCorrelation.abs().greaterThan(dec(0.3))) {
    recommendations.push('Cross-reel correlation detected - verify independence');
  }

  if (totalSuspiciousPatterns > 0) {
    recommendations.push(`Found ${totalSuspiciousPatterns} suspicious patterns - review for intentional clustering`);
  }

  // Overall score (0-100)
  const overallScore = Decimal.max(
    averageEntropyRatio.times(100)
      .minus(dec(totalSuspiciousPatterns * 5))
      .minus(crossReelCorrelation.abs().times(20)),
    ZERO
  );

  return {
    reels,
    overallScore,
    overallCompliance,
    crossReelCorrelation,
    summary: {
      averageEntropyRatio,
      minEntropyRatio,
      lowestEntropyReel,
      totalSuspiciousPatterns,
      recommendations
    }
  };
}

/**
 * Calculate cross-reel correlation
 *
 * Checks if symbol positions on one reel correlate with another.
 */
function calculateCrossReelCorrelation(reels: ReelStrip[]): Decimal {
  if (reels.length < 2) return ZERO;

  // Compare adjacent reels
  let totalCorr = 0;
  let comparisons = 0;

  for (let i = 0; i < reels.length - 1; i++) {
    const r1 = reels[i];
    const r2 = reels[i + 1];
    if (!r1 || !r2) continue;
    const reel1 = r1.symbols;
    const reel2 = r2.symbols;

    // Use shorter length
    const n = Math.min(reel1.length, reel2.length);

    // Count matching positions
    let matches = 0;
    for (let j = 0; j < n; j++) {
      if (reel1[j] === reel2[j]) matches++;
    }

    // Expected matches for random
    const uniqueSymbols = new Set([...reel1, ...reel2]).size;
    const expectedMatches = n / uniqueSymbols;

    // Correlation measure
    const corr = (matches - expectedMatches) / Math.sqrt(expectedMatches * (1 - 1 / uniqueSymbols));
    totalCorr += corr;
    comparisons++;
  }

  return dec(totalCorr / comparisons);
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate entropy report
 */
export function generateEntropyReport(result: ReelSetEntropyResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '                   REEL ENTROPY ANALYSIS REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Overall Score: ${result.overallScore.toFixed(1)}/100`,
    `Overall Compliance: ${result.overallCompliance ? '✓ PASSED' : '✗ FAILED'}`,
    `Cross-Reel Correlation: ${result.crossReelCorrelation.toFixed(4)}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'SUMMARY',
    '───────────────────────────────────────────────────────────────',
    `Average Entropy Ratio: ${result.summary.averageEntropyRatio.toFixed(4)}`,
    `Minimum Entropy Ratio: ${result.summary.minEntropyRatio.toFixed(4)} (Reel ${result.summary.lowestEntropyReel + 1})`,
    `Suspicious Patterns: ${result.summary.totalSuspiciousPatterns}`,
    ''
  ];

  if (result.summary.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS:');
    for (const rec of result.summary.recommendations) {
      lines.push(`  • ${rec}`);
    }
    lines.push('');
  }

  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('PER-REEL ANALYSIS');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const reel of result.reels) {
    lines.push(`\nReel ${reel.reelIndex + 1}:`);
    lines.push(`  Shannon Entropy: ${reel.shannonEntropy.toFixed(4)} bits`);
    lines.push(`  Max Entropy: ${reel.maxEntropy.toFixed(4)} bits`);
    lines.push(`  Entropy Ratio: ${reel.entropyRatio.toFixed(4)}`);
    lines.push(`  Gini Coefficient: ${reel.giniCoefficient.toFixed(4)}`);
    lines.push(`  Avg Run Length: ${reel.runLengthStats.averageRunLength.toFixed(2)} (expected: ${reel.runLengthStats.expectedRunLength.toFixed(2)})`);
    lines.push(`  Max Run Length: ${reel.runLengthStats.maxRunLength}`);
    lines.push(`  Autocorrelation: ${reel.patternAnalysis.autocorrelation.toFixed(4)}`);
    lines.push(`  Compliance: ${reel.compliance.passed ? '✓ PASSED' : '✗ FAILED'}`);

    if (reel.compliance.issues.length > 0) {
      lines.push('  Issues:');
      for (const issue of reel.compliance.issues) {
        lines.push(`    - ${issue}`);
      }
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
  analyzeReelEntropy as analyzeReel,
  analyzeReelSetEntropy as analyzeReelSet,
  generateEntropyReport as report
};
