/**
 * SLOT MATH ENGINE TEMPLATE - Feature Engine
 *
 * Handles Free Spins feature logic:
 * - FS trigger and awarding
 * - Progressive multiplier (+1x each spin without win, reset on win)
 * - Retrigger handling
 * - H&W can trigger during FS
 */

import { RNG } from './rng.js';
import { spin, Grid } from './spin.js';
import { evaluate, EvaluationResult } from './evaluate.js';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { runHnWQuick } from './holdAndWin.js';

/**
 * State of an active Free Spins session
 */
export interface FreeSpinsState {
  remainingSpins: number;
  totalSpinsAwarded: number;
  retriggersCount: number;
  progressiveMultiplier: number;  // v7: +1x each spin without win, reset on win
  spinsPlayed: number;
  hnwTriggersCount: number;       // v7: H&W can trigger during FS
}

/**
 * Result of a single FS spin
 */
export interface FreeSpinResult {
  spinNumber: number;
  grid: Grid;
  evaluation: EvaluationResult;
  win: number;
  multiplierApplied: number;
  retriggered: boolean;
  spinsAwarded: number;
  hnwTriggered: boolean;
  hnwWin: number;
}

/**
 * Complete Free Spins session result
 */
export interface FreeSpinsSessionResult {
  initialSpinsAwarded: number;
  totalSpinsPlayed: number;
  retriggersCount: number;
  maxMultiplier: number;        // Max progressive multiplier reached
  spinResults: FreeSpinResult[];
  totalWin: number;
  averageWinPerSpin: number;
  hnwTriggersCount: number;     // H&W triggers during FS
  hnwTotalWin: number;          // Total H&W wins during FS
}

/**
 * Initialize a Free Spins session
 */
export function initFreeSpinsState(spinsAwarded: number): FreeSpinsState {
  return {
    remainingSpins: spinsAwarded,
    totalSpinsAwarded: spinsAwarded,
    retriggersCount: 0,
    progressiveMultiplier: 1,  // Starts at 1x
    spinsPlayed: 0,
    hnwTriggersCount: 0
  };
}

/**
 * Handle retrigger in Free Spins
 */
function handleRetrigger(
  state: FreeSpinsState,
  spinsAwarded: number
): FreeSpinsState {
  const maxFS = GAME_CONFIG.caps.maxFreeSpinsFromRetrigger;

  // Cap total FS
  const actualAwarded = Math.min(spinsAwarded, maxFS - state.totalSpinsAwarded);

  if (actualAwarded <= 0) {
    return state; // At cap, no more retriggers
  }

  return {
    ...state,
    remainingSpins: state.remainingSpins + actualAwarded,
    totalSpinsAwarded: state.totalSpinsAwarded + actualAwarded,
    retriggersCount: state.retriggersCount + 1
    // v7: Progressive multiplier not affected by retrigger
  };
}

/**
 * Run a single Free Spin (v7: progressive multiplier)
 */
function runFreeSpin(
  rng: RNG,
  state: FreeSpinsState
): { result: FreeSpinResult; newState: FreeSpinsState } {
  // Use FS reels
  const spinData = spin(rng, true);

  // Evaluate with progressive multiplier
  const evaluation = evaluate(spinData.grid, rng, state.progressiveMultiplier);

  const hasWin = evaluation.baseWin > 0;

  // v7 Progressive multiplier logic:
  // - If no win: +1x (up to max)
  // - If win: reset to 1x
  let newMultiplier: number;
  if (hasWin) {
    newMultiplier = 1; // Reset on win
  } else {
    newMultiplier = Math.min(
      state.progressiveMultiplier + 1,
      GAME_CONFIG.freeSpins.maxMultiplier
    );
  }

  let newState: FreeSpinsState = {
    ...state,
    remainingSpins: state.remainingSpins - 1,
    spinsPlayed: state.spinsPlayed + 1,
    progressiveMultiplier: newMultiplier
  };

  // Handle retrigger
  let retriggered = false;
  let spinsAwarded = 0;

  if (evaluation.triggeredFS && state.retriggersCount < GAME_CONFIG.freeSpins.maxRetriggers) {
    retriggered = true;
    spinsAwarded = evaluation.freeSpinsAwarded;
    newState = handleRetrigger(newState, spinsAwarded);
  }

  // Handle H&W trigger during FS
  let hnwTriggered = false;
  let hnwWin = 0;

  if (evaluation.triggeredHnW) {
    hnwTriggered = true;
    const hnwResult = runHnWQuick(spinData.grid, rng);
    hnwWin = hnwResult.totalWin;
    newState = {
      ...newState,
      hnwTriggersCount: newState.hnwTriggersCount + 1
    };
  }

  const result: FreeSpinResult = {
    spinNumber: state.spinsPlayed + 1,
    grid: spinData.grid,
    evaluation,
    win: evaluation.totalWin + hnwWin,
    multiplierApplied: state.progressiveMultiplier,
    retriggered,
    spinsAwarded,
    hnwTriggered,
    hnwWin
  };

  return { result, newState };
}

/**
 * Run complete Free Spins session
 */
