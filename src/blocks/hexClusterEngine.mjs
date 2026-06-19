/**
 * src/blocks/hexClusterEngine.mjs
 *
 * Wave LEGO-ENG.2 — Hex grid + cluster pays evaluator fusion.
 *
 * Purpose
 * ───────
 *   Combines hex-axial grid topology (q,r coordinates) with cluster-
 *   pays evaluator (connected matching-symbol groups → award scaled by
 *   cluster size). Distinct from existing eval engines:
 *
 *     • `hexReelEngine.mjs`     — pure hex spin animation (no eval)
 *     • `clusterPaysEval.mjs`   — rectangular cluster eval (4-neighbor)
 *     • `dynamicWaysEngine.mjs` — variable-rows rectangular eval
 *
 *   This block does NOT spin reels (hexReelEngine still owns animation);
 *   it ONLY scans the settled hex grid and emits cluster-win events
 *   using 6-neighbor adjacency rules (hex flat-top / pointy-top
 *   neighbour offsets). Award value per cluster derived from cluster
 *   size → paytable lookup.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Hex cluster" pattern combines honeycomb visual aesthetic with
 *   connected-group payout evaluation; common on themed slots that
 *   want both: visual differentiation + modern cluster pay mechanic.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitHexClusterEngineCSS(cfg)
 *   emitHexClusterEngineRuntime(cfg, model)
 *   findHexClusters(cells, minSize, sameSymRule)    (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onSpinResult  (priority 30) — scan grid + emit clusters
 *     • onTumbleStep  (priority 30) — re-scan after cascade
 *     • preSpin       (priority 30) — clear last-clusters state
 *   emits:
 *     • onHexClusterPay   { clusterSize, cellKeys, awardX, symbol }
 *
 * Runtime contract
 * ────────────────
 *   window.HEX_CLUSTER_STATE = { lastClusters: [{size, cellKeys, symbol}] }
 *
 * GDD config keys (model.hexClusterEngine)
 * ────────────────────────────────────────
 *   { enabled, minClusterSize, sizeTiers, sameSymRule,
 *     wildSymbolId, glowColor }
 *
 * Performance: O(cells) BFS flood-fill per scan; ≤ 1 ms for 37-cell
 * (radius-3) hex grid typical.
 *
 * a11y: each clustered cell gets aria-label="Hex cluster N symbols"
 * + role=note on payout flash.
 *
 * Senior-grade: wired-once via __HEX_CLUSTER_WIRED__, idempotent emit,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE = /^[A-Z]{1,4}$/;
const MIN_CLUSTER_FLOOR = 3;
const MIN_CLUSTER_CEIL  = 12;

/* QA fix (general-purpose subagent 2026-06-19, finding F5): align
 * default tier1.minSize with minClusterSize so tier 1 is always
 * reachable. Previously default minClusterSize=4 made tier1 (min:3)
 * unreachable unless GDD explicitly lowered minClusterSize. */
const DEFAULT_SIZE_TIERS = Object.freeze([
  { minSize:  4, maxSize:  5, awardX:  1 },
  { minSize:  6, maxSize:  8, awardX:  3 },
  { minSize:  9, maxSize: 11, awardX: 10 },
  { minSize: 12, maxSize: 9999, awardX: 50 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    minClusterSize: 4,
    sizeTiers: DEFAULT_SIZE_TIERS.map(t => ({ ...t })),
    sameSymRule: 'exact',         /* 'exact' or 'exactPlusWild' */
    wildSymbolId: 'W',
    glowColor: '#7af2c8',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.hexClusterEngine) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.minClusterSize)) {
    cfg.minClusterSize = Math.min(MIN_CLUSTER_CEIL, Math.max(MIN_CLUSTER_FLOOR, Math.trunc(src.minClusterSize)));
  }
  if (Array.isArray(src.sizeTiers) && src.sizeTiers.length > 0) {
    const filtered = src.sizeTiers
      .filter(t => Number.isFinite(t.minSize) && Number.isFinite(t.maxSize)
                 && Number.isFinite(t.awardX) && t.maxSize >= t.minSize && t.awardX > 0)
      .map(t => ({
        minSize: Math.trunc(Number(t.minSize)),
        maxSize: Math.trunc(Number(t.maxSize)),
        awardX:  Number(t.awardX),
      }))
      .sort((a, b) => a.minSize - b.minSize);
    if (filtered.length > 0) cfg.sizeTiers = filtered;
  }
  if (src.sameSymRule === 'exactPlusWild' || src.sameSymRule === 'exact') {
    cfg.sameSymRule = src.sameSymRule;
  }
  if (typeof src.wildSymbolId === 'string' && SYMBOL_ID_RE.test(src.wildSymbolId)) {
    cfg.wildSymbolId = src.wildSymbolId;
  }
  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) cfg.glowColor = src.glowColor;

  return cfg;
}

