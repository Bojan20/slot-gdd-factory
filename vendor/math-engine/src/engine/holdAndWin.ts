/**
 * SLOT MATH ENGINE TEMPLATE - Hold & Win Engine
 *
 * Generic collect-and-respin style Hold & Win feature:
 * - Triggered by configurable number of Special symbols
 * - Respins (reset on new symbol)
 * - Each symbol carries cash value or jackpot tier
 * - Full grid = Jackpot bonus
 *
 * USES symbolConfig.ts for symbol role abstraction
 */

import { RNG } from './rng.js';
import { SymbolId } from '../model/symbols.js';
import { Grid } from './spin.js';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { isSpecial, FEATURE_FLAGS } from '../config/symbolConfig.js';

/**
 * Orb value types
 */
export type OrbValueType = 'cash' | 'mini' | 'minor' | 'major' | 'grand';

export interface OrbValue {
  type: OrbValueType;
  multiplier: number;  // x bet
}

/**
 * Orb value distribution (weights must sum to 10000 for precision)
 *
 * Target: H&W avg win ~41x for ~21.5% RTP contribution
 * H&W frequency: 1/191, need (41x * 1/191) = 21.5% contribution
 * Total: Base 53% + FS 18.5% + H&W 21.5% + Scatter 2.15% = 95.15% + 0.85% tolerance = 96%
 */
export const ORB_VALUE_TABLE: Array<{ value: OrbValue; weight: number }> = [
  // Cash values (99.8% total) - precision tuned for exact 96.00% RTP
  // v7.2.2 - Fine tuned: RTP was 95.86% (need +0.14%), previous +0.98% was too much
  // Target avg orb ~4.15x (between 4.1x and 4.25x)
  { value: { type: 'cash', multiplier: 1 }, weight: 2750 },   // 27.5%
  { value: { type: 'cash', multiplier: 2 }, weight: 2550 },   // 25.5%
  { value: { type: 'cash', multiplier: 4 }, weight: 2000 },   // 20.0%
  { value: { type: 'cash', multiplier: 8 }, weight: 1460 },   // 14.6% (tiny bump)
  { value: { type: 'cash', multiplier: 15 }, weight: 740 },   // 7.4% (tiny bump)
  { value: { type: 'cash', multiplier: 32 }, weight: 340 },   // 3.4% (31→32)
  { value: { type: 'cash', multiplier: 63 }, weight: 140 },   // 1.4% (62→63)

  // Jackpot tiers (0.2% total) - rare but exciting
  { value: { type: 'mini', multiplier: 25 }, weight: 12 },    // 0.12%
  { value: { type: 'minor', multiplier: 75 }, weight: 5 },    // 0.05%
  { value: { type: 'major', multiplier: 200 }, weight: 2 },   // 0.02%
  { value: { type: 'grand', multiplier: 750 }, weight: 1 },   // 0.01%
];

// Pre-calculate total weight
const TOTAL_ORB_WEIGHT = ORB_VALUE_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

/**
 * Jackpot bonus for full grid (all positions filled)
 * Rename this constant for your game theme
 */
export const FULL_GRID_JACKPOT_BONUS = 1000; // +1000x for filling all positions


/**
 * Hold & Win configuration
 */
export const HNW_CONFIG = {
  triggerOrbCount: 6,      // Minimum orbs to trigger
  initialRespins: 3,       // Starting respins
  maxRespins: 3,           // Reset to this on new orb
  gridSize: 15,            // 5x3 = 15 positions
};

/**
 * Position on the grid
 */
export interface GridPosition {
  row: number;
  reel: number;
}

/**
 * Locked orb during H&W
 */
export interface LockedOrb {
  position: GridPosition;
  value: OrbValue;
}

/**
 * H&W session state
 */
export interface HnWState {
  lockedOrbs: LockedOrb[];
  respinsRemaining: number;
  totalRespins: number;
  isComplete: boolean;
}

/**
 * Single respin result
 */
export interface RespinResult {
  newOrbs: LockedOrb[];
  respinsRemaining: number;
  gridFilled: boolean;
}

/**
 * Complete H&W session result
 */
