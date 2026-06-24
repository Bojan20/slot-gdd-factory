import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/moneyGrabGrid.mjs
 *
 * Wave LEGO-B2.2 — Pick-N-cells money grab grid.
 *
 * Purpose
 * ───────
 *   Player is shown an N×M grid of face-down cells. Each tap reveals
 *   a money value (×bet) from the configured distribution. Player
 *   continues until they hit `maxPicks` (configurable) — that's the
 *   round end. Total = Σ revealed values. No STOP terminator.
 *
 *   Distinct from `matchThreeBonusReveal` (which terminates on match-3
 *   or STOP) — this is a HARD-CAPPED pick game with no termination
 *   risk; player keeps picking until N picks done.
 *
 *   Distinct from `bonusPick.mjs` (1-row line) and `pickBonusReveal`
 *   (single-row reveal) — this is the MULTI-ROW pick grid pattern.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Money grab" bonus pattern present on many slots — pick N items
 *   from a grid, sum and award. Common in cash-themed FS replacements.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitMoneyGrabGridCSS(cfg)
 *   emitMoneyGrabGridMarkup(cfg)
 *   emitMoneyGrabGridRuntime(cfg, model)
 *   pickGridValue(distribution, rng)        (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onMoneyGrabRequested  (priority 34) — mount overlay
 *     • onFsEnd                (priority 34) — defensive cleanup
 *   emits:
 *     • onMoneyGrabEntered     { rows, cols, maxPicks }
 *     • onMoneyGrabRevealed    { cellIdx, valueX, picksRemaining }
 *     • onMoneyGrabEnded       { awardX, picks }
 *
 * Runtime contract
 * ────────────────
 *   window.MONEY_GRAB_STATE = {
 *     active, revealed: [{idx, valueX}], picksUsed, picksMax, awardX,
 *   }
 *   window.moneyGrabForceReveal(idx)          (QA hook)
 *
 * GDD config keys (model.moneyGrabGrid)
 * ─────────────────────────────────────
 *   { enabled, rows, cols, maxPicks, distribution,
 *     overlayBg, cardColor, cardRevealedColor, fontSizePx }
 *
 * Performance: O(1) per reveal.
 *
 * a11y: each cell is <button> sa aria-label; overlay is role="dialog"
 * + aria-modal=true; running total in role="status" aria-live="polite".
 *
 * Senior-grade: wired-once via __MONEY_GRAB_WIRED__, idempotent,
 * vendor-neutral, XSS-safe escape, prefers-reduced-motion respected,
 * try/catch sa console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 36;
const ROWS_MIN = 1;
const ROWS_MAX = 8;
const COLS_MIN = 1;
const COLS_MAX = 8;
const PICKS_MIN = 1;
const PICKS_MAX = 30;

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:   1, weight: 30 },
  { value:   2, weight: 25 },
  { value:   5, weight: 18 },
  { value:  10, weight: 14 },
  { value:  25, weight:  8 },
  { value: 100, weight:  4 },
  { value: 500, weight:  1 },
]);

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    rows: 4,
    cols: 5,
    maxPicks: 6,
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    overlayBg: '#08111d',
    cardColor: '#1a3030',
    cardRevealedColor: '#7af2c8',
    fontSizePx: 16,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.moneyGrabGrid) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.rows)) cfg.rows = clampInt(src.rows, ROWS_MIN, ROWS_MAX);
  if (Number.isFinite(src.cols)) cfg.cols = clampInt(src.cols, COLS_MIN, COLS_MAX);
  if (Number.isFinite(src.maxPicks)) cfg.maxPicks = clampInt(src.maxPicks, PICKS_MIN, PICKS_MAX);
  /* Cap maxPicks by total cells. */
  cfg.maxPicks = Math.min(cfg.maxPicks, cfg.rows * cfg.cols);
  if (Array.isArray(src.distribution) && src.distribution.length >= 1) {
    const filtered = src.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length >= 1) cfg.distribution = filtered;
  }
  if (typeof src.overlayBg === 'string' && HEX_COLOR_RE.test(src.overlayBg)) cfg.overlayBg = src.overlayBg;
  if (typeof src.cardColor === 'string' && HEX_COLOR_RE.test(src.cardColor)) cfg.cardColor = src.cardColor;
  if (typeof src.cardRevealedColor === 'string' && HEX_COLOR_RE.test(src.cardRevealedColor)) {
    cfg.cardRevealedColor = src.cardRevealedColor;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);

  return cfg;
}

/** Pure: weighted pick from distribution. Returns numeric prize value. */
export function pickGridValue(distribution, rng = Math.random) {
  if (!Array.isArray(distribution) || distribution.length === 0) return 0;
  let total = 0;
  for (const e of distribution) total += (e.weight > 0 ? e.weight : 0);
  if (total <= 0) return distribution[0].value;
  let r = rng() * total;
  for (const e of distribution) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return distribution[distribution.length - 1].value;
}

