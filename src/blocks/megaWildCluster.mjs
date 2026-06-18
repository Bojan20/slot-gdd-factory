/**
 * src/blocks/megaWildCluster.mjs
 *
 * Wave LEGO-MWC — Mega Wild Cluster (oversized wild block).
 *
 * Purpose
 * ───────
 *   Industry-typical "colossal wild" / "oversized wild block" pattern:
 *   instead of a single 1×1 wild cell, the game may land an N×N wild
 *   block (typically 2×2 or 3×3) that occupies multiple grid cells
 *   simultaneously. Every cell inside that block behaves as wild for
 *   all win-evaluation passes. Distinct from:
 *     • fsExpansionWilds   (per-reel column-wide expansion, not N×N)
 *     • holdAndWinLockedOrb (sticky orb cells, not contiguous block)
 *     • multiplierOrb       (per-cell numeric multiplier)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "oversized wild block" Free Spins / base accent — a contiguous
 *   N×N tile drops onto the reels, lit with a glow + pulse, and behaves
 *   as one cohesive wild surface for the spin's evaluation.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitMegaWildClusterCSS(cfg)
 *   emitMegaWildClusterMarkup(cfg)
 *   emitMegaWildClusterRuntime(cfg)
 *   pickValidAnchor(gridReels, gridRows, blockSize, rng)   (pure helper)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin         (priority 30) — clears prior cluster paint
 *     • onSpinResult    (priority 30) — base-mode scan + paint (if appliesIn ∈ base/both)
 *     • onFsSpinResult  (priority 30) — FS-mode scan + paint   (if appliesIn ∈ fs/both)
 *     • onFsEnd         (priority 30) — clears cluster state on FS exit
 *   emits:
 *     • onMegaWildClusterLanded   { anchor: {reelIdx,rowIdx}, size, cellCount }
 *     • onMegaWildClusterCleared  {}
 *
 * Runtime contract
 * ────────────────
 *   window.MWC_STATE = { active: boolean, topLeft: {reelIdx,rowIdx}|null, size: number }
 *
 * GDD config keys (model.megaWildCluster)
 * ───────────────────────────────────────
 *   { enabled, wildSymbol, triggerSymbol, blockSize: 2|3|4,
 *     appliesIn: 'base'|'fs'|'both',
 *     glowColor, pulseMs, cornerRadiusPx }
 *
 * Performance budget: ≤ 0.4 ms per spin settle on 5×4 grid; one
 * listener per event (wired-once via window.__MWC_WIRED__).
 *
 * a11y: every painted mega-wild cell carries aria-label="Mega wild" so
 * screen readers announce the oversized block; prefers-reduced-motion
 * disables the pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. Math hooks
 * limited to emitting landed/cleared events; engine remains source of
 * truth for win evaluation.
 */

const BLOCK_SIZES   = Object.freeze([2, 3, 4]);
const APPLIES_IN    = Object.freeze(['base', 'fs', 'both']);
const PULSE_MIN_MS  = 200;
const PULSE_MAX_MS  = 3000;
const CORNER_MIN_PX = 0;
const CORNER_MAX_PX = 32;

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_RE     = /^[A-Za-z0-9_]{1,8}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbol: 'W',
    triggerSymbol: 'MW',
    blockSize: 2,
    appliesIn: 'fs',
    glowColor: '#ff4081',
    pulseMs: 900,
    cornerRadiusPx: 12,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.megaWildCluster) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (typeof src.wildSymbol === 'string' && SYMBOL_RE.test(src.wildSymbol)) {
    cfg.wildSymbol = src.wildSymbol;
  }
  if (typeof src.triggerSymbol === 'string' && SYMBOL_RE.test(src.triggerSymbol)) {
    cfg.triggerSymbol = src.triggerSymbol;
  }
  if (Number.isFinite(src.blockSize) && BLOCK_SIZES.includes(Math.trunc(src.blockSize))) {
    cfg.blockSize = Math.trunc(src.blockSize);
  }
  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }
  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) {
    cfg.glowColor = src.glowColor;
  }
  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }
  if (Number.isFinite(src.cornerRadiusPx)) {
    cfg.cornerRadiusPx = clampInt(src.cornerRadiusPx, CORNER_MIN_PX, CORNER_MAX_PX);
  }

  return cfg;
}

/**
 * Pure anchor picker — returns a valid top-left {reelIdx,rowIdx} such
 * that an N×N block fits inside the grid, or null when the block does
 * not fit. RNG is injectable so tests can use a deterministic seed.
 *
 * @param {number} gridReels   number of reel columns (width)
 * @param {number} gridRows    number of visible rows  (height)
 * @param {number} blockSize   N for the N×N block
 * @param {() => number} rng   RNG returning a uniform value in [0,1)
 * @returns {{reelIdx:number,rowIdx:number}|null}
 */
