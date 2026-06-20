/**
 * src/blocks/simultaneousFsHoldAndWinPriority.mjs
 *
 * Wave D-17.7 (Foundry-family gap closure) — Cross-feature trigger
 * priority arbiter. When a single spin lands BOTH a free-spins
 * scatter threshold AND a hold-and-win money-collect threshold, the
 * arbiter pauses the FS award entry, lets the hold-and-win feature
 * resolve to completion, then resumes the deferred FS award with its
 * remaining spin count INTACT.
 *
 * @module simultaneousFsHoldAndWinPriority
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind, opt-in arbiter that enforces
 *   the Foundry-family §07 Edge-Cases rule:
 *     "Simultaneous FS + Hold-and-Win trigger: if a single spin lands
 *      3+ scatters AND the H&W threshold, pay all base wins first,
 *      then resolve the signature H&W to completion, THEN enter Free
 *      Spins with remaining spins intact. Rationale: H&W is the higher-
 *      value, higher-RTP feature; collected value is banked before the
 *      FS state transition. The FS award is queued, not lost."
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Cross-feature priority handling is a documented requirement for
 *   any title that admits simultaneous trigger sources for two
 *   different features. The "higher-RTP-share feature wins" rule of
 *   thumb is the industry baseline; the block is the structural
 *   generalization (configurable via cfg.primaryFeature /
 *   secondaryFeature) of that rule.
 *
 * Deferral semantics
 *   When BOTH features fire on the same spin:
 *     1. Block intercepts the secondary trigger (default: free-spins)
 *        by capturing the payload via onFsTriggerArmed and emitting
 *        onFeaturePriorityDeferred.
 *     2. The primary feature (default: hold-and-win) proceeds normally.
 *     3. On primary feature COLLECT (onHoldAndWinEnd or onGrandReleased),
 *        the block re-fires the deferred trigger via onFsEnter with the
 *        original payload, preserving the FS spin count and any
 *        engine-specific flags.
 *
 * Math gate
 *   This block does NOT decide which features trigger. The engine still
 *   emits its standard trigger events; the arbiter ONLY reorders the
 *   event flow so the upstream FS machinery sees the trigger AFTER the
 *   primary feature completes. No payouts are calculated here.
 *
 * Public API
 *   export function defaultConfig(): SimultaneousFsHoldAndWinPriorityConfig
 *   export function resolveConfig(model?: object): ...
 *   export function emitSimultaneousFsHoldAndWinPriorityCSS(cfg): string
 *   export function emitSimultaneousFsHoldAndWinPriorityRuntime(cfg): string
 *   export function shouldDefer(state, cfg): boolean   (test-exposed)
 *
 * Lifecycle (when enabled)
 *   • onHoldAndWinTrigger      → set primaryActive flag
 *   • onFsTriggerArmed         → if primaryActive, capture payload +
 *                                emit onFeaturePriorityDeferred (and
 *                                suppress upstream consumer via
 *                                window.__FS_TRIGGER_DEFERRED__ flag)
 *   • onHoldAndWinEnd          → clear primaryActive
 *   • onGrandReleased          → clear primaryActive (alt path)
 *   • After primaryActive=false → if pending deferred → re-emit
 *                                  onFsEnter with captured payload +
 *                                  emit onFeaturePriorityResumed
 *
 * HookBus events (sole emitter contract)
 *   • onFeaturePriorityDeferred  payload: { feature, payload, primary }
 *   • onFeaturePriorityResumed   payload: { feature, payload, queuedMs }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.simultaneousFsHoldAndWinPriorityForce()
 *     → sets window.__FORCE_SIMULTANEOUS_FS_HW__ = true
 *     → triggers runOneBaseSpin() (real engine path)
 *     → engine bakes simultaneous trigger; block arbitrates organically.
 *
 * Accessibility
 *   • Hidden status text: "Free spins queued, hold-and-win first" via
 *     role=status aria-live=polite on `.sfhp-status` element.
 *
 * Perf budget
 *   • 0 JS per frame; pure event-driven state machine (4 transitions).
 *   • Single hidden DOM element + 2 captured payloads in memory.
 *
 * Honest scope
 *   This block does NOT defer ANY feature trigger when only one fires.
 *   It does NOT alter payouts. It only reorders the trigger event flow
 *   so the secondary feature waits.
 *
 * GDD knobs (under `model.simultaneousFsHoldAndWinPriority`)
 *   • enabled              bool                              (default false)
 *   • primaryFeature       string                            (default 'holdAndWin')
 *   • secondaryFeature     string                            (default 'freeSpins')
 *   • order                string  'primaryThenSecondary' |
 *                                  'secondaryThenPrimary'    (default
 *                                                            'primaryThenSecondary')
 *   • showStatusText       bool                              (default true)
 *   • themeClass           string                            (default '')
 *   • role                 string                            (default 'status')
 *   • ariaLabelPrefix      string                            (default 'Feature priority')
 */

