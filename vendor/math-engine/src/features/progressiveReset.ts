/**
 * SLOT MATH EXACT - Progressive Jackpot Reset Cycle EV
 *
 * Calculates the expected value contribution from progressive jackpots
 * across their full reset cycle.
 *
 * Progressive jackpots are funded by a portion of each bet, growing
 * until won, then resetting to a seed value. The EV over a cycle is:
 *
 * Progressive RTP = Contribution Rate × (1 + Seed/Average_Jackpot)
 *
 * This module handles:
 * - Must-hit-by progressives
 * - Time-based progressives
 * - Multi-level progressive systems
 * - Network (wide-area) progressives
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
 * Progressive jackpot type
 */
export type ProgressiveType =
  | 'STANDARD'      // Grows indefinitely until won
  | 'MUST_HIT_BY'   // Guaranteed to hit before a threshold
  | 'TIME_BASED'    // Resets at specific intervals
  | 'MYSTERY'       // Can trigger randomly at any value
  | 'NETWORK';      // Shared across multiple games/casinos

/**
 * Progressive level configuration
 */
export interface ProgressiveLevelConfig {
  /** Level ID (e.g., 'mini', 'minor', 'major', 'grand') */
  id: string;
  /** Display name */
  name: string;
  /** Seed value (reset value after win) */
  seedValue: Decimal;
  /** Contribution rate from each bet (e.g., 0.005 = 0.5%) */
  contributionRate: Decimal;
  /** Progressive type */
  type: ProgressiveType;
  /** Must-hit-by threshold (for MUST_HIT_BY type) */
  mustHitBy?: Decimal;
  /** Hit probability per spin (for STANDARD type) */
  hitProbability?: Decimal;
  /** Maximum value (cap) */
  maxValue?: Decimal;
  /** Reserve percentage (house keeps) */
  reservePercentage?: Decimal;
}

/**
 * Progressive system configuration
 */
export interface ProgressiveSystemConfig {
  /** System name */
  name: string;
  /** Progressive levels */
  levels: ProgressiveLevelConfig[];
  /** Is this a network/linked progressive? */
  isNetwork: boolean;
  /** Network contribution (if network progressive) */
  networkContributionRate?: Decimal;
  /** Local vs network split */
  localVsNetworkSplit?: Decimal;
}

/**
 * Reset cycle analysis result for single level
 */
export interface LevelCycleAnalysis {
  /** Level ID */
  levelId: string;
  /** Expected value contribution to RTP */
  evContribution: Decimal;
  /** Average jackpot at hit */
  averageJackpotAtHit: Decimal;
  /** Expected spins between hits */
  expectedSpinsBetweenHits: Decimal;
  /** Variance of jackpot value at hit */
  jackpotVariance: Decimal;
  /** Hit frequency (1 in X spins) */
  hitFrequency: Decimal;
  /** Effective RTP from this level */
  effectiveRTP: Decimal;
  /** House edge on progressive */
  progressiveHouseEdge: Decimal;
  /** Cycle details */
  cycleDetails: CycleDetails;
}

/**
 * Cycle details
 */
export interface CycleDetails {
  /** Expected cycle length (spins) */
  expectedCycleLength: Decimal;
  /** Total contributed during cycle */
  totalContributed: Decimal;
  /** Amount won (average) */
  amountWon: Decimal;
  /** Reserve kept by house */
  reserveKept: Decimal;
  /** Effective player return */
  playerReturn: Decimal;
}

/**
 * Complete progressive analysis result
 */
export interface ProgressiveAnalysisResult {
  /** Per-level analysis */
  levels: LevelCycleAnalysis[];
  /** Total progressive RTP contribution */
  totalProgressiveRTP: Decimal;
  /** Total contribution rate (sum of all levels) */
  totalContributionRate: Decimal;
  /** System-level metrics */
  systemMetrics: SystemMetrics;
  /** Compliance assessment */
  compliance: ProgressiveCompliance;
}

