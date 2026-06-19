/**
 * src/blocks/pickYourFs.mjs
 *
 * Wave LEGO-FSV.1 — Pick-Your-Free-Spins mode selector.
 *
 * Purpose
 * ───────
 *   On FS trigger, present the player with N (typically 3) selectable
 *   FS variants — e.g.:
 *     A) 8 spins · ×5 mult     (high volatility, low duration)
 *     B) 12 spins · ×2 mult    (balanced)
 *     C) 20 spins · ×1 mult    (low volatility, long duration)
 *
 *   Player taps one card → that mode locks → FS starts with the chosen
 *   spinsCount + baseMultiplier. Industry-typical pre-FS choice screen.
 *
 *   Distinct from existing FS blocks:
 *     • `freeSpins.mjs`           — base FS state machine (single mode)
 *     • `superchargedFs.mjs`      — FS retrigger × tier escalation
 *     • `progressiveFreeSpins.mjs` — progressive mult during FS
 *     • `perFsSpinMultiplier.mjs` — random ×N each FS spin
 *
 *   This block ONLY drives the pre-FS choice overlay + emits the pick;
 *   downstream FS blocks consume the chosen spinsCount / baseMultiplier.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Pick your free spins" pattern is a staple of modern bonus-rich
 *   slots. The choice screen sits between scatter celebration and
 *   FS_INTRO. Card animation, 44×44 touch targets, role=button per card.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitPickYourFsCSS(cfg)
 *   emitPickYourFsMarkup(cfg, model)
 *   emitPickYourFsRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger (priority 35) — mount choice overlay BEFORE FS_INTRO
 *     • onFsEnd     (priority 35) — clear last selection state
 *   emits:
 *     • onFsModePicked   { modeIndex, spinsCount, baseMultiplier, label }
 *
 * Runtime contract
 * ────────────────
 *   window.PICK_YOUR_FS_STATE = { lastPick: {modeIndex, spinsCount, baseMultiplier} | null }
 *   window.pickYourFsForce(modeIndex)         (QA hook)
 *
 * GDD config keys (model.pickYourFs)
 * ──────────────────────────────────
 *   { enabled,
 *     modes: [
 *       { label: 'HIGH VOL',    spinsCount: 8,  baseMultiplier: 5 },
 *       { label: 'BALANCED',    spinsCount: 12, baseMultiplier: 2 },
 *       { label: 'LOW VOL',     spinsCount: 20, baseMultiplier: 1 },
 *     ],
 *     overlayBg, cardColor, cardSelectedColor, autoPickMs }
 *
 * Performance: O(N modes) DOM, single overlay mount, ≤ 2 ms boot cost.
 *
 * a11y: each card is <button role="button"> with aria-label, 44×44
 * touch minimum, focus-visible ring, kbd Enter/Space activate.
 *
 * Senior-grade: wired-once, idempotent emit, XSS-safe escaping,
 * prefers-reduced-motion respected, autoPickMs fallback for tab-switch
 * abandonment.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SPINS_MIN    = 1;
const SPINS_MAX    = 999;
const MULT_MIN     = 1;
const MULT_MAX     = 1000;
const MODES_MIN    = 2;
const MODES_MAX    = 6;
const AUTOPICK_MIN = 0;        /* 0 = disabled */
const AUTOPICK_MAX = 60000;
const LABEL_MAX    = 14;
const LABEL_RE     = /^[A-Z0-9 _\-&]+$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_MODES = Object.freeze([
  Object.freeze({ label: 'HIGH VOL', spinsCount:  8, baseMultiplier: 5 }),
  Object.freeze({ label: 'BALANCED', spinsCount: 12, baseMultiplier: 2 }),
  Object.freeze({ label: 'LOW VOL',  spinsCount: 20, baseMultiplier: 1 }),
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    modes: DEFAULT_MODES.map(m => ({ ...m })),
    overlayBg: '#08111d',
    cardColor: '#1a2840',
    cardSelectedColor: '#ffd84d',
    autoPickMs: 30000,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.pickYourFs) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Array.isArray(src.modes) && src.modes.length >= MODES_MIN && src.modes.length <= MODES_MAX) {
    const filtered = src.modes
      .filter(m => Number.isFinite(m.spinsCount) && Number.isFinite(m.baseMultiplier)
                 && typeof m.label === 'string' && LABEL_RE.test(m.label.slice(0, LABEL_MAX)))
      .map(m => ({
        label: String(m.label).slice(0, LABEL_MAX),
        spinsCount: clampInt(m.spinsCount, SPINS_MIN, SPINS_MAX),
        baseMultiplier: clampInt(m.baseMultiplier, MULT_MIN, MULT_MAX),
      }));
    if (filtered.length >= MODES_MIN) cfg.modes = filtered;
  }
  if (typeof src.overlayBg === 'string' && HEX_COLOR_RE.test(src.overlayBg)) cfg.overlayBg = src.overlayBg;
  if (typeof src.cardColor === 'string' && HEX_COLOR_RE.test(src.cardColor)) cfg.cardColor = src.cardColor;
  if (typeof src.cardSelectedColor === 'string' && HEX_COLOR_RE.test(src.cardSelectedColor)) {
    cfg.cardSelectedColor = src.cardSelectedColor;
  }
  if (Number.isFinite(src.autoPickMs)) cfg.autoPickMs = clampInt(src.autoPickMs, AUTOPICK_MIN, AUTOPICK_MAX);

  return cfg;
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function emitPickYourFsCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ pickYourFs: cfg });
  if (!c.enabled) return `\n/* pickYourFs BLOCK (disabled) — no CSS */\n`;
  return `
/* ── pickYourFs BLOCK — src/blocks/pickYourFs.mjs ── */
.pyfs-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: ${c.overlayBg}ee;
  z-index: 90;
  flex-direction: column;
  gap: 20px;
}
.pyfs-overlay.is-visible { display: flex; }
.pyfs-title {
  font: 900 26px/1 system-ui, -apple-system, sans-serif;
  color: #f6f2d8; /* WCAG AAA (F4 A1) — 6.8:1 → 7.4:1 */
  letter-spacing: 0.06em;
  text-shadow: 0 2px 12px rgba(0,0,0,0.7);
}
.pyfs-cards {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 92vw;
}
.pyfs-card {
  min-width: 132px;
  min-height: 110px;
  padding: 16px 18px;
  background: linear-gradient(180deg, ${c.cardColor}, ${c.cardColor}cc);
  border: 2px solid ${c.cardColor};
  border-radius: 12px;
  color: #f6f2d8; /* WCAG AAA (F4 A1) — 6.8:1 → 7.4:1 */
  font: 800 14px/1.2 system-ui, -apple-system, sans-serif;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: center;
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
}
.pyfs-card:hover, .pyfs-card:focus-visible {
  transform: translateY(-2px);
  border-color: ${c.cardSelectedColor};
  outline: 2px solid ${c.cardSelectedColor};
  outline-offset: 2px;
}
.pyfs-card.is-picked {
  border-color: ${c.cardSelectedColor};
  box-shadow: 0 0 32px ${c.cardSelectedColor};
  transform: scale(1.08);
}
.pyfs-card .pyfs-spins {
  font-size: 22px;
  color: ${c.cardSelectedColor};
}
.pyfs-card .pyfs-mult {
  font-size: 16px;
  opacity: 0.85;
}
@media (prefers-reduced-motion: reduce) {
  .pyfs-card { transition: none; }
  .pyfs-card.is-picked { transform: none; }
}
`;
}

