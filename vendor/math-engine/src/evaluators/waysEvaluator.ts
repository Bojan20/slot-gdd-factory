/**
 * SLOT MATH EXACT - Ways to Win Evaluator
 *
 * Evaluates ways-to-win mechanics (243, 1024, etc.)
 * A win is formed when matching symbols appear on consecutive reels
 * starting from the leftmost reel.
 *
 * For a 5x3 grid:
 * - 243 ways = 3^5 (3 rows, 5 reels)
 * - 1024 ways = 4^5 (4 rows, 5 reels)
 *
 * Key features:
 * - Wild substitution
 * - Multiplier wilds (MULTIPLY, ADD, HIGHEST modes)
 * - Expanding wilds (grid transformation)
 * - Stacked wilds detection
 * - Efficient counting without enumeration
 */

import { Decimal, dec, ZERO, ONE } from '../core/decimal.js';
import { waysToWin } from '../core/combinatorics.js';
import type {
  GameConfig,
  SymbolDef,
  WinResult
} from '../types/config.js';
import {
  WildTransformer,
  type MultiplierMode,
  type TransformedGrid
} from './wildTransformer.js';

/**
 * Ways evaluation context
 */
export interface WaysEvalContext {
  symbolMap: Map<string, SymbolDef>;
  paytableMap: Map<string, Map<number, number>>;
  wildSymbols: Set<string>;
  wildMultipliers: Map<string, number>;
  payingSymbols: string[];  // Symbols that can form wins
  wildTransformer: WildTransformer;
  /** Per-wild substitution rules: wildId -> set of symbols it can substitute */
  wildSubstitutions: Map<string, Set<string> | 'ALL'>;
  /** Symbols that cannot be substituted by wilds */
  nonSubstitutableSymbols: Set<string>;
}

/**
 * Create ways evaluation context
 */
export function createWaysEvalContext(
  config: GameConfig,
  multiplierMode: MultiplierMode = 'MULTIPLY'
): WaysEvalContext {
  const symbolMap = new Map<string, SymbolDef>();
  const wildSymbols = new Set<string>();
  const wildMultipliers = new Map<string, number>();
  const payingSymbols: string[] = [];

  const wildSubstitutions = new Map<string, Set<string> | 'ALL'>();
  const nonSubstitutableSymbols = new Set<string>();

  for (const sym of config.symbols) {
    symbolMap.set(sym.id, sym);

    // Track non-substitutable symbols
    if (sym.canBeSubstituted === false) {
      nonSubstitutableSymbols.add(sym.id);
    }

    if (sym.role === 'WILD') {
      wildSymbols.add(sym.id);
      if (sym.multiplier) {
        wildMultipliers.set(sym.id, sym.multiplier);
      }

      // Build per-wild substitution rules
      if (sym.substitutes && sym.substitutes.length > 0) {
        wildSubstitutions.set(sym.id, new Set(sym.substitutes));
      } else {
        wildSubstitutions.set(sym.id, 'ALL');  // Substitutes for all by default
      }
    }
  }

  const paytableMap = new Map<string, Map<number, number>>();
  for (const entry of config.paytable) {
    const payMap = new Map<number, number>();
    for (const [countStr, pay] of Object.entries(entry.pays)) {
      payMap.set(parseInt(countStr, 10), pay);
    }
    paytableMap.set(entry.symbolId, payMap);
    payingSymbols.push(entry.symbolId);
  }

  const wildTransformer = new WildTransformer(config, multiplierMode);

  return {
    symbolMap,
    paytableMap,
    wildSymbols,
    wildMultipliers,
    payingSymbols,
    wildTransformer,
    wildSubstitutions,
    nonSubstitutableSymbols
  };
}

/**
 * Check if a wild can substitute for a target symbol
 */
function canWildSubstitute(
  wildId: string,
  targetId: string,
  ctx: WaysEvalContext
): boolean {
  // Target cannot be substituted
  if (ctx.nonSubstitutableSymbols.has(targetId)) {
    return false;
  }

  const subs = ctx.wildSubstitutions.get(wildId);
  if (subs === 'ALL') {
    return true;
  }

  return subs?.has(targetId) ?? false;
}

/**
 * Position info for ways calculation
 */
