/**
 * SLOT MATH EXACT - Special Wild Implementations
 *
 * Advanced wild mechanics that require multi-spin state:
 * - Walking Wilds: Move one position each spin until off grid
 * - Sticky Wilds: Stay in place for N spins
 * - Colossal Wilds: 2x2, 3x3, or larger wild symbols
 *
 * These are calculated via Markov chain or state enumeration.
 */

import { Decimal, dec, ZERO, ONE, safeDivide } from '../core/decimal.js';
import { binomial, bigIntToDecimal } from '../core/index.js';
import type { GameConfig, SymbolDef } from '../types/config.js';

// ============================================================================
// WALKING WILDS
// ============================================================================

/**
 * Walking wild position and state
 */
export interface WalkingWildState {
  row: number;
  col: number;
  direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';
  symbolId: string;
  multiplier?: number;
}

/**
 * Walking wild configuration
 */
export interface WalkingWildConfig {
  symbolId: string;
  direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';
  multiplier?: number;
  disappearsOnEdge: boolean;  // True = walks off, False = bounces
}

/**
 * Calculate next position for walking wild
 */
export function getNextWalkingPosition(
  state: WalkingWildState,
  gridRows: number,
  gridCols: number,
  config: WalkingWildConfig
): WalkingWildState | null {
  let newRow = state.row;
  let newCol = state.col;
  let newDirection = state.direction;

  switch (state.direction) {
    case 'LEFT':
      newCol = state.col - 1;
      break;
    case 'RIGHT':
      newCol = state.col + 1;
      break;
    case 'UP':
      newRow = state.row - 1;
      break;
    case 'DOWN':
      newRow = state.row + 1;
      break;
  }

  // Check bounds
  if (newCol < 0 || newCol >= gridCols || newRow < 0 || newRow >= gridRows) {
    if (config.disappearsOnEdge) {
      return null;  // Wild walks off the grid
    } else {
      // Bounce: reverse direction
      switch (state.direction) {
        case 'LEFT': newDirection = 'RIGHT'; newCol = state.col + 1; break;
        case 'RIGHT': newDirection = 'LEFT'; newCol = state.col - 1; break;
        case 'UP': newDirection = 'DOWN'; newRow = state.row + 1; break;
        case 'DOWN': newDirection = 'UP'; newRow = state.row - 1; break;
      }

      // Check if bounce is also out of bounds (corner case)
      if (newCol < 0 || newCol >= gridCols || newRow < 0 || newRow >= gridRows) {
        return null;
      }
    }
  }

  return {
    row: newRow,
    col: newCol,
    direction: newDirection,
    symbolId: state.symbolId,
    multiplier: state.multiplier
  };
}

/**
 * Calculate expected number of spins a walking wild survives
 */
export function calculateWalkingWildExpectedSpins(
  startCol: number,
  gridCols: number,
  direction: 'LEFT' | 'RIGHT'
): number {
  // Simple case: walks left or right until edge
  if (direction === 'LEFT') {
    return startCol + 1;  // Spins until reaches col 0 and walks off
  } else {
    return gridCols - startCol;  // Spins until walks off right
  }
}

/**
 * Apply walking wilds to a grid for current spin
 * Returns new grid with wilds moved
 */
export function applyWalkingWilds(
  grid: string[][],
  walkingWilds: WalkingWildState[],
  gridRows: number,
  gridCols: number,
  configs: Map<string, WalkingWildConfig>
): { grid: string[][]; remainingWilds: WalkingWildState[] } {
  const newGrid = grid.map(row => [...row]);
  const remainingWilds: WalkingWildState[] = [];

  for (const wild of walkingWilds) {
    const config = configs.get(wild.symbolId);
    if (!config) continue;

    // Move wild to next position
    const nextPos = getNextWalkingPosition(wild, gridRows, gridCols, config);

    if (nextPos) {
      // Place wild in new position
      const row = newGrid[nextPos.row];
      if (row) {
        row[nextPos.col] = wild.symbolId;
      }
      remainingWilds.push(nextPos);
    }
    // If nextPos is null, wild walked off grid
  }

  return { grid: newGrid, remainingWilds };
}

// ============================================================================
// STICKY WILDS
// ============================================================================

/**
 * Sticky wild state
 */
export interface StickyWildState {
  row: number;
  col: number;
  symbolId: string;
  remainingSpins: number;  // How many more spins it stays
  multiplier?: number;
}

/**
 * Sticky wild configuration
 */
export interface StickyWildConfig {
  symbolId: string;
  duration: number;  // Number of spins to stay
  multiplier?: number;
  upgradesOnWin?: boolean;  // Multiplier increases if part of win
}

/**
 * Apply sticky wilds to grid and update remaining spins
 */
