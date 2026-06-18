/**
 * src/blocks/expandingWildMultiplier.mjs
 *
 * Wave LEGO-EWM — Expanding wild + ×N multiplier tag.
 *
 * Purpose
 * ───────
 *   When a wild lands on a reel, the wild EXPANDS to cover the entire
 *   reel AND carries a ×N multiplier tag drawn from a weighted
 *   distribution. Every win-line passing through an expanded reel is
 *   multiplied by that reel's tag value. Multiple expanded reels combine
 *   per the `aggregation` knob:
 *     • 'multiplicative' → reel tags multiply  (×2 × ×3 = ×6)
 *     • 'additive'       → reel tags sum       (×2 + ×3 = ×5)
 *
 *   Distinct from sibling blocks:
 *     • fsExpansionWilds    — FS-only sticky reels, no per-reel mult tag
 *     • multiplierOrb       — per-cell symbol-bound mult, no expansion
 *     • persistentMultiplier — round-accumulating mult, no wild expansion
 *     • holdAndWinLockedOrbMultiplier — H&W lock-time mult, not wild-driven
 *
 *   Distinguishing features of this block:
 *     • Works in BASE and/or FS (`appliesIn` knob), NOT sticky between
 *       spins — per-spin paint that clears on next `preSpin`
 *     • Multiplier value is per-reel (not per-cell, not per-round)
 *     • Hard-gated OFF while Hold & Win is active so that two reel-paint
 *       systems do not collide
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Common "expanding wild with multiplier" frame seen across video
 *   slots: wild substitution expands the column, with a value chip
 *   displayed on the reel. Multiple chips combine into one round
 *   multiplier on line wins.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitExpandingWildMultiplierCSS(cfg)
 *   emitExpandingWildMultiplierMarkup(cfg)
 *   emitExpandingWildMultiplierRuntime(cfg)
 *   rollWildMultiplier(distribution, rng)        (pure helper)
 *   aggregateWildMults(values, mode)             (pure helper, locked-orb-compatible)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin          (priority 30) — clears prior paint + tags, resets HookBus.setMult
 *     • onSpinResult     (priority 30) — base-game scan + paint + tag (when appliesIn ∈ {base, both})
 *     • onFsSpinResult   (priority 30) — FS scan + paint + tag        (when appliesIn ∈ {fs,   both})
 *     • onFsEnd          (priority 30) — final clear when FS round ends
 *   emits:
 *     • onExpandingWildMultRolled   { reelIdx, multX }
 *     • onExpandingWildMultsCleared { count }
 *
 * Runtime contract
 * ────────────────
 *   window.EWM_STATE = {
 *     activeReels: Map<number, number>,   // reelIdx → multX
 *     aggregation: 'additive' | 'multiplicative',
 *   }
 *   window.__EWM_WIRED__   wired-once sentinel
 *
 * GDD config keys (model.expandingWildMultiplier)
 * ───────────────────────────────────────────────
 *   {
 *     enabled:        boolean,                       default false
 *     wildSymbol:     string,                        default 'W'
 *     distribution:   [{ value, weight }, …],
 *     aggregation:    'additive' | 'multiplicative', default 'multiplicative'
 *     appliesIn:      'base' | 'fs' | 'both',        default 'both'
 *     wildColor:      hex,                           default '#7c4dff'
 *     multTagFontPx:  int 10–22,                     default 14
 *     pulseMs:        int 200–2000,                  default 700
 *   }
 *
 * Performance budget: ≤ 0.4 ms per spin settle on 5×4 grid; 4 listeners
 * total (wired-once via window.__EWM_WIRED__).
 *
 * a11y: each painted reel cell gets aria-label="Expanding wild Nx"; the
 * tag badge has role=img + aria-label so screen readers announce the
 * multiplier. prefers-reduced-motion kills the pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. The block
 * publishes its computed aggregate to HookBus.setMult; downstream
 * payline/winPresentation blocks consume that value — there is no
 * arithmetic over actual payouts inside this file.
 */

const AGGREGATIONS = Object.freeze(['additive', 'multiplicative']);
const APPLIES_IN   = Object.freeze(['base', 'fs', 'both']);

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 22;
const PULSE_MIN_MS  = 200;
const PULSE_MAX_MS  = 2000;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_RE    = /^[A-Za-z0-9_\-]{1,12}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:  2, weight: 60 },
  { value:  3, weight: 25 },
  { value:  5, weight: 10 },
  { value: 10, weight:  5 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbol: 'W',
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    aggregation: 'multiplicative',
    appliesIn: 'both',
    wildColor: '#7c4dff',
    multTagFontPx: 14,
    pulseMs: 700,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.expandingWildMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (typeof src.wildSymbol === 'string' && SYMBOL_RE.test(src.wildSymbol)) {
    cfg.wildSymbol = src.wildSymbol;
  }

  if (Array.isArray(src.distribution) && src.distribution.length > 0) {
    const filtered = src.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length > 0) cfg.distribution = filtered;
  }

  if (typeof src.aggregation === 'string' && AGGREGATIONS.includes(src.aggregation)) {
    cfg.aggregation = src.aggregation;
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }

  if (typeof src.wildColor === 'string' && HEX_COLOR_RE.test(src.wildColor)) {
    cfg.wildColor = src.wildColor;
  }

  if (Number.isFinite(src.multTagFontPx)) {
    cfg.multTagFontPx = clampInt(src.multTagFontPx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }

  return cfg;
}

