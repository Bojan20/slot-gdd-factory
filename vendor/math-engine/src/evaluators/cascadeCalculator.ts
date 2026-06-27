/**
 * SLOT MATH EXACT - Cascade/Tumble Calculator
 *
 * For EXACT calculation of cascade mechanics, we need to enumerate
 * all possible cascade sequences deterministically.
 *
 * Key insight: After symbols are removed, new symbols "fall in" from
 * the reel strips. This is deterministic given the initial stop positions.
 *
 * Approach:
 * 1. Initial grid from stop positions
 * 2. Evaluate wins, remove symbols
 * 3. Apply gravity
 * 4. Fill from reel strip (next symbols after visible window)
 * 5. Repeat until no wins
 *
 * For weighted reels: Each fill position has its own weight distribution.
 */

import { Decimal, dec, ZERO, ONE, sum, product, safeDivide } from '../core/decimal.js';
import { bigIntToDecimal } from '../core/index.js';
import type { GameConfig, ReelSet, WinResult } from '../types/config.js';
import { ClusterEvaluator, removeClusterSymbols, applyGravity } from './clusterEvaluator.js';
import { WaysEvaluator } from './waysEvaluator.js';

/**
 * Cascade state for tracking
 */
export interface CascadeState {
  grid: string[][];
  level: number;
  wins: WinResult[];
  multiplier: number;
  removedPositions: Array<{ row: number; col: number }>;
}

/**
 * Cascade result
 */
export interface CascadeResult {
  states: CascadeState[];
  totalWin: Decimal;
  totalCascades: number;
  finalMultiplier: number;
}

/**
 * Reel strip manager for cascade fills
 */
export class ReelStripManager {
  private readonly strips: string[][];
  private readonly weights: number[][] | null;
  private readonly stopPositions: number[];

  constructor(reelSet: ReelSet, initialStops: number[]) {
    this.strips = reelSet.reels.map(r => r.symbols);
    this.weights = reelSet.reels.some(r => r.weights)
      ? reelSet.reels.map(r => r.weights ?? r.symbols.map(() => 1))
      : null;
    this.stopPositions = [...initialStops];
  }

  /**
   * Get next N symbols from a reel after current visible window
   * For deterministic cascade fill
   */
  getNextSymbols(reelIndex: number, visibleRows: number, count: number): string[] {
    const strip = this.strips[reelIndex];
    if (!strip) return [];

    const symbols: string[] = [];
    const startPos = this.stopPositions[reelIndex] ?? 0;

    for (let i = 0; i < count; i++) {
      // Position after visible window
      const pos = (startPos + visibleRows + i) % strip.length;
      symbols.push(strip[pos] ?? '');
    }

    return symbols;
  }

  /**
   * Update stop position after cascade (symbols moved down)
   */
  advanceStop(reelIndex: number, count: number): void {
    const strip = this.strips[reelIndex];
    if (!strip) return;

    const currentStop = this.stopPositions[reelIndex] ?? 0;
    this.stopPositions[reelIndex] = (currentStop + count) % strip.length;
  }

  /**
   * Get current stop positions
   */
  getStopPositions(): number[] {
    return [...this.stopPositions];
  }
}

/**
 * Fill empty positions after gravity with symbols from reel strips
 * This is the key for deterministic cascade calculation
 */
export function fillFromReelStrips(
  grid: string[][],
  reelManager: ReelStripManager
): string[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const newGrid = grid.map(row => [...row]);

  for (let col = 0; col < cols; col++) {
    // Count empty positions at top of column
    let emptyCount = 0;
    for (let row = 0; row < rows; row++) {
      if (newGrid[row]?.[col] === '' || newGrid[row]?.[col] === undefined) {
        emptyCount++;
      } else {
        break;  // Only count consecutive empties from top
      }
    }

    if (emptyCount > 0) {
      // Get next symbols from reel strip
      const newSymbols = reelManager.getNextSymbols(col, rows, emptyCount);

      // Fill from top (reversed because gravity puts empties at top)
      for (let i = 0; i < emptyCount; i++) {
        const row = newGrid[i];
        if (row) {
          row[col] = newSymbols[emptyCount - 1 - i] ?? '';
        }
      }

      // Advance reel stop position
      reelManager.advanceStop(col, emptyCount);
    }
  }

  return newGrid;
}