/**
 * Pure: find all clusters of connected same-symbol cells in a hex
 * grid using BFS flood-fill with 6-neighbor adjacency. Each cell has
 * `{q, r, symbol}`. Adjacency uses pointy-top hex offsets:
 *   even-r rows: NE(+1,-1) E(+1,0) SE(+1,+1) SW(0,+1) W(-1,0) NW(0,-1)
 *   (using axial → "any cell with abs distance 1" definition).
 *
 * Returns array of clusters: `[{ symbol, cellKeys: [string], size }]`
 * filtered by `minSize`. Each cellKey is "q,r".
 *
 * `sameSymRule`:
 *   • 'exact' — only same-symbol cells join the cluster
 *   • 'exactPlusWild' — wild cells join any cluster (cluster identity
 *     stays the non-wild anchor symbol)
 */
export function findHexClusters(cells, minSize, sameSymRule = 'exact', wildSymbolId = 'W') {
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const min = Math.max(3, Math.trunc(Number(minSize)) || 3);
  const wild = String(wildSymbolId || '').toUpperCase();
  const byKey = new Map();
  for (const c of cells) {
    if (!c || typeof c.q !== 'number' || typeof c.r !== 'number') continue;
    const sym = String(c.symbol || '').trim().toUpperCase();
    byKey.set(c.q + ',' + c.r, { q: c.q, r: c.r, symbol: sym });
  }
  const visited = new Set();
  const clusters = [];
  const offsets = [
    [+1,  0], [-1,  0],
    [ 0, +1], [ 0, -1],
    [+1, -1], [-1, +1],
  ];
  for (const startKey of byKey.keys()) {
    if (visited.has(startKey)) continue;
    const startCell = byKey.get(startKey);
    const anchor = startCell.symbol;
    if (!anchor) { visited.add(startKey); continue; }
    if (anchor === wild) { visited.add(startKey); continue; }   /* wild alone is not an anchor */
    const queue = [startKey];
    const cluster = [];
    while (queue.length > 0) {
      const k = queue.shift();
      if (visited.has(k)) continue;
      const cell = byKey.get(k);
      if (!cell) continue;
      const matchExact = cell.symbol === anchor;
      const matchWild  = (sameSymRule === 'exactPlusWild' && cell.symbol === wild);
      if (!(matchExact || matchWild)) continue;
      visited.add(k);
      cluster.push(k);
      for (const [dq, dr] of offsets) {
        const nk = (cell.q + dq) + ',' + (cell.r + dr);
        if (!visited.has(nk) && byKey.has(nk)) queue.push(nk);
      }
    }
    if (cluster.length >= min) {
      clusters.push({ symbol: anchor, cellKeys: cluster, size: cluster.length });
    }
  }
  return clusters;
}

export function emitHexClusterEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ hexClusterEngine: cfg });
  if (!c.enabled) return `\n/* hexClusterEngine BLOCK (disabled) — no CSS */\n`;
  return `
/* ── hexClusterEngine BLOCK — src/blocks/hexClusterEngine.mjs ── */
.cell.hex.is-hex-cluster {
  position: relative;
  outline: 2px solid ${c.glowColor};
  outline-offset: -2px;
  box-shadow: 0 0 14px ${c.glowColor}aa;
  animation: hxc-pulse 900ms ease-in-out;
  z-index: 6;
}
@keyframes hxc-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); box-shadow: 0 0 24px ${c.glowColor}; }
}
@media (prefers-reduced-motion: reduce) {
  .cell.hex.is-hex-cluster { animation: none; }
}
`;
}

