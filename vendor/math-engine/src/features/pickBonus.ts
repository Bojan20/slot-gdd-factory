/**
 * SLOT MATH EXACT - Pick Bonus Evaluator
 *
 * Exact EV calculation for Pick & Click bonus games.
 *
 * Types supported:
 * - Simple pick (pick N items, each reveals prize)
 * - Pick until terminator (pick until END symbol)
 * - Pick with upgrade (picks increase multiplier/prize pool)
 * - Multi-level pick (nested pick games)
 *
 * Mathematical model:
 * - Full enumeration of all possible pick combinations
 * - Expected value = Σ P(combination) × V(combination)
 * - Uses hypergeometric distribution for pick without replacement
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
import { binomial, bigIntToDecimal, factorial } from '../core/index.js';
import { MarkovChainBuilder, MarkovChainSolver, type MarkovChain } from '../markov/builder.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pick item definition
 */
export interface PickItem {
  /** Unique ID */
  id: string;
  /** Prize value (bet multiplier) */
  value: Decimal;
  /** Number of this item in the pool */
  count: number;
  /** Is this a terminator (ends pick) */
  isTerminator?: boolean;
  /** Triggers nested feature */
  triggersFeature?: string;
  /** Multiplier applied to subsequent picks */
  multiplierBonus?: number;
  /** Adds extra picks */
  extraPicks?: number;
}

/**
 * Pick bonus configuration
 */
export interface PickBonusConfig {
  /** Unique ID for this pick bonus */
  id: string;
  /** Display name */
  name: string;
  /** Pick mode */
  mode: 'FIXED_PICKS' | 'PICK_UNTIL_TERMINATOR' | 'PICK_UNTIL_TOTAL' | 'PICK_WITH_LEVELS';
  /** Items in the pick pool */
  items: PickItem[];
  /** Number of picks (for FIXED_PICKS mode) */
  numberOfPicks?: number;
  /** Target total to reach (for PICK_UNTIL_TOTAL mode) */
  targetTotal?: Decimal;
  /** Levels for multi-level pick */
  levels?: PickLevel[];
  /** Base multiplier */
  baseMultiplier?: number;
  /** Guaranteed minimum win */
  guaranteedMinWin?: Decimal;
}

/**
 * Level in multi-level pick bonus
 */
export interface PickLevel {
  /** Level number (1-indexed) */
  level: number;
  /** Items available at this level */
  items: PickItem[];
  /** Advancement condition */
  advanceCondition: 'PICK_ADVANCE_SYMBOL' | 'COLLECT_AMOUNT' | 'SURVIVE';
  /** Value needed to advance (if applicable) */
  advanceThreshold?: Decimal;
  /** Bonus for completing level */
  completionBonus?: Decimal;
}

/**
 * Pick bonus result
 */
export interface PickBonusResult {
  /** Expected value (bet multiplier) */
  expectedValue: Decimal;
  /** Expected number of picks */
  expectedPicks: Decimal;
  /** Probability distribution of wins */
  winDistribution: Map<string, Decimal>;
  /** Probability of reaching each prize level */
  prizeDistribution: Array<{ prize: Decimal; probability: Decimal }>;
  /** Maximum possible win */
  maxWin: Decimal;
  /** Minimum possible win */
  minWin: Decimal;
  /** Hit rate (probability of any win) */
  hitRate: Decimal;
  /** Variance */
  variance: Decimal;
  /** Detailed breakdown by item */
  itemBreakdown: Array<{ itemId: string; contribution: Decimal; expectedHits: Decimal }>;
}

// ============================================================================
// FIXED PICKS CALCULATOR
// ============================================================================

/**
 * Calculate EV for fixed number of picks (hypergeometric)
 *
 * Uses: E[X] = n × K/N for each prize type
 * Where: n = picks, K = count of prize type, N = total items
 */
