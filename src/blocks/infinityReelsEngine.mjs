/**
 * src/blocks/infinityReelsEngine.mjs
 *
 * Wave LEGO-IRE — Infinity Reels Engine (grid grows on every win).
 *
 * Purpose
 * ───────
 *   Industry-reference "infinity reels grid expansion" pattern. When a
 *   tumble step produces a win, the reel COUNT extends by +1 (a new
 *   column is appended to the right) and the round multiplier bumps by
 *   `growPerExpand`. The grid keeps growing tumble-after-tumble until a
 *   dry tumble (no win) closes the chain; state then resets at the next
 *   `preSpin` for the following round. Distinct from:
 *     • dynamicWaysEngine    (variable rows per reel — fixed column count)
 *     • multiplierLadder     (mult grows; reel count never changes)
 *     • holdAndWin           (sticky symbols; grid locked, no expansion)
 *     • cascadeBooster       (tumble payout boost; grid stays the same)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "infinity reels expansion pattern" — base grid begins at
 *   `baseReelCount` columns; every winning tumble appends a column up
 *   to `maxReels`. Multiplier starts at `startMult`, increments by
 *   `growPerExpand` per expansion, and saturates at `maxMult`. On a
 *   dry tumble the engine emits a commit summary and waits for the
 *   next round.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitInfinityReelsEngineCSS(cfg)
 *   emitInfinityReelsEngineMarkup(cfg)
 *   emitInfinityReelsEngineRuntime(cfg)
 *   nextReelCount(currentExpanded, maxReels, baseReelCount)  (pure helper, exported for tests)
 *   nextInfinityMult(currentMult, growPerExpand, maxMult)    (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin        (priority 25) — resets round state for next spin
 *     • onTumbleStep   (priority 25) — expansion decision pre re-eval
 *     • onSpinResult   (priority 25) — commits final reel count + mult if expanded
 *     • onFsTrigger    (priority 25) — resets state across FS entry
 *     • onFsEnd        (priority 25) — resets state across FS exit
 *   emits:
 *     • onInfinityEngineExpanded   { expandedTo, multX }
 *     • onInfinityEngineCommit    { finalReelCount, finalMult }
 *     • onInfinityEngineReset     {}
 *
 * Runtime contract
 * ────────────────
 *   window.IRE_STATE       = { reelsExpanded: number, currentMult: number }
 *   window.__IRE_WIRED__   = boolean (wired-once sentinel)
 *
 * GDD config keys (model.infinityReelsEngine)
 * ───────────────────────────────────────────
 *   { enabled, baseReelCount: 3..7, maxReels: 5..20,
 *     startMult: 1..5, growPerExpand: 1..3, maxMult: 2..100,
 *     appliesIn: 'base'|'fs'|'both', showHud: boolean,
 *     hudPosition: 'top'|'topRight'|'topLeft'|'bottom',
 *     hudColor: hex, fontSizePx: 12..32,
 *     pulseMs: 200..2000, expandAnimMs: 100..1500 }
 *
 * Guards
 * ──────
 *   • HW guard — skipped when window.HW_STATE.active is true (Hold &
 *     Win locks the grid; column expansion is semantically invalid).
 *   • Grid-kind guard — only runs on rectangular grids. Wheel, crash,
 *     plinko, hex, slingo, cluster topologies bypass the engine.
 *   • appliesIn guard — `base` skips during FS, `fs` skips outside FS,
 *     `both` runs everywhere. Default `both`.
 *
 * Performance budget: ≤ 0.2 ms per tumble step on 12-reel cap; 1
 * listener per event (wired-once via window.__IRE_WIRED__).
 *
 * a11y: HUD chip carries role=status + aria-live=polite so screen
 * readers announce "8 reels x5" each expansion; prefers-reduced-motion
 * kills the pulse + expand keyframes.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * decisions beyond emitting the rolled expansion/commit events.
 */