/**
 * System-level metrics
 */
export interface SystemMetrics {
  /** Combined hit frequency (any jackpot) */
  anyHitFrequency: Decimal;
  /** Average win across all levels */
  averageWin: Decimal;
  /** Weighted average cycle length */
  averageCycleLength: Decimal;
  /** Total reserve rate */
  totalReserveRate: Decimal;
  /** Expected player return rate */
  playerReturnRate: Decimal;
}

/**
 * Progressive compliance result
 */
export interface ProgressiveCompliance {
  /** Overall pass/fail */
  passed: boolean;
  /** Contribution equals payout check */
  contributionPayoutBalance: {
    passed: boolean;
    contribution: Decimal;
    expectedPayout: Decimal;
    difference: Decimal;
  };
  /** Reserve within limits */
  reserveLimits: {
    passed: boolean;
    actualReserve: Decimal;
    maxAllowed: Decimal;
  };
  /** Must-hit-by compliance (if applicable) */
  mustHitByCompliance?: {
    passed: boolean;
    message: string;
  };
  /** Issues found */
  issues: string[];
}

// ============================================================================
// PROGRESSIVE ANALYZER
// ============================================================================

/**
 * Analyze progressive jackpot reset cycle EV
 */
export function analyzeProgressiveCycle(
  config: ProgressiveSystemConfig,
  averageBetSize: Decimal = ONE
): ProgressiveAnalysisResult {
  const levelAnalyses: LevelCycleAnalysis[] = [];

  for (const level of config.levels) {
    const analysis = analyzeSingleLevel(level, averageBetSize);
    levelAnalyses.push(analysis);
  }

  // Calculate totals
  const totalProgressiveRTP = sum(levelAnalyses.map(l => l.effectiveRTP));
  const totalContributionRate = sum(config.levels.map(l => l.contributionRate));

  // System metrics
  const systemMetrics = calculateSystemMetrics(levelAnalyses, config);

  // Compliance check
  const compliance = checkProgressiveCompliance(
    config,
    levelAnalyses,
    totalContributionRate,
    totalProgressiveRTP
  );

  return {
    levels: levelAnalyses,
    totalProgressiveRTP,
    totalContributionRate,
    systemMetrics,
    compliance
  };
}

/**
 * Analyze a single progressive level
 */
function analyzeSingleLevel(
  config: ProgressiveLevelConfig,
  averageBetSize: Decimal
): LevelCycleAnalysis {
  const {
    id,
    seedValue,
    contributionRate,
    type,
    mustHitBy,
    hitProbability,
    reservePercentage = ZERO
  } = config;

  let analysis: LevelCycleAnalysis;

  switch (type) {
    case 'MUST_HIT_BY':
      analysis = analyzeMustHitBy(config, averageBetSize);
      break;

    case 'STANDARD':
      analysis = analyzeStandard(config, averageBetSize);
      break;

    case 'MYSTERY':
      analysis = analyzeMystery(config, averageBetSize);
      break;

    case 'TIME_BASED':
    case 'NETWORK':
      // These use standard analysis with adjusted parameters
      analysis = analyzeStandard(config, averageBetSize);
      break;

    default:
      analysis = analyzeStandard(config, averageBetSize);
  }

  return analysis;
}

/**
 * Analyze must-hit-by progressive
 *
 * Must-hit-by progressives have a hidden trigger value uniformly
 * distributed between seed and must-hit-by threshold.
 */
