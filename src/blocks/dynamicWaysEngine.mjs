/**
 * src/blocks/dynamicWaysEngine.mjs
 *
 * Wave LEGO-DWE — Dynamic Ways Engine (variable rows per reel).
 *
 * Purpose
 * ───────
 *   Industry-reference "variable rows per reel" ways system. Each spin
 *   the engine rolls a row count for every reel column (within configured
 *   min/max bounds) and computes the total winning ways as the product
 *   of those per-reel row counts. A HUD chip paints the current total
 *   so the player always sees the live ways count. Distinct from:
 *     • clusterPaysEval         (cluster topology, no row/column ways)
 *     • infinityReels           (extends reel COUNT, not rows per reel)
 *     • holdAndWin              (fixed grid, locked symbols, no ways reshape)
 *     • walkingWildStepper      (single reel-bound wild, fixed grid)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "variable rows per reel pattern" — instead of a fixed
 *   rectangular grid with a constant ways count, every spin builds a
 *   ragged grid where reel heights are drawn from a uniform or weighted
 *   distribution. Total ways = product of row counts across all reels;
 *   for a 6-reel 2..7 rows uniform draw the maximum reachable count is
 *   2*3*4*5*6*7 = 5040 or 7*7*7*7*7*7 = 117649 depending on bound mix.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitDynamicWaysEngineCSS(cfg)
 *   emitDynamicWaysEngineMarkup(cfg)
 *   emitDynamicWaysEngineRuntime(cfg)
 *   rollRowsPerReel(reelCount, minRows, maxRows, rng, distribution, weights)  (pure helper, exported for tests)
 *   computeWaysCount(rowsPerReel)                                              (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin        (priority 25) — rolls rowsPerReel for the upcoming spin
 *     • onSpinResult   (priority 25) — computes total ways, paints HUD, emits onWaysReshaped
 *     • onFsTrigger    (priority 25) — emits onWaysResetForRound for the FS entry
 *     • onFsEnd        (priority 25) — emits onWaysResetForRound for FS exit
 *   emits:
 *     • onWaysReshaped       { rowsPerReel, totalWays }
 *     • onWaysResetForRound  {}
 *
 * Runtime contract
 * ────────────────
 *   window.__WAYS_COUNT__       = number (current total ways)
 *   window.__WAYS_ROWS__        = number[] (rowsPerReel for current spin)
 *   window.__DWE_WIRED__        = boolean (wired-once sentinel)
 *
 * GDD config keys (model.dynamicWaysEngine)
 * ─────────────────────────────────────────
 *   { enabled, reelCount: 3..8, minRows: 2..4, maxRows: 4..12,
 *     rowDistribution: 'uniform'|'weighted', weights: number[]|null,
 *     bumpInFs: boolean, bumpAmount: 1..3,
 *     showHud: boolean, hudPosition: 'top'|'topRight'|'topLeft'|'bottom',
 *     hudColor: hex, fontSizePx: 12..32, pulseMs: 200..2000 }
 *
 * Guards
 * ──────
 *   • HW guard — skipped when window.HW_STATE.active is true (Hold &
 *     Win locks the grid to fixed positions, ways reshape is invalid).
 *   • Grid-kind guard — only runs on rectangular grids. Wheel, crash,
 *     plinko, hex, slingo, cluster topologies bypass the engine.
 *
 * Performance budget: ≤ 0.2 ms per spin settle on 6-reel grid; 1
 * listener per event (wired-once via window.__DWE_WIRED__).
 *
 * a11y: HUD chip carries role=status + aria-live=polite so screen
 * readers announce "5040 ways" each spin; prefers-reduced-motion kills
 * the pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * decisions beyond emitting the rolled row layout to HookBus.
 */

const HUD_POSITIONS      = Object.freeze(['top', 'topRight', 'topLeft', 'bottom']);
const ROW_DISTRIBUTIONS   = Object.freeze(['uniform', 'weighted']);

const REEL_COUNT_MIN     = 3;
const REEL_COUNT_MAX     = 8;
const MIN_ROWS_MIN       = 2;
const MIN_ROWS_MAX       = 4;
const MAX_ROWS_MIN       = 4;
const MAX_ROWS_MAX       = 12;
const BUMP_AMOUNT_MIN    = 1;
const BUMP_AMOUNT_MAX    = 3;
const FONT_SIZE_MIN      = 12;
const FONT_SIZE_MAX      = 32;
const PULSE_MIN_MS       = 200;
const PULSE_MAX_MS       = 2000;

