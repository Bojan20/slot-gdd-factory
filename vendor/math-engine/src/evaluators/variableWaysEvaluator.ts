/**
 * SLOT MATH EXACT - Variable-Ways Evaluator
 *
 * Handles variable-row mechanics where each reel can land a different
 * number of symbol rows per spin (typically 2-7). Total ways = product
 * of per-reel row counts. Generic — no vendor naming.
 *
 * Key concepts:
 * - Each reel has weighted probability for different row counts
 * - Total ways = product of symbols per reel
 * - Win calculation same as standard ways, but with variable ways count
 *
 * For exact calculation:
 * - Enumerate all possible reel height combinations
 * - For each combination, calculate ways and wins
 * - Weight by probability of that combination
 */

import { Decimal, dec, ZERO, ONE, sum, product, safeDivide } from '../core/decimal.js';
import { waysToWin, bigIntToDecimal } from '../core/index.js';
import type {
  GameConfig,
  SymbolDef,
  WinResult,
  VariableWaysConfig
} from '../types/config.js';
import {
  WildTransformer,
  type MultiplierMode,
  type TransformedGrid
} from './wildTransformer.js';

/**
 * Reel height configuration
 */
export interface ReelHeightConfig {
  minSymbols: number;
  maxSymbols: number;
  weights: Map<number, number>;  // symbols -> weight
}

/**
 * Variable-ways grid state
 */
export interface VariableWaysGridState {
  grid: string[][];
  symbolsPerReel: number[];
  totalWays: bigint;
  weight: Decimal;
}

/**
 * Variable-ways evaluation context
 */
export interface VariableWaysEvalContext {
  symbolMap: Map<string, SymbolDef>;
  paytableMap: Map<string, Map<number, number>>;
  wildSymbols: Set<string>;
  wildMultipliers: Map<string, number>;
  payingSymbols: string[];
  reelHeights: ReelHeightConfig[];
  wildTransformer: WildTransformer;
}

/**
 * Create variable-ways evaluation context
 */
export function createVariableWaysEvalContext(
  config: GameConfig,
  multiplierMode: MultiplierMode = 'MULTIPLY'
): VariableWaysEvalContext {
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

  // Build reel height configs
  const varConfig = config.variableWaysConfig;
  const numReels = config.grid.cols;
  const reelHeights: ReelHeightConfig[] = [];

  for (let i = 0; i < numReels; i++) {
    const reelWeights = varConfig?.reelWeights?.[i];
    const weights = new Map<number, number>();

    const minSym = varConfig?.minSymbolsPerReel ?? 2;
    const maxSym = varConfig?.maxSymbolsPerReel ?? 7;

    if (reelWeights) {
      for (const [key, weight] of Object.entries(reelWeights)) {
        weights.set(parseInt(key, 10), weight);
      }
    } else {
      // Default: uniform distribution
      for (let s = minSym; s <= maxSym; s++) {
        weights.set(s, 1);
      }
    }

    reelHeights.push({
      minSymbols: minSym,
      maxSymbols: maxSym,
      weights
    });
  }

  const wildTransformer = new WildTransformer(config, multiplierMode);

  return {
    symbolMap,
    paytableMap,
    wildSymbols,
    wildMultipliers,
    payingSymbols,
    reelHeights,
    wildTransformer
  };
}

/**
 * Calculate total weight for a reel
 */
function getReelTotalWeight(config: ReelHeightConfig): number {
  let total = 0;
  for (const weight of config.weights.values()) {
    total += weight;
  }
  return total;
}

/**
 * Calculate probability of a specific height configuration
 */
export function calculateHeightProbability(
  symbolsPerReel: number[],
  reelHeights: ReelHeightConfig[]
): Decimal {
  let probability = ONE;

  for (let i = 0; i < symbolsPerReel.length; i++) {
    const symbols = symbolsPerReel[i];
    const config = reelHeights[i];

    if (symbols === undefined || config === undefined) continue;

    const weight = config.weights.get(symbols) ?? 0;
    const totalWeight = getReelTotalWeight(config);

    if (totalWeight === 0) return ZERO;

    probability = probability.times(safeDivide(dec(weight), dec(totalWeight)));
  }

  return probability;
}

/**
 * Generate all possible height combinations
 */
export function* enumerateHeightCombinations(
  reelHeights: ReelHeightConfig[]
): Generator<{ symbolsPerReel: number[]; probability: Decimal }> {
  const numReels = reelHeights.length;
  const indices: number[] = new Array(numReels).fill(0);
  const heights: number[][] = reelHeights.map(config =>
    Array.from(config.weights.keys()).sort((a, b) => a - b)
  );

  while (true) {
    // Build current combination
    const symbolsPerReel: number[] = [];
    for (let i = 0; i < numReels; i++) {
      const reelHeightOptions = heights[i];
      const idx = indices[i];
      if (reelHeightOptions && idx !== undefined) {
        symbolsPerReel.push(reelHeightOptions[idx] ?? 2);
      }
    }

    const probability = calculateHeightProbability(symbolsPerReel, reelHeights);

    if (probability.greaterThan(ZERO)) {
      yield { symbolsPerReel, probability };
    }

    // Advance to next combination
    let carry = true;
    for (let i = numReels - 1; i >= 0 && carry; i--) {
      const currentIdx = indices[i];
      if (currentIdx === undefined) continue;
      indices[i] = currentIdx + 1;
      const reelHeightOptions = heights[i];
      if (reelHeightOptions && indices[i]! < reelHeightOptions.length) {
        carry = false;
      } else {
        indices[i] = 0;
      }
    }

    if (carry) break;  // All combinations exhausted
  }
}

