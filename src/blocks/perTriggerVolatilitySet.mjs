/**
 * src/blocks/perTriggerVolatilitySet.mjs
 *
 * Wave D-17.4 (industry-reference lock_respin family gap closure) — Per-trigger volatility set
 * classifier + lock. Consumes an engine-supplied tier draw at hold-and-
 * win trigger time, locks the tier for the duration of the feature, and
 * exposes the tier label to downstream presentation blocks (lava-flow
 * intensity, ember rate, heat-haze).
 *
 * @module perTriggerVolatilitySet
 *
 * Purpose:
 *   Provides a vendor-neutral, engine-driven, opt-in classifier wrapper
 *   for the "volatility set" concept (Low / Med / High) attached to a
 *   single feature trigger. Distinct from the player-facing
 *   `volatilitySelector` block (which lets the player pick a session
 *   tier) — this block consumes a tier drawn by the engine PER feature
 *   trigger and locks it for the feature duration.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Per-trigger weighted "set" selection (Low / Med / High pools) is a
 *   long-standing industry pattern for hold-and-win-family features:
 *   the same feature spec serves both low-vol "drip" moments (frequent
 *   small collects) and high-vol "blow-off" moments (rare big landings)
 *   without requiring two distinct features. The selection is canonical
 *   per the industry-reference production GDD §09 "Per-Trigger Volatility Set":
 *   "On every trigger the engine draws one of three weighted value
 *   distributions before the first symbol value is assigned. This is
 *   the mechanism that lets a single feature serve both a low-vol drip
 *   and a high-vol spike from the same symbol math."
 *
 * Math gate
 *   This block does NOT perform the weighted draw. The engine owns the
 *   tier selection (per rule_no_math_unless_asked) and publishes the
 *   drawn tier via the canonical event the trigger handler emits. This
 *   block only:
 *     (a) consumes the drawn tier label
 *     (b) locks it for feature duration (no mid-feature re-roll)
 *     (c) exposes it to presentation consumers
 *     (d) emits canonical lock/expire events
 *
 *   The block ALSO accepts engine-supplied tier weights in cfg.weights
 *   purely as DISPLAY METADATA (e.g. for a debug overlay showing the
 *   probabilities); weights are NEVER used here to do an internal draw.
 *
 * Public API
 *   export function defaultConfig(): VolatilitySetConfig
 *   export function resolveConfig(model?: object): VolatilitySetConfig
 *   export function emitPerTriggerVolatilitySetCSS(cfg): string
 *   export function emitPerTriggerVolatilitySetRuntime(cfg): string
 *   export function normalizeTier(raw, allowedTiers): string|null  (test)
 *
 * Lifecycle (when enabled)
 *   • onHoldAndWinTrigger        → read result.volatilityTier from event
 *                                  payload OR window.__VOLATILITY_TIER__
 *                                  flag; normalize, lock, emit locked
 *   • onHoldAndWinEnd / onFsEnd  → emit expired, clear locked state
 *   • Mid-feature re-roll requests are IGNORED by design (locked-on-trigger
 *     is the canonical contract).
 *
 * HookBus events (sole emitter contract)
 *   • onVolatilitySetLocked     payload: { tier, weights, source }
 *   • onVolatilitySetExpired    payload: { tier, reason }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.perTriggerVolatilitySetForce(tier)
 *     → sets window.__FORCE_VOLATILITY_TIER__ = tier
 *     → triggers runOneBaseSpin() (real engine path)
 *     → engine reads the flag at trigger time and bakes the tier into
 *       its onHoldAndWinTrigger payload; the block detects + locks
 *       organically. If the engine ignores the flag, the runtime
 *       falls back to direct lock so the QA chip stays visually
 *       truthful — never a payout shortcut.
 *
 * Accessibility
 *   • Hidden status text "Volatility set <tier> locked" rendered in a
 *     visually-hidden <span> with role=status aria-live=polite so
 *     screen readers announce tier change once.
 *   • prefers-reduced-motion: reduce → no ambient intensity transition.
 *
 * Perf budget
 *   • 0 JS per frame; pure event-driven state machine (3 transitions).
 *   • No DOM beyond a single hidden status element + optional debug
 *     overlay (off by default).
 *
 * Honest scope
 *   This block does NOT pick a tier. It does NOT alter payouts. It
 *   ONLY exposes a clean lock/expire lifecycle the presentation chain
 *   subscribes to. The actual weighted draw lives in the engine and is
 *   verified against the par sheet outside this repo.
 *
 * GDD knobs (under `model.perTriggerVolatilitySet`)
 *   • enabled        bool                              (default false — opt-in)
 *   • tiers          string[]                          (default ['Low','Med','High'])
 *   • weights        Object<tier, number>              (default null — display only)
 *   • defaultTier    string                            (default 'Med')
 *   • lockOnTrigger  bool                              (default true — locked semantic)
 *   • showStatusText bool                              (default true — a11y status)
 *   • themeClass     string                            (default '')
 *   • role           string                            (default 'status')
 *   • ariaLabelPrefix string                           (default 'Volatility set')
 */

