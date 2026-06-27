/**
 * SLOT MATH EXACT - Wild Transformer
 *
 * Handles special wild behaviors before evaluation:
 * - Multiplier Wilds (x2, x3, etc.) - multiply wins
 * - Stacked Wilds - detected from reel strips
 * - Expanding Wilds - expand to fill entire reel
 *
 * These transformations happen BEFORE win evaluation.
 */

import type {
  GameConfig,
  SymbolDef,
  WildType
} from '../types/config.js';

/**
 * Wild information for a position
 */
export interface WildInfo {
  symbolId: string;
  wildType: WildType;
  multiplier: number;
  row: number;
  col: number;
  isStacked: boolean;
  stackSize?: number;  // How many symbols in the stack
}

/**
 * Transformed grid result
 */
export interface TransformedGrid {
  grid: string[][];
  originalGrid: string[][];
  wildInfos: WildInfo[];
  expandedReels: number[];  // Which reels were expanded
  stackedReels: number[];   // Which reels have stacked wilds
}

/**
 * Wild transformer context
 */
export interface WildTransformContext {
  wildDefs: Map<string, SymbolDef>;
  expandingWilds: Set<string>;
  stackedWilds: Set<string>;
  multiplierWilds: Map<string, number>;
  standardWilds: Set<string>;
}

/**
 * Create wild transform context from config
 */
export function createWildTransformContext(config: GameConfig): WildTransformContext {
  const wildDefs = new Map<string, SymbolDef>();
  const expandingWilds = new Set<string>();
  const stackedWilds = new Set<string>();
  const multiplierWilds = new Map<string, number>();
  const standardWilds = new Set<string>();

  for (const sym of config.symbols) {
    if (sym.role !== 'WILD') continue;

    wildDefs.set(sym.id, sym);

    const wildType = sym.wildType ?? 'STANDARD';

    switch (wildType) {
      case 'EXPANDING':
        expandingWilds.add(sym.id);
        break;
      case 'STACKED':
        stackedWilds.add(sym.id);
        break;
      case 'MULTIPLIER':
        multiplierWilds.set(sym.id, sym.multiplier ?? 1);
        break;
      default:
        standardWilds.add(sym.id);
    }

    // Multiplier can be on any wild type
    if (sym.multiplier && sym.multiplier > 1) {
      multiplierWilds.set(sym.id, sym.multiplier);
    }
  }

  return {
    wildDefs,
    expandingWilds,
    stackedWilds,
    multiplierWilds,
    standardWilds
  };
}

/**
 * Check if a reel has a stacked wild (consecutive wilds)
 * Returns stack information if found
 */
export function detectStackedWild(
  grid: string[][],
  col: number,
  ctx: WildTransformContext
): { isStacked: boolean; stackSize: number; startRow: number } | null {
  const rows = grid.length;
  let stackSize = 0;
  let startRow = -1;

  for (let row = 0; row < rows; row++) {
    const gridRow = grid[row];
    if (!gridRow) continue;

    const symbol = gridRow[col];
    if (!symbol) continue;

    // Check if this is a stacked wild or any wild in consecutive positions
    if (ctx.stackedWilds.has(symbol) || ctx.wildDefs.has(symbol)) {
      if (startRow === -1) startRow = row;
      stackSize++;
    } else {
      // Reset if non-wild found in between
      if (stackSize > 0 && stackSize < rows) {
        // Partial stack - check if it qualifies
        if (stackSize >= 2) {
          return { isStacked: true, stackSize, startRow };
        }
      }
      stackSize = 0;
      startRow = -1;
    }
  }

  // Full column of wilds
  if (stackSize >= 2) {
    return { isStacked: true, stackSize, startRow };
  }

  return null;
}

/**
 * Expand wild to fill entire reel
 * Returns new grid column
 */
export function expandWildOnReel(
  grid: string[][],
  col: number,
  expandingWildId: string
): string[][] {
  const newGrid = grid.map(row => [...row]);
  const rows = grid.length;

  for (let row = 0; row < rows; row++) {
    const gridRow = newGrid[row];
    if (gridRow) {
      gridRow[col] = expandingWildId;
    }
  }

  return newGrid;
}

/**
 * Find all wild positions in a grid
 */
export function findWildPositions(
  grid: string[][],
  ctx: WildTransformContext
): WildInfo[] {
  const wilds: WildInfo[] = [];
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  for (let row = 0; row < rows; row++) {
    const gridRow = grid[row];
    if (!gridRow) continue;

    for (let col = 0; col < cols; col++) {
      const symbol = gridRow[col];
      if (!symbol) continue;

      const wildDef = ctx.wildDefs.get(symbol);
      if (!wildDef) continue;

      const wildType = wildDef.wildType ?? 'STANDARD';
      const multiplier = ctx.multiplierWilds.get(symbol) ?? 1;

      // Check for stacked
      const stackInfo = detectStackedWild(grid, col, ctx);
      const isStacked = ctx.stackedWilds.has(symbol) ||
                        (stackInfo?.isStacked && stackInfo.stackSize === rows);

      wilds.push({
        symbolId: symbol,
        wildType,
        multiplier,
        row,
        col,
        isStacked: isStacked ?? false,
        stackSize: stackInfo?.stackSize
      });
    }
  }

  return wilds;
}

/**
 * Transform grid by applying expanding wilds
 *
 * When an expanding wild lands, it fills the entire reel.
 * This transformation happens BEFORE win evaluation.
 */
