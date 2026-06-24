import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/extendedWildCountdown.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK C — EXTENDED WILD COUNTDOWN.
 *
 * Industry-canonical "extended wild" paradigm presentation + state block.
 *
 *   A wild that lands on the grid PERSISTS for N additional spins, with
 *   a visible per-cell countdown chip ("3" → "2" → "1") that ticks down
 *   on every completed spin. When the counter reaches zero the wild is
 *   cleared from the registry and the visible chip is removed from the
 *   DOM.
 *
 *   Distinct from related wild persistence blocks:
 *
 *     • `stickyWild`                 — sticky for one FS ROUND only;
 *                                      cleared at the end of FS.
 *     • `cascadingWildPersistence`   — sticky within a single TUMBLE
 *                                      CHAIN inside one spin; cleared
 *                                      between spins.
 *     • `walkingWild`                — moves one cell per FS spin; this
 *                                      block does NOT move the wild,
 *                                      only counts down its lifetime.
 *     • `extendedWildCountdown`      — per-spin N-decrement counter that
 *       (this block)                   survives BASE↔FS phase changes
 *                                      when `crossPhase: true`.
 *
 * Detection (auto-enable)
 * ──────────────────────
 *   • model.wild.special.extended_wild = { extraSpins: N, evidence }
 *   • model.extendedWildCountdown      = { …user overrides }
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitExtendedWildCountdownCSS(cfg)
 *   emitExtendedWildCountdownMarkup(cfg)
 *   emitExtendedWildCountdownRuntime(cfg)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onSpinResult (priority +20) — register new wild cells
 *     • preSpin      (priority -10) — decrement registered counters,
 *                                      expire wilds whose counter hit 0
 *   emits:
 *     • onExtendedWildRegistered  { cellKey, spins }
 *     • onExtendedWildExpired     { cellKey }
 *
 * Runtime contract
 * ────────────────
 *   window.extendedWildAPI = {
 *     register(cellRef, spins), decrementAll(), state, schemaVersion
 *   }
 *
 * Senior-grade: wired-once via __EWCD_WIRED__, idempotent emit, XSS-safe
 * (no eval / document.write / user-data innerHTML), vendor-neutral,
 * prefers-reduced-motion respected.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE = /^[A-Z]{1,4}$/;
const ALLOWED_MODES = Object.freeze(['base', 'fs', 'both']);
const ALLOWED_DECREMENT_ON = Object.freeze([
  'spinComplete',
  'fsSpinOnly',
  'baseSpinOnly',
]);

const EXTRA_SPINS_MIN = 1;
const EXTRA_SPINS_MAX = 99;
const FONT_PX_MIN = 8;
const FONT_PX_MAX = 32;
const PULSE_MS_MIN = 100;
const PULSE_MS_MAX = 3000;

function _clampInt(n, lo, hi, fallback) {
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    extraSpins: 3,
    wildSymbolId: 'W',
    countdownColor: '#ffcc00',
    countdownFontPx: 14,
    pulseMs: 420,
    mode: 'both',
    crossPhase: true,
    decrementOn: 'spinComplete',
    schemaVersion: '1',
  });
}

export function resolveConfig(model = {}) {
  const def = defaultConfig();
  const src = (model && model.extendedWildCountdown) || {};

  // auto-enable detection sources
  const wildSpecial = (model && model.wild && model.wild.special) || {};
  const hasExtendedWildSpecial =
    wildSpecial.extended_wild != null && typeof wildSpecial.extended_wild === 'object';
  const hasUserConfig = model && model.extendedWildCountdown != null;

  let enabled = def.enabled;
  if (src.enabled === true) enabled = true;
  else if (src.enabled === false) enabled = false;
  else if (hasExtendedWildSpecial || hasUserConfig) enabled = true;

  // extraSpins — seed from parser-detected extra_spins when present
  let extraSpins = def.extraSpins;
  if (hasExtendedWildSpecial && Number.isFinite(wildSpecial.extended_wild.extraSpins)) {
    const n = wildSpecial.extended_wild.extraSpins;
    if (n >= EXTRA_SPINS_MIN) extraSpins = _clampInt(n, EXTRA_SPINS_MIN, EXTRA_SPINS_MAX, def.extraSpins);
  }
  if (src.extraSpins != null) {
    extraSpins = _clampInt(src.extraSpins, EXTRA_SPINS_MIN, EXTRA_SPINS_MAX, def.extraSpins);
  }

  let wildSymbolId = def.wildSymbolId;
  if (typeof src.wildSymbolId === 'string' && SYMBOL_ID_RE.test(src.wildSymbolId)) {
    wildSymbolId = src.wildSymbolId;
  }

  let countdownColor = def.countdownColor;
  if (typeof src.countdownColor === 'string' && HEX_COLOR_RE.test(src.countdownColor)) {
    countdownColor = src.countdownColor;
  }

  const countdownFontPx = _clampInt(
    src.countdownFontPx != null ? src.countdownFontPx : def.countdownFontPx,
    FONT_PX_MIN, FONT_PX_MAX, def.countdownFontPx,
  );

  const pulseMs = _clampInt(
    src.pulseMs != null ? src.pulseMs : def.pulseMs,
    PULSE_MS_MIN, PULSE_MS_MAX, def.pulseMs,
  );

  let mode = def.mode;
  if (typeof src.mode === 'string' && ALLOWED_MODES.includes(src.mode)) {
    mode = src.mode;
  }

  let crossPhase = def.crossPhase;
  if (src.crossPhase === false) crossPhase = false;
  else if (src.crossPhase === true) crossPhase = true;

  let decrementOn = def.decrementOn;
  if (typeof src.decrementOn === 'string' && ALLOWED_DECREMENT_ON.includes(src.decrementOn)) {
    decrementOn = src.decrementOn;
  }

  return Object.freeze({
    enabled,
    extraSpins,
    wildSymbolId,
    countdownColor,
    countdownFontPx,
    pulseMs,
    mode,
    crossPhase,
    decrementOn,
    schemaVersion: '1',
  });
}

export function emitExtendedWildCountdownCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const color  = cfg.countdownColor;
  const fontPx = cfg.countdownFontPx;
  const pulse  = cfg.pulseMs;
  return `
/* ─── extendedWildCountdown — src/blocks/extendedWildCountdown.mjs ─── */
.ewcd-counter {
  position: absolute;
  top: 2px;
  right: 2px;
  color: ${color};
  font-size: ${fontPx}px;
  font-weight: 700;
  text-shadow: 0 0 4px rgba(0,0,0,0.6);
  pointer-events: none;
  z-index: 7;
  letter-spacing: 0.02em;
  font-family: system-ui, -apple-system, sans-serif;
}
.ewcd-cell-glow {
  box-shadow: inset 0 0 8px ${color};
  animation: ewcd-pulse ${pulse}ms infinite;
}
.ewcd-final-pop {
  animation: ewcd-pop 320ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes ewcd-pulse {
  0%   { box-shadow: inset 0 0 6px  ${color}; }
  50%  { box-shadow: inset 0 0 14px ${color}; }
  100% { box-shadow: inset 0 0 6px  ${color}; }
}
@keyframes ewcd-pop {
  0%   { transform: scale(1);    opacity: 1; }
  50%  { transform: scale(1.32); opacity: 1; }
  100% { transform: scale(1);    opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
  .ewcd-cell-glow  { animation: none; }
  .ewcd-final-pop  { animation: none; }
}
`;
}

export function emitExtendedWildCountdownMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="ewcd-stage" class="ewcd-overlay" aria-hidden="true" data-ewcd-schema="1"></div>`, 'extendedWildCountdown');
}

export function emitExtendedWildCountdownRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const wildSym     = cfg.wildSymbolId;
  const extraSpins  = cfg.extraSpins;
  const mode        = cfg.mode;
  const crossPhase  = cfg.crossPhase;
  const decrementOn = cfg.decrementOn;

  return `