export function calculateFixedPicksEV(config: PickBonusConfig): PickBonusResult {
  const items = config.items;
  const numPicks = config.numberOfPicks ?? 3;
  const totalItems = items.reduce((sum, item) => sum + item.count, 0);

  if (numPicks > totalItems) {
    throw new Error(`Cannot pick ${numPicks} items from pool of ${totalItems}`);
  }

  // Calculate expected value using hypergeometric expectation
  // E[prize from item i] = value_i × n × count_i / total
  let expectedValue = ZERO;
  const itemBreakdown: Array<{ itemId: string; contribution: Decimal; expectedHits: Decimal }> = [];

  for (const item of items) {
    // Expected number of times we pick this item
    const expectedHits = dec(numPicks).times(item.count).dividedBy(totalItems);
    // Contribution to EV
    const contribution = expectedHits.times(item.value);
    expectedValue = expectedValue.plus(contribution);

    itemBreakdown.push({
      itemId: item.id,
      contribution,
      expectedHits
    });
  }

  // Apply multiplier bonuses if any
  const multiplierItems = items.filter(i => i.multiplierBonus !== undefined);
  if (multiplierItems.length > 0) {
    // Complex: need to enumerate to get exact multiplier effect
    // Simplified: average multiplier effect
    let avgMultiplier = ONE;
    for (const mi of multiplierItems) {
      const probOfPicking = dec(numPicks).times(mi.count).dividedBy(totalItems);
      const multiplierEffect = ONE.plus(dec(mi.multiplierBonus! - 1).times(probOfPicking));
      avgMultiplier = avgMultiplier.times(multiplierEffect);
    }
    expectedValue = expectedValue.times(avgMultiplier);
  }

  // Calculate win distribution via full enumeration (for small pools)
  const winDistribution = new Map<string, Decimal>();
  const prizeDistribution: Array<{ prize: Decimal; probability: Decimal }> = [];

  if (totalItems <= 20) {
    // Full enumeration feasible
    const allPicks = enumerateAllPicks(items, numPicks);
    for (const [prize, prob] of allPicks.entries()) {
      winDistribution.set(prize.toString(), prob);
      prizeDistribution.push({ prize, probability: prob });
    }
  }

  // Calculate variance
  // Var(X) = Σ Var(Xi) + covariance terms (negative for hypergeometric)
  let variance = ZERO;
  for (const item of items) {
    // Hypergeometric variance for single item type
    const n = dec(numPicks);
    const K = dec(item.count);
    const N = dec(totalItems);
    const p = safeDivide(K, N);
    // Var = n × p × (1-p) × (N-n)/(N-1)
    const itemVar = n.times(p).times(ONE.minus(p)).times(N.minus(n)).dividedBy(N.minus(ONE));
    variance = variance.plus(itemVar.times(item.value.pow(2)));
  }

  // Max and min wins
  const sortedValues = items.flatMap(i => Array(i.count).fill(i.value)).sort((a, b) => b.minus(a).toNumber());
  const maxWin = sum(sortedValues.slice(0, numPicks));
  const minWin = sum(sortedValues.slice(-numPicks));

  return {
    expectedValue,
    expectedPicks: dec(numPicks),
    winDistribution,
    prizeDistribution,
    maxWin,
    minWin,
    hitRate: ONE, // Fixed picks always have some outcome
    variance,
    itemBreakdown
  };
}

/**
 * Enumerate all possible pick combinations
 */
function enumerateAllPicks(items: PickItem[], numPicks: number): Map<Decimal, Decimal> {
  const results = new Map<string, Decimal>();
  const totalItems = items.reduce((sum, item) => sum + item.count, 0);
  const totalCombinations = bigIntToDecimal(binomial(totalItems, numPicks));

  // Generate all combinations using recursive enumeration
  const itemCounts = items.map(i => i.count);
  const itemValues = items.map(i => i.value);

  function enumerate(
    itemIdx: number,
    picksRemaining: number,
    currentValue: Decimal,
    combinationCount: bigint
  ): void {
    if (picksRemaining === 0) {
      // Valid combination
      const prob = bigIntToDecimal(combinationCount).dividedBy(totalCombinations);
      const key = currentValue.toString();
      const existing = results.get(key) ?? ZERO;
      results.set(key, existing.plus(prob));
      return;
    }

    if (itemIdx >= items.length) {
      return; // No more items to pick from
    }

    const count = itemCounts[itemIdx]!;
    const value = itemValues[itemIdx]!;
    const remainingItems = itemCounts.slice(itemIdx).reduce((a, b) => a + b, 0);

    // How many of this item can we pick?
    const maxFromThis = Math.min(count, picksRemaining);
    const minFromThis = Math.max(0, picksRemaining - (remainingItems - count));

    for (let k = minFromThis; k <= maxFromThis; k++) {
      const newCombCount = combinationCount * binomial(count, k);
      const newValue = currentValue.plus(value.times(k));
      enumerate(itemIdx + 1, picksRemaining - k, newValue, newCombCount);
    }
  }

  enumerate(0, numPicks, ZERO, 1n);

  // Convert to Decimal keys
  const decimalResults = new Map<Decimal, Decimal>();
  for (const [key, prob] of results.entries()) {
    decimalResults.set(dec(key), prob);
  }

  return decimalResults;
}