interface ReelInfo {
  symbolCounts: Map<string, number>;  // symbol -> count on this reel
  wildCount: number;
  wildMultipliers: number[];  // All multipliers from wilds on this reel
  totalPositions: number;     // Total symbol positions (rows)
  /** Per-symbol wild counts (for per-wild substitution rules) */
  wildsPerSymbol: Map<string, number>;
}

/**
 * Analyze a reel column for ways calculation
 */
function analyzeReel(
  column: string[],
  ctx: WaysEvalContext
): ReelInfo {
  const symbolCounts = new Map<string, number>();
  let wildCount = 0;
  const wildMultipliers: number[] = [];
  const wildsOnReel: string[] = [];  // Track which wilds are on this reel

  for (const sym of column) {
    if (ctx.wildSymbols.has(sym)) {
      wildCount++;
      wildsOnReel.push(sym);
      const mult = ctx.wildMultipliers.get(sym);
      if (mult) {
        wildMultipliers.push(mult);
      }
    } else {
      const current = symbolCounts.get(sym) ?? 0;
      symbolCounts.set(sym, current + 1);
    }
  }

  // Calculate per-symbol wild counts based on substitution rules
  const wildsPerSymbol = new Map<string, number>();
  for (const payingSymbol of ctx.payingSymbols) {
    let count = 0;
    for (const wildId of wildsOnReel) {
      if (canWildSubstitute(wildId, payingSymbol, ctx)) {
        count++;
      }
    }
    wildsPerSymbol.set(payingSymbol, count);
  }

  return {
    symbolCounts,
    wildCount,
    wildMultipliers,
    totalPositions: column.length,
    wildsPerSymbol
  };
}

/**
 * Calculate ways for a specific symbol
 */
function calculateSymbolWays(
  reelInfos: ReelInfo[],
  symbolId: string,
  ctx: WaysEvalContext
): {
  maxConsecutive: number;
  ways: bigint;
  avgMultiplier: number;
  positions: Array<{ row: number; col: number }>;
} {
  let consecutive = 0;
  let ways = 1n;
  let multiplierSum = 0;
  let multiplierCount = 0;
  const positions: Array<{ row: number; col: number }> = [];

  for (let col = 0; col < reelInfos.length; col++) {
    const info = reelInfos[col];
    if (!info) break;

    const symbolCount = info.symbolCounts.get(symbolId) ?? 0;
    // Use per-symbol wild count for accurate substitution rules
    const applicableWildCount = info.wildsPerSymbol.get(symbolId) ?? info.wildCount;
    const matchingPositions = symbolCount + applicableWildCount;

    if (matchingPositions === 0) {
      // No matching symbols on this reel - stop
      break;
    }

    consecutive++;
    ways *= BigInt(matchingPositions);

    // Track positions (approximate - we record all matching positions)
    for (let row = 0; row < info.totalPositions; row++) {
      // This is simplified - actual positions depend on grid content
      positions.push({ row, col });
    }

    // Accumulate multipliers
    for (const mult of info.wildMultipliers) {
      multiplierSum += mult;
      multiplierCount++;
    }
  }

  const avgMultiplier = multiplierCount > 0
    ? multiplierSum / multiplierCount
    : 1;

  return {
    maxConsecutive: consecutive,
    ways,
    avgMultiplier,
    positions
  };
}

/**
 * Ways evaluation result with transform info
 */
export interface WaysEvalResult {
  wins: WinResult[];
  transformedGrid: TransformedGrid | null;
}

/**
 * Evaluate ways wins for a grid
 */
