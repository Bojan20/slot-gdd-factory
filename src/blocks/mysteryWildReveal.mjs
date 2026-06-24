/**
 * src/blocks/mysteryWildReveal.mjs
 *
 * Wave LEGO-W2.2 — Mystery symbol reveals as WILD.
 *
 * Purpose
 * ───────
 *   Mystery "?" symbol on the grid is revealed not as a pay symbol but
 *   as the WILD symbol. Industry pattern that gives the player a
 *   guaranteed contribution to chain wins from any cell that survived
 *   to reveal phase. Distinct from:
 *
 *     • `mysterySymbol.mjs`            — reveals as a random PAY symbol
 *     • `mysterySymbolMultiplier.mjs`  — reveals as a ×N multiplier value
 *     • `mysteryReveal.mjs`            — generic mystery flip animation
 *
 *   This block converts the mystery cell directly to the configured
 *   wild symbol id (`W` by default) and emits a single canonical event
 *   per reveal so downstream listeners (wildCollisionMultiplier,
 *   cascadingWildPersistence, winPresentation) can react.
 *
 *   The revealed cell is fully wild for evaluation purposes — engine
 *   reads `data-symbol` after this block runs.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Mystery wild" variant of mystery-reveal feature; player tap +
 *   reveal animation (flip / pulse) lands on a wild glyph. Probability
 *   and timing are GDD-driven; this block is the PRESENTATION + state
 *   hook.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitMysteryWildRevealCSS(cfg)
 *   emitMysteryWildRevealRuntime(cfg, model)
 *   shouldRevealAsWild(rng, revealProbability)   (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onSpinResult   (priority 26) — scan + reveal
 *     • onTumbleStep   (priority 26) — same for cascade re-evaluation
 *     • preSpin        (priority 26) — clear last reveals
 *   emits:
 *     • onMysteryWildRevealed   { cellKey, wildSymbolId }
 *
 * Runtime contract
 * ────────────────
 *   window.MYSTERY_WILD_STATE = { lastReveals: string[] }
 *
 * GDD config keys (model.mysteryWildReveal)
 * ─────────────────────────────────────────
 *   { enabled, mysterySymbolId, wildSymbolId, revealProbability,
 *     wildColor, fontSizePx }
 *
 * Performance: O(visible cells) per evaluation pass, ≤ 0.3 ms typical.
 *
 * a11y: revealed cell gets aria-label="Wild revealed" + role=note
 * (announces via aria-live polite on the page so screen readers note
 * the reveal).
 *
 * Senior-grade: wired-once via __MYSTERY_WILD_WIRED__, idempotent,
 * XSS-safe, vendor-neutral, prefers-reduced-motion respected.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z?]{1,4}$/;
const WILD_ID_RE    = /^[A-Z]{1,4}$/;
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 48;
const PROB_MIN      = 0;
const PROB_MAX      = 1;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mysterySymbolId: '?',
    wildSymbolId: 'W',
    revealProbability: 1.0,
    wildColor: '#ff9a40',
    fontSizePx: 22,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.mysteryWildReveal) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.mysterySymbolId === 'string' && SYMBOL_ID_RE.test(src.mysterySymbolId)) {
    cfg.mysterySymbolId = src.mysterySymbolId;
  }
  if (typeof src.wildSymbolId === 'string' && WILD_ID_RE.test(src.wildSymbolId)) {
    cfg.wildSymbolId = src.wildSymbolId;
  }
  if (Number.isFinite(src.revealProbability)) {
    cfg.revealProbability = clampNum(src.revealProbability, PROB_MIN, PROB_MAX);
  }
  if (typeof src.wildColor === 'string' && HEX_COLOR_RE.test(src.wildColor)) cfg.wildColor = src.wildColor;
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);

  /* UQ-DEEP-R P2 fix: features[].config inheritance. Block was never
   * enabling itself off GDD declared feature; only top-level reads. */
  if (Array.isArray(model.features)) {
    const f = model.features.find((x) => x && x.kind === 'mystery_wild_reveal');
    if (f) {
      cfg.enabled = true;
      const fc = f.config || f.opts || {};
      if (typeof fc.mysterySymbolId === 'string' && SYMBOL_ID_RE.test(fc.mysterySymbolId)
          && src.mysterySymbolId == null) cfg.mysterySymbolId = fc.mysterySymbolId;
      if (typeof fc.wildSymbolId === 'string' && WILD_ID_RE.test(fc.wildSymbolId)
          && src.wildSymbolId == null) cfg.wildSymbolId = fc.wildSymbolId;
      if (Number.isFinite(fc.revealProbability) && src.revealProbability == null) {
        cfg.revealProbability = clampNum(fc.revealProbability, PROB_MIN, PROB_MAX);
      }
    }
  }
  return cfg;
}

/**
 * Pure: decide whether THIS roll reveals as wild. Accepts an injected
 * RNG so tests can use a deterministic seed; defaults to Math.random.
 */
export function shouldRevealAsWild(rng = Math.random, revealProbability = 1.0) {
  const p = Number(revealProbability);
  if (!Number.isFinite(p) || p <= 0) return false;
  if (p >= 1) return true;
  return rng() < p;
}