const HUD_POSITIONS    = Object.freeze(['top', 'topRight', 'topLeft', 'bottom']);
const APPLIES_IN_OPTS  = Object.freeze(['base', 'fs', 'both']);

const BASE_REEL_MIN    = 3;
const BASE_REEL_MAX    = 7;
const MAX_REELS_MIN    = 5;
const MAX_REELS_MAX    = 20;
const START_MULT_MIN   = 1;
const START_MULT_MAX   = 5;
const GROW_PER_MIN     = 1;
const GROW_PER_MAX     = 3;
const MAX_MULT_MIN     = 2;
const MAX_MULT_MAX     = 100;
const FONT_SIZE_MIN    = 12;
const FONT_SIZE_MAX    = 32;
const PULSE_MIN_MS     = 200;
const PULSE_MAX_MS     = 2000;
const EXPAND_MIN_MS    = 100;
const EXPAND_MAX_MS    = 1500;

const HEX_COLOR_RE     = /^#[0-9a-fA-F]{3,8}$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    baseReelCount: 4,
    maxReels: 12,
    startMult: 1,
    growPerExpand: 1,
    maxMult: 20,
    appliesIn: 'both',
    showHud: true,
    hudPosition: 'topRight',
    hudColor: '#aaffcc',
    fontSizePx: 16,
    pulseMs: 500,
    expandAnimMs: 300,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.infinityReelsEngine) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.baseReelCount)) {
    cfg.baseReelCount = clampInt(src.baseReelCount, BASE_REEL_MIN, BASE_REEL_MAX);
  }
  if (Number.isFinite(src.maxReels)) {
    cfg.maxReels = clampInt(src.maxReels, MAX_REELS_MIN, MAX_REELS_MAX);
  }
  if (Number.isFinite(src.startMult)) {
    cfg.startMult = clampInt(src.startMult, START_MULT_MIN, START_MULT_MAX);
  }
  if (Number.isFinite(src.growPerExpand)) {
    cfg.growPerExpand = clampInt(src.growPerExpand, GROW_PER_MIN, GROW_PER_MAX);
  }
  if (Number.isFinite(src.maxMult)) {
    cfg.maxMult = clampInt(src.maxMult, MAX_MULT_MIN, MAX_MULT_MAX);
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN_OPTS.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
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
  if (Number.isFinite(src.expandAnimMs)) {
    cfg.expandAnimMs = clampInt(src.expandAnimMs, EXPAND_MIN_MS, EXPAND_MAX_MS);
  }

  /* Senior-grade invariant: baseReelCount must never exceed maxReels.
   * If a GDD author misconfigures the bounds, lift maxReels to keep
   * the expansion budget (maxReels - baseReelCount) non-negative. */
  if (cfg.baseReelCount > cfg.maxReels) cfg.maxReels = cfg.baseReelCount;

  /* Senior-grade invariant: startMult must never exceed maxMult. Lift
   * maxMult to keep nextInfinityMult monotonic and well-formed. */
  if (cfg.startMult > cfg.maxMult) cfg.maxMult = cfg.startMult;

  return cfg;
}

/**
 * Pure helper: next expanded reel count after one win.
 *
 * `currentExpanded` is how many extra columns have already been
 * appended this round (0 for a fresh round). The expansion budget is
 * `maxReels - baseReelCount` — once consumed, the function returns the
 * cap and the engine emits no further expansions. Negative or
 * non-finite inputs floor to 0 so the engine never advances on bad
 * state.
 *
 * @param {number} currentExpanded
 * @param {number} maxReels
 * @param {number} baseReelCount
 * @returns {number}
 */
export function nextReelCount(currentExpanded, maxReels, baseReelCount) {
  const cur = Number.isFinite(currentExpanded) ? Math.max(0, Math.trunc(currentExpanded)) : 0;
  const max = Number.isFinite(maxReels) ? Math.trunc(maxReels) : 0;
  const base = Number.isFinite(baseReelCount) ? Math.trunc(baseReelCount) : 0;
  const budget = Math.max(0, max - base);
  return Math.min(budget, cur + 1);
}