/**
 * Weighted pick from a distribution. Pure function — accepts an RNG so
 * tests can use a deterministic seed; defaults to Math.random.
 *
 * @param {Array<{value:number,weight:number}>} distribution
 * @param {Function} [rng]   () → [0,1)
 * @returns {number}          chosen multiplier value (≥ 1)
 */
export function rollWildMultiplier(distribution, rng = Math.random) {
  if (!Array.isArray(distribution) || distribution.length === 0) return 1;
  const total = distribution.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
  if (total <= 0) return distribution[0].value;
  let r = rng() * total;
  for (const e of distribution) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return distribution[distribution.length - 1].value;
}

/**
 * Combine a list of per-reel multiplier values into a single round
 * multiplier. Pure function — no side effects. Signature-compatible
 * with `holdAndWinLockedOrbMultiplier.aggregateValues` so downstream
 * consumers can swap helpers without branching.
 *
 *   mode 'additive'       → values.reduce(+); identity 0
 *   mode 'multiplicative' → values.reduce(*); identity 1
 *
 * Non-numeric entries are filtered out before reduction.
 *
 * @param {number[]} values
 * @param {'additive'|'multiplicative'} [mode]
 * @returns {number}
 */
export function aggregateWildMults(values, mode = 'multiplicative') {
  if (!Array.isArray(values) || values.length === 0) {
    return mode === 'multiplicative' ? 1 : 0;
  }
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length === 0) return mode === 'multiplicative' ? 1 : 0;
  if (mode === 'additive') return clean.reduce((s, v) => s + v, 0);
  return clean.reduce((p, v) => p * v, 1);
}

export function emitExpandingWildMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ expandingWildMultiplier: cfg });
  if (!c.enabled) return `\n/* expandingWildMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── expandingWildMultiplier BLOCK — src/blocks/expandingWildMultiplier.mjs ── */
.is-mult-wild {
  position: relative;
  color: ${c.wildColor};
  text-shadow: 0 0 10px ${c.wildColor}, 0 0 18px rgba(124,77,255,0.55);
  font-weight: 900;
  z-index: 5;
  animation: ewm-pulse ${c.pulseMs}ms ease-in-out infinite alternate;
}
.is-mult-wild::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(124,77,255,0.18), rgba(124,77,255,0.05));
  border: 1px solid ${c.wildColor};
  border-radius: 4px;
  box-shadow: 0 0 12px ${c.wildColor} inset;
  z-index: -1;
}
.ewm-tag {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: ${c.wildColor};
  color: #ffffff;
  font: 900 ${c.multTagFontPx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 0 rgba(0,0,0,0.4);
  box-shadow: 0 2px 6px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.4);
  pointer-events: none;
  z-index: 76;
}
@keyframes ewm-pulse {
  0%   { filter: brightness(1.0); }
  100% { filter: brightness(1.35); }
}
@media (prefers-reduced-motion: reduce) {
  .is-mult-wild { animation: none; }
}
`;
}

export function emitExpandingWildMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ expandingWildMultiplier: cfg });
  if (!c.enabled) return `\n<!-- expandingWildMultiplier BLOCK (disabled) -->\n`;
  /* No up-front badges — paint + tag are minted at runtime when wilds
     land. A single anchor node is emitted so static integration tools
     can confirm block presence. */
  return `
<!-- expandingWildMultiplier BLOCK — paint + tag minted at runtime per reel -->
<div class="ewm-anchor" id="ewmAnchor" data-ewm-aggregation="${c.aggregation}" data-ewm-applies-in="${c.appliesIn}" aria-hidden="true" hidden></div>
`;
}

