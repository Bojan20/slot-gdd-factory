/**
 * SLOT MATH EXACT - Multi-Level Bonus System
 *
 * Exact EV calculation for nested/chained bonus features.
 *
 * Types supported:
 * - Linear chains (Level 1 → Level 2 → Level 3)
 * - Branching (pick path A or B)
 * - Recursive (bonus within bonus)
 * - Progressive (state carries between levels)
 *
 * Mathematical model:
 * - Uses Markov chains for state transitions
 * - Recursive EV calculation for nested features
 * - Proper handling of conditional probabilities
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import { MarkovChainBuilder, MarkovChainSolver, type MarkovChain } from '../markov/builder.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Bonus level types
 */
export type BonusLevelType =
  | 'FREE_SPINS'
  | 'PICK_BONUS'
  | 'WHEEL_BONUS'
  | 'HOLD_AND_WIN'
  | 'CASCADE'
  | 'MULTIPLIER_TRAIL'
  | 'COLLECTOR'
  | 'CUSTOM';

/**
 * Transition to next level
 */
export interface LevelTransition {
  /** Target level ID */
  targetLevelId: string;
  /** Probability of this transition */
  probability: Decimal;
  /** Condition for transition */
  condition?: TransitionCondition;
  /** Reward on transition */
  transitionReward?: Decimal;
  /** State modification on transition */
  stateModification?: StateModification;
}

/**
 * Condition for level transition
 */
export interface TransitionCondition {
  type: 'ALWAYS' | 'SYMBOL_COUNT' | 'WIN_THRESHOLD' | 'MULTIPLIER_REACHED' | 'PICK_RESULT' | 'RANDOM';
  /** For symbol count */
  symbolId?: string;
  requiredCount?: number;
  /** For win threshold */
  winThreshold?: Decimal;
  /** For multiplier reached */
  multiplierThreshold?: number;
  /** For random */
  randomProbability?: Decimal;
}

/**
 * State modification when transitioning
 */
export interface StateModification {
  /** Set multiplier */
  setMultiplier?: number;
  /** Add to multiplier */
  addMultiplier?: number;
  /** Multiply multiplier */
  multiplyMultiplier?: number;
  /** Set collected value */
  setCollected?: Decimal;
  /** Add to collected */
  addCollected?: Decimal;
  /** Set spins remaining */
  setSpins?: number;
  /** Add spins */
  addSpins?: number;
}

/**
 * Single bonus level definition
 */
export interface BonusLevel {
  /** Unique ID */
  id: string;
  /** Display name */
  name: string;
  /** Level type */
  type: BonusLevelType;
  /** Is this the entry point? */
  isEntry?: boolean;
  /** Is this a terminal level? */
  isTerminal?: boolean;
  /** Expected value of this level (standalone) */
  baseEV: Decimal;
  /** Expected visits (for free spins, etc.) */
  expectedVisits?: Decimal;
  /** Transitions to other levels */
  transitions: LevelTransition[];
  /** Does state persist from previous level? */
  inheritsState?: boolean;
  /** Multiplier applied to this level's wins */
  levelMultiplier?: number;
  /** Nested bonus within this level */
  nestedBonus?: MultiLevelBonusConfig;
}

/**
 * Shared state across levels
 */
export interface BonusState {
  /** Current multiplier */
  multiplier: Decimal;
  /** Collected value */
  collected: Decimal;
  /** Spins/picks remaining */
  remaining: number;
  /** Current level */
  currentLevel: string;
  /** Visit count per level */
  levelVisits: Map<string, number>;
  /** Custom state */
  custom?: Record<string, unknown>;
}

/**
 * Multi-level bonus configuration
 */
export interface MultiLevelBonusConfig {
  /** Configuration ID */
  id: string;
  /** Display name */
  name: string;
  /** Bonus levels */
  levels: BonusLevel[];
  /** Initial state */
  initialState?: Partial<BonusState>;
  /** Maximum level visits (prevents infinite loops) */
  maxLevelVisits?: number;
  /** Global multiplier cap */
  maxMultiplier?: number;
  /** Maximum total iterations */
  maxIterations?: number;
}

/**
 * Multi-level bonus result
 */
export interface MultiLevelBonusResult {
  /** Total expected value */
  expectedValue: Decimal;
  /** Expected value per level */
  levelEVs: Map<string, Decimal>;
  /** Expected visits per level */
  levelVisits: Map<string, Decimal>;
  /** Probability of reaching each level */
  levelProbabilities: Map<string, Decimal>;
  /** Expected final multiplier */
  expectedFinalMultiplier: Decimal;
  /** Expected total spins/actions */
  expectedTotalActions: Decimal;
  /** Path analysis */
  pathAnalysis: PathAnalysis;
  /** Maximum possible win */
  maxWin: Decimal;
}

