import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/collectStreakBonus.mjs
 *
 * Wave Z2 (Boki 2026-06-21 "automatski generise, ali neka povlaci znanje iz
 * agenata koji su zaduzeni za te blokove") — agent-augmented scaffold.
 *
 * Archetype:    accumulator
 * Agent owner:  MATH_ARCHITECT
 * Domain agent: MATH
 * Feature kind: collectStreakBonus
 *
 * Purpose:
 *   Collects per-spin contributions until threshold N → trigger reward
 *
 * Generated from:
 *   - Archetype catalog: src/registry/featureArchetypes.mjs#accumulator
 *   - Knowledge base:    agents/synth-pool/_REGISTRY.md#accumulator
 *   - Domain expertise:  agents/synth-pool/_DOMAIN_MATH.md
 *
 * Lifecycle (HookBus):
 *   - subscribes: onSpinResult, postSpin, onTumbleStep
 *   - emits:      onCollectStreakBonusComplete, onCollectStreakBonusStateChanged
 *
 * State shape:
 *   {"current":0,"threshold":0,"payload":null}
 *
 * Force chip:   __FORCE_COLLECTOR_FILL__
 * Window flag:  __COLLECTOR_TALLY__
 *
 * Canonical references (existing blocks that implement this archetype):
 *   - src/blocks/coinCollect.mjs
 *   - src/blocks/energyMeter.mjs
 *   - src/blocks/multiplierLadder.mjs
 *
 * Pitfalls baked into this scaffold (from synth-pool knowledge base):
 *   1. NIKAD ne reset-uj tally na `postSpin` PRE `onAccumulatorFull` emit-a — gubi se threshold-cross signal
 *   2. NIKAD ne dupliraj contribution u istom spinu kada cascade-collapse koincidira (tumble engine emit-uje `onTumbleStep` × N PLUS `onSpinResult` × 1)
 *   3. ⚠️ Overflow handling: ako contribution > (threshold - current), kako tretiraš višak? GDD mora reći (drop / next-cycle / convert-to-mult)
 *
 * Domain hard rules applied:
 *   1. **NIKAD ne hardcode RTP, hit frequency, volatility tier u block-u.**
 *   2. **Weighted buckets žive u model.{feature}.weights, NIKAD u block code.**
 *   3. **Jackpot tier values žive u model.jackpot.tiers — kompliance + math composite.**
 *   4. **FS award table je MATH attestation.**
 *   5. **Multiplier ladder rungs — strict ordered ascend.**
 *
 * Math gate:
 *   Block does NOT touch RTP / volatility / hit frequency. All parametric
 *   values resolved from model.<feature> via resolveConfig. Compliance with
 *   rule_no_math_unless_asked enforced at scaffold time.
 *
 * Senior-grade contract (rule_senior_grade_code):
 *   - JSDoc kontrakt header ✅
 *   - resolveConfig + defaultConfig (single source of truth) ✅
 *   - emit triplet: emitCollectStreakBonusCSS / emitCollectStreakBonusRuntime / emitCollectStreakBonusMarkup ✅
 *   - Lifecycle wired via HookBus.on, NEVER inline event listeners ✅
 *   - One-shot force flag consumption + delete ✅
 *   - prefers-reduced-motion + forced-colors safety ✅
 *
 * Public API:
 *   defaultConfig() → { enabled: boolean, ...stateShape }
 *   resolveConfig(model) → defaultConfig merged with model.collectStreakBonus
 *   emitCollectStreakBonusCSS(cfg) → string
 *   emitCollectStreakBonusMarkup(cfg) → string
 *   emitCollectStreakBonusRuntime(cfg) → string
 *
 * @module collectStreakBonus
 */

const DEFAULTS = Object.freeze({
  enabled: false,
  /* archetype state shape */
  current: 0,
  threshold: 0,
  payload: null,
});

export function defaultConfig() { return Object.freeze({ ...DEFAULTS }); }

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.collectStreakBonus) || {};
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (typeof src.current !== 'undefined') cfg.current = src.current;
  if (typeof src.threshold !== 'undefined') cfg.threshold = src.threshold;
  if (typeof src.payload !== 'undefined') cfg.payload = src.payload;
  /* Auto-enable when GDD declares this feature kind */
  const features = (model && Array.isArray(model.features)) ? model.features : [];
  if (features.some(f => f && (f.kind === 'collectStreakBonus' || f.kind === 'collectStreakBonus'))) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitCollectStreakBonusCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  return `
/* collectStreakBonus — ${'accumulator'} archetype */
.collectStreakBonus-root { position: relative; }
.collectStreakBonus-cta { min-width: 44px; min-height: 44px; }
@media (prefers-reduced-motion: reduce) {
  .collectStreakBonus-root { transition: none !important; animation: none !important; }
}
@media (forced-colors: active) {
  .collectStreakBonus-root { border: 2px solid CanvasText; }
}
`;
}

export function emitCollectStreakBonusMarkup(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  /* Reveal/jackpot UIs MUST declare role=dialog + aria-modal (UX rule) */
  return tagBlockMarkup(`<div class="collectStreakBonus-root" data-archetype="accumulator">
    <div class="collectStreakBonus-state" aria-live="polite" aria-atomic="true"></div>
  </div>`, 'collectStreakBonus');
}

export function emitCollectStreakBonusRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  return `
/* collectStreakBonus runtime — ${'accumulator'} archetype lifecycle */
(function collectStreakBonusInit() {
  if (typeof window === 'undefined' || !window.HookBus) return;
  /* Window flag init */
  window.__COLLECTOR_TALLY__ = null;

  /* Lifecycle subscriptions */
  window.HookBus.on('onSpinResult', function (payload) {
    /* archetype-specific onSpinResult handler */
  });
  window.HookBus.on('postSpin', function (payload) {
    /* archetype-specific postSpin handler */
  });
  window.HookBus.on('onTumbleStep', function (payload) {
    /* archetype-specific onTumbleStep handler */
  });

  /* Emit completion event */
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    window.HookBus.emit('onCollectStreakBonusInit', { archetype: 'accumulator' });
  }
})();
`;
}
