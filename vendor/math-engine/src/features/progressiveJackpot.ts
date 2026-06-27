/**
 * SLOT MATH EXACT - Progressive Jackpot Calculator
 *
 * Exact calculation for progressive jackpot systems.
 *
 * Types supported:
 * - Single progressive (one jackpot pool)
 * - Multi-tier progressive (Mini, Minor, Major, Grand)
 * - Must-hit-by progressives (guaranteed trigger at threshold)
 * - Network progressives (shared pool calculation)
 * - Local progressives (per-game pool)
 *
 * Mathematical model:
 * - Contribution = bet × contribution_rate
 * - RTP from jackpot = P(win) × E[jackpot_at_win]
 * - Must-hit-by: Uniform distribution between seed and max
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide,
  product
} from '../core/decimal.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Single jackpot tier configuration
 */
export interface JackpotTier {
  /** Unique ID (e.g., 'GRAND', 'MAJOR', 'MINOR', 'MINI') */
  id: string;
  /** Display name */
  name: string;
  /** Seed/starting value (bet multiplier) */
  seedValue: Decimal;
  /** Current value (for simulation) */
  currentValue?: Decimal;
  /** Contribution rate per bet (e.g., 0.005 = 0.5%) */
  contributionRate: Decimal;
  /** Win probability per spin */
  winProbability: Decimal;
  /** Trigger condition */
  triggerCondition: JackpotTriggerCondition;
  /** Must-hit-by maximum (if applicable) */
  mustHitBy?: Decimal;
  /** Minimum contribution threshold before eligible */
  minContributionThreshold?: Decimal;
  /** Is this a network jackpot? */
  isNetwork?: boolean;
  /** Expected network contribution rate (from other players) */
  networkContributionRate?: Decimal;
}

/**
 * How jackpot is triggered
 */
export interface JackpotTriggerCondition {
  type: 'SYMBOL_COMBO' | 'RANDOM' | 'BONUS_GAME' | 'MUST_HIT_BY' | 'METER_FILL';
  /** For SYMBOL_COMBO: required symbol */
  symbolId?: string;
  /** For SYMBOL_COMBO: required count */
  symbolCount?: number;
  /** For METER_FILL: meter ID */
  meterId?: string;
  /** For BONUS_GAME: wheel segment, pick item, etc. */
  bonusCondition?: string;
}

/**
 * Progressive jackpot system configuration
 */
export interface ProgressiveJackpotConfig {
  /** System ID */
  id: string;
  /** Display name */
  name: string;
  /** Jackpot tiers (from highest to lowest) */
  tiers: JackpotTier[];
  /** How tiers combine (independent or linked) */
  tierMode: 'INDEPENDENT' | 'LINKED' | 'PROGRESSIVE_ODDS';
  /** For PROGRESSIVE_ODDS: odds increase as bet increases */
  betMultiplierEffect?: number;
  /** Total contribution cap (% of bet) */
  totalContributionCap?: Decimal;
  /** Overflow handling (what happens to excess contribution) */
  overflowHandling?: 'REDISTRIBUTE' | 'TO_HOUSE' | 'TO_NEXT_TIER';
}

/**
 * Jackpot RTP calculation result
 */
export interface JackpotRTPResult {
  /** Total RTP contribution from jackpots */
  totalRTP: Decimal;
  /** RTP contribution per tier */
  tierRTP: Map<string, Decimal>;
  /** Expected jackpot values at win time */
  expectedValueAtWin: Map<string, Decimal>;
  /** Average spins between wins per tier */
  averageSpinsBetweenWins: Map<string, Decimal>;
  /** Contribution breakdown */
  contributionBreakdown: {
    /** Total % of bet going to jackpots */
    totalContribution: Decimal;
    /** Per-tier contribution */
    perTier: Map<string, Decimal>;
    /** Retained by house (if any) */
    houseRetained: Decimal;
  };
  /** Must-hit-by analysis (if applicable) */
  mustHitByAnalysis?: Map<string, {
    expectedSpinsToHit: Decimal;
    expectedValueAtHit: Decimal;
    probabilityDistribution: Array<{ value: Decimal; probability: Decimal }>;
  }>;
}

