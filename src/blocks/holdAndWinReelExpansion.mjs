/**
 * src/blocks/holdAndWinReelExpansion.mjs
 *
 * Wave LEGO-HW2.2 — Hold & Win reel expansion (premium tier).
 *
 * Purpose
 * ───────
 *   Mid-round during an active H&W feature, the grid EXPANDS by an
 *   extra reel column when a milestone is hit (configurable: after N
 *   respins, or after locked-cell percentage threshold). New column
 *   is empty initially; subsequent respins populate it via standard
 *   H&W mechanics.
 *
 *   Industry-typical pattern: "grid expansion" tier of H&W rounds —
 *   raises the maximum achievable payout by adding cells to the lock
 *   pool. Player visual feedback: dramatic column-slide-in animation.
 *
 *   Distinct from existing H&W blocks:
 *     • `holdAndWin.mjs`                     — base state machine
 *     • `holdAndWinFrameMultiplier.mjs`      — frame mult escalation
 *     • `holdAndWinLockedOrbMultiplier.mjs`  — per-orb mult roll
 *     • `holdAndWinRoomJackpotMultiplier.mjs`— jackpot room promote
 *
 *   This block ONLY adds DOM columns + emits the expansion event.
 *   It does NOT mutate H&W respin counters or lock state — that
 *   stays in `holdAndWin.mjs` (single-owner state machine).
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Grid expansion" H&W tier seen on multi-tier lock-and-respin
 *   slots — typically triggered by player reaching a milestone within
 *   the H&W round (75% grid full, every 3 respins, etc.).
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitHoldAndWinReelExpansionCSS(cfg)
 *   emitHoldAndWinReelExpansionRuntime(cfg, model)
 *   shouldExpand(respinsUsed, lockedPct, cfg)     (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onHoldAndWinPhase   (priority 32) — reset state on INTRO; cleanup on INACTIVE
 *     • onRespin            (priority 32) — milestone check (alt name onHoldAndWinRespin)
 *     • postSpin            (priority 32) — fallback milestone check
 *   emits:
 *     • onHoldAndWinReelExpanded   { newColumnCount, trigger, expansionsThisRound }
 *
 * Runtime contract
 * ────────────────
 *   window.HW_REEL_EXPANSION_STATE = {
 *     active: boolean,
 *     expansionsThisRound: number,
 *     respinsAtLastExpansion: number,
 *   }
 *
 * GDD config keys (model.holdAndWinReelExpansion)
 * ──────────────────────────────────────────────
 *   { enabled, respinTrigger, lockedPctTrigger, maxExpansions,
 *     columnFillSymbol, columnColor, animDurationMs }
 *
 * Performance: O(1) per check; O(rows) DOM append per expansion (rare).
 *
 * a11y: expanded column gets aria-label="Bonus column added" + role=note.
 *
 * Senior-grade: wired-once via __HW_REEL_EXPANSION_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z]{1,4}$/;
const RESPIN_MIN    = 0;          /* 0 = disabled, only locked-pct trigger */
const RESPIN_MAX    = 50;
const PCT_MIN       = 0;
const PCT_MAX       = 1;
const MAX_EXP_MIN   = 1;
const MAX_EXP_MAX   = 10;
const ANIM_MIN_MS   = 100;
const ANIM_MAX_MS   = 4000;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    respinTrigger: 3,
    lockedPctTrigger: 0.75,
    maxExpansions: 2,
    columnFillSymbol: 'B',
    columnColor: '#7af2c8',
    animDurationMs: 900,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.holdAndWinReelExpansion) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.respinTrigger)) cfg.respinTrigger = clampInt(src.respinTrigger, RESPIN_MIN, RESPIN_MAX);
  if (Number.isFinite(src.lockedPctTrigger)) cfg.lockedPctTrigger = clampNum(src.lockedPctTrigger, PCT_MIN, PCT_MAX);
  if (Number.isFinite(src.maxExpansions)) cfg.maxExpansions = clampInt(src.maxExpansions, MAX_EXP_MIN, MAX_EXP_MAX);
  if (typeof src.columnFillSymbol === 'string' && SYMBOL_ID_RE.test(src.columnFillSymbol)) {
    cfg.columnFillSymbol = src.columnFillSymbol;
  }
  if (typeof src.columnColor === 'string' && HEX_COLOR_RE.test(src.columnColor)) cfg.columnColor = src.columnColor;
  if (Number.isFinite(src.animDurationMs)) cfg.animDurationMs = clampInt(src.animDurationMs, ANIM_MIN_MS, ANIM_MAX_MS);

  return cfg;
}

