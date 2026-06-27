/**
 * SLOT MATH EXACT - Symbol Upgrade / Collection Mechanics
 *
 * Exact EV calculation for symbol upgrade and collection systems.
 *
 * Types supported:
 * - Symbol collectors (collect N → trigger/upgrade)
 * - Symbol transformers (low → high pay)
 * - Progressive upgrades (gradual improvement)
 * - Meter fill mechanics (collect to fill meter)
 *
 * Mathematical model:
 * - Uses geometric distribution for collection times
 * - Markov chains for state-based upgrades
 * - Conditional probability for trigger events
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import { binomial, bigIntToDecimal } from '../core/index.js';
import { MarkovChainBuilder, MarkovChainSolver, type MarkovChain } from '../markov/builder.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Collectable symbol definition
 */
export interface CollectableSymbol {
  /** Symbol ID */
  id: string;
  /** Probability per spin (of appearing in collectible position) */
  collectProbability: Decimal;
  /** Value per collected symbol */
  value: Decimal;
  /** Points contributed to meter */
  meterPoints?: number;
}

/**
 * Collection milestone
 */
export interface CollectionMilestone {
  /** Milestone ID */
  id: string;
  /** Required count to reach */
  requiredCount: number;
  /** Reward on reaching */
  reward: Decimal;
  /** Feature triggered */
  triggersFeature?: string;
  /** Symbol upgrade applied */
  upgradesSymbol?: SymbolUpgrade;
  /** Multiplier applied */
  multiplierApplied?: number;
}

/**
 * Symbol upgrade definition
 */
export interface SymbolUpgrade {
  /** Source symbol ID */
  fromSymbolId: string;
  /** Target symbol ID */
  toSymbolId: string;
  /** New pay values */
  newPayValues?: Record<string, Decimal>;
  /** Multiplier increase */
  multiplierIncrease?: number;
  /** Is upgrade permanent? */
  isPermanent?: boolean;
  /** Duration (spins) if not permanent */
  duration?: number;
}

/**
 * Collector configuration
 */
export interface CollectorConfig {
  /** Configuration ID */
  id: string;
  /** Display name */
  name: string;
  /** Symbols that can be collected */
  collectableSymbols: CollectableSymbol[];
  /** Collection milestones */
  milestones: CollectionMilestone[];
  /** Collection mode */
  mode: 'PER_SPIN' | 'CUMULATIVE' | 'PERSISTENT';
  /** Does collection reset after feature? */
  resetsAfterFeature?: boolean;
  /** Maximum collection per spin */
  maxCollectionPerSpin?: number;
  /** Spill-over behavior */
  spillOverBehavior?: 'LOST' | 'CARRIED' | 'INSTANT_REWARD';
}

/**
 * Symbol transformer configuration
 */
export interface SymbolTransformerConfig {
  /** Configuration ID */
  id: string;
  /** Display name */
  name: string;
  /** Transform rules */
  transforms: Array<{
    /** Condition for transform */
    condition: TransformCondition;
    /** Source symbols */
    fromSymbols: string[];
    /** Target symbol */
    toSymbol: string;
    /** Probability (if random) */
    probability?: Decimal;
  }>;
  /** When transforms apply */
  timing: 'BEFORE_EVAL' | 'AFTER_WIN' | 'DURING_CASCADE';
}

/**
 * Transform condition
 */
export interface TransformCondition {
  type: 'ALWAYS' | 'RANDOM' | 'WIN_OCCURRED' | 'NO_WIN' | 'SYMBOL_COUNT' | 'CASCADE_LEVEL';
  symbolId?: string;
  requiredCount?: number;
  cascadeLevel?: number;
}

/**
 * Meter configuration
 */
export interface MeterConfig {
  /** Meter ID */
  id: string;
  /** Display name */
  name: string;
  /** Maximum meter value */
  maxValue: number;
  /** Fill rate per spin (base) */
  baseFillRate: Decimal;
  /** Symbols that fill meter */
  fillingSymbols: Array<{
    symbolId: string;
    fillAmount: number;
    probability: Decimal;
  }>;
  /** Rewards at meter levels */
  levelRewards: Array<{
    level: number;
    reward: Decimal;
    triggersFeature?: string;
  }>;
  /** Does meter reset after trigger? */
  resetsOnTrigger?: boolean;
  /** Decay per spin (if applicable) */
  decayPerSpin?: number;
}

/**
 * Collection/upgrade result
 */
export interface CollectionResult {
  /** Expected value from collection system */
  expectedValue: Decimal;
  /** Expected spins to reach each milestone */
  milestoneTimes: Map<string, Decimal>;
  /** Expected collection per spin */
  expectedCollectionPerSpin: Decimal;
  /** Milestone probabilities (within N spins) */
  milestoneProbabilities: Map<string, Decimal>;
  /** RTP contribution */
  rtpContribution: Decimal;
}

