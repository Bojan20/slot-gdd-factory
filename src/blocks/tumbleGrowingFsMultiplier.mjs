import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/tumbleGrowingFsMultiplier.mjs
 *
 * Wave LEGO-M2 — Tumble-growing FS multiplier.
 *
 * Purpose
 * ───────
 *   For Free Spins rounds where the multiplier GROWS with each tumble /
 *   cascade step inside a SINGLE FS spin. On every new FS spin the
 *   counter resets to `startMult` and bumps by `growPerTumble` per
 *   tumble step (capped at `maxMult`). Distinct from:
 *     • perFsSpinMultiplier   (independent random draw per FS spin)
 *     • persistentMultiplier  (accumulates across spins, never resets)
 *     • multiplierLadder      (progressive ladder, not tumble-driven)
 *     • multiplierOrb         (per-cell symbol-bound multiplier)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "cascade-bump multiplier in FS" pattern — chip displays the
 *   current value over the reels, ticks +N for each cascade resolution
 *   inside the same FS spin, resets at the next FS spin.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitTumbleGrowingFsMultiplierCSS(cfg)
 *   emitTumbleGrowingFsMultiplierMarkup(cfg)
 *   emitTumbleGrowingFsMultiplierRuntime(cfg)
 *   computeNextMult(current, growPerTumble, maxMult)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onFsSpinResult (priority 30) — reset chip to startMult, set HookBus.setMult
 *     • onTumbleStep   (priority 30) — bump current += growPerTumble (capped), set HookBus.setMult
 *     • onFsEnd        (priority 30) — clear chip + state
 *     • preSpin        (priority 30) — clear if NOT in FS (safety)
 *   emits:
 *     • onTumbleMultiplierGrown  { step, value }
 *     • onTumbleMultiplierReset  { value }
 *
 * Runtime contract
 * ────────────────
 *   window.TGM_STATE = { current: number, step: number }
 *
 * GDD config keys (model.tumbleGrowingFsMultiplier)
 * ─────────────────────────────────────────────────
 *   { enabled, startMult, growPerTumble, maxMult,
 *     chipPosition: 'top'|'topRight'|'topLeft'|'bottom',
 *     fontSizePx, chipColor, pulseMs }
 *
 * Performance budget: ≤ 0.2 ms per tumble step on 5×4 grid; 1 listener
 * per event (wired-once via window.__TGFM_WIRED__).
 *
 * a11y: chip has role=status + aria-live=polite so screen readers
 * announce "Multiplier 5x" on each grow; prefers-reduced-motion kills
 * the pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting current value to HookBus.setMult on each step.
 */

const CHIP_POSITIONS  = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const FONT_SIZE_MIN   = 12;
const FONT_SIZE_MAX   = 48;
const PULSE_MIN_MS    = 200;
const PULSE_MAX_MS    = 2000;

const START_MULT_MIN  = 1;
const START_MULT_MAX  = 10;
const GROW_MIN        = 1;
const GROW_MAX        = 5;
const MAX_MULT_MIN    = 2;
const MAX_MULT_MAX    = 1000;

const HEX_COLOR_RE    = /^#[0-9a-fA-F]{3,8}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    startMult: 1,
    growPerTumble: 1,
    maxMult: 100,
    chipPosition: 'top',
    fontSizePx: 24,
    chipColor: '#a0ffd0',
    pulseMs: 500,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.tumbleGrowingFsMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.startMult))     cfg.startMult     = clampInt(src.startMult,     START_MULT_MIN, START_MULT_MAX);
  if (Number.isFinite(src.growPerTumble)) cfg.growPerTumble = clampInt(src.growPerTumble, GROW_MIN,       GROW_MAX);
  if (Number.isFinite(src.maxMult))       cfg.maxMult       = clampInt(src.maxMult,       MAX_MULT_MIN,   MAX_MULT_MAX);

  if (typeof src.chipPosition === 'string' && CHIP_POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (Number.isFinite(src.pulseMs))    cfg.pulseMs    = clampInt(src.pulseMs,    PULSE_MIN_MS,  PULSE_MAX_MS);
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;

  /* Defensive consistency: maxMult must never be < startMult. */
  if (cfg.maxMult < cfg.startMult) cfg.maxMult = cfg.startMult;

  return cfg;
}

/**
 * Pure helper: next multiplier value after a tumble bump.
 * Returns min(current + growPerTumble, maxMult). Pure function —
 * exported so tests can verify cap semantics without running the IIFE.
 */
