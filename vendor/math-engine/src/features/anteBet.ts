/**
 * SLOT MATH EXACT - Ante Bet / Feature Buy Calculator
 *
 * Exact RTP calculation for ante bet modes and feature buy options.
 *
 * Types supported:
 * - Ante Bet (increased bet for higher feature probability)
 * - Feature Buy (direct purchase of bonus feature)
 * - Super Bet (multiple ante levels)
 * - Bonus Buy with guaranteed values
 *
 * Mathematical model:
 * - Ante RTP = (base_RTP × ante_multiplier - ante_cost + feature_boost_EV) / total_bet
 * - Feature Buy RTP = feature_EV / buy_cost
 * - Must equal or match base game RTP for fairness
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
 * Ante bet level configuration
 */
export interface AnteBetLevel {
  /** Level ID (e.g., 'STANDARD', 'ANTE', 'SUPER_ANTE') */
  id: string;
  /** Display name */
  name: string;
  /** Bet multiplier (e.g., 1.0, 1.25, 1.5) */
  betMultiplier: Decimal;
  /** Feature trigger probability multiplier */
  featureProbabilityMultiplier: Decimal;
  /** Additional feature boost (added to base RTP) */
  featureRTPBoost?: Decimal;
  /** Affected features (or all if empty) */
  affectedFeatures?: string[];
  /** Does this level change reel strips? */
  changesReels?: boolean;
  /** Alternative reel set ID if reels change */
  alternativeReelSetId?: string;
}

/**
 * Feature buy option
 */
export interface FeatureBuyOption {
  /** Option ID */
  id: string;
  /** Display name */
  name: string;
  /** Cost (bet multiplier) */
  cost: Decimal;
  /** Feature triggered */
  featureId: string;
  /** Feature type for EV lookup */
  featureType: 'FREE_SPINS' | 'HOLD_AND_WIN' | 'PICK_BONUS' | 'WHEEL_BONUS' | 'CUSTOM';
  /** Expected value of the feature (bet multiplier) */
  featureEV: Decimal;
  /** Guaranteed minimum win (if any) */
  guaranteedMinWin?: Decimal;
  /** Guaranteed spins (for free spins) */
  guaranteedSpins?: number;
  /** Starting multiplier (for features with multipliers) */
  startingMultiplier?: number;
  /** Special conditions */
  specialConditions?: string[];
}

/**
 * Complete ante bet configuration
 */
export interface AnteBetConfig {
  /** Configuration ID */
  id: string;
  /** Game name */
  gameName: string;
  /** Base game RTP (without ante) */
  baseGameRTP: Decimal;
  /** Base feature trigger probability */
  baseFeatureProbability: Decimal;
  /** Base feature EV */
  baseFeatureEV: Decimal;
  /** Available ante levels */
  anteLevels: AnteBetLevel[];
  /** Feature buy options */
  featureBuyOptions?: FeatureBuyOption[];
  /** Target RTP for all modes (must match within tolerance) */
  targetRTP: Decimal;
  /** RTP tolerance (e.g., 0.0001 for ±0.01%) */
  rtpTolerance?: Decimal;
}

/**
 * Ante bet RTP result
 */
export interface AnteBetRTPResult {
  /** RTP for each ante level */
  levelRTPs: Map<string, {
    rtp: Decimal;
    effectiveBet: Decimal;
    featureProbability: Decimal;
    baseGameContribution: Decimal;
    featureContribution: Decimal;
  }>;
  /** RTP for each feature buy option */
  featureBuyRTPs: Map<string, {
    rtp: Decimal;
    cost: Decimal;
    expectedValue: Decimal;
    margin: Decimal;
  }>;
  /** Warnings (e.g., RTP mismatch) */
  warnings: string[];
  /** Is configuration valid? */
  isValid: boolean;
  /** Validation errors */
  errors: string[];
}

// ============================================================================
// CORE CALCULATIONS
// ============================================================================

/**
 * Calculate RTP for a single ante bet level
 *
 * Formula:
 * RTP = (base_game_wins + feature_wins) / total_bet
 *
 * Where:
 * - total_bet = base_bet × bet_multiplier
 * - feature_wins = feature_probability × feature_EV
 * - feature_probability = base_probability × probability_multiplier
 */
