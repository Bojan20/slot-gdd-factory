import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/fsPersistentJackpotPool.mjs
 *
 * Wave LEGO-FS2.2 — Persistent jackpot pool across FS spins.
 *
 * Purpose
 * ───────
 *   FS round maintains a JACKPOT POOL (×bet units) that:
 *     • starts at a configured floor on FS_TRIGGER,
 *     • increments by a fixed delta + optional fraction of EACH FS spin win,
 *     • carries over BETWEEN FS spins (does NOT reset per spin),
 *     • PAYS OUT in full on a configurable trigger condition:
 *         - on `payoutTrigger: 'fsEnd'` → pays on FS round end
 *         - on `payoutTrigger: 'maxScatters'` → pays when N scatters land
 *
 *   Industry-typical "progressive jackpot pool" pattern across many
 *   bonus-rich FS rounds. Distinct from existing jackpot blocks:
 *
 *     • `jackpotLadderRooms.mjs`             — tier escalator (MINI..GRAND)
 *     • `holdAndWinRoomJackpotMultiplier.mjs` — H&W room promo
 *     • `jackpotPicker.mjs`                  — H&W pick-bonus jackpot reveal
 *
 *   This block manages the in-FS accumulating pool — independent of
 *   H&W and ladder rooms.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Persistent jackpot pool found on cascade/ways FS bonuses — pool
 *   grows visibly throughout the round, pays out at terminal event.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitFsPersistentJackpotPoolCSS(cfg)
 *   emitFsPersistentJackpotPoolMarkup(cfg)
 *   emitFsPersistentJackpotPoolRuntime(cfg, model)
 *   computePoolBump(currentPool, winX, deltaPerSpin, winFraction)   (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger       (priority 31) — init pool at floor, show HUD
 *     • onFsSpinResult    (priority 31) — increment pool by delta + winFraction*winX
 *     • onFsEnd           (priority 31) — pay out (if fsEnd) + reset state
 *   emits:
 *     • onFsJackpotPoolBumped   { newPoolX, deltaX, spinWinX }
 *     • onFsJackpotPoolPaidOut  { finalPoolX, trigger: 'fsEnd' | 'maxScatters' }
 *
 * Runtime contract
 * ────────────────
 *   window.FS_JACKPOT_POOL_STATE = {
 *     active: boolean,
 *     poolX: number,            // current accumulated × bet
 *     spinsThisRound: number,
 *   }
 *
 * GDD config keys (model.fsPersistentJackpotPool)
 * ──────────────────────────────────────────────
 *   { enabled, floorX, deltaPerSpinX, winFraction, payoutTrigger,
 *     chipColor, chipPosition, showChip, maxScattersThreshold }
 *
 * Performance: O(1) per FS spin (single arithmetic + DOM text update).
 *
 * a11y: HUD chip is role=status + aria-live=polite, announces pool
 * value on each bump.
 *
 * Senior-grade: wired-once via __FS_JACKPOT_POOL_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface (anti-silent-failure per WASH PASS rule).
 */

const HEX_COLOR_RE     = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS        = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const PAYOUT_TRIGGERS  = Object.freeze(['fsEnd', 'maxScatters']);
const FLOOR_MIN        = 0;
const FLOOR_MAX        = 100000;
const DELTA_MIN        = 0;
const DELTA_MAX        = 10000;
const FRACTION_MIN     = 0;
const FRACTION_MAX     = 1;
const SCATTER_MIN      = 1;
const SCATTER_MAX      = 50;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    floorX: 10,
    deltaPerSpinX: 2,
    winFraction: 0.1,
    payoutTrigger: 'fsEnd',
    chipColor: '#ffd84d',
    chipPosition: 'topLeft',
    showChip: true,
    maxScattersThreshold: 5,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.fsPersistentJackpotPool) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.floorX)) cfg.floorX = clampInt(src.floorX, FLOOR_MIN, FLOOR_MAX);
  if (Number.isFinite(src.deltaPerSpinX)) cfg.deltaPerSpinX = clampInt(src.deltaPerSpinX, DELTA_MIN, DELTA_MAX);
  if (Number.isFinite(src.winFraction)) cfg.winFraction = clampNum(src.winFraction, FRACTION_MIN, FRACTION_MAX);
  if (typeof src.payoutTrigger === 'string' && PAYOUT_TRIGGERS.includes(src.payoutTrigger)) {
    cfg.payoutTrigger = src.payoutTrigger;
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (typeof src.chipPosition === 'string' && POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (src.showChip === false) cfg.showChip = false;
  if (Number.isFinite(src.maxScattersThreshold)) {
    cfg.maxScattersThreshold = clampInt(src.maxScattersThreshold, SCATTER_MIN, SCATTER_MAX);
  }
  return cfg;
}

/**
 * Pure: compute the new pool value after a single FS spin. Returns
 * the post-bump pool clamped to a non-negative number. Malformed
 * inputs are treated as zero.
 */
export function computePoolBump(currentPool, winX, deltaPerSpin, winFraction) {
  const cur = Number(currentPool);
  const win = Number(winX);
  const dlt = Number(deltaPerSpin);
  const frc = Number(winFraction);
  const base = Number.isFinite(cur) && cur >= 0 ? cur : 0;
  const dl   = Number.isFinite(dlt) && dlt >= 0 ? dlt : 0;
  const wn   = Number.isFinite(win) && win >= 0 ? win : 0;
  const fr   = Number.isFinite(frc) && frc >= 0 && frc <= 1 ? frc : 0;
  return Math.round((base + dl + wn * fr) * 100) / 100;
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

export function emitFsPersistentJackpotPoolCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ fsPersistentJackpotPool: cfg });
  if (!c.enabled) return `\n/* fsPersistentJackpotPool BLOCK (disabled) — no CSS */\n`;
  return `
/* ── fsPersistentJackpotPool BLOCK — src/blocks/fsPersistentJackpotPool.mjs ── */
.fspjp-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  background: linear-gradient(180deg, rgba(60,40,8,.92), rgba(20,12,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 900 14px/1 system-ui, -apple-system, sans-serif;
  padding: 6px 12px;
  border-radius: 14px;
  z-index: 62;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.fspjp-chip.is-visible { opacity: 1; }
.fspjp-chip.is-bumping {
  animation: fspjp-bump 700ms cubic-bezier(.2,1.3,.4,1);
}
.fspjp-chip.is-paid {
  animation: fspjp-paid 1400ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes fspjp-bump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.22); box-shadow: 0 0 16px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@keyframes fspjp-paid {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.6); box-shadow: 0 0 32px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .fspjp-chip { transition: none; }
  .fspjp-chip.is-bumping, .fspjp-chip.is-paid { animation: none; }
}
`;
}

export function emitFsPersistentJackpotPoolMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ fsPersistentJackpotPool: cfg });
  if (!c.enabled || !c.showChip) return `\n<!-- fsPersistentJackpotPool BLOCK (disabled or hidden) -->\n`;
  return tagBlockMarkup(`
<!-- fsPersistentJackpotPool BLOCK — server-emitted markup -->
<div class="fspjp-chip" id="fspjpChip" role="status" aria-live="polite" aria-hidden="true"></div>
`, 'fsPersistentJackpotPool');
}

export function emitFsPersistentJackpotPoolRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ fsPersistentJackpotPool: cfg });
  if (!c.enabled) return `\n// fsPersistentJackpotPool BLOCK (disabled) — no runtime\n`;

  return `
/* ── fsPersistentJackpotPool BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__FS_JACKPOT_POOL_WIRED__) return;
  window.__FS_JACKPOT_POOL_WIRED__ = true;

  var FLOOR      = ${c.floorX};
  var DELTA      = ${c.deltaPerSpinX};
  var WIN_FRAC   = ${c.winFraction};
  var TRIGGER    = ${JSON.stringify(c.payoutTrigger)};
  var SCAT_TH    = ${c.maxScattersThreshold};

  window.FS_JACKPOT_POOL_STATE = {
    active: false,
    poolX: 0,
    spinsThisRound: 0,
    lastWinX: 0,        /* set by onSpinResult / onWinPresentationEnd */
    lastScatterCount: 0, /* set by onScatterCelebrationStart payload */
  };

  /* QA fix (general-purpose subagent 2026-06-19): canonical onFsSpinResult
   * emit shape is just chainIndex: 0 — no winX, no scatterCount.
   * We harvest those from other lifecycle signals and cache them so the
   * onFsSpinResult tail can read consistent data without trusting the
   * payload shape. */
  function _onSpinResultPayload(p) {
    if (!p || typeof p !== 'object') return;
    if (Number.isFinite(p.winX))         window.FS_JACKPOT_POOL_STATE.lastWinX = Number(p.winX);
    else if (Number.isFinite(p.totalWinX)) window.FS_JACKPOT_POOL_STATE.lastWinX = Number(p.totalWinX);
  }
  function _onScatterCelebrationStart(p) {
    if (!p || typeof p !== 'object') return;
    if (Number.isFinite(p.cellCount))    window.FS_JACKPOT_POOL_STATE.lastScatterCount = Number(p.cellCount);
    else if (Number.isFinite(p.scatterCount)) window.FS_JACKPOT_POOL_STATE.lastScatterCount = Number(p.scatterCount);
  }

  function _chip() { return document.getElementById('fspjpChip'); }

  function _render() {
    var el = _chip();
    if (!el) return;
    var st = window.FS_JACKPOT_POOL_STATE;
    if (!st.active) {
      el.classList.remove('is-visible', 'is-bumping', 'is-paid');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'POOL ' + st.poolX + 'x';
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
  }

  function _bumpClass(klass) {
    var el = _chip();
    if (!el) return;
    el.classList.add(klass);
    setTimeout(function() { el.classList.remove(klass); }, klass === 'is-paid' ? 1420 : 720);
  }

  function _bumpPool(spinWinX) {
    var st = window.FS_JACKPOT_POOL_STATE;
    if (!st.active) return;
    var prev = st.poolX;
    var win  = Number(spinWinX);
    var frc  = (Number.isFinite(win) && win >= 0) ? win * WIN_FRAC : 0;
    st.poolX = Math.round((prev + DELTA + frc) * 100) / 100;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFsJackpotPoolBumped', {
          newPoolX: st.poolX,
          deltaX: st.poolX - prev,
          spinWinX: Number.isFinite(win) ? win : 0,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsPersistentJackpotPool] bump emit failed', e); } catch (__) {}
      }
    }
    _render();
    _bumpClass('is-bumping');
  }

  function _payout(trigger) {
    var st = window.FS_JACKPOT_POOL_STATE;
    if (!st.active) return;
    var final = st.poolX;
    _render();
    _bumpClass('is-paid');
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFsJackpotPoolPaidOut', { finalPoolX: final, trigger: trigger });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsPersistentJackpotPool] payout emit failed', e); } catch (__) {}
      }
    }
  }

  function _onFsTrigger() {
    window.FS_JACKPOT_POOL_STATE.active = true;
    window.FS_JACKPOT_POOL_STATE.poolX  = FLOOR;
    window.FS_JACKPOT_POOL_STATE.spinsThisRound = 0;
    _render();
  }

  function _onFsSpinResult(payload) {
    var st = window.FS_JACKPOT_POOL_STATE;
    if (!st.active) return;
    st.spinsThisRound += 1;

    /* QA fix (general-purpose subagent 2026-06-19, finding B): on
     * maxScatters trigger, check threshold FIRST so the pool is frozen
     * at the trigger-instant value, not bumped by the trigger spin
     * itself. Industry standard: "the spin that triggers payout does
     * NOT contribute to the final pool". */
    var scatTriggered = (TRIGGER === 'maxScatters' && st.lastScatterCount >= SCAT_TH);

    if (scatTriggered) {
      _payout('maxScatters');
      /* QA fix (general-purpose subagent 2026-06-19, finding D): rather
       * than mutating engine internals (FREESPINS.remaining=0 violates
       * SRP), we emit the canonical end-request event and let the FS
       * state machine decide. Fallback path keeps the previous behaviour
       * for engines without a listener — non-breaking. */
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onFsJackpotPoolEndRequested', { reason: 'maxScatters' }); } catch (e) {
          try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsPersistentJackpotPool] end-request emit failed', e); } catch (__) {}
        }
      }
      try { if (window.FREESPINS) window.FREESPINS.remaining = 0; } catch (_) {}
      return;     /* freeze pool — no further bumps this round */
    }

    /* Normal bump path: pool += delta + winFraction * winX */
    _bumpPool(st.lastWinX);
    /* Consume cached winX so next spin starts fresh (no carry-over of
     * stale value if onSpinResult didn't fire with payload). */
    st.lastWinX = 0;
  }

  function _onFsEnd() {
    var st = window.FS_JACKPOT_POOL_STATE;
    if (st.active && TRIGGER === 'fsEnd') {
      _payout('fsEnd');
    }
    st.active = false;
    st.poolX  = 0;
    st.spinsThisRound = 0;
    var el = _chip();
    if (el) {
      el.classList.remove('is-visible', 'is-bumping', 'is-paid');
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '';
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',                _onFsTrigger,             { priority: 31 });
    window.HookBus.on('onSpinResult',               _onSpinResultPayload,     { priority: 31 });
    window.HookBus.on('onScatterCelebrationStart',  _onScatterCelebrationStart, { priority: 31 });
    window.HookBus.on('onFsSpinResult',             _onFsSpinResult,          { priority: 31 });
    window.HookBus.on('onFsEnd',                    _onFsEnd,                 { priority: 31 });
  }
})();
`;
}
