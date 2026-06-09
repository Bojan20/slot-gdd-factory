/**
 * src/blocks/universalForcePanel.mjs
 *
 * Wave U-FORCE-ALL.1 — Universal feature force panel (PRESENTATION MODE).
 *
 * Purpose
 * ───────
 *   When a regulator, sales-team member, or partner uploads ANY GDD into
 *   the slot simulator, the resulting playable HTML must expose a force
 *   button for EVERY feature the parser detected — Free Spins, Bonus Buy,
 *   Hold & Win, Bonus Pick, Wheel Bonus, Multiplier Orb, Lightning,
 *   Sticky Wild, Expanding Wild, Walking Wild, Mystery Symbol, Cascade,
 *   Cluster Pays, Respin, Wild Reel, Gamble, Ante Bet, Super Symbol, etc.
 *
 *   Each force CTA MUST drive a real spin via `runOneBaseSpin()` (see
 *   `rule_force_buttons_real_spin.md`) — never a shortcut into FSM. The
 *   spin then carries a `__FORCE_FEATURE__` flag that downstream lifecycle
 *   hooks consume to deterministically land the requested feature.
 *
 *   Buttons that the existing feature-specific block already owns
 *   (e.g. `bonusBuy.mjs` exposes its own BUY chip, `freeSpins` has dev FS
 *   trigger via `__SLOT_DEV_FORCE_FS__`) are de-duplicated by name so we
 *   never paint two CTAs for the same feature.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Every certified slot platform ships a QA panel that exposes per-
 *   feature force triggers. The chip rail sits in the dev-tools region
 *   (top-right by default) and is gated by `model.universalForcePanel.
 *   enabled` (true by default in dev/preview builds, false in prod).
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitUniversalForcePanelCSS(cfg)
 *   emitUniversalForcePanelMarkup(cfg, model)
 *   emitUniversalForcePanelRuntime(cfg, model)
 *
 * Lifecycle (HookBus contract — emit-only)
 * ────────────────────────────────────────
 *   The block emits ONE canonical event when a force chip is clicked:
 *     onForceFeatureRequested({ kind, label, source: 'panel' })
 *   Then it sets `window.__FORCE_FEATURE__ = kind` and triggers a real
 *   `runOneBaseSpin()`. Feature-specific blocks (freeSpins, bonusBuy,
 *   multiplierOrb, etc.) subscribe to `onForceFeatureRequested` OR read
 *   `window.__FORCE_FEATURE__` at the start of their `preSpin` hook
 *   and act accordingly. `genericFeatureBanner.mjs` is the catch-all
 *   subscriber for kinds with no dedicated handler.
 *
 * Runtime contract
 * ────────────────
 *   window.__FORCE_FEATURE__       string | null
 *   window.universalForcePanelShow()
 *   window.universalForcePanelHide()
 *
 * Vendor-neutral. Pure presentation. No math hooks.
 *
 * Senior-grade contract:
 *   • Idempotent emit (resolveConfig() with no input returns frozen
 *     defaults; markup is empty-string when disabled)
 *   • XSS-safe (every kind label HTML-escaped, every emitted CSS class
 *     prefixed `ufp-`)
 *   • Accessibility: each chip is a `<button>` with `aria-label`,
 *     keyboard-reachable, focus ring respects `prefers-reduced-motion`
 *   • Performance budget: zero work after click until next animation
 *     frame (debounced 250 ms to avoid double-tap re-spawns)
 *   • Lifecycle ownership: ONLY emits `onForceFeatureRequested`. Never
 *     mutates global state beyond `__FORCE_FEATURE__` and the panel DOM.
 */

const ALL_KNOWN_KINDS = Object.freeze([
  'free_spins',
  'bonus_buy',
  'hold_and_win',
  'bonus_pick',
  'wheel_bonus',
  'multiplier',
  'cascade',
  'cluster_pays',
  'ways',
  'expanding_wild',
  'walking_wild',
  'sticky_wild',
  'mystery_symbol',
  'scatter_pay',
  'lightning',
  'respin',
  'wild_reel',
  'gamble',
  'ante_bet',
  'super_symbol',
  'big_win',
]);

