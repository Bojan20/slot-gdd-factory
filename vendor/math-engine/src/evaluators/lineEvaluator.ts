/**
 * SLOT MATH EXACT - Line Pay Evaluator
 *
 * Evaluates line-based wins with support for:
 * - Left to Right (L→R)
 * - Right to Left (R→L)
 * - Both directions
 * - Wild substitution
 * - Multiplier wilds (x2, x3, stacking)
 * - Stacked wilds (full reel)
 * - Expanding wilds (expand to fill reel)
 */

import { Decimal, dec, ZERO } from '../core/decimal.js';
import type {
  GameConfig,
  Payline,
  PayEntry,
  SymbolDef,
  WinResult
} from '../types/config.js';
import {
  WildTransformer,
  type MultiplierMode,
  type TransformedGrid
} from './wildTransformer.js';

/**
 * Direction of evaluation
 */
export type EvalDirection = 'LTR' | 'RTL' | 'BOTH';

/**
 * Line evaluation context (cached lookups)
 */
export interface LineEvalContext {
  symbolMap: Map<string, SymbolDef>;
  paytableMap: Map<string, Map<number, number>>;
  wildSymbols: Set<string>;
  wildMultipliers: Map<string, number>;
  wildTransformer: WildTransformer;
}

/**
 * Create evaluation context from config
 */
export function createLineEvalContext(
  config: GameConfig,
  multiplierMode: MultiplierMode = 'MULTIPLY'
): LineEvalContext {
  const symbolMap = new Map<string, SymbolDef>();
  const wildSymbols = new Set<string>();
  const wildMultipliers = new Map<string, number>();

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
  }

  // Create wild transformer for expanding/stacked/multiplier wilds
  const wildTransformer = new WildTransformer(config, multiplierMode);

  return {
    symbolMap,
    paytableMap,
    wildSymbols,
    wildMultipliers,
    wildTransformer
  };
}

/**
 * Check if a symbol can substitute for another
 */
function canSubstitute(
  wildId: string,
  targetId: string,
  ctx: LineEvalContext
): boolean {
  const wildDef = ctx.symbolMap.get(wildId);
  const targetDef = ctx.symbolMap.get(targetId);

  if (!wildDef || !targetDef) return false;

  // Check if target can be substituted
  if (!targetDef.canBeSubstituted) return false;

  // Check if wild has specific substitution list
  if (wildDef.substitutes && wildDef.substitutes.length > 0) {
    return wildDef.substitutes.includes(targetId);
  }

  // Default: wild substitutes for all non-special symbols
  return targetDef.role !== 'SCATTER' &&
         targetDef.role !== 'BONUS' &&
         targetDef.role !== 'WILD';
}

/**
 * Get the best paying symbol from a position
 * Returns the symbol and any multiplier from wilds
 */
function getBestSymbol(
  symbols: string[],
  ctx: LineEvalContext
): { symbol: string; multiplier: number; wildUsed: boolean } | null {
  let bestSymbol: string | null = null;
  let bestPay = -1;
  let multiplier = 1;
  let wildUsed = false;

  for (const sym of symbols) {
    if (ctx.wildSymbols.has(sym)) {
      // Wild - check if it has multiplier
      const wildMult = ctx.wildMultipliers.get(sym);
      if (wildMult && wildMult > multiplier) {
        multiplier = wildMult;
      }
      wildUsed = true;
      continue;
    }

    // Regular symbol - check if it pays better
    const payMap = ctx.paytableMap.get(sym);
    if (payMap) {
      // Get highest pay for this symbol
      const maxPay = Math.max(...Array.from(payMap.values()));
      if (maxPay > bestPay) {
        bestPay = maxPay;
        bestSymbol = sym;
      }
    }
  }

  if (bestSymbol === null && wildUsed) {
    // Line of all wilds - use wild as symbol
    const firstWild = symbols.find(s => ctx.wildSymbols.has(s));
    if (firstWild) {
      return { symbol: firstWild, multiplier, wildUsed: true };
    }
  }

  if (bestSymbol === null) return null;

  return { symbol: bestSymbol, multiplier, wildUsed };
}