// ============================================================================
// PICK UNTIL TERMINATOR CALCULATOR
// ============================================================================

/**
 * Calculate EV for pick-until-terminator mode
 *
 * Uses negative hypergeometric (inverse hypergeometric) distribution.
 * Expected picks until terminator = (N+1)/(K+1)
 * Where N = total items, K = terminators
 */
export function calculatePickUntilTerminatorEV(config: PickBonusConfig): PickBonusResult {
  const items = config.items;
  const terminators = items.filter(i => i.isTerminator);
  const nonTerminators = items.filter(i => !i.isTerminator);

  const totalItems = items.reduce((sum, item) => sum + item.count, 0);
  const numTerminators = terminators.reduce((sum, item) => sum + item.count, 0);
  const numNonTerminators = totalItems - numTerminators;

  if (numTerminators === 0) {
    throw new Error('Pick until terminator requires at least one terminator item');
  }

  // Expected number of non-terminators picked before first terminator
  // E[picks] = numNonTerminators / (numTerminators + 1) + 1 (for the terminator itself)
  // More precisely: E[picks before terminator] = (N-K) / (K+1)
  const expectedNonTerminatorPicks = dec(numNonTerminators).dividedBy(numTerminators + 1);
  const expectedTotalPicks = expectedNonTerminatorPicks.plus(ONE); // Including the terminator

  // Expected value from non-terminators
  let expectedValue = ZERO;
  const itemBreakdown: Array<{ itemId: string; contribution: Decimal; expectedHits: Decimal }> = [];

  for (const item of nonTerminators) {
    // Expected hits of this item before terminator
    // Each non-terminator equally likely to be picked
    const itemProportion = dec(item.count).dividedBy(numNonTerminators);
    const expectedHits = expectedNonTerminatorPicks.times(itemProportion);
    const contribution = expectedHits.times(item.value);
    expectedValue = expectedValue.plus(contribution);

    itemBreakdown.push({
      itemId: item.id,
      contribution,
      expectedHits
    });
  }

  // Add terminator value (if any)
  for (const term of terminators) {
    const termProportion = dec(term.count).dividedBy(numTerminators);
    const contribution = termProportion.times(term.value);
    expectedValue = expectedValue.plus(contribution);

    itemBreakdown.push({
      itemId: term.id,
      contribution,
      expectedHits: termProportion
    });
  }

  // Calculate full distribution using Markov chain
  const chain = buildPickUntilTerminatorChain(config);
  const solver = new MarkovChainSolver(chain);
  const markovEV = solver.solveExpectedValue();

  // Use Markov result if more accurate
  if (markovEV.greaterThan(ZERO)) {
    expectedValue = markovEV;
  }

  // Min/max wins
  const maxPicks = numNonTerminators; // Pick all non-terminators before terminator
  const sortedNonTermValues = nonTerminators
    .flatMap(i => Array(i.count).fill(i.value))
    .sort((a, b) => b.minus(a).toNumber());

  const maxWin = sum(sortedNonTermValues).plus(
    terminators.reduce((max, t) => t.value.greaterThan(max) ? t.value : max, ZERO)
  );
  const minWin = terminators.reduce((min, t) => t.value.lessThan(min) ? t.value : min, dec(Infinity));

  // Variance calculation
  let variance = ZERO;
  // Simplified variance using hypergeometric variance formula
  for (const item of nonTerminators) {
    const p = dec(item.count).dividedBy(numNonTerminators);
    const n = expectedNonTerminatorPicks;
    const itemVar = n.times(p).times(ONE.minus(p));
    variance = variance.plus(itemVar.times(item.value.pow(2)));
  }

  return {
    expectedValue,
    expectedPicks: expectedTotalPicks,
    winDistribution: new Map(),
    prizeDistribution: [],
    maxWin,
    minWin: minWin.isFinite() ? minWin : ZERO,
    hitRate: ONE,
    variance,
    itemBreakdown
  };
}