// ============================================================================
// COLLECTION CALCULATIONS
// ============================================================================

/**
 * Calculate expected collection per spin
 */
export function calculateExpectedCollectionPerSpin(
  symbols: CollectableSymbol[]
): Decimal {
  return sum(symbols.map(s => s.collectProbability.times(s.value)));
}

/**
 * Calculate expected spins to reach count
 *
 * Uses negative binomial: E[spins] = target / probability
 */
export function calculateExpectedSpinsToCount(
  targetCount: number,
  collectionProbabilityPerSpin: Decimal
): Decimal {
  if (collectionProbabilityPerSpin.isZero()) {
    return dec(Infinity);
  }
  return dec(targetCount).dividedBy(collectionProbabilityPerSpin);
}

/**
 * Calculate probability of reaching count within N spins
 *
 * Uses cumulative binomial distribution
 */
export function calculateProbabilityOfReachingCount(
  targetCount: number,
  numSpins: number,
  collectionProbabilityPerSpin: Decimal
): Decimal {
  if (numSpins < targetCount) return ZERO;
  if (collectionProbabilityPerSpin.greaterThanOrEqualTo(ONE)) return ONE;

  // P(X >= target) = 1 - P(X < target) = 1 - Σ C(n,k) * p^k * (1-p)^(n-k) for k < target
  let probLessThanTarget = ZERO;
  const p = collectionProbabilityPerSpin;
  const q = ONE.minus(p);

  for (let k = 0; k < targetCount; k++) {
    const combinations = bigIntToDecimal(binomial(numSpins, k));
    const probExactlyK = combinations.times(p.pow(k)).times(q.pow(numSpins - k));
    probLessThanTarget = probLessThanTarget.plus(probExactlyK);
  }

  return ONE.minus(probLessThanTarget);
}

/**
 * Calculate collection system EV
 */
export function calculateCollectorEV(config: CollectorConfig): CollectionResult {
  const symbols = config.collectableSymbols;
  const milestones = config.milestones;

  // Expected collection per spin
  const expectedCollectionPerSpin = calculateExpectedCollectionPerSpin(symbols);

  // Average collection probability (for count-based milestones)
  const avgCollectProb = sum(symbols.map(s => s.collectProbability));

  // Calculate expected value from milestones
  let totalExpectedValue = ZERO;
  const milestoneTimes = new Map<string, Decimal>();
  const milestoneProbabilities = new Map<string, Decimal>();

  for (const milestone of milestones) {
    // Expected spins to reach this milestone
    const expectedSpins = calculateExpectedSpinsToCount(milestone.requiredCount, avgCollectProb);
    milestoneTimes.set(milestone.id, expectedSpins);

    // Probability of milestone per "session" (e.g., 100 spins)
    const sessionSpins = 100;
    const probWithinSession = calculateProbabilityOfReachingCount(
      milestone.requiredCount,
      sessionSpins,
      avgCollectProb
    );
    milestoneProbabilities.set(milestone.id, probWithinSession);

    // EV contribution = reward / expected_spins (per spin)
    if (expectedSpins.isFinite() && expectedSpins.greaterThan(ZERO)) {
      const milestoneEVPerSpin = safeDivide(milestone.reward, expectedSpins);
      totalExpectedValue = totalExpectedValue.plus(milestoneEVPerSpin);
    }
  }

  // Add direct collection value (if symbols have value)
  totalExpectedValue = totalExpectedValue.plus(expectedCollectionPerSpin);

  // RTP contribution (EV per spin)
  const rtpContribution = totalExpectedValue;

  return {
    expectedValue: totalExpectedValue,
    milestoneTimes,
    expectedCollectionPerSpin,
    milestoneProbabilities,
    rtpContribution
  };
}

// ============================================================================
// SYMBOL UPGRADE CALCULATIONS
// ============================================================================

/**
 * Calculate EV boost from symbol upgrade
 */
export function calculateUpgradeEVBoost(
  upgrade: SymbolUpgrade,
  baseSymbolEV: Decimal,
  upgradeSymbolEV: Decimal,
  symbolFrequency: Decimal
): Decimal {
  // EV boost = frequency × (new_ev - old_ev)
  const evDifference = upgradeSymbolEV.minus(baseSymbolEV);
  return symbolFrequency.times(evDifference);
}

/**
 * Calculate duration-weighted upgrade EV
 */
export function calculateDurationWeightedUpgradeEV(
  evBoostPerSpin: Decimal,
  upgradeDuration: number,
  upgradeProbability: Decimal
): Decimal {
  // EV = P(upgrade) × duration × boost_per_spin
  return upgradeProbability.times(upgradeDuration).times(evBoostPerSpin);
}