export function calculateAnteLevelRTP(
  level: AnteBetLevel,
  baseGameRTP: Decimal,
  baseFeatureProbability: Decimal,
  baseFeatureEV: Decimal
): {
  rtp: Decimal;
  effectiveBet: Decimal;
  featureProbability: Decimal;
  baseGameContribution: Decimal;
  featureContribution: Decimal;
} {
  const betMultiplier = level.betMultiplier;

  // Adjusted feature probability
  const featureProbability = baseFeatureProbability.times(level.featureProbabilityMultiplier);

  // Base game contribution (excluding feature)
  // If feature was part of base RTP, subtract it
  const baseFeatureRTPContribution = baseFeatureProbability.times(baseFeatureEV);
  const pureBaseGameRTP = baseGameRTP.minus(baseFeatureRTPContribution);

  // Feature contribution with ante
  const anteFeatureContribution = featureProbability.times(baseFeatureEV);

  // Add RTP boost if specified
  const rtpBoost = level.featureRTPBoost ?? ZERO;

  // Total wins per base bet = pure_base + ante_feature + boost
  const totalWinsPerBaseBet = pureBaseGameRTP.plus(anteFeatureContribution).plus(rtpBoost);

  // RTP = total_wins / total_bet
  const rtp = safeDivide(totalWinsPerBaseBet, betMultiplier);

  return {
    rtp,
    effectiveBet: betMultiplier,
    featureProbability,
    baseGameContribution: safeDivide(pureBaseGameRTP, betMultiplier),
    featureContribution: safeDivide(anteFeatureContribution.plus(rtpBoost), betMultiplier)
  };
}

/**
 * Calculate RTP for feature buy option
 *
 * Formula:
 * RTP = feature_EV / buy_cost
 *
 * For fair pricing: buy_cost = feature_EV / target_RTP
 */
export function calculateFeatureBuyRTP(option: FeatureBuyOption): {
  rtp: Decimal;
  cost: Decimal;
  expectedValue: Decimal;
  margin: Decimal;
} {
  const cost = option.cost;
  const ev = option.featureEV;

  // Apply guaranteed minimum adjustment
  let adjustedEV = ev;
  if (option.guaranteedMinWin && option.guaranteedMinWin.greaterThan(ZERO)) {
    // If EV is less than guaranteed min, use guaranteed min
    // This is simplified; actual calculation needs distribution adjustment
    adjustedEV = Decimal.max(ev, option.guaranteedMinWin);
  }

  const rtp = safeDivide(adjustedEV, cost);
  const margin = ONE.minus(rtp);

  return {
    rtp,
    cost,
    expectedValue: adjustedEV,
    margin
  };
}

/**
 * Calculate fair feature buy cost for target RTP
 */
export function calculateFairFeatureBuyCost(
  featureEV: Decimal,
  targetRTP: Decimal
): Decimal {
  return safeDivide(featureEV, targetRTP);
}

/**
 * Calculate required ante bet multiplier for target RTP
 *
 * Given:
 * - base_rtp, feature_prob, feature_ev, prob_multiplier, target_rtp
 *
 * Solve for bet_multiplier:
 * target_rtp = (base_wins + enhanced_feature) / bet_mult
 * bet_mult = (base_wins + enhanced_feature) / target_rtp
 */
export function calculateRequiredBetMultiplier(
  baseGameRTP: Decimal,
  baseFeatureProbability: Decimal,
  baseFeatureEV: Decimal,
  probabilityMultiplier: Decimal,
  targetRTP: Decimal
): Decimal {
  // Base feature contribution
  const baseFeatureContribution = baseFeatureProbability.times(baseFeatureEV);
  const pureBaseRTP = baseGameRTP.minus(baseFeatureContribution);

  // Enhanced feature contribution
  const enhancedFeatureProb = baseFeatureProbability.times(probabilityMultiplier);
  const enhancedFeatureContribution = enhancedFeatureProb.times(baseFeatureEV);

  // Total returns
  const totalReturns = pureBaseRTP.plus(enhancedFeatureContribution);

  // Required bet multiplier
  return safeDivide(totalReturns, targetRTP);
}

// ============================================================================
// FULL SYSTEM CALCULATION
// ============================================================================

/**
 * Calculate complete ante bet system RTP
 */