export interface HnWSessionResult {
  triggeredWith: number;      // Initial special symbol count
  finalOrbCount: number;      // Final special symbol count
  totalRespins: number;
  lockedOrbs: LockedOrb[];
  cashTotal: number;          // Sum of all symbol values
  fullGridJackpot: boolean;   // Full grid achieved
  fullGridBonus: number;      // Bonus amount if full grid
  totalWin: number;           // Final total (cash + bonus)
}

/**
 * Roll an orb value using weighted random
 */
export function rollOrbValue(rng: RNG): OrbValue {
  const roll = rng.nextInt(TOTAL_ORB_WEIGHT);

  let cumulative = 0;
  for (const entry of ORB_VALUE_TABLE) {
    cumulative += entry.weight;
    if (roll < cumulative) {
      return entry.value;
    }
  }

  // Fallback (should never reach)
  return { type: 'cash', multiplier: 1 };
}

/**
 * Count Special symbols in a grid
 * Uses symbolConfig.isSpecial() for detection
 */
export function countSpecialSymbols(grid: Grid): number {
  let count = 0;
  for (let row = 0; row < grid.length; row++) {
    for (let reel = 0; reel < grid[row].length; reel++) {
      if (isSpecial(grid[row][reel])) {
        count++;
      }
    }
  }
  return count;
}

// Backwards compatibility alias
export function countLightningOrbs(grid: Grid): number {
  return countSpecialSymbols(grid);
}

/**
 * Get all Special symbol positions from initial trigger grid
 * Uses symbolConfig.isSpecial() for detection
 */
export function getSpecialPositions(grid: Grid): GridPosition[] {
  const positions: GridPosition[] = [];
  for (let row = 0; row < grid.length; row++) {
    for (let reel = 0; reel < grid[row].length; reel++) {
      if (isSpecial(grid[row][reel])) {
        positions.push({ row, reel });
      }
    }
  }
  return positions;
}

// Backwards compatibility alias
export function getOrbPositions(grid: Grid): GridPosition[] {
  return getSpecialPositions(grid);
}

/**
 * Check if H&W should trigger
 */
export function shouldTriggerHnW(grid: Grid): boolean {
  if (!FEATURE_FLAGS.hasHoldAndWin) return false;
  return countSpecialSymbols(grid) >= HNW_CONFIG.triggerOrbCount;
}

/**
 * Initialize H&W session from trigger grid
 */
export function initHnWSession(grid: Grid, rng: RNG): HnWState {
  const positions = getSpecialPositions(grid);
  const lockedOrbs: LockedOrb[] = positions.map(pos => ({
    position: pos,
    value: rollOrbValue(rng)
  }));

  return {
    lockedOrbs,
    respinsRemaining: HNW_CONFIG.initialRespins,
    totalRespins: 0,
    isComplete: false
  };
}

/**
 * Get available (empty) positions
 */
function getAvailablePositions(lockedOrbs: LockedOrb[]): GridPosition[] {
  const locked = new Set(
    lockedOrbs.map(orb => `${orb.position.row},${orb.position.reel}`)
  );

  const available: GridPosition[] = [];
  for (let row = 0; row < 3; row++) {
    for (let reel = 0; reel < 5; reel++) {
      if (!locked.has(`${row},${reel}`)) {
        available.push({ row, reel });
      }
    }
  }
  return available;
}

/**
 * Calculate orb landing probability during respin
 * Lower probability to control H&W average win
 *
 * Industry standard: ~2-4% per empty position
 * With 10 empty positions: expect 0.2-0.4 new orbs per respin
 * Most H&W sessions end with 6-8 orbs (trigger + 1-2 from respins)
 */
function getOrbLandingProbability(filledCount: number): number {
  // Base probability: ~3% per empty position
  // Slight increase as grid fills (psychological tension)
  const base = 0.03;
  const fillBonus = (filledCount / HNW_CONFIG.gridSize) * 0.02;
  return Math.min(base + fillBonus, 0.06); // Cap at 6%
}

/**
 * Execute a single respin
 */
