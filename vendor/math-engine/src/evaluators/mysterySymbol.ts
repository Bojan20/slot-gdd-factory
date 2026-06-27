/**
 * SLOT MATH EXACT - Mystery Symbol Transformer
 *
 * Handles mystery symbols that reveal as another symbol.
 * All mystery symbols on the grid reveal as the same symbol.
 *
 * EV Calculation:
 * - Iterate through all possible reveal outcomes
 * - Weight by reveal probabilities
 * - Sum expected values
 */

import { Decimal, dec, ZERO, sum, safeDivide } from '../core/decimal.js';
import type { GameConfig, SymbolDef } from '../types/config.js';

/**
 * Mystery reveal configuration
 */
export interface MysteryRevealConfig {
  /** Symbol ID that gets revealed */
  revealSymbol: string;
  /** Weight for this reveal (higher = more likely) */
  weight: number;
}

/**
 * Mystery symbol result
 */
export interface MysteryTransformResult {
  /** Transformed grid */
  grid: string[][];
  /** Symbol that was revealed */
  revealedSymbol: string;
  /** Probability of this reveal */
  probability: Decimal;
}

/**
 * Mystery Symbol Transformer
 */
export class MysterySymbolTransformer {
  private readonly config: GameConfig;
  private readonly mysterySymbolId: string;
  private readonly revealWeights: Map<string, number>;
  private readonly totalWeight: number;
  private readonly payingSymbols: string[];

  constructor(
    config: GameConfig,
    mysterySymbolId: string = 'MY',
    revealWeights?: Map<string, number>
  ) {
    this.config = config;
    this.mysterySymbolId = mysterySymbolId;

    // Get all paying symbols (exclude wilds, scatters, bonus, mystery itself)
    this.payingSymbols = config.symbols
      .filter(s =>
        s.role === 'HIGH_PAY' || s.role === 'LOW_PAY'
      )
      .map(s => s.id);

    // Use provided weights or create uniform weights
    if (revealWeights) {
      this.revealWeights = revealWeights;
    } else {
      this.revealWeights = new Map();
      for (const sym of this.payingSymbols) {
        this.revealWeights.set(sym, 1);
      }
    }

    this.totalWeight = Array.from(this.revealWeights.values()).reduce((a, b) => a + b, 0);
  }

  /**
   * Check if grid contains mystery symbols
   */
  hasMysterySymbols(grid: string[][]): boolean {
    for (const row of grid) {
      for (const sym of row) {
        if (sym === this.mysterySymbolId) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get mystery symbol positions
   */
  getMysteryPositions(grid: string[][]): Array<[number, number]> {
    const positions: Array<[number, number]> = [];

    for (let row = 0; row < grid.length; row++) {
      const rowData = grid[row];
      if (!rowData) continue;

      for (let col = 0; col < rowData.length; col++) {
        if (rowData[col] === this.mysterySymbolId) {
          positions.push([row, col]);
        }
      }
    }

    return positions;
  }

  /**
   * Transform grid by revealing mystery symbols as specified symbol
   */
  transform(grid: string[][], revealSymbol: string): string[][] {
    const newGrid: string[][] = [];

    for (const row of grid) {
      const newRow: string[] = [];
      for (const sym of row) {
        if (sym === this.mysterySymbolId) {
          newRow.push(revealSymbol);
        } else {
          newRow.push(sym);
        }
      }
      newGrid.push(newRow);
    }

    return newGrid;
  }

  /**
   * Get all possible reveal outcomes with probabilities
   */
  getAllRevealOutcomes(grid: string[][]): MysteryTransformResult[] {
    const results: MysteryTransformResult[] = [];

    // If no mystery symbols, return original grid
    if (!this.hasMysterySymbols(grid)) {
      return [{
        grid,
        revealedSymbol: '',
        probability: dec(1)
      }];
    }

    // Generate all possible reveals
    for (const [symbol, weight] of this.revealWeights) {
      const transformedGrid = this.transform(grid, symbol);
      const probability = safeDivide(dec(weight), dec(this.totalWeight));

      results.push({
        grid: transformedGrid,
        revealedSymbol: symbol,
        probability
      });
    }

    return results;
  }

  /**
   * Calculate expected value of mystery symbol reveal
   * Takes a win evaluator function and computes weighted average
   */
  calculateEV(
    grid: string[][],
    evaluator: (transformedGrid: string[][]) => Decimal
  ): Decimal {
    const outcomes = this.getAllRevealOutcomes(grid);

    let totalEV = ZERO;
    for (const outcome of outcomes) {
      const win = evaluator(outcome.grid);
      totalEV = totalEV.plus(win.times(outcome.probability));
    }

    return totalEV;
  }

  /**
   * Get reveal probability for a specific symbol
   */
  getRevealProbability(symbol: string): Decimal {
    const weight = this.revealWeights.get(symbol) ?? 0;
    return safeDivide(dec(weight), dec(this.totalWeight));
  }

  /**
   * Get all possible reveal symbols
   */
  getRevealSymbols(): string[] {
    return Array.from(this.revealWeights.keys());
  }
}

/**
 * Create mystery transformer from config
 */
export function createMysteryTransformer(
  config: GameConfig,
  mysteryConfig?: {
    symbolId?: string;
    revealWeights?: Record<string, number>;
  }
): MysterySymbolTransformer {
  const symbolId = mysteryConfig?.symbolId ?? 'MY';

  let weights: Map<string, number> | undefined;
  if (mysteryConfig?.revealWeights) {
    weights = new Map(Object.entries(mysteryConfig.revealWeights));
  }

  return new MysterySymbolTransformer(config, symbolId, weights);
}