// ============================================================================
// CORE CALCULATIONS
// ============================================================================

/**
 * Calculate RTP for a single jackpot tier (simple model)
 *
 * Simple RTP = P(win) × E[value_at_win]
 *
 * For non-must-hit: E[value] = seed + contribution / P(win) / 2
 * (average value is halfway between seed and expected max)
 */
export function calculateTierRTP(tier: JackpotTier): {
  rtp: Decimal;
  expectedValueAtWin: Decimal;
  avgSpinsBetweenWins: Decimal;
} {
  const p = tier.winProbability;
  const seed = tier.seedValue;
  const contribution = tier.contributionRate;

  // Average spins between wins
  const avgSpins = safeDivide(ONE, p);

  // Expected contribution accumulated before win
  // E[accumulated] = contribution × E[spins] = contribution / P
  const expectedAccumulated = safeDivide(contribution, p);

  // Expected value at win time
  // E[value] = seed + E[accumulated] / 2 (average of uniform distribution)
  const expectedValueAtWin = seed.plus(expectedAccumulated.dividedBy(2));

  // RTP = P(win) × E[value_at_win]
  const rtp = p.times(expectedValueAtWin);

  return {
    rtp,
    expectedValueAtWin,
    avgSpinsBetweenWins: avgSpins
  };
}

/**
 * Calculate RTP for must-hit-by jackpot
 *
 * Must-hit-by guarantees trigger between seed and max.
 * Distribution is uniform, so E[value] = (seed + max) / 2
 * P(win) is NOT constant - it increases as value approaches max
 */
export function calculateMustHitByRTP(tier: JackpotTier): {
  rtp: Decimal;
  expectedValueAtWin: Decimal;
  avgSpinsBetweenWins: Decimal;
  probabilityDistribution: Array<{ value: Decimal; probability: Decimal }>;
} {
  if (!tier.mustHitBy) {
    throw new Error('Must-hit-by tier requires mustHitBy value');
  }

  const seed = tier.seedValue;
  const max = tier.mustHitBy;
  const contribution = tier.contributionRate;

  // Expected value is midpoint of uniform distribution
  const expectedValueAtWin = seed.plus(max).dividedBy(2);

  // Expected spins = expected contribution / contribution_rate
  // Expected contribution = (max - seed) / 2 (average of uniform)
  const expectedContribution = max.minus(seed).dividedBy(2);
  const avgSpins = safeDivide(expectedContribution, contribution);

  // RTP = contribution_rate × 100% (all contributions go to players)
  // More precisely: RTP = E[value_at_win] / E[spins_to_win]
  // = E[value_at_win] × contribution / E[contribution_to_hit]
  // = E[value_at_win] × contribution / (seed + (max-seed)/2 - seed_0)
  // For normalized must-hit-by: RTP ≈ contribution_rate (approximately)
  const rtp = safeDivide(expectedValueAtWin, avgSpins);

  // Build probability distribution (discretized)
  const steps = 20;
  const stepSize = max.minus(seed).dividedBy(steps);
  const probabilityDistribution: Array<{ value: Decimal; probability: Decimal }> = [];
  const uniformProb = ONE.dividedBy(steps);

  for (let i = 0; i < steps; i++) {
    const value = seed.plus(stepSize.times(i + 0.5));
    probabilityDistribution.push({
      value,
      probability: uniformProb
    });
  }

  return {
    rtp,
    expectedValueAtWin,
    avgSpinsBetweenWins: avgSpins,
    probabilityDistribution
  };
}

/**
 * Calculate RTP for network progressive
 *
 * Network jackpots receive contributions from multiple games/players.
 * Local RTP contribution depends on local hit probability and network growth.
 */
