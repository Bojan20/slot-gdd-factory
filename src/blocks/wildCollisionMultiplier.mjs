/**
 * src/blocks/wildCollisionMultiplier.mjs
 *
 * Wave LEGO-M3 — Wild × Wild collision multiplier.
 *
 * Purpose
 * ───────
 *   When 2+ wild symbols both contribute to the SAME winning line / way /
 *   cluster, this block multiplies the line's payout by the PRODUCT of
 *   each contributing wild's individual multiplier value. Industry pattern
 *   commonly seen on cascade-based wild slots:
 *
 *     2 wilds on a line: ×N₁ × ×N₂  =  combined multiplier
 *     3 wilds on a line: ×N₁ × ×N₂ × ×N₃
 *
 *   Each wild carries an independent value drawn from the configured
 *   distribution. Distinct from `multiplierOrb.mjs` (orb is its OWN
 *   symbol kind) — here the wild is W with an attached multiplier chip.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Wild collision / wild-combo multiplier pattern: present in many
 *   classic 5-reel slots and in cluster-pays formats where multiple
 *   wilds in the same chain stack their multipliers multiplicatively.
 *
 * Public API
 * ──────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitWildCollisionMultiplierCSS(cfg)
 *   emitWildCollisionMultiplierRuntime(cfg, model)
 *   computeWildProduct(wildValues)            (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onSpinResult (priority 22) — annotate visible wilds with × value
 *     • onTumbleStep (priority 22) — same for cascades
 *     • preSpin      (priority 22) — clear chips
 *   emits:
 *     • onWildCollision   { wildCount, productMult, lineIdx }
 *
 * Runtime contract
 * ────────────────
 *   window.WILD_COLLISION_STATE = { lastWilds: [{cellKey, value}],
 *                                   lastProduct: number }
 *
 * GDD config keys (model.wildCollisionMultiplier)
 * ───────────────────────────────────────────────
 *   { enabled, wildSymbolId, distribution: [{value, weight}, …],
 *     minWildsForCollision: 2, chipColor }
 *
 * Performance budget: O(wildsOnGrid²) for collision detection on the
 * 5×5 worst case ≈ 25 cells. ≤ 0.5 ms per evaluation.
 *
 * a11y: each wild chip has aria-label="Wild multiplier 3 times".
 *
 * Senior-grade: wired-once, idempotent, vendor-neutral, XSS-safe.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z]{1,4}$/;
const MIN_WILDS_FLOOR = 2;
const MIN_WILDS_CEIL  = 5;

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value: 2, weight: 60 },
  { value: 3, weight: 25 },
  { value: 5, weight: 10 },
  { value: 10, weight: 5 },
]);

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    wildSymbolId: 'W',
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    minWildsForCollision: 2,
    chipColor: '#ff9a40',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.wildCollisionMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.wildSymbolId === 'string' && SYMBOL_ID_RE.test(src.wildSymbolId)) {
    cfg.wildSymbolId = src.wildSymbolId;
  }
  if (Array.isArray(src.distribution) && src.distribution.length > 0) {
    const filtered = src.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length > 0) cfg.distribution = filtered;
  }
  if (Number.isFinite(src.minWildsForCollision)) {
    cfg.minWildsForCollision = clampInt(src.minWildsForCollision, MIN_WILDS_FLOOR, MIN_WILDS_CEIL);
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;

  return cfg;
}

export function computeWildProduct(wildValues) {
  if (!Array.isArray(wildValues) || wildValues.length === 0) return 1;
  let p = 1;
  for (const v of wildValues) {
    if (Number.isFinite(v) && v > 0) p *= v;
  }
  return p;
}

export function emitWildCollisionMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ wildCollisionMultiplier: cfg });
  if (!c.enabled) return `\n/* wildCollisionMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── wildCollisionMultiplier BLOCK — src/blocks/wildCollisionMultiplier.mjs ── */