// ============================================================================
// METER CALCULATIONS
// ============================================================================

/**
 * Calculate meter fill EV using Markov chain
 */
export function calculateMeterEV(config: MeterConfig): {
  expectedValue: Decimal;
  expectedSpinsToFill: Decimal;
  fillProbabilityPerSpin: Decimal;
  levelProbabilities: Map<number, Decimal>;
} {
  const chain = buildMeterMarkovChain(config);
  const solver = new MarkovChainSolver(chain);
  const expectedValue = solver.solveExpectedValue();
  const visits = solver.solveExpectedVisits();

  // Calculate expected spins to fill
  let expectedSpinsToFill = ZERO;
  for (let level = 0; level <= config.maxValue; level++) {
    const stateId = `METER_${level}`;
    const visitCount = visits.get(stateId) ?? ZERO;
    expectedSpinsToFill = expectedSpinsToFill.plus(visitCount);
  }

  // Fill probability per spin
  const fillProbabilityPerSpin = safeDivide(ONE, expectedSpinsToFill);

  // Level probabilities
  const levelProbabilities = new Map<number, Decimal>();
  for (const levelReward of config.levelRewards) {
    const stateId = `METER_${levelReward.level}`;
    levelProbabilities.set(levelReward.level, visits.get(stateId) ?? ZERO);
  }

  return {
    expectedValue,
    expectedSpinsToFill,
    fillProbabilityPerSpin,
    levelProbabilities
  };
}

/**
 * Build Markov chain for meter mechanic
 */
function buildMeterMarkovChain(config: MeterConfig): MarkovChain {
  const builder = new MarkovChainBuilder();
  const maxValue = config.maxValue;

  // Terminal state (meter full)
  builder.addState('FULL', { isTerminal: true, expectedValue: ZERO });

  // Meter level states
  for (let level = 0; level <= maxValue; level++) {
    const stateId = `METER_${level}`;
    const isInitial = level === 0;

    // Find reward for this level
    const levelReward = config.levelRewards.find(r => r.level === level);
    const reward = levelReward?.reward ?? ZERO;

    builder.addState(stateId, {
      name: `Meter Level ${level}`,
      isInitial,
      expectedValue: reward
    });
  }

  // Add transitions for each level
  for (let level = 0; level < maxValue; level++) {
    const fromState = `METER_${level}`;

    // Calculate transition probabilities for each possible fill amount
    const fillProbabilities = new Map<number, Decimal>();
    let noFillProb = ONE;

    for (const filler of config.fillingSymbols) {
      const fillAmount = filler.fillAmount;
      const prob = filler.probability;
      const existing = fillProbabilities.get(fillAmount) ?? ZERO;
      fillProbabilities.set(fillAmount, existing.plus(prob));
      noFillProb = noFillProb.minus(prob);
    }

    // No fill transition
    if (noFillProb.greaterThan(ZERO)) {
      const decayedLevel = Math.max(0, level - (config.decayPerSpin ?? 0));
      if (decayedLevel === level) {
        // Stay at same level
        fillProbabilities.set(0, (fillProbabilities.get(0) ?? ZERO).plus(noFillProb));
      } else {
        builder.addTransition(fromState, `METER_${decayedLevel}`, noFillProb, ZERO);
      }
    }

    // Fill transitions
    for (const [fillAmount, prob] of fillProbabilities.entries()) {
      if (prob.isZero()) continue;

      const newLevel = Math.min(level + fillAmount, maxValue);
      const toState = newLevel >= maxValue ? 'FULL' : `METER_${newLevel}`;

      // Get reward for reaching new level
      const reward = config.levelRewards.find(r => r.level === newLevel)?.reward ?? ZERO;

      builder.addTransition(fromState, toState, prob, reward);
    }
  }

  // Full meter transitions (reset or stay)
  if (config.resetsOnTrigger) {
    // Get full reward
    const fullReward = config.levelRewards.find(r => r.level === maxValue)?.reward ?? ZERO;
    builder.addState('REWARD', { isTerminal: true, expectedValue: fullReward });
    builder.addTransition('FULL', 'REWARD', ONE, ZERO);
  } else {
    // Stay full
    builder.addTransition('FULL', 'FULL', ONE, ZERO);
  }

  return builder.build();
}

// ============================================================================
// SYMBOL TRANSFORMER CALCULATIONS
// ============================================================================

/**
 * Calculate EV impact of symbol transformations
 */
