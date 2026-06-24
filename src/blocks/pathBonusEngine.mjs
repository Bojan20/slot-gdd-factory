import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/pathBonusEngine.mjs
 *
 * Wave LEGO-B2.3 — Board-game path traversal bonus.
 *
 * Purpose
 * ───────
 *   Bonus round in board-game style: linear path of N tiles, player
 *   rolls "dice" (random 1..maxRoll) to advance position. Each tile
 *   carries a value or modifier (multiplier, extra roll, FINISH).
 *   Round ends when:
 *     • Player lands on FINISH tile → award accumulated total
 *     • Out-of-rolls AND no extra-roll modifiers left → award total
 *
 *   Industry-typical pattern: "monopoly-style" or "snake-and-ladder"
 *   bonus screen alternatives to FS, board-game-aesthetic bonus.
 *
 *   Distinct from existing bonus pick blocks (matchThreeBonusReveal,
 *   moneyGrabGrid) — those are pick-and-reveal; this is
 *   positional-traversal with a dice/roll mechanic.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Board-game bonus: player advances along path by rolling dice,
 *   collects from tiles, terminates on FINISH. Animation: tile-by-tile
 *   step traversal with player token.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitPathBonusEngineCSS(cfg)
 *   emitPathBonusEngineMarkup(cfg)
 *   emitPathBonusEngineRuntime(cfg, model)
 *   rollDice(maxRoll, rng)              (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onPathBonusRequested  (priority 35) — mount overlay
 *     • onFsEnd                (priority 35) — defensive cleanup
 *   emits:
 *     • onPathBonusEntered     { tileCount, startRolls }
 *     • onPathBonusRolled      { roll, fromTile, toTile, tileValue, rollsRemaining }
 *     • onPathBonusEnded       { reason, awardX, finalTile, rollsUsed }
 *
 * Runtime contract
 * ────────────────
 *   window.PATH_BONUS_STATE = {
 *     active, tilePath: number[], position: number, rollsUsed, rollsRemaining,
 *     awardX, endReason,
 *   }
 *   window.pathBonusForceRoll()       (QA hook)
 *
 * GDD config keys (model.pathBonusEngine)
 * ──────────────────────────────────────
 *   { enabled, tileCount, startRolls, maxRoll, tileValueRange,
 *     overlayBg, tileColor, playerColor, finishTileIdx }
 *
 * Performance: O(1) per roll.
 *
 * a11y: roll button is <button> sa aria-label; dice result is
 * role="status" aria-live="polite". Path tiles are decorative.
 *
 * Senior-grade: wired-once via __PATH_BONUS_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const TILES_MIN = 4;
const TILES_MAX = 40;
const ROLLS_MIN = 1;
const ROLLS_MAX = 50;
const MAX_ROLL_MIN = 2;
const MAX_ROLL_MAX = 12;
const VALUE_RANGE_MIN = 0;
const VALUE_RANGE_MAX = 1000;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    tileCount: 16,
    startRolls: 5,
    maxRoll: 6,
    tileValueRange: { min: 1, max: 50 },
    overlayBg: '#08111d',
    tileColor: '#1a2840',
    playerColor: '#ff9a40',
    finishTileIdx: 15,
    /* FIX-6 (deep QA #23, 2026-06-19) — FINISH-tile bonus award (x of
     * accumulated total). JSDoc claims "FINISH carries the accumulated
     * total" but previous code stored 0 → reaching FINISH paid only
     * what was collected en-route, no bonus. Industry baseline for
     * board-game bonus: FINISH = jackpot kicker. Default 2x = double
     * the total accumulated. */
    finishBonusMult: 2,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.pathBonusEngine) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.tileCount)) cfg.tileCount = clampInt(src.tileCount, TILES_MIN, TILES_MAX);
  if (Number.isFinite(src.startRolls)) cfg.startRolls = clampInt(src.startRolls, ROLLS_MIN, ROLLS_MAX);
  if (Number.isFinite(src.maxRoll)) cfg.maxRoll = clampInt(src.maxRoll, MAX_ROLL_MIN, MAX_ROLL_MAX);
  if (src.tileValueRange && typeof src.tileValueRange === 'object') {
    const lo = Number(src.tileValueRange.min);
    const hi = Number(src.tileValueRange.max);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) {
      cfg.tileValueRange = {
        min: clampInt(lo, VALUE_RANGE_MIN, VALUE_RANGE_MAX),
        max: clampInt(hi, VALUE_RANGE_MIN, VALUE_RANGE_MAX),
      };
    }
  }
  if (typeof src.overlayBg === 'string' && HEX_COLOR_RE.test(src.overlayBg)) cfg.overlayBg = src.overlayBg;
  if (typeof src.tileColor === 'string' && HEX_COLOR_RE.test(src.tileColor)) cfg.tileColor = src.tileColor;
  if (typeof src.playerColor === 'string' && HEX_COLOR_RE.test(src.playerColor)) cfg.playerColor = src.playerColor;
  if (Number.isFinite(src.finishTileIdx)) {
    cfg.finishTileIdx = clampInt(src.finishTileIdx, 0, cfg.tileCount - 1);
  } else {
    /* Default finish to last tile if user didn't specify and tileCount changed. */
    cfg.finishTileIdx = cfg.tileCount - 1;
  }
  if (Number.isFinite(src.finishBonusMult) && src.finishBonusMult >= 1) {
    cfg.finishBonusMult = Math.min(1000, src.finishBonusMult);
  }
  return cfg;
}