/**
 * Random fill function type
 * Used for Monte Carlo simulation mode
 */
export type RandomFillFn = (reelIndex: number, count: number) => string[];

/**
 * Fill empty positions with random symbols from reel
 * Used for simulation mode (non-deterministic)
 */
export function fillFromReelRandom(
  grid: string[][],
  reelSet: ReelSet,
  rng: { nextInt: (max: number) => number }
): string[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const newGrid = grid.map(row => [...row]);

  for (let col = 0; col < cols; col++) {
    const reel = reelSet.reels[col];
    if (!reel) continue;

    const strip = reel.symbols;
    const weights = reel.weights;

    for (let row = 0; row < rows; row++) {
      if (newGrid[row]?.[col] === '' || newGrid[row]?.[col] === undefined) {
        let symbol: string;

        if (weights) {
          // Weighted random selection
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          let target = rng.nextInt(totalWeight);
          let idx = 0;
          for (let i = 0; i < weights.length; i++) {
            target -= weights[i] ?? 0;
            if (target < 0) {
              idx = i;
              break;
            }
          }
          symbol = strip[idx] ?? '';
        } else {
          // Uniform random selection
          const idx = rng.nextInt(strip.length);
          symbol = strip[idx] ?? '';
        }

        const gridRow = newGrid[row];
        if (gridRow) {
          gridRow[col] = symbol;
        }
      }
    }
  }

  return newGrid;
}

/**
 * Cascade evaluator options
 */
export interface CascadeEvaluatorOptions {
  /** Use deterministic fill from reel strips (default: true for exact calculation) */
  deterministicFill?: boolean;
  /** Custom random fill function for simulation mode */
  randomFillFn?: RandomFillFn;
  /** RNG for built-in random fill (requires deterministicFill: false) */
  rng?: { nextInt: (max: number) => number };
}

/**
 * Cascade evaluator for cluster pay games
 */
export class CascadeClusterEvaluator {
  private readonly evaluator: ClusterEvaluator;
  private readonly config: GameConfig;
  private readonly multiplierProgression: number[];
  private readonly maxCascades: number;

  constructor(config: GameConfig) {
    this.evaluator = new ClusterEvaluator(config);
    this.config = config;
    this.multiplierProgression = config.clusterConfig?.cascadeMultiplierProgression ?? [1];
    this.maxCascades = config.maxCascades ?? 50;
  }

  /**
   * Evaluate cascade sequence with deterministic fills
   */
  evaluateCascade(
    initialGrid: string[][],
    reelSet: ReelSet,
    initialStops: number[]
  ): CascadeResult {
    const reelManager = new ReelStripManager(reelSet, initialStops);
    const states: CascadeState[] = [];
    let currentGrid = initialGrid.map(row => [...row]);
    let cascadeLevel = 0;
    let totalWin = ZERO;

    while (cascadeLevel < this.maxCascades) {
      // Get current multiplier
      const multiplierIndex = Math.min(cascadeLevel, this.multiplierProgression.length - 1);
      const currentMultiplier = this.multiplierProgression[multiplierIndex] ?? 1;

      // Evaluate current grid
      const wins = this.evaluator.evaluate(currentGrid);

      if (wins.length === 0) break;

      // Calculate win with multiplier
      const cascadeWin = sum(wins.map(w => dec(w.totalWin))).times(currentMultiplier);
      totalWin = totalWin.plus(cascadeWin);

      // Track removed positions
      const removedPositions: Array<{ row: number; col: number }> = [];
      for (const win of wins) {
        removedPositions.push(...win.positions);
      }

      // Record state
      states.push({
        grid: currentGrid.map(row => [...row]),
        level: cascadeLevel,
        wins: [...wins],
        multiplier: currentMultiplier,
        removedPositions: [...removedPositions]
      });

      // Remove winning symbols
      currentGrid = removeClusterSymbols(currentGrid, wins);

      // Apply gravity
      currentGrid = applyGravity(currentGrid);

      // Fill from reel strips (deterministic!)
      currentGrid = fillFromReelStrips(currentGrid, reelManager);

      cascadeLevel++;
    }

    return {
      states,
      totalWin,
      totalCascades: cascadeLevel,
      finalMultiplier: this.multiplierProgression[
        Math.min(cascadeLevel - 1, this.multiplierProgression.length - 1)
      ] ?? 1
    };
  }