export function emitPickYourFsMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ pickYourFs: cfg });
  if (!c.enabled) return `\n<!-- pickYourFs BLOCK (disabled) -->\n`;
  const cards = c.modes.map((m, i) => `
      <button type="button" class="pyfs-card" data-pyfs-mode="${i}"
              aria-label="Pick ${escAttr(m.label)}: ${m.spinsCount} spins, ${m.baseMultiplier}x multiplier">
        <span class="pyfs-label">${escAttr(m.label)}</span>
        <span class="pyfs-spins">${m.spinsCount} SPINS</span>
        <span class="pyfs-mult">×${m.baseMultiplier} MULT</span>
      </button>`).join('');
  return `
<!-- pickYourFs BLOCK — server-emitted markup -->
<div class="pyfs-overlay" id="pyfsOverlay" role="dialog" aria-modal="true" aria-labelledby="pyfsTitle" aria-hidden="true">
  <h2 class="pyfs-title" id="pyfsTitle">PICK YOUR FREE SPINS</h2>
  <div class="pyfs-cards" role="group" aria-label="Free spins mode selection">${cards}
  </div>
</div>
`;
}

export function emitPickYourFsRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ pickYourFs: cfg });
  if (!c.enabled) return `\n// pickYourFs BLOCK (disabled) — no runtime\n`;

  const modesJson = JSON.stringify(c.modes);
  const autoMs    = c.autoPickMs;

  return `
/* ── pickYourFs BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__PICK_YOUR_FS_WIRED__) return;
  window.__PICK_YOUR_FS_WIRED__ = true;

  var MODES = ${modesJson};
  var AUTO_PICK_MS = ${autoMs};
  var _autoTimer = null;

  window.PICK_YOUR_FS_STATE = { lastPick: null };

  function _overlay() { return document.getElementById('pyfsOverlay'); }

  function _show() {
    var el = _overlay();
    if (!el) return;
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
    /* Focus first card for kbd users. */
    var first = el.querySelector('.pyfs-card');
    if (first) try { first.focus(); } catch (_) {}
    if (AUTO_PICK_MS > 0) {
      _autoTimer = setTimeout(function() { _pick(0); }, AUTO_PICK_MS);
    }
  }

  function _hide() {
    var el = _overlay();
    if (!el) return;
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
  }

  function _pick(modeIndex) {
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
    /* QA hardening (Explore review 2026-06-18): tolerate string and
     * non-integer input — parseInt(string, 10) || 0, then clamp to
     * the modes array bounds so dev-tools tampering with data-pyfs-mode
     * cannot escape the valid index range. */
    var rawIdx = parseInt(modeIndex, 10);
    if (!Number.isFinite(rawIdx)) rawIdx = 0;
    var idx = Math.max(0, Math.min(MODES.length - 1, rawIdx));
    var mode = MODES[idx];

    /* Visually mark the picked card before dismissing. */
    var el = _overlay();
    if (el) {
      var cards = el.querySelectorAll('.pyfs-card');
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-picked');
      if (cards[idx]) cards[idx].classList.add('is-picked');
    }

    window.PICK_YOUR_FS_STATE.lastPick = {
      modeIndex: idx,
      spinsCount: mode.spinsCount,
      baseMultiplier: mode.baseMultiplier,
      label: mode.label,
    };

    /* Apply chosen counts to FREESPINS for downstream consumers. */
    try {
      if (window.FREESPINS && typeof window.FREESPINS === 'object') {
        window.FREESPINS.remaining = mode.spinsCount;
        window.FREESPINS.baseMultiplier = mode.baseMultiplier;
      }
    } catch (_) {}

    /* Apply base multiplier through canonical HookBus.setMult so display
     * blocks pick it up via onMultiplierChanged. */
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(mode.baseMultiplier);
    }

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFsModePicked', {
          modeIndex: idx,
          spinsCount: mode.spinsCount,
          baseMultiplier: mode.baseMultiplier,
          label: mode.label,
        });
      } catch (_) {}
    }

    /* Dismiss with a brief pulse so the player sees their card light up. */
    setTimeout(_hide, 480);
  }

  function _wire() {
    var el = _overlay();
    if (!el) return;
    var cards = el.querySelectorAll('.pyfs-card[data-pyfs-mode]');
    for (var i = 0; i < cards.length; i++) (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        _pick(btn.getAttribute('data-pyfs-mode'));
      });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _pick(btn.getAttribute('data-pyfs-mode'));
        }
      });
    })(cards[i]);
  }

  window.pickYourFsForce = function(modeIndex) { _pick(modeIndex); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger', _show, { priority: 35 });
    window.HookBus.on('onFsEnd', function() {
      window.PICK_YOUR_FS_STATE.lastPick = null;
    }, { priority: 35 });
  }
})();
`;
}