const DEFAULT_TIERS = Object.freeze(['Low', 'Med', 'High']);

const DEFAULTS = Object.freeze({
  enabled:           false,
  tiers:             DEFAULT_TIERS,
  weights:           null,
  defaultTier:       'Med',
  lockOnTrigger:     true,
  showStatusText:    true,
  themeClass:        '',
  role:              'status',
  ariaLabelPrefix:   'Volatility set',
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    tiers: [...DEFAULT_TIERS],
  });
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizeTiers(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const clean = sanitizeStringKnob(v, 16);
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.length > 0 ? out : null;
}

function sanitizeWeights(obj, tiers) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  let total = 0;
  for (const tier of tiers) {
    const w = obj[tier];
    if (typeof w !== 'number' || !isFinite(w) || w < 0 || w > 1000) continue;
    out[tier] = w;
    total += w;
  }
  /* require at least one valid weight; do NOT normalize to 1.0 — keep raw
   * since weights are display-only and any normalization here would
   * mislead the engine (block is math-blind by contract). */
  if (total <= 0) return null;
  return out;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.perTriggerVolatilitySet) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const tiers = sanitizeTiers(src.tiers);
  if (tiers) cfg.tiers = tiers;

  /* defaultTier must be one of the configured tiers; otherwise fall back to
   * cfg.tiers[Math.floor(len/2)] (middle tier when tiers re-ordered). */
  const dt = sanitizeStringKnob(src.defaultTier, 16);
  if (dt && cfg.tiers.includes(dt)) cfg.defaultTier = dt;
  else if (!cfg.tiers.includes(cfg.defaultTier)) {
    cfg.defaultTier = cfg.tiers[Math.floor(cfg.tiers.length / 2)];
  }

  const weights = sanitizeWeights(src.weights, cfg.tiers);
  if (weights) cfg.weights = weights;

  if (typeof src.lockOnTrigger === 'boolean') cfg.lockOnTrigger = src.lockOnTrigger;
  if (typeof src.showStatusText === 'boolean') cfg.showStatusText = src.showStatusText;

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── Pure helpers (test-exposed) ──────────────────────────────────────── */

/**
 * Normalize a raw tier candidate to one of the allowed tier labels.
 * Accepts case-insensitive match + common synonyms (low/medium/high).
 * Returns null when no match found.
 */