const HEX_COLOR_RE       = /^#[0-9a-fA-F]{3,8}$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    reelCount: 6,
    minRows: 2,
    maxRows: 7,
    rowDistribution: 'uniform',
    weights: null,
    bumpInFs: true,
    bumpAmount: 1,
    showHud: true,
    hudPosition: 'topRight',
    hudColor: '#88ddff',
    fontSizePx: 16,
    pulseMs: 500,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.dynamicWaysEngine) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.reelCount)) {
    cfg.reelCount = clampInt(src.reelCount, REEL_COUNT_MIN, REEL_COUNT_MAX);
  }
  if (Number.isFinite(src.minRows)) {
    cfg.minRows = clampInt(src.minRows, MIN_ROWS_MIN, MIN_ROWS_MAX);
  }
  if (Number.isFinite(src.maxRows)) {
    cfg.maxRows = clampInt(src.maxRows, MAX_ROWS_MIN, MAX_ROWS_MAX);
  }

  if (typeof src.rowDistribution === 'string' && ROW_DISTRIBUTIONS.includes(src.rowDistribution)) {
    cfg.rowDistribution = src.rowDistribution;
  }

  if (Array.isArray(src.weights) && src.weights.length > 0) {
    const sanitized = src.weights
      .map(w => Number(w))
      .filter(w => Number.isFinite(w) && w >= 0);
    if (sanitized.length > 0 && sanitized.some(w => w > 0)) {
      cfg.weights = sanitized;
    }
  }

  if (typeof src.bumpInFs === 'boolean') cfg.bumpInFs = src.bumpInFs;
  if (Number.isFinite(src.bumpAmount)) {
    cfg.bumpAmount = clampInt(src.bumpAmount, BUMP_AMOUNT_MIN, BUMP_AMOUNT_MAX);
  }

  if (typeof src.showHud === 'boolean') cfg.showHud = src.showHud;
  if (typeof src.hudPosition === 'string' && HUD_POSITIONS.includes(src.hudPosition)) {
    cfg.hudPosition = src.hudPosition;
  }
  if (typeof src.hudColor === 'string' && HEX_COLOR_RE.test(src.hudColor)) {
    cfg.hudColor = src.hudColor;
  }
  if (Number.isFinite(src.fontSizePx)) {
    cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }
  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }

  /* Senior-grade invariant: minRows must never exceed maxRows. If a
   * GDD author misconfigures the bounds the engine silently lifts the
   * cap so the uniform draw stays well-formed and rollRowsPerReel
   * never throws on an empty integer interval. */
  if (cfg.minRows > cfg.maxRows) cfg.maxRows = cfg.minRows;

  return cfg;
}

/**
 * Pure helper: roll a row count for each reel column.
 *
 * Returns an int[] of length `reelCount` where every entry is in the
 * closed interval [minRows, maxRows]. Uniform distribution samples
 * `floor(rng() * span) + minRows` so the cap is reachable. Weighted
 * distribution treats `weights` as a parallel array over candidate row
 * counts starting at `minRows` — the i-th weight is the probability
 * mass for `minRows + i` (extra weights past the span are ignored;
 * missing weights default to zero, with a uniform fallback if all
 * provided weights sum to zero).
 *
 * @param {number} reelCount
 * @param {number} minRows
 * @param {number} maxRows
 * @param {() => number} [rng]
 * @param {'uniform'|'weighted'} [distribution]
 * @param {number[]|null} [weights]
 * @returns {number[]}
 */
export function rollRowsPerReel(reelCount, minRows, maxRows, rng = Math.random, distribution = 'uniform', weights = null) {
  if (!Number.isFinite(reelCount) || reelCount <= 0) return [];
  const lo = Math.max(1, Math.trunc(minRows));
  const hi = Math.max(lo, Math.trunc(maxRows));
  const span = hi - lo + 1;
  const out = new Array(Math.trunc(reelCount));

  if (distribution === 'weighted' && Array.isArray(weights) && weights.length > 0) {
    const trimmed = weights
      .slice(0, span)
      .map(w => (Number.isFinite(w) && w > 0 ? Number(w) : 0));
    const total = trimmed.reduce((s, w) => s + w, 0);
    if (total > 0) {
      for (let i = 0; i < out.length; i++) {
        let r = rng() * total;
        let pick = lo + trimmed.length - 1;
        for (let j = 0; j < trimmed.length; j++) {
          r -= trimmed[j];
          if (r <= 0) { pick = lo + j; break; }
        }
        out[i] = pick;
      }
      return out;
    }
  }

  for (let i = 0; i < out.length; i++) {
    const r = rng();
    out[i] = lo + Math.min(span - 1, Math.floor(r * span));
  }
  return out;
}