/**
 * Pure helper: next infinity-reels round multiplier after one win.
 *
 * Adds `growPerExpand` to `currentMult` and saturates at `maxMult`.
 * Non-finite or sub-zero current mult floors to 0 so the engine never
 * advances on bad state. Already-at-cap inputs return the cap
 * unchanged (idempotent saturation).
 *
 * @param {number} currentMult
 * @param {number} growPerExpand
 * @param {number} maxMult
 * @returns {number}
 */
export function nextInfinityMult(currentMult, growPerExpand, maxMult) {
  const cur = Number.isFinite(currentMult) ? Math.max(0, Math.trunc(currentMult)) : 0;
  const grow = Number.isFinite(growPerExpand) ? Math.max(0, Math.trunc(growPerExpand)) : 0;
  const cap = Number.isFinite(maxMult) ? Math.trunc(maxMult) : cur;
  return Math.min(cap, cur + grow);
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

export function emitInfinityReelsEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ infinityReelsEngine: cfg });
  if (!c.enabled) return `\n/* infinityReelsEngine BLOCK (disabled) — no CSS */\n`;
  return `
/* ── infinityReelsEngine BLOCK — src/blocks/infinityReelsEngine.mjs ── */
.ire-hud {
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
  z-index: 66;
  opacity: 0;
  transition: opacity 220ms ease;
}
.ire-hud.is-visible {
  opacity: 1;
  animation: ire-pulse ${c.pulseMs}ms ease-out;
}
@keyframes ire-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}
.ire-expand-anim {
  animation: ire-expand ${c.expandAnimMs}ms ease-out;
}
@keyframes ire-expand {
  0%   { transform: translateX(-30px) scale(0.6); opacity: 0; }
  60%  { transform: translateX(0)     scale(1.08); opacity: 1; }
  100% { transform: translateX(0)     scale(1);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ire-hud.is-visible,
  .ire-expand-anim { animation: none; }
}
`;
}

export function emitInfinityReelsEngineMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ infinityReelsEngine: cfg });
  if (!c.enabled) return `\n<!-- infinityReelsEngine BLOCK (disabled) -->\n`;
  if (!c.showHud) return `\n<!-- infinityReelsEngine BLOCK (hud hidden) -->\n`;
  return `
<!-- infinityReelsEngine BLOCK — server-emitted markup -->
<div class="ire-hud" id="ireHud" role="status" aria-live="polite" aria-hidden="true"></div>
`;
}

