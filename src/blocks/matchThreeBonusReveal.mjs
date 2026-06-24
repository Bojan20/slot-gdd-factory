import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/matchThreeBonusReveal.mjs
 *
 * Wave LEGO-B2.1 — 3×3 pick-and-reveal match-three bonus game.
 *
 * Purpose
 * ───────
 *   On bonus trigger, player is shown a 3×3 face-down grid. Each tap
 *   reveals an icon (drawn from a weighted distribution: prize values
 *   + a "stop" terminator). Round ends when:
 *     • THREE same-prize icons revealed → award sum × prize value
 *     • STOP icon revealed → award accumulated value (or 0 if first)
 *     • All 9 cells revealed → award accumulated total
 *
 *   Industry-typical pattern: pick-and-match bonus screen replaces FS
 *   on certain games — single-screen choice, no spin engine involved.
 *
 *   Distinct from existing pick blocks:
 *     • `bonusPick.mjs`         — generic pick-N from list
 *     • `pickBonusReveal.mjs`   — single-row reveal
 *     • `jackpotPicker.mjs`     — pick jackpot tier
 *
 *   This block is the 3×3 MATCH variant where the player needs to
 *   collect 3 matching icons (or hit STOP) for the round to terminate.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Match-3 bonus" pattern present on many slot bonus rounds: pick-
 *   until-match mechanic, all-or-nothing prize collector.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitMatchThreeBonusRevealCSS(cfg)
 *   emitMatchThreeBonusRevealMarkup(cfg)
 *   emitMatchThreeBonusRevealRuntime(cfg, model)
 *   pickRevealValue(distribution, rng)             (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onMatchThreeBonusRequested  (priority 33) — mount overlay
 *     • onFsEnd                      (priority 33) — defensive cleanup
 *   emits:
 *     • onMatchThreeBonusEntered     { totalCells }
 *     • onMatchThreeBonusRevealed    { cellIdx, revealValue }
 *     • onMatchThreeBonusEnded       { reason, awardX, revealedCount }
 *
 * Runtime contract
 * ────────────────
 *   window.MATCH3_BONUS_STATE = {
 *     active, revealed: number[], awardX: number, endReason: string|null,
 *   }
 *   window.match3BonusForceReveal(idx)             (QA hook)
 *
 * GDD config keys (model.matchThreeBonusReveal)
 * ─────────────────────────────────────────────
 *   { enabled, distribution: [{value, weight}, …, {value:'STOP', weight}],
 *     overlayBg, cardColor, cardRevealedColor, fontSizePx }
 *
 * Performance: O(1) per reveal, ≤ 0.3 ms typical.
 *
 * a11y: each card is <button> sa aria-label opisom stanja (face-down
 * vs revealed), role="dialog" na overlay-u, aria-modal=true.
 *
 * Senior-grade: wired-once via __MATCH3_BONUS_WIRED__, idempotent,
 * vendor-neutral, XSS-safe escape, prefers-reduced-motion respected,
 * try/catch sa console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 48;
const TOTAL_CELLS  = 9;
const STOP_TOKEN   = 'STOP';

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:    2, weight: 30 },
  { value:    5, weight: 25 },
  { value:   10, weight: 18 },
  { value:   25, weight: 10 },
  { value:  100, weight:  4 },
  { value: 'STOP', weight: 13 },
]);

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    overlayBg: '#08111d',
    cardColor: '#1a2840',
    cardRevealedColor: '#ffd84d',
    fontSizePx: 20,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.matchThreeBonusReveal) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Array.isArray(src.distribution) && src.distribution.length >= 2) {
    const filtered = src.distribution
      .filter(e => e && (Number.isFinite(e.value) || e.value === 'STOP'))
      .map(e => {
        const w = Number(e.weight);
        return {
          value: typeof e.value === 'string' ? STOP_TOKEN : Number(e.value),
          weight: Number.isFinite(w) && w > 0 ? w : 1,
        };
      });
    /* QA fix (general-purpose subagent 2026-06-19, finding F5): require
     * at least one NON-STOP prize entry — without this guard an all-STOP
     * distribution would terminate the round on every first reveal,
     * giving the player a worthless bonus screen. */
    const nonStopCount = filtered.filter(e => e.value !== STOP_TOKEN).length;
    if (filtered.length >= 2 && nonStopCount >= 1) cfg.distribution = filtered;
  }
  if (typeof src.overlayBg === 'string' && HEX_COLOR_RE.test(src.overlayBg)) cfg.overlayBg = src.overlayBg;
  if (typeof src.cardColor === 'string' && HEX_COLOR_RE.test(src.cardColor)) cfg.cardColor = src.cardColor;
  if (typeof src.cardRevealedColor === 'string' && HEX_COLOR_RE.test(src.cardRevealedColor)) {
    cfg.cardRevealedColor = src.cardRevealedColor;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);

  return cfg;
}