export function pickValidAnchor(gridReels, gridRows, blockSize, rng = Math.random) {
  const reels = Math.trunc(gridReels);
  const rows  = Math.trunc(gridRows);
  const size  = Math.trunc(blockSize);
  if (!Number.isFinite(reels) || !Number.isFinite(rows) || !Number.isFinite(size)) return null;
  if (reels < size || rows < size || size < 1) return null;

  const maxReelIdx = reels - size; /* inclusive */
  const maxRowIdx  = rows  - size; /* inclusive */
  const reelIdx = Math.min(maxReelIdx, Math.floor(rng() * (maxReelIdx + 1)));
  const rowIdx  = Math.min(maxRowIdx,  Math.floor(rng() * (maxRowIdx  + 1)));
  return { reelIdx, rowIdx };
}

export function emitMegaWildClusterCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ megaWildCluster: cfg });
  if (!c.enabled) return `\n/* megaWildCluster BLOCK (disabled) — no CSS */\n`;
  return `
/* ── megaWildCluster BLOCK — src/blocks/megaWildCluster.mjs ── */
.is-mega-wild-cell {
  position: relative;
  background: radial-gradient(circle at 50% 50%, ${c.glowColor} 0%, rgba(0,0,0,0.4) 80%);
  color: #fff;
  font-weight: 900;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 12px ${c.glowColor};
  border-radius: ${c.cornerRadiusPx}px;
  box-shadow: 0 0 18px ${c.glowColor}, inset 0 0 12px rgba(255,255,255,0.18);
  z-index: 40;
  animation: mwc-pulse ${c.pulseMs}ms ease-in-out infinite;
}
.is-mega-wild-cell[data-mega-wild-part]::before {
  content: '';
  position: absolute;
  inset: 4px;
  border: 2px solid ${c.glowColor};
  border-radius: ${Math.max(0, c.cornerRadiusPx - 2)}px;
  pointer-events: none;
  opacity: 0.85;
}
@keyframes mwc-pulse {
  0%   { box-shadow: 0 0 12px ${c.glowColor}, inset 0 0 8px  rgba(255,255,255,0.12); }
  50%  { box-shadow: 0 0 28px ${c.glowColor}, inset 0 0 16px rgba(255,255,255,0.28); }
  100% { box-shadow: 0 0 12px ${c.glowColor}, inset 0 0 8px  rgba(255,255,255,0.12); }
}
@media (prefers-reduced-motion: reduce) {
  .is-mega-wild-cell { animation: none; }
}
`;
}

export function emitMegaWildClusterMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ megaWildCluster: cfg });
  if (!c.enabled) return `\n<!-- megaWildCluster BLOCK (disabled) -->\n`;
  /* No additional DOM nodes required — block decorates existing grid cells. */
  return `
<!-- megaWildCluster BLOCK — decorates existing grid cells in-place -->
<div class="mwc-overlay-marker" aria-hidden="true" data-mwc-block-size="${c.blockSize}"></div>
`;
}