export function evaluateWays(
  grid: string[][],
  ctx: WaysEvalContext,
  applyWildTransform: boolean = true
): WinResult[] {
  // Apply wild transformations (expanding wilds)
  let evalGrid = grid;
  if (applyWildTransform) {
    const transformed = ctx.wildTransformer.transform(grid);
    evalGrid = transformed.grid;
  }

  const wins: WinResult[] = [];
  const numCols = evalGrid[0]?.length ?? 0;

  // Get column-wise view
  const columns: string[][] = [];
  for (let col = 0; col < numCols; col++) {
    const column: string[] = [];
    for (const row of evalGrid) {
      const sym = row[col];
      if (sym !== undefined) {
        column.push(sym);
      }
    }
    columns.push(column);
  }

  // Analyze each reel
  const reelInfos = columns.map(col => analyzeReel(col, ctx));

  // Check each paying symbol
  for (const symbolId of ctx.payingSymbols) {
    const result = calculateSymbolWays(reelInfos, symbolId, ctx);

    if (result.maxConsecutive < 3) continue;  // Minimum 3 of a kind

    // Get pay value
    const payMap = ctx.paytableMap.get(symbolId);
    if (!payMap) continue;

    const basePay = payMap.get(result.maxConsecutive);
    if (basePay === undefined || basePay === 0) continue;

    // Calculate multiplier using WildTransformer for proper mode handling
    // Get all wild positions from the consecutive reels
    const wildPositions: Array<{ row: number; col: number }> = [];
    for (let col = 0; col < result.maxConsecutive; col++) {
      const column = columns[col];
      if (!column) continue;
      for (let row = 0; row < column.length; row++) {
        const sym = column[row];
        if (sym && ctx.wildSymbols.has(sym)) {
          wildPositions.push({ row, col });
        }
      }
    }

    const multiplier = ctx.wildTransformer.getMultiplier(wildPositions, evalGrid);

    // Total win = basePay × ways × multiplier
    const waysNum = Number(result.ways);
    const totalWin = basePay * waysNum * multiplier;

    wins.push({
      type: 'WAYS',
      symbolId,
      count: result.maxConsecutive,
      positions: result.positions,
      baseWin: basePay * waysNum,
      multiplier,
      totalWin,
      isWild: wildPositions.length > 0,
      wildPositions: wildPositions.length > 0 ? wildPositions : undefined
    });
  }

  return wins;
}

/**
 * Evaluate ways with full transformation info
 */
export function evaluateWaysWithTransform(
  grid: string[][],
  ctx: WaysEvalContext
): WaysEvalResult {
  const transformed = ctx.wildTransformer.transform(grid);
  const wins = evaluateWays(transformed.grid, ctx, false);

  return {
    wins,
    transformedGrid: transformed
  };
}

/**
 * Calculate total ways wins
 */
export function calculateWaysWinTotal(wins: WinResult[]): Decimal {
  return wins.reduce((sum, win) => sum.plus(dec(win.totalWin)), ZERO);
}

/**
 * Calculate total possible ways for a grid configuration
 */
export function calculateTotalWays(rowsPerReel: number[]): bigint {
  return waysToWin(rowsPerReel);
}

/**
 * Ways evaluator options
 */
export interface WaysEvaluatorOptions {
  multiplierMode?: MultiplierMode;
  applyWildTransform?: boolean;
}

/**
 * Ways evaluator class
 */
export class WaysEvaluator {
  private readonly ctx: WaysEvalContext;
  private readonly rows: number;
  private readonly applyWildTransform: boolean;

  constructor(config: GameConfig, options: WaysEvaluatorOptions = {}) {
    const { multiplierMode = 'MULTIPLY', applyWildTransform = true } = options;
    this.ctx = createWaysEvalContext(config, multiplierMode);
    this.rows = config.grid.rows;
    this.applyWildTransform = applyWildTransform;
  }

  /**
   * Evaluate a grid
   */
  evaluate(grid: string[][]): WinResult[] {
    return evaluateWays(grid, this.ctx, this.applyWildTransform);
  }

  /**
   * Evaluate with full transformation info
   */
  evaluateWithTransform(grid: string[][]): WaysEvalResult {
    return evaluateWaysWithTransform(grid, this.ctx);
  }

  /**
   * Evaluate and return total
   */
  evaluateTotal(grid: string[][]): Decimal {
    const wins = this.evaluate(grid);
    return calculateWaysWinTotal(wins);
  }

  /**
   * Get maximum possible ways for this configuration
   */
  getMaxWays(numReels: number): bigint {
    const rowsPerReel = new Array(numReels).fill(this.rows);
    return calculateTotalWays(rowsPerReel);
  }

  /**
   * Get wild transformer
   */
  getWildTransformer(): WildTransformer {
    return this.ctx.wildTransformer;
  }
}
