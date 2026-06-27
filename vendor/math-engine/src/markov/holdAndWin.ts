/**
 * SLOT MATH EXACT - Hold & Win Markov Chain
 *
 * Proper implementation of Hold & Win / Link / Respins mechanics.
 *
 * State space: (respinsRemaining, filledPositions)
 * - respinsRemaining: 0 to initialRespins
 * - filledPositions: 0 to gridSize (bitmask in full version)
 *
 * For exact calculation, we track:
 * - Probability of landing N symbols given M empty positions
 * - Expected value of landed symbols
 * - Jackpot conditions (full grid, specific patterns)
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
import { MarkovChainBuilder, MarkovChainSolver, type MarkovChain } from './builder.js';

/**
 * Hold & Win Markov calculation configuration
 *
 * Note: This is different from HoldAndWinConfig in types/config.ts
 * which is the game configuration schema. This interface is for
 * internal Markov chain calculations.
 */
export interface HoldAndWinMarkovConfig {
  /** Initial respins awarded */
  initialRespins: number;
  /** Grid dimensions */
  gridRows: number;
  gridCols: number;
  /** Probability of symbol landing on empty position */
  landingProbability: Decimal;
  /** Symbol value distribution */
  symbolValues: Array<{
    value: Decimal;
    weight: number;
  }>;
  /** Jackpots */
  jackpots?: {
    mini?: { threshold: number; value: Decimal };
    minor?: { threshold: number; value: Decimal };
    major?: { threshold: number; value: Decimal };
    grand?: { condition: 'FULL_GRID'; value: Decimal };
  };
  /** Reset respins on landing */
  resetOnLanding: boolean;
}

/**
 * State in Hold & Win Markov chain
 */
interface HoldAndWinState {
  respins: number;
  filled: number;
  /** Cumulative value collected so far */
  collectedValue: Decimal;
}

/**
 * Calculate probability of landing exactly k symbols on n empty positions
 * Using binomial distribution
 */
export function landingProbability(
  emptyPositions: number,
  landingsTarget: number,
  pLand: Decimal
): Decimal {
  if (landingsTarget > emptyPositions) return ZERO;
  if (landingsTarget < 0) return ZERO;

  const pNoLand = ONE.minus(pLand);

  // C(n, k) * p^k * (1-p)^(n-k)
  const combinations = bigIntToDecimal(binomial(emptyPositions, landingsTarget));
  const pSuccess = pLand.pow(landingsTarget);
  const pFailure = pNoLand.pow(emptyPositions - landingsTarget);

  return combinations.times(pSuccess).times(pFailure);
}

/**
 * Calculate expected value of landing k symbols
 */
export function expectedLandingValue(
  numLandings: number,
  symbolValues: Array<{ value: Decimal; weight: number }>
): Decimal {
  if (numLandings === 0) return ZERO;

  // Calculate weighted average symbol value
  const totalWeight = symbolValues.reduce((sum, sv) => sum + sv.weight, 0);
  const avgValue = symbolValues.reduce(
    (sum, sv) => sum.plus(sv.value.times(sv.weight)),
    ZERO
  );

  const expectedPerSymbol = safeDivide(avgValue, dec(totalWeight));
  return expectedPerSymbol.times(numLandings);
}

/**
 * Build Hold & Win Markov chain with proper state tracking
 */