export function calculateAnteBetRTP(config: AnteBetConfig): AnteBetRTPResult {
  const levelRTPs = new Map<string, {
    rtp: Decimal;
    effectiveBet: Decimal;
    featureProbability: Decimal;
    baseGameContribution: Decimal;
    featureContribution: Decimal;
  }>();

  const featureBuyRTPs = new Map<string, {
    rtp: Decimal;
    cost: Decimal;
    expectedValue: Decimal;
    margin: Decimal;
  }>();

  const warnings: string[] = [];
  const errors: string[] = [];
  const tolerance = config.rtpTolerance ?? dec('0.0001');

  // Calculate RTP for each ante level
  for (const level of config.anteLevels) {
    const result = calculateAnteLevelRTP(
      level,
      config.baseGameRTP,
      config.baseFeatureProbability,
      config.baseFeatureEV
    );

    levelRTPs.set(level.id, result);

    // Check if RTP matches target
    const diff = result.rtp.minus(config.targetRTP).abs();
    if (diff.greaterThan(tolerance)) {
      warnings.push(
        `Ante level '${level.id}' RTP (${result.rtp.toFixed(4)}) differs from target ` +
        `(${config.targetRTP.toFixed(4)}) by ${diff.times(100).toFixed(4)}%`
      );
    }
  }

  // Calculate RTP for each feature buy option
  if (config.featureBuyOptions) {
    for (const option of config.featureBuyOptions) {
      const result = calculateFeatureBuyRTP(option);
      featureBuyRTPs.set(option.id, result);

      // Check if RTP matches target
      const diff = result.rtp.minus(config.targetRTP).abs();
      if (diff.greaterThan(tolerance)) {
        warnings.push(
          `Feature buy '${option.id}' RTP (${result.rtp.toFixed(4)}) differs from target ` +
          `(${config.targetRTP.toFixed(4)}) by ${diff.times(100).toFixed(4)}%`
        );
      }

      // Check for negative margin (player advantage)
      if (result.margin.lessThan(ZERO)) {
        errors.push(
          `Feature buy '${option.id}' has negative margin (${result.margin.times(100).toFixed(2)}%) - ` +
          `player advantage detected!`
        );
      }
    }
  }

  const isValid = errors.length === 0;

  return {
    levelRTPs,
    featureBuyRTPs,
    warnings,
    isValid,
    errors
  };
}

// ============================================================================
// ANTE BET DESIGN HELPERS
// ============================================================================

/**
 * Design ante bet levels for target RTP
 *
 * Creates a balanced ante system where all levels have same RTP
 */
export function designAnteBetLevels(
  baseGameRTP: Decimal,
  baseFeatureProbability: Decimal,
  baseFeatureEV: Decimal,
  targetRTP: Decimal,
  probabilityMultipliers: number[] = [1, 2, 3]
): AnteBetLevel[] {
  const levels: AnteBetLevel[] = [];

  for (let i = 0; i < probabilityMultipliers.length; i++) {
    const probMult = dec(probabilityMultipliers[i]!);

    // Calculate required bet multiplier for this probability boost
    const betMult = calculateRequiredBetMultiplier(
      baseGameRTP,
      baseFeatureProbability,
      baseFeatureEV,
      probMult,
      targetRTP
    );

    const levelNames = ['Standard', 'Ante Bet', 'Super Ante'];
    const levelIds = ['STANDARD', 'ANTE', 'SUPER_ANTE'];

    levels.push({
      id: levelIds[i] ?? `LEVEL_${i}`,
      name: levelNames[i] ?? `Level ${i + 1}`,
      betMultiplier: betMult,
      featureProbabilityMultiplier: probMult
    });
  }

  return levels;
}

/**
 * Design feature buy options for target RTP
 */
export function designFeatureBuyOptions(
  features: Array<{
    id: string;
    name: string;
    type: FeatureBuyOption['featureType'];
    ev: Decimal;
    guaranteedMin?: Decimal;
    guaranteedSpins?: number;
    startingMultiplier?: number;
  }>,
  targetRTP: Decimal
): FeatureBuyOption[] {
  return features.map(f => {
    const cost = calculateFairFeatureBuyCost(f.ev, targetRTP);

    return {
      id: f.id,
      name: f.name,
      cost,
      featureId: f.id,
      featureType: f.type,
      featureEV: f.ev,
      guaranteedMinWin: f.guaranteedMin,
      guaranteedSpins: f.guaranteedSpins,
      startingMultiplier: f.startingMultiplier
    };
  });
}

/**
 * Validate ante bet configuration
 */
