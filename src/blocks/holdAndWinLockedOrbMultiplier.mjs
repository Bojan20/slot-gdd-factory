import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/holdAndWinLockedOrbMultiplier.mjs
 *
 * Wave LEGO-HW-M2 — Locked-orb ×N multiplier tag for Hold & Win respins.
 *
 * Purpose
 * ───────
 *   Alternative round-end semantics for Hold & Win where each locked orb
 *   carries a NUMERIC MULTIPLIER value (rolled at lock-time) instead of
 *   a fixed credit-bucket value. Final round payout is computed as:
 *       (base seed bet) × aggregate(allLockedOrbMultValues)
 *   where `aggregate` is either SUM (additive) or PRODUCT
 *   (multiplicative), driven by GDD knob `aggregation`. Distinct from:
 *     • holdAndWinCreditBucket  (credit values, additive sum)
 *     • multiplierOrb           (per-cell symbol-bound mult in base game)
 *     • persistentMultiplier    (accumulator across FS spins)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "multiplier orb in lock-and-respin" format — each locking
 *   orb stamps a chip ("×3", "×10", "×25") on its cell; when respins
 *   exhaust or grid fills, all chips combine into one payout multiplier
 *   on the seed bet.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitHoldAndWinLockedOrbMultiplierCSS(cfg)
 *   emitHoldAndWinLockedOrbMultiplierMarkup(cfg)
 *   emitHoldAndWinLockedOrbMultiplierRuntime(cfg)
 *   pickMultiplierValue(distribution, rng)   (pure helper, exported for tests)
 *   aggregateValues(values, mode)            (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onHoldAndWinLock (priority 30) — rolls a mult value for the new
 *                                        locked cell, stamps chip
 *     • onHoldAndWinEnd  (priority 30) — aggregates, emits final, clears
 *     • preSpin          (priority 30) — clears stale state when H&W not
 *                                        active
 *   emits:
 *     • onLockedOrbMultiplierRolled  { cellId, multValue }
 *     • onLockedOrbMultiplierFinal   { totalAdditive, totalProduct, count }
 *
 * Runtime contract
 * ────────────────
 *   window.LOCKED_ORB_MULT_STATE = {
 *     values:      Map<HTMLElement, number>,
 *     aggregation: 'additive' | 'multiplicative',
 *   }
 *   window.HW_STATE.active === true  is the hard gate; nothing happens
 *   in the base game.
 *
 * GDD config keys (model.holdAndWinLockedOrbMultiplier)
 * ─────────────────────────────────────────────────────
 *   { enabled, distribution: [{ value, weight }, …],
 *     aggregation: 'additive' | 'multiplicative',
 *     chipColor, fontSizePx, pulseMs }
 *
 * Performance budget: ≤ 0.2 ms per lock on a 5×4 grid; 3 listeners
 * total (wired-once via window.__HW_LOCKED_ORB_MULT_WIRED__).
 *
 * a11y: every chip has role=img + aria-label "Multiplier Nx" so screen
 * readers announce the lock; prefers-reduced-motion kills the pulse
 * keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting the aggregated values to HookBus.
 */

const AGGREGATIONS  = Object.freeze(['additive', 'multiplicative']);
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const PULSE_MIN_MS  = 200;
const PULSE_MAX_MS  = 2000;

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
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
    aggregation: 'additive',
    chipColor: '#ff8c42',
    fontSizePx: 14,
    pulseMs: 600,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.holdAndWinLockedOrbMultiplier) || {};

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

  if (typeof src.aggregation === 'string' && AGGREGATIONS.includes(src.aggregation)) {
    cfg.aggregation = src.aggregation;
  }

  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (Number.isFinite(src.pulseMs))    cfg.pulseMs    = clampInt(src.pulseMs,    PULSE_MIN_MS,  PULSE_MAX_MS);
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;

  return cfg;
}

/**
 * Weighted pick from a distribution. Pure function — accepts an RNG so
 * tests can use a deterministic seed; defaults to Math.random.
 */
export function pickMultiplierValue(distribution, rng = Math.random) {
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

/**
 * Combine a list of numeric multiplier values into a single round-end
 * payout multiplier. Pure function — no side effects, no math hooks
 * beyond arithmetic over the input.
 *
 *   mode 'additive'       → values.reduce(+) (sum); identity 0
 *   mode 'multiplicative' → values.reduce(*) (product); identity 1
 *
 * Non-numeric entries are filtered out before reduction.
 */
export function aggregateValues(values, mode = 'additive') {
  if (!Array.isArray(values) || values.length === 0) {
    return mode === 'multiplicative' ? 1 : 0;
  }
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length === 0) return mode === 'multiplicative' ? 1 : 0;
  if (mode === 'multiplicative') return clean.reduce((p, v) => p * v, 1);
  return clean.reduce((s, v) => s + v, 0);
}

export function emitHoldAndWinLockedOrbMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: cfg });
  if (!c.enabled) return `\n/* holdAndWinLockedOrbMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── holdAndWinLockedOrbMultiplier BLOCK — src/blocks/holdAndWinLockedOrbMultiplier.mjs ── */
.hwlom-chip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  min-width: 26px;
  height: 22px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: ${c.chipColor};
  color: #1a0a00;
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 0 rgba(255,255,255,0.35);
  box-shadow: 0 2px 6px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.4);
  pointer-events: none;
  z-index: 75;
  opacity: 0;
  transition: opacity 180ms ease, transform 180ms ease;
}
.hwlom-chip.is-visible {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
  animation: hwlom-pulse ${c.pulseMs}ms ease-out 1;
}
@keyframes hwlom-pulse {
  0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
  40%  { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .hwlom-chip.is-visible { animation: none; transform: translate(-50%, -50%) scale(1); }
}
`;
}

export function emitHoldAndWinLockedOrbMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: cfg });
  if (!c.enabled) return `\n<!-- holdAndWinLockedOrbMultiplier BLOCK (disabled) -->\n`;
  /* Chips are minted at runtime per locked cell; only a marker stub
     here so static integration tools can detect the block presence. */
  return tagBlockMarkup(`
<!-- holdAndWinLockedOrbMultiplier BLOCK — chips minted at runtime per locked cell -->
<div class="hwlom-root" data-hwlom-aggregation="${c.aggregation}" aria-hidden="true" hidden></div>
`, 'holdAndWinLockedOrbMultiplier');
}

export function emitHoldAndWinLockedOrbMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: cfg });
  if (!c.enabled) return `\n// holdAndWinLockedOrbMultiplier BLOCK (disabled) — no runtime\n`;

  const distJson = JSON.stringify(c.distribution);
  const aggJson  = JSON.stringify(c.aggregation);

  return `
/* ── holdAndWinLockedOrbMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__HW_LOCKED_ORB_MULT_WIRED__) return;
  window.__HW_LOCKED_ORB_MULT_WIRED__ = true;

  var DIST        = ${distJson};
  var AGGREGATION = ${aggJson};

  window.LOCKED_ORB_MULT_STATE = {
    values: new Map(),
    aggregation: AGGREGATION,
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

  function _isHwActive() {
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _stampChip(cellEl, value) {
    if (!cellEl || typeof cellEl.appendChild !== 'function') return;
    var chip = document.createElement('div');
    chip.className = 'hwlom-chip';
    chip.textContent = 'x' + value;
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', 'Multiplier ' + value + 'x');
    cellEl.appendChild(chip);
    /* Force layout flush so the transition runs on initial mint. */
    void chip.offsetWidth;
    chip.classList.add('is-visible');
  }

  function _clearState() {
    if (!window.LOCKED_ORB_MULT_STATE) return;
    try {
      window.LOCKED_ORB_MULT_STATE.values.forEach(function(_v, el) {
        if (el && el.querySelectorAll) {
          var chips = el.querySelectorAll('.hwlom-chip');
          for (var i = 0; i < chips.length; i++) chips[i].remove();
        }
      });
    } catch (_) {}
    window.LOCKED_ORB_MULT_STATE.values = new Map();
  }

  function _onHoldAndWinLock(payload) {
    if (!_isHwActive()) return;
    var cellEl = payload && (payload.cellEl || payload.el);
    var cellId = (payload && (payload.cellId || payload.id)) || null;
    if (!cellEl) return;
    if (window.LOCKED_ORB_MULT_STATE.values.has(cellEl)) return; /* idempotent */
    var v = _pick();
    window.LOCKED_ORB_MULT_STATE.values.set(cellEl, v);
    _stampChip(cellEl, v);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onLockedOrbMultiplierRolled', { cellId: cellId, multValue: v });
      } catch (_) {}
    }
  }

  function _onHoldAndWinEnd() {
    var vals = [];
    window.LOCKED_ORB_MULT_STATE.values.forEach(function(v) { vals.push(v); });
    var sum = 0, prod = 1;
    for (var i = 0; i < vals.length; i++) { sum += vals[i]; prod *= vals[i]; }
    if (vals.length === 0) { sum = 0; prod = 1; }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onLockedOrbMultiplierFinal', {
          totalAdditive:       sum,
          totalProduct:        prod,
          count:               vals.length,
        });
      } catch (_) {}
    }
    /* D-14.1 (Boki 2026-06-20): aggregate primenjen na payout multiplier.
     * Mode 'additive' (default per defaultConfig) → koristi sum; mode
     * 'multiplicative' → koristi product. setMultMax sprecava drift
     * ako frame-multiplier / room-jackpot blok takodje radi na istom
     * round-u. */
    var aggregate = (AGGREGATION === 'multiplicative') ? prod : sum;
    if (window.HookBus && typeof window.HookBus.setMultMax === 'function' &&
        Number.isFinite(aggregate) && aggregate >= 1) {
      try { window.HookBus.setMultMax(aggregate); } catch (_) {}
    }
    _clearState();
  }

  function _onPreSpin() {
    if (_isHwActive()) return;
    _clearState();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onHoldAndWinLock', _onHoldAndWinLock, { priority: 30 });
    window.HookBus.on('onHoldAndWinEnd',  _onHoldAndWinEnd,  { priority: 30 });
    window.HookBus.on('preSpin',          _onPreSpin,        { priority: 30 });
  }
})();
`;
}