export function emitMoneyGrabGridCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ moneyGrabGrid: cfg });
  if (!c.enabled) return `\n/* moneyGrabGrid BLOCK (disabled) — no CSS */\n`;
  return `
/* ── moneyGrabGrid BLOCK — src/blocks/moneyGrabGrid.mjs ── */
.mgg-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: ${c.overlayBg}ee;
  z-index: 90;
  flex-direction: column;
  gap: 16px;
}
.mgg-overlay.is-visible { display: flex; }
.mgg-title {
  font: 900 22px/1 system-ui, -apple-system, sans-serif;
  color: #f4eecf;
  letter-spacing: 0.06em;
}
.mgg-picks {
  font: 700 14px/1 system-ui, -apple-system, sans-serif;
  color: ${c.cardRevealedColor};
}
.mgg-grid {
  display: grid;
  grid-template-columns: repeat(${c.cols}, 78px);
  grid-template-rows: repeat(${c.rows}, 60px);
  gap: 6px;
}
.mgg-card {
  background: linear-gradient(180deg, ${c.cardColor}, ${c.cardColor}cc);
  border: 2px solid ${c.cardColor};
  border-radius: 8px;
  color: #f4eecf;
  font: 800 ${c.fontSizePx}px/1 system-ui, -apple-system, sans-serif;
  cursor: pointer;
  transition: transform 220ms ease, border-color 220ms ease, background 220ms ease;
  min-width: 44px; min-height: 44px;
}
.mgg-card:hover:not(.is-revealed),
.mgg-card:focus-visible {
  transform: translateY(-2px);
  border-color: ${c.cardRevealedColor};
  outline: 2px solid ${c.cardRevealedColor};
  outline-offset: 2px;
}
.mgg-card.is-revealed {
  background: ${c.cardRevealedColor};
  color: #08111d;
  border-color: ${c.cardRevealedColor};
  cursor: default;
  animation: mgg-flip 460ms cubic-bezier(.2,1.3,.4,1) both;
}
.mgg-running {
  font: 800 16px/1 system-ui, -apple-system, sans-serif;
  color: ${c.cardRevealedColor};
}
@keyframes mgg-flip {
  0%   { transform: rotateY(180deg) scale(0.5); opacity: 0; }
  60%  { transform: rotateY(0deg) scale(1.12); opacity: 1; }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .mgg-card { transition: none; }
  .mgg-card.is-revealed { animation: none; }
}
`;
}

export function emitMoneyGrabGridMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ moneyGrabGrid: cfg });
  if (!c.enabled) return `\n<!-- moneyGrabGrid BLOCK (disabled) -->\n`;
  const total = c.rows * c.cols;
  let cards = '';
  for (let i = 0; i < total; i++) {
    cards += `
      <button type="button" class="mgg-card" data-mgg-idx="${i}"
              aria-label="Money card ${i + 1} face down"
              aria-pressed="false">?</button>`;
  }
  return tagBlockMarkup(`
<!-- moneyGrabGrid BLOCK — server-emitted markup -->
<div class="mgg-overlay" id="mggOverlay" role="dialog" aria-modal="true" aria-labelledby="mggTitle" aria-hidden="true">
  <h2 class="mgg-title" id="mggTitle">PICK ${c.maxPicks} TO COLLECT</h2>
  <!-- WCAG 4.1.3 (F4 A3) — picks-left counter mutated on every reveal; SR re-announce. -->
  <div class="mgg-picks" id="mggPicks" aria-live="polite" aria-atomic="true">PICKS LEFT: ${c.maxPicks}</div>
  <div class="mgg-grid" role="group" aria-label="Money grab pick grid">${cards}
  </div>
  <!-- WCAG 4.1.3 (F4 A3) — atomic so full "TOTAL: Nx" is re-spoken, not diff. -->
  <div class="mgg-running" id="mggRunning" role="status" aria-live="polite" aria-atomic="true">TOTAL: 0x</div>
</div>
`, 'moneyGrabGrid');
}

