/**
 * SLOT MATH EXACT - Cluster Pay Evaluator
 *
 * Evaluates cluster-based wins where adjacent matching symbols form clusters.
 * Used in match-three / connected-cluster style mechanics.
 *
 * Supports:
 * - Orthogonal adjacency (up/down/left/right)
 * - Diagonal adjacency (8-way connection)
 * - Both (all 8 directions)
 * - Cascade/tumble mechanics
 * - Expanding wilds (grid transformation)
 * - Multiplier wilds (MULTIPLY, ADD, HIGHEST modes)
 */

import { Decimal, dec, ZERO } from '../core/decimal.js';
import type {
  GameConfig,
  SymbolDef,
  WinResult,
  ClusterConfig
} from '../types/config.js';
import {
  WildTransformer,
  type MultiplierMode,
  type TransformedGrid
} from './wildTransformer.js';

/**
 * Adjacency type
 */
export type AdjacencyType = 'ORTHOGONAL' | 'DIAGONAL' | 'BOTH';

/**
 * Position in grid
 */
interface Position {
  row: number;
  col: number;
}

// ============================================================================
// UNION-FIND DATA STRUCTURE
// ============================================================================

/**
 * Union-Find (Disjoint Set Union) with path compression and union by rank.
 * Provides near O(1) amortized operations for finding connected components.
 */
class UnionFind {
  private parent: Int32Array;
  private rank: Uint8Array;
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);

    // Initialize: each element is its own parent
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  /**
   * Find the root of element x with path compression
   */
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]!);
    }
    return this.parent[x]!;
  }

  /**
   * Union two elements by rank
   * Returns true if they were in different sets
   */
  union(x: number, y: number): boolean {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return false;

    const rankX = this.rank[rootX]!;
    const rankY = this.rank[rootY]!;

    // Attach smaller tree under larger tree
    if (rankX < rankY) {
      this.parent[rootX] = rootY;
    } else if (rankX > rankY) {
      this.parent[rootY] = rootX;
    } else {
      this.parent[rootY] = rootX;
      this.rank[rootX]!++;
    }

    return true;
  }

  /**
   * Check if two elements are in the same set
   */
  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }

  /**
   * Get all components as Map<root, elements[]>
   */
  getComponents(): Map<number, number[]> {
    const components = new Map<number, number[]>();

    for (let i = 0; i < this.size; i++) {
      const root = this.find(i);
      let component = components.get(root);
      if (!component) {
        component = [];
        components.set(root, component);
      }
      component.push(i);
    }

    return components;
  }
}

/**
 * Cluster evaluation context
 */
export interface ClusterEvalContext {
  symbolMap: Map<string, SymbolDef>;
  paytableMap: Map<string, Map<number, number>>;  // symbol -> size -> pay
  wildSymbols: Set<string>;
  wildMultipliers: Map<string, number>;
  payingSymbols: string[];
  minClusterSize: number;
  adjacency: AdjacencyType;
  wildTransformer: WildTransformer;
}

/**
 * Create cluster evaluation context
 */
export function createClusterEvalContext(
  config: GameConfig,
  clusterConfig?: ClusterConfig,
  multiplierMode: MultiplierMode = 'MULTIPLY'
): ClusterEvalContext {
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
    minClusterSize: clusterConfig?.minClusterSize ?? 5,
    adjacency: clusterConfig?.adjacency ?? 'ORTHOGONAL',
    wildTransformer
  };
}

/**
 * Get adjacent positions based on adjacency type
 */