export function buildHoldAndWinMarkovChain(config: HoldAndWinMarkovConfig): MarkovChain {
  const builder = new MarkovChainBuilder();
  const gridSize = config.gridRows * config.gridCols;

  // Terminal states
  builder.addState('END', { isTerminal: true, expectedValue: ZERO, name: 'Feature End' });

  // Grand jackpot (full grid)
  if (config.jackpots?.grand) {
    builder.addState('GRAND_JACKPOT', {
      isTerminal: true,
      expectedValue: config.jackpots.grand.value,
      name: 'Grand Jackpot'
    });
  }

  // States: RESPINS_{r}_FILLED_{f}
  // r = respins remaining (0 to initialRespins)
  // f = positions filled (0 to gridSize)

  // Note: We can't start with 0 filled (need trigger symbols)
  // Typically H&W triggers with 4-6 symbols already on grid
  const minTriggerSymbols = 4;  // Configurable

  for (let respins = 0; respins <= config.initialRespins; respins++) {
    for (let filled = minTriggerSymbols; filled <= gridSize; filled++) {
      const stateId = `R${respins}_F${filled}`;
      const isInitial = respins === config.initialRespins && filled === minTriggerSymbols;

      builder.addState(stateId, {
        name: `${respins} respins, ${filled} filled`,
        isInitial,
        metadata: { respins, filled }
      });
    }
  }

  // Add transitions
  for (let respins = 1; respins <= config.initialRespins; respins++) {
    for (let filled = minTriggerSymbols; filled < gridSize; filled++) {
      const fromState = `R${respins}_F${filled}`;
      const emptyPositions = gridSize - filled;

      // For each possible number of new landings (0 to emptyPositions)
      for (let newLandings = 0; newLandings <= emptyPositions; newLandings++) {
        const prob = landingProbability(emptyPositions, newLandings, config.landingProbability);

        if (prob.lessThan(dec('1e-30'))) continue;  // Skip negligible probabilities

        const newFilled = filled + newLandings;
        const reward = expectedLandingValue(newLandings, config.symbolValues);

        if (newFilled === gridSize) {
          // Full grid - Grand Jackpot!
          if (config.jackpots?.grand) {
            builder.addTransition(fromState, 'GRAND_JACKPOT', prob, reward);
          } else {
            builder.addTransition(fromState, 'END', prob, reward);
          }
        } else if (newLandings > 0 && config.resetOnLanding) {
          // Landing occurred - reset respins
          const toState = `R${config.initialRespins}_F${newFilled}`;
          builder.addTransition(fromState, toState, prob, reward);
        } else if (newLandings > 0) {
          // Landing but no reset
          const newRespins = respins - 1;
          if (newRespins > 0) {
            const toState = `R${newRespins}_F${newFilled}`;
            builder.addTransition(fromState, toState, prob, reward);
          } else {
            builder.addTransition(fromState, 'END', prob, reward);
          }
        } else {
          // No landing - decrease respins
          const newRespins = respins - 1;
          if (newRespins > 0) {
            const toState = `R${newRespins}_F${filled}`;
            builder.addTransition(fromState, toState, prob, ZERO);
          } else {
            builder.addTransition(fromState, 'END', prob, ZERO);
          }
        }
      }
    }

    // Handle full grid state (shouldn't have outgoing transitions, but just in case)
    const fullGridState = `R${respins}_F${gridSize}`;
    if (builder['states'].has(fullGridState)) {
      if (config.jackpots?.grand) {
        builder.addTransition(fullGridState, 'GRAND_JACKPOT', ONE, ZERO);
      } else {
        builder.addTransition(fullGridState, 'END', ONE, ZERO);
      }
    }
  }

  // Respins = 0 states go to END
  for (let filled = minTriggerSymbols; filled <= gridSize; filled++) {
    const state = `R0_F${filled}`;
    if (builder['states'].has(state)) {
      builder.addTransition(state, 'END', ONE, ZERO);
    }
  }

  return builder.build();
}

/**
 * Calculate Hold & Win expected value
 */
export function calculateHoldAndWinEV(config: HoldAndWinMarkovConfig): {
  expectedValue: Decimal;
  expectedRespins: Decimal;
  grandJackpotProbability: Decimal;
} {
  const chain = buildHoldAndWinMarkovChain(config);
  const solver = new MarkovChainSolver(chain);

  const expectedValue = solver.solveExpectedValue();
  const visits = solver.solveExpectedVisits();

  // Calculate expected respins (sum of visits to respin states)
  let totalRespinVisits = ZERO;
  for (const [stateId, visitCount] of visits.entries()) {
    if (stateId.startsWith('R') && !stateId.includes('END')) {
      totalRespinVisits = totalRespinVisits.plus(visitCount);
    }
  }

  // Grand jackpot probability
  const grandVisits = visits.get('GRAND_JACKPOT') ?? ZERO;

  return {
    expectedValue,
    expectedRespins: totalRespinVisits,
    grandJackpotProbability: grandVisits
  };
}

/**
 * Quick Hold & Win RTP calculation
 */
export function calculateHoldAndWinRTP(
  triggerProbability: Decimal,
  config: HoldAndWinMarkovConfig,
  triggerSymbolsValue: Decimal = ZERO
): Decimal {
  const { expectedValue } = calculateHoldAndWinEV(config);

  // Total RTP = P(trigger) × (trigger_value + EV)
  return triggerProbability.times(triggerSymbolsValue.plus(expectedValue));
}
