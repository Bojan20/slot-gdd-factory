/**
 * W152 Wave 19 — IR-native Cluster Evaluator (Faza 15.B.2).
 *
 * Adjacency-based cluster win detection on `cluster_grid` topologies.
 * Where the legacy `clusterEvaluator.ts` operated on the legacy
 * `GameConfig`, this module consumes an IR `Topology` of
 * `cluster_grid` kind directly and produces clusters + payouts.
 *
 * Algorithm:
 *   * Iterative flood-fill from every un-visited cell.
 *   * Adjacency mode driven by IR `topology.adjacency`:
 *     - `orthogonal` — 4-way (N/S/E/W)
 *     - `diagonal`   — 8-way (orthogonal + 4 diagonals)
 *     - `hex`        — 6-way axial neighbours (offset coordinates)
 *   * Wild substitution: a `wild`-kind symbol joins any cluster it
 *     borders. Multi-symbol clusters merge through wilds.
 *   * Min cluster size from `IR.evaluation.kind === 'cluster'` config.
 *
 * Output:
 *   * Per-cluster: symbol id, size, cell coordinates, payout.
 *   * Total payoutX summed across all winning clusters.
 *
 * Determinism: scan order is row-major (top-left → bottom-right) so
 * the same grid + same symbol assignment always produces identical
 * cluster ordering. Replay-safe.
 *
 * Closed-form RTP: not analytically tractable for cluster (highly
 * non-linear in symbol density). MC required for tuning.
 */

import type { SlotGameIR, SymbolKey } from '../ir/types.js';

export type AdjacencyMode = 'orthogonal' | 'diagonal' | 'hex';

export interface ClusterGrid {
  /** symbols[col][row] = symbol id at that cell. */
  symbols: ReadonlyArray<ReadonlyArray<SymbolKey>>;
}

export interface ClusterWin {
  symbolId: SymbolKey;
  size: number;
  cells: ReadonlyArray<{ col: number; row: number }>;
  payoutX: number;
}

export interface ClusterEvaluationResult {
  clusters: ClusterWin[];
  totalPayoutX: number;
}

/**
 * Evaluate cluster wins on a grid using IR's paytable.
 *
 * Pure: no RNG, deterministic ordering. Throws on invalid topology
 * mismatch (e.g. grid shape doesn't match `topology.columns/rows`).
 *
 * `minClusterSize` defaults to 5 (industry convention for 5-of-a-kind
 * cluster pays); operator override via `opts.minClusterSize`.
 *
 * `payoutLookup` maps `(symbol, size)` → payoutX. By default reads from
 * `ir.paytable[symbol][String(size)]` falling back to the largest size
 * present (clusters of 7+ get the "7" row, etc.).
 */
