import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/perFsSpinMultiplier.mjs
 *
 * Wave LEGO-M1 — Per-FS-spin random multiplier.
 *
 * Purpose
 * ───────
 *   For Free Spins rounds where EACH individual FS spin carries its own
 *   independent random ×N multiplier (NOT a persistent accumulator).
 *   Industry-typical pattern: every FS spin draws a value from a
 *   weighted distribution; that value applies to that spin's payout
 *   only, and resets at the next FS spin. Distinct from:
 *     • multiplierLadder (progressive — grows monotonically)
 *     • persistentMultiplier (accumulates across spins, never resets)
 *     • multiplierOrb (per-cell symbol-bound multiplier)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "rolling multiplier" Free Spins format — value chip flashes
 *   above the reels at FS_PLAY start, applies to that spin's win, then
 *   re-rolls on the next FS spin.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitPerFsSpinMultiplierCSS(cfg)
 *   emitPerFsSpinMultiplierMarkup(cfg, model)
 *   emitPerFsSpinMultiplierRuntime(cfg, model)
 *   pickValueFromDistribution(distribution, rng)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onFsSpinResult (priority 30) — draws this spin's mult, paints chip
 *     • onFsEnd        (priority 30) — clears chip + state
 *   emits:
 *     • onPerFsSpinMultiplierRolled   { multX, fsRemain }
 *
 * Runtime contract
 * ────────────────
 *   window.PER_FS_SPIN_MULT_STATE = { current: number, history: number[] }
 *   window.perFsSpinMultPick()                returns chosen value
 *
 * GDD config keys (model.perFsSpinMultiplier)
 * ───────────────────────────────────────────
 *   { enabled, distribution: [{value, weight}, …],
 *     chipPosition: 'top'|'bottom'|'topRight'|'topLeft',
 *     fontSizePx, durationMs, chipColor }
 *
 * Performance budget: ≤ 0.3 ms per FS spin settle on 5×4 grid; 1
 * listener per event (wired-once via window.__PER_FS_SPIN_MULT_WIRED__).
 *
 * a11y: chip has role=status + aria-live=polite so screen readers
 * announce "Multiplier 5x" each spin; prefers-reduced-motion kills the
 * pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting the drawn value to HookBus.
 */

const CHIP_POSITIONS = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const FONT_SIZE_MIN  = 11;
const FONT_SIZE_MAX  = 48;
const DURATION_MIN_MS = 200;
const DURATION_MAX_MS = 8000;

const HEX_COLOR_RE   = /^#[0-9a-fA-F]{3,8}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:  2, weight: 50 },
  { value:  3, weight: 30 },
  { value:  5, weight: 15 },
  { value: 10, weight:  4 },
  { value: 25, weight:  1 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    chipPosition: 'top',
    fontSizePx: 22,
    durationMs: 1200,
    chipColor: '#ffe680',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.perFsSpinMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Array.isArray(src.distribution) && src.distribution.length > 0) {
    const filtered = src.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length > 0) cfg.distribution = filtered;
  }
  if (typeof src.chipPosition === 'string' && CHIP_POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (Number.isFinite(src.durationMs)) cfg.durationMs = clampInt(src.durationMs, DURATION_MIN_MS, DURATION_MAX_MS);
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;

  return cfg;
}

/**
 * Weighted pick from a distribution. Pure function — accepts an RNG so
 * tests can use a deterministic seed; defaults to Math.random.
 */
