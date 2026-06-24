/**
 * src/blocks/wildTriggerHoldAndWin.mjs
 *
 * Wave LEGO-HW2.1 — Wild-symbol-triggered Hold & Win round.
 *
 * Purpose
 * ───────
 *   On base-game spins, when N or more WILD symbols land on the grid
 *   simultaneously, the block requests entry into a Hold & Win round
 *   (canonical industry pattern: Dragon-Link-style alternative entry
 *   path to lock-and-respin).
 *
 *   Distinct from existing H&W trigger paths:
 *     • `holdAndWin.mjs` — BONUS symbol pile (default "B") triggers H&W
 *     • THIS block      — WILD symbol cluster triggers H&W
 *
 *   Two trigger flavors:
 *     • on-screen — counts wilds visible on grid after spin settles
 *     • cascade   — counts wilds across the entire tumble chain
 *
 *   Block does NOT mount the H&W overlay itself — it emits a
 *   canonical entry request event that `holdAndWin.mjs` consumes
 *   (single-owner H&W state machine ownership preserved).
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Wild trigger H&W" pattern: alternative entry path on slots that
 *   have a primary bonus-symbol H&W route — landing rare wild cluster
 *   gives the player a second route into the same lock-and-respin
 *   feature, with optional pre-seeded orbs from the wild positions.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitWildTriggerHoldAndWinCSS(cfg)
 *   emitWildTriggerHoldAndWinRuntime(cfg, model)
 *   countVisibleWilds(grid, wildSymbolId)         (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onSpinResult   (priority 27) — count wilds, maybe trigger
 *     • onTumbleStep   (priority 27) — cascade accumulator (mode=cascade)
 *     • preSpin        (priority 27) — reset cascade counter
 *   emits:
 *     • onWildTriggerHoldAndWinRequested   { wildCount, threshold, mode, wildCellKeys }
 *
 * Runtime contract
 * ────────────────
 *   window.WILD_TRIG_HW_STATE = {
 *     cascadeWildCount: number,
 *     lastTriggerCells: string[],
 *   }
 *
 * GDD config keys (model.wildTriggerHoldAndWin)
 * ─────────────────────────────────────────────
 *   { enabled, wildSymbolId, triggerThreshold, mode, badgeColor,
 *     seedOrbsFromWilds, skipDuringFs }
 *
 * Performance: O(visible cells) per evaluation, ≤ 0.3 ms typical.
 *
 * a11y: hidden ARIA-live announcement "Hold and win triggered by N wilds"
 * when the request fires.
 *
 * Senior-grade: wired-once via __WILD_TRIG_HW_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface (anti-silent-failure per WASH PASS rule).
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z]{1,4}$/;
const MODES         = Object.freeze(['onScreen', 'cascade']);
const THRESHOLD_MIN = 2;
const THRESHOLD_MAX = 20;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbolId: 'W',
    triggerThreshold: 4,
    mode: 'onScreen',
    badgeColor: '#ff9a40',
    seedOrbsFromWilds: true,
    skipDuringFs: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.wildTriggerHoldAndWin) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.wildSymbolId === 'string' && SYMBOL_ID_RE.test(src.wildSymbolId)) {
    cfg.wildSymbolId = src.wildSymbolId;
  }
  if (Number.isFinite(src.triggerThreshold)) {
    cfg.triggerThreshold = clampInt(src.triggerThreshold, THRESHOLD_MIN, THRESHOLD_MAX);
  }
  if (typeof src.mode === 'string' && MODES.includes(src.mode)) cfg.mode = src.mode;
  if (typeof src.badgeColor === 'string' && HEX_COLOR_RE.test(src.badgeColor)) cfg.badgeColor = src.badgeColor;
  if (src.seedOrbsFromWilds === false) cfg.seedOrbsFromWilds = false;
  if (src.skipDuringFs === false) cfg.skipDuringFs = false;

  /* UQ-DEEP-R P2 fix: features[].config inheritance. */
  if (Array.isArray(model.features)) {
    const f = model.features.find((x) => x && (
      x.kind === 'wild_trigger_hold_and_win' ||
      x.kind === 'wild_trigger_hw' ||
      x.kind === 'wild_to_hold_and_win'));
    if (f) {
      cfg.enabled = true;
      const fc = f.config || f.opts || {};
      if (typeof fc.wildSymbolId === 'string' && SYMBOL_ID_RE.test(fc.wildSymbolId)
          && src.wildSymbolId == null) cfg.wildSymbolId = fc.wildSymbolId;
      if (Number.isFinite(fc.triggerThreshold) && src.triggerThreshold == null) {
        cfg.triggerThreshold = clampInt(fc.triggerThreshold, THRESHOLD_MIN, THRESHOLD_MAX);
      }
      if (typeof fc.mode === 'string' && MODES.includes(fc.mode) && src.mode == null) {
        cfg.mode = fc.mode;
      }
    }
  }
  return cfg;
}