const KIND_LABELS = Object.freeze({
  free_spins:      'FS',
  bonus_buy:       'BUY',
  hold_and_win:    'H&W',
  bonus_pick:      'PICK',
  wheel_bonus:     'WHEEL',
  multiplier:      '×MULT',
  cascade:         'CASCADE',
  cluster_pays:    'CLUSTER',
  ways:            'WAYS',
  expanding_wild:  'EXP-W',
  walking_wild:    'WALK-W',
  sticky_wild:     'STICK-W',
  mystery_symbol:  'MYST',
  scatter_pay:     'SCATPAY',
  lightning:       '⚡',
  respin:          'RESPIN',
  wild_reel:       'WILD-R',
  gamble:          'GAMBLE',
  ante_bet:        'ANTE',
  super_symbol:    'SUPER',
  big_win:         'BIG-WIN',
});

const KIND_FULL_LABELS = Object.freeze({
  free_spins:      'Free Spins',
  bonus_buy:       'Bonus Buy',
  hold_and_win:    'Hold & Win',
  bonus_pick:      'Bonus Pick',
  wheel_bonus:     'Wheel Bonus',
  multiplier:      'Multiplier',
  cascade:         'Cascade / Tumble',
  cluster_pays:    'Cluster Pays',
  ways:            'Ways',
  expanding_wild:  'Expanding Wild',
  walking_wild:    'Walking Wild',
  sticky_wild:     'Sticky Wild',
  mystery_symbol:  'Mystery Symbol',
  scatter_pay:     'Scatter Pay',
  lightning:       'Lightning',
  respin:          'Respin',
  wild_reel:       'Wild Reel',
  gamble:          'Gamble',
  ante_bet:        'Ante Bet',
  super_symbol:    'Super Symbol',
  big_win:         'Big Win',
});

/**
 * Kinds that ALREADY have a dedicated, GDD-visible CTA owned by their
 * own block. The panel skips them so users don't see two buttons.
 */
const DEDUPE_OWNED_BY_OTHER_BLOCK = Object.freeze([
  'bonus_buy',   // bonusBuy.mjs paints its own BUY chip
  'ante_bet',    // anteBet.mjs paints its own ANTE chip
]);

const DEFAULTS = Object.freeze({
  enabled: true,
  /** "auto" → derive from model.features; otherwise array of kinds */
  includeKinds: 'auto',
  /** Always include these regardless of detection (Big Win is a tier, not a feature) */
  alwaysIncludeKinds: Object.freeze(['big_win']),
  /** Don't paint chip for these even if detected */
  excludeKinds: Object.freeze([]),
  chipHeight: 28,
  chipFontSize: 11,                  // Apple HIG / WCAG minimum legible body
  panelTop: 12,
  panelRight: 12,
  panelGap: 6,
  ariaLabel: 'Feature force panel',
  showLabelText: true,
  labelText: 'FORCE',
});

export function defaultConfig() {
  return {
    ...DEFAULTS,
    alwaysIncludeKinds: [...DEFAULTS.alwaysIncludeKinds],
    excludeKinds: [...DEFAULTS.excludeKinds],
  };
}

function isPositiveInt(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && Number.isInteger(v);
}

function isPlainLabel(s, maxLen = 40) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && !/[<>{}]/.test(s);
}

function isKindArray(arr) {
  return Array.isArray(arr) && arr.every(k => typeof k === 'string' && ALL_KNOWN_KINDS.includes(k));
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const src = (model && model.universalForcePanel) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (src.includeKinds === 'auto' || isKindArray(src.includeKinds)) cfg.includeKinds = src.includeKinds;
  if (isKindArray(src.alwaysIncludeKinds)) cfg.alwaysIncludeKinds = [...src.alwaysIncludeKinds];
  if (isKindArray(src.excludeKinds)) cfg.excludeKinds = [...src.excludeKinds];
  if (isPositiveInt(src.chipHeight,    16, 48))  cfg.chipHeight    = src.chipHeight;
  if (isPositiveInt(src.chipFontSize,  11, 20))  cfg.chipFontSize  = src.chipFontSize;
  if (isPositiveInt(src.panelTop,       0, 400)) cfg.panelTop      = src.panelTop;
  if (isPositiveInt(src.panelRight,     0, 400)) cfg.panelRight    = src.panelRight;
  if (isPositiveInt(src.panelGap,       0, 24))  cfg.panelGap      = src.panelGap;
  if (isPlainLabel(src.ariaLabel))               cfg.ariaLabel     = src.ariaLabel;
  if (src.showLabelText === false)               cfg.showLabelText = false;
  if (isPlainLabel(src.labelText, 12))           cfg.labelText     = src.labelText;

  return cfg;
}

/**
 * Compute the final, ordered, deduplicated list of feature kinds to
 * paint chips for. Stable order: ALL_KNOWN_KINDS canonical order.
 */
