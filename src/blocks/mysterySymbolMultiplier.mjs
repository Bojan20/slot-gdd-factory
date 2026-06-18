/**
 * src/blocks/mysterySymbolMultiplier.mjs
 *
 * Wave LEGO-M2 — Mystery symbol reveals as a multiplier value.
 *
 * Purpose
 * ───────
 *   Distinct from `mysterySymbol.mjs` (which reveals a random PAY symbol)
 *   and `multiplierOrb.mjs` (which IS the multiplier-bearing symbol).
 *
 *   This block fires when the mystery symbol reveals NOT into a regular
 *   pay symbol but into a MULTIPLIER VALUE (× N) that applies to the
 *   final chain payout. Industry pattern: "?"/MYST symbol lands → reveal
 *   animation flips it → reveals ×N chip on the cell → multiplier feeds
 *   into the total mult HUD via HookBus.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Mystery multiplier" variant of mystery-reveal feature found on
 *   cascade + ways slots. Reveal probability and value distribution
 *   are GDD-driven; this block is the PRESENTATION + state hook.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitMysterySymbolMultiplierCSS(cfg)
 *   emitMysterySymbolMultiplierRuntime(cfg, model)
 *   pickMysteryMultValue(distribution, rng)   (pure helper)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onSpinResult   (priority 25) — scan for mystery symbols, decide reveal
 *     • onTumbleStep   (priority 25) — same for cascade re-evaluation
 *     • preSpin        (priority 25) — clear any leftover chip from last spin
 *   emits:
 *     • onMysteryMultiplierRevealed   { cellKey, multX }
 *
 * Runtime contract
 * ────────────────
 *   window.MYSTERY_MULT_STATE = { lastReveals: [{cellKey, value}] }
 *
 * GDD config keys (model.mysterySymbolMultiplier)
 * ───────────────────────────────────────────────
 *   { enabled, mysterySymbolId, revealProbability,
 *     distribution: [{value, weight}, …], chipColor, fontSizePx }
 *
 * Performance budget: O(visible cells) per evaluation, ≤ 0.4 ms / spin.
 *
 * a11y: each revealed chip has aria-label="Mystery multiplier 5 times".
 *
 * Senior-grade: wired-once, idempotent emit, XSS-safe, prefers-reduced-
 * motion respected, JSDoc kontrakt complete.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z?]{1,4}$/;
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 36;
const PROB_MIN      = 0;
const PROB_MAX      = 1;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:  2, weight: 50 },
  { value:  3, weight: 30 },
  { value:  5, weight: 15 },
  { value: 10, weight:  4 },
  { value: 50, weight:  1 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mysterySymbolId: '?',
    revealProbability: 1.0,        /* 1.0 = every mystery reveals as mult */
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    chipColor: '#a8e6ff',
    fontSizePx: 18,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.mysterySymbolMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.mysterySymbolId === 'string' && SYMBOL_ID_RE.test(src.mysterySymbolId)) {
    cfg.mysterySymbolId = src.mysterySymbolId;
  }
  if (Number.isFinite(src.revealProbability)) {
    cfg.revealProbability = clampNum(src.revealProbability, PROB_MIN, PROB_MAX);
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
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);

  return cfg;
}

export function pickMysteryMultValue(distribution, rng = Math.random) {
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

export function emitMysterySymbolMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ mysterySymbolMultiplier: cfg });
  if (!c.enabled) return `\n/* mysterySymbolMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── mysterySymbolMultiplier BLOCK — src/blocks/mysterySymbolMultiplier.mjs ── */
.cell.has-mystery-mult-chip::after {
  content: attr(data-mystery-mult);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, sans-serif;
  color: ${c.chipColor};
  text-shadow: 0 2px 6px rgba(0,0,0,0.8), 0 0 10px rgba(168,230,255,0.6);
  pointer-events: none;
  z-index: 5;
  animation: msm-flip 600ms cubic-bezier(.2,1.3,.4,1) both;
}
@keyframes msm-flip {
  0%   { transform: translate(-50%, -50%) rotateY(180deg) scale(0.3); opacity: 0; }
  60%  { transform: translate(-50%, -50%) rotateY(0deg) scale(1.15); opacity: 1; }
  100% { transform: translate(-50%, -50%) rotateY(0deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .cell.has-mystery-mult-chip::after { animation: none; }
}
`;
}

export function emitMysterySymbolMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ mysterySymbolMultiplier: cfg });
  if (!c.enabled) return `\n// mysterySymbolMultiplier BLOCK (disabled) — no runtime\n`;

  const distJson    = JSON.stringify(c.distribution);
  const mysterySym  = c.mysterySymbolId;
  const revealProb  = c.revealProbability;

  return `
/* ── mysterySymbolMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MYSTERY_MULT_WIRED__) return;
  window.__MYSTERY_MULT_WIRED__ = true;

  var DIST = ${distJson};
  var MYSTERY_SYM = ${JSON.stringify(mysterySym)};
  var REVEAL_PROB = ${revealProb};

  window.MYSTERY_MULT_STATE = { lastReveals: [] };

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

  function _scan() {
    var cells = document.querySelectorAll('.cell');
    var newReveals = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (cell.classList.contains('has-mystery-mult-chip')) continue;   /* already revealed this spin */
      var sym = cell.getAttribute('data-symbol') || cell.textContent || '';
      sym = sym.trim().toUpperCase();
      if (sym !== MYSTERY_SYM.toUpperCase()) continue;
      if (_rng() > REVEAL_PROB) continue;
      var v = _pick();
      cell.setAttribute('data-mystery-mult', 'x' + v);
      cell.setAttribute('aria-label', 'Mystery multiplier ' + v + ' times');
      cell.classList.add('has-mystery-mult-chip');
      var key = (cell.getAttribute('data-reel') || '') + ',' + (cell.getAttribute('data-row') || '');
      newReveals.push({ cellKey: key, value: v });
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onMysteryMultiplierRevealed', { cellKey: key, multX: v }); } catch (_) {}
      }
    }
    window.MYSTERY_MULT_STATE.lastReveals = newReveals;

    /* Sum revealed mults into HookBus global mult so winPresentation
     * applies them on payout settle. Idempotent: only sums NEW reveals
     * from this evaluation pass. */
    if (newReveals.length > 0 && window.HookBus && typeof window.HookBus.setMult === 'function') {
      var sum = newReveals.reduce(function(s, r) { return s + r.value; }, 0);
      var current = (window.HookBus.lastMult || 1);
      window.HookBus.setMult(current + sum);
    }
  }

  function _clear() {
    var cells = document.querySelectorAll('.cell.has-mystery-mult-chip');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('has-mystery-mult-chip');
      cells[i].removeAttribute('data-mystery-mult');
      cells[i].removeAttribute('aria-label');
    }
    window.MYSTERY_MULT_STATE.lastReveals = [];
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _scan, { priority: 25 });
    window.HookBus.on('onTumbleStep', _scan, { priority: 25 });
    window.HookBus.on('preSpin',      _clear, { priority: 25 });
  }
})();
`;
}