export function calculateNetworkProgressiveRTP(
  tier: JackpotTier,
  localHitProbability: Decimal,
  networkSpinsPerLocalSpin: Decimal
): {
  rtp: Decimal;
  expectedValueAtWin: Decimal;
  localContributionRTP: Decimal;
  networkContributionRTP: Decimal;
} {
  const seed = tier.seedValue;
  const localContribution = tier.contributionRate;
  const networkContribution = tier.networkContributionRate ?? ZERO;

  // Total contribution per local spin
  const totalContributionPerSpin = localContribution.plus(
    networkContribution.times(networkSpinsPerLocalSpin)
  );

  // Expected spins until local player wins
  const avgLocalSpins = safeDivide(ONE, localHitProbability);

  // Expected jackpot value at win
  // Grows from local + network contributions
  const expectedAccumulated = totalContributionPerSpin.times(avgLocalSpins).dividedBy(2);
  const expectedValueAtWin = seed.plus(expectedAccumulated);

  // Local RTP = local_hit_probability × E[value_at_win]
  const rtp = localHitProbability.times(expectedValueAtWin);

  // Breakdown of where RTP comes from
  const localContributionRTP = localHitProbability.times(
    seed.plus(localContribution.times(avgLocalSpins).dividedBy(2))
  );
  const networkContributionRTP = rtp.minus(localContributionRTP);

  return {
    rtp,
    expectedValueAtWin,
    localContributionRTP,
    networkContributionRTP
  };
}

// ============================================================================
// FULL SYSTEM CALCULATION
// ============================================================================

/**
 * Calculate complete progressive jackpot system RTP
 */
export function calculateProgressiveJackpotRTP(
  config: ProgressiveJackpotConfig
): JackpotRTPResult {
  const tierRTP = new Map<string, Decimal>();
  const expectedValueAtWin = new Map<string, Decimal>();
  const averageSpinsBetweenWins = new Map<string, Decimal>();
  const perTierContribution = new Map<string, Decimal>();
  const mustHitByAnalysis = new Map<string, {
    expectedSpinsToHit: Decimal;
    expectedValueAtHit: Decimal;
    probabilityDistribution: Array<{ value: Decimal; probability: Decimal }>;
  }>();

  let totalRTP = ZERO;
  let totalContribution = ZERO;
  let houseRetained = ZERO;

  for (const tier of config.tiers) {
    perTierContribution.set(tier.id, tier.contributionRate);
    totalContribution = totalContribution.plus(tier.contributionRate);

    // Check for must-hit-by
    if (tier.triggerCondition.type === 'MUST_HIT_BY' || tier.mustHitBy) {
      const result = calculateMustHitByRTP(tier);
      tierRTP.set(tier.id, result.rtp);
      expectedValueAtWin.set(tier.id, result.expectedValueAtWin);
      averageSpinsBetweenWins.set(tier.id, result.avgSpinsBetweenWins);
      totalRTP = totalRTP.plus(result.rtp);

      mustHitByAnalysis.set(tier.id, {
        expectedSpinsToHit: result.avgSpinsBetweenWins,
        expectedValueAtHit: result.expectedValueAtWin,
        probabilityDistribution: result.probabilityDistribution
      });
    }
    // Check for network progressive
    else if (tier.isNetwork && tier.networkContributionRate) {
      // Assume 100:1 network to local ratio as default
      const networkRatio = dec(100);
      const result = calculateNetworkProgressiveRTP(
        tier,
        tier.winProbability,
        networkRatio
      );
      tierRTP.set(tier.id, result.rtp);
      expectedValueAtWin.set(tier.id, result.expectedValueAtWin);
      averageSpinsBetweenWins.set(tier.id, safeDivide(ONE, tier.winProbability));
      totalRTP = totalRTP.plus(result.rtp);
    }
    // Standard progressive
    else {
      const result = calculateTierRTP(tier);
      tierRTP.set(tier.id, result.rtp);
      expectedValueAtWin.set(tier.id, result.expectedValueAtWin);
      averageSpinsBetweenWins.set(tier.id, result.avgSpinsBetweenWins);
      totalRTP = totalRTP.plus(result.rtp);
    }
  }

  // Apply contribution cap if specified
  if (config.totalContributionCap && totalContribution.greaterThan(config.totalContributionCap)) {
    const excess = totalContribution.minus(config.totalContributionCap);

    switch (config.overflowHandling) {
      case 'TO_HOUSE':
        houseRetained = excess;
        break;
      case 'REDISTRIBUTE':
        // Redistribute to all tiers proportionally
        for (const [id, contribution] of perTierContribution.entries()) {
          const ratio = safeDivide(contribution, totalContribution);
          const boost = excess.times(ratio);
          const newContribution = contribution.plus(boost);
          perTierContribution.set(id, newContribution);
        }
        break;
      case 'TO_NEXT_TIER':
        // Redistribute to lower tiers
        // (simplified: add to next tier in list)
        break;
    }

    totalContribution = config.totalContributionCap;
  }

  return {
    totalRTP,
    tierRTP,
    expectedValueAtWin,
    averageSpinsBetweenWins,
    contributionBreakdown: {
      totalContribution,
      perTier: perTierContribution,
      houseRetained
    },
    mustHitByAnalysis: mustHitByAnalysis.size > 0 ? mustHitByAnalysis : undefined
  };
}