function getAdjacentPositions(
  pos: Position,
  rows: number,
  cols: number,
  adjacency: AdjacencyType
): Position[] {
  const adjacent: Position[] = [];

  // Orthogonal directions (up, down, left, right)
  const orthogonal: Array<[number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];

  // Diagonal directions
  const diagonal: Array<[number, number]> = [
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  let directions: Array<[number, number]>;
  switch (adjacency) {
    case 'ORTHOGONAL':
      directions = orthogonal;
      break;
    case 'DIAGONAL':
      directions = diagonal;
      break;
    case 'BOTH':
      directions = [...orthogonal, ...diagonal];
      break;
  }

  for (const [dr, dc] of directions) {
    const newRow = pos.row + dr;
    const newCol = pos.col + dc;

    if (newRow >= 0 && newRow < rows && newCol >= 0 && newCol < cols) {
      adjacent.push({ row: newRow, col: newCol });
    }
  }

  return adjacent;
}

/**
 * Find a cluster starting from a position using flood fill
 */
function findCluster(
  grid: string[][],
  startPos: Position,
  targetSymbol: string,
  visited: Set<string>,
  ctx: ClusterEvalContext
): Position[] {
  const cluster: Position[] = [];
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const stack: Position[] = [startPos];

  while (stack.length > 0) {
    const pos = stack.pop();
    if (!pos) continue;

    const key = `${pos.row},${pos.col}`;
    if (visited.has(key)) continue;

    const row = grid[pos.row];
    if (!row) continue;

    const symbol = row[pos.col];
    if (symbol === undefined) continue;

    // Check if symbol matches (including wilds)
    const matches = symbol === targetSymbol || ctx.wildSymbols.has(symbol);
    if (!matches) continue;

    visited.add(key);
    cluster.push(pos);

    // Add adjacent positions to stack
    const adjacent = getAdjacentPositions(pos, rows, cols, ctx.adjacency);
    for (const adjPos of adjacent) {
      const adjKey = `${adjPos.row},${adjPos.col}`;
      if (!visited.has(adjKey)) {
        stack.push(adjPos);
      }
    }
  }

  return cluster;
}

/**
 * Find all clusters of a specific symbol (legacy flood-fill, kept for reference)
 */
function findAllClustersForSymbolFloodFill(
  grid: string[][],
  symbolId: string,
  ctx: ClusterEvalContext
): Position[][] {
  const clusters: Position[][] = [];
  const visited = new Set<string>();
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `${row},${col}`;
      if (visited.has(key)) continue;

      const gridRow = grid[row];
      if (!gridRow) continue;

      const symbol = gridRow[col];
      if (symbol === undefined) continue;

      // Only start clusters from the target symbol (not wilds)
      if (symbol !== symbolId) continue;

      const cluster = findCluster(grid, { row, col }, symbolId, visited, ctx);

      if (cluster.length >= ctx.minClusterSize) {
        clusters.push(cluster);
      }
    }
  }

  return clusters;
}

/**
 * Convert 2D position to 1D index
 */
function posToIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

/**
 * Convert 1D index to 2D position
 */
function indexToPos(index: number, cols: number): Position {
  return {
    row: Math.floor(index / cols),
    col: index % cols
  };
}

/**
 * Get adjacent indices based on adjacency type
 * Returns array of valid neighbor indices
 */
function getAdjacentIndices(
  index: number,
  rows: number,
  cols: number,
  adjacency: AdjacencyType
): number[] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const adjacent: number[] = [];

  // Orthogonal directions (up, down, left, right)
  const orthogonal: Array<[number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];

  // Diagonal directions
  const diagonal: Array<[number, number]> = [
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  let directions: Array<[number, number]>;
  switch (adjacency) {
    case 'ORTHOGONAL':
      directions = orthogonal;
      break;
    case 'DIAGONAL':
      directions = diagonal;
      break;
    case 'BOTH':
      directions = [...orthogonal, ...diagonal];
      break;
  }

  for (const [dr, dc] of directions) {
    const newRow = row + dr;
    const newCol = col + dc;

    if (newRow >= 0 && newRow < rows && newCol >= 0 && newCol < cols) {
      adjacent.push(newRow * cols + newCol);
    }
  }

  return adjacent;
}

/**
 * Find all clusters for a symbol using Union-Find (optimized O(n·α(n)))
 *
 * Algorithm:
 * 1. Build matching positions set (target symbol + wilds)
 * 2. Union adjacent matching positions
 * 3. Extract components that contain the target symbol
 * 4. Filter by minimum cluster size
 */
