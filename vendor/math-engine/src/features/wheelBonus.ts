/**
 * SLOT MATH EXACT - Wheel Bonus Evaluator
 *
 * Exact EV calculation for Fortune Wheel / Spin the Wheel bonus games.
 *
 * Types supported:
 * - Simple wheel (weighted segments)
 * - Multi-wheel (outer + inner wheels)
 * - Progressive wheel (wheel modifies itself)
 * - Wheel with multipliers (spinning multiplier wheel)
 *
 * Mathematical model:
 * - EV = Σ P(segment) × V(segment)
 * - Multi-wheel: EV = Σ Σ P(outer) × P(inner|outer) × V(combination)
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
import { MarkovChainBuilder, MarkovChainSolver, type MarkovChain } from '../markov/builder.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Wheel segment definition
 */
export interface WheelSegment {
  /** Unique ID */
  id: string;
  /** Display label */
  label: string;
  /** Prize value (bet multiplier) */
  value: Decimal;
  /** Weight (probability proportional) */
  weight: number;
  /** If true, triggers another spin */
  respin?: boolean;
  /** Multiplier to apply to final win */
  multiplier?: number;
  /** Triggers nested wheel */
  triggersWheel?: string;
  /** Triggers different feature */
  triggersFeature?: string;
  /** Upgrades wheel for next spin */
  upgradesWheel?: WheelUpgrade;
  /** Color/visual (for display only) */
  color?: string;
}

/**
 * Wheel upgrade applied after landing on segment
 */
export interface WheelUpgrade {
  /** Segments to remove */
  removeSegments?: string[];
  /** Segments to add */
  addSegments?: WheelSegment[];
  /** Multiplier increase */
  multiplierIncrease?: number;
  /** Change segment values */
  upgradeValues?: Record<string, Decimal>;
}

/**
 * Wheel configuration
 */
export interface WheelConfig {
  /** Unique ID */
  id: string;
  /** Display name */
  name: string;
  /** Segments on the wheel */
  segments: WheelSegment[];
  /** Maximum respins allowed */
  maxRespins?: number;
  /** Base multiplier applied to all wins */
  baseMultiplier?: number;
  /** Nested wheels (for multi-wheel) */
  nestedWheels?: WheelConfig[];
  /** How nested wheels combine */
  nestedMode?: 'ADDITIVE' | 'MULTIPLICATIVE' | 'PICK_BEST';
}

/**
 * Wheel bonus result
 */
export interface WheelBonusResult {
  /** Expected value (bet multiplier) */
  expectedValue: Decimal;
  /** Expected number of spins */
  expectedSpins: Decimal;
  /** Probability of each segment */
  segmentProbabilities: Map<string, Decimal>;
  /** Prize distribution */
  prizeDistribution: Array<{ prize: Decimal; probability: Decimal }>;
  /** Maximum possible win */
  maxWin: Decimal;
  /** Minimum possible win */
  minWin: Decimal;
  /** Probability of triggering feature */
  featureTriggerRate: Decimal;
  /** Variance */
  variance: Decimal;
  /** Contribution by segment */
  segmentContributions: Array<{ segmentId: string; contribution: Decimal }>;
}

// ============================================================================
// SIMPLE WHEEL CALCULATOR
// ============================================================================

/**
 * Calculate probability of each segment
 */
export function calculateSegmentProbabilities(segments: WheelSegment[]): Map<string, Decimal> {
  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
  const probabilities = new Map<string, Decimal>();

  for (const segment of segments) {
    const prob = dec(segment.weight).dividedBy(totalWeight);
    probabilities.set(segment.id, prob);
  }

  return probabilities;
}

/**
 * Calculate EV for simple wheel (no respins, no nested wheels)
 */
