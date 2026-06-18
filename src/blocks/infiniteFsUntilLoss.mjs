/**
 * src/blocks/infiniteFsUntilLoss.mjs
 *
 * Wave LEGO-FSV.4 — Infinite Free Spins until first losing spin.
 *
 * Purpose
 * ───────
 *   FS round runs INDEFINITELY as long as each spin produces a win.
 *   The first losing FS spin ends the round. Counter UI shows the
 *   "current streak" rather than "remaining spins". Industry pattern:
 *   high-volatility FS mode with a rare-but-massive payout potential.
 *
 *   Implementation: on FS_TRIGGER set `FREESPINS.remaining` to a large
 *   sentinel (999) and track real exit condition through onFsSpinResult
 *   listener — if `winX === 0` (or any equivalent "no win" signal),
 *   force `FREESPINS.remaining = 0` so the natural FSM tail exits.
 *
 *   Distinct from existing FS blocks:
 *     • `freeSpins.mjs` — fixed spinsAwarded count
 *     • `superchargedFs.mjs` — retrigger × tier escalation
 *     • `tumbleOnlyFs.mjs` — tumble chains, not spin count
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Win and spin again" mode found on certain bonus rounds. Player
 *   keeps spinning as long as wins land; round ends on first miss.
 *   Counter UI flips from "N left" to "X consecutive wins".
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitInfiniteFsUntilLossCSS(cfg)
 *   emitInfiniteFsUntilLossRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger      (priority 36) — enter mode, set 999 sentinel
 *     • onFsSpinResult   (priority 36) — read winX; if 0 → end on this tail
 *     • onFsEnd          (priority 36) — clean exit, reset state
 *   emits:
 *     • onInfiniteFsStreakBumped   { streak }
 *     • onInfiniteFsModeEnded      { finalStreak }
 *
 * Runtime contract
 * ────────────────
 *   window.INFINITE_FS_STATE = { active, streak, sentinel }
 *
 * GDD config keys (model.infiniteFsUntilLoss)
 * ───────────────────────────────────────────
 *   { enabled, sentinelCount, chipColor, hudPosition }
 *
 * Performance: O(1) per FS spin.
 *
 * a11y: streak chip is role=status + aria-live=polite, announces
 * "Streak N" on changes.
 *
 * Senior-grade, wired-once, vendor-neutral.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const SENTINEL_MIN = 50;
const SENTINEL_MAX = 99999;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    sentinelCount: 999,
    chipColor: '#ff7a40',
    hudPosition: 'topLeft',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.infiniteFsUntilLoss) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.sentinelCount)) {
    cfg.sentinelCount = clampInt(src.sentinelCount, SENTINEL_MIN, SENTINEL_MAX);
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (typeof src.hudPosition === 'string' && POSITIONS.includes(src.hudPosition)) cfg.hudPosition = src.hudPosition;

  return cfg;
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 12px; left: 50%; transform: translateX(-50%);';
    case 'topRight': return 'top: 48px; right: 12px;';
    case 'topLeft':  return 'top: 48px; left: 12px;';
    case 'top':
    default:         return 'top: 48px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitInfiniteFsUntilLossCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ infiniteFsUntilLoss: cfg });
  if (!c.enabled) return `\n/* infiniteFsUntilLoss BLOCK (disabled) — no CSS */\n`;
  return `
