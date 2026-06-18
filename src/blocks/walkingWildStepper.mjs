/**
 * src/blocks/walkingWildStepper.mjs
 *
 * Wave LEGO-WWS — Walking Wild Stepper with progressive multiplier.
 *
 * Purpose
 * ───────
 *   Free Spins (or base, configurable) walking-wild variant where a SINGLE
 *   wild lands on one reel column and walks `stepCells` columns per spin
 *   in a fixed `direction`. Each step bumps a sticky multiplier by
 *   `growPerStep` (capped at `maxMult`). When the wild walks OFF the grid
 *   the state clears and a fresh spawn roll begins on the next spin.
 *   Distinct from:
 *     • walkingWild              (per-spin position + optional respin, no progressive mult)
 *     • multiplierLadder         (FS progressive — grows monotonically, no walker)
 *     • persistentMultiplier     (FS accumulator — never resets, no walker)
 *     • perFsSpinMultiplier      (per-FS-spin random — independent per spin)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "walking wild stepper" pattern — a wild reel stamp marches
 *   one column per spin, the on-screen ×N badge above/below the walker
 *   ticks up by a fixed step, and the walker eventually exits the grid,
 *   clearing the multiplier and re-arming the spawn roll.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitWalkingWildStepperCSS(cfg)
 *   emitWalkingWildStepperMarkup(cfg)
 *   emitWalkingWildStepperRuntime(cfg)
 *   nextPosition(current, direction, stepCells, reelCount)   (pure helper, exported for tests)
 *   nextMult(currentMult, growPerStep, maxMult)              (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onFsTrigger    (priority 35) — init WWS_STATE for FS round
 *     • onFsSpinResult (priority 35) — spawn / step / exit logic
 *     • onFsEnd        (priority 35) — clear state + DOM
 *     • preSpin        (priority 35) — no-op (walker persists across FS respins)
 *     • onSpinResult   (priority 35) — base-game branch when appliesIn='base'|'both'
 *   emits:
 *     • onWalkingWildSpawned { reel }
 *     • onWalkingWildStep    { fromReel, toReel, multX }
 *     • onWalkingWildExited  { stepsTotal, finalMult }
 *
 * Runtime contract
 * ────────────────
 *   window.WWS_STATE = { position: number|null, direction: 'left'|'right',
 *                        currentMult: number, stepsTotal: number }
 *
 * GDD config keys (model.walkingWildStepper)
 * ──────────────────────────────────────────
 *   { enabled, direction: 'left'|'right'|'random', stepCells: 1..3,
 *     startMult: 1..10, growPerStep: 1..5, maxMult: 2..100,
 *     triggerProbability: 0..1, wildSymbol: string,
 *     appliesIn: 'fs'|'base'|'both', glowColor: hex, pulseMs: 200..3000 }
 *
 * Performance budget: ≤ 0.25 ms per FS spin settle on 5×4 grid; 1
 * listener per event (wired-once via window.__WWS_WIRED__).
 *
 * a11y: walker cell carries aria-label="Walking wild multiplier Nx";
 * prefers-reduced-motion kills the pulse keyframe (cell remains tinted
 * as a static glow without strobing).
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * decisions beyond emitting the stepped multiplier to HookBus.setMult().
 */

const DIRECTIONS         = Object.freeze(['left', 'right', 'random']);
const APPLIES_IN         = Object.freeze(['fs', 'base', 'both']);
const STEP_CELLS_MIN     = 1;
const STEP_CELLS_MAX     = 3;
const START_MULT_MIN     = 1;
const START_MULT_MAX     = 10;
const GROW_MIN           = 1;
const GROW_MAX           = 5;
const MAX_MULT_MIN       = 2;
const MAX_MULT_MAX       = 100;
const PULSE_MIN_MS       = 200;
const PULSE_MAX_MS       = 3000;
const TRIGGER_PROB_MIN   = 0;
const TRIGGER_PROB_MAX   = 1;
const DEFAULT_REEL_COUNT = 5;

const HEX_COLOR_RE       = /^#[0-9a-fA-F]{3,8}$/;
const WILD_SYMBOL_RE     = /^[A-Za-z][A-Za-z0-9_]*$/;