/**
 * Pure: count occurrences of the wild symbol id across the grid array.
 * Accepts a flat string[] (each entry is one cell symbol) or an array
 * of objects with `.symbol` field. Case-insensitive on the id.
 */
export function countVisibleWilds(grid, wildSymbolId) {
  if (!Array.isArray(grid) || grid.length === 0) return 0;
  if (typeof wildSymbolId !== 'string' || wildSymbolId.length === 0) return 0;
  const target = wildSymbolId.toUpperCase();
  let count = 0;
  for (const item of grid) {
    let sym;
    if (typeof item === 'string') sym = item.trim().toUpperCase();
    else if (item && typeof item.symbol === 'string') sym = item.symbol.trim().toUpperCase();
    else continue;
    if (sym === target) count++;
  }
  return count;
}

export function emitWildTriggerHoldAndWinCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ wildTriggerHoldAndWin: cfg });
  if (!c.enabled) return `\n/* wildTriggerHoldAndWin BLOCK (disabled) — no CSS */\n`;
  return `
/* ── wildTriggerHoldAndWin BLOCK — src/blocks/wildTriggerHoldAndWin.mjs ── */
.cell.is-wild-trigger-flash {
  animation: wthw-flash 900ms cubic-bezier(.2,1.3,.4,1);
  outline: 3px solid ${c.badgeColor};
  outline-offset: -3px;
  z-index: 6;
}
@keyframes wthw-flash {
  0%   { box-shadow: 0 0 6px ${c.badgeColor}; }
  50%  { box-shadow: 0 0 28px ${c.badgeColor}; }
  100% { box-shadow: 0 0 6px ${c.badgeColor}; }
}
.wthw-aria {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-wild-trigger-flash { animation: none; }
}
`;
}

export function emitWildTriggerHoldAndWinRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ wildTriggerHoldAndWin: cfg });
  if (!c.enabled) return `\n// wildTriggerHoldAndWin BLOCK (disabled) — no runtime\n`;

  const wildSym  = c.wildSymbolId;
  const threshold = c.triggerThreshold;
  const mode     = c.mode;
  const seedOrbs = c.seedOrbsFromWilds;
  const skipFs   = c.skipDuringFs;

  return `
/* ── wildTriggerHoldAndWin BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__WILD_TRIG_HW_WIRED__) return;
  window.__WILD_TRIG_HW_WIRED__ = true;

  var WILD_SYM   = ${JSON.stringify(wildSym)}.toUpperCase();
  var THRESHOLD  = ${threshold};
  var MODE       = ${JSON.stringify(mode)};
  var SEED_ORBS  = ${seedOrbs};
  var SKIP_FS    = ${skipFs};

  /* FIX-7.4 (deep QA #33, 2026-06-19) — semantic conflation split.
   * Previously lastTriggerCells was reused both as cells that triggered
   * THIS H&W round (UI flash) AND as the running cascade accumulator.
   * When the trigger flash cleared lastTriggerCells, the next
   * onSpinResult/onTumbleStep started counting from zero mid-chain so
   * cascadeWildCount underreported. Now: dedicated cascadeUnionCells
   * for the accumulator; lastTriggerCells stays the moment-of-trigger
   * snapshot only. */
  window.WILD_TRIG_HW_STATE = {
    cascadeWildCount: 0,
    lastTriggerCells: [],
    cascadeUnionCells: [],
  };

  function _ensureAriaSr() {
    var existing = document.getElementById('wthwAria');
    if (existing) return existing;
    var host = document.getElementById('gridHost') || document.body;
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'wthw-aria';
    el.id = 'wthwAria';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    host.appendChild(el);
    return el;
  }

  function _isFsActive() {
    if (window.HW_STATE && window.HW_STATE.active) return true;
    if (window.FSM && /^FS_/.test(window.FSM.state || window.FSM.phase || '')) return true;
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _gridWilds() {
    var cells = document.querySelectorAll('.cell');
    var keys = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (sym !== WILD_SYM) continue;
      var key = (cell.getAttribute('data-reel') || '') + ',' + (cell.getAttribute('data-row') || '');
      keys.push(key);
    }
    return keys;
  }

  function _flashCells(keys) {
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(',');
      var sel = '.cell[data-reel="' + parts[0] + '"][data-row="' + parts[1] + '"]';
      var cell = document.querySelector(sel);
      if (!cell) continue;
      cell.classList.add('is-wild-trigger-flash');
      (function(c) {
        setTimeout(function() { c.classList.remove('is-wild-trigger-flash'); }, 920);
      })(cell);
    }
  }

  function _maybeTrigger(cellKeys, count) {
    if (count < THRESHOLD) return;
    /* H&W is already running — do not re-trigger (single-owner state
     * machine in holdAndWin.mjs honours its own re-entry gate; this is
     * a defensive duplicate). */
    if (window.HW_STATE && window.HW_STATE.active) return;

    window.WILD_TRIG_HW_STATE.lastTriggerCells = cellKeys.slice();
    _flashCells(cellKeys);

    var aria = _ensureAriaSr();
    if (aria) aria.textContent = 'Hold and win triggered by ' + count + ' wild symbols';

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onWildTriggerHoldAndWinRequested', {
          wildCount: count,
          threshold: THRESHOLD,
          mode: MODE,
          wildCellKeys: cellKeys.slice(),
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[wildTriggerHoldAndWin] emit failed', e); } catch (__) {}
      }
    }

    /* QA fix (general-purpose subagent 2026-06-19, cross-block #1):
     * defer hwForceSeed to next tick so the HookBus.emit subscribers
     * (including holdAndWin.mjs armed-latch handler) have a chance to
     * register state changes BEFORE we attempt seeding. Prevents race
     * where seed arrives in non-armed state and orbs fall through. */
    if (SEED_ORBS && typeof window.hwForceSeed === 'function') {
      setTimeout(function() {
        try { window.hwForceSeed(count); } catch (e) {
          try { if (typeof console !== 'undefined' && console.warn) console.warn('[wildTriggerHoldAndWin] hwForceSeed failed', e); } catch (__) {}
        }
      }, 0);
    }
  }

  function _onSpinResult() {
    if (SKIP_FS && _isFsActive()) return;
    var wilds = _gridWilds();
    if (MODE === 'onScreen') {
      _maybeTrigger(wilds, wilds.length);
    } else {
      /* FIX-7.4 (deep QA #33): cascade accumulator uses cascadeUnionCells,
       * not lastTriggerCells. The trigger flash will set lastTriggerCells
       * when _maybeTrigger fires. */
      var union = window.WILD_TRIG_HW_STATE.cascadeUnionCells || [];
      for (var i = 0; i < wilds.length; i++) {
        if (union.indexOf(wilds[i]) === -1) union.push(wilds[i]);
      }
      window.WILD_TRIG_HW_STATE.cascadeUnionCells = union;
      window.WILD_TRIG_HW_STATE.cascadeWildCount = union.length;
      _maybeTrigger(union, union.length);
    }
  }

  function _onTumbleStep() {
    if (MODE !== 'cascade') return;
    if (SKIP_FS && _isFsActive()) return;
    var wilds = _gridWilds();
    /* FIX-7.4 (deep QA #33): union accumulator stays in cascadeUnionCells
     * across chain steps; lastTriggerCells remains the moment-of-trigger
     * snapshot only. */
    var union = window.WILD_TRIG_HW_STATE.cascadeUnionCells || [];
    for (var i = 0; i < wilds.length; i++) {
      if (union.indexOf(wilds[i]) === -1) union.push(wilds[i]);
    }
    window.WILD_TRIG_HW_STATE.cascadeUnionCells = union;
    window.WILD_TRIG_HW_STATE.cascadeWildCount = union.length;
    _maybeTrigger(union, union.length);
  }

  function _onPreSpin() {
    window.WILD_TRIG_HW_STATE.cascadeWildCount = 0;
    window.WILD_TRIG_HW_STATE.lastTriggerCells = [];
    window.WILD_TRIG_HW_STATE.cascadeUnionCells = [];
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',      _onPreSpin,      { priority: 27 });
    window.HookBus.on('onSpinResult', _onSpinResult,   { priority: 27 });
    window.HookBus.on('onTumbleStep', _onTumbleStep,   { priority: 27 });
  }
})();
`;
}