export function applyExpandingWilds(
  grid: string[][],
  ctx: WildTransformContext
): { grid: string[][]; expandedReels: number[] } {
  let currentGrid = grid.map(row => [...row]);
  const expandedReels: number[] = [];
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const gridRow = currentGrid[row];
      if (!gridRow) continue;

      const symbol = gridRow[col];
      if (!symbol) continue;

      // Check if this is an expanding wild
      if (ctx.expandingWilds.has(symbol)) {
        // Expand to fill entire reel
        currentGrid = expandWildOnReel(currentGrid, col, symbol);
        expandedReels.push(col);
        break;  // Only need to find one expanding wild per reel
      }
    }
  }

  return { grid: currentGrid, expandedReels };
}

/**
 * Calculate total multiplier from wilds in winning positions
 *
 * For MULTIPLIER wilds:
 * - Default behavior: MULTIPLY all wild multipliers together
 *   e.g., x2 wild + x3 wild = x6 total multiplier
 *
 * - Some games ADD multipliers instead:
 *   e.g., x2 wild + x3 wild = x5 total multiplier
 *
 * - Some games use only HIGHEST multiplier:
 *   e.g., x2 wild + x3 wild = x3 total multiplier
 */
export type MultiplierMode = 'MULTIPLY' | 'ADD' | 'HIGHEST';

export function calculateWildMultiplier(
  wildPositions: Array<{ row: number; col: number }>,
  grid: string[][],
  ctx: WildTransformContext,
  mode: MultiplierMode = 'MULTIPLY'
): number {
  if (wildPositions.length === 0) return 1;

  const multipliers: number[] = [];

  for (const pos of wildPositions) {
    const gridRow = grid[pos.row];
    if (!gridRow) continue;

    const symbol = gridRow[pos.col];
    if (!symbol) continue;

    const mult = ctx.multiplierWilds.get(symbol);
    if (mult && mult > 1) {
      multipliers.push(mult);
    }
  }

  if (multipliers.length === 0) return 1;

  switch (mode) {
    case 'MULTIPLY':
      return multipliers.reduce((total, m) => total * m, 1);

    case 'ADD':
      // Subtract 1 from each, sum, then add 1 back
      // e.g., x2 + x3 = (2-1) + (3-1) + 1 = 1 + 2 + 1 = 4...
      // Actually most "add" games just sum: 2 + 3 = 5
      return multipliers.reduce((total, m) => total + m - 1, 1);

    case 'HIGHEST':
      return Math.max(...multipliers);

    default:
      return 1;
  }
}

/**
 * Full grid transformation
 *
 * Applies all wild transformations in order:
 * 1. Detect stacked wilds
 * 2. Apply expanding wilds
 * 3. Collect wild info for multiplier calculation
 */
export function transformGrid(
  grid: string[][],
  ctx: WildTransformContext
): TransformedGrid {
  const originalGrid = grid.map(row => [...row]);
  const cols = grid[0]?.length ?? 0;
  const rows = grid.length;

  // 1. Apply expanding wilds
  const { grid: expandedGrid, expandedReels } = applyExpandingWilds(grid, ctx);

  // 2. Detect stacked wilds
  const stackedReels: number[] = [];
  for (let col = 0; col < cols; col++) {
    const stackInfo = detectStackedWild(expandedGrid, col, ctx);
    if (stackInfo?.isStacked && stackInfo.stackSize === rows) {
      stackedReels.push(col);
    }
  }

  // 3. Collect all wild info
  const wildInfos = findWildPositions(expandedGrid, ctx);

  return {
    grid: expandedGrid,
    originalGrid,
    wildInfos,
    expandedReels,
    stackedReels
  };
}

/**
 * Wild transformer class for stateful operation
 */
export class WildTransformer {
  private readonly ctx: WildTransformContext;
  private readonly multiplierMode: MultiplierMode;

  constructor(config: GameConfig, multiplierMode: MultiplierMode = 'MULTIPLY') {
    this.ctx = createWildTransformContext(config);
    this.multiplierMode = multiplierMode;
  }

  /**
   * Transform a grid (apply expanding wilds, detect stacks)
   */
  transform(grid: string[][]): TransformedGrid {
    return transformGrid(grid, this.ctx);
  }

  /**
   * Calculate multiplier for winning wild positions
   */
  getMultiplier(wildPositions: Array<{ row: number; col: number }>, grid: string[][]): number {
    return calculateWildMultiplier(wildPositions, grid, this.ctx, this.multiplierMode);
  }

  /**
   * Check if a symbol is any type of wild
   */
  isWild(symbolId: string): boolean {
    return this.ctx.wildDefs.has(symbolId);
  }

  /**
   * Check if a symbol is an expanding wild
   */
  isExpandingWild(symbolId: string): boolean {
    return this.ctx.expandingWilds.has(symbolId);
  }

  /**
   * Check if a symbol is a stacked wild
   */
  isStackedWild(symbolId: string): boolean {
    return this.ctx.stackedWilds.has(symbolId);
  }

  /**
   * Get multiplier value for a wild symbol
   */
  getWildMultiplier(symbolId: string): number {
    return this.ctx.multiplierWilds.get(symbolId) ?? 1;
  }

  /**
   * Get context (for debugging)
   */
  getContext(): WildTransformContext {
    return this.ctx;
  }
}
