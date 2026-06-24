import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/retriggerMultiplierBump.mjs
 *
 * Wave LEGO-M4 — FS retrigger bumps the round multiplier by a fixed
 * step or via a configured ladder.
 *
 * Purpose
 * ───────
 *   Every FS retrigger (additional scatters during FS) BUMPS the round-
 *   level multiplier by a fixed `step` (default +1) OR by the next
 *   value in a configured ladder (e.g. 1 → 2 → 3 → 5 → 10). Distinct
 *   from:
 *     • `superchargedFs.mjs` (FS state mult escalation by tier)
 *     • `multiplierLadder.mjs` (progressive ladder, base-game)
 *     • `persistentMultiplier.mjs` (persistent accumulator, no retrigger gate)
 *
 *   This block specifically GATES the bump on `onFsRetrigger` HookBus
 *   event — only fires when a real retrigger lands, never on a normal
 *   FS spin. Industry-typical scaling: 1× → 2× → 3× → 5× → 10× → cap.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Retrigger-bump multiplier is a standard pattern in FS bonus rounds
 *   where scatter persistence is rewarded: more scatters during FS =
 *   higher round mult. Visible HUD chip flashes the new value when bump
 *   fires.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitRetriggerMultiplierBumpCSS(cfg)
 *   emitRetriggerMultiplierBumpMarkup(cfg)
 *   emitRetriggerMultiplierBumpRuntime(cfg, model)
 *   nextLadderValue(ladder, current)          (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger      (priority 25) — init round mult = ladder[0]
 *     • onFsRetrigger    (priority 25) — bump via step or ladder
 *     • onFsEnd          (priority 25) — reset state
 *   emits:
 *     • onRetriggerMultiplierBumped   { newMultX, retriggerCount }
 *
 * Runtime contract
 * ────────────────
 *   window.RETRIGGER_MULT_STATE = { current, retriggerCount }
 *
 * GDD config keys (model.retriggerMultiplierBump)
 * ───────────────────────────────────────────────
 *   { enabled, mode: 'step'|'ladder', step: 1, ladder: [1,2,3,5,10],
 *     chipColor, hudPosition }
 *
 * Performance: O(1) per retrigger, no DOM scan.
 *
 * a11y: HUD chip is role=status + aria-live=polite ("Multiplier 5x").
 *
 * Senior-grade, wired-once, vendor-neutral, JSDoc complete.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const MODES        = Object.freeze(['step', 'ladder']);
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const STEP_MIN     = 1;
const STEP_MAX     = 50;

const DEFAULT_LADDER = Object.freeze([1, 2, 3, 5, 10]);
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'step',
    step: 1,
    ladder: [...DEFAULT_LADDER],
    chipColor: '#ffd84d',
    hudPosition: 'topRight',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.retriggerMultiplierBump) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.mode === 'string' && MODES.includes(src.mode)) cfg.mode = src.mode;
  if (Number.isFinite(src.step)) cfg.step = clampInt(src.step, STEP_MIN, STEP_MAX);
  if (Array.isArray(src.ladder) && src.ladder.length > 0) {
    const filtered = src.ladder.filter(v => Number.isFinite(v) && v > 0).map(v => Number(v));
    /* Ladder must be strictly monotonic non-decreasing for predictable
     * bumps. Re-sort defensively to guarantee semantic contract. */
    if (filtered.length > 0) cfg.ladder = filtered.slice().sort((a, b) => a - b);
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (typeof src.hudPosition === 'string' && POSITIONS.includes(src.hudPosition)) cfg.hudPosition = src.hudPosition;

  return cfg;
}

/**
 * Walk to the next ladder value strictly greater than current. If
 * current is past the top, return the top (saturating cap). Pure.
 */
