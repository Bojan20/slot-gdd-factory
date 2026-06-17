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
 *   • paytable: [{ symbolId, bucketEdges: [5,8,10,12,15], pays: [n,n,n,n,n] }]
 *     — per-symbol bucket payouts (≥5 / ≥8 / ≥10 / ≥12 / ≥15 typical)
 *   • bucketEdges: number[] — global default edges (aligned to bucketMultipliers)
 *   • bucketMultipliers: number[] — per-bucket payout multipliers (aligned to bucketEdges)
 *   • tierMultipliers: { HP, MP, LP, WILD } — per-tier payout multipliers
 *   • payCap: number — payX cap per cluster (pre-bet, in multiplier units)
 *   • defaultBet: number — fallback when window.__SLOT_BET__ is missing
 *   • maxEvents: number
 *   • diagonal: boolean — false (4-connect) vs true (8-connect)
 *
 * Budget: ≤ 1.5 ms on 7×7 grid, ≤ 16 symbols, diagonal=true.
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    minCluster: 5,
    bucketEdges: [5, 8, 10, 12, 15],
    bucketMultipliers: [1, 2, 3, 5, 8],
    tierMultipliers: { HP: 1.0, MP: 0.5, LP: 0.25, WILD: 2.0 },
    payCap: 100,
    defaultBet: 1,
    paytable: null,        // null = use placeholder linear lookup
    maxEvents: 8,
    diagonal: false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.clusterPaysEval || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.minCluster)) cfg.minCluster = clampInt(m.minCluster, 2, 30);
  if (Array.isArray(m.bucketEdges) && m.bucketEdges.every(n => Number.isFinite(n))) {
    cfg.bucketEdges = m.bucketEdges.slice().sort((a, b) => a - b).map(n => Math.floor(n));
  }
  if (m.paytable && typeof m.paytable === 'object') cfg.paytable = m.paytable;
  if (Array.isArray(m.bucketMultipliers) && m.bucketMultipliers.every(n => Number.isFinite(n) && n >= 0)) {
    cfg.bucketMultipliers = m.bucketMultipliers.slice();
  }
  if (m.tierMultipliers && typeof m.tierMultipliers === 'object') {
    /* Group AA agent HIGH finding: shallow spread from defaultConfig() shares
       the SAME nested tierMultipliers object across calls. Mutating it pollutes
       the frozen default for next resolveConfig caller. Deep-clone before write. */
    cfg.tierMultipliers = { ...cfg.tierMultipliers };
    for (const k of ['HP', 'MP', 'LP', 'WILD']) {
      if (Number.isFinite(m.tierMultipliers[k]) && m.tierMultipliers[k] >= 0) {
        cfg.tierMultipliers[k] = m.tierMultipliers[k];
      }
    }
  }
  if (Number.isFinite(m.payCap) && m.payCap > 0) cfg.payCap = m.payCap;
  if (Number.isFinite(m.defaultBet) && m.defaultBet > 0) cfg.defaultBet = m.defaultBet;
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
  /* Fable audit (critical): cfg.paytable was accepted in resolveConfig
   * but never read by the runtime — every cluster-mode GDD silently fell
   * back to the placeholder linear lookup. Bake the GDD paytable into a
   * runtime constant so detectClusterWins consults the right curve. */
  const PAYTABLE = JSON.stringify(cfg.paytable || null);
  const BUCKET_MULTS_JSON = JSON.stringify(cfg.bucketMultipliers);
  const TIER_MULTS_JSON   = JSON.stringify(cfg.tierMultipliers);
  return `/* ─── cluster pays evaluator ──────────────────────────────────── */
/* Budget: ≤ 1.5 ms on 7×7 grid, ≤ 16 symbols, diagonal=true. */
const CLUSTER_MIN          = ${cfg.minCluster};
const CLUSTER_BUCKET_EDGES = ${EDGES};
const CLUSTER_BUCKET_MULTS = ${BUCKET_MULTS_JSON};
const CLUSTER_TIER_MULTS   = ${TIER_MULTS_JSON};
const CLUSTER_PAY_CAP      = ${cfg.payCap};
const CLUSTER_DEFAULT_BET  = ${cfg.defaultBet};
const CLUSTER_MAX_EVENTS   = ${cfg.maxEvents};
const CLUSTER_DIAGONAL     = ${cfg.diagonal ? 'true' : 'false'};
const CLUSTER_PAYTABLE     = ${PAYTABLE};

function _clusterPayLookup(symbolId, count) {
  if (!CLUSTER_PAYTABLE || !Array.isArray(CLUSTER_PAYTABLE)) return null;
  const row = CLUSTER_PAYTABLE.find(p => p && p.symbolId === symbolId);
  if (!row || !Array.isArray(row.bucketEdges) || !Array.isArray(row.pays)) return null;
  let bucketIdx = -1;
  for (let i = 0; i < row.bucketEdges.length; i++) {
    if (count >= row.bucketEdges[i]) bucketIdx = i; else break;
  }
  if (bucketIdx < 0 || bucketIdx >= row.pays.length) return null;
  return row.pays[bucketIdx];
}

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
      /* 2026-06-10 (Boki bug "nema win prezentacije") — emit payX so
         applyWinHighlight's totalAward > 0 gate fires and
         onWinPresentationStart actually emits. Cluster-pays payout:
         tier_mult × count × bucket_multiplier × bet (capped). Without
         this every cluster-mode game silently treated wins as
         zero-paying and skipped the presentation. */
      /* Fable audit (critical): _clusterBucketFor returns a numeric
       * index, so the previous string compare to 'BIG'/'MED' always
       * collapsed bucketMult to 1 and flattened the documented
       * ≥5/≥8/≥10/≥12/≥15 payout curve. Look up multipliers by index
       * from cfg-emitted tables instead — no magic numbers. */
      const tierMult = (CLUSTER_TIER_MULTS && Number.isFinite(CLUSTER_TIER_MULTS[tier]))
        ? CLUSTER_TIER_MULTS[tier]
        : ((CLUSTER_TIER_MULTS && Number.isFinite(CLUSTER_TIER_MULTS.LP)) ? CLUSTER_TIER_MULTS.LP : 0);
      const bucketMult = (bucket >= 0 && bucket < CLUSTER_BUCKET_MULTS.length)
        ? CLUSTER_BUCKET_MULTS[bucket]
        : (CLUSTER_BUCKET_MULTS[0] != null ? CLUSTER_BUCKET_MULTS[0] : 1);
      const __bet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : CLUSTER_DEFAULT_BET;
      /* Fable audit (critical): consult the GDD paytable first; fall
       * back to the placeholder formula only when no row matches. The
       * GDD paytable is the regulator-vetted source of truth — silently
       * ignoring it produced math drift on every cluster-mode game. */
      const gddPay = _clusterPayLookup(sym, e.count);
      const payX = gddPay != null
        ? gddPay * __bet
        : Math.min(CLUSTER_PAY_CAP, tierMult * e.count * bucketMult) * __bet;
      events.push({ ...e, bucket, tier, payX, matchLength: e.count });
    });
  }

  /* Sort by tier (HP > MP > LP > WILD), then by count desc */
  const tierRank = { HP: 0, MP: 1, LP: 2, WILD: 3 };
  events.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.count - a.count));
  return events.slice(0, CLUSTER_MAX_EVENTS);
}

if (typeof window !== 'undefined') {
  window.detectClusterWins = detectClusterWins;
  /* Sole emitter of 'clusterPays:evaluated' — downstream presentation
   * blocks subscribe here. Subscribed to canonical 'reels:stopped'
   * lifecycle hook so callers cannot invoke detection at wrong phase. */
  if (window.HookBus && typeof window.HookBus.on === 'function') {
    /* F3 priority 80 — payout evaluator class. Runs AFTER state-mutators
       (priority 100) but BEFORE presenters/decorators/telemetry so evaluated
       wins are visible to all downstream listeners. */
    window.HookBus.on('reels:stopped', () => {
      const __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      const wins = detectClusterWins();
      if (typeof performance !== 'undefined' && performance.now && (performance.now() - __t0) > 1.5) {
        try { console.warn('[clusterPaysEval] detectClusterWins exceeded 1.5 ms budget'); } catch (e) {}
      }
      if (typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('clusterPays:evaluated', { wins });
      }
    }, { priority: 80 });
  }
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