export function executeRespin(state: HnWState, rng: RNG): RespinResult {
  const available = getAvailablePositions(state.lockedOrbs);
  const newOrbs: LockedOrb[] = [];

  const landingProb = getOrbLandingProbability(state.lockedOrbs.length);

  // Roll for each available position
  for (const pos of available) {
    if (rng.random() < landingProb) {
      newOrbs.push({
        position: pos,
        value: rollOrbValue(rng)
      });
    }
  }

  const totalOrbs = state.lockedOrbs.length + newOrbs.length;
  const gridFilled = totalOrbs >= HNW_CONFIG.gridSize;

  // Respins: reset to max if new orbs landed, otherwise decrement
  let respinsRemaining: number;
  if (gridFilled) {
    respinsRemaining = 0;
  } else if (newOrbs.length > 0) {
    respinsRemaining = HNW_CONFIG.maxRespins;
  } else {
    respinsRemaining = state.respinsRemaining - 1;
  }

  return {
    newOrbs,
    respinsRemaining,
    gridFilled
  };
}

/**
 * Run complete Hold & Win session
 */
export function runHnWSession(grid: Grid, rng: RNG): HnWSessionResult {
  let state = initHnWSession(grid, rng);
  const initialCount = state.lockedOrbs.length;

  // Main respin loop
  while (state.respinsRemaining > 0 && state.lockedOrbs.length < HNW_CONFIG.gridSize) {
    const result = executeRespin(state, rng);

    state = {
      lockedOrbs: [...state.lockedOrbs, ...result.newOrbs],
      respinsRemaining: result.respinsRemaining,
      totalRespins: state.totalRespins + 1,
      isComplete: result.gridFilled || result.respinsRemaining === 0
    };
  }

  // Calculate total cash value
  const cashTotal = state.lockedOrbs.reduce(
    (sum, orb) => sum + orb.value.multiplier,
    0
  );

  // Check for Full Grid Jackpot
  const fullGridJackpot = state.lockedOrbs.length >= HNW_CONFIG.gridSize;
  const fullGridBonus = fullGridJackpot ? FULL_GRID_JACKPOT_BONUS : 0;

  // Total win (with cap)
  let totalWin = cashTotal + fullGridBonus;
  if (totalWin > GAME_CONFIG.caps.maxWinMultiplier) {
    totalWin = GAME_CONFIG.caps.maxWinMultiplier;
  }

  return {
    triggeredWith: initialCount,
    finalOrbCount: state.lockedOrbs.length,
    totalRespins: state.totalRespins,
    lockedOrbs: state.lockedOrbs,
    cashTotal,
    fullGridJackpot,
    fullGridBonus,
    totalWin
  };
}

/**
 * Quick H&W run for simulation (minimal memory)
 */
export function runHnWQuick(grid: Grid, rng: RNG): {
  totalWin: number;
  orbCount: number;
  respins: number;
  fullGridJackpot: boolean;
} {
  const result = runHnWSession(grid, rng);

  return {
    totalWin: result.totalWin,
    orbCount: result.finalOrbCount,
    respins: result.totalRespins,
    fullGridJackpot: result.fullGridJackpot
  };
}

/**
 * Calculate expected value of H&W feature
 * Used for RTP estimation
 */
export function calculateHnWExpectedValue(): {
  avgOrbValue: number;
  avgOrbsOnTrigger: number;
  avgOrbsAfterRespins: number;
  avgTotalWin: number;
  fullGridProbability: number;
} {
  // Calculate average special symbol value
  let avgOrbValue = 0;
  for (const entry of ORB_VALUE_TABLE) {
    avgOrbValue += entry.value.multiplier * (entry.weight / TOTAL_ORB_WEIGHT);
  }

  // Estimated values (refined by simulation)
  const avgOrbsOnTrigger = 6.5;  // Usually 6-7 symbols trigger
  const avgNewOrbsFromRespins = 2.5;  // Estimated from probability
  const avgOrbsAfterRespins = avgOrbsOnTrigger + avgNewOrbsFromRespins;

  const avgCashWin = avgOrbsAfterRespins * avgOrbValue;

  // Full grid jackpot probability (very rare)
  const fullGridProbability = 0.001; // ~0.1% of H&W sessions
  const fullGridContribution = fullGridProbability * FULL_GRID_JACKPOT_BONUS;

  const avgTotalWin = avgCashWin + fullGridContribution;

  return {
    avgOrbValue,
    avgOrbsOnTrigger,
    avgOrbsAfterRespins,
    avgTotalWin,
    fullGridProbability
  };
}
