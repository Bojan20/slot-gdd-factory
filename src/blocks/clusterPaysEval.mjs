/**
 * src/blocks/clusterPaysEval.mjs
 *
 * Wave M1 — Cluster Pays evaluator block.
 *
 * Flood-fill 4-connected (orthogonal) cluster detection for cluster-style
 * grids (typical: 6x5 / 7x7). Cluster ≥ minCluster of same symbol pays.
 * Wild substitutes for every regular. Industry baseline: cluster-pays grid
 * evaluator — 4-connected flood fill, min-cluster ≥ 5.
 *
 * GDD knobs:
 *   • minCluster: number — min connected cells to qualify (default 5)
 *   • paytable: [{ symbolId, bucketEdges: [5,8,10,12], pays: [n, n, n, n] }]
 *     — per-symbol bucket payouts (≥5 / ≥8 / ≥10 / ≥12 typical)
 *   • bucketEdges: number[] — global default edges
 *   • maxEvents: number
 *   • diagonal: boolean — false (4-connect) vs true (8-connect)
 */

export function defaultConfig() {
  return {
    enabled: false,
    minCluster: 5,
    bucketEdges: [5, 8, 10, 12, 15],
    paytable: null,        // null = use placeholder linear lookup
    maxEvents: 8,
    diagonal: false,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.clusterPaysEval || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.minCluster)) cfg.minCluster = clampInt(m.minCluster, 2, 30);
  if (Array.isArray(m.bucketEdges) && m.bucketEdges.every(n => Number.isFinite(n))) {
    cfg.bucketEdges = m.bucketEdges.slice().sort((a, b) => a - b).map(n => Math.floor(n));
  }
  if (m.paytable && typeof m.paytable === 'object') cfg.paytable = m.paytable;
  if (Number.isFinite(m.maxEvents)) cfg.maxEvents = clampInt(m.maxEvents, 1, 32);
  if (m.diagonal != null) cfg.diagonal = !!m.diagonal;

  // Auto-enable from features list OR cluster_pays grid kind
  const hasFeature = Array.isArray(model.features) && model.features.some(f => f.kind === 'cluster_pays');
  const isClusterGrid = model.topology && (
    model.topology.kind === 'cluster' ||
    model.topology.kind === 'megaclusters' ||
    model.topology.evaluation === 'cluster'
  );
  if (hasFeature || isClusterGrid) cfg.enabled = true;
  return cfg;
}

export function emitClusterPaysEvalRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* clusterPaysEval: disabled */`;
  const EDGES = JSON.stringify(cfg.bucketEdges);
  return `/* ─── cluster pays evaluator ──────────────────────────────────── */
const CLUSTER_MIN          = ${cfg.minCluster};
const CLUSTER_BUCKET_EDGES = ${EDGES};
const CLUSTER_MAX_EVENTS   = ${cfg.maxEvents};
const CLUSTER_DIAGONAL     = ${cfg.diagonal ? 'true' : 'false'};

function _clusterBucketFor(count) {
  /* Returns the highest bucket edge ≤ count. */
  let idx = -1;
  for (let i = 0; i < CLUSTER_BUCKET_EDGES.length; i++) {
    if (count >= CLUSTER_BUCKET_EDGES[i]) idx = i; else break;
  }
  return idx;
}

function detectClusterWins() {
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = window.REELS || 6;
  const ROWS  = window.ROWS  || 5;
  const cells = host.querySelectorAll('.cell');
  if (cells.length < REELS * ROWS) return [];

  /* Build grid matrix of symbols. */
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < REELS; c++) {
      const idx = r * REELS + c;
      row.push(((cells[idx] && cells[idx].textContent) || '').trim());
    }
    grid.push(row);
  }

  const reg = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
  const WILD = reg && reg.wild;
  const SCAT = reg && reg.scatter;

  const visited = new Array(ROWS * REELS).fill(false);
  const events = [];
  const neighbors = CLUSTER_DIAGONAL
    ? [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
    : [[-1,0],[1,0],[0,-1],[0,1]];

  /* For each non-wild, non-scatter regular symbol, flood-fill including wilds */
  function floodSym(symId) {
    const found = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        const idx = r * REELS + c;
        if (visited[idx]) continue;
        if (grid[r][c] !== symId && grid[r][c] !== WILD) continue;
        /* BFS */
        const stack = [[r, c]];
        const cluster = [];
        while (stack.length) {
          const [cr, cc] = stack.pop();
          const ci = cr * REELS + cc;
          if (visited[ci]) continue;
          if (cr < 0 || cr >= ROWS || cc < 0 || cc >= REELS) continue;
          if (grid[cr][cc] !== symId && grid[cr][cc] !== WILD) continue;
          visited[ci] = true;
          cluster.push({ r: cr, c: cc, idx: ci });
          for (const [dr, dc] of neighbors) stack.push([cr + dr, cc + dc]);
        }
        if (cluster.length >= CLUSTER_MIN) {
          /* must have at least one non-wild anchor */
          const hasAnchor = cluster.some(({ r: cr, c: cc }) => grid[cr][cc] === symId);
          if (hasAnchor) found.push({ symbol: symId, cells: cluster, count: cluster.length });
        } else {
          /* unmark for other syms */
          cluster.forEach(({ idx: ci }) => { visited[ci] = false; });
        }
      }
    }
    return found;
  }

  const regularPay = (reg && reg.regularPay) || [];
  for (const sym of regularPay) {
    if (sym === WILD || sym === SCAT) continue;
    visited.fill(false);
    const ev = floodSym(sym);
    ev.forEach(e => {
      const bucket = _clusterBucketFor(e.count);
      const tier = (reg && reg.tier && reg.tier[sym]) || 'LP';
      events.push({ ...e, bucket, tier });
    });
  }

  /* Sort by tier (HP > MP > LP > WILD), then by count desc */
  const tierRank = { HP: 0, MP: 1, LP: 2, WILD: 3 };
  events.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.count - a.count));
  return events.slice(0, CLUSTER_MAX_EVENTS);
}

if (typeof window !== 'undefined') {
  window.detectClusterWins = detectClusterWins;
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
