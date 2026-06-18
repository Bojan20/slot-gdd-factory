/**
 * src/blocks/totalMultiplierChip.mjs
 *
 * Wave LEGO-M6 — Global accumulated-multiplier HUD chip.
 *
 * Purpose
 * ───────
 *   Universal HUD widget showing the CURRENT global multiplier — the
 *   product of every mult source active right now (orb sum, persistent,
 *   FS retrigger bump, wild collision product, cluster size tier, etc.).
 *   Listens to `HookBus.setMult` calls and renders the live value in a
 *   chip that pulses on each change.
 *
 *   Distinct from per-feature chips:
 *     • multiplierOrb chip = per-cell orb value
 *     • winMultiplierBadge = per-line or per-cluster badge
 *     • retriggerMultiplierBump chip = round-mult during FS retrigger
 *
 *   `totalMultiplierChip` is the SINGLE source of truth display for
 *   "what mult applies to the next payout settle". Players always know.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Global mult chip is a UX pattern found across multiplier-rich slots.
 *   Sits above or below the reels, badges every change, decays to a
 *   passive state between events.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitTotalMultiplierChipCSS(cfg)
 *   emitTotalMultiplierChipMarkup(cfg)
 *   emitTotalMultiplierChipRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onMultiplierChanged   (priority 50) — bus signal that lastMult moved
 *     • preSpin               (priority 50) — reset to 1× chip visual
 *     • onFsEnd               (priority 50) — reset to 1× chip visual
 *   emits: (none — pure display)
 *
 * Runtime contract
 * ────────────────
 *   window.TOTAL_MULT_CHIP_STATE = { lastSeen: number }
 *
 * GDD config keys (model.totalMultiplierChip)
 * ───────────────────────────────────────────
 *   { enabled, position, fontSizePx, chipColor, hideWhenOne }
 *
 * Performance: O(1) per update, single DOM mutation per HookBus emit.
 *
 * a11y: chip has role=status + aria-live=polite, announces "Total
 * multiplier 5x" on changes.
 *
 * Senior-grade, wired-once, vendor-neutral.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 36;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    position: 'topLeft',
    fontSizePx: 16,
    chipColor: '#ffe680',
    hideWhenOne: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.totalMultiplierChip) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.position === 'string' && POSITIONS.includes(src.position)) cfg.position = src.position;
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (src.hideWhenOne === false) cfg.hideWhenOne = false;

  return cfg;
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 12px; left: 50%; transform: translateX(-50%);';
    case 'topRight': return 'top: 12px; right: 12px;';
    case 'topLeft':  return 'top: 12px; left: 12px;';
    case 'top':
    default:         return 'top: 12px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitTotalMultiplierChipCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ totalMultiplierChip: cfg });
  if (!c.enabled) return `\n/* totalMultiplierChip BLOCK (disabled) — no CSS */\n`;
  return `
/* ── totalMultiplierChip BLOCK — src/blocks/totalMultiplierChip.mjs ── */
.tmc-chip {
  position: absolute;
  ${positionCss(c.position)}
  background: linear-gradient(180deg, rgba(40,30,10,.92), rgba(20,12,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 11px;
  border-radius: 14px;
  z-index: 64;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease, transform 240ms ease;
}
.tmc-chip.is-visible { opacity: 1; }
.tmc-chip.is-pulsing { animation: tmc-pulse 600ms cubic-bezier(.2,1.3,.4,1); }
@keyframes tmc-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.25); box-shadow: 0 0 18px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .tmc-chip { transition: none; }
  .tmc-chip.is-pulsing { animation: none; }
}
`;
}

export function emitTotalMultiplierChipMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ totalMultiplierChip: cfg });
  if (!c.enabled) return `\n<!-- totalMultiplierChip BLOCK (disabled) -->\n`;
  return `
<!-- totalMultiplierChip BLOCK — server-emitted markup -->
<div class="tmc-chip" id="tmcChip" role="status" aria-live="polite" aria-hidden="true">TOTAL 1x</div>
`;
}

export function emitTotalMultiplierChipRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ totalMultiplierChip: cfg });
  if (!c.enabled) return `\n// totalMultiplierChip BLOCK (disabled) — no runtime\n`;

  return `
/* ── totalMultiplierChip BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__TOTAL_MULT_CHIP_WIRED__) return;
  window.__TOTAL_MULT_CHIP_WIRED__ = true;

  var HIDE_WHEN_ONE = ${c.hideWhenOne};

  window.TOTAL_MULT_CHIP_STATE = { lastSeen: 1 };

  function _chip() { return document.getElementById('tmcChip'); }

  function _render(value) {
    var el = _chip();
    if (!el) return;
    var v = Math.max(1, Math.round(Number(value) || 1));
    if (v === window.TOTAL_MULT_CHIP_STATE.lastSeen) return;
    window.TOTAL_MULT_CHIP_STATE.lastSeen = v;

    el.textContent = 'TOTAL ' + v + 'x';
    if (HIDE_WHEN_ONE && v <= 1) {
      el.classList.remove('is-visible', 'is-pulsing');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-visible', 'is-pulsing');
    setTimeout(function() { el.classList.remove('is-pulsing'); }, 650);
  }

  function _reset() {
    window.TOTAL_MULT_CHIP_STATE.lastSeen = 1;
    var el = _chip();
    if (!el) return;
    el.textContent = 'TOTAL 1x';
    if (HIDE_WHEN_ONE) {
      el.classList.remove('is-visible', 'is-pulsing');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function _onMultChanged(payload) {
    var v = (payload && (payload.multX || payload.value)) ||
            (window.HookBus && window.HookBus.lastMult) || 1;
    _render(v);
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onMultiplierChanged', _onMultChanged, { priority: 50 });
    window.HookBus.on('preSpin',             _reset,         { priority: 50 });
    window.HookBus.on('onFsEnd',             _reset,         { priority: 50 });
  }
})();
`;
}
