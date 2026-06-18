/**
 * src/blocks/fsExpansionWilds.mjs
 *
 * Wave LEGO — Free Spins Expanding Sticky Wilds.
 *
 * Purpose
 * ───────
 *   Free Spins feature where any wild landing in a reel during a FS spin
 *   EXPANDS to cover the entire reel (every cell becomes wild) AND
 *   REMAINS STICKY for the remainder of the FS round. Sticky reels
 *   accumulate across FS spins until the round ends or `maxStickyReels`
 *   is reached. On `onFsEnd` the state and visuals are cleared.
 *
 *   Distinct from:
 *     • multiplierLadder       (progressive multiplier, no reel paint)
 *     • persistentMultiplier   (mult accumulates, no wild expansion)
 *     • perFsSpinMultiplier    (per-spin random mult, no sticky)
 *     • multiplierOrb          (per-cell symbol-bound mult, transient)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Common Free Spins frame: each wild that drops in a column locks
 *   the column to full-wild for the rest of the round. Hit-frequency
 *   amplifier — turns later FS spins into high-volatility full-reel
 *   substitution events.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitFsExpansionWildsCSS(cfg)
 *   emitFsExpansionWildsMarkup(cfg)
 *   emitFsExpansionWildsRuntime(cfg)
 *   shouldExpandReel(stickySet, reelIdx, maxReels)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onFsTrigger     (priority 30) — init FSEW_STATE.stickyReels
 *     • onFsSpinResult  (priority 30) — scan grid, add new sticky reels, paint cells
 *     • onFsEnd         (priority 30) — clear state + clear .is-expansion-wild
 *     • preSpin         (priority 30) — no-op (sticky preserves between FS spins)
 *   emits:
 *     • onExpansionWildAdded     { reelIdx }
 *     • onExpansionWildsCleared  { count }
 *
 * Runtime contract
 * ────────────────
 *   window.FSEW_STATE = { stickyReels: Set<number> }
 *   window.__FSEW_WIRED__   wired-once sentinel
 *
 * GDD config keys (model.fsExpansionWilds)
 * ────────────────────────────────────────
 *   { enabled, wildSymbol, triggerProbability, maxStickyReels,
 *     expansionColor, pulseMs }
 *
 * Performance budget: ≤ 0.5 ms per FS spin settle on 5×4 grid; 1
 * listener per event (wired-once via window.__FSEW_WIRED__).
 *
 * a11y: expansion cells receive aria-label="Expanding wild" so screen
 * readers announce the substitution; prefers-reduced-motion kills the
 * pulse keyframe.
 *
 * Guards:
 *   • Skips when HW_STATE.active is truthy (Hold-and-Win takes priority).
 *   • Skips when FS is not active (defence-in-depth).
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting reel-add events to HookBus.
 */

const MAX_REELS_MIN     = 1;
const MAX_REELS_MAX     = 10;
const PULSE_MIN_MS      = 200;
const PULSE_MAX_MS      = 3000;
const PROB_MIN          = 0;
const PROB_MAX          = 1;

const HEX_COLOR_RE      = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_RE         = /^[A-Za-z0-9_\-]{1,8}$/;

const clampInt   = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampFloat = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbol: 'W',
    triggerProbability: 1.0,
    maxStickyReels: 5,
    expansionColor: '#ffaa00',
    pulseMs: 700,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.fsExpansionWilds) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (typeof src.wildSymbol === 'string' && SYMBOL_RE.test(src.wildSymbol)) {
    cfg.wildSymbol = src.wildSymbol;
  }
  if (Number.isFinite(src.triggerProbability)) {
    cfg.triggerProbability = clampFloat(src.triggerProbability, PROB_MIN, PROB_MAX);
  }
  if (Number.isFinite(src.maxStickyReels)) {
    cfg.maxStickyReels = clampInt(src.maxStickyReels, MAX_REELS_MIN, MAX_REELS_MAX);
  }
  if (typeof src.expansionColor === 'string' && HEX_COLOR_RE.test(src.expansionColor)) {
    cfg.expansionColor = src.expansionColor;
  }
  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }

  return cfg;
}

/**
 * Pure decision helper: should `reelIdx` be marked sticky?
 * Returns true iff:
 *   • reelIdx is a non-negative finite integer,
 *   • reelIdx is NOT already present in stickySet,
 *   • current stickySet size is below maxReels capacity.
 *
 * @param {Set<number>} stickySet  current sticky reels set
 * @param {number}      reelIdx    candidate reel index
 * @param {number}      maxReels   capacity ceiling
 * @returns {boolean}
 */
export function shouldExpandReel(stickySet, reelIdx, maxReels) {
  if (!stickySet || typeof stickySet.has !== 'function' || typeof stickySet.size !== 'number') return false;
  if (!Number.isFinite(reelIdx) || reelIdx < 0 || Math.trunc(reelIdx) !== reelIdx) return false;
  if (!Number.isFinite(maxReels) || maxReels < 1) return false;
  if (stickySet.has(reelIdx)) return false;
  if (stickySet.size >= maxReels) return false;
  return true;
}

