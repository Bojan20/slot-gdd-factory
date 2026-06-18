/**
 * src/blocks/tumbleOnlyFs.mjs
 *
 * Wave LEGO-FSV.3 — Tumble-only Free Spins (no fresh re-spin).
 *
 * Purpose
 * ───────
 *   FS variant where each "spin" is actually a tumble chain — no fresh
 *   reel spin, just cascade reductions until the board empties or the
 *   tumble chain dies. Each tumble step counts as one "FS spin"; the
 *   round ends when the configured number of tumble chains have run
 *   their course (or the reels run out of pre-seeded symbols).
 *
 *   This is fundamentally different from `tumble.mjs`:
 *     • `tumble.mjs` — cascade AFTER a win, base spin still runs first
 *     • `tumbleOnlyFs` — NO base spin during FS; only tumbles consume
 *
 *   Industry pattern: Crystal-Forge-style "drop everything once, then
 *   tumble until empty" FS mode that gives a single continuous chain
 *   for the entire FS round.
 *
 *   Distinct from `infinityReelsEngine`:
 *     • infinityReels grows grid per win
 *     • tumbleOnlyFs runs cascade-only spins on a static grid
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Tumble only" / "single drop" FS mode found on cascade slots. One
 *   board fill at FS_INTRO, then tumble until no wins, then count down.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitTumbleOnlyFsCSS(cfg)
 *   emitTumbleOnlyFsRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger      (priority 32) — enter tumble-only mode
 *     • onTumbleStep     (priority 32) — decrement chain counter
 *     • onFsEnd          (priority 32) — exit mode
 *   emits:
 *     • onTumbleOnlyFsModeEntered   { chainsBudget }
 *     • onTumbleOnlyFsChainEnded    { chainsRemaining }
 *
 * Runtime contract
 * ────────────────
 *   window.TUMBLE_ONLY_FS_STATE = { active, chainsRemaining, chainsBudget }
 *
 * GDD config keys (model.tumbleOnlyFs)
 * ────────────────────────────────────
 *   { enabled, chainsBudget, hudBadgeColor, hudPosition }
 *
 * Performance: O(1) per tumble step.
 *
 * a11y: HUD badge has role=status, aria-live=polite — announces
 * "Chains remaining N" on change.
 *
 * Senior-grade, wired-once, vendor-neutral.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const CHAINS_MIN   = 1;
const CHAINS_MAX   = 99;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    chainsBudget: 10,
    hudBadgeColor: '#a8e6ff',
    hudPosition: 'topRight',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.tumbleOnlyFs) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.chainsBudget)) cfg.chainsBudget = clampInt(src.chainsBudget, CHAINS_MIN, CHAINS_MAX);
  if (typeof src.hudBadgeColor === 'string' && HEX_COLOR_RE.test(src.hudBadgeColor)) cfg.hudBadgeColor = src.hudBadgeColor;
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

export function emitTumbleOnlyFsCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ tumbleOnlyFs: cfg });
  if (!c.enabled) return `\n/* tumbleOnlyFs BLOCK (disabled) — no CSS */\n`;
  return `