/* ─── extendedWildCountdown runtime ─────────────────────────────── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__EWCD_WIRED__) return;
  window.__EWCD_WIRED__ = true;

  var WILD_SYM     = ${JSON.stringify(wildSym)}.toUpperCase();
  var EXTRA_SPINS  = ${JSON.stringify(extraSpins)};
  var MODE         = ${JSON.stringify(mode)};
  var CROSS_PHASE  = ${JSON.stringify(crossPhase)};
  var DECREMENT_ON = ${JSON.stringify(decrementOn)};

  /* state — registry keyed by 'reel,row'. Each entry stores remaining
   * spin lifetime and the cell DOM ref (or null when off-screen during
   * a phase swap). */
  var state = {
    registered: {},          /* cellKey → { spins, cellRef } */
    schemaVersion: '1',
  };

  function _cellKey(cell) {
    if (!cell) return '';
    var reel = cell.getAttribute ? (cell.getAttribute('data-reel') || '') : '';
    var row  = cell.getAttribute ? (cell.getAttribute('data-row')  || '') : '';
    return reel + ',' + row;
  }

  function _safeText(cell, txt) {
    /* textContent only — never innerHTML for user-derived text. */
    if (cell && typeof cell === 'object' && 'textContent' in cell) {
      cell.textContent = String(txt);
    }
  }

  function _paintChip(cellRef, spins) {
    if (!cellRef) return;
    var chip = cellRef.querySelector && cellRef.querySelector('.ewcd-counter');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'ewcd-counter';
      cellRef.appendChild(chip);
    }
    _safeText(chip, spins);
    cellRef.setAttribute('data-ewcd-spins', String(spins));
    cellRef.classList.add('ewcd-cell-glow');
  }

  function _clearChip(cellRef) {
    if (!cellRef) return;
    var chip = cellRef.querySelector && cellRef.querySelector('.ewcd-counter');
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    cellRef.removeAttribute('data-ewcd-spins');
    cellRef.classList.remove('ewcd-cell-glow');
    cellRef.classList.add('ewcd-final-pop');
    setTimeout(function() {
      cellRef.classList.remove('ewcd-final-pop');
    }, 360);
  }

  function _phaseAllowsRegistration() {
    if (MODE === 'both') return true;
    var phase = (window.GAME_PHASE || 'base');
    if (MODE === 'base' && phase === 'base') return true;
    if (MODE === 'fs'   && phase === 'fs')   return true;
    return false;
  }

  function _phaseAllowsDecrement() {
    var phase = (window.GAME_PHASE || 'base');
    if (DECREMENT_ON === 'spinComplete') return true;
    if (DECREMENT_ON === 'fsSpinOnly'   && phase === 'fs')   return true;
    if (DECREMENT_ON === 'baseSpinOnly' && phase === 'base') return true;
    return false;
  }

  function register(cellRef, spins) {
    if (!cellRef) return;
    var key = _cellKey(cellRef);
    if (!key || key === ',') return;
    var n = Number.isFinite(spins) ? Math.floor(spins) : EXTRA_SPINS;
    if (n < 1) return;
    state.registered[key] = { spins: n, cellRef: cellRef };
    _paintChip(cellRef, n);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onExtendedWildRegistered', { cellKey: key, spins: n }); }
      catch (e) { try { console && console.warn && console.warn('[ewcd] emit failed', e); } catch (_) {} }
    }
  }

  function decrementAll() {
    if (!_phaseAllowsDecrement()) return;
    var keys = Object.keys(state.registered);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var rec = state.registered[key];
      if (!rec) continue;
      rec.spins -= 1;
      if (rec.spins <= 0) {
        _clearChip(rec.cellRef);
        delete state.registered[key];
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          try { window.HookBus.emit('onExtendedWildExpired', { cellKey: key }); }
          catch (e) { try { console && console.warn && console.warn('[ewcd] emit failed', e); } catch (_) {} }
        }
      } else {
        _paintChip(rec.cellRef, rec.spins);
      }
    }
  }

  function _scanForNewWilds() {
    if (!_phaseAllowsRegistration()) return;
    var cells = document.querySelectorAll('.cell');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (sym !== WILD_SYM) continue;
      var key = _cellKey(cell);
      if (!key || key === ',') continue;
      if (state.registered[key]) {
        // already tracked — refresh cellRef and repaint
        state.registered[key].cellRef = cell;
        _paintChip(cell, state.registered[key].spins);
        continue;
      }
      register(cell, EXTRA_SPINS);
    }
  }

  function _onPhaseChange() {
    if (CROSS_PHASE) return; /* keep counters intact across base↔FS */
    /* not crossing phases — drop everything when phase boundary crossed. */
    var keys = Object.keys(state.registered);
    for (var i = 0; i < keys.length; i++) {
      var rec = state.registered[keys[i]];
      if (rec) _clearChip(rec.cellRef);
    }
    state.registered = {};
  }

  /* Expose API */
  window.extendedWildAPI = {
    register: register,
    decrementAll: decrementAll,
    state: state,
    schemaVersion: '1',
  };

  /* Wire HookBus — feature lifecycle. */
  if (window.HookBus && typeof window.HookBus.on === 'function') {
    /* onSpinResult: priority +20 — runs AFTER engines settle the grid
     * so freshly landed wilds are visible in the DOM. */
    window.HookBus.on('onSpinResult', function() {
      _scanForNewWilds();
    }, { priority: 20 });

    /* preSpin: priority -10 — runs LATE in preSpin so other blocks have
     * the chance to mutate state first; we then decrement persisted
     * registrants and expire those that reach 0. */
    window.HookBus.on('preSpin', function() {
      decrementAll();
    }, { priority: -10 });

    /* Phase change observer (optional — engines that publish a
     * 'onPhaseChange' event get the cross-phase clear when configured). */
    window.HookBus.on('onPhaseChange', function() {
      _onPhaseChange();
    }, { priority: 0 });
  }
})();
`;
}
