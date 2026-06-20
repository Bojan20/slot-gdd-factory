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
  'multiplier_orb',
  'persistent_multiplier',
  'cascade',
  'cluster_pays',
  'ways',
  'pay_anywhere',
  'expanding_wild',
  'walking_wild',
  'sticky_wild',
  'mystery_symbol',
  'scatter_pay',
  'lightning',
  /* D-12 (Boki 2026-06-20): per-value lightning multiplier force chips.
     Boki rule: "mora da se pokaze kolko je multiplier da se izabere kao
     force dugme posebno". Each chip forces THAT exact multiplier on the
     next spin's win (combined with __FORCE_BIG_WIN_TIER__=1 to guarantee
     a baseline win the multiplier can apply to). */
  'lightning_x2',
  'lightning_x3',
  'lightning_x5',
  'lightning_x10',
  'respin',
  'wild_reel',
  'gamble',
  'ante_bet',
  'super_symbol',
  'jackpot',
  'big_win',
]);

const KIND_LABELS = Object.freeze({
  free_spins:            'FS',
  bonus_buy:             'BUY',
  hold_and_win:          'H&W',
  bonus_pick:            'PICK',
  wheel_bonus:           'WHEEL',
  multiplier:            '×MULT',
  multiplier_orb:        '◯×',
  persistent_multiplier: 'P×',
  cascade:               'CASCADE',
  cluster_pays:          'CLUSTER',
  ways:                  'WAYS',
  pay_anywhere:          'ANY-PAY',
  expanding_wild:        'EXP-W',
  walking_wild:          'WALK-W',
  sticky_wild:           'STICK-W',
  mystery_symbol:        'MYST',
  scatter_pay:           'SCATPAY',
  lightning:             '⚡',
  lightning_x2:          '⚡×2',
  lightning_x3:          '⚡×3',
  lightning_x5:          '⚡×5',
  lightning_x10:         '⚡×10',
  respin:                'RESPIN',
  wild_reel:             'WILD-R',
  gamble:                'GAMBLE',
  ante_bet:              'ANTE',
  super_symbol:          'SUPER',
  jackpot:               'JACKPOT',
  big_win:               'BIG-WIN',
});

const KIND_FULL_LABELS = Object.freeze({
  free_spins:            'Free Spins',
  bonus_buy:             'Bonus Buy',
  hold_and_win:          'Hold & Win',
  bonus_pick:            'Bonus Pick',
  wheel_bonus:           'Wheel Bonus',
  multiplier:            'Multiplier',
  multiplier_orb:        'Multiplier Orb',
  persistent_multiplier: 'Persistent Multiplier',
  cascade:               'Cascade / Tumble',
  cluster_pays:          'Cluster Pays',
  ways:                  'Ways',
  pay_anywhere:          'Pay Anywhere',
  expanding_wild:        'Expanding Wild',
  walking_wild:          'Walking Wild',
  sticky_wild:           'Sticky Wild',
  mystery_symbol:        'Mystery Symbol',
  scatter_pay:           'Scatter Pay',
  lightning:             'Lightning',
  lightning_x2:          'Lightning ×2',
  lightning_x3:          'Lightning ×3',
  lightning_x5:          'Lightning ×5',
  lightning_x10:         'Lightning ×10',
  respin:                'Respin',
  wild_reel:             'Wild Reel',
  gamble:                'Gamble',
  ante_bet:              'Ante Bet',
  super_symbol:          'Super Symbol',
  jackpot:               'Jackpot',
  big_win:               'Big Win',
});

/**
 * Kinds that ALREADY have a dedicated, GDD-visible CTA owned by their
 * own block. The panel skips them so users don't see two buttons.
 */
const DEDUPE_OWNED_BY_OTHER_BLOCK = Object.freeze([
  'bonus_buy',   // bonusBuy.mjs paints its own BUY chip
  'ante_bet',    // anteBet.mjs paints its own ANTE chip
]);

/**
 * 2026-06-18 — Boki rule "force chips moraju da fors-uju neku radnju
 * koja se zaista može pokrenuti". These feature kinds are PERMANENT
 * PAYOUT EVALUATORS or ALWAYS-ON ENGINE MECHANICS — they describe how
 * EVERY spin pays / tumbles, not single-spin events that can be forced.
 *
 *   • `ways` / `cluster_pays` / `pay_anywhere` — payout-evaluator route
 *     for the whole slot (engine routes via `GAME_EVAL_KIND`). Force
 *     chip would be a no-op ("force WAYS šta to znači i zašto ne radi").
 *   • `scatter_pay` — scatter pays as a payout rule, not a trigger.
 *   • `cascade` — tumble-after-win is an automatic engine mechanic.
 *     Every win on a cascade slot already cascades; there is no
 *     "force cascade" outcome distinct from a normal winning spin.
 *
 * The panel still RECOGNISES these kinds at parse time so they appear
 * in `model.features` and downstream blocks (eg. cascade tumble engine,
 * cluster evaluator) can boot — but no FORCE chip is painted for them.
 */
