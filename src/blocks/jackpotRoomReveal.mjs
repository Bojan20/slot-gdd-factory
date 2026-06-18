/**
 * src/blocks/jackpotRoomReveal.mjs
 *
 * Wave LEGO-JRR — Jackpot Room Reveal (full-screen room ladder placard).
 *
 * Purpose
 * ───────
 *   When a Hold-and-Win style trigger event fires (e.g. collecting N+
 *   orbs, or a wheel landing on a "ROOM" segment), this block mounts a
 *   full-screen placard showing the JACKPOT ROOM ladder (MINI / MINOR /
 *   MAJOR / GRAND tiers). The reveal sequence: placard slide-in → each
 *   room tile animates in turn → the awarded tier highlights with the
 *   final winnings → click-anywhere (or auto-dismiss after `autoDismissMs`)
 *   returns control to the host. The block is presentation-only — the
 *   awarded tier is supplied by the upstream emitter (wheel, orb
 *   collector, etc.) on the `onJackpotRoomTrigger` event. Distinct from:
 *     • multiplierLadder         (in-reel persistent ×N progression)
 *     • holdAndWinCreditBucket   (per-cell credit accumulator)
 *     • weightedWheelSegments    (segment picker — UPSTREAM trigger source)
 *     • dailyJackpot             (must-drop ladder, persistent across rounds)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "jackpot room reveal" full-screen placard pattern — the
 *   ladder is displayed as a vertical stack of four tiers, the final
 *   awarded tier is highlighted with its multiplier (×N) and credit
 *   amount, and the player taps to dismiss the celebration. Industry
 *   norm: 4 tiers (MINI / MINOR / MAJOR / GRAND), monotone thresholds.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitJackpotRoomRevealCSS(cfg)
 *   emitJackpotRoomRevealMarkup(cfg)
 *   emitJackpotRoomRevealRuntime(cfg)
 *   resolveRoomForCount(rooms, count)   (pure helper, exported for tests)
 *   validateRoomLadder(rooms)           (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onJackpotRoomTrigger (priority 30) — mount + run reveal sequence
 *     • preSpin              (priority 30) — force dismiss
 *     • onHoldAndWinEnd      (priority 30) — force dismiss
 *     • onSkipRequested      (priority 30) — force dismiss
 *   emits:
 *     • onJackpotRoomRevealed   { roomName, multX, winAmount }
 *     • onJackpotRoomDismissed  { roomName, reason }
 *
 * Runtime contract
 * ────────────────
 *   window.JRR_STATE = { active: boolean, roomName: string|null,
 *                        multX: number, winAmount: number }
 *   window.jrrDismiss(reason)   imperative dismiss escape-hatch
 *
 * GDD config keys (model.jackpotRoomReveal)
 * ─────────────────────────────────────────
 *   { enabled,
 *     rooms: [{ name, threshold, multX, color }, …],
 *     appliesIn: 'hw'|'bonus'|'both',
 *     revealAnimMs: 300..3000,
 *     autoDismissMs: 0..10000   (0 disables auto-dismiss),
 *     showCTA: boolean,
 *     placardColor: hex,
 *     ladderGlowColor: hex,
 *     fontSizePx: 16..64 }
 *
 * Performance budget: ≤ 0.5 ms per trigger mount on baseline target;
 * single placard node, four tile children; 1 listener per event
 * (wired-once via window.__JRR_WIRED__). DOM teardown removes all
 * listeners + node on dismiss.
 *
 * a11y: placard is role=dialog + aria-modal=true + aria-live=assertive;
 * tile labels expose "Tier NAME, multiplier ×N"; prefers-reduced-motion
 * disables slide/scale keyframes (static fade only). Focus is moved to
 * the placard on mount and restored on dismiss.
 *
 * Vendor-neutral, senior-grade, pure presentation — the upstream
 * emitter owns the math (which tier, how much) and supplies it on the
 * trigger payload. This block only reveals + dismisses.
 */

const APPLIES_IN          = Object.freeze(['hw', 'bonus', 'both']);
const REVEAL_ANIM_MIN_MS  = 300;
const REVEAL_ANIM_MAX_MS  = 3000;
const AUTO_DISMISS_MIN_MS = 0;
const AUTO_DISMISS_MAX_MS = 10000;
const FONT_SIZE_MIN_PX    = 16;
const FONT_SIZE_MAX_PX    = 64;

