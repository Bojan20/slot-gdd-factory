/**
 * SLOT MATH EXACT - Markov Chain Builder
 *
 * Builds Markov chains for feature EV calculation:
 * - Free Spins with multiplier progression
 * - Hold & Win respins
 * - Bonus game state machines
 *
 * Gaps addressed: #17, #18, #19 (Markov sanity)
 */

import { Decimal, dec, ZERO, ONE, sum, safeDivide, assertProbabilitiesSum } from '../core/decimal.js';

/**
 * Markov state
 */
export interface MarkovState {
  id: string;
  name: string;
  isTerminal: boolean;  // Absorbing state
  isInitial: boolean;   // Starting state
  expectedValue: Decimal;  // EV of being in this state
  metadata?: Record<string, unknown>;
}

/**
 * Markov transition
 */
export interface MarkovTransition {
  fromState: string;
  toState: string;
  probability: Decimal;
  reward: Decimal;  // Immediate reward on transition
}

/**
 * Markov chain
 */
export interface MarkovChain {
  states: Map<string, MarkovState>;
  transitions: Map<string, MarkovTransition[]>;  // fromState -> transitions
  initialState: string;
}

/**
 * Markov chain builder
 */
export class MarkovChainBuilder {
  private states: Map<string, MarkovState> = new Map();
  private transitions: Map<string, MarkovTransition[]> = new Map();
  private initialState: string | null = null;

  /**
   * Add a state
   */
  addState(
    id: string,
    options: {
      name?: string;
      isTerminal?: boolean;
      isInitial?: boolean;
      expectedValue?: Decimal;
      metadata?: Record<string, unknown>;
    } = {}
  ): this {
    const state: MarkovState = {
      id,
      name: options.name ?? id,
      isTerminal: options.isTerminal ?? false,
      isInitial: options.isInitial ?? false,
      expectedValue: options.expectedValue ?? ZERO,
      metadata: options.metadata
    };

    this.states.set(id, state);

    if (state.isInitial) {
      if (this.initialState !== null) {
        throw new Error(`Multiple initial states: ${this.initialState} and ${id}`);
      }
      this.initialState = id;
    }

    if (!this.transitions.has(id)) {
      this.transitions.set(id, []);
    }

    return this;
  }

  /**
   * Add a transition
   */
  addTransition(
    fromState: string,
    toState: string,
    probability: Decimal | number,
    reward: Decimal | number = 0
  ): this {
    const prob = typeof probability === 'number' ? dec(probability) : probability;
    const rew = typeof reward === 'number' ? dec(reward) : reward;

    if (!this.states.has(fromState)) {
      throw new Error(`Unknown source state: ${fromState}`);
    }
    if (!this.states.has(toState)) {
      throw new Error(`Unknown target state: ${toState}`);
    }

    const transition: MarkovTransition = {
      fromState,
      toState,
      probability: prob,
      reward: rew
    };

    const stateTransitions = this.transitions.get(fromState);
    if (stateTransitions) {
      stateTransitions.push(transition);
    }

    return this;
  }

  /**
   * Build and validate the chain
   */
  build(): MarkovChain {
    // Validate initial state
    if (this.initialState === null) {
      throw new Error('No initial state defined');
    }

    // Validate transitions sum to 1 for non-terminal states
    for (const [stateId, state] of this.states.entries()) {
      if (state.isTerminal) continue;

      const transitions = this.transitions.get(stateId) ?? [];

      if (transitions.length === 0) {
        throw new Error(`Non-terminal state ${stateId} has no outgoing transitions`);
      }

      const probSum = sum(transitions.map(t => t.probability));
      const diff = probSum.minus(ONE).abs();

      if (diff.greaterThan(dec('0.0001'))) {
        throw new Error(
          `Transitions from state ${stateId} sum to ${probSum.toString()}, not 1`
        );
      }
    }

    // Gap #18: Check for unreachable states
    const reachable = this.findReachableStates();
    for (const stateId of this.states.keys()) {
      if (!reachable.has(stateId)) {
        console.warn(`Warning: State ${stateId} is unreachable from initial state`);
      }
    }

    // Gap #17: Check for infinite loops (non-terminating chains)
    const canTerminate = this.canReachTerminal();
    if (!canTerminate) {
      throw new Error('Markov chain cannot reach any terminal state - infinite loop detected');
    }

    return {
      states: new Map(this.states),
      transitions: new Map(this.transitions),
      initialState: this.initialState
    };
  }