export function emitExpandingWildMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ expandingWildMultiplier: cfg });
  if (!c.enabled) return `\n// expandingWildMultiplier BLOCK (disabled) — no runtime\n`;

  const WILD       = JSON.stringify(c.wildSymbol);
  const DIST_JSON  = JSON.stringify(c.distribution);
  const AGG_JSON   = JSON.stringify(c.aggregation);
  const APPLIES    = JSON.stringify(c.appliesIn);

  return `
/* ── expandingWildMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__EWM_WIRED__) return;
  window.__EWM_WIRED__ = true;

  var WILD_SYMBOL = ${WILD};
  var DIST        = ${DIST_JSON};
  var AGGREGATION = ${AGG_JSON};
  var APPLIES_IN  = ${APPLIES};

  window.EWM_STATE = {
    activeReels: new Map(),
    aggregation: AGGREGATION,
  };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _pick() {
    var total = 0;
    for (var i = 0; i < DIST.length; i++) total += (DIST[i].weight > 0 ? DIST[i].weight : 0);
    if (total <= 0) return DIST[0].value;
    var r = _rng() * total;
    for (var j = 0; j < DIST.length; j++) {
      r -= DIST[j].weight;
      if (r <= 0) return DIST[j].value;
    }
    return DIST[DIST.length - 1].value;
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
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _appliesNow(fromFs) {
    if (APPLIES_IN === 'both') return true;
    if (APPLIES_IN === 'fs')   return !!fromFs;
    if (APPLIES_IN === 'base') return !fromFs;
    return false;
  }

  function _scanGridForWildReels(grid) {
    var reels = new Set();
    if (!Array.isArray(grid)) return reels;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      if (!Array.isArray(row)) continue;
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        var sym  = (cell && typeof cell === 'object') ? (cell.sym || cell.symbol) : cell;
        if (sym === WILD_SYMBOL) reels.add(c);
      }
    }
    return reels;
  }

  function _paintReel(reelIdx, multX) {
    var cells = document.querySelectorAll('[data-reel="' + reelIdx + '"]');
    if (!cells || cells.length === 0) return;
    cells.forEach(function(el, idx) {
      el.classList.add('is-mult-wild');
      el.textContent = WILD_SYMBOL;
      el.setAttribute('data-mult-x', String(multX));
      el.setAttribute('aria-label', 'Expanding wild ' + multX + 'x');
      /* Mint tag on the top cell only, to avoid stacking N badges. */
      if (idx === 0) {
        var existing = el.querySelector('.ewm-tag');
        if (!existing) {
          var tag = document.createElement('div');
          tag.className = 'ewm-tag';
          tag.textContent = 'x' + multX;
          tag.setAttribute('role', 'img');
          tag.setAttribute('aria-label', 'Multiplier ' + multX + 'x');
          el.appendChild(tag);
        }
      }
    });
  }

  function _aggregate() {
    var vals = [];
    window.EWM_STATE.activeReels.forEach(function(v) { vals.push(v); });
    if (vals.length === 0) return AGGREGATION === 'multiplicative' ? 1 : 0;
    if (AGGREGATION === 'additive') {
      var s = 0;
      for (var i = 0; i < vals.length; i++) s += vals[i];
      return s;
    }
    var p = 1;
    for (var j = 0; j < vals.length; j++) p *= vals[j];
    return p;
  }

  function _publishAggregate() {
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      try { window.HookBus.setMult(_aggregate()); } catch (_) {}
    }
  }

  function _clearAll() {
    var painted = document.querySelectorAll('.is-mult-wild');
    painted.forEach(function(el) {
      el.classList.remove('is-mult-wild');
      el.removeAttribute('data-mult-x');
      el.removeAttribute('aria-label');
      var tag = el.querySelector('.ewm-tag');
      if (tag) tag.remove();
    });
    var count = window.EWM_STATE.activeReels.size;
    window.EWM_STATE.activeReels = new Map();
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      try { window.HookBus.setMult(AGGREGATION === 'multiplicative' ? 1 : 0); } catch (_) {}
    }
    if (count > 0 && window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onExpandingWildMultsCleared', { count: count }); } catch (_) {}
    }
  }

  function _processSpin(payload, fromFs) {
    if (_isHwActive()) return;
    if (!_appliesNow(fromFs)) return;
    if (fromFs && !_isFsActive()) return;
    var grid = payload && (payload.grid || payload.board || payload.reels);
    var wildReels = _scanGridForWildReels(grid);
    wildReels.forEach(function(reelIdx) {
      if (window.EWM_STATE.activeReels.has(reelIdx)) return;
      var v = _pick();
      window.EWM_STATE.activeReels.set(reelIdx, v);
      _paintReel(reelIdx, v);
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onExpandingWildMultRolled', { reelIdx: reelIdx, multX: v }); } catch (_) {}
      }
    });
    _publishAggregate();
  }

  function _onPreSpin() {
    /* QA sweep (2026-06-18): HW guard — if the H&W round is active,
     * skip clear so we don't publish a stale setMult(1) that could
     * overwrite a concurrent H&W multiplier publisher. Mirrors guards
     * elsewhere in this block. */
    if (_isHwActive()) return;
    _clearAll();
  }

  function _onSpinResult(payload) {
    _processSpin(payload, false);
  }

  function _onFsSpinResult(payload) {
    _processSpin(payload, true);
  }

  function _onFsEnd() {
    _clearAll();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',        _onPreSpin,       { priority: 30 });
    window.HookBus.on('onSpinResult',   _onSpinResult,    { priority: 30 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult,  { priority: 30 });
    window.HookBus.on('onFsEnd',        _onFsEnd,         { priority: 30 });
  }
})();
`;
}