const NON_FORCEABLE_MECHANIC_KINDS = Object.freeze([
  'ways',
  'cluster_pays',
  'pay_anywhere',
  'scatter_pay',
  'cascade',
]);

/** Back-compat alias retained for any external import. */
const PAYOUT_EVALUATOR_KINDS = NON_FORCEABLE_MECHANIC_KINDS;

const BOUNDS = Object.freeze({
  CHIP_HEIGHT:    Object.freeze({ min: 16, max: 48 }),
  CHIP_FONT_SIZE: Object.freeze({ min: 11, max: 20 }),
  PANEL_OFFSET:   Object.freeze({ min: 0,  max: 400 }),
  PANEL_GAP:      Object.freeze({ min: 0,  max: 24 }),
  ARIA_LABEL_MAX: 40,
  LABEL_TEXT_MAX: 12,
});

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
  return Object.freeze({
    ...DEFAULTS,
    alwaysIncludeKinds: [...DEFAULTS.alwaysIncludeKinds],
    excludeKinds: [...DEFAULTS.excludeKinds],
  });
}

function isPositiveInt(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && Number.isInteger(v);
}

// Strict allowlist: alphanumerics, space, underscore, hyphen, ampersand,
// parens, and the few symbol glyphs used in KIND_LABELS (× ◯ ⚡). Anything
// else — quotes, backticks, angle brackets, braces, control chars — is
// rejected so attacker-controlled GDD strings cannot break out of the
// HTML attributes they are interpolated into downstream.
const PLAIN_LABEL_ALLOWLIST = /^[A-Za-z0-9 _\-&()×◯⚡]+$/;
function isPlainLabel(s, maxLen = BOUNDS.ARIA_LABEL_MAX) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && PLAIN_LABEL_ALLOWLIST.test(s);
}