/* ── infiniteFsUntilLoss BLOCK — src/blocks/infiniteFsUntilLoss.mjs ── */
.ifsl-chip {
  position: absolute;
  ${positionCss(c.hudPosition)}
  background: linear-gradient(180deg, rgba(50,18,8,.92), rgba(20,8,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 900 14px/1 system-ui, -apple-system, sans-serif;
  padding: 6px 11px;
  border-radius: 14px;
  z-index: 63;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease, transform 240ms ease;
}
.ifsl-chip.is-visible { opacity: 1; }
.ifsl-chip.is-bumping { animation: ifsl-bump 700ms cubic-bezier(.2,1.3,.4,1); }
@keyframes ifsl-bump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.22); box-shadow: 0 0 16px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .ifsl-chip { transition: none; }
  .ifsl-chip.is-bumping { animation: none; }
}
`;
}

export function emitInfiniteFsUntilLossRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ infiniteFsUntilLoss: cfg });
  if (!c.enabled) return `\n// infiniteFsUntilLoss BLOCK (disabled) — no runtime\n`;

  const sentinel = c.sentinelCount;

  return `
/* ── infiniteFsUntilLoss BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__INFINITE_FS_WIRED__) return;
  window.__INFINITE_FS_WIRED__ = true;

  var SENTINEL = ${sentinel};

  window.INFINITE_FS_STATE = { active: false, streak: 0, sentinel: SENTINEL };

  function _ensureChip() {
    var existing = document.getElementById('ifslChip');
    if (existing) return existing;
    var host = document.getElementById('gridHost');
    if (!host) host = document.body;
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'ifsl-chip';
    el.id = 'ifslChip';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    return el;
  }

  function _render() {
    var el = _ensureChip();
    if (!el) return;
    if (!window.INFINITE_FS_STATE.active) {
      el.classList.remove('is-visible', 'is-bumping');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'STREAK ' + window.INFINITE_FS_STATE.streak;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
  }

  function _bump() {
    var el = _ensureChip();
    if (!el) return;
    el.classList.add('is-bumping');
    setTimeout(function() { el.classList.remove('is-bumping'); }, 720);
  }

  function _onFsTrigger() {
    window.INFINITE_FS_STATE.active = true;
    window.INFINITE_FS_STATE.streak = 0;
    /* Bump FREESPINS.remaining to sentinel so the existing FS engine
     * keeps spinning. We control termination via onFsSpinResult. */
    try {
      if (window.FREESPINS && typeof window.FREESPINS === 'object') {
        window.FREESPINS.remaining = SENTINEL;
        window.FREESPINS._ifslSentinelActive = true;
      }
    } catch (_) {}
    _render();
  }

  function _onFsSpinResult(payload) {
    if (!window.INFINITE_FS_STATE.active) return;
    /* Determine win: payload carries winX (canonical FS spin payload key)
     * or totalWinX (when winPresentation accumulates across cascade
     * steps). We intentionally DROPPED the generic payload.win fallback
     * (Explore review 2026-06-18) — it collided semantically with non-FS
     * onSpinResult listeners that use a different win field shape. */
    var winX = 0;
    if (payload && typeof payload === 'object') {
      if (Number.isFinite(payload.winX)) winX = Number(payload.winX);
      else if (Number.isFinite(payload.totalWinX)) winX = Number(payload.totalWinX);
    }

    if (winX > 0) {
      window.INFINITE_FS_STATE.streak += 1;
      _bump();
      _render();
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onInfiniteFsStreakBumped', {
            streak: window.INFINITE_FS_STATE.streak,
          });
        } catch (_) {}
      }
    } else {
      /* First loss → end FS round on the next tail. */
      try {
        if (window.FREESPINS && typeof window.FREESPINS === 'object') {
          window.FREESPINS.remaining = 0;
        }
      } catch (_) {}
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onInfiniteFsModeEnded', {
            finalStreak: window.INFINITE_FS_STATE.streak,
          });
        } catch (_) {}
      }
    }
  }

  function _onFsEnd() {
    window.INFINITE_FS_STATE.active = false;
    window.INFINITE_FS_STATE.streak = 0;
    try {
      if (window.FREESPINS) window.FREESPINS._ifslSentinelActive = false;
    } catch (_) {}
    _render();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',    _onFsTrigger,    { priority: 36 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult, { priority: 36 });
    window.HookBus.on('onFsEnd',        _onFsEnd,        { priority: 36 });
  }
})();
`;
}