export function emitMegaWildClusterRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ megaWildCluster: cfg });
  if (!c.enabled) return `\n// megaWildCluster BLOCK (disabled) — no runtime\n`;

  return `
/* ── megaWildCluster BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MWC_WIRED__) return;
  window.__MWC_WIRED__ = true;

  var WILD_SYMBOL    = ${JSON.stringify(c.wildSymbol)};
  var TRIGGER_SYMBOL = ${JSON.stringify(c.triggerSymbol)};
  var BLOCK_SIZE     = ${c.blockSize};
  var APPLIES_IN     = ${JSON.stringify(c.appliesIn)};

  window.MWC_STATE = {
    active: false,
    topLeft: null,
    size: BLOCK_SIZE,
  };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _isHwActive() {
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    return false;
  }

  function _isFsActive() {
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _gridDims() {
    /* Probe DOM for the maximum data-reel + data-row to derive grid size. */
    var maxReel = -1, maxRow = -1;
    var cells = document.querySelectorAll('[data-reel][data-row]');
    cells.forEach(function(el) {
      var r = parseInt(el.getAttribute('data-reel'), 10);
      var w = parseInt(el.getAttribute('data-row'),  10);
      if (Number.isFinite(r) && r > maxReel) maxReel = r;
      if (Number.isFinite(w) && w > maxRow)  maxRow  = w;
    });
    if (maxReel < 0 || maxRow < 0) return null;
    return { reels: maxReel + 1, rows: maxRow + 1 };
  }

  function _pickAnchor(reels, rows) {
    if (reels < BLOCK_SIZE || rows < BLOCK_SIZE) return null;
    var maxReelIdx = reels - BLOCK_SIZE;
    var maxRowIdx  = rows  - BLOCK_SIZE;
    var reelIdx = Math.min(maxReelIdx, Math.floor(_rng() * (maxReelIdx + 1)));
    var rowIdx  = Math.min(maxRowIdx,  Math.floor(_rng() * (maxRowIdx  + 1)));
    return { reelIdx: reelIdx, rowIdx: rowIdx };
  }

  function _scanGridForTrigger(grid) {
    if (!Array.isArray(grid)) return false;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      if (!Array.isArray(row)) continue;
      for (var col = 0; col < row.length; col++) {
        var cell = row[col];
        var sym  = (cell && typeof cell === 'object') ? (cell.sym || cell.symbol) : cell;
        if (sym === TRIGGER_SYMBOL) return true;
      }
    }
    return false;
  }

  function _isForced() {
    return window.__FORCE_MEGA_WILD__ === true;
  }

  function _paintCluster(anchor) {
    var painted = 0;
    var dims = BLOCK_SIZE + 'x' + BLOCK_SIZE;
    for (var dr = 0; dr < BLOCK_SIZE; dr++) {
      for (var dc = 0; dc < BLOCK_SIZE; dc++) {
        var reelIdx = anchor.reelIdx + dr;
        var rowIdx  = anchor.rowIdx  + dc;
        var sel = '[data-reel="' + reelIdx + '"][data-row="' + rowIdx + '"]';
        var el  = document.querySelector(sel);
        if (!el) continue;
        el.classList.add('is-mega-wild-cell');
        el.setAttribute('data-mega-wild-part', dims);
        el.setAttribute('aria-label', 'Mega wild');
        el.textContent = WILD_SYMBOL;
        painted++;
      }
    }
    return painted;
  }

  function _clearCluster() {
    var painted = document.querySelectorAll('.is-mega-wild-cell');
    painted.forEach(function(el) {
      el.classList.remove('is-mega-wild-cell');
      el.removeAttribute('data-mega-wild-part');
      el.removeAttribute('aria-label');
    });
    var had = window.MWC_STATE.active;
    window.MWC_STATE.active  = false;
    window.MWC_STATE.topLeft = null;
    /* QA sweep (2026-06-18): clear the dev force flag so it does not
     * stick across spins. Mirrors the Boki rule "force/dev dugmad
     * moraju OKRENUTI SPIN, ne preskočiti engine" — force is one-shot,
     * consumed at the next clean state. */
    try { window.__FORCE_MEGA_WILD__ = false; } catch (_) {}
    if (had && window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onMegaWildClusterCleared', {}); } catch (_) {}
    }
  }

  function _maybeLand(payload, mode) {
    if (_isHwActive()) return;
    if (mode === 'base' && (APPLIES_IN !== 'base' && APPLIES_IN !== 'both')) return;
    if (mode === 'fs'   && (APPLIES_IN !== 'fs'   && APPLIES_IN !== 'both')) return;
    if (mode === 'fs'   && !_isFsActive()) return;

    var grid = payload && (payload.grid || payload.board || payload.reels);
    var triggered = _isForced() || _scanGridForTrigger(grid);
    if (!triggered) return;

    var dims = _gridDims();
    if (!dims) return;
    var anchor = _pickAnchor(dims.reels, dims.rows);
    if (!anchor) return;

    var cellCount = _paintCluster(anchor);
    if (cellCount <= 0) return;

    window.MWC_STATE.active  = true;
    window.MWC_STATE.topLeft = anchor;
    window.MWC_STATE.size    = BLOCK_SIZE;

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onMegaWildClusterLanded', {
          anchor: anchor,
          size: BLOCK_SIZE,
          cellCount: cellCount,
        });
      } catch (_) {}
    }
  }

  function _onPreSpin()       { _clearCluster(); }
  function _onSpinResult(p)   { _maybeLand(p, 'base'); }
  function _onFsSpinResult(p) { _maybeLand(p, 'fs'); }
  function _onFsEnd()         { _clearCluster(); }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',        _onPreSpin,       { priority: 30 });
    window.HookBus.on('onSpinResult',   _onSpinResult,    { priority: 30 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult,  { priority: 30 });
    window.HookBus.on('onFsEnd',        _onFsEnd,         { priority: 30 });
  }
})();
`;
}