/**
 * Pure: dice roll. Returns integer in [1, maxRoll]. Accepts injected
 * RNG so tests can use a deterministic seed.
 */
export function rollDice(maxRoll, rng = Math.random) {
  const m = Math.trunc(Number(maxRoll));
  if (!Number.isFinite(m) || m < 1) return 1;
  return 1 + Math.floor(rng() * m);
}

export function emitPathBonusEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ pathBonusEngine: cfg });
  if (!c.enabled) return `\n/* pathBonusEngine BLOCK (disabled) — no CSS */\n`;
  return `
/* ── pathBonusEngine BLOCK — src/blocks/pathBonusEngine.mjs ── */
.pb-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: ${c.overlayBg}ee;
  z-index: 90;
  flex-direction: column;
  gap: 14px;
}
.pb-overlay.is-visible { display: flex; }
.pb-title {
  font: 900 22px/1 system-ui, -apple-system, sans-serif;
  color: #f4eecf;
}
.pb-path {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  max-width: 92vw;
}
.pb-tile {
  position: relative;
  width: 56px;
  height: 56px;
  border: 2px solid ${c.tileColor};
  border-radius: 8px;
  background: ${c.tileColor};
  color: #f4eecf;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 700 13px/1 system-ui, -apple-system, sans-serif;
}
.pb-tile.is-finish {
  border-color: ${c.playerColor};
  background: ${c.playerColor};
  color: #08111d;
}
.pb-tile.has-player::after {
  content: "●";
  position: absolute;
  top: 2px; right: 4px;
  color: ${c.playerColor};
  font-size: 18px;
  text-shadow: 0 0 8px ${c.playerColor};
  animation: pb-pulse 1200ms infinite ease-in-out;
}
@keyframes pb-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.25); }
}
.pb-roll-btn {
  min-width: 96px;
  min-height: 44px;
  padding: 8px 18px;
  background: linear-gradient(180deg, ${c.playerColor}, ${c.playerColor}cc);
  border: 2px solid ${c.playerColor};
  border-radius: 12px;
  color: #08111d;
  font: 900 16px/1 system-ui, -apple-system, sans-serif;
  cursor: pointer;
  letter-spacing: 0.04em;
}
.pb-roll-btn:hover, .pb-roll-btn:focus-visible {
  transform: translateY(-1px);
  outline: 2px solid ${c.playerColor};
  outline-offset: 2px;
}
.pb-roll-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pb-hud {
  font: 800 14px/1 system-ui, -apple-system, sans-serif;
  color: ${c.playerColor};
  display: flex;
  gap: 18px;
}
@media (prefers-reduced-motion: reduce) {
  .pb-tile.has-player::after { animation: none; }
}
`;
}