export function applyStickyWilds(
  grid: string[][],
  stickyWilds: StickyWildState[]
): { grid: string[][]; remainingWilds: StickyWildState[] } {
  const newGrid = grid.map(row => [...row]);
  const remainingWilds: StickyWildState[] = [];

  for (const wild of stickyWilds) {
    // Place wild on grid
    const row = newGrid[wild.row];
    if (row) {
      row[wild.col] = wild.symbolId;
    }

    // Decrease remaining spins
    const newRemaining = wild.remainingSpins - 1;
    if (newRemaining > 0) {
      remainingWilds.push({
        ...wild,
        remainingSpins: newRemaining
      });
    }
  }

  return { grid: newGrid, remainingWilds };
}

/**
 * Calculate expected value contribution of sticky wilds
 * Using geometric series for expected total wins
 */
export function calculateStickyWildEV(
  duration: number,
  avgWinWithWild: Decimal,
  wildLandingProbability: Decimal
): Decimal {
  // EV = P(land) * sum_{i=1}^{duration} avgWin
  // = P(land) * duration * avgWin
  return wildLandingProbability.times(duration).times(avgWinWithWild);
}

// ============================================================================
// COLOSSAL WILDS
// ============================================================================

/**
 * Colossal wild dimensions
 */
export interface ColossalWildSize {
  rows: number;
  cols: number;
}

/**
 * Colossal wild state
 */
export interface ColossalWildState {
  topRow: number;    // Top-left corner row
  leftCol: number;   // Top-left corner col
  size: ColossalWildSize;
  symbolId: string;
  multiplier?: number;
}

/**
 * Check if a colossal wild fits at position
 */
export function canPlaceColossalWild(
  topRow: number,
  leftCol: number,
  size: ColossalWildSize,
  gridRows: number,
  gridCols: number
): boolean {
  return (
    topRow >= 0 &&
    leftCol >= 0 &&
    topRow + size.rows <= gridRows &&
    leftCol + size.cols <= gridCols
  );
}

/**
 * Get all positions covered by a colossal wild
 */
export function getColossalWildPositions(
  state: ColossalWildState
): Array<{ row: number; col: number }> {
  const positions: Array<{ row: number; col: number }> = [];

  for (let r = 0; r < state.size.rows; r++) {
    for (let c = 0; c < state.size.cols; c++) {
      positions.push({
        row: state.topRow + r,
        col: state.leftCol + c
      });
    }
  }

  return positions;
}

/**
 * Apply colossal wild to grid
 */
export function applyColossalWild(
  grid: string[][],
  colossalWild: ColossalWildState
): string[][] {
  const newGrid = grid.map(row => [...row]);
  const positions = getColossalWildPositions(colossalWild);

  for (const pos of positions) {
    const row = newGrid[pos.row];
    if (row) {
      row[pos.col] = colossalWild.symbolId;
    }
  }

  return newGrid;
}

/**
 * Detect colossal wilds in a grid
 * Looks for NxM blocks of the same wild symbol
 */
export function detectColossalWilds(
  grid: string[][],
  wildSymbols: Set<string>,
  minSize: ColossalWildSize = { rows: 2, cols: 2 }
): ColossalWildState[] {
  const colossalWilds: ColossalWildState[] = [];
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const visited = new Set<string>();

  for (let r = 0; r <= rows - minSize.rows; r++) {
    for (let c = 0; c <= cols - minSize.cols; c++) {
      const key = `${r},${c}`;
      if (visited.has(key)) continue;

      const symbol = grid[r]?.[c];
      if (!symbol || !wildSymbols.has(symbol)) continue;

      // Check if this starts a colossal wild block
      let maxRows = 0;
      let maxCols = 0;

      // Find max block size
      for (let dr = 0; r + dr < rows; dr++) {
        let rowMatches = true;
        for (let dc = 0; c + dc < cols; dc++) {
          if (grid[r + dr]?.[c + dc] === symbol) {
            if (dr === 0) maxCols = Math.max(maxCols, dc + 1);
          } else {
            rowMatches = dc >= minSize.cols;
            break;
          }
        }
        if (!rowMatches) break;
        maxRows = dr + 1;
      }

      if (maxRows >= minSize.rows && maxCols >= minSize.cols) {
        colossalWilds.push({
          topRow: r,
          leftCol: c,
          size: { rows: maxRows, cols: maxCols },
          symbolId: symbol
        });

        // Mark positions as visited
        for (let dr = 0; dr < maxRows; dr++) {
          for (let dc = 0; dc < maxCols; dc++) {
            visited.add(`${r + dr},${c + dc}`);
          }
        }
      }
    }
  }

  return colossalWilds;
}