  /**
   * Find all states reachable from initial
   */
  private findReachableStates(): Set<string> {
    const reachable = new Set<string>();
    const stack = [this.initialState!];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (reachable.has(current)) continue;
      reachable.add(current);

      const transitions = this.transitions.get(current) ?? [];
      for (const t of transitions) {
        if (!reachable.has(t.toState)) {
          stack.push(t.toState);
        }
      }
    }

    return reachable;
  }

  /**
   * Check if terminal states are reachable
   */
  private canReachTerminal(): boolean {
    // BFS to check if any terminal state is reachable
    const visited = new Set<string>();
    const queue = [this.initialState!];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) continue;
      visited.add(current);

      const state = this.states.get(current);
      if (state?.isTerminal) {
        return true;
      }

      const transitions = this.transitions.get(current) ?? [];
      for (const t of transitions) {
        if (!visited.has(t.toState) && t.probability.greaterThan(ZERO)) {
          queue.push(t.toState);
        }
      }
    }

    return false;
  }

  /**
   * Reset builder
   */
  reset(): this {
    this.states.clear();
    this.transitions.clear();
    this.initialState = null;
    return this;
  }
}

/**
 * Solver for Markov chain expected values
 */
export class MarkovChainSolver {
  private chain: MarkovChain;

  constructor(chain: MarkovChain) {
    this.chain = chain;
  }

  /**
   * Calculate expected value starting from initial state
   * Uses value iteration for general chains
   */
  solveExpectedValue(maxIterations: number = 10000, tolerance: Decimal = dec('1e-20')): Decimal {
    const stateValues = new Map<string, Decimal>();

    // Initialize values (terminal states have their EV, others start at 0)
    for (const [id, state] of this.chain.states.entries()) {
      stateValues.set(id, state.isTerminal ? state.expectedValue : ZERO);
    }

    // Value iteration
    for (let iter = 0; iter < maxIterations; iter++) {
      let maxChange = ZERO;

      for (const [stateId, state] of this.chain.states.entries()) {
        if (state.isTerminal) continue;

        const transitions = this.chain.transitions.get(stateId) ?? [];
        let newValue = ZERO;

        for (const t of transitions) {
          const nextValue = stateValues.get(t.toState) ?? ZERO;
          const contribution = t.probability.times(t.reward.plus(nextValue));
          newValue = newValue.plus(contribution);
        }

        const oldValue = stateValues.get(stateId) ?? ZERO;
        const change = newValue.minus(oldValue).abs();

        if (change.greaterThan(maxChange)) {
          maxChange = change;
        }

        stateValues.set(stateId, newValue);
      }

      // Check convergence
      if (maxChange.lessThan(tolerance)) {
        break;
      }
    }

    return stateValues.get(this.chain.initialState) ?? ZERO;
  }

  /**
   * Calculate expected number of visits to each state
   */
  solveExpectedVisits(maxIterations: number = 10000): Map<string, Decimal> {
    const visits = new Map<string, Decimal>();

    // Initialize: initial state gets 1 visit to start
    for (const id of this.chain.states.keys()) {
      visits.set(id, id === this.chain.initialState ? ONE : ZERO);
    }

    // Iterate until convergence
    for (let iter = 0; iter < maxIterations; iter++) {
      const newVisits = new Map<string, Decimal>();

      for (const id of this.chain.states.keys()) {
        newVisits.set(id, id === this.chain.initialState ? ONE : ZERO);
      }

      // Add contributions from transitions
      for (const [stateId, state] of this.chain.states.entries()) {
        if (state.isTerminal) continue;

        const transitions = this.chain.transitions.get(stateId) ?? [];
        const sourceVisits = visits.get(stateId) ?? ZERO;

        for (const t of transitions) {
          const contribution = sourceVisits.times(t.probability);
          const current = newVisits.get(t.toState) ?? ZERO;
          newVisits.set(t.toState, current.plus(contribution));
        }
      }

      // Check convergence
      let maxChange = ZERO;
      for (const [id, newVal] of newVisits.entries()) {
        const oldVal = visits.get(id) ?? ZERO;
        const change = newVal.minus(oldVal).abs();
        if (change.greaterThan(maxChange)) {
          maxChange = change;
        }
      }

      visits.clear();
      for (const [id, val] of newVisits.entries()) {
        visits.set(id, val);
      }

      if (maxChange.lessThan(dec('1e-20'))) {
        break;
      }
    }

    return visits;
  }