export function normalizeTier(raw, allowedTiers) {
  if (typeof raw !== 'string') return null;
  if (!Array.isArray(allowedTiers) || allowedTiers.length === 0) return null;
  const norm = raw.trim().toLowerCase();
  if (!norm) return null;
  for (const t of allowedTiers) {
    if (typeof t !== 'string') continue;
    if (t.toLowerCase() === norm) return t;
  }
  /* Synonyms map (only fires when direct match failed) */
  const synonyms = {
    'low':    ['lo', 'l'],
    'med':    ['medium', 'mid', 'm'],
    'high':   ['hi', 'h'],
  };
  for (const t of allowedTiers) {
    const key = t.toLowerCase();
    const syns = synonyms[key];
    if (syns && syns.includes(norm)) return t;
  }
  return null;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitPerTriggerVolatilitySetCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* perTriggerVolatilitySet — hidden status label + optional tier class hook */
.ptv-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
[data-volatility-tier] {
  /* hook for downstream presentation blocks; e.g.
     [data-volatility-tier="High"] .reel { animation-duration: 0.6s; } */
  transition: filter 320ms ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-volatility-tier] { transition: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitPerTriggerVolatilitySetRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    tiers:           c.tiers,
    weights:         c.weights,
    defaultTier:     c.defaultTier,
    lockOnTrigger:   c.lockOnTrigger,
    showStatusText:  c.showStatusText,
    themeClass:      c.themeClass,
    role:            c.role,
    ariaLabelPrefix: c.ariaLabelPrefix,
  });

  return `
/* perTriggerVolatilitySet runtime — tier lock + canonical events */
(function perTriggerVolatilitySetInit() {
  const CFG = ${cfgJSON};

  let lockedTier = null;
  let statusEl = null;

  function ensureStatusEl() {
    if (!CFG.showStatusText) return null;
    if (statusEl) return statusEl;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<span class="ptv-status" role="status" aria-live="polite"></span>';
    statusEl = wrap.firstChild;
    if (CFG.themeClass) statusEl.classList.add(CFG.themeClass);
    statusEl.setAttribute('role', CFG.role);
    document.body.appendChild(statusEl);
    return statusEl;
  }

  function normalizeTier(raw) {
    if (typeof raw !== 'string') return null;
    const norm = raw.trim().toLowerCase();
    if (!norm) return null;
    for (const t of CFG.tiers) {
      if (typeof t !== 'string') continue;
      if (t.toLowerCase() === norm) return t;
    }
    const SYNS = {
      'low':  ['lo', 'l'],
      'med':  ['medium', 'mid', 'm'],
      'high': ['hi', 'h'],
    };
    for (const t of CFG.tiers) {
      const key = t.toLowerCase();
      const syns = SYNS[key];
      if (syns && syns.indexOf(norm) >= 0) return t;
    }
    return null;
  }

  function setBodyTierAttr(tier) {
    try {
      if (tier) document.body.setAttribute('data-volatility-tier', tier);
      else      document.body.removeAttribute('data-volatility-tier');
    } catch (_) {}
  }

  function lockTier(tier, source) {
    const normalized = normalizeTier(tier) || CFG.defaultTier;
    if (CFG.lockOnTrigger && lockedTier !== null) {
      /* Already locked — ignore re-roll per locked-on-trigger contract.
         Block emits nothing on re-roll attempts. */
      return;
    }
    lockedTier = normalized;
    setBodyTierAttr(lockedTier);
    const el = ensureStatusEl();
    if (el) el.textContent = CFG.ariaLabelPrefix + ' ' + lockedTier + ' locked';
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onVolatilitySetLocked', {
          tier:    lockedTier,
          weights: CFG.weights,
          source:  source || 'trigger',
        });
      } catch (_) {}
    }
  }

  function expireTier(reason) {
    if (lockedTier === null) return;
    const last = lockedTier;
    lockedTier = null;
    setBodyTierAttr(null);
    if (statusEl) statusEl.textContent = '';
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onVolatilitySetExpired', {
          tier:   last,
          reason: reason || 'feature-end',
        });
      } catch (_) {}
    }
  }

  function handleHoldAndWinTrigger(payload) {
    let tier = null;
    if (payload && typeof payload.volatilityTier === 'string') {
      tier = payload.volatilityTier;
    }
    /* Force-chip flag takes precedence (per rule_force_buttons_real_spin).
       Engine MAY also honor the flag and pre-populate payload.volatilityTier;
       in that case both paths converge on the same tier. */
    if (typeof window !== 'undefined' && typeof window.__FORCE_VOLATILITY_TIER__ === 'string') {
      tier = window.__FORCE_VOLATILITY_TIER__;
      window.__FORCE_VOLATILITY_TIER__ = undefined;
    }
    lockTier(tier, payload && payload.source ? payload.source : 'hold-and-win-trigger');
  }

  /* Force chip — per rule_force_buttons_real_spin */
  if (typeof window !== 'undefined') {
    window.perTriggerVolatilitySetForce = function (tier) {
      window.__FORCE_VOLATILITY_TIER__ = (typeof tier === 'string' && tier.trim())
        ? tier : CFG.defaultTier;
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
    window.perTriggerVolatilitySetGet = function () { return lockedTier; };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('onHoldAndWinTrigger', handleHoldAndWinTrigger);
    /* Expire on feature end signals. */
    window.HookBus.on('onHoldAndWinEnd', function () { expireTier('hold-and-win-end'); });
    window.HookBus.on('onFsEnd',         function () { expireTier('fs-end'); });
  }
})();
`;
}