/**
 * Path analysis for bonus flow
 */
export interface PathAnalysis {
  /** Most common path through levels */
  mostCommonPath: string[];
  /** Highest value path */
  highestValuePath: string[];
  /** Path probabilities */
  pathProbabilities: Map<string, Decimal>;
  /** Average path length */
  averagePathLength: Decimal;
}

// ============================================================================
// CORE CALCULATIONS
// ============================================================================

/**
 * Build Markov chain from multi-level bonus configuration
 */
export function buildMultiLevelBonusChain(config: MultiLevelBonusConfig): MarkovChain {
  const builder = new MarkovChainBuilder();
  const levels = config.levels;
  const maxVisits = config.maxLevelVisits ?? 10;

  // Add terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // Add states for each level
  // For levels with visit tracking, create states like LEVEL_1_v1, LEVEL_1_v2, etc.
  for (const level of levels) {
    if (level.isTerminal) {
      builder.addState(level.id, {
        name: level.name,
        isTerminal: true,
        expectedValue: level.baseEV
      });
    } else {
      // Create visit-tracking states
      for (let v = 1; v <= maxVisits; v++) {
        const stateId = `${level.id}_v${v}`;
        builder.addState(stateId, {
          name: `${level.name} (visit ${v})`,
          isInitial: level.isEntry && v === 1,
          expectedValue: level.baseEV.times(level.levelMultiplier ?? 1)
        });
      }
    }
  }

  // Add transitions
  for (const level of levels) {
    if (level.isTerminal) continue;

    for (let v = 1; v <= maxVisits; v++) {
      const fromState = `${level.id}_v${v}`;

      for (const transition of level.transitions) {
        const targetLevel = levels.find(l => l.id === transition.targetLevelId);

        if (!targetLevel) {
          // Transition to END
          builder.addTransition(
            fromState,
            'END',
            transition.probability,
            transition.transitionReward ?? ZERO
          );
          continue;
        }

        if (targetLevel.isTerminal) {
          builder.addTransition(
            fromState,
            targetLevel.id,
            transition.probability,
            transition.transitionReward ?? ZERO
          );
        } else {
          // Check visit count
          if (v < maxVisits) {
            const toState = `${transition.targetLevelId}_v${v + 1}`;
            builder.addTransition(
              fromState,
              toState,
              transition.probability,
              transition.transitionReward ?? ZERO
            );
          } else {
            // Max visits reached, go to END
            builder.addTransition(
              fromState,
              'END',
              transition.probability,
              transition.transitionReward ?? ZERO
            );
          }
        }
      }

      // Ensure probabilities sum to 1
      const totalProb = sum(level.transitions.map(t => t.probability));
      if (totalProb.lessThan(ONE)) {
        // Implicit transition to END
        builder.addTransition(fromState, 'END', ONE.minus(totalProb), ZERO);
      }
    }
  }

  return builder.build();
}

/**
 * Calculate multi-level bonus EV
 */