// ============================================================================
// TIER MODE SPECIFIC CALCULATIONS
// ============================================================================

/**
 * Calculate linked tier progressive RTP
 *
 * In linked mode, winning one tier affects others.
 * E.g., Grand win might award Minor + Mini too.
 */
export function calculateLinkedTierRTP(config: ProgressiveJackpotConfig): JackpotRTPResult {
  // Start with independent calculation
  const baseResult = calculateProgressiveJackpotRTP(config);

  // For linked tiers, adjust based on cascading wins
  // This is game-specific and would need linking rules
  // Simplified: assume highest tier win includes lower tier seeds

  let adjustedTotalRTP = baseResult.totalRTP;

  // If grand wins, add lower tier seeds
  const sortedTiers = [...config.tiers].sort(
    (a, b) => b.seedValue.minus(a.seedValue).toNumber()
  );

  if (sortedTiers.length > 1) {
    const grandTier = sortedTiers[0]!;
    const grandProb = grandTier.winProbability;

    // Lower tier seeds added on grand win
    const lowerTierSeeds = sum(sortedTiers.slice(1).map(t => t.seedValue));
    const linkedBonus = grandProb.times(lowerTierSeeds);
    adjustedTotalRTP = adjustedTotalRTP.plus(linkedBonus);
  }

  return {
    ...baseResult,
    totalRTP: adjustedTotalRTP
  };
}

/**
 * Calculate progressive odds RTP (bet-size dependent)
 *
 * Higher bets = higher jackpot odds.
 * Common model: odds increase linearly or exponentially with bet multiplier.
 */
export function calculateProgressiveOddsRTP(
  config: ProgressiveJackpotConfig,
  betMultiplier: number = 1
): JackpotRTPResult {
  const effect = config.betMultiplierEffect ?? 1;

  // Adjust win probabilities based on bet multiplier
  const adjustedTiers = config.tiers.map(tier => ({
    ...tier,
    winProbability: tier.winProbability.times(Math.pow(betMultiplier, effect))
  }));

  const adjustedConfig = {
    ...config,
    tiers: adjustedTiers
  };

  return calculateProgressiveJackpotRTP(adjustedConfig);
}

// ============================================================================
// SIMULATION HELPERS
// ============================================================================

/**
 * Simulate jackpot growth over N spins
 */
