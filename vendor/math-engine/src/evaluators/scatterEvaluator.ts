/**
 * SLOT MATH EXACT - Scatter Evaluator
 *
 * Evaluates scatter symbols that pay anywhere on the grid.
 * Handles:
 * - Pay anywhere mechanics
 * - Feature triggers (Free Spins, Bonus)
 * - Per-reel scatter limits
 */

import { Decimal, dec, ZERO } from '../core/decimal.js';
import type {
  GameConfig,
  SymbolDef,
  ScatterPay,
  WinResult
} from '../types/config.js';

/**
 * Scatter evaluation context
 */
export interface ScatterEvalContext {
  symbolMap: Map<string, SymbolDef>;
  scatterSymbols: Set<string>;
  scatterPays: Map<string, ScatterPay>;
  maxPerReel: number;  // Maximum scatters counted per reel (usually 1)
}

/**
 * Scatter evaluation result
 */
export interface ScatterResult {
  wins: WinResult[];
  triggeredFeature?: 'FREE_SPINS' | 'BONUS';
  freeSpinsAwarded: number;
}

/**
 * Create scatter evaluation context
 */
export function createScatterEvalContext(config: GameConfig): ScatterEvalContext {
  const symbolMap = new Map<string, SymbolDef>();
  const scatterSymbols = new Set<string>();

  for (const sym of config.symbols) {
    symbolMap.set(sym.id, sym);

    if (sym.role === 'SCATTER') {
      scatterSymbols.add(sym.id);
    }
  }

  const scatterPays = new Map<string, ScatterPay>();
  if (config.scatterPays) {
    for (const sp of config.scatterPays) {
      scatterPays.set(sp.symbolId, sp);
    }
  }

  return {
    symbolMap,
    scatterSymbols,
    scatterPays,
    maxPerReel: 1  // Standard: count max 1 scatter per reel
  };
}

/**
 * Count scatters on grid
 * Returns count per symbol and positions
 */
function countScatters(
  grid: string[][],
  ctx: ScatterEvalContext
): Map<string, Array<{ row: number; col: number }>> {
  const counts = new Map<string, Array<{ row: number; col: number }>>();
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  // Track counts per reel to enforce maxPerReel
  const reelCounts = new Map<string, Map<number, number>>();

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const gridRow = grid[row];
      if (!gridRow) continue;

      const symbol = gridRow[col];
      if (symbol === undefined) continue;

      if (!ctx.scatterSymbols.has(symbol)) continue;

      // Check max per reel
      if (!reelCounts.has(symbol)) {
        reelCounts.set(symbol, new Map());
      }
      const symbolReelCounts = reelCounts.get(symbol)!;
      const currentReelCount = symbolReelCounts.get(col) ?? 0;

      if (currentReelCount >= ctx.maxPerReel) continue;

      symbolReelCounts.set(col, currentReelCount + 1);

      // Add to counts
      if (!counts.has(symbol)) {
        counts.set(symbol, []);
      }
      counts.get(symbol)!.push({ row, col });
    }
  }

  return counts;
}

/**
 * Evaluate scatters for a grid
 */
export function evaluateScatters(
  grid: string[][],
  ctx: ScatterEvalContext
): ScatterResult {
  const wins: WinResult[] = [];
  let triggeredFeature: 'FREE_SPINS' | 'BONUS' | undefined;
  let freeSpinsAwarded = 0;

  const scatterCounts = countScatters(grid, ctx);

  for (const [symbolId, positions] of scatterCounts.entries()) {
    const count = positions.length;
    const scatterPay = ctx.scatterPays.get(symbolId);

    if (!scatterPay) continue;

    const countStr = count.toString();
    const payEntry = scatterPay.pays[countStr];

    if (!payEntry) continue;

    const basePay = payEntry.pay ?? 0;

    if (basePay > 0) {
      wins.push({
        type: 'SCATTER',
        symbolId,
        count,
        positions,
        baseWin: basePay,
        multiplier: 1,
        totalWin: basePay
      });
    }

    // Check for feature trigger
    if (payEntry.freeSpinsAwarded && payEntry.freeSpinsAwarded > 0) {
      triggeredFeature = 'FREE_SPINS';
      freeSpinsAwarded += payEntry.freeSpinsAwarded;
    }

    if (payEntry.bonusAwarded) {
      triggeredFeature = 'BONUS';
    }
  }

  return {
    wins,
    triggeredFeature,
    freeSpinsAwarded
  };
}

/**
 * Calculate scatter win total
 */
export function calculateScatterWinTotal(wins: WinResult[]): Decimal {
  return wins
    .filter(w => w.type === 'SCATTER')
    .reduce((sum, win) => sum.plus(dec(win.totalWin)), ZERO);
}

/**
 * Scatter evaluator class
 */
export class ScatterEvaluator {
  private readonly ctx: ScatterEvalContext;

  constructor(config: GameConfig) {
    this.ctx = createScatterEvalContext(config);
  }

  /**
   * Evaluate a grid for scatter wins
   */
  evaluate(grid: string[][]): ScatterResult {
    return evaluateScatters(grid, this.ctx);
  }

  /**
   * Evaluate and return total scatter win
   */
  evaluateTotal(grid: string[][]): Decimal {
    const result = this.evaluate(grid);
    return calculateScatterWinTotal(result.wins);
  }

  /**
   * Check if a grid triggers free spins
   */
  triggersFreeSins(grid: string[][]): boolean {
    const result = this.evaluate(grid);
    return result.triggeredFeature === 'FREE_SPINS';
  }

  /**
   * Get free spins count for a grid
   */
  getFreeSpinsAwarded(grid: string[][]): number {
    const result = this.evaluate(grid);
    return result.freeSpinsAwarded;
  }

  /**
   * Get scatter symbols
   */
  getScatterSymbols(): string[] {
    return Array.from(this.ctx.scatterSymbols);
  }
}

/**
 * Quick check: does grid have enough scatters to trigger?
 */
export function hasEnoughScatters(
  grid: string[][],
  scatterSymbol: string,
  minCount: number,
  maxPerReel: number = 1
): boolean {
  const cols = grid[0]?.length ?? 0;
  let count = 0;

  for (let col = 0; col < cols; col++) {
    let reelCount = 0;

    for (const row of grid) {
      const symbol = row[col];
      if (symbol === scatterSymbol) {
        reelCount++;
        if (reelCount >= maxPerReel) break;
      }
    }

    count += Math.min(reelCount, maxPerReel);

    // Early exit if we already have enough
    if (count >= minCount) return true;
  }

  return count >= minCount;
}