/**
 * Evaluate a single payline in one direction
 *
 * Supports:
 * - Standard wild substitution
 * - Multiplier wilds (x2, x3) with configurable stacking mode
 * - Stacked wilds (detected but handled same as standard for line eval)
 * - Expanding wilds (grid should be pre-transformed)
 */
function evaluatePaylineDirection(
  grid: string[][],
  payline: Payline,
  direction: 'LTR' | 'RTL',
  ctx: LineEvalContext
): WinResult | null {
  const cols = payline.positions.length;
  const positions: Array<{ row: number; col: number }> = [];

  // Get symbols on payline
  const lineSymbols: string[] = [];
  for (let col = 0; col < cols; col++) {
    const actualCol = direction === 'RTL' ? cols - 1 - col : col;
    const row = payline.positions[actualCol];

    if (row === undefined) continue;

    const gridRow = grid[row];
    if (!gridRow) continue;

    const symbol = gridRow[actualCol];
    if (symbol === undefined) continue;

    lineSymbols.push(symbol);
    positions.push({ row, col: actualCol });
  }

  if (lineSymbols.length === 0) return null;

  // Find first non-wild symbol to determine paying symbol
  let payingSymbol: string | null = null;
  let matchCount = 0;
  const matchedPositions: Array<{ row: number; col: number }> = [];
  const matchedWildPositions: Array<{ row: number; col: number }> = [];

  for (let i = 0; i < lineSymbols.length; i++) {
    const sym = lineSymbols[i];
    const pos = positions[i];

    if (sym === undefined || pos === undefined) break;

    if (ctx.wildSymbols.has(sym)) {
      // Wild matches
      matchCount++;
      matchedPositions.push(pos);
      matchedWildPositions.push(pos);
    } else if (payingSymbol === null) {
      // First non-wild symbol becomes paying symbol
      payingSymbol = sym;
      matchCount++;
      matchedPositions.push(pos);
    } else if (sym === payingSymbol) {
      // Matches paying symbol
      matchCount++;
      matchedPositions.push(pos);
    } else {
      // Different symbol - stop matching
      break;
    }
  }

  // If all wilds, use wild as paying symbol
  if (payingSymbol === null && matchCount > 0) {
    const firstWild = lineSymbols.find(s => ctx.wildSymbols.has(s));
    if (firstWild) {
      payingSymbol = firstWild;
    }
  }

  if (!payingSymbol || matchCount < 3) return null;  // Minimum 3 of a kind

  // Get pay value
  const payMap = ctx.paytableMap.get(payingSymbol);
  if (!payMap) return null;

  const basePay = payMap.get(matchCount);
  if (basePay === undefined || basePay === 0) return null;

  // Calculate multiplier using WildTransformer
  // This respects the configured multiplier mode (MULTIPLY, ADD, HIGHEST)
  const totalMultiplier = ctx.wildTransformer.getMultiplier(matchedWildPositions, grid);

  const totalWin = basePay * totalMultiplier;

  return {
    type: 'LINE',
    symbolId: payingSymbol,
    count: matchCount,
    positions: matchedPositions,
    baseWin: basePay,
    multiplier: totalMultiplier,
    totalWin,
    paylineId: payline.id,
    isWild: matchedWildPositions.length > 0,
    wildPositions: matchedWildPositions.length > 0 ? matchedWildPositions : undefined
  };
}

/**
 * Evaluation result with transformation info
 */
export interface LineEvalResult {
  wins: WinResult[];
  transformedGrid: TransformedGrid | null;
}

/**
 * Evaluate all paylines for a grid
 *
 * If applyWildTransform is true:
 * - Expanding wilds will be applied BEFORE evaluation
 * - This can significantly change the outcome
 */