export function emitFsExpansionWildsCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ fsExpansionWilds: cfg });
  if (!c.enabled) return `\n/* fsExpansionWilds BLOCK (disabled) — no CSS */\n`;
  return `
/* ── fsExpansionWilds BLOCK — src/blocks/fsExpansionWilds.mjs ── */
.is-expansion-wild {
  position: relative;
  color: ${c.expansionColor};
  text-shadow: 0 0 10px ${c.expansionColor}, 0 0 18px rgba(255,170,0,0.55);
  font-weight: 900;
  z-index: 5;
  animation: fsew-pulse ${c.pulseMs}ms ease-in-out infinite alternate;
}
.is-expansion-wild::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,170,0,0.18), rgba(255,170,0,0.05));
  border: 1px solid ${c.expansionColor};
  border-radius: 4px;
  box-shadow: 0 0 12px ${c.expansionColor} inset;
  z-index: -1;
}
@keyframes fsew-pulse {
  0%   { filter: brightness(1.0); }
  100% { filter: brightness(1.35); }
}
@media (prefers-reduced-motion: reduce) {
  .is-expansion-wild { animation: none; }
}
`;
}

export function emitFsExpansionWildsMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ fsExpansionWilds: cfg });
  if (!c.enabled) return `\n<!-- fsExpansionWilds BLOCK (disabled) -->\n`;
  return `
<!-- fsExpansionWilds BLOCK — no static markup, runtime paints cells in-place -->
<div class="fsew-anchor" id="fsewAnchor" aria-hidden="true" hidden></div>
`;
}

export function emitFsExpansionWildsRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ fsExpansionWilds: cfg });
  if (!c.enabled) return `\n// fsExpansionWilds BLOCK (disabled) — no runtime\n`;

  const WILD            = JSON.stringify(c.wildSymbol);
  const MAX_REELS       = c.maxStickyReels;
  const TRIGGER_PROB    = c.triggerProbability;

  return `
/* ── fsExpansionWilds BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__FSEW_WIRED__) return;
  window.__FSEW_WIRED__ = true;

  var WILD_SYMBOL    = ${WILD};
  var MAX_STICKY     = ${MAX_REELS};
  var TRIGGER_PROB   = ${TRIGGER_PROB};

  window.FSEW_STATE = {
    stickyReels: new Set(),
  };

  function _rng() {
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
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    return false;
  }

  function _shouldExpandReel(reelIdx) {
    if (window.FSEW_STATE.stickyReels.has(reelIdx)) return false;
    if (window.FSEW_STATE.stickyReels.size >= MAX_STICKY) return false;
    return true;
  }

  function _scanGridForWilds(grid) {
    /* grid shape: rows[][] of symbol strings OR { sym: 'W' } cells. */
    var reelsWithWild = new Set();
    if (!Array.isArray(grid)) return reelsWithWild;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      if (!Array.isArray(row)) continue;
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        var sym  = (cell && typeof cell === 'object') ? (cell.sym || cell.symbol) : cell;
        if (sym === WILD_SYMBOL) reelsWithWild.add(c);
      }
    }
    return reelsWithWild;
  }

  function _paintReelCells(reelIdx) {
    var cells = document.querySelectorAll('[data-reel="' + reelIdx + '"]');
    cells.forEach(function(el) {
      el.classList.add('is-expansion-wild');
      el.textContent = WILD_SYMBOL;
      el.setAttribute('aria-label', 'Expanding wild');
    });
  }

  function _repaintAllSticky() {
    window.FSEW_STATE.stickyReels.forEach(function(r) {
      _paintReelCells(r);
    });
  }

  function _clearAllPaint() {
    var painted = document.querySelectorAll('.is-expansion-wild');
    painted.forEach(function(el) {
      el.classList.remove('is-expansion-wild');
      el.removeAttribute('aria-label');
    });
  }

  function _onFsTrigger() {
    /* QA sweep (2026-06-18): HW guard parity with other listeners — if
     * an H&W round is mid-flight when the FS trigger lifecycle fires
     * (rare cross-round race), don't initialize stickyReels state.
     * Mirrors guard on _onFsSpinResult (L279). */
    if (_isHwActive()) return;
    window.FSEW_STATE.stickyReels = new Set();
  }

  function _onFsSpinResult(payload) {
    if (_isHwActive()) return;
    if (!_isFsActive()) return;
    var grid = payload && (payload.grid || payload.board || payload.reels);
    var wildReels = _scanGridForWilds(grid);
    var added = 0;
    wildReels.forEach(function(reelIdx) {
      if (TRIGGER_PROB < 1 && _rng() > TRIGGER_PROB) return;
      if (!_shouldExpandReel(reelIdx)) return;
      window.FSEW_STATE.stickyReels.add(reelIdx);
      added++;
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onExpansionWildAdded', { reelIdx: reelIdx }); } catch (_) {}
      }
    });
    _repaintAllSticky();
  }

  function _onFsEnd() {
    var count = window.FSEW_STATE.stickyReels.size;
    window.FSEW_STATE.stickyReels = new Set();
    _clearAllPaint();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onExpansionWildsCleared', { count: count }); } catch (_) {}
    }
  }

  function _onPreSpin() {
    /* no-op: sticky state preserves across FS spins. */
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',    _onFsTrigger,    { priority: 30 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult, { priority: 30 });
    window.HookBus.on('onFsEnd',        _onFsEnd,        { priority: 30 });
    window.HookBus.on('preSpin',        _onPreSpin,      { priority: 30 });
  }
})();
`;
}