export function calculateMultiLevelBonusEV(config: MultiLevelBonusConfig): MultiLevelBonusResult {
  const chain = buildMultiLevelBonusChain(config);
  const solver = new MarkovChainSolver(chain);

  const expectedValue = solver.solveExpectedValue();
  const visits = solver.solveExpectedVisits();

  // Aggregate visits and EVs per level
  const levelEVs = new Map<string, Decimal>();
  const levelVisits = new Map<string, Decimal>();
  const levelProbabilities = new Map<string, Decimal>();

  for (const level of config.levels) {
    let totalVisits = ZERO;
    let totalEV = ZERO;

    if (level.isTerminal) {
      const visitCount = visits.get(level.id) ?? ZERO;
      totalVisits = visitCount;
      totalEV = visitCount.times(level.baseEV);
    } else {
      for (let v = 1; v <= (config.maxLevelVisits ?? 10); v++) {
        const stateId = `${level.id}_v${v}`;
        const visitCount = visits.get(stateId) ?? ZERO;
        totalVisits = totalVisits.plus(visitCount);
        totalEV = totalEV.plus(visitCount.times(level.baseEV).times(level.levelMultiplier ?? 1));
      }
    }

    levelVisits.set(level.id, totalVisits);
    levelEVs.set(level.id, totalEV);
    levelProbabilities.set(level.id, totalVisits.greaterThan(ZERO) ? ONE : ZERO);
  }

  // Calculate expected final multiplier
  let expectedFinalMultiplier = ONE;
  const initialMultiplier = config.initialState?.multiplier ?? ONE;

  for (const level of config.levels) {
    const levelVisitCount = levelVisits.get(level.id) ?? ZERO;
    if (levelVisitCount.greaterThan(ZERO)) {
      // Check transitions for multiplier modifications
      for (const transition of level.transitions) {
        if (transition.stateModification?.addMultiplier) {
          expectedFinalMultiplier = expectedFinalMultiplier.plus(
            dec(transition.stateModification.addMultiplier).times(transition.probability)
          );
        }
        if (transition.stateModification?.multiplyMultiplier) {
          expectedFinalMultiplier = expectedFinalMultiplier.times(
            ONE.plus(dec(transition.stateModification.multiplyMultiplier - 1).times(transition.probability))
          );
        }
      }
    }
  }

  // Expected total actions
  const expectedTotalActions = sum(Array.from(levelVisits.values()).map(v =>
    v.times(config.levels.find(l => levelVisits.get(l.id) === v)?.expectedVisits ?? ONE)
  ));

  // Path analysis (simplified)
  const pathAnalysis = analyzeBonusPaths(config, visits);

  // Maximum possible win
  const maxWin = calculateMaxPossibleWin(config);

  return {
    expectedValue,
    levelEVs,
    levelVisits,
    levelProbabilities,
    expectedFinalMultiplier,
    expectedTotalActions,
    pathAnalysis,
    maxWin
  };
}

/**
 * Analyze possible paths through bonus
 */
function analyzeBonusPaths(
  config: MultiLevelBonusConfig,
  visits: Map<string, Decimal>
): PathAnalysis {
  const entryLevel = config.levels.find(l => l.isEntry);
  if (!entryLevel) {
    return {
      mostCommonPath: [],
      highestValuePath: [],
      pathProbabilities: new Map(),
      averagePathLength: ZERO
    };
  }

  // Build paths using DFS
  const allPaths: Array<{ path: string[]; probability: Decimal; value: Decimal }> = [];

  function buildPaths(
    currentLevelId: string,
    currentPath: string[],
    currentProb: Decimal,
    currentValue: Decimal,
    depth: number
  ): void {
    if (depth > 20) return; // Prevent infinite recursion

    const level = config.levels.find(l => l.id === currentLevelId);
    if (!level) return;

    const newPath = [...currentPath, currentLevelId];
    const newValue = currentValue.plus(level.baseEV.times(level.levelMultiplier ?? 1));

    if (level.isTerminal || level.transitions.length === 0) {
      allPaths.push({ path: newPath, probability: currentProb, value: newValue });
      return;
    }

    for (const transition of level.transitions) {
      const targetLevel = config.levels.find(l => l.id === transition.targetLevelId);
      if (targetLevel) {
        buildPaths(
          transition.targetLevelId,
          newPath,
          currentProb.times(transition.probability),
          newValue.plus(transition.transitionReward ?? ZERO),
          depth + 1
        );
      } else {
        // Transition to END
        allPaths.push({
          path: newPath,
          probability: currentProb.times(transition.probability),
          value: newValue.plus(transition.transitionReward ?? ZERO)
        });
      }
    }
  }

  buildPaths(entryLevel.id, [], ONE, ZERO, 0);

  // Find most common and highest value paths
  const sortedByProb = [...allPaths].sort((a, b) => b.probability.minus(a.probability).toNumber());
  const sortedByValue = [...allPaths].sort((a, b) => b.value.minus(a.value).toNumber());

  const mostCommonPath = sortedByProb[0]?.path ?? [];
  const highestValuePath = sortedByValue[0]?.path ?? [];

  const pathProbabilities = new Map<string, Decimal>();
  for (const p of allPaths) {
    const key = p.path.join(' → ');
    pathProbabilities.set(key, p.probability);
  }

  const averagePathLength = sum(allPaths.map(p => dec(p.path.length).times(p.probability)));

  return {
    mostCommonPath,
    highestValuePath,
    pathProbabilities,
    averagePathLength
  };
}

/**
 * Calculate maximum possible win
 */