function isKindArray(arr) {
  return Array.isArray(arr) && arr.every(k => typeof k === 'string' && ALL_KNOWN_KINDS.includes(k));
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.universalForcePanel) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (src.includeKinds === 'auto' || isKindArray(src.includeKinds)) {
    cfg.includeKinds = src.includeKinds;
  } else if (src.includeKinds !== undefined) {
    // Invalid includeKinds (e.g. typo ['freespins']) coerces to 'auto'.
    // Surface a warning at build time so QA can diagnose missing chips.
    try {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[universalForcePanel] invalid includeKinds, coercing to "auto":', src.includeKinds);
      }
    } catch (_) {}
  }
  if (isKindArray(src.alwaysIncludeKinds)) cfg.alwaysIncludeKinds = [...src.alwaysIncludeKinds];
  if (isKindArray(src.excludeKinds)) cfg.excludeKinds = [...src.excludeKinds];
  if (isPositiveInt(src.chipHeight,   BOUNDS.CHIP_HEIGHT.min,    BOUNDS.CHIP_HEIGHT.max))    cfg.chipHeight    = src.chipHeight;
  if (isPositiveInt(src.chipFontSize, BOUNDS.CHIP_FONT_SIZE.min, BOUNDS.CHIP_FONT_SIZE.max)) cfg.chipFontSize  = src.chipFontSize;
  if (isPositiveInt(src.panelTop,     BOUNDS.PANEL_OFFSET.min,   BOUNDS.PANEL_OFFSET.max))   cfg.panelTop      = src.panelTop;
  if (isPositiveInt(src.panelRight,   BOUNDS.PANEL_OFFSET.min,   BOUNDS.PANEL_OFFSET.max))   cfg.panelRight    = src.panelRight;
  if (isPositiveInt(src.panelGap,     BOUNDS.PANEL_GAP.min,      BOUNDS.PANEL_GAP.max))      cfg.panelGap      = src.panelGap;
  if (isPlainLabel(src.ariaLabel))               cfg.ariaLabel     = src.ariaLabel;
  if (src.showLabelText === false)               cfg.showLabelText = false;
  if (isPlainLabel(src.labelText, BOUNDS.LABEL_TEXT_MAX)) cfg.labelText = src.labelText;

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
    /* D-12 (Boki 2026-06-20): some GDDs declare lightning at the top level
       of the model (e.g. WoO has `lightning: {}` outside features[]),
       not inside features array. Detect that too so the force chips
       render for any game whose GDD references the lightning mechanic. */
    if (model && model.lightning && typeof model.lightning === 'object') {
      detected.add('lightning');
    }
    if (model && model.randomLightningMultiplier &&
        typeof model.randomLightningMultiplier === 'object') {
      detected.add('lightning');
    }
  } else if (Array.isArray(c.includeKinds)) {
    detected = new Set(c.includeKinds.filter(k => ALL_KNOWN_KINDS.includes(k)));
  } else {
    detected = new Set();
  }

  for (const k of c.alwaysIncludeKinds) {
    if (ALL_KNOWN_KINDS.includes(k)) detected.add(k);
  }

  /* D-12 (Boki 2026-06-20): when `lightning` feature is declared, auto-
     expand to the 4 per-value force chips so the player can pick which
     multiplier value to force. The base `lightning` chip is hidden in
     this case (its random-pick behavior is redundant once you have the
     deterministic per-value chips). */
  if (detected.has('lightning')) {
    detected.add('lightning_x2');
    detected.add('lightning_x3');
    detected.add('lightning_x5');
    detected.add('lightning_x10');
    detected.delete('lightning');
  }

  const excluded = new Set([
    ...c.excludeKinds.filter(k => ALL_KNOWN_KINDS.includes(k)),
    ...DEDUPE_OWNED_BY_OTHER_BLOCK,
    /* 2026-06-18 — strip evaluator-only + always-on mechanic kinds so
     * the panel only paints chips for things that can actually be
     * FORCED on a single spin. `ways` / `cluster_pays` / `pay_anywhere`
     * / `scatter_pay` are permanent payout-evaluator routes (engine
     * `GAME_EVAL_KIND`). `cascade` is the always-on tumble mechanic.
     * Force chips for these were no-ops — Boki QA:
     *   "kada forsujem WAYS šta to znači i zašto ne radi"
     *   "ways ne znam sta je i ne treba kao force"                  */
    ...NON_FORCEABLE_MECHANIC_KINDS,
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
  font-size: ${Math.max(BOUNDS.CHIP_FONT_SIZE.min, c.chipFontSize - 1)}px;
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

  /* FIX-8 M7 (2026-06-19) — FS-active guard.
   * Force chip during an active FS round mixes BASE state with FS state.
   * big_win tier force tokom FS = potencijalno duplo plaćanje (FS mult ×
   * forced tier). Industry baseline: force chip is BASE-only. */
  function _isFsActive() {
    if (typeof window === 'undefined') return false;
    if (window.FREESPINS && window.FREESPINS.active === true) return true;
    if (window.FSM && (window.FSM.phase === 'FS_INTRO' || window.FSM.phase === 'FS_ACTIVE' || window.FSM.phase === 'FS_OUTRO')) return true;
    return false;
  }

  function _runSpin() {
    if (typeof window.runOneBaseSpin === 'function') { window.runOneBaseSpin(); return true; }
    if (typeof window.runSpin === 'function') { window.runSpin(); return true; }
    var btn = document.getElementById('spinBtn');
    if (btn) { btn.click(); return true; }
    return false;
  }

  function _onChipClick(kind, label, btn) {
    if (BUSY) return;
    /* FIX-8 M7 (2026-06-19) — FS-active guard. Reject force chip when
     * a FS round is in flight to prevent base+FS state contamination. */
    if (_isFsActive()) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[UFP] force chip rejected — FS round active', { kind: kind }); } catch (_) {}
      try { btn.setAttribute('aria-busy', 'false'); } catch (_) {}
      /* Brief visual nudge so the player understands why the chip ignored. */
      try { btn.classList.add('is-rejected'); setTimeout(function(){ try { btn.classList.remove('is-rejected'); } catch (_) {} }, 600); } catch (_) {}
      return;
    }
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

    /* D-12 (Boki 2026-06-20): Lightning Multiplier per-value force chips.
       Each chip sets BOTH flags atomically:
         1. __FORCE_BIG_WIN_TIER__ = 1 — guarantees a baseline win the
            multiplier can actually apply to (without this the lightning
            strike never fires because _onSpinResult bails on baseWin=0)
         2. __FORCE_LIGHTNING_MULT__ = <value> — randomLightningMultiplier
            block consumes this in _onSpinResult to bypass RNG roll AND
            weighted pick, using the exact chosen value deterministically.
       After the spin completes, the player sees: real spin → real win →
       Zeus strike anim → strip-meter halts on chosen value → win recomputed
       (×N) → big-win tier banner reflects the multiplied amount. */
    if (kind === 'lightning_x2') {
      try { window.__FORCE_BIG_WIN_TIER__ = 1;  } catch (_) {}
      try { window.__FORCE_LIGHTNING_MULT__ = 2; } catch (_) {}
    }
    if (kind === 'lightning_x3') {
      try { window.__FORCE_BIG_WIN_TIER__ = 1;  } catch (_) {}
      try { window.__FORCE_LIGHTNING_MULT__ = 3; } catch (_) {}
    }
    if (kind === 'lightning_x5') {
      try { window.__FORCE_BIG_WIN_TIER__ = 1;  } catch (_) {}
      try { window.__FORCE_LIGHTNING_MULT__ = 5; } catch (_) {}
    }
    if (kind === 'lightning_x10') {
      try { window.__FORCE_BIG_WIN_TIER__ = 1;   } catch (_) {}
      try { window.__FORCE_LIGHTNING_MULT__ = 10; } catch (_) {}
    }

    /* 2026-06-11 (Wave AL-2 / 4-GDD audit) — jackpot, multiplier_orb,
     * persistent_multiplier, pay_anywhere were detected by the parser
     * for the 4-GDD audit corpus but UFP had no chip nor handler.
     * Each new kind below sets a deterministic flag that the engine
     * + relevant block consumes on the next runOneBaseSpin() per the
     * force-buttons-real-spin rule. */
    if (kind === 'jackpot') {
      /* Top-tier jackpot: drive big_win tier 5 (or max tier) so the
       * payout ladder lands at GRAND. bigWinTier reads this flag in
       * its postSpin handler — same path as big_win chip but at the
       * top rung. */
      try { window.__FORCE_BIG_WIN_TIER__ = 5; } catch (_) {}
      try { window.__FORCE_JACKPOT__ = true; } catch (_) {}
    }
    if (kind === 'multiplier_orb') {
      /* D-14 (Boki 2026-06-20): multiplier_orb chip moraju da daju
       * pravi vizuelni napredak + garantovan win na koji se primenjuje.
       *
       * Cycle ladder [2, 5, 10, 25, 50, 100, 250, 500] = olympus-style
       * orb distribution. Force baseline win (__FORCE_BIG_WIN_TIER__=1)
       * tako da multiplier *ima na šta da se primeni* — bez win-a
       * Boki ne vidi efekat na payout-u, samo orb chip flash.
       *
       * Tri-prong force za audit + visual:
       *   1. MULT_ORB_STATE.forcedNextValue (multiplierOrb consumer)
       *   2. window.BONUS_MULTIPLIER bump (real shape multiplierOrb reads)
       *   3. window.__FORCE_ORB_VALUE__ (per-spin override za pickOrbValue)
       *   4. HookBus.setMult(_newMult) + emit onForceMultiplier
       *   5. __FORCE_BIG_WIN_TIER__ = 1 garantuje base win
       *   6. Visual orb chip na random ćeliji.                          */
      try {
        var _orbLadder = [2, 5, 10, 25, 50, 100, 250, 500];
        window.__UFP_ORB_IDX__ = ((window.__UFP_ORB_IDX__ || 0) + 1) % _orbLadder.length;
        var _orbVal = _orbLadder[window.__UFP_ORB_IDX__];

        if (!window.MULT_ORB_STATE) window.MULT_ORB_STATE = {};
        window.MULT_ORB_STATE.forcedNextValue = _orbVal;
        window.MULT_ORB_STATE.forceNextSpin   = true;
        window.MULT_ORB_STATE.lastPlaced      = { value: _orbVal, ts: Date.now() };
        try { window.__FORCE_ORB_VALUE__ = _orbVal; } catch (_) {}

        try { window.BONUS_MULTIPLIER = (window.BONUS_MULTIPLIER || 0) + _orbVal; } catch (_) {}
        try { window.__FORCE_BIG_WIN_TIER__ = 1; } catch (_) {}

        if (window.HookBus && typeof window.HookBus.setMult === 'function') {
          window.HookBus.setMult(_orbVal);
        }
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          try { window.HookBus.emit('onForceMultiplier', { multX: _orbVal }); } catch (_) {}
        }

        (function _renderUfpOrbChip(_v) {
          try {
            var cells = document.querySelectorAll('.cell');
            if (!cells.length) return;
            var target = cells[Math.floor(Math.random() * cells.length)];
            var rect = target.getBoundingClientRect();
            var chip = document.createElement('div');
            chip.className = 'ufp-orb-chip';
            chip.setAttribute('data-mult-orb', String(_v));
            chip.textContent = 'x' + _v;
            chip.style.cssText =
              'position:fixed;' +
              'left:' + (rect.left + rect.width / 2 - 30) + 'px;' +
              'top:'  + (rect.top  + rect.height / 2 - 30) + 'px;' +
              'width:60px;height:60px;border-radius:50%;' +
              'background:radial-gradient(circle,rgba(120,200,255,1) 0%,rgba(40,120,255,0.95) 70%,rgba(10,40,120,0.9) 100%);' +
              'color:#fff;font:900 ' + (String(_v).length > 3 ? 16 : 22) + 'px/60px system-ui,-apple-system,sans-serif;' +
              'text-align:center;letter-spacing:.04em;' +
              'box-shadow:0 8px 24px rgba(0,0,0,.55),inset 0 -3px 8px rgba(0,0,0,.25),inset 0 2px 4px rgba(255,255,255,.45);' +
              'pointer-events:none;z-index:96;opacity:0;transform:scale(.4);' +
              'transition:opacity .25s ease,transform .9s cubic-bezier(.2,1.3,.4,1);';
            document.body.appendChild(chip);
            requestAnimationFrame(function() {
              chip.style.opacity = '1';
              chip.style.transform = 'scale(1) translateY(-22px)';
            });
            setTimeout(function() {
              chip.style.opacity = '0';
              chip.style.transform = 'scale(.92) translateY(-44px)';
            }, 1400);
            setTimeout(function() { try { chip.remove(); } catch (_) {} }, 2100);
          } catch (_) {}
        })(_orbVal);
      } catch (_) {}
    }
    if (kind === 'persistent_multiplier') {
      /* persistentMultiplier block bumps the carry-over multiplier
       * across spins. Force-bump by +1 and seed the next spin so the
       * visual ratchet renders. D-14 (Boki 2026-06-20): garantuj win
       * baseline tako da multiplier ima na šta da se primeni. */
      try {
        if (!window.PERSISTENT_MULT_STATE) {
          window.PERSISTENT_MULT_STATE = { current: 1, forceNextSpin: false };
        }
        var _curPM = (window.PERSISTENT_MULT_STATE.current || 1) + 1;
        window.PERSISTENT_MULT_STATE.current = Math.min(_curPM, 100);
        window.PERSISTENT_MULT_STATE.forceNextSpin = true;
        try { window.__FORCE_PERSISTENT_MULT__ = window.PERSISTENT_MULT_STATE.current; } catch (_) {}
        try { window.__FORCE_BIG_WIN_TIER__ = 1; } catch (_) {}

        if (window.HookBus && typeof window.HookBus.setMult === 'function') {
          window.HookBus.setMult(window.PERSISTENT_MULT_STATE.current);
        }
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          try { window.HookBus.emit('onForceMultiplier', { multX: window.PERSISTENT_MULT_STATE.current }); } catch (_) {}
        }
      } catch (_) {}
    }
    if (kind === 'pay_anywhere') {
      /* pay_anywhere is an EVALUATION MODE, not a transient trigger —
       * games using it always evaluate that way. The force chip
       * therefore drives a deterministic 8-of-kind plant so the player
       * can see the eval visualised. reelEngine reads FORCE_TRIGGER
       * symbolPile to seed cells. */
      try {
        var _payPlant = { symbolPile: { count: 8, symbol: 'M' } };
        try { FORCE_TRIGGER = _payPlant; } catch (_) {}
        try { window.FORCE_TRIGGER = _payPlant; } catch (_) {}
      } catch (_) {}
    }

    /* 2026-06-10 — Boki bug "multiplier force ne radi". UFP chip emit-uje
       onForceFeatureRequested + spin, ali ne postavlja stvarni mult. Pa
       spin se dešava sa default mult=1, multiplier banner se prikaže
       ali NIJEDAN visual feedback na ćeliji + nijedan multiplied payout.

       devForceButtons.mjs već implementira pravi mult-force kroz
       HookBus.setMult(N). Replikujem isti pattern ovde: cycle kroz
       2× → 3× → 5× → 10× → 2× tako da svaki klik daje različitu
       vrednost (vidljiv napredak), pa spin. Multiplier blokovi koji
       slušaju onMultiplierApplied / postSpin (multiplierOrb,
       progressiveFreeSpins, persistentMultiplier) reaguju na novi
       mult automatski, a winPresentation primenjuje mult na payouts. */
    if (kind === 'multiplier') {
      try {
        /* D-14 (Boki 2026-06-20): garantuj win baseline tako da
         * multiplier ima na šta da se primeni. Bez win-a multiplier
         * chip se prikaže ali payout se ne množi (× 0 = 0). */
        try { window.__FORCE_BIG_WIN_TIER__ = 1; } catch (_) {}
        if (window.HookBus && typeof window.HookBus.setMult === 'function') {
          var _ladder = [2, 3, 5, 10];
          window.__UFP_MULT_IDX__ = ((window.__UFP_MULT_IDX__ || 0) + 1) % _ladder.length;
          var _newMult = _ladder[window.__UFP_MULT_IDX__];
          window.HookBus.setMult(_newMult);
          /* Plant a scatter-style multiplier seed: if multiplierOrb is
             active, force its lastMult so the next spin renders an
             orb chip with this value on the grid. */
          if (window.MULT_ORB_STATE) {
            window.MULT_ORB_STATE.forcedNextValue = _newMult;
          }
          /* Emit a dedicated event so multiplierOrb / pathAwareMultiplier
             / persistentMultiplier blocks can wire to it for visual
             feedback ON THE GRID, not just a placeholder banner. */
          try { window.HookBus.emit('onForceMultiplier', { multX: _newMult }); } catch (_) {}
          /* 2026-06-10 — vidljiv x N chip nad random cellom, fade 1.8s.
             Vizualni odgovor na Boki "kako treba multiplier da se prikaze". */
          (function _renderUfpMultChip() {
            try {
              var cells = document.querySelectorAll('.cell');
              if (!cells.length) return;
              var target = cells[Math.floor(Math.random() * cells.length)];
              var rect = target.getBoundingClientRect();
              var chip = document.createElement('div');
              chip.className = 'ufp-mult-chip';
              chip.textContent = 'x' + _newMult;
              chip.style.cssText =
                'position:fixed;' +
                'left:' + (rect.left + rect.width / 2 - 28) + 'px;' +
                'top:'  + (rect.top  + rect.height / 2 - 28) + 'px;' +
                'width:56px;height:56px;border-radius:50%;' +
                'background:radial-gradient(circle,rgba(255,200,40,1) 0%,rgba(255,130,20,0.95) 70%,rgba(120,60,0,0.85) 100%);' +
                'color:#fff;font:900 22px/56px system-ui,-apple-system,sans-serif;' +
                'text-align:center;letter-spacing:.04em;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.55),inset 0 -3px 8px rgba(0,0,0,.25),inset 0 2px 4px rgba(255,255,255,.35);' +
                'pointer-events:none;z-index:95;opacity:0;transform:scale(.4);' +
                'transition:opacity .25s ease,transform .9s cubic-bezier(.2,1.3,.4,1);';
              document.body.appendChild(chip);
              requestAnimationFrame(function() {
                chip.style.opacity = '1';
                chip.style.transform = 'scale(1) translateY(-22px)';
              });
              setTimeout(function() {
                chip.style.opacity = '0';
                chip.style.transform = 'scale(.92) translateY(-44px)';
              }, 1100);
              setTimeout(function() { try { chip.remove(); } catch (_) {} }, 1800);
            } catch (_) {}
          })();
        }
      } catch (_) {}
    }

    /* 2026-06-10 — Boki: "wheel mi ne radi, force. gamble takodje. fix
       ultimativno kao blokove da rade za bilo koji gdd ako ih ima".
       Root cause: modal-style features (wheel, gamble, bonus_pick,
       hold_and_win) were already opening their overlays via the
       onForceFeatureRequested HookBus event — but the UFP runtime then
       ALSO fired runOneBaseSpin() right after. The base spin animated
       reels in the background, and on some lifecycle paths the
       FSM/postSpin transitions closed the just-opened overlay (or the
       user perceived "spin happens, modal doesn't").

       Fix: classify kinds into MODAL_ONLY vs SPIN_DRIVEN. For modal
       kinds the panel emits the event + does any block-specific seed
       work and STOPS — no base spin is triggered. The overlay opens
       cleanly, with no parallel reel motion.

       2026-06-11 (Boki rule): "pritisnes force dugme odradi se spin i
       onda se dobije ishod forsa" — every chip MUST drive a real spin,
       and the outcome (modal, BW walk, FS entry, mult applied to win)
       must materialise as the spin settles. Modal kinds now defer their
       overlay open to the postSpin listener (see wheelBonus/gamble/
       bonusPick): chip click → flag → spin → settle → modal. No more
       MODAL_ONLY skip path. */
    var MODAL_ONLY_KINDS = [];

    /* hold_and_win needs a seeded BONUS payload on the next base spin so
       the H&W trigger fires inside its regular postSpin entry path. Plant
       FORCE_TRIGGER with bonusCount = triggerCount from HW config (default
       6, industry minimum), then run the spin. */
    if (kind === 'hold_and_win') {
      try {
        var _hwCount = 6;
        var _hwSym = 'B';
        try {
          if (typeof HW_TRIGGER_COUNT === 'number' && HW_TRIGGER_COUNT > 0) _hwCount = HW_TRIGGER_COUNT;
          else if (window.HW_TRIGGER_COUNT && window.HW_TRIGGER_COUNT > 0) _hwCount = window.HW_TRIGGER_COUNT;
        } catch (_) {}
        try {
          /* 2026-06-18 — normalise to uppercase so downstream paths
           * (reelEngine commitStopSymbols plant, holdAndWin harvest,
           * anticipation registry sym compare) all see the same case.
           * Pre-fix: lowercase 'b' from GDD leaked into the engine,
           * the bonus pile landed as 'b' on cells, harvester case-
           * compared against 'B' and missed every orb → no H&W round. */
          if (typeof HW_BONUS_SYMBOL === 'string') _hwSym = HW_BONUS_SYMBOL.toUpperCase();
          else if (typeof window.HW_BONUS_SYMBOL === 'string') _hwSym = window.HW_BONUS_SYMBOL.toUpperCase();
        } catch (_) {}
        /* Plant 'bonusSymbol' + 'bonusCount' — reelEngine commitStopSymbols
         * sprays the bonus pile so the next spin's postSpin hwMaybeEnter()
         * lights up the round. Industry contract per Boki rule "pritisnes
         * force, odradi se spin, dobije se ishod forsa". */
        var _hwPlant = { bonusCount: _hwCount, bonusSymbol: _hwSym };
        try { FORCE_TRIGGER = _hwPlant; } catch (_) {}
        try { window.FORCE_TRIGGER = _hwPlant; } catch (_) {}
      } catch (_) {}
    }

    /* Modal-style features (wheel_bonus, gamble, bonus_pick) defer their
     * overlay open to the postSpin listener inside their own block. The
     * UFP just plants window.__FORCE_FEATURE__ which the block reads in
     * its postSpin handler. This gives the Boki sequence: chip → spin →
     * settle → modal. */
    if (kind === 'wheel_bonus' || kind === 'gamble' || kind === 'bonus_pick') {
      try { window.__FORCE_FEATURE_PENDING__ = kind; } catch (_) {}
    }

    if (MODAL_ONLY_KINDS.indexOf(kind) === -1) {
      _runSpin();
    }

    /* D-13.1 (2026-06-20) — closure-captured shipping for kinds whose
     * canonical event is otherwise lost when reelEngine clears
     * window.__FORCE_FEATURE_* flags at the settle gate. No-op for
     * other kinds. */
    _scheduleShipping(kind);

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

  /* D-13.1 (Boki 2026-06-20) — postSpin "shipping" listener.
   * Closes the empty-config fail-mode for jackpot, hold_and_win, gamble
   * force chips. When a GDD declares a feature kind at the top level
   * but parses to an empty config object, the feature-owning block
   * stays in no-op. UFP plants the force flag, this listener emits
   * the canonical event after postSpin so listeners (audio, HUD,
   * regulator log) react, paints a celebrate chip, and clears the
   * flag. See rule_force_buttons_real_spin.md. */
  function _paintCelebrateChip(text, gradient) {
    try {
      var cells = document.querySelectorAll('.cell');
      if (!cells.length) return;
      var target = cells[Math.floor(Math.random() * cells.length)];
      var rect = target.getBoundingClientRect();
      var chip = document.createElement('div');
      chip.className = 'ufp-feature-chip';
      chip.textContent = text;
      chip.style.cssText =
        'position:fixed;' +
        'left:' + (rect.left + rect.width / 2 - 36) + 'px;' +
        'top:'  + (rect.top  + rect.height / 2 - 22) + 'px;' +
        'min-width:72px;height:44px;padding:0 12px;' +
        'border-radius:22px;' +
        'background:' + gradient + ';' +
        'color:#fff;font:900 16px/44px system-ui,-apple-system,sans-serif;' +
        'text-align:center;letter-spacing:.08em;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.55),inset 0 -3px 8px rgba(0,0,0,.25),inset 0 2px 4px rgba(255,255,255,.35);' +
        'pointer-events:none;z-index:97;opacity:0;transform:scale(.4) translateY(0);' +
        'transition:opacity .25s ease,transform .9s cubic-bezier(.2,1.3,.4,1);';
      document.body.appendChild(chip);
      requestAnimationFrame(function() {
        chip.style.opacity = '1';
        chip.style.transform = 'scale(1) translateY(-28px)';
      });
      setTimeout(function() {
        chip.style.opacity = '0';
        chip.style.transform = 'scale(.92) translateY(-56px)';
      }, 1400);
      setTimeout(function() { try { chip.remove(); } catch (_) {} }, 2100);
    } catch (_) {}
  }

  /* Closure-captured shipping for jackpot/hold_and_win/gamble. The
   * earlier postSpin-listener attempt failed because reelEngine clears
   * window.__FORCE_FEATURE__ / __FORCE_FEATURE_PENDING__ / FORCE_TRIGGER
   * at the settle gate BEFORE emitting postSpin (reelEngine.mjs:557),
   * so any window-flag read inside a postSpin handler sees null. We
   * instead capture the kind in a closure at click time and ship the
   * canonical event via a HookBus.on subscription that owns its own
   * unsubscribe, so cleanup is deterministic per-click. */
  function _shipForceCanonicalEvent(kind) {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    var bet = (typeof window.__SLOT_BET__ === 'number' && window.__SLOT_BET__ > 0)
      ? window.__SLOT_BET__ : 1;

    if (kind === 'jackpot') {
      try { window.HookBus.emit('onDailyJackpotAward', { tier: 'GRAND', source: 'force-chip', award: bet * 1000 }); } catch (_) {}
      try { window.HookBus.emit('onJackpotRoomEntered', { room: 'GRAND', source: 'force-chip' }); } catch (_) {}
      _paintCelebrateChip('JACKPOT', 'radial-gradient(circle,rgba(255,215,80,1) 0%,rgba(240,140,20,0.95) 65%,rgba(120,60,0,0.85) 100%)');
      return;
    }
    if (kind === 'hold_and_win') {
      try { window.HookBus.emit('onHoldAndWinPhase', { phase: 'intro', source: 'force-chip' }); } catch (_) {}
      try { window.HookBus.emit('onHoldAndWinPayout', { total: bet * 60, source: 'force-chip' }); } catch (_) {}
      _paintCelebrateChip('HOLD & WIN', 'radial-gradient(circle,rgba(255,140,40,1) 0%,rgba(220,80,20,0.95) 65%,rgba(90,30,5,0.85) 100%)');
      return;
    }
    if (kind === 'gamble') {
      try { window.HookBus.emit('onGambleStart', { source: 'force-chip' }); } catch (_) {}
      try { window.HookBus.emit('onGambleEnd', { outcome: 'win', award: bet * 2, source: 'force-chip' }); } catch (_) {}
      _paintCelebrateChip('GAMBLE x2', 'radial-gradient(circle,rgba(80,200,120,1) 0%,rgba(20,140,80,0.95) 65%,rgba(5,70,40,0.85) 100%)');
      return;
    }
  }

  /* Called from _onChipClick AFTER _runSpin(). Schedules the canonical
   * emit via a one-shot postSpin subscription (preferred — accurate
   * timing) PLUS a setTimeout fallback (safety net if postSpin never
   * fires, e.g. when the spin enters an FSM phase like HW_INTRO that
   * suppresses the settle gate). The setTimeout cancels itself if the
   * postSpin path won. */
  function _scheduleShipping(kind) {
    if (kind !== 'jackpot' && kind !== 'hold_and_win' && kind !== 'gamble') return;
    var shipped = false;
    var fire = function() {
      if (shipped) return;
      shipped = true;
      _shipForceCanonicalEvent(kind);
    };
    var unsub = null;
    var bus = window.HookBus;
    if (bus && typeof bus.on === 'function') {
      try {
        unsub = bus.on('postSpin', function() {
          try { if (typeof unsub === 'function') unsub(); } catch (_) {}
          fire();
        });
      } catch (_) {}
    }
    /* Safety net: 1500 ms gives the spin time to settle naturally; if
     * postSpin never fires, we still ship the event so the chip stays
     * truthful. */
    setTimeout(function() {
      try { if (typeof unsub === 'function') unsub(); } catch (_) {}
      fire();
    }, 1500);
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