export function emitMoneyGrabGridRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ moneyGrabGrid: cfg });
  if (!c.enabled) return `\n// moneyGrabGrid BLOCK (disabled) — no runtime\n`;

  const distJson = JSON.stringify(c.distribution);
  const rows     = c.rows;
  const cols     = c.cols;
  const maxPicks = c.maxPicks;

  return `
/* ── moneyGrabGrid BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MONEY_GRAB_WIRED__) return;
  window.__MONEY_GRAB_WIRED__ = true;

  var DIST = ${distJson};
  var ROWS = ${rows};
  var COLS = ${cols};
  var MAX_PICKS = ${maxPicks};
  var TOTAL_CELLS = ROWS * COLS;

  window.MONEY_GRAB_STATE = {
    active: false,
    revealed: [],
    picksUsed: 0,
    picksMax: MAX_PICKS,
    awardX: 0,
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

  function _overlay()  { return document.getElementById('mggOverlay'); }
  function _picksEl()  { return document.getElementById('mggPicks');  }
  function _runEl()    { return document.getElementById('mggRunning'); }

  function _show() {
    var el = _overlay();
    if (!el) return;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
    var first = el.querySelector('.mgg-card');
    if (first) try { first.focus(); } catch (_) {}
  }

  function _hide() {
    var el = _overlay();
    if (!el) return;
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
  }

  function _renderHud() {
    var st = window.MONEY_GRAB_STATE;
    var pE = _picksEl();
    if (pE) pE.textContent = 'PICKS LEFT: ' + (st.picksMax - st.picksUsed);
    var rE = _runEl();
    if (rE) rE.textContent = 'TOTAL: ' + st.awardX + 'x';
  }

  function _reveal(idx) {
    var st = window.MONEY_GRAB_STATE;
    if (!st.active) return;
    var raw = parseInt(idx, 10);
    if (!Number.isFinite(raw)) return;
    if (raw < 0 || raw >= TOTAL_CELLS) return;
    if (st.picksUsed >= st.picksMax) return;
    /* Already revealed? */
    for (var i = 0; i < st.revealed.length; i++) {
      if (st.revealed[i].idx === raw) return;
    }
    var valueX = _pick();
    st.revealed.push({ idx: raw, valueX: valueX });
    st.picksUsed += 1;
    st.awardX += Number(valueX);

    var cardSel = '.mgg-card[data-mgg-idx="' + raw + '"]';
    var card = document.querySelector(cardSel);
    if (card) {
      card.classList.add('is-revealed');
      card.textContent = 'x' + valueX;
      card.setAttribute('aria-pressed', 'true');
      card.setAttribute('aria-label', 'Money card ' + (raw + 1) + ' revealed ' + valueX + ' times bet');
    }

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onMoneyGrabRevealed', {
          cellIdx: raw,
          valueX: valueX,
          picksRemaining: st.picksMax - st.picksUsed,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[moneyGrabGrid] revealed emit failed', e); } catch (__) {}
      }
    }

    _renderHud();

    if (st.picksUsed >= st.picksMax) {
      _end();
    }
  }

  function _end() {
    var st = window.MONEY_GRAB_STATE;
    st.active = false;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onMoneyGrabEnded', { awardX: st.awardX, picks: st.picksUsed });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[moneyGrabGrid] end emit failed', e); } catch (__) {}
      }
    }
    setTimeout(_hide, 1400);
  }

  function _reset() {
    window.MONEY_GRAB_STATE = {
      active: false, revealed: [], picksUsed: 0, picksMax: MAX_PICKS, awardX: 0,
    };
    var cards = document.querySelectorAll('.mgg-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.remove('is-revealed');
      cards[i].textContent = '?';
      cards[i].setAttribute('aria-pressed', 'false');
      cards[i].setAttribute('aria-label', 'Money card ' + (i + 1) + ' face down');
    }
    _renderHud();
  }

  function _enter() {
    /* FIX-6 (deep QA #9, 2026-06-19) — mutex hard-gate. See
     * matchThreeBonusReveal._enter for rationale. */
    if (typeof window !== 'undefined'
        && typeof window.bonusOverlayMutexIsBusyForKind === 'function'
        && window.bonusOverlayMutexIsBusyForKind('moneyGrab')) {
      return;
    }
    _reset();
    window.MONEY_GRAB_STATE.active = true;
    _renderHud();
    _show();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onMoneyGrabEntered', { rows: ROWS, cols: COLS, maxPicks: MAX_PICKS }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[moneyGrabGrid] enter emit failed', e); } catch (__) {}
      }
    }
  }

  function _wire() {
    var cards = document.querySelectorAll('.mgg-card[data-mgg-idx]');
    for (var i = 0; i < cards.length; i++) (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        _reveal(btn.getAttribute('data-mgg-idx'));
      });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _reveal(btn.getAttribute('data-mgg-idx'));
        }
      });
    })(cards[i]);
  }

  window.moneyGrabForceReveal = function(idx) { _reveal(idx); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onMoneyGrabRequested', _enter, { priority: 34 });
    window.HookBus.on('onFsEnd',              function() { if (window.MONEY_GRAB_STATE.active) _hide(); }, { priority: 34 });
  }
})();
`;
}