export function evaluateLines(
  grid: string[][],
  paylines: Payline[],
  ctx: LineEvalContext,
  direction: EvalDirection = 'LTR',
  applyWildTransform: boolean = true
): WinResult[] {
  // Apply wild transformations if enabled
  let evalGrid = grid;
  if (applyWildTransform) {
    const transformed = ctx.wildTransformer.transform(grid);
    evalGrid = transformed.grid;
  }

  const wins: WinResult[] = [];

  for (const payline of paylines) {
    if (direction === 'LTR' || direction === 'BOTH') {
      const ltrWin = evaluatePaylineDirection(evalGrid, payline, 'LTR', ctx);
      if (ltrWin) {
        wins.push(ltrWin);
      }
    }

    if (direction === 'RTL' || direction === 'BOTH') {
      const rtlWin = evaluatePaylineDirection(evalGrid, payline, 'RTL', ctx);
      if (rtlWin) {
        // Avoid duplicate if same win in both directions
        if (direction === 'BOTH') {
          const isDuplicate = wins.some(w =>
            w.paylineId === rtlWin.paylineId &&
            w.symbolId === rtlWin.symbolId &&
            w.count === rtlWin.count
          );
          if (!isDuplicate) {
            wins.push(rtlWin);
          }
        } else {
          wins.push(rtlWin);
        }
      }
    }
  }

  return wins;
}

/**
 * Evaluate all paylines with full transformation info
 */
export function evaluateLinesWithTransform(
  grid: string[][],
  paylines: Payline[],
  ctx: LineEvalContext,
  direction: EvalDirection = 'LTR'
): LineEvalResult {
  const transformed = ctx.wildTransformer.transform(grid);
  const wins = evaluateLines(transformed.grid, paylines, ctx, direction, false);

  return {
    wins,
    transformedGrid: transformed
  };
}

/**
 * Calculate total line wins
 */
export function calculateLineWinTotal(wins: WinResult[]): Decimal {
  return wins.reduce((sum, win) => sum.plus(dec(win.totalWin)), ZERO);
}

/**
 * Line evaluator options
 */
export interface LineEvaluatorOptions {
  multiplierMode?: MultiplierMode;
  applyWildTransform?: boolean;
}

/**
 * Line evaluator class for stateful evaluation
 */
export class LineEvaluator {
  private readonly ctx: LineEvalContext;
  private readonly paylines: Payline[];
  private readonly direction: EvalDirection;
  private readonly applyWildTransform: boolean;

  constructor(config: GameConfig, options: LineEvaluatorOptions = {}) {
    const { multiplierMode = 'MULTIPLY', applyWildTransform = true } = options;

    this.ctx = createLineEvalContext(config, multiplierMode);
    this.paylines = config.paylines ?? [];
    this.applyWildTransform = applyWildTransform;

    switch (config.evalType) {
      case 'LINES_LTR':
        this.direction = 'LTR';
        break;
      case 'LINES_RTL':
        this.direction = 'RTL';
        break;
      case 'LINES_BOTH':
        this.direction = 'BOTH';
        break;
      default:
        this.direction = 'LTR';
    }
  }

  /**
   * Evaluate a grid and return wins
   */
  evaluate(grid: string[][]): WinResult[] {
    return evaluateLines(grid, this.paylines, this.ctx, this.direction, this.applyWildTransform);
  }

  /**
   * Evaluate with full transformation info
   */
  evaluateWithTransform(grid: string[][]): LineEvalResult {
    return evaluateLinesWithTransform(grid, this.paylines, this.ctx, this.direction);
  }

  /**
   * Evaluate and return total win
   */
  evaluateTotal(grid: string[][]): Decimal {
    const wins = this.evaluate(grid);
    return calculateLineWinTotal(wins);
  }

  /**
   * Get the wild transformer
   */
  getWildTransformer(): WildTransformer {
    return this.ctx.wildTransformer;
  }

  /**
   * Get context (for debugging)
   */
  getContext(): LineEvalContext {
    return this.ctx;
  }
}
