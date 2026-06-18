/**
 * src/blocks/holdAndWinRoomJackpotMultiplier.mjs
 *
 * Wave LEGO-HW-RJM — Hold & Win Room/Jackpot Multiplier ladder.
 *
 * Purpose
 * ───────
 *   For Hold & Win (Respin / Lock & Spin) rounds where the player
 *   progresses through a ladder of "rooms" (MINI → MINOR → MAJOR →
 *   GRAND) based on the cumulative number of locked orbs at any point
 *   in the round. Each room carries its own jackpot multiplier; the
 *   final reached room's multX is applied to the round-end bucket
 *   payout. Distinct from:
 *     • multiplierLadder (single counter, generic spin progression)
 *     • multiplierOrb (per-cell symbol-bound multiplier)
 *     • persistentMultiplier (FS-scope accumulator, never resets)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "room jackpot ladder" Hold & Win format — a HUD chip
 *   tracks the current room tier, promotes upward as the locked-orb
 *   count crosses each threshold, and the reached tier's multiplier
 *   resolves once the round ends.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitHoldAndWinRoomJackpotMultiplierCSS(cfg)
 *   emitHoldAndWinRoomJackpotMultiplierMarkup(cfg)
 *   emitHoldAndWinRoomJackpotMultiplierRuntime(cfg)
 *   resolveRoomForCount(rooms, lockedCount)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onHoldAndWinIntro (priority 30) — init ROOM_STATE to first room
 *     • onHoldAndWinLock  (priority 30) — re-evaluate room, promote if threshold crossed
 *     • onHoldAndWinEnd   (priority 30) — emit final room multiplier outcome
 *     • preSpin           (priority 30) — clear chip if H&W not active
 *   emits:
 *     • onRoomPromoted        { oldRoom, newRoom }
 *     • onRoomJackpotFinal    { room, multX, lockedCount }
 *
 * Runtime contract
 * ────────────────
 *   window.ROOM_STATE = { currentRoom: string, threshold: number, multX: number }
 *   Guard: SAMO radi dok window.HW_STATE.active === true
 *
 * GDD config keys (model.holdAndWinRoomJackpotMultiplier)
 * ───────────────────────────────────────────────────────
 *   { enabled,
 *     rooms: [ { name, threshold, multX }, … ]  // monotone-asc thresholds, first.threshold === 0,
 *     chipPosition: 'topLeft'|'topRight'|'bottomLeft'|'bottomRight',
 *     fontSizePx, chipColor, pulseMs }
 *
 * Performance budget: ≤ 0.2 ms per lock event on 5×4 grid; 1 listener
 * per event (wired-once via window.__HW_ROOM_JACKPOT_MULT_WIRED__).
 *
 * a11y: chip has role=status + aria-live=polite so screen readers
 * announce "Room MAJOR x5" on each promotion; prefers-reduced-motion
 * kills the pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting the room outcome to HookBus.
 */

const CHIP_POSITIONS = Object.freeze(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
const FONT_SIZE_MIN  = 10;
const FONT_SIZE_MAX  = 32;
const PULSE_MIN_MS   = 200;
const PULSE_MAX_MS   = 3000;

const HEX_COLOR_RE   = /^#[0-9a-fA-F]{3,8}$/;
const ROOM_NAME_RE   = /^[A-Z0-9_\- ]{1,24}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_ROOMS = Object.freeze([
  { name: 'MINI',  threshold:  0, multX:  1 },
  { name: 'MINOR', threshold:  5, multX:  2 },
  { name: 'MAJOR', threshold: 10, multX:  5 },
  { name: 'GRAND', threshold: 15, multX: 20 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    rooms: DEFAULT_ROOMS.map(r => ({ ...r })),
    chipPosition: 'topLeft',
    fontSizePx: 16,
    chipColor: '#ffd700',
    pulseMs: 800,
  });
}

/**
 * Validate a rooms array — must be non-empty, all entries shaped
 * { name:string, threshold:number, multX:number }, thresholds strictly
 * monotone-ascending, first entry threshold === 0, all multX ≥ 1.
 */
function isRoomsArrayValid(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  let prev = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || typeof r !== 'object') return false;
    if (typeof r.name !== 'string' || !ROOM_NAME_RE.test(r.name)) return false;
    if (!Number.isFinite(r.threshold) || r.threshold < 0) return false;
    if (!Number.isFinite(r.multX) || r.multX < 1) return false;
    if (i === 0 && r.threshold !== 0) return false;
    if (r.threshold <= prev) return false;
    prev = r.threshold;
  }
  return true;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.holdAndWinRoomJackpotMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (isRoomsArrayValid(src.rooms)) {
    cfg.rooms = src.rooms.map(r => ({
      name: String(r.name),
      threshold: Math.trunc(r.threshold),
      multX: Number(r.multX),
    }));
  }
  if (typeof src.chipPosition === 'string' && CHIP_POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (Number.isFinite(src.pulseMs)) cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;

  return cfg;
}