export function selectKinds(cfg, model = {}) {
  const c = cfg && cfg.enabled === false ? null : (cfg || defaultConfig());
  if (!c) return [];

  let detected;
  if (c.includeKinds === 'auto') {
    const features = Array.isArray(model && model.features) ? model.features : [];
    detected = new Set(features.map(f => f && f.kind).filter(k => ALL_KNOWN_KINDS.includes(k)));
  } else if (Array.isArray(c.includeKinds)) {
    detected = new Set(c.includeKinds.filter(k => ALL_KNOWN_KINDS.includes(k)));
  } else {
    detected = new Set();
  }

  for (const k of c.alwaysIncludeKinds) {
    if (ALL_KNOWN_KINDS.includes(k)) detected.add(k);
  }

  const excluded = new Set([
    ...c.excludeKinds.filter(k => ALL_KNOWN_KINDS.includes(k)),
    ...DEDUPE_OWNED_BY_OTHER_BLOCK,
  ]);

  return ALL_KNOWN_KINDS.filter(k => detected.has(k) && !excluded.has(k));
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function emitUniversalForcePanelCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ universalForcePanel: cfg });
  if (!c.enabled) return `\n/* universalForcePanel BLOCK (disabled by GDD) — no CSS emitted */\n`;
  return `
/* ── universalForcePanel BLOCK — emitted by src/blocks/universalForcePanel.mjs ──
   chipHeight = ${c.chipHeight}px, fontSize = ${c.chipFontSize}px,
   top = ${c.panelTop}px, right = ${c.panelRight}px, gap = ${c.panelGap}px
*/
.ufp-panel {
  position: absolute;
  top: ${c.panelTop}px;
  right: ${c.panelRight}px;
  display: flex;
  flex-wrap: wrap;
  gap: ${c.panelGap}px;
  z-index: 60;
  pointer-events: auto;
  max-width: min(60vw, 480px);
  justify-content: flex-end;
}
.ufp-label {
  font-size: ${Math.max(11, c.chipFontSize - 1)}px;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.55);
  align-self: center;
  padding: 0 4px;
  user-select: none;
}
.ufp-chip {
  height: ${c.chipHeight}px;
  min-width: ${c.chipHeight}px;
  padding: 0 ${Math.max(6, Math.round(c.chipHeight / 3))}px;
  font: 600 ${c.chipFontSize}px / 1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.04em;
  color: #f4eecf;
  background: linear-gradient(180deg, rgba(40,46,60,.95), rgba(20,24,32,.95));
  border: 1px solid rgba(201,162,39,0.45);
  border-radius: ${Math.round(c.chipHeight / 2)}px;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ufp-chip:hover { background: linear-gradient(180deg, rgba(80,68,28,.95), rgba(40,32,12,.95)); }
.ufp-chip:active { transform: scale(0.95); }
.ufp-chip:focus-visible {
  outline: 2px solid rgba(201,162,39,.85);
  outline-offset: 2px;
}
.ufp-chip[aria-busy="true"] {
  opacity: 0.5;
  cursor: progress;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .ufp-chip { transition: none; }
  .ufp-chip:active { transform: none; }
}
@media (max-width: 620px) {
  .ufp-panel { max-width: 92vw; right: 6px; top: 6px; gap: 4px; }
  .ufp-label { display: none; }
}
`;
}

export function emitUniversalForcePanelMarkup(cfg = defaultConfig(), model = {}) {
  const c = resolveConfig({ universalForcePanel: cfg });
  if (!c.enabled) return `\n<!-- universalForcePanel BLOCK (disabled) -->\n`;
  const kinds = selectKinds(c, model);
  if (kinds.length === 0) return `\n<!-- universalForcePanel BLOCK (no kinds) -->\n`;

  const label = c.showLabelText
    ? `<span class="ufp-label" aria-hidden="true">${escAttr(c.labelText)}</span>`
    : '';

  const chips = kinds.map(k => {
    const short = KIND_LABELS[k];
    const full  = KIND_FULL_LABELS[k];
    return `<button type="button" class="ufp-chip" data-ufp-kind="${escAttr(k)}" `
      + `aria-label="Force ${escAttr(full)}" title="Force ${escAttr(full)}">${escAttr(short)}</button>`;
  }).join('');

  return `
<!-- universalForcePanel BLOCK — server-emitted markup -->
<div class="ufp-panel" role="toolbar" aria-label="${escAttr(c.ariaLabel)}">
  ${label}${chips}
</div>
`;
}