export function calculateSimpleWheelEV(config: WheelConfig): WheelBonusResult {
  const segments = config.segments;
  const baseMultiplier = dec(config.baseMultiplier ?? 1);
  const probabilities = calculateSegmentProbabilities(segments);

  // EV = Σ P(segment) × V(segment) × base_multiplier
  let expectedValue = ZERO;
  const segmentContributions: Array<{ segmentId: string; contribution: Decimal }> = [];

  for (const segment of segments) {
    const prob = probabilities.get(segment.id) ?? ZERO;
    const value = segment.value.times(baseMultiplier);
    const segmentMultiplier = dec(segment.multiplier ?? 1);
    const contribution = prob.times(value).times(segmentMultiplier);
    expectedValue = expectedValue.plus(contribution);

    segmentContributions.push({
      segmentId: segment.id,
      contribution
    });
  }

  // Prize distribution
  const prizeMap = new Map<string, Decimal>();
  for (const segment of segments) {
    const prob = probabilities.get(segment.id) ?? ZERO;
    const prize = segment.value.times(baseMultiplier).times(segment.multiplier ?? 1);
    const key = prize.toString();
    const existing = prizeMap.get(key) ?? ZERO;
    prizeMap.set(key, existing.plus(prob));
  }

  const prizeDistribution: Array<{ prize: Decimal; probability: Decimal }> = [];
  for (const [key, prob] of prizeMap.entries()) {
    prizeDistribution.push({ prize: dec(key), probability: prob });
  }
  prizeDistribution.sort((a, b) => a.prize.minus(b.prize).toNumber());

  // Max/min wins
  const values = segments.map(s => s.value.times(baseMultiplier).times(s.multiplier ?? 1));
  const maxWin = values.reduce((max, v) => v.greaterThan(max) ? v : max, ZERO);
  const minWin = values.reduce((min, v) => v.lessThan(min) ? v : min, dec(Infinity));

  // Variance: Var(X) = E[X²] - E[X]²
  let expectedSquare = ZERO;
  for (const segment of segments) {
    const prob = probabilities.get(segment.id) ?? ZERO;
    const value = segment.value.times(baseMultiplier).times(segment.multiplier ?? 1);
    expectedSquare = expectedSquare.plus(prob.times(value.pow(2)));
  }
  const variance = expectedSquare.minus(expectedValue.pow(2));

  // Feature trigger rate
  const featureTriggers = segments.filter(s => s.triggersFeature || s.triggersWheel);
  const featureTriggerRate = sum(featureTriggers.map(s => probabilities.get(s.id) ?? ZERO));

  return {
    expectedValue,
    expectedSpins: ONE,
    segmentProbabilities: probabilities,
    prizeDistribution,
    maxWin,
    minWin: minWin.isFinite() ? minWin : ZERO,
    featureTriggerRate,
    variance,
    segmentContributions
  };
}

// ============================================================================
// WHEEL WITH RESPINS CALCULATOR
// ============================================================================

/**
 * Calculate EV for wheel with respin segments
 */
export function calculateWheelWithRespinsEV(config: WheelConfig): WheelBonusResult {
  const maxRespins = config.maxRespins ?? 10;
  const chain = buildWheelRespinChain(config, maxRespins);
  const solver = new MarkovChainSolver(chain);
  const expectedValue = solver.solveExpectedValue();
  const visits = solver.solveExpectedVisits();

  // Calculate expected spins from visits
  let expectedSpins = ZERO;
  for (const [stateId, visitCount] of visits.entries()) {
    if (stateId.startsWith('SPIN_')) {
      expectedSpins = expectedSpins.plus(visitCount);
    }
  }

  // Get simple wheel result for other stats
  const simpleResult = calculateSimpleWheelEV(config);

  // Adjust for respins
  const respinSegments = config.segments.filter(s => s.respin);
  const respinProb = sum(respinSegments.map(s => simpleResult.segmentProbabilities.get(s.id) ?? ZERO));

  // Expected spins with respins: geometric series
  // E[spins] = 1 + p + p² + ... = 1/(1-p) (capped at maxRespins)
  if (respinProb.lessThan(ONE)) {
    const theoreticalSpins = ONE.dividedBy(ONE.minus(respinProb));
    expectedSpins = Decimal.min(theoreticalSpins, dec(maxRespins));
  }

  // Max win with respins
  const nonRespinSegments = config.segments.filter(s => !s.respin);
  const baseMultiplier = dec(config.baseMultiplier ?? 1);
  const maxSingleWin = nonRespinSegments.reduce(
    (max, s) => {
      const val = s.value.times(baseMultiplier).times(s.multiplier ?? 1);
      return val.greaterThan(max) ? val : max;
    },
    ZERO
  );
  const maxWin = maxSingleWin; // Respin doesn't accumulate, just gives another chance

  return {
    expectedValue,
    expectedSpins,
    segmentProbabilities: simpleResult.segmentProbabilities,
    prizeDistribution: simpleResult.prizeDistribution,
    maxWin,
    minWin: simpleResult.minWin,
    featureTriggerRate: simpleResult.featureTriggerRate,
    variance: simpleResult.variance.times(expectedSpins), // Approximate
    segmentContributions: simpleResult.segmentContributions
  };
}

/**
 * Build Markov chain for wheel with respins
 */