/**
 * Pure helper — given a rooms ladder and an integer lockedCount, return
 * the *highest* room whose threshold is ≤ lockedCount. Assumes rooms
 * are already monotone-ascending by threshold (as enforced by
 * resolveConfig / defaultConfig). Returns the last room on counts that
 * exceed all thresholds (cap behavior). Returns the first room when
 * lockedCount is 0 or negative.
 */
export function resolveRoomForCount(rooms, lockedCount) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const n = Number.isFinite(lockedCount) ? Math.trunc(lockedCount) : 0;
  let match = rooms[0];
  for (let i = 0; i < rooms.length; i++) {
    if (n >= rooms[i].threshold) match = rooms[i];
    else break;
  }
  return match;
}

function positionCss(pos) {
  switch (pos) {
    case 'topRight':    return 'top: 12px; right: 12px;';
    case 'bottomLeft':  return 'bottom: 12px; left: 12px;';
    case 'bottomRight': return 'bottom: 12px; right: 12px;';
    case 'topLeft':
    default:            return 'top: 12px; left: 12px;';
  }
}

export function emitHoldAndWinRoomJackpotMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinRoomJackpotMultiplier: cfg });
  if (!c.enabled) return `\n/* holdAndWinRoomJackpotMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── holdAndWinRoomJackpotMultiplier BLOCK — src/blocks/holdAndWinRoomJackpotMultiplier.mjs ── */
.hwrjm-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  font: 900 ${c.fontSizePx}px/1.1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.chipColor};
  background: rgba(0,0,0,0.55);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid ${c.chipColor};
  text-shadow: 0 2px 8px rgba(0,0,0,0.7);
  box-shadow: 0 0 12px rgba(255,215,0,0.35);
  pointer-events: none;
  z-index: 70;
  opacity: 0;
  transition: opacity 250ms ease, transform 250ms ease;
}
.hwrjm-chip.is-visible {
  opacity: 1;
}
.hwrjm-chip.is-promoted {
  animation: hwrjm-pulse ${c.pulseMs}ms ease-out;
}
@keyframes hwrjm-pulse {
  0%   { transform: scale(1);    box-shadow: 0 0 12px rgba(255,215,0,0.35); }
  40%  { transform: scale(1.18); box-shadow: 0 0 28px rgba(255,215,0,0.85); }
  100% { transform: scale(1);    box-shadow: 0 0 12px rgba(255,215,0,0.35); }
}
@media (prefers-reduced-motion: reduce) {
  .hwrjm-chip.is-promoted { animation: none; }
}
`;
}

export function emitHoldAndWinRoomJackpotMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinRoomJackpotMultiplier: cfg });
  if (!c.enabled) return `\n<!-- holdAndWinRoomJackpotMultiplier BLOCK (disabled) -->\n`;
  return `
<!-- holdAndWinRoomJackpotMultiplier BLOCK — server-emitted markup -->
<div class="hwrjm-chip" id="hwrjmChip" role="status" aria-live="polite" aria-hidden="true"></div>
`;
}

export function emitHoldAndWinRoomJackpotMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinRoomJackpotMultiplier: cfg });
  if (!c.enabled) return `\n// holdAndWinRoomJackpotMultiplier BLOCK (disabled) — no runtime\n`;

  const roomsJson = JSON.stringify(c.rooms);
  const pulseMs   = c.pulseMs;

  return `
/* ── holdAndWinRoomJackpotMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__HW_ROOM_JACKPOT_MULT_WIRED__) return;
  window.__HW_ROOM_JACKPOT_MULT_WIRED__ = true;

  var ROOMS = ${roomsJson};
  var PULSE_MS = ${pulseMs};

  window.ROOM_STATE = {
    currentRoom: ROOMS[0].name,
    threshold:   ROOMS[0].threshold,
    multX:       ROOMS[0].multX,
  };

  function _isHwActive() {
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _resolveRoomFor(count) {
    var n = (typeof count === 'number' && isFinite(count)) ? Math.trunc(count) : 0;
    var match = ROOMS[0];
    for (var i = 0; i < ROOMS.length; i++) {
      if (n >= ROOMS[i].threshold) match = ROOMS[i];
      else break;
    }
    return match;
  }

  function _paint(pulse) {
    var chip = document.getElementById('hwrjmChip');
    if (!chip) return;
    chip.textContent = 'ROOM: ' + window.ROOM_STATE.currentRoom + ' x' + window.ROOM_STATE.multX;
    chip.setAttribute('aria-hidden', 'false');
    chip.classList.add('is-visible');
    if (pulse) {
      chip.classList.remove('is-promoted');
      // restart animation
      void chip.offsetWidth;
      chip.classList.add('is-promoted');
      setTimeout(function() {
        if (chip) chip.classList.remove('is-promoted');
      }, PULSE_MS + 50);
    }
  }

  function _clear() {
    window.ROOM_STATE.currentRoom = ROOMS[0].name;
    window.ROOM_STATE.threshold   = ROOMS[0].threshold;
    window.ROOM_STATE.multX       = ROOMS[0].multX;
    var chip = document.getElementById('hwrjmChip');
    if (chip) {
      chip.classList.remove('is-visible');
      chip.classList.remove('is-promoted');
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = '';
    }
  }

  function _onIntro() {
    if (!_isHwActive()) return;
    var first = ROOMS[0];
    window.ROOM_STATE.currentRoom = first.name;
    window.ROOM_STATE.threshold   = first.threshold;
    window.ROOM_STATE.multX       = first.multX;
    _paint(false);
  }

  function _onLock(payload) {
    if (!_isHwActive()) return;
    var count = (payload && typeof payload.lockedCount === 'number')
      ? payload.lockedCount
      : ((window.HW_STATE && typeof window.HW_STATE.lockedCount === 'number') ? window.HW_STATE.lockedCount : 0);
    var next = _resolveRoomFor(count);
    var oldRoom = window.ROOM_STATE.currentRoom;
    if (next.name !== oldRoom) {
      window.ROOM_STATE.currentRoom = next.name;
      window.ROOM_STATE.threshold   = next.threshold;
      window.ROOM_STATE.multX       = next.multX;
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onRoomPromoted', { oldRoom: oldRoom, newRoom: next.name });
        } catch (_) {}
      }
      _paint(true);
    } else {
      _paint(false);
    }
  }

  function _onEnd(payload) {
    if (!_isHwActive()) {
      _clear();
      return;
    }
    var count = (payload && typeof payload.lockedCount === 'number')
      ? payload.lockedCount
      : ((window.HW_STATE && typeof window.HW_STATE.lockedCount === 'number') ? window.HW_STATE.lockedCount : 0);
    var final = _resolveRoomFor(count);
    window.ROOM_STATE.currentRoom = final.name;
    window.ROOM_STATE.threshold   = final.threshold;
    window.ROOM_STATE.multX       = final.multX;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onRoomJackpotFinal', {
          room: final.name,
          multX: final.multX,
          lockedCount: count,
        });
      } catch (_) {}
    }
    _paint(false);
  }

  function _onPreSpin() {
    if (!_isHwActive()) _clear();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onHoldAndWinIntro', _onIntro,   { priority: 30 });
    window.HookBus.on('onHoldAndWinLock',  _onLock,    { priority: 30 });
    window.HookBus.on('onHoldAndWinEnd',   _onEnd,     { priority: 30 });
    window.HookBus.on('preSpin',           _onPreSpin, { priority: 30 });
  }
})();
`;
}