export function emitPathBonusEngineMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ pathBonusEngine: cfg });
  if (!c.enabled) return `\n<!-- pathBonusEngine BLOCK (disabled) -->\n`;
  let tiles = '';
  for (let i = 0; i < c.tileCount; i++) {
    const isFinish = i === c.finishTileIdx;
    tiles += `
      <div class="pb-tile${isFinish ? ' is-finish' : ''}" data-pb-tile="${i}">${isFinish ? 'FIN' : '?'}</div>`;
  }
  return tagBlockMarkup(`
<!-- pathBonusEngine BLOCK — server-emitted markup -->
<div class="pb-overlay" id="pbOverlay" role="dialog" aria-modal="true" aria-labelledby="pbTitle" aria-hidden="true">
  <h2 class="pb-title" id="pbTitle">ROLL TO ADVANCE — REACH FINISH</h2>
  <div class="pb-hud">
    <span id="pbRolls">ROLLS: ${c.startRolls}</span>
    <span id="pbAward" role="status" aria-live="polite">TOTAL: 0x</span>
  </div>
  <div class="pb-path" role="group" aria-label="Bonus path">${tiles}
  </div>
  <button type="button" class="pb-roll-btn" id="pbRollBtn" aria-label="Roll the dice">ROLL</button>
</div>
`, 'pathBonusEngine');
}

