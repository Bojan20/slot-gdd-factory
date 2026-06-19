/**
 * src/blocks/winBothWaysActivation.mjs
 *
 * Wave LEGO-FS3.1 — FS-only "win both ways" activation.
 *
 * Purpose
 * ───────
 *   During FS rounds, the paywin direction expands from default LTR
 *   (left-to-right) to BOTH ways (LTR + RTL). Base game stays LTR.
 *
 *   Industry-typical pattern: bonus-rich FS round upgrades the paywin
 *   evaluator so winning combinations are detected from BOTH ends.
 *   Boosts RTP within FS without changing reel pool or volatility.
 *
 *   Distinct from existing FS-mod blocks:
 *     • `superchargedFs.mjs`     — FS retrigger × tier escalation
 *     • `progressiveFreeSpins.mjs` — round mult progression
 *     • `tumbleGrowingFsMultiplier.mjs` — tumble-grown mult
 *     • `perFsSpinMultiplier.mjs` — per-FS-spin random ×N
 *     • `fsSymbolUpgradeEscalation.mjs` — LP→HP tier escalation
 *
 *   This block ONLY toggles a global flag (`window.__WIN_BOTH_WAYS__`)
 *   on FS enter / off on FS end. Downstream paylines evaluators check
 *   the flag and run RTL pass in addition to LTR.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Win both ways" FS upgrade present on many bonus-rich slots —
 *   transient evaluator-mode flip restricted to FS round.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitWinBothWaysActivationCSS(cfg)
 *   emitWinBothWaysActivationMarkup(cfg)
 *   emitWinBothWaysActivationRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger  (priority 28) — set flag + show HUD chip
 *     • onFsEnd       (priority 28) — clear flag + hide HUD chip
 *   emits:
 *     • onWinBothWaysActivated   { active: true }
 *     • onWinBothWaysDeactivated { active: false }
 *
 * Runtime contract
 * ────────────────
 *   window.__WIN_BOTH_WAYS__   boolean — read by paylines evaluator
 *   window.WIN_BOTH_WAYS_STATE = { active }
 *
 * GDD config keys (model.winBothWaysActivation)
 * ─────────────────────────────────────────────
 *   { enabled, chipColor, chipPosition, showChip }
 *
 * Performance: O(1) per FS lifecycle event.
 *
 * a11y: HUD chip is role=status + aria-live=polite, announces the
 * activation in screen readers.
 *
 * Senior-grade: wired-once via __WIN_BOTH_WAYS_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    chipColor: '#7af2c8',
    chipPosition: 'top',
    showChip: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.winBothWaysActivation) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (typeof src.chipPosition === 'string' && POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (src.showChip === false) cfg.showChip = false;

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

export function emitWinBothWaysActivationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ winBothWaysActivation: cfg });
  if (!c.enabled) return `\n/* winBothWaysActivation BLOCK (disabled) — no CSS */\n`;
  return `
/* ── winBothWaysActivation BLOCK — src/blocks/winBothWaysActivation.mjs ── */
.wbw-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  background: linear-gradient(180deg, rgba(10,30,22,.92), rgba(4,12,8,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 800 13px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 11px;
  border-radius: 14px;
  z-index: 62;
  letter-spacing: 0.05em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 280ms ease;
}
.wbw-chip.is-visible { opacity: 1; }
.wbw-chip.is-flash {
  animation: wbw-flash 1100ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes wbw-flash {
  0%   { transform: scale(0.7); box-shadow: 0 0 0 transparent; }
  50%  { transform: scale(1.3); box-shadow: 0 0 22px ${c.chipColor}; }
  100% { transform: scale(1);   box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .wbw-chip { transition: none; }
  .wbw-chip.is-flash { animation: none; }
}
`;
}

export function emitWinBothWaysActivationMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ winBothWaysActivation: cfg });
  if (!c.enabled || !c.showChip) return `\n<!-- winBothWaysActivation BLOCK (disabled or hidden) -->\n`;
  return `
<!-- winBothWaysActivation BLOCK — server-emitted markup -->
<div class="wbw-chip" id="wbwChip" role="status" aria-live="polite" aria-hidden="true">BOTH WAYS</div>
`;
}

export function emitWinBothWaysActivationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ winBothWaysActivation: cfg });
  if (!c.enabled) return `\n// winBothWaysActivation BLOCK (disabled) — no runtime\n`;

  return `
/* ── winBothWaysActivation BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__WIN_BOTH_WAYS_WIRED__) return;
  window.__WIN_BOTH_WAYS_WIRED__ = true;

  window.__WIN_BOTH_WAYS__   = false;
  window.WIN_BOTH_WAYS_STATE = { active: false };

  function _chip() { return document.getElementById('wbwChip'); }

  function _show() {
    var el = _chip();
    if (!el) return;
    el.classList.add('is-visible', 'is-flash');
    el.setAttribute('aria-hidden', 'false');
    setTimeout(function() { el.classList.remove('is-flash'); }, 1150);
  }

  function _hide() {
    var el = _chip();
    if (!el) return;
    el.classList.remove('is-visible', 'is-flash');
    el.setAttribute('aria-hidden', 'true');
  }

  function _onFsTrigger() {
    if (window.WIN_BOTH_WAYS_STATE.active) return;   /* idempotent on retrigger */
    window.__WIN_BOTH_WAYS__ = true;
    window.WIN_BOTH_WAYS_STATE.active = true;
    _show();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onWinBothWaysActivated', { active: true }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[winBothWaysActivation] activated emit failed', e); } catch (__) {}
      }
    }
  }

  function _onFsEnd() {
    if (!window.WIN_BOTH_WAYS_STATE.active) return;
    window.__WIN_BOTH_WAYS__ = false;
    window.WIN_BOTH_WAYS_STATE.active = false;
    _hide();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onWinBothWaysDeactivated', { active: false }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[winBothWaysActivation] deactivated emit failed', e); } catch (__) {}
      }
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger', _onFsTrigger, { priority: 28 });
    window.HookBus.on('onFsEnd',     _onFsEnd,     { priority: 28 });
  }
})();
`;
}