/**
 * Pure: decide whether THIS check should expand the grid. Returns the
 * trigger string ('respin' | 'pct' | '') so the caller can log/emit
 * which condition fired. Caller still has to gate on
 * `expansionsThisRound < maxExpansions`.
 */
export function shouldExpand(respinsUsed, lockedPct, cfg) {
  const c = (cfg && typeof cfg === 'object') ? cfg : defaultConfig();
  const rT = Number(c.respinTrigger);
  const pT = Number(c.lockedPctTrigger);
  const r  = Number(respinsUsed);
  const p  = Number(lockedPct);
  if (rT > 0 && Number.isFinite(r) && r > 0 && r % rT === 0) return 'respin';
  if (Number.isFinite(p) && Number.isFinite(pT) && pT > 0 && p >= pT) return 'pct';
  return '';
}

export function emitHoldAndWinReelExpansionCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinReelExpansion: cfg });
  if (!c.enabled) return `\n/* holdAndWinReelExpansion BLOCK (disabled) — no CSS */\n`;
  return `
/* ── holdAndWinReelExpansion BLOCK — src/blocks/holdAndWinReelExpansion.mjs ── */
.cell.is-hwre-bonus-column {
  outline: 2px solid ${c.columnColor};
  outline-offset: -2px;
  box-shadow: 0 0 12px ${c.columnColor}aa;
  animation: hwre-slide-in ${c.animDurationMs}ms cubic-bezier(.34,1.56,.64,1);
}
@keyframes hwre-slide-in {
  0%   { opacity: 0; transform: translateX(40px); }
  60%  { opacity: 1; transform: translateX(-6px); }
  100% { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-hwre-bonus-column { animation: none; }
}
`;
}

export function emitHoldAndWinReelExpansionRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinReelExpansion: cfg });
  if (!c.enabled) return `\n// holdAndWinReelExpansion BLOCK (disabled) — no runtime\n`;

  const respinTrig = c.respinTrigger;
  const pctTrig    = c.lockedPctTrigger;
  const maxExp     = c.maxExpansions;

  return `
/* ── holdAndWinReelExpansion BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__HW_REEL_EXPANSION_WIRED__) return;
  window.__HW_REEL_EXPANSION_WIRED__ = true;

  var RESPIN_TRIG = ${respinTrig};
  var PCT_TRIG    = ${pctTrig};
  var MAX_EXP     = ${maxExp};

  window.HW_REEL_EXPANSION_STATE = {
    active: false,
    expansionsThisRound: 0,
    respinsAtLastExpansion: 0,
  };

  function _gridDims() {
    var cells = document.querySelectorAll('.cell');
    if (!cells.length) return { cols: 0, maxRows: 0 };
    var maxC = 0, maxR = 0;
    for (var i = 0; i < cells.length; i++) {
      var rr = parseInt(cells[i].getAttribute('data-reel') || '0', 10);
      var rw = parseInt(cells[i].getAttribute('data-row')  || '0', 10);
      if (rr > maxC) maxC = rr;
      if (rw > maxR) maxR = rw;
    }
    return { cols: maxC + 1, maxRows: maxR + 1 };
  }

  function _addColumn() {
    var dims = _gridDims();
    var newColIdx = dims.cols;
    var host = document.querySelector('.grid-rect') || document.getElementById('gridHost');
    if (!host) return null;
    /* Find a sibling cell to clone styles from for layout consistency. */
    var sampleCell = host.querySelector('.cell[data-reel="0"]');
    if (!sampleCell) return null;

    var addedKeys = [];
    for (var row = 0; row < dims.maxRows; row++) {
      var newCell = sampleCell.cloneNode(false);
      newCell.classList.add('cell', 'is-hwre-bonus-column');
      newCell.setAttribute('data-reel', String(newColIdx));
      newCell.setAttribute('data-row',  String(row));
      newCell.setAttribute('data-symbol', '');
      newCell.setAttribute('aria-label', 'Bonus column added');
      newCell.setAttribute('role', 'note');
      newCell.textContent = '';
      host.appendChild(newCell);
      addedKeys.push(newColIdx + ',' + row);
    }
    return { newColIdx: newColIdx, addedKeys: addedKeys };
  }

  function _computeLockedPct() {
    var all = document.querySelectorAll('.cell');
    if (all.length === 0) return 0;
    var locked = document.querySelectorAll('.cell.is-locked-bonus');
    return locked.length / all.length;
  }

  function _maybeExpand(triggerReason) {
    var st = window.HW_REEL_EXPANSION_STATE;
    if (!st.active) return;
    if (st.expansionsThisRound >= MAX_EXP) return;

    var result = _addColumn();
    if (!result) return;

    st.expansionsThisRound += 1;
    var respinsUsed = (window.HW_STATE && Number.isFinite(window.HW_STATE.respinsUsed)) ? window.HW_STATE.respinsUsed : 0;
    st.respinsAtLastExpansion = respinsUsed;

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onHoldAndWinReelExpanded', {
          newColumnCount: 1,
          trigger: triggerReason,
          expansionsThisRound: st.expansionsThisRound,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[holdAndWinReelExpansion] emit failed', e); } catch (__) {}
      }
    }
  }

  function _evaluate() {
    var st = window.HW_REEL_EXPANSION_STATE;
    if (!st.active) return;
    var respinsUsed = (window.HW_STATE && Number.isFinite(window.HW_STATE.respinsUsed)) ? window.HW_STATE.respinsUsed : 0;
    /* Respin-counter trigger (only if RESPIN_TRIG > 0). */
    if (RESPIN_TRIG > 0 && respinsUsed > 0 && respinsUsed > st.respinsAtLastExpansion
        && respinsUsed % RESPIN_TRIG === 0) {
      _maybeExpand('respin');
      return;
    }
    /* Locked-pct trigger. */
    var pct = _computeLockedPct();
    if (pct >= PCT_TRIG) {
      _maybeExpand('pct');
    }
  }

  function _onHwPhase(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.phase === 'INTRO' || payload.phase === 'RUNNING') {
      if (!window.HW_REEL_EXPANSION_STATE.active) {
        window.HW_REEL_EXPANSION_STATE.active = true;
        window.HW_REEL_EXPANSION_STATE.expansionsThisRound = 0;
        window.HW_REEL_EXPANSION_STATE.respinsAtLastExpansion = 0;
      }
    } else if (payload.phase === 'INACTIVE') {
      window.HW_REEL_EXPANSION_STATE.active = false;
      window.HW_REEL_EXPANSION_STATE.expansionsThisRound = 0;
      window.HW_REEL_EXPANSION_STATE.respinsAtLastExpansion = 0;
      /* QA fix (general-purpose subagent 2026-06-19, lifecycle #2):
       * remove added bonus columns at round end so the next base spin
       * does NOT start with a phantom column that reelEngine doesn't
       * know about. Previously we left the columns in place which
       * caused "ghost" cells to persist into subsequent base spins —
       * reelEngine ignored them, but they stayed visually marked. */
      var ghosts = document.querySelectorAll('.cell.is-hwre-bonus-column');
      for (var i = 0; i < ghosts.length; i++) {
        try { ghosts[i].parentNode.removeChild(ghosts[i]); } catch (_) {}
      }
    }
  }

  function _onPostSpin() {
    if (!window.HW_REEL_EXPANSION_STATE.active) return;
    _evaluate();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onHoldAndWinPhase', _onHwPhase,   { priority: 32 });
    window.HookBus.on('postSpin',          _onPostSpin,  { priority: 32 });
    /* Some H&W implementations emit a dedicated respin event; we attach
     * defensively. If not present, postSpin fallback covers the milestone
     * check on every respin tail. */
    if (typeof window.HookBus.on === 'function') {
      window.HookBus.on('onHoldAndWinRespin', _onPostSpin, { priority: 32 });
    }
  }
})();
`;
}