const clampInt   = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampFloat = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    direction: 'right',
    stepCells: 1,
    startMult: 1,
    growPerStep: 1,
    maxMult: 10,
    triggerProbability: 0.3,
    wildSymbol: 'W',
    appliesIn: 'fs',
    glowColor: '#aaffaa',
    pulseMs: 800,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.walkingWildStepper) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (typeof src.direction === 'string' && DIRECTIONS.includes(src.direction)) {
    cfg.direction = src.direction;
  }

  if (Number.isFinite(src.stepCells)) {
    cfg.stepCells = clampInt(src.stepCells, STEP_CELLS_MIN, STEP_CELLS_MAX);
  }
  if (Number.isFinite(src.startMult)) {
    cfg.startMult = clampInt(src.startMult, START_MULT_MIN, START_MULT_MAX);
  }
  if (Number.isFinite(src.growPerStep)) {
    cfg.growPerStep = clampInt(src.growPerStep, GROW_MIN, GROW_MAX);
  }
  if (Number.isFinite(src.maxMult)) {
    cfg.maxMult = clampInt(src.maxMult, MAX_MULT_MIN, MAX_MULT_MAX);
  }
  if (Number.isFinite(src.triggerProbability)) {
    cfg.triggerProbability = clampFloat(src.triggerProbability, TRIGGER_PROB_MIN, TRIGGER_PROB_MAX);
  }

  if (typeof src.wildSymbol === 'string' && WILD_SYMBOL_RE.test(src.wildSymbol)) {
    cfg.wildSymbol = src.wildSymbol;
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

  /* Senior-grade invariant: startMult must never exceed maxMult. If a
   * GDD author misconfigures startMult above maxMult, clamp down to
   * preserve the cap-respected semantic. */
  if (cfg.startMult > cfg.maxMult) cfg.startMult = cfg.maxMult;

  return cfg;
}

/**
 * Pure helper: compute the next reel-column index after a single walk
 * step in the given direction. Returns `null` when the walker would
 * exit the grid (caller treats null as "exited, clear state").
 *
 * @param {number} current     current reel column (0-indexed)
 * @param {'left'|'right'} direction
 * @param {number} stepCells   how many columns to advance per step (≥ 1)
 * @param {number} reelCount   total reel columns (≥ 1)
 * @returns {number|null}
 */
export function nextPosition(current, direction, stepCells, reelCount) {
  if (!Number.isFinite(current))   return null;
  if (!Number.isFinite(stepCells)) return null;
  if (!Number.isFinite(reelCount)) return null;
  if (reelCount <= 0)              return null;
  const step = Math.max(1, Math.trunc(stepCells));
  const delta = direction === 'left' ? -step : step;
  const next  = Math.trunc(current) + delta;
  if (next < 0 || next >= reelCount) return null;
  return next;
}

/**
 * Pure helper: bump the sticky multiplier by `growPerStep`, capped at
 * `maxMult`. Already-at-cap inputs return cap unchanged.
 *
 * @param {number} currentMult
 * @param {number} growPerStep
 * @param {number} maxMult
 * @returns {number}
 */
export function nextMult(currentMult, growPerStep, maxMult) {
  const cur  = Number.isFinite(currentMult) ? Math.trunc(currentMult) : 1;
  const grow = Number.isFinite(growPerStep) ? Math.max(0, Math.trunc(growPerStep)) : 0;
  const cap  = Number.isFinite(maxMult)     ? Math.trunc(maxMult)     : cur;
  const bumped = cur + grow;
  return bumped > cap ? cap : bumped;
}

export function emitWalkingWildStepperCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ walkingWildStepper: cfg });
  if (!c.enabled) return `\n/* walkingWildStepper BLOCK (disabled) — no CSS */\n`;
  return `
/* ── walkingWildStepper BLOCK — src/blocks/walkingWildStepper.mjs ── */
.walking-wild-cell {
  position: relative;
  box-shadow:
    0 0 0 2px ${c.glowColor}cc,
    0 0 18px ${c.glowColor}88;
  z-index: 4;
  animation: wws-pulse ${c.pulseMs}ms ease-in-out infinite alternate;
}
.walking-wild-cell::after {
  content: attr(data-wws-mult);
  position: absolute;
  top: 4px;
  right: 6px;
  font: 900 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.glowColor};
  text-shadow: 0 0 6px rgba(0,0,0,0.85);
  pointer-events: none;
}
@keyframes wws-pulse {
  0%   { filter: brightness(1)    drop-shadow(0 0 0 ${c.glowColor}); }
  100% { filter: brightness(1.25) drop-shadow(0 0 10px ${c.glowColor}); }
}
@media (prefers-reduced-motion: reduce) {
  .walking-wild-cell { animation: none; }
}
`;
}