/**
 * Calculate total possible ways for a height configuration
 */
export function calculateVariableWays(symbolsPerReel: number[]): bigint {
  return waysToWin(symbolsPerReel);
}

/**
 * Create a variable-height grid from reel strips
 */
export function createVariableRowsGrid(
  reelStrips: string[][],
  stopPositions: number[],
  symbolsPerReel: number[]
): string[][] {
  const maxRows = Math.max(...symbolsPerReel);
  const grid: string[][] = [];

  for (let row = 0; row < maxRows; row++) {
    const rowSymbols: string[] = [];

    for (let col = 0; col < reelStrips.length; col++) {
      const strip = reelStrips[col];
      const stop = stopPositions[col] ?? 0;
      const numSymbols = symbolsPerReel[col] ?? 0;

      if (row < numSymbols && strip) {
        const symbolIndex = (stop + row) % strip.length;
        rowSymbols.push(strip[symbolIndex] ?? '');
      } else {
        rowSymbols.push('');  // Empty for rows beyond this reel's height
      }
    }

    grid.push(rowSymbols);
  }

  return grid;
}

/**
 * Evaluate variable-ways grid for ways wins
 * Similar to WaysEvaluator but handles variable row counts
 */
export function evaluateVariableWaysWins(
  grid: string[][],
  symbolsPerReel: number[],
  ctx: VariableWaysEvalContext,
  applyWildTransform: boolean = true
): WinResult[] {
  // Apply wild transformations
  let evalGrid = grid;
  if (applyWildTransform) {
    const transformed = ctx.wildTransformer.transform(grid);
    evalGrid = transformed.grid;
  }

  const wins: WinResult[] = [];
  const numReels = symbolsPerReel.length;

  // Check each paying symbol
  for (const symbolId of ctx.payingSymbols) {
    let consecutive = 0;
    let waysCount = 1n;
    const wildPositions: Array<{ row: number; col: number }> = [];

    for (let col = 0; col < numReels; col++) {
      const numRows = symbolsPerReel[col] ?? 0;
      let matchCount = 0;

      for (let row = 0; row < numRows; row++) {
        const sym = evalGrid[row]?.[col];
        if (sym === symbolId || (sym && ctx.wildSymbols.has(sym))) {
          matchCount++;
          if (sym && ctx.wildSymbols.has(sym)) {
            wildPositions.push({ row, col });
          }
        }
      }

      if (matchCount === 0) break;

      consecutive++;
      waysCount *= BigInt(matchCount);
    }

    if (consecutive < 3) continue;

    // Get pay value
    const payMap = ctx.paytableMap.get(symbolId);
    if (!payMap) continue;

    const basePay = payMap.get(consecutive);
    if (basePay === undefined || basePay === 0) continue;

    // Calculate multiplier
    const multiplier = ctx.wildTransformer.getMultiplier(wildPositions, evalGrid);

    const waysNum = Number(waysCount);
    const totalWin = basePay * waysNum * multiplier;

    wins.push({
      type: 'WAYS',
      symbolId,
      count: consecutive,
      positions: [],  // Complex for variable grid
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
 * Variable-ways evaluation result
 */
export interface VariableWaysEvalResult {
  wins: WinResult[];
  symbolsPerReel: number[];
  totalWays: bigint;
  transformedGrid: TransformedGrid | null;
}

/**
 * Variable-ways evaluator class
 */
export class VariableWaysEvaluator {
  private readonly ctx: VariableWaysEvalContext;
  private readonly applyWildTransform: boolean;

  constructor(config: GameConfig, options: { multiplierMode?: MultiplierMode; applyWildTransform?: boolean } = {}) {
    const { multiplierMode = 'MULTIPLY', applyWildTransform = true } = options;
    this.ctx = createVariableWaysEvalContext(config, multiplierMode);
    this.applyWildTransform = applyWildTransform;
  }

  /**
   * Evaluate a variable-ways grid
   */
  evaluate(grid: string[][], symbolsPerReel: number[]): WinResult[] {
    return evaluateVariableWaysWins(grid, symbolsPerReel, this.ctx, this.applyWildTransform);
  }

  /**
   * Evaluate with full info
   */
  evaluateWithInfo(grid: string[][], symbolsPerReel: number[]): VariableWaysEvalResult {
    const transformed = this.ctx.wildTransformer.transform(grid);
    const wins = evaluateVariableWaysWins(transformed.grid, symbolsPerReel, this.ctx, false);

    return {
      wins,
      symbolsPerReel,
      totalWays: calculateVariableWays(symbolsPerReel),
      transformedGrid: transformed
    };
  }

  /**
   * Get all height combinations with probabilities
   */
  *enumerateConfigurations(): Generator<{ symbolsPerReel: number[]; probability: Decimal; ways: bigint }> {
    for (const combo of enumerateHeightCombinations(this.ctx.reelHeights)) {
      yield {
        ...combo,
        ways: calculateVariableWays(combo.symbolsPerReel)
      };
    }
  }

  /**
   * Calculate expected ways (average over all configurations)
   */
  calculateExpectedWays(): Decimal {
    let expectedWays = ZERO;

    for (const combo of this.enumerateConfigurations()) {
      expectedWays = expectedWays.plus(
        combo.probability.times(bigIntToDecimal(combo.ways))
      );
    }

    return expectedWays;
  }

  /**
   * Get wild transformer
   */
  getWildTransformer(): WildTransformer {
    return this.ctx.wildTransformer;
  }
}