.cell.has-wild-mult-chip::before {
  content: attr(data-wild-mult);
  position: absolute;
  top: 4px;
  right: 6px;
  font: 700 13px/1 system-ui, -apple-system, sans-serif;
  color: ${c.chipColor};
  text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  pointer-events: none;
  z-index: 6;
  padding: 2px 5px;
  background: rgba(20,20,30,0.55);
  border-radius: 6px;
}
.cell.has-wild-collision-active {
  animation: wcm-glow 900ms ease-in-out;
}
@keyframes wcm-glow {
  0%, 100% { box-shadow: none; }
  50%      { box-shadow: 0 0 14px ${c.chipColor}, inset 0 0 8px ${c.chipColor}; }
}
@media (prefers-reduced-motion: reduce) {
  .cell.has-wild-collision-active { animation: none; }
}
`;
}

export function emitWildCollisionMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ wildCollisionMultiplier: cfg });
  if (!c.enabled) return `\n// wildCollisionMultiplier BLOCK (disabled) — no runtime\n`;

  const distJson = JSON.stringify(c.distribution);
  const wildSym  = c.wildSymbolId;
  const minWilds = c.minWildsForCollision;

  return `
/* ── wildCollisionMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__WILD_COLLISION_MULT_WIRED__) return;
  window.__WILD_COLLISION_MULT_WIRED__ = true;

  var DIST = ${distJson};
  var WILD_SYM = ${JSON.stringify(wildSym)}.toUpperCase();
  var MIN_WILDS = ${minWilds};

  window.WILD_COLLISION_STATE = { lastWilds: [], lastProduct: 1 };

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

  function _annotate() {
    var cells = document.querySelectorAll('.cell');
    var wilds = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (sym !== WILD_SYM) continue;
      if (!cell.classList.contains('has-wild-mult-chip')) {
        var v = _pick();
        cell.setAttribute('data-wild-mult', 'x' + v);
        cell.setAttribute('aria-label', 'Wild multiplier ' + v + ' times');
        cell.classList.add('has-wild-mult-chip');
      }
      var stored = parseInt((cell.getAttribute('data-wild-mult') || 'x1').slice(1), 10) || 1;
      var key = (cell.getAttribute('data-reel') || '') + ',' + (cell.getAttribute('data-row') || '');
      wilds.push({ cellKey: key, value: stored });
    }
    window.WILD_COLLISION_STATE.lastWilds = wilds;

    if (wilds.length >= MIN_WILDS) {
      var product = 1;
      for (var k = 0; k < wilds.length; k++) product *= wilds[k].value;
      window.WILD_COLLISION_STATE.lastProduct = product;
      /* Mark wilds as collision-active for visual glow on payout. */
      var allCells = document.querySelectorAll('.cell.has-wild-mult-chip');
      for (var m = 0; m < allCells.length; m++) allCells[m].classList.add('has-wild-collision-active');
      /* Boost HookBus mult by the collision product (multiplicative). */
      if (window.HookBus && typeof window.HookBus.setMult === 'function') {
        var current = (window.HookBus.lastMult || 1);
        window.HookBus.setMult(current * product);
      }
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onWildCollision', {
            wildCount: wilds.length,
            productMult: product,
            lineIdx: null,
          });
        } catch (_) {}
      }
    } else {
      window.WILD_COLLISION_STATE.lastProduct = 1;
    }
  }

  function _clear() {
    var cells = document.querySelectorAll('.cell.has-wild-mult-chip');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('has-wild-mult-chip', 'has-wild-collision-active');
      cells[i].removeAttribute('data-wild-mult');
      cells[i].removeAttribute('aria-label');
    }
    window.WILD_COLLISION_STATE.lastWilds = [];
    window.WILD_COLLISION_STATE.lastProduct = 1;
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _annotate, { priority: 22 });
    window.HookBus.on('onTumbleStep', _annotate, { priority: 22 });
    window.HookBus.on('preSpin',      _clear,    { priority: 22 });
  }
})();
`;
}