export function emitWalkingWildStepperMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ walkingWildStepper: cfg });
  if (!c.enabled) return `\n<!-- walkingWildStepper BLOCK (disabled) -->\n`;
  /* Walker badge mounts directly on the active grid cell at runtime via
   * the .walking-wild-cell class + data-wws-mult attribute, so no
   * server-emitted shell is required. The empty marker keeps the
   * builder orchestrator's `insert(markup)` slot deterministic. */
  return `
<!-- walkingWildStepper BLOCK — runtime-mounted on grid cell (no shell) -->
`;
}

export function emitWalkingWildStepperRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ walkingWildStepper: cfg });
  if (!c.enabled) return `\n// walkingWildStepper BLOCK (disabled) — no runtime\n`;

  const direction          = JSON.stringify(c.direction);
  const stepCells          = c.stepCells;
  const startMult          = c.startMult;
  const growPerStep        = c.growPerStep;
  const maxMult            = c.maxMult;
  const triggerProbability = c.triggerProbability;
  const wildSymbol         = JSON.stringify(c.wildSymbol);
  const appliesIn          = JSON.stringify(c.appliesIn);

  return `
/* ── walkingWildStepper BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__WWS_WIRED__) return;
  window.__WWS_WIRED__ = true;

  var DIRECTION_CFG  = ${direction};
  var STEP_CELLS     = ${stepCells};
  var START_MULT     = ${startMult};
  var GROW_PER_STEP  = ${growPerStep};
  var MAX_MULT       = ${maxMult};
  var TRIGGER_PROB   = ${triggerProbability};
  var WILD_SYMBOL    = ${wildSymbol};
  var APPLIES_IN     = ${appliesIn};
  var DEFAULT_REELS  = ${DEFAULT_REEL_COUNT};

  window.WWS_STATE = {
    position: null,
    direction: DIRECTION_CFG === 'left' ? 'left' : 'right',
    currentMult: START_MULT,
    stepsTotal: 0,
  };

  function _rng() {
    if (window.HookBus && typeof window.HookBus.getRng === 'function') {
      try { return window.HookBus.getRng(); } catch (_) {}
    }
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _reelCount() {
    if (Number.isFinite(window.REELS) && window.REELS > 0) return window.REELS;
    return DEFAULT_REELS;
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
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _gridKindBlocked() {
    /* Walking wilds require a rectangular reel grid. Skip wheel /
     * crash / plinko / cluster topologies where "reel column" is
     * undefined. Decision is layout-only, never game-specific. */
    if (window.GRID_KIND) {
      var k = String(window.GRID_KIND).toLowerCase();
      if (k === 'wheel' || k === 'crash' || k === 'plinko') return true;
    }
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === 'fs')   return _isFsActive();
    if (APPLIES_IN === 'base') return !_isFsActive();
    return true; /* 'both' */
  }

  function _resolveDirection() {
    if (DIRECTION_CFG === 'left' || DIRECTION_CFG === 'right') return DIRECTION_CFG;
    return _rng() < 0.5 ? 'left' : 'right';
  }

  function _nextPosition(current, direction, stepCells, reelCount) {
    var step = Math.max(1, Math.trunc(stepCells));
    var delta = direction === 'left' ? -step : step;
    var next = Math.trunc(current) + delta;
    if (next < 0 || next >= reelCount) return null;
    return next;
  }

  function _nextMult(curMult) {
    var bumped = curMult + GROW_PER_STEP;
    return bumped > MAX_MULT ? MAX_MULT : bumped;
  }

  function _clearWalkerDom() {
    var host = document.getElementById('gridHost');
    if (!host) return;
    var cells = host.querySelectorAll('.walking-wild-cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('walking-wild-cell');
      cells[i].removeAttribute('data-wws-mult');
      cells[i].removeAttribute('aria-label');
    }
  }

  function _paintWalker(reel, multX) {
    var host = document.getElementById('gridHost');
    if (!host) return;
    var REELS = _reelCount();
    var cells = host.querySelectorAll('.cell');
    if (!cells || cells.length === 0) return;
    /* Paint the walker on row 0 of the active reel column. Renderer
     * convention: cells are row-major, so column "reel" on row 0 is
     * index "reel". If the active game uses a different mount row,
     * downstream blocks can override via a custom selector — never
     * patched here game-specifically. */
    var idx = reel;
    if (idx < 0 || idx >= cells.length) return;
    var cell = cells[idx];
    if (!cell) return;
    cell.classList.add('walking-wild-cell');
    cell.setAttribute('data-wws-mult', 'x' + multX);
    cell.setAttribute('data-symbol', WILD_SYMBOL);
    cell.setAttribute('aria-label', 'Walking wild multiplier ' + multX + 'x');
  }

  function _resetState() {
    window.WWS_STATE.position    = null;
    window.WWS_STATE.direction   = DIRECTION_CFG === 'left' ? 'left' : 'right';
    window.WWS_STATE.currentMult = START_MULT;
    window.WWS_STATE.stepsTotal  = 0;
  }

  function _trySpawn() {
    if (TRIGGER_PROB <= 0) return false;
    var roll = _rng();
    if (roll >= TRIGGER_PROB) return false;
    var REELS = _reelCount();
    /* Spawn column depends on direction: rightward walker starts on
     * column 0 (so it has room to walk); leftward walker starts on
     * column REELS-1; random direction picks edge to match. */
    var dir = _resolveDirection();
    var startReel = dir === 'left' ? (REELS - 1) : 0;
    window.WWS_STATE.position    = startReel;
    window.WWS_STATE.direction   = dir;
    window.WWS_STATE.currentMult = START_MULT;
    window.WWS_STATE.stepsTotal  = 0;
    _paintWalker(startReel, START_MULT);
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(START_MULT);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onWalkingWildSpawned', { reel: startReel }); } catch (_) {}
    }
    return true;
  }

  function _stepOrExit() {
    var REELS = _reelCount();
    var from  = window.WWS_STATE.position;
    var to    = _nextPosition(from, window.WWS_STATE.direction, STEP_CELLS, REELS);
    _clearWalkerDom();
    if (to === null) {
      var finalMult  = window.WWS_STATE.currentMult;
      var stepsTotal = window.WWS_STATE.stepsTotal;
      _resetState();
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onWalkingWildExited', {
            stepsTotal: stepsTotal,
            finalMult: finalMult,
          });
        } catch (_) {}
      }
      return;
    }
    var bumped = _nextMult(window.WWS_STATE.currentMult);
    window.WWS_STATE.position    = to;
    window.WWS_STATE.currentMult = bumped;
    window.WWS_STATE.stepsTotal += 1;
    _paintWalker(to, bumped);
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(bumped);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onWalkingWildStep', {
          fromReel: from,
          toReel: to,
          multX: bumped,
        });
      } catch (_) {}
    }
  }

  function _runStepperTick() {
    if (_gridKindBlocked()) return;
    if (_isHwActive())       return;
    if (!_appliesNow())      return;
    if (window.WWS_STATE.position === null) {
      _trySpawn();
      return;
    }
    _stepOrExit();
  }

  function _onFsTrigger() {
    _clearWalkerDom();
    _resetState();
  }

  function _onFsSpinResult() {
    _runStepperTick();
  }

  function _onFsEnd() {
    _clearWalkerDom();
    _resetState();
  }

  function _onPreSpin() {
    /* No-op: walker persists across FS respins. Base-game pre-spin
     * cleanup is handled by the onSpinResult branch below when
     * APPLIES_IN is 'base' or 'both' — the walker DOM is repainted on
     * each tick so stale classes never leak between rounds. */
  }

  function _onBaseSpinResult() {
    if (APPLIES_IN !== 'base' && APPLIES_IN !== 'both') return;
    if (_isFsActive()) return;
    _runStepperTick();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',    _onFsTrigger,       { priority: 35 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult,    { priority: 35 });
    window.HookBus.on('onFsEnd',        _onFsEnd,           { priority: 35 });
    window.HookBus.on('preSpin',        _onPreSpin,         { priority: 35 });
    if (APPLIES_IN === 'base' || APPLIES_IN === 'both') {
      window.HookBus.on('onSpinResult', _onBaseSpinResult, { priority: 35 });
    }
  }
})();
`;
}