export function emitMysteryWildRevealCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ mysteryWildReveal: cfg });
  if (!c.enabled) return `\n/* mysteryWildReveal BLOCK (disabled) — no CSS */\n`;
  return `
/* ── mysteryWildReveal BLOCK — src/blocks/mysteryWildReveal.mjs ── */
.cell.has-mystery-wild-reveal {
  animation: mwr-flip 700ms cubic-bezier(.2,1.3,.4,1) both;
  outline: 2px solid ${c.wildColor};
  outline-offset: -2px;
  box-shadow: 0 0 14px ${c.wildColor};
  z-index: 5;
}
.cell.has-mystery-wild-reveal::after {
  content: "★";
  position: absolute;
  top: 2px;
  left: 4px;
  color: ${c.wildColor};
  font-size: ${Math.max(11, c.fontSizePx - 6)}px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  pointer-events: none;
}
@keyframes mwr-flip {
  0%   { transform: rotateY(180deg) scale(0.4); opacity: 0; }
  60%  { transform: rotateY(0deg) scale(1.18); opacity: 1; }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .cell.has-mystery-wild-reveal { animation: none; }
}
`;
}

export function emitMysteryWildRevealRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ mysteryWildReveal: cfg });
  if (!c.enabled) return `\n// mysteryWildReveal BLOCK (disabled) — no runtime\n`;

  const mysterySym = c.mysterySymbolId;
  const wildSym    = c.wildSymbolId;
  const revealProb = c.revealProbability;

  return `
/* ── mysteryWildReveal BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MYSTERY_WILD_WIRED__) return;
  window.__MYSTERY_WILD_WIRED__ = true;

  var MYSTERY_SYM = ${JSON.stringify(mysterySym)}.toUpperCase();
  var WILD_SYM    = ${JSON.stringify(wildSym)}.toUpperCase();
  var REVEAL_PROB = ${revealProb};

  window.MYSTERY_WILD_STATE = { lastReveals: [] };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _cellKey(cell) {
    return (cell.getAttribute('data-reel') || '') + ',' + (cell.getAttribute('data-row') || '');
  }

  function _scanAndReveal() {
    /* UQ-DEEP-R P3 fix: H&W gate. Mystery ? reveal must defer during
     * H&W round — locked-orb layer owns cells. */
    if (window.HW_STATE && window.HW_STATE.active === true) return;
    if (window.__HW_ACTIVE__ === true) return;
    var cells = document.querySelectorAll('.cell');
    var newReveals = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      /* 2026-06-19 QA fix (general-purpose agent F3): if cell already
       * has-mystery-wild-reveal but its data-symbol is no longer WILD
       * (engine reused the DOM node and refilled with a different
       * symbol), strip the reveal class so the visual ★ badge doesn't
       * remain stuck over a non-wild glyph. Then re-evaluate this cell
       * normally below. */
      var sym = (cell.getAttribute('data-symbol') || cell.textContent || '').trim().toUpperCase();
      if (cell.classList.contains('has-mystery-wild-reveal')) {
        if (sym !== WILD_SYM) {
          cell.classList.remove('has-mystery-wild-reveal');
          cell.removeAttribute('aria-label');
          cell.removeAttribute('role');
        } else {
          continue;   /* genuinely still revealed; skip */
        }
      }
      if (sym !== MYSTERY_SYM) continue;
      if (REVEAL_PROB < 1.0 && _rng() >= REVEAL_PROB) continue;

      /* Mutate the cell to wild. Engine + downstream evaluators read
       * data-symbol so this is the authoritative reveal. */
      cell.setAttribute('data-symbol', WILD_SYM);
      if (cell.textContent !== undefined) cell.textContent = WILD_SYM;
      cell.setAttribute('aria-label', 'Wild revealed');
      cell.setAttribute('role', 'note');
      cell.classList.add('has-mystery-wild-reveal');

      var key = _cellKey(cell);
      newReveals.push(key);

      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onMysteryWildRevealed', { cellKey: key, wildSymbolId: WILD_SYM });
        } catch (e) {
          try { if (typeof console !== 'undefined' && console.warn) console.warn('[mysteryWildReveal] emit failed', e); } catch (__) {}
        }
      }
    }
    /* 2026-06-19 QA fix (general-purpose agent F4): always assign
     * lastReveals (even when empty) so consumers reading state after
     * onTumbleStep get FRESH data for THIS step, not stale data from
     * a previous step. Previously this only assigned on non-empty
     * which left stale keys hanging in state across tumble steps. */
    window.MYSTERY_WILD_STATE.lastReveals = newReveals;
  }

  function _clear() {
    var cells = document.querySelectorAll('.cell.has-mystery-wild-reveal');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('has-mystery-wild-reveal');
      cells[i].removeAttribute('aria-label');
      cells[i].removeAttribute('role');
    }
    window.MYSTERY_WILD_STATE.lastReveals = [];
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _scanAndReveal, { priority: 26 });
    window.HookBus.on('onTumbleStep', _scanAndReveal, { priority: 26 });
    window.HookBus.on('preSpin',      _clear,         { priority: 26 });
  }
})();
`;
}