function analyzeMustHitBy(
  config: ProgressiveLevelConfig,
  averageBetSize: Decimal
): LevelCycleAnalysis {
  const {
    id,
    seedValue,
    contributionRate,
    mustHitBy,
    reservePercentage = ZERO
  } = config;

  if (!mustHitBy) {
    throw new Error(`Must-hit-by threshold required for MUST_HIT_BY progressive: ${id}`);
  }

  // Contribution per spin
  const contributionPerSpin = averageBetSize.times(contributionRate);

  // For uniform distribution of trigger between seed and mustHitBy:
  // Average trigger = (seed + mustHitBy) / 2
  const averageTrigger = seedValue.plus(mustHitBy).dividedBy(2);

  // Expected spins to trigger = (averageTrigger - seed) / contributionPerSpin
  const expectedGrowth = averageTrigger.minus(seedValue);
  const expectedSpinsToCycle = contributionPerSpin.greaterThan(ZERO)
    ? safeDivide(expectedGrowth, contributionPerSpin)
    : dec(Infinity);

  // Average jackpot at hit equals average trigger value
  const averageJackpotAtHit = averageTrigger;

  // Variance: for uniform distribution on [a, b]: Var = (b-a)²/12
  const range = mustHitBy.minus(seedValue);
  const jackpotVariance = range.pow(2).dividedBy(12);

  // Hit frequency (1 in X spins)
  const hitFrequency = expectedSpinsToCycle;

  // Cycle details
  const totalContributed = expectedSpinsToCycle.times(contributionPerSpin);
  const reserveKept = totalContributed.times(reservePercentage);
  const amountWon = averageJackpotAtHit;
  const playerReturn = totalContributed.minus(reserveKept);

  // Effective RTP = amount won / total bet during cycle
  const totalBetDuringCycle = expectedSpinsToCycle.times(averageBetSize);
  const effectiveRTP = totalBetDuringCycle.greaterThan(ZERO)
    ? safeDivide(amountWon, totalBetDuringCycle)
    : ZERO;

  // EV contribution = hit probability × average jackpot
  const evContribution = safeDivide(averageJackpotAtHit, expectedSpinsToCycle);

  // House edge on progressive = reserve rate
  const progressiveHouseEdge = reservePercentage;

  return {
    levelId: id,
    evContribution,
    averageJackpotAtHit,
    expectedSpinsBetweenHits: expectedSpinsToCycle,
    jackpotVariance,
    hitFrequency,
    effectiveRTP,
    progressiveHouseEdge,
    cycleDetails: {
      expectedCycleLength: expectedSpinsToCycle,
      totalContributed,
      amountWon,
      reserveKept,
      playerReturn
    }
  };
}

/**
 * Analyze standard progressive (constant hit probability)
 */
function analyzeStandard(
  config: ProgressiveLevelConfig,
  averageBetSize: Decimal
): LevelCycleAnalysis {
  const {
    id,
    seedValue,
    contributionRate,
    hitProbability,
    reservePercentage = ZERO,
    maxValue
  } = config;

  // Default hit probability if not specified (rough industry average)
  const p = hitProbability ?? dec(1 / 5000000);

  // Contribution per spin
  const contributionPerSpin = averageBetSize.times(contributionRate);

  // Expected spins between hits = 1/p
  const expectedSpinsBetweenHits = safeDivide(ONE, p);

  // Average jackpot growth during cycle
  const expectedGrowth = expectedSpinsBetweenHits.times(contributionPerSpin);

  // Average jackpot at hit = seed + expected growth
  let averageJackpotAtHit = seedValue.plus(expectedGrowth);

  // Apply cap if exists
  if (maxValue && averageJackpotAtHit.greaterThan(maxValue)) {
    averageJackpotAtHit = maxValue;
  }

  // Variance: for geometric distribution, Var = (1-p)/p² in terms of jackpot value
  const varianceSpins = ONE.minus(p).dividedBy(p.pow(2));
  const jackpotVariance = varianceSpins.times(contributionPerSpin.pow(2));

  // Hit frequency
  const hitFrequency = expectedSpinsBetweenHits;

  // Cycle details
  const totalContributed = expectedSpinsBetweenHits.times(contributionPerSpin);
  const reserveKept = totalContributed.times(reservePercentage);
  const amountWon = averageJackpotAtHit;
  const playerReturn = totalContributed.minus(reserveKept);

  // Effective RTP
  const totalBetDuringCycle = expectedSpinsBetweenHits.times(averageBetSize);
  const effectiveRTP = totalBetDuringCycle.greaterThan(ZERO)
    ? safeDivide(amountWon, totalBetDuringCycle)
    : ZERO;

  // EV contribution
  const evContribution = p.times(averageJackpotAtHit);

  // House edge
  const progressiveHouseEdge = reservePercentage;

  return {
    levelId: id,
    evContribution,
    averageJackpotAtHit,
    expectedSpinsBetweenHits,
    jackpotVariance,
    hitFrequency,
    effectiveRTP,
    progressiveHouseEdge,
    cycleDetails: {
      expectedCycleLength: expectedSpinsBetweenHits,
      totalContributed,
      amountWon,
      reserveKept,
      playerReturn
    }
  };
}