export function emitInfinityReelsEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ infinityReelsEngine: cfg });
  if (!c.enabled) return `\n// infinityReelsEngine BLOCK (disabled) — no runtime\n`;

  const baseReelCount = c.baseReelCount;
  const maxReels      = c.maxReels;
  const startMult     = c.startMult;
  const growPerExpand = c.growPerExpand;
  const maxMult       = c.maxMult;
  const appliesIn     = JSON.stringify(c.appliesIn);
  const showHud       = c.showHud ? 'true' : 'false';
  const pulseMs       = c.pulseMs;

  return `
/* ── infinityReelsEngine BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__IRE_WIRED__) return;
  window.__IRE_WIRED__ = true;

  var BASE_REEL_COUNT = ${baseReelCount};
  var MAX_REELS       = ${maxReels};
  var START_MULT      = ${startMult};
  var GROW_PER_EXPAND = ${growPerExpand};
  var MAX_MULT        = ${maxMult};
  var APPLIES_IN      = ${appliesIn};
  var SHOW_HUD        = ${showHud};
  var PULSE_MS        = ${pulseMs};

  window.IRE_STATE = {
    reelsExpanded: 0,
    currentMult:   START_MULT,
  };

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
    /* Hold and Win locks the grid; column expansion is semantically
     * invalid during HW so the engine bypasses entirely. */
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _gridKindBlocked() {
    /* Only rectangular reel grids carry "extra columns" semantics.
     * Wheel, crash, plinko, hex, slingo, cluster topologies bypass. */
    if (window.GRID_KIND) {
      var k = String(window.GRID_KIND).toLowerCase();
      if (k === 'wheel' || k === 'crash' || k === 'plinko' || k === 'hex' || k === 'slingo' || k === 'cluster') return true;
    }
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === 'both') return true;
    if (APPLIES_IN === 'fs')   return _isFsActive();
    if (APPLIES_IN === 'base') return !_isFsActive();
    return true;
  }

  function _resetState() {
    window.IRE_STATE.reelsExpanded = 0;
    window.IRE_STATE.currentMult   = START_MULT;
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      try { window.HookBus.setMult(START_MULT); } catch (_) {}
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onInfinityEngineReset', {}); } catch (_) {}
    }
  }

  var _hudTimerId = null;
  function _paintHud(reelCount, multX) {
    if (!SHOW_HUD) return;
    var hud = document.getElementById('ireHud');
    if (!hud) return;
    hud.textContent = reelCount + ' reels x' + multX;
    hud.setAttribute('aria-hidden', 'false');
    hud.classList.add('is-visible');
    hud.classList.add('ire-expand-anim');
    /* Cancel any prior pulse timer so rapid tumbles do not strip
     * is-visible mid-pulse for the freshest paint. */
    if (_hudTimerId) {
      try { clearTimeout(_hudTimerId); } catch (_) {}
    }
    _hudTimerId = setTimeout(function() {
      _hudTimerId = null;
      hud.classList.remove('is-visible');
      hud.classList.remove('ire-expand-anim');
    }, PULSE_MS);
  }

  function _onPreSpin() {
    if (_gridKindBlocked()) return;
    if (_isHwActive())      return;
    if (!_appliesNow())     return;
    _resetState();
  }

  function _onTumbleStep(payload) {
    if (_gridKindBlocked()) return;
    if (_isHwActive())      return;
    if (!_appliesNow())     return;

    var win = (payload && typeof payload.win === 'number') ? payload.win : 0;
    if (!(win > 0)) return;

    var budget = Math.max(0, MAX_REELS - BASE_REEL_COUNT);
    var curExpanded = window.IRE_STATE.reelsExpanded | 0;
    if (curExpanded >= budget) return;

    var nextExpanded = Math.min(budget, curExpanded + 1);
    var nextMult     = Math.min(MAX_MULT, (window.IRE_STATE.currentMult | 0) + GROW_PER_EXPAND);

    window.IRE_STATE.reelsExpanded = nextExpanded;
    window.IRE_STATE.currentMult   = nextMult;

    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      try { window.HookBus.setMult(nextMult); } catch (_) {}
    }

    var totalReels = BASE_REEL_COUNT + nextExpanded;
    _paintHud(totalReels, nextMult);

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onInfinityEngineExpanded', {
          expandedTo: totalReels,
          multX:      nextMult,
        });
      } catch (_) {}
    }
  }

  function _onSpinResult() {
    if (_gridKindBlocked()) return;
    if (_isHwActive())      return;
    if (!_appliesNow())     return;

    var expanded = window.IRE_STATE.reelsExpanded | 0;
    if (expanded <= 0) return;

    var finalReelCount = BASE_REEL_COUNT + expanded;
    var finalMult      = window.IRE_STATE.currentMult | 0;

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onInfinityEngineCommit', {
          finalReelCount: finalReelCount,
          finalMult:      finalMult,
        });
      } catch (_) {}
    }
  }

  function _onFsTrigger() {
    _resetState();
  }

  function _onFsEnd() {
    _resetState();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',      _onPreSpin,      { priority: 25 });
    window.HookBus.on('onTumbleStep', _onTumbleStep,   { priority: 25 });
    window.HookBus.on('onSpinResult', _onSpinResult,   { priority: 25 });
    window.HookBus.on('onFsTrigger',  _onFsTrigger,    { priority: 25 });
    window.HookBus.on('onFsEnd',      _onFsEnd,        { priority: 25 });
  }
})();
`;
}
