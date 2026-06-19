/**
 * src/blocks/cascadingWildPersistence.mjs
 *
 * Wave LEGO-W2.1 — Cascading wild persistence.
 *
 * Purpose
 * ───────
 *   On cascade / tumble slots, a wild that landed on the grid stays
 *   PINNED for the rest of the tumble chain. New cells dropping into
 *   neighbouring positions do not overwrite the wild — it remains a
 *   sticky participant in every subsequent payout evaluation until
 *   the chain ends (no further wins) or the spin tail completes.
 *
 *   Distinct from existing wild blocks:
 *     • `stickyWild.mjs`        — sticky during a single SPIN (next
 *                                 base spin clears it). This block is
 *                                 sticky during a single TUMBLE CHAIN
 *                                 within one spin.
 *     • `expandingWild.mjs`     — wild expands to fill a reel column
 *     • `walkingWild.mjs`       — wild moves one cell per FS spin
 *     • `wildReel.mjs`          — entire reel becomes wild
 *
 *   Industry-typical persistence shape: each landed wild gets a `data-
 *   wild-pinned` attribute + `is-cascade-pinned` class on the cell.
 *   `onTumbleStep` listener re-asserts the pin every step so the engine
 *   refilling the grid honours it.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Cascade-pays slots with persistent wild bonus mechanic — wilds
 *   "lock in" until the chain ends. Visible CSS frame + optional
 *   counter chip showing "N pinned wilds this chain".
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitCascadingWildPersistenceCSS(cfg)
 *   emitCascadingWildPersistenceRuntime(cfg, model)
 *   shouldPinCell(symbol, wildSymbolId)     (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • preSpin       (priority 24) — clear all pins (new spin)
 *     • onSpinResult  (priority 24) — pin every wild landed by base spin
 *     • onTumbleStep  (priority 24) — re-pin survivors + new wilds landed
 *     • postSpin      (priority 24) — clear pins (spin tail)
 *   emits:
 *     • onCascadingWildPinned   { cellKey, totalPinned, chainStep }
 *
 * Runtime contract
 * ────────────────
 *   window.CASCADING_WILD_STATE = {
 *     pinnedKeys: string[],   // 'reel,row' coordinates pinned this chain
 *     chainStep: number,      // tumble step index within this spin
 *   }
 *
 * GDD config keys (model.cascadingWildPersistence)
 * ─────────────────────────────────────────────
 *   { enabled, wildSymbolId, pinColor, showCounter, counterPosition }
 *
 * Performance: O(visible cells) per step on a 5×5 worst case ≈ 25
 * cells, ≤ 0.4 ms typical. No DOM creation per step — only attr/class
 * mutation on existing cells.
 *
 * a11y: pinned cells get aria-label="Wild (locked this round)" + role=note.
 *
 * Senior-grade: wired-once via __CASCADING_WILD_WIRED__, idempotent
 * emit, XSS-safe, vendor-neutral, prefers-reduced-motion respected.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z]{1,4}$/;
const POSITIONS     = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbolId: 'W',
    pinColor: '#7af2c8',
    showCounter: true,
    counterPosition: 'topLeft',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.cascadingWildPersistence) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.wildSymbolId === 'string' && SYMBOL_ID_RE.test(src.wildSymbolId)) {
    cfg.wildSymbolId = src.wildSymbolId;
  }
  if (typeof src.pinColor === 'string' && HEX_COLOR_RE.test(src.pinColor)) cfg.pinColor = src.pinColor;
  if (src.showCounter === false) cfg.showCounter = false;
  if (typeof src.counterPosition === 'string' && POSITIONS.includes(src.counterPosition)) {
    cfg.counterPosition = src.counterPosition;
  }
  return cfg;
}

/**
 * Pure: decide whether a cell with the given rendered symbol should be
 * pinned, against the configured wild symbol id. Case-insensitive on the
 * id so 'W'/'w' both match. Returns false on missing inputs.
 */