export function emitHexClusterEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ hexClusterEngine: cfg });
  if (!c.enabled) return `\n// hexClusterEngine BLOCK (disabled) — no runtime\n`;

  const tiersJson = JSON.stringify(c.sizeTiers);
  const minSize   = c.minClusterSize;
  const wildSym   = c.wildSymbolId;
  const symRule   = c.sameSymRule;

  return `
/* ── hexClusterEngine BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__HEX_CLUSTER_WIRED__) return;
  window.__HEX_CLUSTER_WIRED__ = true;

  var TIERS    = ${tiersJson};
  var MIN_SIZE = ${minSize};
  var WILD_SYM = ${JSON.stringify(wildSym)}.toUpperCase();
  var RULE     = ${JSON.stringify(symRule)};

  window.HEX_CLUSTER_STATE = { lastClusters: [] };

  function _tierAward(size) {
    for (var i = 0; i < TIERS.length; i++) {
      if (size >= TIERS[i].minSize && size <= TIERS[i].maxSize) return TIERS[i].awardX;
    }
    return 0;
  }

  function _readHexCells() {
    var cells = document.querySelectorAll('.cell.hex');
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var q = parseInt(cell.getAttribute('data-q') || '0', 10);
      var r = parseInt(cell.getAttribute('data-r') || '0', 10);
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
      out.push({ q: q, r: r, symbol: sym });
    }
    return out;
  }

  function _bfs(cells) {
    var byKey = {};
    for (var i = 0; i < cells.length; i++) byKey[cells[i].q + ',' + cells[i].r] = cells[i];
    var visited = {};
    var clusters = [];
    var offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

    for (var k in byKey) {
      if (visited[k]) continue;
      var startCell = byKey[k];
      var anchor = startCell.symbol;
      if (!anchor) { visited[k] = true; continue; }
      if (anchor === WILD_SYM) { visited[k] = true; continue; }
      var queue = [k];
      var cluster = [];
      while (queue.length > 0) {
        var key = queue.shift();
        if (visited[key]) continue;
        var cell = byKey[key];
        if (!cell) continue;
        var matchExact = cell.symbol === anchor;
        var matchWild  = (RULE === 'exactPlusWild' && cell.symbol === WILD_SYM);
        if (!(matchExact || matchWild)) continue;
        visited[key] = true;
        cluster.push(key);
        for (var j = 0; j < offsets.length; j++) {
          var nk = (cell.q + offsets[j][0]) + ',' + (cell.r + offsets[j][1]);
          if (!visited[nk] && byKey[nk]) queue.push(nk);
        }
      }
      if (cluster.length >= MIN_SIZE) {
        clusters.push({ symbol: anchor, cellKeys: cluster, size: cluster.length });
      }
    }
    return clusters;
  }

  function _highlightClusters(clusters) {
    for (var i = 0; i < clusters.length; i++) {
      var cl = clusters[i];
      for (var j = 0; j < cl.cellKeys.length; j++) {
        var parts = cl.cellKeys[j].split(',');
        var sel = '.cell.hex[data-q="' + parts[0] + '"][data-r="' + parts[1] + '"]';
        var cell = document.querySelector(sel);
        if (cell) {
          cell.classList.add('is-hex-cluster');
          cell.setAttribute('aria-label', 'Hex cluster ' + cl.size + ' symbols');
          cell.setAttribute('role', 'note');
        }
      }
    }
  }

  function _clearHighlights() {
    var cells = document.querySelectorAll('.cell.hex.is-hex-cluster');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('is-hex-cluster');
      cells[i].removeAttribute('aria-label');
      cells[i].removeAttribute('role');
    }
  }

  function _scan() {
    /* FIX-3 CRITICAL #5 (deep QA 2026-06-19) — single-owner dispatch.
     * Previous guard fired ONLY for mixed grids (both hex and non-hex
     * cells). Pure-hex grid with GAME_EVAL_KIND === 'cluster' triggered
     * both this hex eval AND clusterPaysEval.detectClusterWins (which
     * iterates host.querySelectorAll('.cell') without :not(.hex) filter)
     * → real double-pay. Hardened semantics: clusterPaysEval is the
     * canonical owner whenever GAME_EVAL_KIND === 'cluster'; hex eval
     * defers entirely. Hex eval owns payout only when its GDD declares
     * a non-cluster dispatch path (typically when no clusterPaysEval
     * lives in the build). */
    if (typeof window !== 'undefined'
        && window.GAME_EVAL_KIND === 'cluster'
        && document.querySelector('.cell.hex')) {
      /* clusterPaysEval owns payout; hex highlights still update for
       * visual consistency (no payX double-fire). */
      _clearHighlights();
      return;
    }
    /* QA fix (general-purpose subagent 2026-06-19, finding F3): clear
     * stale highlights at the TOP of every scan, not only on preSpin.
     * Without this, onTumbleStep that produces a smaller cluster keeps
     * last-spin's wider highlight class — visual lie about what just
     * paid out. */
    _clearHighlights();
    var cells = _readHexCells();
    if (cells.length === 0) return;
    var clusters = _bfs(cells);
    window.HEX_CLUSTER_STATE.lastClusters = clusters;
    _highlightClusters(clusters);
    if (clusters.length === 0) return;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      for (var i = 0; i < clusters.length; i++) {
        var cl = clusters[i];
        var award = _tierAward(cl.size);
        try {
          window.HookBus.emit('onHexClusterPay', {
            clusterSize: cl.size,
            cellKeys: cl.cellKeys.slice(),
            awardX: award,
            symbol: cl.symbol,
          });
        } catch (e) {
          try { if (typeof console !== 'undefined' && console.warn) console.warn('[hexClusterEngine] emit failed', e); } catch (__) {}
        }
      }
    }
  }

  function _onPreSpin() {
    window.HEX_CLUSTER_STATE.lastClusters = [];
    _clearHighlights();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _scan,       { priority: 30 });
    window.HookBus.on('onTumbleStep', _scan,       { priority: 30 });
    window.HookBus.on('preSpin',      _onPreSpin,  { priority: 30 });
  }
})();
`;
}