/* ── tumbleOnlyFs BLOCK — src/blocks/tumbleOnlyFs.mjs ── */
.tofs-badge {
  position: absolute;
  ${positionCss(c.hudPosition)}
  background: linear-gradient(180deg, rgba(20,30,50,.92), rgba(8,18,32,.92));
  border: 1px solid ${c.hudBadgeColor};
  color: ${c.hudBadgeColor};
  font: 800 13px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 10px;
  border-radius: 14px;
  z-index: 63;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease, transform 240ms ease;
}
.tofs-badge.is-visible { opacity: 1; }
.tofs-badge.is-decrementing { animation: tofs-flash 500ms ease-out; }
@keyframes tofs-flash {
  0%   { transform: scale(1.18); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .tofs-badge { transition: none; }
  .tofs-badge.is-decrementing { animation: none; }
}
`;
}

export function emitTumbleOnlyFsRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ tumbleOnlyFs: cfg });
  if (!c.enabled) return `\n// tumbleOnlyFs BLOCK (disabled) — no runtime\n`;

  const budget = c.chainsBudget;

  return `
/* ── tumbleOnlyFs BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__TUMBLE_ONLY_FS_WIRED__) return;
  window.__TUMBLE_ONLY_FS_WIRED__ = true;

  var BUDGET = ${budget};

  window.TUMBLE_ONLY_FS_STATE = { active: false, chainsRemaining: 0, chainsBudget: BUDGET };

  /* QA hardening (Explore review 2026-06-18): downstream tumble engines
   * differ in payload contract — some emit an ended / isLast flag
   * on the chain-final step, others just stop firing onTumbleStep.
   * Defensive fallback: if no tumble step arrives for CHAIN_IDLE_MS,
   * count the chain as ended and decrement remaining. Prevents the
   * counter from hanging at full budget on engines without an end
   * payload. */
  var CHAIN_IDLE_MS = 2200;
  var _chainIdleTimer = null;

  function _markChainEnded() {
    if (!window.TUMBLE_ONLY_FS_STATE.active) return;
    if (window.TUMBLE_ONLY_FS_STATE.chainsRemaining <= 0) return;
    window.TUMBLE_ONLY_FS_STATE.chainsRemaining -= 1;
    var el = _ensureBadge();
    if (el) {
      el.classList.add('is-decrementing');
      setTimeout(function() { el.classList.remove('is-decrementing'); }, 520);
    }
    _render();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onTumbleOnlyFsChainEnded', {
          chainsRemaining: window.TUMBLE_ONLY_FS_STATE.chainsRemaining,
        });
      } catch (_) {}
    }
  }

  function _armIdleTimer() {
    if (_chainIdleTimer) clearTimeout(_chainIdleTimer);
    _chainIdleTimer = setTimeout(_markChainEnded, CHAIN_IDLE_MS);
  }

  function _disarmIdleTimer() {
    if (_chainIdleTimer) { clearTimeout(_chainIdleTimer); _chainIdleTimer = null; }
  }

  function _ensureBadge() {
    var existing = document.getElementById('tofsBadge');
    if (existing) return existing;
    var host = document.getElementById('gridHost');
    if (!host) host = document.body;
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'tofs-badge';
    el.id = 'tofsBadge';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    return el;
  }

  function _render() {
    var el = _ensureBadge();
    if (!el) return;
    if (!window.TUMBLE_ONLY_FS_STATE.active) {
      el.classList.remove('is-visible', 'is-decrementing');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'CHAINS ' + window.TUMBLE_ONLY_FS_STATE.chainsRemaining + '/' + window.TUMBLE_ONLY_FS_STATE.chainsBudget;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
  }

  function _onFsTrigger() {
    window.TUMBLE_ONLY_FS_STATE.active = true;
    window.TUMBLE_ONLY_FS_STATE.chainsRemaining = BUDGET;
    window.TUMBLE_ONLY_FS_STATE.chainsBudget = BUDGET;
    _render();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onTumbleOnlyFsModeEntered', { chainsBudget: BUDGET }); } catch (_) {}
    }
  }

  function _onTumbleStep(payload) {
    if (!window.TUMBLE_ONLY_FS_STATE.active) return;
    /* Path A — engine emits an explicit end-of-chain flag. Honor it
     * synchronously; chain ended now. */
    var ended = payload && (payload.ended === true || payload.isLast === true || payload.tumbleEnded === true);
    if (ended) {
      _disarmIdleTimer();
      _markChainEnded();
      return;
    }
    /* Path B — engine just stops firing onTumbleStep with no flag.
     * Re-arm the idle timer so we mark the chain ended after a quiet
     * window. Defensive against engines that do not carry an end flag. */
    _armIdleTimer();
  }

  function _onFsEnd() {
    _disarmIdleTimer();
    window.TUMBLE_ONLY_FS_STATE.active = false;
    window.TUMBLE_ONLY_FS_STATE.chainsRemaining = 0;
    _render();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',  _onFsTrigger,  { priority: 32 });
    window.HookBus.on('onTumbleStep', _onTumbleStep, { priority: 32 });
    window.HookBus.on('onFsEnd',      _onFsEnd,      { priority: 32 });
  }
})();
`;
}