/**
 * Analyze mystery progressive
 *
 * Mystery progressives can trigger at any value with equal probability.
 */
function analyzeMystery(
  config: ProgressiveLevelConfig,
  averageBetSize: Decimal
): LevelCycleAnalysis {
  const {
    id,
    seedValue,
    contributionRate,
    mustHitBy,
    reservePercentage = ZERO
  } = config;

  // Mystery progressives are similar to must-hit-by but with
  // potentially different trigger distributions
  // Using uniform distribution for simplicity
  return analyzeMustHitBy({
    ...config,
    mustHitBy: mustHitBy ?? seedValue.times(10)  // Default: 10x seed as max
  }, averageBetSize);
}

/**
 * Calculate system-level metrics
 */
function calculateSystemMetrics(
  levelAnalyses: LevelCycleAnalysis[],
  config: ProgressiveSystemConfig
): SystemMetrics {
  if (levelAnalyses.length === 0) {
    return {
      anyHitFrequency: ZERO,
      averageWin: ZERO,
      averageCycleLength: ZERO,
      totalReserveRate: ZERO,
      playerReturnRate: ZERO
    };
  }

  // Combined hit frequency: P(any hit) = 1 - Π(1 - P(level_i hit))
  // Approximation for rare events: sum of individual frequencies
  const anyHitProbability = sum(levelAnalyses.map(l =>
    safeDivide(ONE, l.hitFrequency)
  ));
  const anyHitFrequency = anyHitProbability.greaterThan(ZERO)
    ? safeDivide(ONE, anyHitProbability)
    : dec(Infinity);

  // Weighted average win
  const totalWeight = sum(levelAnalyses.map(l => safeDivide(ONE, l.hitFrequency)));
  const averageWin = totalWeight.greaterThan(ZERO)
    ? safeDivide(
        sum(levelAnalyses.map(l =>
          l.averageJackpotAtHit.times(safeDivide(ONE, l.hitFrequency))
        )),
        totalWeight
      )
    : ZERO;

  // Weighted average cycle length
  const avgCycleLength = safeDivide(
    sum(levelAnalyses.map(l => l.cycleDetails.expectedCycleLength)),
    dec(levelAnalyses.length)
  );

  // Total reserve rate
  const totalContributed = sum(levelAnalyses.map(l => l.cycleDetails.totalContributed));
  const totalReserve = sum(levelAnalyses.map(l => l.cycleDetails.reserveKept));
  const totalReserveRate = totalContributed.greaterThan(ZERO)
    ? safeDivide(totalReserve, totalContributed)
    : ZERO;

  // Player return rate = 1 - reserve rate
  const playerReturnRate = ONE.minus(totalReserveRate);

  return {
    anyHitFrequency,
    averageWin,
    averageCycleLength: avgCycleLength,
    totalReserveRate,
    playerReturnRate
  };
}

/**
 * Check progressive compliance
 */