export function emitPathBonusEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ pathBonusEngine: cfg });
  if (!c.enabled) return `\n// pathBonusEngine BLOCK (disabled) — no runtime\n`;

  return `
/* ── pathBonusEngine BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__PATH_BONUS_WIRED__) return;
  window.__PATH_BONUS_WIRED__ = true;

  var TILE_COUNT     = ${c.tileCount};
  var START_ROLLS    = ${c.startRolls};
  var MAX_ROLL       = ${c.maxRoll};
  var VALUE_LO       = ${c.tileValueRange.min};
  var VALUE_HI       = ${c.tileValueRange.max};
  var FINISH_IDX     = ${c.finishTileIdx};
  var FINISH_BONUS_MULT = ${c.finishBonusMult};

  window.PATH_BONUS_STATE = {
    active: false,
    tilePath: [],         /* per-tile precomputed values */
    position: 0,
    rollsUsed: 0,
    rollsRemaining: 0,
    awardX: 0,
    endReason: null,
  };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _genTileValues() {
    var arr = [];
    for (var i = 0; i < TILE_COUNT; i++) {
      if (i === FINISH_IDX) { arr.push(0); continue; }   /* FINISH carries the accumulated total */
      var span = VALUE_HI - VALUE_LO;
      var v = VALUE_LO + Math.floor(_rng() * (span + 1));
      arr.push(v);
    }
    return arr;
  }

  function _overlay()  { return document.getElementById('pbOverlay'); }
  function _rollsEl()  { return document.getElementById('pbRolls'); }
  function _awardEl()  { return document.getElementById('pbAward'); }
  function _rollBtn()  { return document.getElementById('pbRollBtn'); }

  function _show() {
    var el = _overlay();
    if (!el) return;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
    var btn = _rollBtn();
    if (btn) try { btn.focus(); } catch (_) {}
  }

  function _hide() {
    var el = _overlay();
    if (!el) return;
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
  }

  function _renderPlayer() {
    var tiles = document.querySelectorAll('.pb-tile');
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.remove('has-player');
    var st = window.PATH_BONUS_STATE;
    var sel = '.pb-tile[data-pb-tile="' + st.position + '"]';
    var tile = document.querySelector(sel);
    if (tile) tile.classList.add('has-player');
  }

  function _renderHud() {
    var st = window.PATH_BONUS_STATE;
    var rE = _rollsEl();
    if (rE) rE.textContent = 'ROLLS: ' + st.rollsRemaining;
    var aE = _awardEl();
    if (aE) aE.textContent = 'TOTAL: ' + st.awardX + 'x';
    var bE = _rollBtn();
    if (bE) bE.disabled = st.rollsRemaining <= 0 || !st.active;
  }

  function _roll() {
    var st = window.PATH_BONUS_STATE;
    if (!st.active || st.rollsRemaining <= 0) return;

    var diceN = 1 + Math.floor(_rng() * MAX_ROLL);
    var from  = st.position;
    /* QA fix (general-purpose subagent 2026-06-19, finding F1): clamp
     * the destination tile against FINISH_IDX (not TILE_COUNT-1) so an
     * over-roll lands on FINISH rather than over-shooting past it.
     * Without this, custom mid-path FINISH (FINISH_IDX < TILE_COUNT-1)
     * could be skipped and the end-reason "finish" fired with the
     * wrong final-tile value. */
    var cap   = (FINISH_IDX < TILE_COUNT - 1) ? FINISH_IDX : (TILE_COUNT - 1);
    var to    = Math.min(cap, from + diceN);
    st.position = to;
    st.rollsUsed += 1;
    st.rollsRemaining -= 1;

    var tileValue = st.tilePath[to];
    st.awardX += Number(tileValue || 0);

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onPathBonusRolled', {
          roll: diceN,
          fromTile: from,
          toTile: to,
          tileValue: tileValue,
          rollsRemaining: st.rollsRemaining,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[pathBonusEngine] roll emit failed', e); } catch (__) {}
      }
    }

    _renderPlayer();
    _renderHud();

    if (to >= FINISH_IDX) {
      /* FIX-6 (deep QA #23, 2026-06-19) — FINISH carries accumulated
       * total times configurable multiplier (default 2). Previously
       * landing on FINISH paid no bonus, contradicting JSDoc claim. */
      st.awardX = Math.round(st.awardX * FINISH_BONUS_MULT);
      _end('finish');
      return;
    }
    if (st.rollsRemaining <= 0) { _end('outOfRolls'); return; }
  }

  function _end(reason) {
    var st = window.PATH_BONUS_STATE;
    st.active = false;
    st.endReason = reason;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onPathBonusEnded', {
          reason: reason,
          awardX: st.awardX,
          finalTile: st.position,
          rollsUsed: st.rollsUsed,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[pathBonusEngine] end emit failed', e); } catch (__) {}
      }
    }
    _renderHud();
    setTimeout(_hide, 1600);
  }

  function _reset() {
    window.PATH_BONUS_STATE = {
      active: false,
      tilePath: _genTileValues(),
      position: 0,
      rollsUsed: 0,
      rollsRemaining: START_ROLLS,
      awardX: 0,
      endReason: null,
    };
    _renderPlayer();
    _renderHud();
  }

  function _enter() {
    /* FIX-6 (deep QA #9, 2026-06-19) — mutex hard-gate. See
     * matchThreeBonusReveal._enter for rationale. */
    if (typeof window !== 'undefined'
        && typeof window.bonusOverlayMutexIsBusyForKind === 'function'
        && window.bonusOverlayMutexIsBusyForKind('pathBonus')) {
      return;
    }
    _reset();
    window.PATH_BONUS_STATE.active = true;
    _renderHud();
    _show();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onPathBonusEntered', { tileCount: TILE_COUNT, startRolls: START_ROLLS }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[pathBonusEngine] enter emit failed', e); } catch (__) {}
      }
    }
  }

  function _wire() {
    var btn = _rollBtn();
    if (!btn) return;
    btn.addEventListener('click', function(e) { e.preventDefault(); _roll(); });
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _roll(); }
    });
  }

  window.pathBonusForceRoll = function() { _roll(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onPathBonusRequested', _enter, { priority: 35 });
    window.HookBus.on('onFsEnd',              function() { if (window.PATH_BONUS_STATE.active) _hide(); }, { priority: 35 });
  }
})();
`;
}
