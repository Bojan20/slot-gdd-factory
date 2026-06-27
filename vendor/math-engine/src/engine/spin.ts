/**
 * SLOT MATH ENGINE TEMPLATE - Spin Engine
 *
 * Handles the core spin mechanics:
 * - Reel stop position selection
 * - Grid generation from reel strips
 * - Window extraction
 */

import { SymbolId } from '../model/symbols.js';
import { BASE_REELS, FREE_SPINS_REELS, getWindow } from '../model/reels.js';
import { NUM_REELS, NUM_ROWS } from '../model/paylines.js';
import { RNG } from './rng.js';

/**
 * 5x3 grid representation
 * grid[row][reel] = symbol
 */
export type Grid = SymbolId[][];

/**
 * Stop positions for each reel
 */
export type StopPositions = number[];

/**
 * Spin result containing grid and stop positions
 */
export interface SpinData {
  grid: Grid;
  stopPositions: StopPositions;
  isFreeSpins: boolean;
}

/**
 * Generate random stop positions for all reels
 */
export function generateStopPositions(rng: RNG, isFreeSpins: boolean = false): StopPositions {
  const reels = isFreeSpins ? FREE_SPINS_REELS : BASE_REELS;
  const stops: StopPositions = [];

  for (let i = 0; i < NUM_REELS; i++) {
    const reelLength = reels[i].length;
    stops.push(rng.nextInt(reelLength));
  }

  return stops;
}

/**
 * Build grid from stop positions
 * Each reel window shows 3 symbols starting from stop position
 */
export function buildGrid(stopPositions: StopPositions, isFreeSpins: boolean = false): Grid {
  const grid: Grid = [];

  // Initialize empty grid (rows x reels)
  for (let row = 0; row < NUM_ROWS; row++) {
    grid.push([]);
  }

  // Fill grid from reel windows
  for (let reel = 0; reel < NUM_REELS; reel++) {
    const window = getWindow(reel, stopPositions[reel], isFreeSpins);

    for (let row = 0; row < NUM_ROWS; row++) {
      grid[row][reel] = window[row];
    }
  }

  return grid;
}

/**
 * Perform a single spin
 */
export function spin(rng: RNG, isFreeSpins: boolean = false): SpinData {
  const stopPositions = generateStopPositions(rng, isFreeSpins);
  const grid = buildGrid(stopPositions, isFreeSpins);

  return {
    grid,
    stopPositions,
    isFreeSpins
  };
}

/**
 * Get symbol at specific grid position
 */
export function getSymbolAtPosition(grid: Grid, row: number, reel: number): SymbolId {
  return grid[row][reel];
}

/**
 * Get all symbols on a specific reel (column)
 */
export function getReelSymbols(grid: Grid, reel: number): SymbolId[] {
  return grid.map(row => row[reel]);
}

/**
 * Get all symbols in a specific row
 */
export function getRowSymbols(grid: Grid, row: number): SymbolId[] {
  return grid[row];
}

/**
 * Count occurrences of a symbol in the grid
 */
export function countSymbol(grid: Grid, symbol: SymbolId): number {
  let count = 0;

  for (let row = 0; row < NUM_ROWS; row++) {
    for (let reel = 0; reel < NUM_REELS; reel++) {
      if (grid[row][reel] === symbol) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Find all positions of a symbol in the grid
 */
export function findSymbolPositions(
  grid: Grid,
  symbol: SymbolId
): Array<{ row: number; reel: number }> {
  const positions: Array<{ row: number; reel: number }> = [];

  for (let row = 0; row < NUM_ROWS; row++) {
    for (let reel = 0; reel < NUM_REELS; reel++) {
      if (grid[row][reel] === symbol) {
        positions.push({ row, reel });
      }
    }
  }

  return positions;
}

/**
 * Pretty print grid for debugging
 */
export function printGrid(grid: Grid): string {
  const lines: string[] = [];

  lines.push('┌─────────────────────────────────┐');

  for (let row = 0; row < NUM_ROWS; row++) {
    const symbols = grid[row].map(s => {
      // Abbreviate symbol names for display
      const name = s.replace('LP_', '').replace('HP_', '').replace('_', '');
      return name.substring(0, 5).padEnd(5);
    });
    lines.push(`│ ${symbols.join(' │ ')} │`);

    if (row < NUM_ROWS - 1) {
      lines.push('├─────────────────────────────────┤');
    }
  }

  lines.push('└─────────────────────────────────┘');

  return lines.join('\n');
}

/**
 * Clone a grid (deep copy)
 */
export function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}