export function calculateTransformerEV(
  config: SymbolTransformerConfig,
  symbolEVs: Map<string, Decimal>
): {
  expectedValue: Decimal;
  transformProbabilities: Map<string, Decimal>;
  evBoostPerTransform: Map<string, Decimal>;
} {
  let totalExpectedValue = ZERO;
  const transformProbabilities = new Map<string, Decimal>();
  const evBoostPerTransform = new Map<string, Decimal>();

  for (const transform of config.transforms) {
    const transformId = `${transform.fromSymbols.join(',')} → ${transform.toSymbol}`;
    const prob = transform.probability ?? ONE;

    // Calculate EV boost
    const targetEV = symbolEVs.get(transform.toSymbol) ?? ZERO;
    let avgSourceEV = ZERO;
    for (const sourceSymbol of transform.fromSymbols) {
      avgSourceEV = avgSourceEV.plus(symbolEVs.get(sourceSymbol) ?? ZERO);
    }
    avgSourceEV = safeDivide(avgSourceEV, dec(transform.fromSymbols.length));

    const evBoost = targetEV.minus(avgSourceEV).times(prob);
    totalExpectedValue = totalExpectedValue.plus(evBoost);

    transformProbabilities.set(transformId, prob);
    evBoostPerTransform.set(transformId, evBoost);
  }

  return {
    expectedValue: totalExpectedValue,
    transformProbabilities,
    evBoostPerTransform
  };
}

// ============================================================================
// COMBINED SYSTEM CALCULATION
// ============================================================================

/**
 * Calculate complete symbol upgrade system EV
 */
export function calculateSymbolUpgradeSystemEV(
  collector: CollectorConfig | null,
  transformer: SymbolTransformerConfig | null,
  meter: MeterConfig | null,
  symbolEVs: Map<string, Decimal>
): {
  totalExpectedValue: Decimal;
  collectionEV: Decimal;
  transformerEV: Decimal;
  meterEV: Decimal;
  breakdown: Record<string, Decimal>;
} {
  let collectionEV = ZERO;
  let transformerEV = ZERO;
  let meterEV = ZERO;

  if (collector) {
    const result = calculateCollectorEV(collector);
    collectionEV = result.expectedValue;
  }

  if (transformer) {
    const result = calculateTransformerEV(transformer, symbolEVs);
    transformerEV = result.expectedValue;
  }

  if (meter) {
    const result = calculateMeterEV(meter);
    meterEV = result.expectedValue;
  }

  const totalExpectedValue = collectionEV.plus(transformerEV).plus(meterEV);

  return {
    totalExpectedValue,
    collectionEV,
    transformerEV,
    meterEV,
    breakdown: {
      collection: collectionEV,
      transformer: transformerEV,
      meter: meterEV
    }
  };
}

// ============================================================================
// HELPER FACTORIES
// ============================================================================

/**
 * Create standard coin collector config
 */
export function createCoinCollectorConfig(
  coinProbability: number = 0.1,
  coinValue: number = 1,
  milestones: Array<{ count: number; reward: number }> = [
    { count: 10, reward: 5 },
    { count: 25, reward: 15 },
    { count: 50, reward: 50 }
  ]
): CollectorConfig {
  return {
    id: 'coin-collector',
    name: 'Coin Collector',
    collectableSymbols: [{
      id: 'COIN',
      collectProbability: dec(coinProbability),
      value: dec(coinValue)
    }],
    milestones: milestones.map((m, idx) => ({
      id: `MILESTONE_${idx + 1}`,
      requiredCount: m.count,
      reward: dec(m.reward)
    })),
    mode: 'CUMULATIVE'
  };
}

/**
 * Create symbol upgrade progression
 */
export function createSymbolUpgradeProgression(
  symbolId: string,
  upgrades: Array<{ newPayMultiplier: number; probability: number }>
): SymbolUpgrade[] {
  return upgrades.map((upgrade, idx) => ({
    fromSymbolId: idx === 0 ? symbolId : `${symbolId}_LVL${idx}`,
    toSymbolId: `${symbolId}_LVL${idx + 1}`,
    multiplierIncrease: upgrade.newPayMultiplier,
    isPermanent: false,
    duration: 10
  }));
}

/**
 * Create feature trigger meter
 */
export function createFeatureTriggerMeter(
  maxValue: number = 100,
  triggerReward: number = 50,
  triggerFeature: string = 'FREE_SPINS'
): MeterConfig {
  return {
    id: 'feature-meter',
    name: 'Feature Trigger Meter',
    maxValue,
    baseFillRate: dec(0.02),
    fillingSymbols: [
      { symbolId: 'SCATTER', fillAmount: 10, probability: dec(0.05) },
      { symbolId: 'WILD', fillAmount: 5, probability: dec(0.03) }
    ],
    levelRewards: [
      { level: maxValue, reward: dec(triggerReward), triggersFeature: triggerFeature }
    ],
    resetsOnTrigger: true
  };
}