function buildWheelRespinChain(config: WheelConfig, maxRespins: number): MarkovChain {
  const builder = new MarkovChainBuilder();
  const segments = config.segments;
  const baseMultiplier = dec(config.baseMultiplier ?? 1);
  const probabilities = calculateSegmentProbabilities(segments);

  // Terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // Spin states
  for (let spin = 1; spin <= maxRespins; spin++) {
    builder.addState(`SPIN_${spin}`, {
      name: `Spin ${spin}`,
      isInitial: spin === 1
    });
  }

  // Add transitions for each spin
  for (let spin = 1; spin <= maxRespins; spin++) {
    const stateId = `SPIN_${spin}`;

    for (const segment of segments) {
      const prob = probabilities.get(segment.id) ?? ZERO;
      const value = segment.value.times(baseMultiplier).times(segment.multiplier ?? 1);

      if (segment.respin && spin < maxRespins) {
        // Respin -> next spin state
        builder.addTransition(stateId, `SPIN_${spin + 1}`, prob, ZERO);
      } else {
        // Prize or last spin -> end
        builder.addTransition(stateId, 'END', prob, value);
      }
    }
  }

  return builder.build();
}

// ============================================================================
// MULTI-WHEEL CALCULATOR
// ============================================================================

/**
 * Calculate EV for multi-wheel (outer + inner wheels)
 */
export function calculateMultiWheelEV(config: WheelConfig): WheelBonusResult {
  if (!config.nestedWheels || config.nestedWheels.length === 0) {
    return calculateSimpleWheelEV(config);
  }

  const outerProbs = calculateSegmentProbabilities(config.segments);
  const nestedMode = config.nestedMode ?? 'ADDITIVE';

  let expectedValue = ZERO;
  const prizeAccumulator = new Map<string, Decimal>();

  // For each outer segment
  for (const outerSegment of config.segments) {
    const outerProb = outerProbs.get(outerSegment.id) ?? ZERO;
    const outerValue = outerSegment.value;

    if (outerSegment.triggersWheel) {
      // Find the nested wheel
      const nestedWheel = config.nestedWheels.find(w => w.id === outerSegment.triggersWheel);
      if (!nestedWheel) {
        // No nested wheel, just outer value
        expectedValue = expectedValue.plus(outerProb.times(outerValue));
        continue;
      }

      // Calculate nested wheel EV
      const nestedResult = calculateWheelBonusEV(nestedWheel);
      const nestedEV = nestedResult.expectedValue;

      // Combine based on mode
      let combinedValue: Decimal;
      switch (nestedMode) {
        case 'MULTIPLICATIVE':
          combinedValue = outerValue.times(nestedEV);
          break;
        case 'PICK_BEST':
          combinedValue = Decimal.max(outerValue, nestedEV);
          break;
        case 'ADDITIVE':
        default:
          combinedValue = outerValue.plus(nestedEV);
          break;
      }

      expectedValue = expectedValue.plus(outerProb.times(combinedValue));

      // Build prize distribution for this path
      for (const nestedPrize of nestedResult.prizeDistribution) {
        let combinedPrize: Decimal;
        switch (nestedMode) {
          case 'MULTIPLICATIVE':
            combinedPrize = outerValue.times(nestedPrize.prize);
            break;
          case 'PICK_BEST':
            combinedPrize = Decimal.max(outerValue, nestedPrize.prize);
            break;
          case 'ADDITIVE':
          default:
            combinedPrize = outerValue.plus(nestedPrize.prize);
            break;
        }

        const key = combinedPrize.toString();
        const prob = outerProb.times(nestedPrize.probability);
        const existing = prizeAccumulator.get(key) ?? ZERO;
        prizeAccumulator.set(key, existing.plus(prob));
      }
    } else {
      // No nested wheel, just outer value
      expectedValue = expectedValue.plus(outerProb.times(outerValue));
      const key = outerValue.toString();
      const existing = prizeAccumulator.get(key) ?? ZERO;
      prizeAccumulator.set(key, existing.plus(outerProb));
    }
  }

  // Convert prize accumulator to distribution
  const prizeDistribution: Array<{ prize: Decimal; probability: Decimal }> = [];
  for (const [key, prob] of prizeAccumulator.entries()) {
    prizeDistribution.push({ prize: dec(key), probability: prob });
  }
  prizeDistribution.sort((a, b) => a.prize.minus(b.prize).toNumber());

  // Max/min from distribution
  const maxWin = prizeDistribution.reduce(
    (max, p) => p.prize.greaterThan(max) ? p.prize : max,
    ZERO
  );
  const minWin = prizeDistribution.reduce(
    (min, p) => p.prize.lessThan(min) ? p.prize : min,
    dec(Infinity)
  );

  // Variance
  let expectedSquare = ZERO;
  for (const p of prizeDistribution) {
    expectedSquare = expectedSquare.plus(p.probability.times(p.prize.pow(2)));
  }
  const variance = expectedSquare.minus(expectedValue.pow(2));

  // Expected spins (1 outer + conditional inner)
  const triggerSegments = config.segments.filter(s => s.triggersWheel);
  const innerTriggerProb = sum(triggerSegments.map(s => outerProbs.get(s.id) ?? ZERO));
  const expectedSpins = ONE.plus(innerTriggerProb);

  return {
    expectedValue,
    expectedSpins,
    segmentProbabilities: outerProbs,
    prizeDistribution,
    maxWin,
    minWin: minWin.isFinite() ? minWin : ZERO,
    featureTriggerRate: innerTriggerProb,
    variance,
    segmentContributions: []
  };
}