function checkProgressiveCompliance(
  config: ProgressiveSystemConfig,
  levelAnalyses: LevelCycleAnalysis[],
  totalContributionRate: Decimal,
  totalProgressiveRTP: Decimal
): ProgressiveCompliance {
  const issues: string[] = [];

  // Check 1: Contribution should approximately equal payout
  // Progressive RTP should be close to contribution rate (minus reserve)
  const avgReserve = levelAnalyses.length > 0
    ? safeDivide(
        sum(levelAnalyses.map(l => l.progressiveHouseEdge)),
        dec(levelAnalyses.length)
      )
    : ZERO;

  const expectedPayout = totalContributionRate.times(ONE.minus(avgReserve));
  const difference = totalProgressiveRTP.minus(expectedPayout).abs();
  const contributionPayoutBalance = {
    passed: difference.lessThan(dec(0.01)), // Within 1%
    contribution: totalContributionRate,
    expectedPayout,
    difference
  };

  if (!contributionPayoutBalance.passed) {
    issues.push(`Progressive payout differs from contribution by ${(difference.toNumber() * 100).toFixed(2)}%`);
  }

  // Check 2: Reserve within limits (typically max 10% for progressives)
  const maxAllowedReserve = dec(0.10);
  const reserveLimits = {
    passed: avgReserve.lessThanOrEqualTo(maxAllowedReserve),
    actualReserve: avgReserve,
    maxAllowed: maxAllowedReserve
  };

  if (!reserveLimits.passed) {
    issues.push(`Reserve rate (${(avgReserve.toNumber() * 100).toFixed(1)}%) exceeds maximum (${(maxAllowedReserve.toNumber() * 100).toFixed(1)}%)`);
  }

  // Check 3: Must-hit-by compliance
  let mustHitByCompliance: ProgressiveCompliance['mustHitByCompliance'];

  for (const level of config.levels) {
    if (level.type === 'MUST_HIT_BY' && level.mustHitBy) {
      const analysis = levelAnalyses.find(l => l.levelId === level.id);

      if (analysis) {
        // Check that average hit is well below must-hit threshold
        const headroom = level.mustHitBy.minus(analysis.averageJackpotAtHit);
        const headroomRatio = safeDivide(headroom, level.mustHitBy);

        if (headroomRatio.lessThan(dec(0.1))) {
          mustHitByCompliance = {
            passed: false,
            message: `Level ${level.id}: Average hit too close to must-hit threshold (${(headroomRatio.toNumber() * 100).toFixed(1)}% headroom)`
          };
          issues.push(mustHitByCompliance.message);
        } else {
          mustHitByCompliance = {
            passed: true,
            message: `All must-hit-by levels have adequate headroom`
          };
        }
      }
    }
  }

  return {
    passed: contributionPayoutBalance.passed && reserveLimits.passed &&
            (!mustHitByCompliance || mustHitByCompliance.passed),
    contributionPayoutBalance,
    reserveLimits,
    mustHitByCompliance,
    issues
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate optimal must-hit-by threshold given target RTP contribution
 */
export function calculateOptimalMustHitBy(
  seedValue: Decimal,
  contributionRate: Decimal,
  targetRTPContribution: Decimal,
  averageBetSize: Decimal = ONE
): Decimal {
  // For must-hit-by with uniform trigger distribution:
  // RTP contribution ≈ contribution_rate × (1 + seed / (avg_hit - seed))
  // Solving for mustHitBy given seed and target RTP

  // avg_hit = (seed + mustHitBy) / 2
  // RTP = contribution_rate × avg_hit / avg_bets_in_cycle
  // avg_bets_in_cycle = (avg_hit - seed) / (bet × contribution_rate)

  // Simplified: mustHitBy ≈ 2 × (targetRTP / contribution) × seed
  const multiplier = safeDivide(targetRTPContribution, contributionRate).times(2);
  return seedValue.times(multiplier);
}

/**
 * Generate progressive report
 */
export function generateProgressiveReport(result: ProgressiveAnalysisResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '         PROGRESSIVE JACKPOT RESET CYCLE ANALYSIS',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Total Progressive RTP: ${(result.totalProgressiveRTP.toNumber() * 100).toFixed(4)}%`,
    `Total Contribution Rate: ${(result.totalContributionRate.toNumber() * 100).toFixed(4)}%`,
    '',
    '───────────────────────────────────────────────────────────────',
    'SYSTEM METRICS',
    '───────────────────────────────────────────────────────────────',
    `Any Hit Frequency: 1 in ${result.systemMetrics.anyHitFrequency.toFixed(0)} spins`,
    `Average Win: ${result.systemMetrics.averageWin.toFixed(2)}x`,
    `Average Cycle Length: ${result.systemMetrics.averageCycleLength.toFixed(0)} spins`,
    `Total Reserve Rate: ${(result.systemMetrics.totalReserveRate.toNumber() * 100).toFixed(2)}%`,
    `Player Return Rate: ${(result.systemMetrics.playerReturnRate.toNumber() * 100).toFixed(2)}%`,
    ''
  ];

  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('PER-LEVEL ANALYSIS');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const level of result.levels) {
    lines.push(`\n${level.levelId.toUpperCase()}:`);
    lines.push(`  EV Contribution: ${level.evContribution.toFixed(6)}x per spin`);
    lines.push(`  Average Jackpot at Hit: ${level.averageJackpotAtHit.toFixed(2)}x`);
    lines.push(`  Hit Frequency: 1 in ${level.hitFrequency.toFixed(0)} spins`);
    lines.push(`  Effective RTP: ${(level.effectiveRTP.toNumber() * 100).toFixed(4)}%`);
    lines.push(`  House Edge: ${(level.progressiveHouseEdge.toNumber() * 100).toFixed(2)}%`);
    lines.push(`  Cycle:`);
    lines.push(`    Expected Length: ${level.cycleDetails.expectedCycleLength.toFixed(0)} spins`);
    lines.push(`    Total Contributed: ${level.cycleDetails.totalContributed.toFixed(2)}x`);
    lines.push(`    Amount Won: ${level.cycleDetails.amountWon.toFixed(2)}x`);
    lines.push(`    Reserve Kept: ${level.cycleDetails.reserveKept.toFixed(4)}x`);
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('COMPLIANCE');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`Status: ${result.compliance.passed ? '✓ PASSED' : '✗ FAILED'}`);

  const checks = [
    {
      name: 'Contribution/Payout Balance',
      passed: result.compliance.contributionPayoutBalance.passed,
      detail: `Difference: ${(result.compliance.contributionPayoutBalance.difference.toNumber() * 100).toFixed(4)}%`
    },
    {
      name: 'Reserve Limits',
      passed: result.compliance.reserveLimits.passed,
      detail: `${(result.compliance.reserveLimits.actualReserve.toNumber() * 100).toFixed(2)}% (max ${(result.compliance.reserveLimits.maxAllowed.toNumber() * 100).toFixed(0)}%)`
    }
  ];

  if (result.compliance.mustHitByCompliance) {
    checks.push({
      name: 'Must-Hit-By',
      passed: result.compliance.mustHitByCompliance.passed,
      detail: result.compliance.mustHitByCompliance.message
    });
  }

  for (const check of checks) {
    const icon = check.passed ? '✓' : '✗';
    lines.push(`${icon} ${check.name}: ${check.detail}`);
  }

  if (result.compliance.issues.length > 0) {
    lines.push('\nIssues:');
    for (const issue of result.compliance.issues) {
      lines.push(`  • ${issue}`);
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
  analyzeProgressiveCycle as analyze,
  calculateOptimalMustHitBy as optimalMustHitBy,
  generateProgressiveReport as report
};