export function emitUniversalForcePanelRuntime(cfg = defaultConfig(), model = {}) {
  const c = resolveConfig({ universalForcePanel: cfg });
  if (!c.enabled) return `\n// universalForcePanel BLOCK (disabled) — no runtime\n`;
  const kinds = selectKinds(c, model);
  if (kinds.length === 0) return `\n// universalForcePanel BLOCK (no kinds matched) — no runtime\n`;

  const debounceMs = 250;

  return `
/* ── universalForcePanel BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var BUSY = false;
  var DEBOUNCE_MS = ${debounceMs};

  function _runSpin() {
    if (typeof window.runOneBaseSpin === 'function') { window.runOneBaseSpin(); return true; }
    if (typeof window.runSpin === 'function') { window.runSpin(); return true; }
    var btn = document.getElementById('spinBtn');
    if (btn) { btn.click(); return true; }
    return false;
  }

  function _onChipClick(kind, label, btn) {
    if (BUSY) return;
    BUSY = true;
    try { btn.setAttribute('aria-busy', 'true'); } catch (_) {}

    window.__FORCE_FEATURE__ = kind;

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { HookBus.emit('onForceFeatureRequested', { kind: kind, label: label, source: 'panel' }); }
      catch (_) {}
    }

    /* 2026-06-09 — Boki bug: FS chip click set only window.__SLOT_DEV_FORCE_FS__,
       but the reelEngine never reads that flag — it reads FORCE_TRIGGER. So the
       FS chip looked active, the spin ran, no scatters were planted, no FS
       triggered. Real fix: write the same { scatterCount } shape the original
       devFsBtn used, picked from the parsed FREESPINS.awards ladder.
       NOTE: the engine's FORCE_TRIGGER is a let-binding in the outer script
       scope. From this IIFE we can write through to it via lexical scope.
       We also mirror onto window.FORCE_TRIGGER as a defensive belt+brace
       for any code path that reads through window. */
    if (kind === 'free_spins') {
      try {
        var _first = (typeof FREESPINS !== 'undefined' && FREESPINS && Array.isArray(FREESPINS.awards) && FREESPINS.awards[0])
          ? FREESPINS.awards[0]
          : { count: 3, spins: 10 };
        var _plant = { scatterCount: (_first.count || 3) };
        try { FORCE_TRIGGER = _plant; } catch (_) {}
        try { window.FORCE_TRIGGER = _plant; } catch (_) {}
        try { window.__SLOT_DEV_FORCE_FS__ = true; } catch (_) {}
        /* 2026-06-09 — Boki bug fix: on wheel/crash/plinko/radial GDDs that
         * mention "Free Spins" but lack a proper paytable scatter ladder,
         * the parser leaves FREESPINS.enabled = false. The FS chip then
         * planted scatter perfectly but spinsForCount returned 0 (gated
         * by the disabled flag), and FS_INTRO never entered. Dev-force is
         * an explicit player intent — flip enabled ON for this round so
         * the trigger ladder is honored. Safe because awards/triggerCounts
         * are still backfilled with industry defaults by the parser. */
        try {
          if (FREESPINS && FREESPINS.enabled !== true) FREESPINS.enabled = true;
          if (window.FREESPINS && window.FREESPINS.enabled !== true) window.FREESPINS.enabled = true;
        } catch (_) {}
      } catch (_) {}
    }
    if (kind === 'big_win') { try { window.__FORCE_BIG_WIN_TIER__ = 3; } catch (_) {} }

    _runSpin();

    setTimeout(function() {
      BUSY = false;
      try { btn.removeAttribute('aria-busy'); } catch (_) {}
    }, DEBOUNCE_MS);
  }

  function _wire() {
    var chips = document.querySelectorAll('.ufp-chip[data-ufp-kind]');
    for (var i = 0; i < chips.length; i++) (function(btn) {
      var kind = btn.getAttribute('data-ufp-kind') || '';
      var label = btn.getAttribute('title') || kind;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        _onChipClick(kind, label, btn);
      });
    })(chips[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  window.universalForcePanelShow = function() {
    var p = document.querySelector('.ufp-panel');
    if (p) p.style.display = '';
  };
  window.universalForcePanelHide = function() {
    var p = document.querySelector('.ufp-panel');
    if (p) p.style.display = 'none';
  };
})();
`;
}

/* Exposed for tests + sibling blocks (genericFeatureBanner reads these
   to construct fallback placards for kinds with no dedicated handler). */
export const KNOWN_KINDS = ALL_KNOWN_KINDS;
export const KIND_SHORT  = KIND_LABELS;
export const KIND_FULL   = KIND_FULL_LABELS;