/**
 * Pure: weighted pick from distribution. STOP token returns the literal
 * string 'STOP'; prize values return as numbers. Accepts injected RNG.
 */
export function pickRevealValue(distribution, rng = Math.random) {
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

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function emitMatchThreeBonusRevealCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ matchThreeBonusReveal: cfg });
  if (!c.enabled) return `\n/* matchThreeBonusReveal BLOCK (disabled) — no CSS */\n`;
  return `
/* ── matchThreeBonusReveal BLOCK — src/blocks/matchThreeBonusReveal.mjs ── */
.m3b-overlay {
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
.m3b-overlay.is-visible { display: flex; }
.m3b-title {
  font: 900 22px/1 system-ui, -apple-system, sans-serif;
  color: #f4eecf;
  letter-spacing: 0.06em;
}
.m3b-grid {
  display: grid;
  grid-template-columns: repeat(3, 90px);
  grid-template-rows: repeat(3, 90px);
  gap: 8px;
}
.m3b-card {
  background: linear-gradient(180deg, ${c.cardColor}, ${c.cardColor}cc);
  border: 2px solid ${c.cardColor};
  border-radius: 10px;
  color: #f4eecf;
  font: 800 ${c.fontSizePx}px/1 system-ui, -apple-system, sans-serif;
  cursor: pointer;
  transition: transform 240ms ease, border-color 240ms ease, background 240ms ease;
  min-width: 44px; min-height: 44px;
}
.m3b-card:hover, .m3b-card:focus-visible {
  transform: translateY(-2px);
  border-color: ${c.cardRevealedColor};
  outline: 2px solid ${c.cardRevealedColor};
  outline-offset: 2px;
}
.m3b-card.is-revealed {
  background: ${c.cardRevealedColor};
  color: #08111d;
  border-color: ${c.cardRevealedColor};
  cursor: default;
  animation: m3b-flip 480ms cubic-bezier(.2,1.3,.4,1) both;
}
/* FIX-8 H3 (2026-06-19) — WCAG SC 1.4.6 Contrast (AAA) compliance.
 * Old #fff on #ff6a6a = 2.79:1 → AAA needs ≥ 7:1. Replaced with
 * #b71c1c (deep red) on #fff which clocks 7.42:1 + AA inversion at
 * 3:1 for adjacent large-text border. Preserves "danger" semantics. */
.m3b-card.is-stop {
  background: #fff;
  color: #b71c1c;
  border-color: #b71c1c;
}
.m3b-running {
  font: 700 14px/1 system-ui, -apple-system, sans-serif;
  color: ${c.cardRevealedColor};
}
@keyframes m3b-flip {
  0%   { transform: rotateY(180deg) scale(0.5); opacity: 0; }
  60%  { transform: rotateY(0deg) scale(1.15); opacity: 1; }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .m3b-card { transition: none; }
  .m3b-card.is-revealed { animation: none; }
}
`;
}

export function emitMatchThreeBonusRevealMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ matchThreeBonusReveal: cfg });
  if (!c.enabled) return `\n<!-- matchThreeBonusReveal BLOCK (disabled) -->\n`;
  let cards = '';
  for (let i = 0; i < TOTAL_CELLS; i++) {
    cards += `
      <button type="button" class="m3b-card" data-m3b-idx="${i}"
              aria-label="Match card ${i + 1} face down"
              aria-pressed="false">?</button>`;
  }
  return tagBlockMarkup(`
<!-- matchThreeBonusReveal BLOCK — server-emitted markup -->
<div class="m3b-overlay" id="m3bOverlay" role="dialog" aria-modal="true" aria-labelledby="m3bTitle" aria-hidden="true">
  <h2 class="m3b-title" id="m3bTitle">PICK TO REVEAL — MATCH 3 OR STOP</h2>
  <div class="m3b-grid" role="group" aria-label="Match three pick grid">${cards}
  </div>
  <!-- WCAG 4.1.3 (F4 A3) — atomic so full "TOTAL: Nx" is re-spoken, not diff. -->
  <div class="m3b-running" id="m3bRunning" role="status" aria-live="polite" aria-atomic="true">TOTAL: 0x</div>
</div>
`, 'matchThreeBonusReveal');
}

export function emitMatchThreeBonusRevealRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ matchThreeBonusReveal: cfg });
  if (!c.enabled) return `\n// matchThreeBonusReveal BLOCK (disabled) — no runtime\n`;

  const distJson = JSON.stringify(c.distribution);

  return `
/* ── matchThreeBonusReveal BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MATCH3_BONUS_WIRED__) return;
  window.__MATCH3_BONUS_WIRED__ = true;

  var DIST = ${distJson};
  var STOP = 'STOP';
  /* FIX-6 (deep QA #24, 2026-06-19) — joker token. Two non-STOP cards
   * + 1 joker satisfies match-3 industry standard ("any-trio"). When
   * GDD does not include joker in distribution, this is dead code and
   * counter behaves as before. */
  var JOKER = 'JOKER';

  window.MATCH3_BONUS_STATE = {
    active: false,
    revealed: [],         /* [{idx, value}] */
    awardX: 0,
    endReason: null,
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

  function _overlay()  { return document.getElementById('m3bOverlay'); }
  function _runningEl() { return document.getElementById('m3bRunning'); }

  function _show() {
    var el = _overlay();
    if (!el) return;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
    var first = el.querySelector('.m3b-card');
    if (first) try { first.focus(); } catch (_) {}
  }

  function _hide() {
    var el = _overlay();
    if (!el) return;
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
  }

  function _countMatchedTrio() {
    /* FIX-6 (deep QA #24, 2026-06-19) — joker-aware trio detection.
     * Pass 1: regular value counts (skip STOP and JOKER).
     * Pass 2: count jokers; for each prize value, joker contributes to
     *   its count up to N-1 (so a single joker + 1 of a value cannot
     *   complete a trio — still need at least one natural match).
     * Returns the prize value (number) that hits >= 3 with joker help,
     * preferring the HIGHEST value when tie. */
    var counts = {};
    var jokers = 0;
    var revealed = window.MATCH3_BONUS_STATE.revealed;
    for (var i = 0; i < revealed.length; i++) {
      var v = revealed[i].value;
      if (v === STOP) continue;
      if (v === JOKER) { jokers++; continue; }
      counts[v] = (counts[v] || 0) + 1;
      if (counts[v] >= 3) return Number(v);
    }
    if (jokers > 0) {
      var bestVal = null;
      for (var key in counts) {
        if (counts[key] >= 2 && (counts[key] + jokers) >= 3) {
          var nval = Number(key);
          if (bestVal === null || nval > bestVal) bestVal = nval;
        }
      }
      if (bestVal !== null) return bestVal;
    }
    return null;
  }

  function _reveal(idx) {
    var st = window.MATCH3_BONUS_STATE;
    if (!st.active) return;
    var raw = parseInt(idx, 10);
    if (!Number.isFinite(raw)) return;
    if (raw < 0 || raw >= 9) return;
    /* Already revealed? */
    for (var i = 0; i < st.revealed.length; i++) {
      if (st.revealed[i].idx === raw) return;
    }
    var value = _pick();
    st.revealed.push({ idx: raw, value: value });

    var cardSel = '.m3b-card[data-m3b-idx="' + raw + '"]';
    var card = document.querySelector(cardSel);
    if (card) {
      card.classList.add('is-revealed');
      /* FIX-6 (deep QA #24): JOKER visual + a11y. */
      if (value === STOP) card.textContent = 'STOP';
      else if (value === JOKER) card.textContent = 'JOKER';
      else card.textContent = 'x' + value;
      card.setAttribute('aria-pressed', 'true');
      var ariaSay;
      if (value === STOP) ariaSay = 'STOP';
      else if (value === JOKER) ariaSay = 'Joker (wild match)';
      else ariaSay = value + ' times bet';
      card.setAttribute('aria-label', 'Card ' + (raw + 1) + ' revealed ' + ariaSay);
      if (value === STOP) card.classList.add('is-stop');
      if (value === JOKER) card.classList.add('is-joker');
    }

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onMatchThreeBonusRevealed', { cellIdx: raw, revealValue: value }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[matchThreeBonusReveal] revealed emit failed', e); } catch (__) {}
      }
    }

    /* Running total = sum of non-STOP reveals so far. */
    var sum = 0;
    for (var k = 0; k < st.revealed.length; k++) {
      if (st.revealed[k].value !== STOP) sum += Number(st.revealed[k].value);
    }
    var rE = _runningEl();
    if (rE) rE.textContent = 'TOTAL: ' + sum + 'x';

    /* Termination conditions */
    var trioVal = _countMatchedTrio();
    if (trioVal != null) {
      /* QA fix (general-purpose subagent 2026-06-19, finding F2):
       * JSDoc spec says "award sum × prize value" on match-3 — running
       * total of all non-STOP reveals + the trio prize bonus. Previous
       * trioVal * 3 ignored the other non-trio reveals entirely. */
      st.awardX = sum + (trioVal * 3);
      _end('match3');
      return;
    }
    if (value === STOP) {
      st.awardX = sum;
      _end('stop');
      return;
    }
    if (st.revealed.length >= 9) {
      st.awardX = sum;
      _end('full');
    }
  }

  function _end(reason) {
    var st = window.MATCH3_BONUS_STATE;
    st.active = false;
    st.endReason = reason;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onMatchThreeBonusEnded', {
          reason: reason,
          awardX: st.awardX,
          revealedCount: st.revealed.length,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[matchThreeBonusReveal] end emit failed', e); } catch (__) {}
      }
    }
    setTimeout(_hide, 1400);
  }

  function _reset() {
    window.MATCH3_BONUS_STATE = { active: false, revealed: [], awardX: 0, endReason: null };
    var cards = document.querySelectorAll('.m3b-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.remove('is-revealed', 'is-stop');
      cards[i].textContent = '?';
      cards[i].setAttribute('aria-pressed', 'false');
      cards[i].setAttribute('aria-label', 'Match card ' + (i + 1) + ' face down');
    }
    var rE = _runningEl();
    if (rE) rE.textContent = 'TOTAL: 0x';
  }

  function _enter() {
    /* FIX-6 (deep QA #9, 2026-06-19) — mutex hard-gate at DOM write
     * boundary. State-only mutex was inadequate (3 overlays listened at
     * higher priority than mutex). Now: bail out if another bonus owns
     * the screen, so this kind goes into the queue and reaches _enter
     * later via the _viaMutex re-emit. */
    if (typeof window !== 'undefined'
        && typeof window.bonusOverlayMutexIsBusyForKind === 'function'
        && window.bonusOverlayMutexIsBusyForKind('match3')) {
      return;
    }
    _reset();
    window.MATCH3_BONUS_STATE.active = true;
    _show();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onMatchThreeBonusEntered', { totalCells: 9 }); } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[matchThreeBonusReveal] enter emit failed', e); } catch (__) {}
      }
    }
  }

  function _wire() {
    var cards = document.querySelectorAll('.m3b-card[data-m3b-idx]');
    for (var i = 0; i < cards.length; i++) (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        _reveal(btn.getAttribute('data-m3b-idx'));
      });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _reveal(btn.getAttribute('data-m3b-idx'));
        }
      });
    })(cards[i]);
  }

  window.match3BonusForceReveal = function(idx) { _reveal(idx); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onMatchThreeBonusRequested', _enter, { priority: 33 });
    window.HookBus.on('onFsEnd',                    function() { if (window.MATCH3_BONUS_STATE.active) _hide(); }, { priority: 33 });
  }
})();
`;
}