/**
 * Calculate probability of colossal wild appearing
 * Based on reel strip composition
 */
export function calculateColossalWildProbability(
  reelStrips: string[][],
  wildSymbol: string,
  size: ColossalWildSize,
  gridRows: number
): Decimal {
  // For colossal wild to appear:
  // - Need `size.rows` consecutive wilds on `size.cols` adjacent reels
  // - Starting positions must align

  let probability = ONE;
  const firstCol = 0;  // Simplified: only count leftmost position

  for (let col = firstCol; col < firstCol + size.cols; col++) {
    const strip = reelStrips[col];
    if (!strip) return ZERO;

    // Count sequences of `size.rows` consecutive wilds
    let sequences = 0;
    for (let i = 0; i <= strip.length - size.rows; i++) {
      let isSequence = true;
      for (let j = 0; j < size.rows; j++) {
        if (strip[(i + j) % strip.length] !== wildSymbol) {
          isSequence = false;
          break;
        }
      }
      if (isSequence) sequences++;
    }

    const reelProb = safeDivide(dec(sequences), dec(strip.length));
    probability = probability.times(reelProb);
  }

  return probability;
}

// ============================================================================
// UNIFIED SPECIAL WILD MANAGER
// ============================================================================

/**
 * Special wild manager for tracking all types
 */
export class SpecialWildManager {
  private walkingWilds: WalkingWildState[] = [];
  private stickyWilds: StickyWildState[] = [];
  private colossalWilds: ColossalWildState[] = [];

  private walkingConfigs = new Map<string, WalkingWildConfig>();
  private stickyConfigs = new Map<string, StickyWildConfig>();

  private gridRows: number;
  private gridCols: number;

  constructor(config: GameConfig) {
    this.gridRows = config.grid.rows;
    this.gridCols = config.grid.cols;

    // Extract wild configurations from symbols
    for (const sym of config.symbols) {
      if (sym.role !== 'WILD') continue;

      switch (sym.wildType) {
        case 'WALKING':
          this.walkingConfigs.set(sym.id, {
            symbolId: sym.id,
            direction: 'LEFT',  // Default, could be in metadata
            multiplier: sym.multiplier,
            disappearsOnEdge: true
          });
          break;
        case 'STICKY':
          this.stickyConfigs.set(sym.id, {
            symbolId: sym.id,
            duration: 3,  // Default, could be in metadata
            multiplier: sym.multiplier
          });
          break;
      }
    }
  }

  /**
   * Detect and register new special wilds from grid
   */
  detectNewWilds(grid: string[][]): void {
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      if (!row) continue;

      for (let c = 0; c < cols; c++) {
        const symbol = row[c];
        if (!symbol) continue;

        // Check for walking wild
        const walkConfig = this.walkingConfigs.get(symbol);
        if (walkConfig) {
          this.walkingWilds.push({
            row: r,
            col: c,
            direction: walkConfig.direction,
            symbolId: symbol,
            multiplier: walkConfig.multiplier
          });
        }

        // Check for sticky wild
        const stickyConfig = this.stickyConfigs.get(symbol);
        if (stickyConfig) {
          this.stickyWilds.push({
            row: r,
            col: c,
            symbolId: symbol,
            remainingSpins: stickyConfig.duration,
            multiplier: stickyConfig.multiplier
          });
        }
      }
    }
  }

  /**
   * Apply all special wilds to grid and advance state
   */
  applyAndAdvance(grid: string[][]): string[][] {
    let currentGrid = grid.map(row => [...row]);

    // Apply sticky wilds first (they don't move)
    const stickyResult = applyStickyWilds(currentGrid, this.stickyWilds);
    currentGrid = stickyResult.grid;
    this.stickyWilds = stickyResult.remainingWilds;

    // Apply walking wilds (they move)
    const walkResult = applyWalkingWilds(
      currentGrid,
      this.walkingWilds,
      this.gridRows,
      this.gridCols,
      this.walkingConfigs
    );
    currentGrid = walkResult.grid;
    this.walkingWilds = walkResult.remainingWilds;

    return currentGrid;
  }

  /**
   * Check if there are any active special wilds
   */
  hasActiveWilds(): boolean {
    return this.walkingWilds.length > 0 || this.stickyWilds.length > 0;
  }

  /**
   * Reset all wilds
   */
  reset(): void {
    this.walkingWilds = [];
    this.stickyWilds = [];
    this.colossalWilds = [];
  }

  /**
   * Get current wild states
   */
  getState(): {
    walking: WalkingWildState[];
    sticky: StickyWildState[];
    colossal: ColossalWildState[];
  } {
    return {
      walking: [...this.walkingWilds],
      sticky: [...this.stickyWilds],
      colossal: [...this.colossalWilds]
    };
  }
}