  /**
   * Get transition matrix as 2D array (for debugging)
   */
  getTransitionMatrix(): { states: string[]; matrix: Decimal[][] } {
    const states = Array.from(this.chain.states.keys());
    const n = states.length;
    const matrix: Decimal[][] = [];

    for (let i = 0; i < n; i++) {
      const row: Decimal[] = [];
      for (let j = 0; j < n; j++) {
        row.push(ZERO);
      }
      matrix.push(row);
    }

    for (const [fromId, transitions] of this.chain.transitions.entries()) {
      const fromIdx = states.indexOf(fromId);

      for (const t of transitions) {
        const toIdx = states.indexOf(t.toState);
        const row = matrix[fromIdx];
        if (row) {
          row[toIdx] = t.probability;
        }
      }
    }

    return { states, matrix };
  }
}

/**
 * Build Free Spins Markov chain
 */
export function buildFreeSpinsChain(config: {
  initialSpins: number;
  retriggerProbability: Decimal;
  retriggerSpins: number;
  maxRetriggers: number;
  avgSpinWin: Decimal;
  multiplierProgression?: number[];
}): MarkovChain {
  const builder = new MarkovChainBuilder();

  // Terminal state
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });

  // Create states for each spin count remaining
  const maxSpins = config.initialSpins + config.maxRetriggers * config.retriggerSpins;

  for (let spins = 1; spins <= maxSpins; spins++) {
    const mult = config.multiplierProgression
      ? (config.multiplierProgression[Math.min(spins - 1, config.multiplierProgression.length - 1)] ?? 1)
      : 1;

    builder.addState(`SPINS_${spins}`, {
      name: `${spins} spins remaining`,
      isInitial: spins === config.initialSpins,
      expectedValue: config.avgSpinWin.times(mult)
    });
  }

  // Add transitions
  for (let spins = 1; spins <= maxSpins; spins++) {
    const canRetrigger = spins + config.retriggerSpins <= maxSpins;

    if (spins === 1) {
      // Last spin
      if (canRetrigger) {
        builder.addTransition(
          `SPINS_${spins}`,
          `SPINS_${spins + config.retriggerSpins}`,
          config.retriggerProbability,
          config.avgSpinWin
        );
        builder.addTransition(
          `SPINS_${spins}`,
          'END',
          ONE.minus(config.retriggerProbability),
          config.avgSpinWin
        );
      } else {
        builder.addTransition(`SPINS_${spins}`, 'END', ONE, config.avgSpinWin);
      }
    } else {
      // More spins remaining
      if (canRetrigger) {
        builder.addTransition(
          `SPINS_${spins}`,
          `SPINS_${spins - 1 + config.retriggerSpins}`,
          config.retriggerProbability,
          config.avgSpinWin
        );
        builder.addTransition(
          `SPINS_${spins}`,
          `SPINS_${spins - 1}`,
          ONE.minus(config.retriggerProbability),
          config.avgSpinWin
        );
      } else {
        builder.addTransition(`SPINS_${spins}`, `SPINS_${spins - 1}`, ONE, config.avgSpinWin);
      }
    }
  }

  return builder.build();
}

/**
 * Build Hold & Win Markov chain
 */
export function buildHoldAndWinChain(config: {
  initialRespins: number;
  gridSize: number;
  landingProbability: Decimal;
  avgSymbolValue: Decimal;
  fullGridBonus: Decimal;
}): MarkovChain {
  const builder = new MarkovChainBuilder();

  // Terminal states
  builder.addState('END', { isTerminal: true, expectedValue: ZERO });
  builder.addState('FULL_GRID', {
    isTerminal: true,
    expectedValue: config.fullGridBonus
  });

  // States: (respins, filled)
  // We simplify to just track respins remaining
  for (let respins = 0; respins <= config.initialRespins; respins++) {
    builder.addState(`RESPINS_${respins}`, {
      name: `${respins} respins`,
      isInitial: respins === config.initialRespins
    });
  }

  // Transitions
  for (let respins = 1; respins <= config.initialRespins; respins++) {
    // Land a symbol -> reset respins, add value
    builder.addTransition(
      `RESPINS_${respins}`,
      `RESPINS_${config.initialRespins}`,
      config.landingProbability,
      config.avgSymbolValue
    );

    // No landing -> decrease respins
    builder.addTransition(
      `RESPINS_${respins}`,
      `RESPINS_${respins - 1}`,
      ONE.minus(config.landingProbability),
      ZERO
    );
  }

  // 0 respins -> END
  builder.addTransition('RESPINS_0', 'END', ONE, ZERO);

  return builder.build();
}