export function nextLadderValue(ladder, current) {
  if (!Array.isArray(ladder) || ladder.length === 0) return current;
  for (const v of ladder) {
    if (v > current) return v;
  }
  return ladder[ladder.length - 1];
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

export function emitRetriggerMultiplierBumpCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ retriggerMultiplierBump: cfg });
  if (!c.enabled) return `\n/* retriggerMultiplierBump BLOCK (disabled) — no CSS */\n`;
  return `
/* ── retriggerMultiplierBump BLOCK — src/blocks/retriggerMultiplierBump.mjs ── */
.rmb-chip {
  position: absolute;
  ${positionCss(c.hudPosition)}
  background: linear-gradient(180deg, rgba(60,40,10,.92), rgba(20,12,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 900 16px/1 system-ui, -apple-system, sans-serif;
  padding: 6px 12px;
  border-radius: 18px;
  z-index: 65;
  opacity: 0;
  transition: opacity 280ms ease, transform 280ms ease;
  pointer-events: none;
  letter-spacing: 0.04em;
}
.rmb-chip.is-visible {
  opacity: 1;
  transform: scale(1);
}
.rmb-chip.is-bumping {
  animation: rmb-bump 700ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes rmb-bump {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.3); box-shadow: 0 0 24px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .rmb-chip { transition: none; }
  .rmb-chip.is-bumping { animation: none; }
}
`;
}

export function emitRetriggerMultiplierBumpMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ retriggerMultiplierBump: cfg });
  if (!c.enabled) return `\n<!-- retriggerMultiplierBump BLOCK (disabled) -->\n`;
  return tagBlockMarkup(`
<!-- retriggerMultiplierBump BLOCK — server-emitted markup -->
<div class="rmb-chip" id="rmbChip" role="status" aria-live="polite" aria-hidden="true"></div>
`, 'retriggerMultiplierBump');
}

export function emitRetriggerMultiplierBumpRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ retriggerMultiplierBump: cfg });
  if (!c.enabled) return `\n// retriggerMultiplierBump BLOCK (disabled) — no runtime\n`;

  const mode      = c.mode;
  const step      = c.step;
  const ladderJs  = JSON.stringify(c.ladder);

  return `
/* ── retriggerMultiplierBump BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__RETRIGGER_MULT_WIRED__) return;
  window.__RETRIGGER_MULT_WIRED__ = true;

  var MODE   = ${JSON.stringify(mode)};
  var STEP   = ${step};
  var LADDER = ${ladderJs};

  window.RETRIGGER_MULT_STATE = { current: 1, retriggerCount: 0 };

  function _show(value) {
    var chip = document.getElementById('rmbChip');
    if (!chip) return;
    chip.textContent = 'MULT ' + value + 'x';
    chip.setAttribute('aria-hidden', 'false');
    chip.classList.add('is-visible', 'is-bumping');
    setTimeout(function() { chip.classList.remove('is-bumping'); }, 750);
  }

  function _hide() {
    var chip = document.getElementById('rmbChip');
    if (!chip) return;
    chip.classList.remove('is-visible', 'is-bumping');
    chip.setAttribute('aria-hidden', 'true');
    chip.textContent = '';
  }

  function _nextValue(current) {
    if (MODE === 'ladder') {
      for (var i = 0; i < LADDER.length; i++) {
        if (LADDER[i] > current) return LADDER[i];
      }
      return LADDER[LADDER.length - 1];
    }
    /* step mode */
    return current + STEP;
  }

  function _onFsTrigger() {
    window.RETRIGGER_MULT_STATE.current = (MODE === 'ladder' && LADDER.length > 0) ? LADDER[0] : 1;
    window.RETRIGGER_MULT_STATE.retriggerCount = 0;
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(window.RETRIGGER_MULT_STATE.current);
    }
    _show(window.RETRIGGER_MULT_STATE.current);
  }

  function _onFsRetrigger() {
    var current = window.RETRIGGER_MULT_STATE.current || 1;
    var next = _nextValue(current);
    window.RETRIGGER_MULT_STATE.current = next;
    window.RETRIGGER_MULT_STATE.retriggerCount++;
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(next);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onRetriggerMultiplierBumped', {
          newMultX: next,
          retriggerCount: window.RETRIGGER_MULT_STATE.retriggerCount,
        });
      } catch (_) {}
    }
    _show(next);
  }

  function _onFsEnd() {
    window.RETRIGGER_MULT_STATE.current = 1;
    window.RETRIGGER_MULT_STATE.retriggerCount = 0;
    _hide();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',   _onFsTrigger,   { priority: 25 });
    window.HookBus.on('onFsRetrigger', _onFsRetrigger, { priority: 25 });
    window.HookBus.on('onFsEnd',       _onFsEnd,       { priority: 25 });
  }
})();
`;
}