export function validateAnteBetConfig(config: AnteBetConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check base RTP is valid
  if (config.baseGameRTP.lessThan(dec('0.80')) || config.baseGameRTP.greaterThan(dec('1.00'))) {
    errors.push(`Base game RTP (${config.baseGameRTP.toFixed(4)}) is outside valid range (80%-100%)`);
  }

  // Check target RTP
  if (config.targetRTP.lessThan(dec('0.80')) || config.targetRTP.greaterThan(dec('1.00'))) {
    errors.push(`Target RTP (${config.targetRTP.toFixed(4)}) is outside valid range (80%-100%)`);
  }

  // Check feature probability
  if (config.baseFeatureProbability.lessThanOrEqualTo(ZERO)) {
    errors.push('Base feature probability must be positive');
  }
  if (config.baseFeatureProbability.greaterThan(ONE)) {
    errors.push('Base feature probability cannot exceed 1');
  }

  // Check ante levels
  if (config.anteLevels.length === 0) {
    errors.push('At least one ante level is required');
  }

  for (const level of config.anteLevels) {
    if (level.betMultiplier.lessThanOrEqualTo(ZERO)) {
      errors.push(`Ante level '${level.id}' has invalid bet multiplier`);
    }
    if (level.featureProbabilityMultiplier.lessThanOrEqualTo(ZERO)) {
      errors.push(`Ante level '${level.id}' has invalid probability multiplier`);
    }
  }

  // Check feature buy options
  if (config.featureBuyOptions) {
    for (const option of config.featureBuyOptions) {
      if (option.cost.lessThanOrEqualTo(ZERO)) {
        errors.push(`Feature buy '${option.id}' has invalid cost`);
      }
      if (option.featureEV.lessThanOrEqualTo(ZERO)) {
        errors.push(`Feature buy '${option.id}' has invalid EV`);
      }
      if (option.guaranteedMinWin && option.guaranteedMinWin.greaterThan(option.featureEV)) {
        warnings.push(
          `Feature buy '${option.id}' guaranteed min (${option.guaranteedMinWin.toFixed(2)}) ` +
          `exceeds average EV (${option.featureEV.toFixed(2)})`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// EXAMPLE CONFIGURATIONS
// ============================================================================

/**
 * Create standard ante bet configuration: +25% bet pays 2× the base
 * feature trigger probability.
 */
export function createStandardAnteBetConfig(
  baseRTP: number = 0.9610,
  featureProb: number = 0.005, // 1 in 200
  featureEV: number = 100,     // 100x average
  targetRTP: number = 0.9610
): AnteBetConfig {
  const baseGameRTP = dec(baseRTP);
  const baseFeatureProbability = dec(featureProb);
  const baseFeatureEV = dec(featureEV);
  const target = dec(targetRTP);

  // Design balanced ante levels
  const anteLevels = designAnteBetLevels(
    baseGameRTP,
    baseFeatureProbability,
    baseFeatureEV,
    target,
    [1, 2] // Standard and 2x ante
  );

  // Design feature buy option
  const featureBuyOptions = designFeatureBuyOptions(
    [{
      id: 'BUY_FS',
      name: 'Buy Free Spins',
      type: 'FREE_SPINS',
      ev: baseFeatureEV,
      guaranteedSpins: 15
    }],
    target
  );

  return {
    id: 'standard-ante',
    gameName: 'Standard Ante Game',
    baseGameRTP,
    baseFeatureProbability,
    baseFeatureEV,
    anteLevels,
    featureBuyOptions,
    targetRTP: target,
    rtpTolerance: dec('0.0001')
  };
}

/**
 * Create multi-tier ante config: multiple ante levels with progressive trigger boosts.
 */
export function createMultiTierAnteBetConfig(
  baseRTP: number = 0.9640,
  targetRTP: number = 0.9640
): AnteBetConfig {
  const baseGameRTP = dec(baseRTP);
  const target = dec(targetRTP);

  // Multiple features with different probabilities
  const fsProb = dec(0.004);    // 1 in 250
  const fsEV = dec(80);
  const hwProb = dec(0.001);    // 1 in 1000
  const hwEV = dec(150);

  // Combined base feature contribution
  const baseFeatureProbability = fsProb.plus(hwProb);
  const baseFeatureEV = safeDivide(
    fsProb.times(fsEV).plus(hwProb.times(hwEV)),
    baseFeatureProbability
  );

  const anteLevels = designAnteBetLevels(
    baseGameRTP,
    baseFeatureProbability,
    baseFeatureEV,
    target,
    [1, 1.5, 2, 3]
  );

  const featureBuyOptions: FeatureBuyOption[] = [
    {
      id: 'BUY_FS',
      name: 'Buy Free Spins',
      cost: calculateFairFeatureBuyCost(fsEV, target),
      featureId: 'FREE_SPINS',
      featureType: 'FREE_SPINS',
      featureEV: fsEV,
      guaranteedSpins: 10
    },
    {
      id: 'BUY_FS_ENHANCED',
      name: 'Buy Enhanced Free Spins',
      cost: calculateFairFeatureBuyCost(fsEV.times(dec(1.5)), target),
      featureId: 'FREE_SPINS_ENHANCED',
      featureType: 'FREE_SPINS',
      featureEV: fsEV.times(dec(1.5)),
      guaranteedSpins: 15,
      startingMultiplier: 2
    },
    {
      id: 'BUY_HW',
      name: 'Buy Hold & Win',
      cost: calculateFairFeatureBuyCost(hwEV, target),
      featureId: 'HOLD_AND_WIN',
      featureType: 'HOLD_AND_WIN',
      featureEV: hwEV
    }
  ];

  return {
    id: 'multi-tier-ante',
    gameName: 'Multi-Tier Ante Game',
    baseGameRTP,
    baseFeatureProbability,
    baseFeatureEV,
    anteLevels,
    featureBuyOptions,
    targetRTP: target,
    rtpTolerance: dec('0.0001')
  };
}