function findAllClustersForSymbol(
  grid: string[][],
  symbolId: string,
  ctx: ClusterEvalContext
): Position[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const totalCells = rows * cols;

  if (totalCells === 0) return [];

  // Build set of matching positions and track which have target symbol
  const matchingPositions = new Set<number>();
  const hasTargetSymbol = new Set<number>();

  for (let row = 0; row < rows; row++) {
    const gridRow = grid[row];
    if (!gridRow) continue;

    for (let col = 0; col < cols; col++) {
      const symbol = gridRow[col];
      if (symbol === undefined) continue;

      const index = posToIndex(row, col, cols);

      if (symbol === symbolId) {
        matchingPositions.add(index);
        hasTargetSymbol.add(index);
      } else if (ctx.wildSymbols.has(symbol)) {
        matchingPositions.add(index);
      }
    }
  }

  // Early exit if no target symbols
  if (hasTargetSymbol.size === 0) return [];

  // Create Union-Find only for matching positions
  // Map actual indices to compact indices for efficiency
  const indexToCompact = new Map<number, number>();
  const compactToIndex: number[] = [];

  for (const idx of matchingPositions) {
    indexToCompact.set(idx, compactToIndex.length);
    compactToIndex.push(idx);
  }

  const uf = new UnionFind(compactToIndex.length);

  // Union adjacent matching positions
  for (const idx of matchingPositions) {
    const compactIdx = indexToCompact.get(idx)!;
    const neighbors = getAdjacentIndices(idx, rows, cols, ctx.adjacency);

    for (const neighborIdx of neighbors) {
      if (matchingPositions.has(neighborIdx)) {
        const compactNeighbor = indexToCompact.get(neighborIdx)!;
        uf.union(compactIdx, compactNeighbor);
      }
    }
  }

  // Get all components
  const components = uf.getComponents();

  // Filter components that contain target symbol and meet size requirement
  const clusters: Position[][] = [];

  for (const [, compactIndices] of components) {
    // Convert back to actual indices
    const actualIndices = compactIndices.map(ci => compactToIndex[ci]!);

    // Check if component contains the target symbol
    const containsTarget = actualIndices.some(idx => hasTargetSymbol.has(idx));
    if (!containsTarget) continue;

    // Check minimum size
    if (actualIndices.length < ctx.minClusterSize) continue;

    // Convert to positions
    const cluster = actualIndices.map(idx => indexToPos(idx, cols));
    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Calculate multiplier from wilds in cluster using WildTransformer
 */
function calculateClusterMultiplier(
  grid: string[][],
  cluster: Position[],
  ctx: ClusterEvalContext
): number {
  // Get wild positions from cluster
  const wildPositions: Array<{ row: number; col: number }> = [];

  for (const pos of cluster) {
    const row = grid[pos.row];
    if (!row) continue;

    const symbol = row[pos.col];
    if (symbol === undefined) continue;

    if (ctx.wildSymbols.has(symbol)) {
      wildPositions.push({ row: pos.row, col: pos.col });
    }
  }

  // Use WildTransformer for proper multiplier mode handling
  return ctx.wildTransformer.getMultiplier(wildPositions, grid);
}

/**
 * Cluster evaluation result with transform info
 */
export interface ClusterEvalResult {
  wins: WinResult[];
  transformedGrid: TransformedGrid | null;
}

/**
 * Evaluate clusters for a grid
 */
export function evaluateClusters(
  grid: string[][],
  ctx: ClusterEvalContext,
  applyWildTransform: boolean = true
): WinResult[] {
  // Apply wild transformations (expanding wilds)
  let evalGrid = grid;
  if (applyWildTransform) {
    const transformed = ctx.wildTransformer.transform(grid);
    evalGrid = transformed.grid;
  }
  const wins: WinResult[] = [];

  for (const symbolId of ctx.payingSymbols) {
    const clusters = findAllClustersForSymbol(evalGrid, symbolId, ctx);

    for (const cluster of clusters) {
      const payMap = ctx.paytableMap.get(symbolId);
      if (!payMap) continue;

      // Find pay for cluster size (or largest that applies)
      let basePay = 0;
      let paySize = cluster.length;

      // Get the highest pay that applies
      for (const [size, pay] of payMap.entries()) {
        if (cluster.length >= size && size >= paySize - cluster.length) {
          if (pay > basePay || size > paySize - cluster.length) {
            basePay = pay;
            paySize = size;
          }
        }
      }

      // Also check exact size
      const exactPay = payMap.get(cluster.length);
      if (exactPay !== undefined && exactPay > basePay) {
        basePay = exactPay;
      }

      if (basePay === 0) continue;

      const multiplier = calculateClusterMultiplier(evalGrid, cluster, ctx);
      const totalWin = basePay * multiplier;

      // Check for wild positions
      const wildPositions: Position[] = [];
      for (const pos of cluster) {
        const row = evalGrid[pos.row];
        if (!row) continue;

        const symbol = row[pos.col];
        if (symbol !== undefined && ctx.wildSymbols.has(symbol)) {
          wildPositions.push(pos);
        }
      }

      wins.push({
        type: 'CLUSTER',
        symbolId,
        count: cluster.length,
        positions: cluster.map(p => ({ row: p.row, col: p.col })),
        baseWin: basePay,
        multiplier,
        totalWin,
        isWild: wildPositions.length > 0,
        wildPositions: wildPositions.length > 0 ? wildPositions : undefined
      });
    }
  }

  return wins;
}

/**
 * Remove cluster symbols from grid (for cascade)
 * Returns new grid with symbols removed (replaced with empty string)
 */
export function removeClusterSymbols(
  grid: string[][],
  wins: WinResult[]
): string[][] {
  const newGrid = grid.map(row => [...row]);

  for (const win of wins) {
    if (win.type !== 'CLUSTER') continue;

    for (const pos of win.positions) {
      const row = newGrid[pos.row];
      if (row) {
        row[pos.col] = '';
      }
    }
  }

  return newGrid;
}

/**
 * Apply gravity (cascade) to grid
 * Empty symbols fall down, top fills with new symbols
 */
export function applyGravity(grid: string[][]): string[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const newGrid: string[][] = [];

  // Initialize empty grid
  for (let r = 0; r < rows; r++) {
    newGrid.push(new Array(cols).fill(''));
  }

  // For each column, stack non-empty symbols from bottom
  for (let col = 0; col < cols; col++) {
    const symbols: string[] = [];

    // Collect non-empty symbols from bottom to top
    for (let row = rows - 1; row >= 0; row--) {
      const sym = grid[row]?.[col];
      if (sym && sym !== '') {
        symbols.push(sym);
      }
    }

    // Place them at the bottom of new grid
    for (let i = 0; i < symbols.length; i++) {
      const row = rows - 1 - i;
      const newRow = newGrid[row];
      const sym = symbols[i];
      if (newRow && sym !== undefined) {
        newRow[col] = sym;
      }
    }
  }

  return newGrid;
}

/**
 * Calculate total cluster wins
 */
export function calculateClusterWinTotal(wins: WinResult[]): Decimal {
  return wins.reduce((sum, win) => sum.plus(dec(win.totalWin)), ZERO);
}

/**
 * Evaluate clusters with full transformation info
 */
export function evaluateClustersWithTransform(
  grid: string[][],
  ctx: ClusterEvalContext
): ClusterEvalResult {
  const transformed = ctx.wildTransformer.transform(grid);
  const wins = evaluateClusters(transformed.grid, ctx, false);

  return {
    wins,
    transformedGrid: transformed
  };
}

/**
 * Cluster evaluator options
 */
export interface ClusterEvaluatorOptions {
  multiplierMode?: MultiplierMode;
  applyWildTransform?: boolean;
}

/**
 * Find all clusters for ALL symbols in a single pass using Union-Find.
 * More efficient than calling findAllClustersForSymbol for each symbol.
 *
 * Returns Map<symbolId, Position[][]>
 */
export function findAllClustersUnionFind(
  grid: string[][],
  ctx: ClusterEvalContext
): Map<string, Position[][]> {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  if (rows === 0 || cols === 0) return new Map();

  // Build symbol map for each position
  const symbolAtPos = new Map<number, string>();
  const wildPositions = new Set<number>();

  for (let row = 0; row < rows; row++) {
    const gridRow = grid[row];
    if (!gridRow) continue;

    for (let col = 0; col < cols; col++) {
      const symbol = gridRow[col];
      if (symbol === undefined) continue;

      const index = posToIndex(row, col, cols);
      symbolAtPos.set(index, symbol);

      if (ctx.wildSymbols.has(symbol)) {
        wildPositions.add(index);
      }
    }
  }

  // For each paying symbol, find clusters
  const result = new Map<string, Position[][]>();

  for (const symbolId of ctx.payingSymbols) {
    // Build matching set for this symbol
    const matchingPositions = new Set<number>();
    const hasTargetSymbol = new Set<number>();

    for (const [index, symbol] of symbolAtPos) {
      if (symbol === symbolId) {
        matchingPositions.add(index);
        hasTargetSymbol.add(index);
      } else if (wildPositions.has(index)) {
        matchingPositions.add(index);
      }
    }

    if (hasTargetSymbol.size === 0) continue;

    // Build compact Union-Find
    const indexToCompact = new Map<number, number>();
    const compactToIndex: number[] = [];

    for (const idx of matchingPositions) {
      indexToCompact.set(idx, compactToIndex.length);
      compactToIndex.push(idx);
    }

    const uf = new UnionFind(compactToIndex.length);

    // Union adjacent
    for (const idx of matchingPositions) {
      const compactIdx = indexToCompact.get(idx)!;
      const neighbors = getAdjacentIndices(idx, rows, cols, ctx.adjacency);

      for (const neighborIdx of neighbors) {
        if (matchingPositions.has(neighborIdx)) {
          uf.union(compactIdx, indexToCompact.get(neighborIdx)!);
        }
      }
    }

    // Extract valid clusters
    const components = uf.getComponents();
    const clusters: Position[][] = [];

    for (const [, compactIndices] of components) {
      const actualIndices = compactIndices.map(ci => compactToIndex[ci]!);

      if (!actualIndices.some(idx => hasTargetSymbol.has(idx))) continue;
      if (actualIndices.length < ctx.minClusterSize) continue;

      clusters.push(actualIndices.map(idx => indexToPos(idx, cols)));
    }

    if (clusters.length > 0) {
      result.set(symbolId, clusters);
    }
  }

  return result;
}

/**
 * Cluster evaluator class
 */
export class ClusterEvaluator {
  private readonly ctx: ClusterEvalContext;
  private readonly applyWildTransform: boolean;

  constructor(config: GameConfig, options: ClusterEvaluatorOptions = {}) {
    const { multiplierMode = 'MULTIPLY', applyWildTransform = true } = options;
    this.ctx = createClusterEvalContext(config, config.clusterConfig, multiplierMode);
    this.applyWildTransform = applyWildTransform;
  }

  /**
   * Evaluate a grid
   */
  evaluate(grid: string[][]): WinResult[] {
    return evaluateClusters(grid, this.ctx, this.applyWildTransform);
  }

  /**
   * Evaluate with full transformation info
   */
  evaluateWithTransform(grid: string[][]): ClusterEvalResult {
    return evaluateClustersWithTransform(grid, this.ctx);
  }

  /**
   * Evaluate and return total
   */
  evaluateTotal(grid: string[][]): Decimal {
    const wins = this.evaluate(grid);
    return calculateClusterWinTotal(wins);
  }

  /**
   * Get wild transformer
   */
  getWildTransformer(): WildTransformer {
    return this.ctx.wildTransformer;
  }

  /**
   * Evaluate with cascade (tumble) mechanic
   * Returns all wins from all cascade levels
   */
  evaluateWithCascade(
    grid: string[][],
    maxCascades: number = 50,
    fillSymbols?: () => string
  ): { wins: WinResult[]; cascadeLevel: number } {
    const allWins: WinResult[] = [];
    let currentGrid = grid;
    let cascadeLevel = 0;

    while (cascadeLevel < maxCascades) {
      const wins = this.evaluate(currentGrid);

      if (wins.length === 0) break;

      allWins.push(...wins);
      cascadeLevel++;

      // Remove winning symbols
      currentGrid = removeClusterSymbols(currentGrid, wins);

      // Apply gravity
      currentGrid = applyGravity(currentGrid);

      // Fill empty spaces (if fill function provided)
      if (fillSymbols) {
        for (const row of currentGrid) {
          for (let i = 0; i < row.length; i++) {
            if (row[i] === '') {
              row[i] = fillSymbols();
            }
          }
        }
      } else {
        // If no fill function, cascade ends when there are empty spaces
        break;
      }
    }

    return { wins: allWins, cascadeLevel };
  }

  /**
   * Get minimum cluster size
   */
  getMinClusterSize(): number {
    return this.ctx.minClusterSize;
  }
}
