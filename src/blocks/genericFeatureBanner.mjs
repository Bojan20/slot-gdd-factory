/**
 * src/blocks/genericFeatureBanner.mjs
 *
 * Wave U-FORCE-ALL.2 — Generic feature banner (fallback).
 *
 * Purpose
 * ───────
 *   Catch-all listener for `onForceFeatureRequested` events whose `kind`
 *   has no dedicated handler block. Renders a short overlay placard
 *   ("FEATURE TRIGGERED · <label>"), plays a 1.2s reveal-and-fade
 *   animation, then dismisses. Ensures EVERY force-chip click in
 *   `universalForcePanel.mjs` produces a player-visible response, even
 *   when the GDD declares a feature the simulator can't deterministically
 *   simulate yet (e.g. exotic `lightning` mechanics, vendor-specific
 *   `bonusPick` variants).
 *
 *   Kinds with a dedicated block (FS, BW, BB, H&W, multiplier orb,
 *   sticky/expanding/walking wild, mystery, respin, gamble, etc.) are
 *   skipped — those blocks own their own visual response. The banner
 *   only fires for kinds whose block is absent OR explicitly opted out.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Stub / preview banner pattern used by every certified simulator to
 *   demo features still in design. Two-tone gold-on-charcoal placard,
 *   centered, scale-and-fade transition, 1.2s default dwell.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig() / resolveConfig(model)
 *   emitGenericFeatureBannerCSS(cfg)
 *   emitGenericFeatureBannerMarkup(cfg)
 *   emitGenericFeatureBannerRuntime(cfg)
 *
 * Lifecycle (HookBus contract — listen-only)
 * ──────────────────────────────────────────
 *   Subscribes to: `onForceFeatureRequested`
 *   Emits:         (none — pure visual feedback)
 *
 * Runtime contract
 * ────────────────
 *   window.genericFeatureBannerShow(label)
 *   window.genericFeatureBannerHide()
 *
 * Vendor-neutral. No math. No persistent state.
 *
 * Senior-grade contract:
 *   • XSS-safe (label HTML-escaped at runtime via textContent)
 *   • Accessibility: role=status + aria-live=polite + auto-dismiss
 *   • prefers-reduced-motion: drops the scale animation, keeps fade
 *   • Performance: single DOM node reused across triggers
 */

const KINDS_WITH_DEDICATED_BLOCK = Object.freeze([
  'free_spins',
  'bonus_buy',
  'hold_and_win',
  'multiplier',
  'cascade',
  'cluster_pays',
  'ways',
  'expanding_wild',
  'walking_wild',
  'sticky_wild',
  'mystery_symbol',
  'scatter_pay',
  'respin',
  'wild_reel',
  'gamble',
  'ante_bet',
  'super_symbol',
  'big_win',
]);