// ============================================================================
// PROGRESSIVE WHEEL CALCULATOR
// ============================================================================

/**
 * Calculate EV for wheel that upgrades itself
 */
export function calculateProgressiveWheelEV(config: WheelConfig): WheelBonusResult {
  const maxUpgrades = 10; // Cap to prevent infinite loops
  const chain = buildProgressiveWheelChain(config, maxUpgrades);
  const solver = new MarkovChainSolver(chain);
  const expectedValue = solver.solveExpectedValue();

  // Get base stats from simple wheel
  const simpleResult = calculateSimpleWheelEV(config);

  return {
    ...simpleResult,
    expectedValue
  };
}

/**
 * Build Markov chain for progressive wheel
 */
function buildProgressiveWheelChain(config: WheelConfig, maxUpgrades: number): MarkovChain {
  const builder = new MarkovChainBuilder();
  const segments = config.segments;
  const baseMultiplier = dec(config.baseMultiplier ?? 1);

  // Terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // Create states for each upgrade level
  for (let level = 0; level <= maxUpgrades; level++) {
    builder.addState(`LEVEL_${level}`, {
      name: `Upgrade Level ${level}`,
      isInitial: level === 0
    });
  }

  // Add transitions for each level
  for (let level = 0; level <= maxUpgrades; level++) {
    const stateId = `LEVEL_${level}`;
    const levelMultiplier = dec(1 + level * 0.5); // Example: +50% per level

    // Calculate probabilities with current wheel state
    const currentSegments = segments.filter(s => {
      // Example: low value segments removed at higher levels
      if (level >= 3 && s.value.lessThan(dec(1))) return false;
      if (level >= 5 && s.value.lessThan(dec(2))) return false;
      return true;
    });

    const probs = calculateSegmentProbabilities(currentSegments);

    for (const segment of currentSegments) {
      const prob = probs.get(segment.id) ?? ZERO;
      const value = segment.value.times(baseMultiplier).times(levelMultiplier);

      if (segment.upgradesWheel && level < maxUpgrades) {
        // Upgrade -> next level
        builder.addTransition(stateId, `LEVEL_${level + 1}`, prob, ZERO);
      } else {
        // Prize -> end
        builder.addTransition(stateId, 'END', prob, value);
      }
    }
  }

  return builder.build();
}

// ============================================================================
// MAIN CALCULATOR FUNCTION
// ============================================================================

/**
 * Calculate wheel bonus EV based on configuration
 */
export function calculateWheelBonusEV(config: WheelConfig): WheelBonusResult {
  // Check for nested wheels
  if (config.nestedWheels && config.nestedWheels.length > 0) {
    return calculateMultiWheelEV(config);
  }

  // Check for respins
  const hasRespins = config.segments.some(s => s.respin);
  if (hasRespins) {
    return calculateWheelWithRespinsEV(config);
  }

  // Check for progressive upgrades
  const hasUpgrades = config.segments.some(s => s.upgradesWheel);
  if (hasUpgrades) {
    return calculateProgressiveWheelEV(config);
  }

  // Simple wheel
  return calculateSimpleWheelEV(config);
}

/**
 * Calculate wheel bonus RTP contribution
 */
export function calculateWheelBonusRTP(
  triggerProbability: Decimal,
  config: WheelConfig
): Decimal {
  const result = calculateWheelBonusEV(config);
  return triggerProbability.times(result.expectedValue);
}

/**
 * Create wheel from JSON config (helper)
 */
export function createWheelFromConfig(jsonConfig: {
  id: string;
  name: string;
  segments: Array<{
    id: string;
    label: string;
    value: number;
    weight: number;
    respin?: boolean;
    multiplier?: number;
    triggersWheel?: string;
    triggersFeature?: string;
  }>;
  maxRespins?: number;
  baseMultiplier?: number;
}): WheelConfig {
  return {
    id: jsonConfig.id,
    name: jsonConfig.name,
    segments: jsonConfig.segments.map(s => ({
      id: s.id,
      label: s.label,
      value: dec(s.value),
      weight: s.weight,
      respin: s.respin,
      multiplier: s.multiplier,
      triggersWheel: s.triggersWheel,
      triggersFeature: s.triggersFeature
    })),
    maxRespins: jsonConfig.maxRespins,
    baseMultiplier: jsonConfig.baseMultiplier
  };
}