const HEX_COLOR_RE        = /^#[0-9a-fA-F]{3,8}$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_ROOMS = Object.freeze([
  Object.freeze({ name: 'MINI',  threshold:  0, multX:   5, color: '#7cd1ff' }),
  Object.freeze({ name: 'MINOR', threshold:  5, multX:  20, color: '#9be37c' }),
  Object.freeze({ name: 'MAJOR', threshold: 10, multX: 100, color: '#ffb347' }),
  Object.freeze({ name: 'GRAND', threshold: 15, multX: 500, color: '#ff5252' }),
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    rooms: DEFAULT_ROOMS.map(r => ({ ...r })),
    appliesIn: 'hw',
    revealAnimMs: 1500,
    autoDismissMs: 4000,
    showCTA: true,
    placardColor: '#1a0a00',
    ladderGlowColor: '#ffd700',
    fontSizePx: 32,
  });
}

/**
 * Pure helper: validate that a candidate rooms array is a usable ladder.
 * Requires: non-empty array; every entry has finite numeric `threshold`
 * + `multX` and a non-empty string `name`; thresholds are monotonically
 * non-decreasing; multipliers are monotonically non-decreasing.
 *
 * @param {Array<{name:string, threshold:number, multX:number}>} rooms
 * @returns {boolean}
 */
export function validateRoomLadder(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return false;
  let prevThreshold = -Infinity;
  let prevMultX     = -Infinity;
  for (const r of rooms) {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.name !== 'string' || r.name.length === 0) return false;
    if (!Number.isFinite(r.threshold)) return false;
    if (!Number.isFinite(r.multX)) return false;
    if (r.threshold < prevThreshold) return false;
    if (r.multX     < prevMultX)     return false;
    prevThreshold = r.threshold;
    prevMultX     = r.multX;
  }
  return true;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.jackpotRoomReveal) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Array.isArray(src.rooms) && src.rooms.length > 0) {
    const normalised = src.rooms
      .filter(r => r && typeof r === 'object')
      .map(r => ({
        name:      typeof r.name === 'string' ? r.name : '',
        threshold: Number(r.threshold),
        multX:     Number(r.multX),
        color:     typeof r.color === 'string' && HEX_COLOR_RE.test(r.color) ? r.color : '#888888',
      }));
    if (validateRoomLadder(normalised)) {
      cfg.rooms = normalised;
    }
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }

  if (Number.isFinite(src.revealAnimMs)) {
    cfg.revealAnimMs = clampInt(src.revealAnimMs, REVEAL_ANIM_MIN_MS, REVEAL_ANIM_MAX_MS);
  }

  if (Number.isFinite(src.autoDismissMs)) {
    cfg.autoDismissMs = clampInt(src.autoDismissMs, AUTO_DISMISS_MIN_MS, AUTO_DISMISS_MAX_MS);
  }

  if (typeof src.showCTA === 'boolean') cfg.showCTA = src.showCTA;

  if (typeof src.placardColor === 'string' && HEX_COLOR_RE.test(src.placardColor)) {
    cfg.placardColor = src.placardColor;
  }
  if (typeof src.ladderGlowColor === 'string' && HEX_COLOR_RE.test(src.ladderGlowColor)) {
    cfg.ladderGlowColor = src.ladderGlowColor;
  }

  if (Number.isFinite(src.fontSizePx)) {
    cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN_PX, FONT_SIZE_MAX_PX);
  }

  return cfg;
}

/**
 * Pure helper: pick the matching room for a given trigger count, walking
 * the ladder from highest threshold downward. Returns the first room
 * whose threshold is ≤ count. Negative/non-finite counts floor to the
 * lowest-threshold room. Counts above the top threshold cap at the top
 * room (GRAND-equivalent).
 *
 * @param {Array<{name:string, threshold:number, multX:number}>} rooms
 * @param {number} count
 * @returns {{name:string, threshold:number, multX:number}|null}
 */
export function resolveRoomForCount(rooms, count) {
  if (!validateRoomLadder(rooms)) return null;
  const n = Number.isFinite(count) ? count : 0;
  if (n <= rooms[0].threshold) return rooms[0];
  let chosen = rooms[0];
  for (const r of rooms) {
    if (r.threshold <= n) chosen = r;
    else break;
  }
  return chosen;
}

export function emitJackpotRoomRevealCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotRoomReveal: cfg });
  if (!c.enabled) return `\n/* jackpotRoomReveal BLOCK (disabled) — no CSS */\n`;
  return `
/* ── jackpotRoomReveal BLOCK — src/blocks/jackpotRoomReveal.mjs ── */
.jrr-placard {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: ${c.placardColor}f0;
  z-index: 9000;
  font: 900 ${c.fontSizePx}px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.ladderGlowColor};
  text-shadow: 0 2px 12px rgba(0,0,0,0.85), 0 0 24px ${c.ladderGlowColor}66;
  opacity: 0;
  transition: opacity 250ms ease;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.jrr-placard.is-active {
  display: flex;
  opacity: 1;
  animation: jrr-placard-in ${c.revealAnimMs}ms ease-out both;
}
.jrr-ladder {
  display: flex;
  flex-direction: column;
  gap: 0.6em;
  margin: 1.2em 0;
  width: min(80vw, 480px);
}
.jrr-tile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5em 0.9em;
  border-radius: 0.4em;
  background: rgba(0,0,0,0.4);
  border: 2px solid rgba(255,255,255,0.18);
  opacity: 0;
  transform: translateX(-30px);
  animation: jrr-tile-in 360ms ease-out both;
}
.jrr-tile[data-awarded="true"] {
  border-color: ${c.ladderGlowColor};
  box-shadow:
    0 0 0 2px ${c.ladderGlowColor}88,
    0 0 24px ${c.ladderGlowColor}aa,
    inset 0 0 16px ${c.ladderGlowColor}44;
  animation: jrr-tile-in 360ms ease-out both, jrr-awarded-pulse 1.2s ease-in-out infinite alternate 360ms;
}
.jrr-tile__name { letter-spacing: 0.08em; }
.jrr-tile__value { font-variant-numeric: tabular-nums; }
.jrr-cta {
  margin-top: 0.8em;
  font-size: 0.55em;
  letter-spacing: 0.12em;
  opacity: 0.7;
  animation: jrr-cta-blink 1.6s ease-in-out infinite;
}
@keyframes jrr-placard-in {
  0%   { opacity: 0; transform: scale(0.94); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes jrr-tile-in {
  0%   { opacity: 0; transform: translateX(-30px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes jrr-awarded-pulse {
  0%   { filter: brightness(1)    drop-shadow(0 0 0    ${c.ladderGlowColor}); }
  100% { filter: brightness(1.25) drop-shadow(0 0 14px ${c.ladderGlowColor}); }
}
@keyframes jrr-cta-blink {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 0.9; }
}
@media (prefers-reduced-motion: reduce) {
  .jrr-placard.is-active,
  .jrr-tile,
  .jrr-tile[data-awarded="true"],
  .jrr-cta { animation: none; opacity: 1; transform: none; }
}
`;
}

export function emitJackpotRoomRevealMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotRoomReveal: cfg });
  if (!c.enabled) return `\n<!-- jackpotRoomReveal BLOCK (disabled) -->\n`;
  return `
<!-- jackpotRoomReveal BLOCK — full-screen placard wrapper -->
<div class="jrr-placard"
     id="jrrPlacard"
     role="dialog"
     aria-modal="true"
     aria-live="assertive"
     aria-hidden="true"
     tabindex="-1">
  <div class="jrr-title" id="jrrTitle">JACKPOT</div>
  <div class="jrr-ladder" id="jrrLadder" aria-label="Jackpot room ladder"></div>
  ${c.showCTA ? `<div class="jrr-cta" id="jrrCta">TAP TO CONTINUE</div>` : ''}
</div>
`;
}

export function emitJackpotRoomRevealRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotRoomReveal: cfg });
  if (!c.enabled) return `\n// jackpotRoomReveal BLOCK (disabled) — no runtime\n`;

  const roomsJson     = JSON.stringify(c.rooms);
  const appliesIn     = JSON.stringify(c.appliesIn);
  const revealAnimMs  = c.revealAnimMs;
  const autoDismissMs = c.autoDismissMs;

  return `
/* ── jackpotRoomReveal BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__JRR_WIRED__) return;
  window.__JRR_WIRED__ = true;

  var ROOMS           = ${roomsJson};
  var APPLIES_IN      = ${appliesIn};
  var REVEAL_ANIM_MS  = ${revealAnimMs};
  var AUTO_DISMISS_MS = ${autoDismissMs};

  window.JRR_STATE = {
    active:    false,
    roomName:  null,
    multX:     0,
    winAmount: 0,
  };

  var _autoDismissTimer = null;
  var _clickHandler     = null;
  var _focusReturn      = null;

  function _isHwActive() {
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _isBonusActive() {
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^BONUS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^BONUS_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === "hw")    return _isHwActive();
    if (APPLIES_IN === "bonus") return _isBonusActive();
    return _isHwActive() || _isBonusActive(); /* both */
  }

  function _resolveRoom(payload) {
    if (payload && typeof payload === 'object' && typeof payload.roomName === 'string') {
      for (var i = 0; i < ROOMS.length; i++) {
        if (ROOMS[i].name === payload.roomName) return ROOMS[i];
      }
    }
    var count = (payload && Number.isFinite(payload.orbCount)) ? payload.orbCount : 0;
    if (count <= ROOMS[0].threshold) return ROOMS[0];
    var chosen = ROOMS[0];
    for (var j = 0; j < ROOMS.length; j++) {
      if (ROOMS[j].threshold <= count) chosen = ROOMS[j];
      else break;
    }
    return chosen;
  }

  function _paintLadder(awardedName) {
    var ladder = document.getElementById('jrrLadder');
    if (!ladder) return;
    var html = '';
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      var isAwarded = (r.name === awardedName);
      html += '<div class="jrr-tile" '
           +  'data-awarded="' + (isAwarded ? 'true' : 'false') + '" '
           +  'style="animation-delay:' + (i * 120) + 'ms;color:' + r.color + ';" '
           +  'aria-label="Tier ' + r.name + ', multiplier x' + r.multX + '">'
           +  '<span class="jrr-tile__name">' + r.name + '</span>'
           +  '<span class="jrr-tile__value">x' + r.multX + '</span>'
           +  '</div>';
    }
    ladder.innerHTML = html;
  }

  function _dismiss(reason) {
    if (!window.JRR_STATE.active) return;
    var placard = document.getElementById('jrrPlacard');
    if (placard) {
      placard.classList.remove('is-active');
      placard.setAttribute('aria-hidden', 'true');
    }
    if (_autoDismissTimer) {
      clearTimeout(_autoDismissTimer);
      _autoDismissTimer = null;
    }
    if (placard && _clickHandler) {
      placard.removeEventListener('click', _clickHandler);
      _clickHandler = null;
    }
    if (_focusReturn && typeof _focusReturn.focus === 'function') {
      try { _focusReturn.focus(); } catch (_) {}
      _focusReturn = null;
    }
    var dismissed = {
      roomName: window.JRR_STATE.roomName,
      reason:   typeof reason === 'string' ? reason : 'user',
    };
    window.JRR_STATE.active    = false;
    window.JRR_STATE.roomName  = null;
    window.JRR_STATE.multX     = 0;
    window.JRR_STATE.winAmount = 0;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onJackpotRoomDismissed', dismissed); } catch (_) {}
    }
  }

  window.jrrDismiss = _dismiss;

  function _onTrigger(payload) {
    /* HW guard: do nothing when neither HW nor BONUS context is active. */
    if (!_appliesNow()) return;
    var room = _resolveRoom(payload || {});
    if (!room) return;

    var winAmount = (payload && Number.isFinite(payload.winAmount))
      ? payload.winAmount
      : room.multX;
    var multX = (payload && Number.isFinite(payload.multX))
      ? payload.multX
      : room.multX;

    window.JRR_STATE.active    = true;
    window.JRR_STATE.roomName  = room.name;
    window.JRR_STATE.multX     = multX;
    window.JRR_STATE.winAmount = winAmount;

    _paintLadder(room.name);

    var placard = document.getElementById('jrrPlacard');
    if (placard) {
      placard.classList.add('is-active');
      placard.setAttribute('aria-hidden', 'false');
      try { _focusReturn = document.activeElement; } catch (_) { _focusReturn = null; }
      try { placard.focus(); } catch (_) {}

      _clickHandler = function() { _dismiss('user'); };
      placard.addEventListener('click', _clickHandler);
    }

    if (AUTO_DISMISS_MS > 0) {
      _autoDismissTimer = setTimeout(function() { _dismiss('auto'); }, AUTO_DISMISS_MS + REVEAL_ANIM_MS);
    }

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onJackpotRoomRevealed', {
          roomName:  room.name,
          multX:     multX,
          winAmount: winAmount,
        });
      } catch (_) {}
    }
  }

  function _onPreSpin()       { _dismiss('preSpin'); }
  function _onHwEnd()         { _dismiss('hwEnd'); }
  function _onSkipRequested() { _dismiss('skip'); }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onJackpotRoomTrigger', _onTrigger,        { priority: 30 });
    window.HookBus.on('preSpin',              _onPreSpin,        { priority: 30 });
    window.HookBus.on('onHoldAndWinEnd',      _onHwEnd,          { priority: 30 });
    window.HookBus.on('onSkipRequested',      _onSkipRequested,  { priority: 30 });
  }
})();
`;
}