/**
 * Pure helper: total winning ways for a per-reel row layout.
 *
 * Product reduce across the rowsPerReel array. Empty layout returns 1
 * (multiplicative identity, matches "single-line" baseline). Any zero
 * entry collapses the product to 0 — a reel with no rows cannot
 * contribute symbols so no way can complete.
 *
 * @param {number[]} rowsPerReel
 * @returns {number}
 */
export function computeWaysCount(rowsPerReel) {
  if (!Array.isArray(rowsPerReel) || rowsPerReel.length === 0) return 1;
  let total = 1;
  for (let i = 0; i < rowsPerReel.length; i++) {
    const v = Number(rowsPerReel[i]);
    if (!Number.isFinite(v)) return 0;
    total *= Math.max(0, Math.trunc(v));
  }
  return total;
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 10px; left: 50%; transform: translateX(-50%);';
    case 'topLeft':  return 'top: 10px; left: 10px;';
    case 'top':      return 'top: 10px; left: 50%; transform: translateX(-50%);';
    case 'topRight':
    default:         return 'top: 10px; right: 10px;';
  }
}

export function emitDynamicWaysEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ dynamicWaysEngine: cfg });
  if (!c.enabled) return `\n/* dynamicWaysEngine BLOCK (disabled) — no CSS */\n`;
  return `
/* ── dynamicWaysEngine BLOCK — src/blocks/dynamicWaysEngine.mjs ── */
.dwe-hud {
  position: absolute;
  ${positionCss(c.hudPosition)}
  font: 800 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.hudColor};
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid ${c.hudColor}aa;
  text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 65;
  opacity: 0;
  transition: opacity 220ms ease;
}
.dwe-hud.is-visible {
  opacity: 1;
  animation: dwe-pulse ${c.pulseMs}ms ease-out;
}
@keyframes dwe-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.12); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dwe-hud.is-visible { animation: none; }
}
`;
}

export function emitDynamicWaysEngineMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ dynamicWaysEngine: cfg });
  if (!c.enabled) return `\n<!-- dynamicWaysEngine BLOCK (disabled) -->\n`;
  if (!c.showHud) return `\n<!-- dynamicWaysEngine BLOCK (hud hidden) -->\n`;
  return `
<!-- dynamicWaysEngine BLOCK — server-emitted markup -->
<div class="dwe-hud" id="dweHud" role="status" aria-live="polite" aria-hidden="true"></div>
`;
}