const DEFAULTS = Object.freeze({
  enabled: true,
  dwellMs: 1200,
  fadeMs: 240,
  /** Kinds this banner is allowed to handle. If undefined, banner only
   *  fires for kinds without a dedicated block (default and safest). */
  handleKinds: 'auto',
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isPositiveInt(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && Number.isInteger(v);
}

function isKindArray(arr) {
  return Array.isArray(arr) && arr.every(k => typeof k === 'string' && k.length > 0 && k.length <= 32);
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const src = (model && model.genericFeatureBanner) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (isPositiveInt(src.dwellMs, 200, 6000)) cfg.dwellMs = src.dwellMs;
  if (isPositiveInt(src.fadeMs,   50,  800)) cfg.fadeMs  = src.fadeMs;
  if (src.handleKinds === 'auto' || isKindArray(src.handleKinds)) cfg.handleKinds = src.handleKinds;

  return cfg;
}

/** Pure helper — true if the banner should handle this kind. */
export function shouldHandle(cfg, kind) {
  const c = cfg && cfg.enabled === false ? null : (cfg || defaultConfig());
  if (!c) return false;
  if (Array.isArray(c.handleKinds)) return c.handleKinds.includes(kind);
  // 'auto' mode → handle only kinds without a dedicated block
  return !KINDS_WITH_DEDICATED_BLOCK.includes(kind);
}

export function emitGenericFeatureBannerCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ genericFeatureBanner: cfg });
  if (!c.enabled) return `\n/* genericFeatureBanner BLOCK (disabled by GDD) — no CSS emitted */\n`;
  return `
/* ── genericFeatureBanner BLOCK — emitted by src/blocks/genericFeatureBanner.mjs ── */
.gfb-banner {
  position: absolute;
  left: 50%;
  top: 38%;
  transform: translate(-50%, -50%) scale(0.85);
  background: linear-gradient(180deg, rgba(20,18,8,.96), rgba(48,38,12,.96));
  border: 1px solid rgba(201,162,39,.7);
  color: #f4eecf;
  padding: 18px 28px;
  border-radius: 14px;
  font: 600 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.06em;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  z-index: 90;
  transition: opacity ${c.fadeMs}ms ease, transform ${c.fadeMs}ms ease;
  box-shadow: 0 12px 40px rgba(0,0,0,.6), inset 0 0 24px rgba(201,162,39,.18);
  max-width: 80%;
}
.gfb-banner[data-visible="true"] {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
  pointer-events: auto;
}
.gfb-banner__kicker {
  display: block;
  font-size: 10px;
  letter-spacing: 0.18em;
  color: rgba(201,162,39,.85);
  margin-bottom: 6px;
}
.gfb-banner__label {
  display: block;
  font-size: 18px;
  letter-spacing: 0.08em;
}
@media (prefers-reduced-motion: reduce) {
  .gfb-banner {
    transition: opacity ${c.fadeMs}ms ease;
    transform: translate(-50%, -50%);
  }
  .gfb-banner[data-visible="true"] {
    transform: translate(-50%, -50%);
  }
}
@media (max-width: 620px) {
  .gfb-banner { padding: 14px 18px; max-width: 88%; }
  .gfb-banner__label { font-size: 16px; }
}
`;
}

export function emitGenericFeatureBannerMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ genericFeatureBanner: cfg });
  if (!c.enabled) return `\n<!-- genericFeatureBanner BLOCK (disabled) -->\n`;
  return `
<!-- genericFeatureBanner BLOCK — server-emitted markup -->
<div class="gfb-banner" id="gfbBanner" role="status" aria-live="polite" data-visible="false">
  <span class="gfb-banner__kicker">FEATURE TRIGGERED</span>
  <span class="gfb-banner__label" id="gfbBannerLabel">—</span>
</div>
`;
}

export function emitGenericFeatureBannerRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ genericFeatureBanner: cfg });
  if (!c.enabled) return `\n// genericFeatureBanner BLOCK (disabled) — no runtime\n`;

  const handleListLiteral = Array.isArray(c.handleKinds)
    ? JSON.stringify(c.handleKinds)
    : 'null';

  return `
/* ── genericFeatureBanner BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var DWELL_MS = ${c.dwellMs};
  var FADE_MS  = ${c.fadeMs};
  var HANDLE_LIST = ${handleListLiteral};
  var DEDICATED = ${JSON.stringify(KINDS_WITH_DEDICATED_BLOCK)};

  var _hideTimer = null;

  function _shouldHandle(kind) {
    if (Array.isArray(HANDLE_LIST)) return HANDLE_LIST.indexOf(kind) >= 0;
    return DEDICATED.indexOf(kind) < 0;
  }

  function _node() { return document.getElementById('gfbBanner'); }
  function _label() { return document.getElementById('gfbBannerLabel'); }

  window.genericFeatureBannerShow = function(label) {
    var el = _node(); var lab = _label();
    if (!el || !lab) return;
    // textContent is XSS-safe (no parsing)
    lab.textContent = String(label == null ? '' : label);
    el.setAttribute('data-visible', 'true');
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    _hideTimer = setTimeout(function() {
      el.setAttribute('data-visible', 'false');
      _hideTimer = null;
    }, DWELL_MS);
  };
  window.genericFeatureBannerHide = function() {
    var el = _node();
    if (!el) return;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    el.setAttribute('data-visible', 'false');
  };

  function _wire() {
    if (!window.HookBus || typeof window.HookBus.on !== 'function') return;
    HookBus.on('onForceFeatureRequested', function(payload) {
      payload = payload || {};
      var k = payload.kind || '';
      if (!_shouldHandle(k)) return;
      window.genericFeatureBannerShow(payload.label || k);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }
})();
`;
}

/* Exposed for tests */
export const DEDICATED_KINDS = KINDS_WITH_DEDICATED_BLOCK;