  /**
   * Evaluate cascade sequence with configurable fill mode
   *
   * For exact calculation: use deterministicFill=true (default)
   * For simulation: use deterministicFill=false with rng
   */
  evaluateCascadeWithOptions(
    initialGrid: string[][],
    reelSet: ReelSet,
    initialStops: number[],
    options: CascadeEvaluatorOptions = {}
  ): CascadeResult {
    const {
      deterministicFill = true,
      rng
    } = options;

    // Use deterministic version if requested
    if (deterministicFill) {
      return this.evaluateCascade(initialGrid, reelSet, initialStops);
    }

    // Randomized cascade for simulation
    if (!rng) {
      throw new Error('RNG required for non-deterministic cascade evaluation');
    }

    const states: CascadeState[] = [];
    let currentGrid = initialGrid.map(row => [...row]);
    let cascadeLevel = 0;
    let totalWin = ZERO;

    while (cascadeLevel < this.maxCascades) {
      const multiplierIndex = Math.min(cascadeLevel, this.multiplierProgression.length - 1);
      const currentMultiplier = this.multiplierProgression[multiplierIndex] ?? 1;

      const wins = this.evaluator.evaluate(currentGrid);

      if (wins.length === 0) break;

      const cascadeWin = sum(wins.map(w => dec(w.totalWin))).times(currentMultiplier);
      totalWin = totalWin.plus(cascadeWin);

      const removedPositions: Array<{ row: number; col: number }> = [];
      for (const win of wins) {
        removedPositions.push(...win.positions);
      }

      states.push({
        grid: currentGrid.map(row => [...row]),
        level: cascadeLevel,
        wins: [...wins],
        multiplier: currentMultiplier,
        removedPositions: [...removedPositions]
      });

      currentGrid = removeClusterSymbols(currentGrid, wins);
      currentGrid = applyGravity(currentGrid);

      // Use random fill instead of deterministic
      currentGrid = fillFromReelRandom(currentGrid, reelSet, rng);

      cascadeLevel++;
    }

    return {
      states,
      totalWin,
      totalCascades: cascadeLevel,
      finalMultiplier: this.multiplierProgression[
        Math.min(cascadeLevel - 1, this.multiplierProgression.length - 1)
      ] ?? 1
    };
  }
}

/**
 * Calculate exact cascade EV for a grid configuration
 *
 * This requires enumerating all possible cascade sequences,
 * which depends on the reel strip composition.
 */
export interface CascadeEVResult {
  /** Expected value of cascade feature */
  expectedValue: Decimal;
  /** Average number of cascades */
  avgCascades: Decimal;
  /** Probability distribution of cascade depths */
  cascadeDistribution: Map<number, Decimal>;
  /** Max cascade depth seen */
  maxCascadeDepth: number;
}

/**
 * For full cycle cascade calculation:
 * Each initial stop position can lead to different cascade sequences.
 * We need to enumerate from each starting position.
 */
export function calculateCascadeContribution(
  grid: string[][],
  reelSet: ReelSet,
  stops: number[],
  weight: bigint,
  evaluator: CascadeClusterEvaluator
): { win: Decimal; cascades: number } {
  const result = evaluator.evaluateCascade(grid, reelSet, stops);

  return {
    win: result.totalWin.times(bigIntToDecimal(weight)),
    cascades: result.totalCascades
  };
}