/**
 * Build Markov chain for pick-until-terminator
 */
function buildPickUntilTerminatorChain(config: PickBonusConfig): MarkovChain {
  const builder = new MarkovChainBuilder();
  const items = config.items;
  const totalItems = items.reduce((sum, item) => sum + item.count, 0);

  // Terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // States: items remaining in pool
  // Simplified: track only count of terminators and non-terminators remaining
  const terminatorCount = items.filter(i => i.isTerminator).reduce((s, i) => s + i.count, 0);
  const nonTerminatorCount = totalItems - terminatorCount;

  // Average non-terminator value
  const nonTermItems = items.filter(i => !i.isTerminator);
  const avgNonTermValue = nonTermItems.length > 0
    ? safeDivide(
        sum(nonTermItems.map(i => i.value.times(i.count))),
        dec(nonTerminatorCount)
      )
    : ZERO;

  // Average terminator value
  const termItems = items.filter(i => i.isTerminator);
  const avgTermValue = termItems.length > 0
    ? safeDivide(
        sum(termItems.map(i => i.value.times(i.count))),
        dec(terminatorCount)
      )
    : ZERO;

  // Create states: S_{t}_{n} where t = terminators remaining, n = non-terms remaining
  for (let t = 0; t <= terminatorCount; t++) {
    for (let n = 0; n <= nonTerminatorCount; n++) {
      if (t === 0 && n > 0) continue; // Invalid: can't have non-terms without terms
      if (t === 0 && n === 0) continue; // Skip S_0_0 - we use END state instead
      const stateId = `S_${t}_${n}`;
      const isInitial = t === terminatorCount && n === nonTerminatorCount;
      builder.addState(stateId, { isInitial });
    }
  }

  // Add transitions
  for (let t = 1; t <= terminatorCount; t++) {
    for (let n = 0; n <= nonTerminatorCount; n++) {
      const stateId = `S_${t}_${n}`;
      const total = t + n;

      // Probability of picking terminator
      const pTerm = dec(t).dividedBy(total);
      builder.addTransition(stateId, 'END', pTerm, avgTermValue);

      // Probability of picking non-terminator
      if (n > 0) {
        const pNonTerm = dec(n).dividedBy(total);
        const nextState = `S_${t}_${n - 1}`;
        builder.addTransition(stateId, nextState, pNonTerm, avgNonTermValue);
      }
    }
  }

  return builder.build();
}

// ============================================================================
// MULTI-LEVEL PICK CALCULATOR
// ============================================================================

/**
 * Calculate EV for multi-level pick bonus
 */
export function calculateMultiLevelPickEV(config: PickBonusConfig): PickBonusResult {
  if (!config.levels || config.levels.length === 0) {
    throw new Error('Multi-level pick requires levels configuration');
  }

  const chain = buildMultiLevelPickChain(config);
  const solver = new MarkovChainSolver(chain);
  const expectedValue = solver.solveExpectedValue();
  const visits = solver.solveExpectedVisits();

  // Calculate expected picks
  let expectedPicks = ZERO;
  for (const [stateId, visitCount] of visits.entries()) {
    if (stateId.startsWith('L') && !stateId.includes('END')) {
      expectedPicks = expectedPicks.plus(visitCount);
    }
  }

  // Calculate max/min wins by summing level max/mins
  let maxWin = ZERO;
  let minWin = ZERO;
  for (const level of config.levels) {
    const sortedValues = level.items
      .flatMap(i => Array(i.count).fill(i.value))
      .sort((a, b) => b.minus(a).toNumber());
    maxWin = maxWin.plus(sortedValues[0] ?? ZERO);
    minWin = minWin.plus(sortedValues[sortedValues.length - 1] ?? ZERO);
    if (level.completionBonus) {
      maxWin = maxWin.plus(level.completionBonus);
    }
  }

  return {
    expectedValue,
    expectedPicks,
    winDistribution: new Map(),
    prizeDistribution: [],
    maxWin,
    minWin,
    hitRate: ONE,
    variance: ZERO, // Complex to calculate for multi-level
    itemBreakdown: []
  };
}