export function computeNextMult(current, growPerTumble, maxMult) {
  const c = Number.isFinite(current)       ? current       : 1;
  const g = Number.isFinite(growPerTumble) ? growPerTumble : 1;
  const m = Number.isFinite(maxMult)       ? maxMult       : 100;
  const next = c + g;
  return next > m ? m : next;
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 12px; left: 50%; transform: translateX(-50%);';
    case 'topRight': return 'top: 12px; right: 12px;';
    case 'topLeft':  return 'top: 12px; left: 12px;';
    case 'top':
    default:         return 'top: 12px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitTumbleGrowingFsMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: cfg });
  if (!c.enabled) return `\n/* tumbleGrowingFsMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── tumbleGrowingFsMultiplier BLOCK — src/blocks/tumbleGrowingFsMultiplier.mjs ── */
.tgfm-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.chipColor};
  text-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 12px rgba(160,255,208,0.5);
  pointer-events: none;
  z-index: 70;
  opacity: 0;
  transition: opacity 250ms ease, transform 250ms ease;
}
.tgfm-chip.is-visible {
  opacity: 1;
}
.tgfm-chip.is-pulsing {
  animation: tgfm-pulse ${c.pulseMs}ms ease-out;
}
@keyframes tgfm-pulse {
  0%   { transform: translateY(0) scale(1);    }
  40%  { transform: translateY(-4px) scale(1.25); }
  100% { transform: translateY(0) scale(1);    }
}
@media (prefers-reduced-motion: reduce) {
  .tgfm-chip.is-pulsing { animation: none; }
}
`;
}

export function emitTumbleGrowingFsMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: cfg });
  if (!c.enabled) return `\n<!-- tumbleGrowingFsMultiplier BLOCK (disabled) -->\n`;
  return tagBlockMarkup(`
<!-- tumbleGrowingFsMultiplier BLOCK — server-emitted markup -->
<div class="tgfm-chip" id="tgfmChip" role="status" aria-live="polite" aria-hidden="true"></div>
`, 'tumbleGrowingFsMultiplier');
}

export function emitTumbleGrowingFsMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: cfg });
  if (!c.enabled) return `\n// tumbleGrowingFsMultiplier BLOCK (disabled) — no runtime\n`;

  return `
/* ── tumbleGrowingFsMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__TGFM_WIRED__) return;
  window.__TGFM_WIRED__ = true;

  var START_MULT     = ${c.startMult};
  var GROW_PER_TUMBLE = ${c.growPerTumble};
  var MAX_MULT       = ${c.maxMult};
  var PULSE_MS       = ${c.pulseMs};

  window.TGM_STATE = {
    current: START_MULT,
    step: 0,
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
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _paint(value) {
    var chip = document.getElementById('tgfmChip');
    if (!chip) return;
    chip.textContent = 'x' + value;
    chip.classList.add('is-visible');
    chip.setAttribute('aria-hidden', 'false');
    /* Trigger pulse: remove + force reflow + re-add. */
    chip.classList.remove('is-pulsing');
    void chip.offsetWidth;
    chip.classList.add('is-pulsing');
    setTimeout(function() {
      if (chip) chip.classList.remove('is-pulsing');
    }, PULSE_MS + 20);
  }

  function _clear() {
    window.TGM_STATE.current = START_MULT;
    window.TGM_STATE.step = 0;
    var chip = document.getElementById('tgfmChip');
    if (chip) {
      chip.classList.remove('is-visible');
      chip.classList.remove('is-pulsing');
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = '';
    }
  }

  function _emit(evt, payload) {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit(evt, payload); } catch (_) {}
    }
  }

  function _setMult(v) {
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      try { window.HookBus.setMult(v); } catch (_) {}
    }
  }

  function _onFsSpinResult() {
    if (_isHwActive()) return;
    if (!_isFsActive()) return;
    window.TGM_STATE.current = START_MULT;
    window.TGM_STATE.step = 0;
    _setMult(START_MULT);
    _paint(START_MULT);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onTumbleMultiplierReset', { value: START_MULT }); } catch (_) {}
    }
  }

  function _onTumbleStep() {
    if (_isHwActive()) return;
    if (!_isFsActive()) return;
    var cur = window.TGM_STATE.current;
    var next = cur + GROW_PER_TUMBLE;
    if (next > MAX_MULT) next = MAX_MULT;
    window.TGM_STATE.current = next;
    window.TGM_STATE.step += 1;
    _setMult(next);
    _paint(next);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onTumbleMultiplierGrown', { step: window.TGM_STATE.step, value: next }); } catch (_) {}
    }
  }

  function _onFsEnd() {
    _clear();
  }

  function _onPreSpin() {
    if (!_isFsActive()) _clear();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsSpinResult', _onFsSpinResult, { priority: 30 });
    window.HookBus.on('onTumbleStep',   _onTumbleStep,   { priority: 30 });
    window.HookBus.on('onFsEnd',        _onFsEnd,        { priority: 30 });
    window.HookBus.on('preSpin',        _onPreSpin,      { priority: 30 });
  }
})();
`;
}