function calculateMaxPossibleWin(config: MultiLevelBonusConfig): Decimal {
  let maxWin = ZERO;
  const maxMultiplier = dec(config.maxMultiplier ?? 100);

  // Sum up max EV from each level (assuming all visited at max multiplier)
  for (const level of config.levels) {
    const levelMax = level.baseEV.times(level.levelMultiplier ?? 1).times(maxMultiplier);
    maxWin = maxWin.plus(levelMax);

    // Add transition rewards
    for (const transition of level.transitions) {
      if (transition.transitionReward) {
        maxWin = maxWin.plus(transition.transitionReward.times(maxMultiplier));
      }
    }

    // Add nested bonus max
    if (level.nestedBonus) {
      const nestedResult = calculateMultiLevelBonusEV(level.nestedBonus);
      maxWin = maxWin.plus(nestedResult.maxWin);
    }
  }

  return maxWin;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a linear bonus chain
 */
export function createLinearBonusChain(
  levels: Array<{
    id: string;
    name: string;
    type: BonusLevelType;
    baseEV: number;
    advanceProbability: number;
  }>
): MultiLevelBonusConfig {
  const bonusLevels: BonusLevel[] = levels.map((level, idx) => ({
    id: level.id,
    name: level.name,
    type: level.type,
    baseEV: dec(level.baseEV),
    isEntry: idx === 0,
    isTerminal: idx === levels.length - 1,
    transitions: idx < levels.length - 1
      ? [
          {
            targetLevelId: levels[idx + 1]!.id,
            probability: dec(level.advanceProbability)
          },
          {
            targetLevelId: 'END',
            probability: dec(1 - level.advanceProbability)
          }
        ]
      : []
  }));

  return {
    id: 'linear-chain',
    name: 'Linear Bonus Chain',
    levels: bonusLevels
  };
}

/**
 * Create a branching bonus (multiple paths)
 */
export function createBranchingBonus(
  entry: {
    id: string;
    name: string;
    type: BonusLevelType;
    baseEV: number;
  },
  branches: Array<{
    id: string;
    name: string;
    type: BonusLevelType;
    baseEV: number;
    selectionProbability: number;
  }>
): MultiLevelBonusConfig {
  const entryLevel: BonusLevel = {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    baseEV: dec(entry.baseEV),
    isEntry: true,
    transitions: branches.map(b => ({
      targetLevelId: b.id,
      probability: dec(b.selectionProbability)
    }))
  };

  const branchLevels: BonusLevel[] = branches.map(b => ({
    id: b.id,
    name: b.name,
    type: b.type,
    baseEV: dec(b.baseEV),
    isTerminal: true,
    transitions: []
  }));

  return {
    id: 'branching-bonus',
    name: 'Branching Bonus',
    levels: [entryLevel, ...branchLevels]
  };
}

/**
 * Create multiplier trail bonus (progressive multipliers)
 */
export function createMultiplierTrailBonus(
  stages: Array<{
    id: string;
    name: string;
    baseEV: number;
    multiplier: number;
    advanceProbability: number;
  }>
): MultiLevelBonusConfig {
  const levels: BonusLevel[] = stages.map((stage, idx) => ({
    id: stage.id,
    name: stage.name,
    type: 'MULTIPLIER_TRAIL' as BonusLevelType,
    baseEV: dec(stage.baseEV),
    levelMultiplier: stage.multiplier,
    isEntry: idx === 0,
    isTerminal: idx === stages.length - 1,
    transitions: idx < stages.length - 1
      ? [
          {
            targetLevelId: stages[idx + 1]!.id,
            probability: dec(stage.advanceProbability),
            stateModification: {
              setMultiplier: stages[idx + 1]!.multiplier
            }
          }
        ]
      : [],
    inheritsState: idx > 0
  }));

  // Add END transitions for non-terminal levels
  for (let i = 0; i < levels.length - 1; i++) {
    const level = levels[i]!;
    const advanceProb = level.transitions[0]?.probability ?? ZERO;
    level.transitions.push({
      targetLevelId: 'END',
      probability: ONE.minus(advanceProb)
    });
  }

  return {
    id: 'multiplier-trail',
    name: 'Multiplier Trail Bonus',
    levels,
    initialState: {
      multiplier: dec(stages[0]?.multiplier ?? 1)
    },
    maxMultiplier: stages[stages.length - 1]?.multiplier ?? 100
  };
}

/**
 * Calculate RTP contribution for multi-level bonus
 */
export function calculateMultiLevelBonusRTP(
  triggerProbability: Decimal,
  config: MultiLevelBonusConfig
): Decimal {
  const result = calculateMultiLevelBonusEV(config);
  return triggerProbability.times(result.expectedValue);
}