export function shouldPinCell(symbol, wildSymbolId) {
  if (typeof symbol !== 'string' || symbol.length === 0) return false;
  if (typeof wildSymbolId !== 'string' || wildSymbolId.length === 0) return false;
  return symbol.trim().toUpperCase() === wildSymbolId.toUpperCase();
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 12px; left: 50%; transform: translateX(-50%);';
    case 'topRight': return 'top: 80px; right: 12px;';
    case 'topLeft':  return 'top: 80px; left: 12px;';
    case 'top':
    default:         return 'top: 80px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitCascadingWildPersistenceCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ cascadingWildPersistence: cfg });
  if (!c.enabled) return `\n/* cascadingWildPersistence BLOCK (disabled) — no CSS */\n`;
  return `
/* ── cascadingWildPersistence BLOCK — src/blocks/cascadingWildPersistence.mjs ── */
.cell.is-cascade-pinned {
  position: relative;
  outline: 2px solid ${c.pinColor};
  outline-offset: -2px;
  box-shadow: 0 0 14px ${c.pinColor}, inset 0 0 10px ${c.pinColor}aa;
  z-index: 4;
}
.cell.is-cascade-pinned::after {
  content: "📍";
  position: absolute;
  top: 3px;
  right: 4px;
  font-size: 11px;
  pointer-events: none;
}
.cell.is-cascade-pinned.is-fresh-pin {
  animation: cwp-fresh 700ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes cwp-fresh {
  0%   { transform: scale(1.18); box-shadow: 0 0 28px ${c.pinColor}; }
  100% { transform: scale(1);    box-shadow: 0 0 14px ${c.pinColor}; }
}
.cwp-counter {
  position: absolute;
  ${positionCss(c.counterPosition)}
  background: linear-gradient(180deg, rgba(10,30,22,.92), rgba(4,12,9,.92));
  border: 1px solid ${c.pinColor};
  color: ${c.pinColor};
  font: 800 13px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 10px;
  border-radius: 14px;
  z-index: 62;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.cwp-counter.is-visible { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .cell.is-cascade-pinned.is-fresh-pin { animation: none; }
  .cwp-counter { transition: none; }
}
`;
}

export function emitCascadingWildPersistenceRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ cascadingWildPersistence: cfg });
  if (!c.enabled) return `\n// cascadingWildPersistence BLOCK (disabled) — no runtime\n`;

  const wildSym     = c.wildSymbolId;
  const showCounter = c.showCounter;

  return `
/* ── cascadingWildPersistence BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CASCADING_WILD_WIRED__) return;
  window.__CASCADING_WILD_WIRED__ = true;

  var WILD_SYM     = ${JSON.stringify(wildSym)}.toUpperCase();
  var SHOW_COUNTER = ${showCounter};

  window.CASCADING_WILD_STATE = { pinnedKeys: [], chainStep: 0 };

  function _cellKey(cell) {
    return (cell.getAttribute('data-reel') || '') + ',' + (cell.getAttribute('data-row') || '');
  }

  function _ensureCounter() {
    if (!SHOW_COUNTER) return null;
    var existing = document.getElementById('cwpCounter');
    if (existing) return existing;
    var host = document.getElementById('gridHost') || document.body;
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'cwp-counter';
    el.id = 'cwpCounter';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    return el;
  }

  function _renderCounter() {
    var el = _ensureCounter();
    if (!el) return;
    var n = window.CASCADING_WILD_STATE.pinnedKeys.length;
    if (n === 0) {
      el.classList.remove('is-visible');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'PINNED WILDS ' + n;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
  }

  function _pinWildsOnGrid(isStep) {
    /* FIX-5 (deep QA #20, 2026-06-19) — extend WWS ownership guard from
     * _reAssertPins down to ALL DOM-pinning writes. Previously the active-
     * flag check lived only in the tumble re-assert path; an onSpinResult
     * pin would over-write walking-wild ownership on the same cells
     * before _reAssertPins ever ran. Now: any walking-active FS spin
     * yields wild-position writes to walkingWildStepper exclusively. */
    if (typeof window.WWS_STATE !== 'undefined'
        && window.WWS_STATE
        && window.WWS_STATE.active === true) {
      return;
    }
    var cells = document.querySelectorAll('.cell');
    var fresh = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (sym !== WILD_SYM) continue;
      /* FIX-5 (deep QA #20): also skip cells already owned by walking
       * wild paint so chained scans cannot reclaim them mid-spin. */
      if (cell.classList.contains('walking-wild-cell')) continue;
      var key = _cellKey(cell);
      if (window.CASCADING_WILD_STATE.pinnedKeys.indexOf(key) === -1) {
        window.CASCADING_WILD_STATE.pinnedKeys.push(key);
        fresh.push(key);
      }
      cell.classList.add('is-cascade-pinned');
      cell.setAttribute('aria-label', 'Wild (locked this round)');
      cell.setAttribute('role', 'note');
      if (fresh.indexOf(key) !== -1) {
        cell.classList.add('is-fresh-pin');
        (function(c) {
          setTimeout(function() { c.classList.remove('is-fresh-pin'); }, 720);
        })(cell);
      }
    }

    /* 2026-06-19 QA fix (general-purpose agent F-lifecycle): increment
     * chainStep BEFORE emit so the payload carries the index AT WHICH
     * the pin was created, not the previous step. Off-by-one fix:
     * onSpinResult emit with chainStep=0; first onTumbleStep emit with
     * chainStep=1; consumer reads accurate "step at which pin occurred". */
    if (isStep) window.CASCADING_WILD_STATE.chainStep += 1;

    if (fresh.length > 0 && window.HookBus && typeof window.HookBus.emit === 'function') {
      for (var k = 0; k < fresh.length; k++) {
        try {
          window.HookBus.emit('onCascadingWildPinned', {
            cellKey: fresh[k],
            totalPinned: window.CASCADING_WILD_STATE.pinnedKeys.length,
            chainStep: window.CASCADING_WILD_STATE.chainStep,
          });
        } catch (e) {
          try { if (typeof console !== 'undefined' && console.warn) console.warn('[cascadingWildPersistence] emit failed', e); } catch (__) {}
        }
      }
    }

    _renderCounter();
  }

  function _reAssertPins() {
    /* QA fix (Wave LEGO-FS3.3.C, 2026-06-19): cross-block guard with
     * walkingWildStepper. Canonical state is window.WWS_STATE (set by
     * walkingWildStepper.mjs). When walking-wild is active, it owns
     * wild position mutation each FS spin (premešta wild iz r,c →
     * r,c+1). cascadingWildPersistence pin-ovi tada bi se borili sa
     * walking mutacijom → duplicate wild glyphs ili stale pin. When
     * walking is active, defer pin re-assertion — walking will
     * reposition the wild naturally and cascading just respects its
     * decision. */
    if (typeof window.WWS_STATE !== 'undefined'
        && window.WWS_STATE
        && window.WWS_STATE.active === true) {
      return;
    }
    /* Make sure already-pinned cells from previous chain step keep their
     * wild symbol if the engine refilled the cell on this tumble step. */
    var keys = window.CASCADING_WILD_STATE.pinnedKeys || [];
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(',');
      var sel = '.cell[data-reel="' + parts[0] + '"][data-row="' + parts[1] + '"]';
      var cell = document.querySelector(sel);
      if (!cell) continue;
      cell.setAttribute('data-symbol', ${JSON.stringify(wildSym)});
      if (cell.textContent !== undefined) cell.textContent = ${JSON.stringify(wildSym)};
      cell.classList.add('is-cascade-pinned');
    }
  }

  function _clearAllPins() {
    var cells = document.querySelectorAll('.cell.is-cascade-pinned');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('is-cascade-pinned', 'is-fresh-pin');
      cells[i].removeAttribute('aria-label');
      cells[i].removeAttribute('role');
    }
    window.CASCADING_WILD_STATE.pinnedKeys = [];
    window.CASCADING_WILD_STATE.chainStep = 0;
    _renderCounter();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',      _clearAllPins,                       { priority: 24 });
    window.HookBus.on('onSpinResult', function() { _pinWildsOnGrid(false); }, { priority: 24 });
    window.HookBus.on('onTumbleStep', function() { _reAssertPins(); _pinWildsOnGrid(true); }, { priority: 24 });
    window.HookBus.on('postSpin',     _clearAllPins,                       { priority: 24 });
  }
})();
`;
}
