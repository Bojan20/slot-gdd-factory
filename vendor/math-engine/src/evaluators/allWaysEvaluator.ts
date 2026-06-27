/**
 * SLOT MATH EXACT - All Ways Evaluator
 *
 * Evaluates ALL_WAYS mechanics where symbols pay in ANY direction:
 * - Left to Right
 * - Right to Left
 *
 * This is different from standard WAYS which only pays L→R.
 * Common in cluster-slide style mechanics where every adjacent match counts.
 *
 * Key features:
 * - Multi-directional win detection
 * - Wild substitution in all directions
 * - Multiplier wild handling
 * - Deduplication of overlapping wins
 */

import { Decimal, dec, ZERO, ONE } from '../core/decimal.js';
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
 * All-ways evaluation context
 */
export interface AllWaysEvalContext {
  symbolMap: Map<string, SymbolDef>;
  paytableMap: Map<string, Map<number, number>>;
  wildSymbols: Set<string>;
  wildMultipliers: Map<string, number>;
  payingSymbols: string[];
  wildTransformer: WildTransformer;
  rows: number;
  cols: number;
  minConsecutive: number;
}

/**
 * Create all-ways evaluation context
 */
export function createAllWaysEvalContext(
  config: GameConfig,
  options: {
    multiplierMode?: MultiplierMode;
    minConsecutive?: number;
  } = {}
): AllWaysEvalContext {
  const {
    multiplierMode = 'MULTIPLY',
    minConsecutive = 3
  } = options;

  const symbolMap = new Map<string, SymbolDef>();
  const wildSymbols = new Set<string>();
  const wildMultipliers = new Map<string, number>();
  const payingSymbols: string[] = [];

  for (const sym of config.symbols) {
    symbolMap.set(sym.id, sym);

    if (sym.role === 'WILD') {
      wildSymbols.add(sym.id);
      if (sym.multiplier) {
        wildMultipliers.set(sym.id, sym.multiplier);
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
    rows: config.grid.rows,
    cols: config.grid.cols,
    minConsecutive
  };
}

/**
 * Get symbol at position (with bounds checking)
 */
function getSymbol(grid: string[][], row: number, col: number): string | null {
  const gridRow = grid[row];
  if (!gridRow) return null;
  return gridRow[col] ?? null;
}

/**
 * Reel info for all-ways calculation
 */
interface ReelInfoAllWays {
  symbolCounts: Map<string, number>;
  wildCount: number;
  wildMultipliers: number[];
  totalPositions: number;
}

/**
 * Analyze a reel column
 */
function analyzeReelForAllWays(
  column: string[],
  ctx: AllWaysEvalContext
): ReelInfoAllWays {
  const symbolCounts = new Map<string, number>();
  let wildCount = 0;
  const wildMultipliers: number[] = [];

  for (const sym of column) {
    if (ctx.wildSymbols.has(sym)) {
      wildCount++;
      const mult = ctx.wildMultipliers.get(sym);
      if (mult) {
        wildMultipliers.push(mult);
      }
    } else {
      const current = symbolCounts.get(sym) ?? 0;
      symbolCounts.set(sym, current + 1);
    }
  }

  return {
    symbolCounts,
    wildCount,
    wildMultipliers,
    totalPositions: column.length
  };
}

/**
 * Calculate ways L→R for a symbol
 */
function calculateSymbolWaysLTR(
  reelInfos: ReelInfoAllWays[],
  symbolId: string,
  ctx: AllWaysEvalContext
): {
  maxConsecutive: number;
  ways: bigint;
  positions: Array<{ row: number; col: number }>;
} {
  let consecutive = 0;
  let ways = 1n;
  const positions: Array<{ row: number; col: number }> = [];

  for (let col = 0; col < reelInfos.length; col++) {
    const info = reelInfos[col];
    if (!info) break;

    const symbolCount = info.symbolCounts.get(symbolId) ?? 0;
    const matchingPositions = symbolCount + info.wildCount;

    if (matchingPositions === 0) break;

    consecutive++;
    ways *= BigInt(matchingPositions);

    for (let row = 0; row < info.totalPositions; row++) {
      positions.push({ row, col });
    }
  }

  return { maxConsecutive: consecutive, ways, positions };
}

/**
 * Calculate ways R→L for a symbol
 */
function calculateSymbolWaysRTL(
  reelInfos: ReelInfoAllWays[],
  symbolId: string,
  ctx: AllWaysEvalContext
): {
  maxConsecutive: number;
  ways: bigint;
  positions: Array<{ row: number; col: number }>;
} {
  let consecutive = 0;
  let ways = 1n;
  const positions: Array<{ row: number; col: number }> = [];

  for (let colIdx = 0; colIdx < reelInfos.length; colIdx++) {
    const col = reelInfos.length - 1 - colIdx;
    const info = reelInfos[col];
    if (!info) break;

    const symbolCount = info.symbolCounts.get(symbolId) ?? 0;
    const matchingPositions = symbolCount + info.wildCount;

    if (matchingPositions === 0) break;

    consecutive++;
    ways *= BigInt(matchingPositions);

    for (let row = 0; row < info.totalPositions; row++) {
      positions.push({ row, col });
    }
  }

  return { maxConsecutive: consecutive, ways, positions };
}

/**
 * Create win result from calculation
 */
function createWinResult(
  symbolId: string,
  result: {
    maxConsecutive: number;
    ways: bigint;
    positions: Array<{ row: number; col: number }>;
  },
  grid: string[][],
  ctx: AllWaysEvalContext
): WinResult | null {
  const payMap = ctx.paytableMap.get(symbolId);
  if (!payMap) return null;

  const basePay = payMap.get(result.maxConsecutive);
  if (basePay === undefined || basePay === 0) return null;

  // Get wild positions for multiplier calculation
  const wildPositions: Array<{ row: number; col: number }> = [];
  for (const pos of result.positions) {
    const sym = getSymbol(grid, pos.row, pos.col);
    if (sym && ctx.wildSymbols.has(sym)) {
      wildPositions.push(pos);
    }
  }

  const multiplier = ctx.wildTransformer.getMultiplier(wildPositions, grid);
  const waysNum = Number(result.ways);
  const totalWin = basePay * waysNum * multiplier;

  return {
    type: 'WAYS',
    symbolId,
    count: result.maxConsecutive,
    positions: result.positions,
    baseWin: basePay * waysNum,
    multiplier,
    totalWin,
    isWild: wildPositions.length > 0,
    wildPositions: wildPositions.length > 0 ? wildPositions : undefined
  };
}

/**
 * Evaluate all-ways wins for a grid
 */
export function evaluateAllWays(
  grid: string[][],
  ctx: AllWaysEvalContext,
  applyWildTransform: boolean = true
): WinResult[] {
  let evalGrid = grid;
  if (applyWildTransform) {
    const transformed = ctx.wildTransformer.transform(grid);
    evalGrid = transformed.grid;
  }

  const wins: WinResult[] = [];

  const numCols = evalGrid[0]?.length ?? 0;
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

  const reelInfos = columns.map(col => analyzeReelForAllWays(col, ctx));
  const paidCombos = new Set<string>();

  for (const symbolId of ctx.payingSymbols) {
    // L→R ways
    const ltrResult = calculateSymbolWaysLTR(reelInfos, symbolId, ctx);
    if (ltrResult.maxConsecutive >= ctx.minConsecutive) {
      const comboKey = `${symbolId}_LTR_${ltrResult.maxConsecutive}`;
      if (!paidCombos.has(comboKey)) {
        paidCombos.add(comboKey);
        const win = createWinResult(symbolId, ltrResult, evalGrid, ctx);
        if (win) wins.push(win);
      }
    }

    // R→L ways
    const rtlResult = calculateSymbolWaysRTL(reelInfos, symbolId, ctx);
    if (rtlResult.maxConsecutive >= ctx.minConsecutive) {
      const comboKey = `${symbolId}_RTL_${rtlResult.maxConsecutive}`;
      if (!paidCombos.has(comboKey)) {
        paidCombos.add(comboKey);
        const win = createWinResult(symbolId, rtlResult, evalGrid, ctx);
        if (win) wins.push(win);
      }
    }
  }

  return wins;
}

/**
 * All-ways evaluation result
 */
export interface AllWaysEvalResult {
  wins: WinResult[];
  transformedGrid: TransformedGrid | null;
}

/**
 * Evaluate all-ways with full transformation info
 */
export function evaluateAllWaysWithTransform(
  grid: string[][],
  ctx: AllWaysEvalContext
): AllWaysEvalResult {
  const transformed = ctx.wildTransformer.transform(grid);
  const wins = evaluateAllWays(transformed.grid, ctx, false);

  return {
    wins,
    transformedGrid: transformed
  };
}

/**
 * Calculate total all-ways wins
 */
export function calculateAllWaysWinTotal(wins: WinResult[]): Decimal {
  return wins.reduce((sum, win) => sum.plus(dec(win.totalWin)), ZERO);
}

/**
 * All-ways evaluator options
 */
export interface AllWaysEvaluatorOptions {
  multiplierMode?: MultiplierMode;
  applyWildTransform?: boolean;
  minConsecutive?: number;
}

/**
 * All-ways evaluator class
 *
 * Evaluates wins in all directions (L→R, R→L) unlike standard WAYS
 * which only evaluates left-to-right.
 */
export class AllWaysEvaluator {
  private readonly ctx: AllWaysEvalContext;
  private readonly applyWildTransform: boolean;

  constructor(config: GameConfig, options: AllWaysEvaluatorOptions = {}) {
    const {
      multiplierMode = 'MULTIPLY',
      applyWildTransform = true,
      minConsecutive = 3
    } = options;

    this.ctx = createAllWaysEvalContext(config, {
      multiplierMode,
      minConsecutive
    });
    this.applyWildTransform = applyWildTransform;
  }

  /**
   * Evaluate a grid for all-ways wins
   */
  evaluate(grid: string[][]): WinResult[] {
    return evaluateAllWays(grid, this.ctx, this.applyWildTransform);
  }

  /**
   * Evaluate with full transformation info
   */
  evaluateWithTransform(grid: string[][]): AllWaysEvalResult {
    return evaluateAllWaysWithTransform(grid, this.ctx);
  }

  /**
   * Evaluate and return total
   */
  evaluateTotal(grid: string[][]): Decimal {
    const wins = this.evaluate(grid);
    return calculateAllWaysWinTotal(wins);
  }

  /**
   * Get maximum possible ways for this configuration (both directions)
   */
  getMaxWays(): bigint {
    const rowsPerReel = new Array(this.ctx.cols).fill(this.ctx.rows);
    let ways = 1n;
    for (const r of rowsPerReel) {
      ways *= BigInt(r);
    }
    return ways * 2n;
  }

  /**
   * Get wild transformer
   */
  getWildTransformer(): WildTransformer {
    return this.ctx.wildTransformer;
  }
}

/**
 * Factory function to create AllWaysEvaluator
 */
export function createAllWaysEvaluator(
  config: GameConfig,
  options?: AllWaysEvaluatorOptions
): AllWaysEvaluator {
  return new AllWaysEvaluator(config, options);
}