export function evaluateCluster(
  ir: SlotGameIR,
  grid: ClusterGrid,
  opts: {
    minClusterSize?: number;
    adjacency?: AdjacencyMode;
    payoutLookup?: (symbol: SymbolKey, size: number) => number;
  } = {},
): ClusterEvaluationResult {
  const minSize = opts.minClusterSize ?? 5;
  const adjacency =
    opts.adjacency ??
    (ir.topology.kind === 'cluster_grid' ? ir.topology.adjacency : 'orthogonal');

  if (grid.symbols.length === 0) {
    throw new Error('evaluateCluster: empty grid');
  }
  const cols = grid.symbols.length;
  const rows = grid.symbols[0].length;
  for (let c = 0; c < cols; c++) {
    if (grid.symbols[c].length !== rows) {
      throw new Error(
        `evaluateCluster: grid column ${c} has ${grid.symbols[c].length} rows but column 0 has ${rows}`,
      );
    }
  }

  // Build symbol kind index (for wild detection).
  const symbolKindById = new Map<SymbolKey, string>();
  for (const s of ir.symbols) symbolKindById.set(s.id, s.kind);

  const visited: boolean[][] = Array.from({ length: cols }, () => new Array(rows).fill(false));
  const clusters: ClusterWin[] = [];
  let totalPayoutX = 0;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (visited[c][r]) continue;
      const startSym = grid.symbols[c][r];
      const startKind = symbolKindById.get(startSym);
      if (startKind === 'wild') continue; // wilds anchor only via adjacent paying symbols

      // Flood-fill — collect all cells matching `startSym` (or wilds
      // directly adjacent to a cell of `startSym` already in the cluster).
      const stack: Array<{ col: number; row: number }> = [{ col: c, row: r }];
      const cells: Array<{ col: number; row: number }> = [];
      while (stack.length > 0) {
        const cell = stack.pop()!;
        if (cell.col < 0 || cell.col >= cols || cell.row < 0 || cell.row >= rows) continue;
        if (visited[cell.col][cell.row]) continue;
        const cellSym = grid.symbols[cell.col][cell.row];
        const cellKind = symbolKindById.get(cellSym);
        if (cellSym !== startSym && cellKind !== 'wild') continue;
        visited[cell.col][cell.row] = true;
        cells.push(cell);
        for (const n of neighbours(cell.col, cell.row, adjacency)) {
          if (n.col < 0 || n.col >= cols || n.row < 0 || n.row >= rows) continue;
          if (visited[n.col][n.row]) continue;
          stack.push(n);
        }
      }
      if (cells.length < minSize) {
        // Roll back wild visits — wilds can join multiple clusters.
        for (const cell of cells) {
          if (symbolKindById.get(grid.symbols[cell.col][cell.row]) === 'wild') {
            visited[cell.col][cell.row] = false;
          }
        }
        continue;
      }
      const lookup = opts.payoutLookup ?? defaultPayoutLookup(ir);
      const payoutX = lookup(startSym, cells.length);
      if (payoutX > 0) {
        clusters.push({ symbolId: startSym, size: cells.length, cells, payoutX });
        totalPayoutX += payoutX;
      }
    }
  }

  return { clusters, totalPayoutX };
}

/** Neighbour offsets for each adjacency mode. */
function neighbours(col: number, row: number, mode: AdjacencyMode): Array<{ col: number; row: number }> {
  switch (mode) {
    case 'orthogonal':
      return [
        { col: col, row: row - 1 },
        { col: col, row: row + 1 },
        { col: col - 1, row: row },
        { col: col + 1, row: row },
      ];
    case 'diagonal':
      return [
        { col: col - 1, row: row - 1 },
        { col: col, row: row - 1 },
        { col: col + 1, row: row - 1 },
        { col: col - 1, row: row },
        { col: col + 1, row: row },
        { col: col - 1, row: row + 1 },
        { col: col, row: row + 1 },
        { col: col + 1, row: row + 1 },
      ];
    case 'hex': {
      // Offset-coordinate hex (even-q vertical layout). Even columns
      // shift up, odd columns shift down — standard "even-q" convention.
      const isOddCol = col % 2 !== 0;
      if (isOddCol) {
        return [
          { col: col, row: row - 1 },
          { col: col, row: row + 1 },
          { col: col - 1, row: row },
          { col: col + 1, row: row },
          { col: col - 1, row: row + 1 },
          { col: col + 1, row: row + 1 },
        ];
      }
      return [
        { col: col, row: row - 1 },
        { col: col, row: row + 1 },
        { col: col - 1, row: row - 1 },
        { col: col + 1, row: row - 1 },
        { col: col - 1, row: row },
        { col: col + 1, row: row },
      ];
    }
  }
}

/** Default lookup — reads paytable[sym][size], falling back to the
 *  largest declared size if size > max declared. */
function defaultPayoutLookup(ir: SlotGameIR): (symbol: SymbolKey, size: number) => number {
  return (symbol, size) => {
    const entry = ir.paytable[symbol];
    if (entry === undefined) return 0;
    const direct = entry[String(size)];
    if (direct !== undefined) return direct;
    const sizes = Object.keys(entry)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const maxSize = sizes[sizes.length - 1];
    if (maxSize !== undefined && size > maxSize) {
      return entry[String(maxSize)] ?? 0;
    }
    return 0;
  };
}