export function emitDynamicWaysEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ dynamicWaysEngine: cfg });
  if (!c.enabled) return `\n// dynamicWaysEngine BLOCK (disabled) — no runtime\n`;

  const reelCount       = c.reelCount;
  const minRows         = c.minRows;
  const maxRows         = c.maxRows;
  const rowDistribution = JSON.stringify(c.rowDistribution);
  const weights         = JSON.stringify(c.weights);
  const bumpInFs        = c.bumpInFs ? 'true' : 'false';
  const bumpAmount      = c.bumpAmount;
  const showHud         = c.showHud ? 'true' : 'false';
  const pulseMs         = c.pulseMs;

  return `
/* ── dynamicWaysEngine BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__DWE_WIRED__) return;
  window.__DWE_WIRED__ = true;

  var REEL_COUNT       = ${reelCount};
  var MIN_ROWS         = ${minRows};
  var MAX_ROWS         = ${maxRows};
  var ROW_DISTRIBUTION = ${rowDistribution};
  var WEIGHTS          = ${weights};
  var BUMP_IN_FS       = ${bumpInFs};
  var BUMP_AMOUNT      = ${bumpAmount};
  var SHOW_HUD         = ${showHud};
  var PULSE_MS         = ${pulseMs};

  window.__WAYS_COUNT__ = 0;
  window.__WAYS_ROWS__  = [];

  function _rng() {
    if (window.HookBus && typeof window.HookBus.getRng === 'function') {
      try { return window.HookBus.getRng(); } catch (_) {}
    }
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
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

  function _isHwActive() {
    /* Hold and Win locks the grid to fixed positions; reshape is
     * semantically invalid during HW so the engine bypasses entirely. */
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _gridKindBlocked() {
    /* Only rectangular reel grids carry "rows per reel" semantics.
     * Wheel, crash, plinko, hex, slingo, cluster topologies bypass. */
    if (window.GRID_KIND) {
      var k = String(window.GRID_KIND).toLowerCase();
      if (k === 'wheel' || k === 'crash' || k === 'plinko' || k === 'hex' || k === 'slingo' || k === 'cluster') return true;
    }
    return false;
  }

  function _activeBounds() {
    var lo = MIN_ROWS;
    var hi = MAX_ROWS;
    if (BUMP_IN_FS && _isFsActive()) {
      hi = hi + BUMP_AMOUNT;
    }
    return { lo: lo, hi: hi };
  }

  function _rollRows() {
    var bounds = _activeBounds();
    var lo = Math.max(1, Math.trunc(bounds.lo));
    var hi = Math.max(lo, Math.trunc(bounds.hi));
    var span = hi - lo + 1;
    var out = new Array(REEL_COUNT);

    if (ROW_DISTRIBUTION === 'weighted' && Array.isArray(WEIGHTS) && WEIGHTS.length > 0) {
      var trimmed = WEIGHTS.slice(0, span).map(function(w) {
        return (typeof w === 'number' && isFinite(w) && w > 0) ? w : 0;
      });
      var total = 0;
      for (var t = 0; t < trimmed.length; t++) total += trimmed[t];
      if (total > 0) {
        for (var i = 0; i < REEL_COUNT; i++) {
          var r = _rng() * total;
          var pick = lo + trimmed.length - 1;
          for (var j = 0; j < trimmed.length; j++) {
            r -= trimmed[j];
            if (r <= 0) { pick = lo + j; break; }
          }
          out[i] = pick;
        }
        return out;
      }
    }

    for (var k = 0; k < REEL_COUNT; k++) {
      var u = _rng();
      out[k] = lo + Math.min(span - 1, Math.floor(u * span));
    }
    return out;
  }

  function _computeWays(rows) {
    if (!rows || rows.length === 0) return 1;
    var total = 1;
    for (var i = 0; i < rows.length; i++) {
      var v = Number(rows[i]);
      if (!isFinite(v)) return 0;
      total *= Math.max(0, Math.trunc(v));
    }
    return total;
  }

  var _hudTimerId = null;
  function _paintHud(totalWays) {
    if (!SHOW_HUD) return;
    var hud = document.getElementById('dweHud');
    if (!hud) return;
    hud.textContent = totalWays.toLocaleString() + ' ways';
    hud.setAttribute('aria-hidden', 'false');
    hud.classList.add('is-visible');
    /* QA sweep (2026-06-18): cancel any prior pulse timer so rapid spins
     * do not strip is-visible mid-pulse for the freshest paint. Mirrors
     * the same pattern in randomLightningMultiplier overlay handle. */
    if (_hudTimerId) {
      try { clearTimeout(_hudTimerId); } catch (_) {}
    }
    _hudTimerId = setTimeout(function() {
      _hudTimerId = null;
      hud.classList.remove('is-visible');
    }, PULSE_MS);
  }

  function _emit(name, payload) {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit(name, payload); } catch (_) {}
    }
  }

  function _onPreSpin() {
    if (_gridKindBlocked()) return;
    if (_isHwActive())      return;
    var rows = _rollRows();
    window.__WAYS_ROWS__ = rows;
  }

  function _onSpinResult() {
    if (_gridKindBlocked()) return;
    if (_isHwActive())      return;
    var rows = (Array.isArray(window.__WAYS_ROWS__) && window.__WAYS_ROWS__.length > 0)
      ? window.__WAYS_ROWS__
      : _rollRows();
    var totalWays = _computeWays(rows);
    window.__WAYS_ROWS__   = rows;
    window.__WAYS_COUNT__  = totalWays;
    _paintHud(totalWays);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onWaysReshaped', { rowsPerReel: rows.slice(), totalWays: totalWays });
      } catch (_) {}
    }
  }

  function _onFsTrigger() {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onWaysResetForRound', {}); } catch (_) {}
    }
  }

  function _onFsEnd() {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onWaysResetForRound', {}); } catch (_) {}
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',      _onPreSpin,     { priority: 25 });
    window.HookBus.on('onSpinResult', _onSpinResult,  { priority: 25 });
    window.HookBus.on('onFsTrigger',  _onFsTrigger,   { priority: 25 });
    window.HookBus.on('onFsEnd',      _onFsEnd,       { priority: 25 });
  }
})();
`;
}