export function pickValueFromDistribution(distribution, rng = Math.random) {
  if (!Array.isArray(distribution) || distribution.length === 0) return 1;
  const total = distribution.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
  if (total <= 0) return distribution[0].value;
  let r = rng() * total;
  for (const e of distribution) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return distribution[distribution.length - 1].value;
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
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

export function emitPerFsSpinMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ perFsSpinMultiplier: cfg });
  if (!c.enabled) return `\n/* perFsSpinMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── perFsSpinMultiplier BLOCK — src/blocks/perFsSpinMultiplier.mjs ── */
.pfsm-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.chipColor};
  text-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 12px rgba(255,200,80,0.5);
  pointer-events: none;
  z-index: 70;
  opacity: 0;
  transition: opacity 250ms ease, transform 250ms ease;
}
.pfsm-chip.is-visible {
  opacity: 1;
  animation: pfsm-pulse ${Math.min(c.durationMs, 1500)}ms ease-out forwards;
}
@keyframes pfsm-pulse {
  0%   { transform: translateY(-8px) scale(0.7); opacity: 0; }
  20%  { transform: translateY(0)    scale(1.15); opacity: 1; }
  80%  { transform: translateY(0)    scale(1);   opacity: 1; }
  100% { transform: translateY(-12px) scale(0.95); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pfsm-chip.is-visible { animation: none; opacity: 1; }
}
`;
}

export function emitPerFsSpinMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ perFsSpinMultiplier: cfg });
  if (!c.enabled) return `\n<!-- perFsSpinMultiplier BLOCK (disabled) -->\n`;
  return tagBlockMarkup(`
<!-- perFsSpinMultiplier BLOCK — server-emitted markup -->
<div class="pfsm-chip" id="pfsmChip" role="status" aria-live="polite" aria-hidden="true"></div>
`, 'perFsSpinMultiplier');
}

export function emitPerFsSpinMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ perFsSpinMultiplier: cfg });
  if (!c.enabled) return `\n// perFsSpinMultiplier BLOCK (disabled) — no runtime\n`;

  const distJson = JSON.stringify(c.distribution);

  return `
/* ── perFsSpinMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__PER_FS_SPIN_MULT_WIRED__) return;
  window.__PER_FS_SPIN_MULT_WIRED__ = true;

  var DIST = ${distJson};
  var DURATION_MS = ${c.durationMs};

  window.PER_FS_SPIN_MULT_STATE = {
    current: 0,
    history: [],
  };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _pick() {
    var total = 0;
    for (var i = 0; i < DIST.length; i++) total += (DIST[i].weight > 0 ? DIST[i].weight : 0);
    if (total <= 0) return DIST[0].value;
    var r = _rng() * total;
    for (var j = 0; j < DIST.length; j++) {
      r -= DIST[j].weight;
      if (r <= 0) return DIST[j].value;
    }
    return DIST[DIST.length - 1].value;
  }

  function _show(value) {
    var chip = document.getElementById('pfsmChip');
    if (!chip) return;
    chip.textContent = 'x' + value;
    chip.setAttribute('aria-hidden', 'false');
    chip.classList.add('is-visible');
    setTimeout(function() {
      chip.classList.remove('is-visible');
      chip.setAttribute('aria-hidden', 'true');
    }, DURATION_MS);
  }

  function _isFsActive() {
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _onFsSpin() {
    if (!_isFsActive()) return;
    var v = _pick();
    window.PER_FS_SPIN_MULT_STATE.current = v;
    window.PER_FS_SPIN_MULT_STATE.history.push(v);
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(v);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onPerFsSpinMultiplierRolled', {
          multX: v,
          fsRemain: (window.FREESPINS && window.FREESPINS.remaining) || 0,
        });
      } catch (_) {}
    }
    _show(v);
  }

  function _onFsEnd() {
    window.PER_FS_SPIN_MULT_STATE.current = 0;
    window.PER_FS_SPIN_MULT_STATE.history = [];
    var chip = document.getElementById('pfsmChip');
    if (chip) {
      chip.classList.remove('is-visible');
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = '';
    }
  }

  window.perFsSpinMultPick = _pick;

  if (window.HookBus) {
    if (typeof window.HookBus.on === 'function') {
      window.HookBus.on('onFsSpinResult', _onFsSpin, { priority: 30 });
      window.HookBus.on('onFsEnd',        _onFsEnd, { priority: 30 });
    }
  }
})();
`;
}