export function runFreeSpinsSession(
  rng: RNG,
  initialSpinsAwarded: number
): FreeSpinsSessionResult {
  let state = initFreeSpinsState(initialSpinsAwarded);
  const spinResults: FreeSpinResult[] = [];
  let totalWin = 0;
  let maxMultiplier = 1;
  let hnwTotalWin = 0;

  while (state.remainingSpins > 0) {
    const { result, newState } = runFreeSpin(rng, state);
    spinResults.push(result);
    totalWin += result.win;

    if (result.multiplierApplied > maxMultiplier) {
      maxMultiplier = result.multiplierApplied;
    }

    if (result.hnwTriggered) {
      hnwTotalWin += result.hnwWin;
    }

    state = newState;
  }

  return {
    initialSpinsAwarded,
    totalSpinsPlayed: state.spinsPlayed,
    retriggersCount: state.retriggersCount,
    maxMultiplier,
    spinResults,
    totalWin,
    averageWinPerSpin: state.spinsPlayed > 0 ? totalWin / state.spinsPlayed : 0,
    hnwTriggersCount: state.hnwTriggersCount,
    hnwTotalWin
  };
}

/**
 * Quick Free Spins run (no detailed results, for simulation)
 * Returns just the total win
 */
export function runFreeSpinsQuick(
  rng: RNG,
  initialSpinsAwarded: number
): {
  totalWin: number;
  totalSpins: number;
  retriggersCount: number;
  maxMultiplier: number;
  hnwTriggersCount: number;
  hnwTotalWin: number;
} {
  let state = initFreeSpinsState(initialSpinsAwarded);
  let totalWin = 0;
  let maxMultiplier = 1;
  let hnwTotalWin = 0;

  while (state.remainingSpins > 0) {
    // Use FS reels
    const spinData = spin(rng, true);

    // Evaluate with progressive multiplier
    const evaluation = evaluate(spinData.grid, rng, state.progressiveMultiplier);

    totalWin += evaluation.totalWin;

    // Track max multiplier
    if (state.progressiveMultiplier > maxMultiplier) {
      maxMultiplier = state.progressiveMultiplier;
    }

    // v7 Progressive multiplier logic
    const hasWin = evaluation.baseWin > 0;
    let newMultiplier: number;
    if (hasWin) {
      newMultiplier = 1;
    } else {
      newMultiplier = Math.min(
        state.progressiveMultiplier + 1,
        GAME_CONFIG.freeSpins.maxMultiplier
      );
    }

    // Update state
    state = {
      ...state,
      remainingSpins: state.remainingSpins - 1,
      spinsPlayed: state.spinsPlayed + 1,
      progressiveMultiplier: newMultiplier
    };

    // Handle retrigger
    if (evaluation.triggeredFS && state.retriggersCount < GAME_CONFIG.freeSpins.maxRetriggers) {
      state = handleRetrigger(state, evaluation.freeSpinsAwarded);
    }

    // Handle H&W trigger during FS
    if (evaluation.triggeredHnW) {
      const hnwResult = runHnWQuick(spinData.grid, rng);
      totalWin += hnwResult.totalWin;
      hnwTotalWin += hnwResult.totalWin;
      state = {
        ...state,
        hnwTriggersCount: state.hnwTriggersCount + 1
      };
    }
  }

  return {
    totalWin,
    totalSpins: state.spinsPlayed,
    retriggersCount: state.retriggersCount,
    maxMultiplier,
    hnwTriggersCount: state.hnwTriggersCount,
    hnwTotalWin
  };
}

/**
 * Calculate expected FS value (theoretical)
 * Used for quick RTP estimation
 */
export function estimateFSExpectedValue(): {
  avgSpins: number;
  avgWinPerSpin: number;
  expectedTotalWin: number;
} {
  // v7: Updated estimates for 8/12/15 spin awards
  const avgInitialSpins = (8 + 12 + 15) / 3; // ~11.67
  const retriggerRate = 0.01; // Estimated 1% retrigger chance per FS spin
  const avgRetriggerSpins = avgInitialSpins * 0.5;

  // Geometric series for expected total spins
  const avgSpins = avgInitialSpins / (1 - retriggerRate * avgRetriggerSpins / avgInitialSpins);

  // v7: Progressive multiplier increases avg win
  // With max 10x and reset on win, effective avg ~2-3x
  const avgWinPerSpin = 3.5; // Placeholder - simulation will refine

  return {
    avgSpins,
    avgWinPerSpin,
    expectedTotalWin: avgSpins * avgWinPerSpin
  };
}

/**
 * Wrapper function for testing - runs FS with starting multiplier
 * Returns result compatible with test expectations
 */
export function playFreeSpins(
  initialSpinsAwarded: number,
  rng: RNG,
  _startingMultiplier: number = 1  // Ignored in v7, progressive starts at 1x
): {
  totalWin: number;
  spinsPlayed: number;
  retriggerCount: number;
} {
  const result = runFreeSpinsQuick(rng, initialSpinsAwarded);

  return {
    totalWin: result.totalWin,
    spinsPlayed: result.totalSpins,
    retriggerCount: result.retriggersCount
  };
}