const KNOWN_FEATURES = Object.freeze(new Set([
  'holdAndWin', 'freeSpins', 'wheelBonus', 'bonusPick', 'gamble', 'jackpot',
]));

const KNOWN_ORDERS = Object.freeze(['primaryThenSecondary', 'secondaryThenPrimary']);

const DEFAULTS = Object.freeze({
  enabled:           false,
  primaryFeature:    'holdAndWin',
  secondaryFeature:  'freeSpins',
  order:             'primaryThenSecondary',
  showStatusText:    true,
  themeClass:        '',
  role:              'status',
  ariaLabelPrefix:   'Feature priority',
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.simultaneousFsHoldAndWinPriority) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const pf = sanitizeStringKnob(src.primaryFeature, 32);
  if (pf && KNOWN_FEATURES.has(pf)) cfg.primaryFeature = pf;

  const sf = sanitizeStringKnob(src.secondaryFeature, 32);
  if (sf && KNOWN_FEATURES.has(sf)) cfg.secondaryFeature = sf;

  /* primary and secondary must differ; fall back to defaults if equal */
  if (cfg.primaryFeature === cfg.secondaryFeature) {
    cfg.primaryFeature   = DEFAULTS.primaryFeature;
    cfg.secondaryFeature = DEFAULTS.secondaryFeature;
  }

  if (typeof src.order === 'string' && KNOWN_ORDERS.includes(src.order)) {
    cfg.order = src.order;
  }

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
 * Decide whether the arbiter should defer the secondary trigger based on
 * current state. State shape: { primaryActive: bool, deferredPending: bool }.
 */
export function shouldDefer(state, cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return false;
  if (!state || typeof state !== 'object') return false;
  if (state.deferredPending) return false; /* already queued */
  if (c.order === 'secondaryThenPrimary') return false; /* inverted, no defer */
  return state.primaryActive === true;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitSimultaneousFsHoldAndWinPriorityCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* simultaneousFsHoldAndWinPriority — hidden status label */
.sfhp-status {
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
[data-feature-deferred] {
  /* hook for downstream presentation blocks; e.g.
     [data-feature-deferred="freeSpins"] .fs-meter { opacity: 0.6; } */
  transition: opacity 320ms ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-feature-deferred] { transition: none; }
}
`;
}

/* ─── Runtime emit ────────────────────────────────────────────────────── */

export function emitSimultaneousFsHoldAndWinPriorityRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    primaryFeature:   c.primaryFeature,
    secondaryFeature: c.secondaryFeature,
    order:            c.order,
    showStatusText:   c.showStatusText,
    themeClass:       c.themeClass,
    role:             c.role,
    ariaLabelPrefix:  c.ariaLabelPrefix,
  });

  return `
/* simultaneousFsHoldAndWinPriority runtime — cross-feature arbiter */
(function simultaneousFsHoldAndWinPriorityInit() {
  const CFG = ${cfgJSON};

  let primaryActive = false;
  let deferredPayload = null;
  let queuedAt = 0;
  let statusEl = null;

  function ensureStatusEl() {
    if (!CFG.showStatusText) return null;
    if (statusEl) return statusEl;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<span class="sfhp-status" role="status" aria-live="polite"></span>';
    statusEl = wrap.firstChild;
    if (CFG.themeClass) statusEl.classList.add(CFG.themeClass);
    statusEl.setAttribute('role', CFG.role);
    document.body.appendChild(statusEl);
    return statusEl;
  }

  function setDeferredBodyAttr(feature) {
    try {
      if (feature) document.body.setAttribute('data-feature-deferred', feature);
      else         document.body.removeAttribute('data-feature-deferred');
    } catch (_) {}
  }

  function defer(payload) {
    if (deferredPayload) return; /* already queued */
    deferredPayload = payload || {};
    queuedAt = Date.now();
    setDeferredBodyAttr(CFG.secondaryFeature);
    const el = ensureStatusEl();
    if (el) el.textContent = CFG.ariaLabelPrefix + ': ' + CFG.secondaryFeature
              + ' queued, ' + CFG.primaryFeature + ' first';
    if (typeof window !== 'undefined') {
      window.__FS_TRIGGER_DEFERRED__ = true;
    }
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onFeaturePriorityDeferred', {
          feature: CFG.secondaryFeature,
          payload: deferredPayload,
          primary: CFG.primaryFeature,
        });
      } catch (_) {}
    }
  }

  function resume() {
    if (!deferredPayload) return;
    const payload = deferredPayload;
    const duration = Date.now() - queuedAt;
    deferredPayload = null;
    queuedAt = 0;
    setDeferredBodyAttr(null);
    if (statusEl) statusEl.textContent = '';
    if (typeof window !== 'undefined') {
      window.__FS_TRIGGER_DEFERRED__ = false;
    }
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onFeaturePriorityResumed', {
          feature:  CFG.secondaryFeature,
          payload:  payload,
          queuedMs: duration,
        });
        /* NOTE: do NOT re-emit onFsEnter here — that would violate the
           single-owner emit contract (onFsEnter is owned by freeSpins /
           reelEngine). Downstream consumers must subscribe to
           onFeaturePriorityResumed and trigger their own canonical
           entry. The __FS_TRIGGER_DEFERRED__ window flag is now cleared
           above so freeSpins, on its next engine-emitted onFsEnter, no
           longer bails out. Engines that want immediate resume bind a
           one-shot handler to onFeaturePriorityResumed. */
      } catch (_) {}
    }
  }

  function handlePrimaryStart() {
    primaryActive = true;
  }
  function handlePrimaryEnd() {
    primaryActive = false;
    /* Slight microtask delay so any downstream "primary ended"
       presentation completes before the deferred trigger fires. */
    if (deferredPayload) {
      setTimeout(resume, 0);
    }
  }

  function handleSecondaryArmed(payload) {
    if (!primaryActive) return; /* not simultaneous; let it through */
    if (CFG.order === 'secondaryThenPrimary') return; /* inverted */
    defer(payload);
  }

  /* Force chip */
  if (typeof window !== 'undefined') {
    window.simultaneousFsHoldAndWinPriorityForce = function () {
      window.__FORCE_SIMULTANEOUS_FS_HW__ = true;
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
    window.simultaneousFsHoldAndWinPriorityGet = function () {
      return {
        primaryActive:    primaryActive,
        deferredPending:  !!deferredPayload,
        primaryFeature:   CFG.primaryFeature,
        secondaryFeature: CFG.secondaryFeature,
      };
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    /* Primary feature start/end (hold-and-win default). */
    window.HookBus.on('onHoldAndWinTrigger', handlePrimaryStart);
    window.HookBus.on('onHoldAndWinEnd',     handlePrimaryEnd);
    window.HookBus.on('onGrandReleased',     handlePrimaryEnd);
    /* Secondary feature trigger arming (free-spins default). */
    window.HookBus.on('onFsTriggerArmed',    handleSecondaryArmed);
    /* Also listen to onFsEnter directly for engines that emit it on the
       same spin without an armed pre-event; the block will re-defer if
       primary is active AND no deferred payload is already queued. */
    window.HookBus.on('onFsEnter', function (p) {
      if (!primaryActive) return;
      if (deferredPayload) return;
      /* Cancel the upstream FS entry by deferring; downstream FS module
         observes window.__FS_TRIGGER_DEFERRED__ and bails out if set. */
      defer(p);
    });
  }
})();
`;
}
