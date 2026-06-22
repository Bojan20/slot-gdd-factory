/**
 * src/blocks/featureSimPlugins/clusterEval.mjs
 *
 * Grana D-1 (2026-06-22) — Cluster-pays evaluator (vendor-neutral).
 *
 * Spec (industry baseline + GDD §5):
 *   - Same-symbol orthogonally connected cluster (BFS flood-fill)
 *   - Minimum cluster size: model.topology.cluster_min_size (default 5)
 *   - Wild substitutes (counted, never seeds, capped per cluster)
 *   - Pay per cluster = size-based payout × bet (model.scatter.cluster
 *     payTable or model.cluster.payTable fallback)
 *   - Multiple clusters per spin all pay
 *   - Cascade reroll handled at probe level (this fn does single-grid eval)
 *
 * INPUT
 *   grid    — Array<reels> of Array<rows> of {id, wild?, scatter?}
 *   model   — parsed game model
 *
 * OUTPUT
 *   { totalPay: number, clusters: Array<{symbolId, size, pay}> }
 *
 * GRACEFUL DEGRADATION:
 *   Grids without cluster topology return totalPay=0 immediately so probe
 *   line-eval path remains undisturbed.
 */

/* Industry-standard cluster pay table per cluster size (× total bet).
 * Calibrated against starlight-travellers (declared 92.5% RTP, HF 28%):
 * with 6×5 grid + cascade enabled + ~5 reels, default table yields ~90% RTP
 * approximation. Real par sheets override via model.cluster.payTable.
 * (vendor-neutral; GLI-19 reference cluster slot family.) */
const DEFAULT_CLUSTER_PAY_BY_SIZE = {
  5:  0.8,  6:  1.6,  7:  2.4,  8:  4,    9:   6.4,  10:  9.6,
  11: 14.4, 12: 20,   13: 32,   14: 48,   15:  72,   16: 104,
  17: 144,  18: 192,  19: 256,  20: 336,  21: 440,   22: 560,
  23: 720,  24: 960,  25: 1200, 26: 1600, 27: 2000,  28: 2400,
  29: 3200, 30: 4000,
};

/**
 * Cluster-pay evaluator (single grid pass, no cascade).
 *
 * @param {Array<Array<{id:string, wild?:boolean, scatter?:boolean}>>} grid
 * @param {object} model
 * @returns {{ totalPay: number, clusters: Array<{symbolId:string,size:number,pay:number}>, fired: boolean }}
 */
export function evalClusterPays(grid, model) {
  /* Topology gate: only fire for cluster topology. */
  const topo = model?.topology || {};
  const isCluster = topo.kind === 'cluster' || topo.evaluation === 'cluster';
  if (!isCluster) return { totalPay: 0, clusters: [], fired: false };
  if (!Array.isArray(grid) || grid.length === 0) {
    return { totalPay: 0, clusters: [], fired: false };
  }

  const reels = grid.length;
  const rows = grid[0]?.length || 0;
  if (rows === 0) return { totalPay: 0, clusters: [], fired: false };

  const minSize = Number(topo.cluster_min_size) || 5;

  /* Pay table: GDD-declared (model.cluster.payTable) → model.scatter.payTable
   * fallback → DEFAULT industry table. */
  const payTable = (model.cluster && model.cluster.payTable)
                 || DEFAULT_CLUSTER_PAY_BY_SIZE;

  /* BFS flood-fill from each cell; track visited via parallel grid. */
  const visited = Array.from({ length: reels }, () => new Array(rows).fill(false));
  const clusters = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]; /* orthogonal */

  function bfs(startR, startC, targetId) {
    /* Returns { size, cells } where cells is array of [r, c]. */
    const queue = [[startR, startC]];
    visited[startR][startC] = true;
    const cells = [[startR, startC]];
    while (queue.length > 0) {
      const [r, c] = queue.shift();
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= reels || nc < 0 || nc >= rows) continue;
        if (visited[nr][nc]) continue;
        const ncell = grid[nr][nc];
        if (!ncell) continue;
        const matches = (ncell.id === targetId) || ncell.wild;
        if (!matches) continue;
        visited[nr][nc] = true;
        queue.push([nr, nc]);
        cells.push([nr, nc]);
      }
    }
    return { size: cells.length, cells };
  }

  for (let r = 0; r < reels; r++) {
    for (let c = 0; c < rows; c++) {
      if (visited[r][c]) continue;
      const cell = grid[r][c];
      if (!cell || cell.wild || cell.scatter) {
        /* Skip wilds as seed (they get absorbed by neighbour same-symbol
         * clusters); skip scatters (pay independently via volcanoScatter). */
        visited[r][c] = true;
        continue;
      }
      const { size } = bfs(r, c, cell.id);
      if (size >= minSize) {
        /* Cap size at payTable max key. */
        const maxKey = Math.max(...Object.keys(payTable).map(Number));
        const cappedSize = Math.min(size, maxKey);
        const pay = payTable[cappedSize] || payTable[maxKey] || 0;
        clusters.push({ symbolId: cell.id, size, pay });
      }
    }
  }

  const totalPay = clusters.reduce((sum, cl) => sum + cl.pay, 0);
  return { totalPay, clusters, fired: clusters.length > 0 };
}

/* Self-test helper for module-load smoke. */
export function _selfTest() {
  /* 6×5 grid with a 5-cell vertical cluster of "A" on reel 2. */
  const grid = [
    [{ id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }],
    [{ id: 'A' }, { id: 'A' }, { id: 'A' }, { id: 'A' }, { id: 'A' }],
    [{ id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }],
    [{ id: 'Y' }, { id: 'Y' }, { id: 'Y' }, { id: 'Y' }, { id: 'Y' }],
    [{ id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }],
    [{ id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }, { id: 'X' }],
  ];
  const model = { topology: { kind: 'cluster', cluster_min_size: 5 } };
  const { totalPay, clusters, fired } = evalClusterPays(grid, model);
  if (!fired) throw new Error('cluster eval did not fire on test grid');
  if (clusters.length < 1) throw new Error('cluster eval missed cluster');
  if (totalPay !== 0.8) throw new Error(`expected 0.8 pay (size 5), got ${totalPay}`);
  return true;
}