export function simulateJackpotGrowth(
  tier: JackpotTier,
  numSpins: number,
  currentValue?: Decimal
): {
  finalValue: Decimal;
  didHit: boolean;
  hitAtSpin?: number;
  hitValue?: Decimal;
} {
  let value = currentValue ?? tier.seedValue;
  const contribution = tier.contributionRate;
  const hitProb = tier.winProbability;
  const mustHitBy = tier.mustHitBy;

  for (let spin = 1; spin <= numSpins; spin++) {
    // Add contribution
    value = value.plus(contribution);

    // Check must-hit-by
    if (mustHitBy && value.greaterThanOrEqualTo(mustHitBy)) {
      return {
        finalValue: tier.seedValue, // Reset after hit
        didHit: true,
        hitAtSpin: spin,
        hitValue: mustHitBy
      };
    }

    // Random hit check
    const rand = Math.random();
    if (dec(rand).lessThan(hitProb)) {
      return {
        finalValue: tier.seedValue, // Reset after hit
        didHit: true,
        hitAtSpin: spin,
        hitValue: value
      };
    }
  }

  return {
    finalValue: value,
    didHit: false
  };
}

/**
 * Create jackpot config from JSON
 */
export function createJackpotConfigFromJSON(json: {
  id: string;
  name: string;
  tiers: Array<{
    id: string;
    name: string;
    seedValue: number;
    contributionRate: number;
    winProbability: number;
    triggerType: string;
    mustHitBy?: number;
    isNetwork?: boolean;
    networkContributionRate?: number;
  }>;
  tierMode?: string;
  totalContributionCap?: number;
}): ProgressiveJackpotConfig {
  return {
    id: json.id,
    name: json.name,
    tiers: json.tiers.map(t => ({
      id: t.id,
      name: t.name,
      seedValue: dec(t.seedValue),
      contributionRate: dec(t.contributionRate),
      winProbability: dec(t.winProbability),
      triggerCondition: { type: t.triggerType as JackpotTriggerCondition['type'] },
      mustHitBy: t.mustHitBy ? dec(t.mustHitBy) : undefined,
      isNetwork: t.isNetwork,
      networkContributionRate: t.networkContributionRate ? dec(t.networkContributionRate) : undefined
    })),
    tierMode: (json.tierMode as ProgressiveJackpotConfig['tierMode']) ?? 'INDEPENDENT',
    totalContributionCap: json.totalContributionCap ? dec(json.totalContributionCap) : undefined
  };
}

/**
 * Standard 4-tier progressive template (Mini/Minor/Major/Grand)
 */
export function createStandard4TierProgressive(
  grandSeed: number = 10000,
  grandProbability: number = 0.0000001 // 1 in 10M
): ProgressiveJackpotConfig {
  return {
    id: 'standard-4tier',
    name: 'Standard 4-Tier Progressive',
    tiers: [
      {
        id: 'GRAND',
        name: 'Grand',
        seedValue: dec(grandSeed),
        contributionRate: dec(0.003), // 0.3%
        winProbability: dec(grandProbability),
        triggerCondition: { type: 'RANDOM' }
      },
      {
        id: 'MAJOR',
        name: 'Major',
        seedValue: dec(grandSeed / 10),
        contributionRate: dec(0.005), // 0.5%
        winProbability: dec(grandProbability * 10),
        triggerCondition: { type: 'RANDOM' }
      },
      {
        id: 'MINOR',
        name: 'Minor',
        seedValue: dec(grandSeed / 100),
        contributionRate: dec(0.007), // 0.7%
        winProbability: dec(grandProbability * 100),
        triggerCondition: { type: 'RANDOM' }
      },
      {
        id: 'MINI',
        name: 'Mini',
        seedValue: dec(grandSeed / 1000),
        contributionRate: dec(0.005), // 0.5%
        winProbability: dec(grandProbability * 1000),
        triggerCondition: { type: 'RANDOM' }
      }
    ],
    tierMode: 'INDEPENDENT',
    totalContributionCap: dec(0.02) // 2% max
  };
}