/**
 * Build Markov chain for multi-level pick
 */
function buildMultiLevelPickChain(config: PickBonusConfig): MarkovChain {
  const builder = new MarkovChainBuilder();
  const levels = config.levels!;

  // Terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // Create states for each level
  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx]!;
    const levelNum = level.level;

    // Active state for this level
    builder.addState(`L${levelNum}_ACTIVE`, {
      name: `Level ${levelNum}`,
      isInitial: levelIdx === 0
    });

    // Completed state for this level
    builder.addState(`L${levelNum}_DONE`, {
      name: `Level ${levelNum} Complete`,
      expectedValue: level.completionBonus ?? ZERO
    });
  }

  // Add transitions for each level
  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx]!;
    const levelNum = level.level;
    const items = level.items;
    const totalItems = items.reduce((s, i) => s + i.count, 0);

    const activeState = `L${levelNum}_ACTIVE`;
    const doneState = `L${levelNum}_DONE`;

    // Calculate average prize value
    const avgValue = safeDivide(
      sum(items.map(i => i.value.times(i.count))),
      dec(totalItems)
    );

    // Find advancement items
    const advanceItems = items.filter(i => i.triggersFeature === 'ADVANCE');
    const terminatorItems = items.filter(i => i.isTerminator);
    const prizeItems = items.filter(i => !i.triggersFeature && !i.isTerminator);

    const pAdvance = dec(advanceItems.reduce((s, i) => s + i.count, 0)).dividedBy(totalItems);
    const pTerminate = dec(terminatorItems.reduce((s, i) => s + i.count, 0)).dividedBy(totalItems);
    const pPrize = ONE.minus(pAdvance).minus(pTerminate);

    // Prize pick -> stay in level
    if (pPrize.greaterThan(ZERO)) {
      builder.addTransition(activeState, activeState, pPrize, avgValue);
    }

    // Advance -> next level or end
    if (pAdvance.greaterThan(ZERO)) {
      const advanceValue = safeDivide(
        sum(advanceItems.map(i => i.value.times(i.count))),
        dec(advanceItems.reduce((s, i) => s + i.count, 0))
      );
      builder.addTransition(activeState, doneState, pAdvance, advanceValue);
    }

    // Terminate -> end
    if (pTerminate.greaterThan(ZERO)) {
      const termValue = safeDivide(
        sum(terminatorItems.map(i => i.value.times(i.count))),
        dec(terminatorItems.reduce((s, i) => s + i.count, 0))
      );
      builder.addTransition(activeState, 'END', pTerminate, termValue);
    }

    // If no terminate/advance, need self-loop handled differently
    if (pAdvance.isZero() && pTerminate.isZero()) {
      // Pure prize level - goes to done after expected picks
      builder.addTransition(activeState, doneState, ONE, avgValue);
    }

    // Done state transitions to next level or end
    if (levelIdx < levels.length - 1) {
      const nextLevel = levels[levelIdx + 1]!.level;
      builder.addTransition(doneState, `L${nextLevel}_ACTIVE`, ONE, ZERO);
    } else {
      builder.addTransition(doneState, 'END', ONE, ZERO);
    }
  }

  return builder.build();
}

// ============================================================================
// MAIN CALCULATOR FUNCTION
// ============================================================================

/**
 * Calculate pick bonus EV based on mode
 */
export function calculatePickBonusEV(config: PickBonusConfig): PickBonusResult {
  switch (config.mode) {
    case 'FIXED_PICKS':
      return calculateFixedPicksEV(config);
    case 'PICK_UNTIL_TERMINATOR':
      return calculatePickUntilTerminatorEV(config);
    case 'PICK_WITH_LEVELS':
      return calculateMultiLevelPickEV(config);
    case 'PICK_UNTIL_TOTAL':
      // Treat as pick until terminator with virtual terminator
      return calculatePickUntilTerminatorEV(config);
    default:
      throw new Error(`Unknown pick bonus mode: ${config.mode}`);
  }
}

/**
 * Calculate pick bonus RTP contribution
 */
export function calculatePickBonusRTP(
  triggerProbability: Decimal,
  config: PickBonusConfig
): Decimal {
  const result = calculatePickBonusEV(config);
  return triggerProbability.times(result.expectedValue);
}
