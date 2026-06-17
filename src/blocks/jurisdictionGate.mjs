/**
 * src/blocks/jurisdictionGate.mjs
 *
 * W59.H1 — Centralized jurisdiction-precedence resolver + audit gate.
 *
 * Six jurisdiction-aware blocks (W57.A4 + W58.J-{UKGC,AGCO,SE,DE,NL,EU})
 * implemented the SAME 3-key precedence chain inline:
 *
 *     regulator.profile
 *       > responsibleGambling.jurisdiction
 *         > <block>.jurisdiction
 *
 * Six copies of the same chain were maintenance debt: a future
 * regulator (e.g. UAE GCGRA, BR SECAP) would need six new edits to
 * land the same logic. This block extracts the chain into a single
 * exported helper + a boot-time audit event so every gate becomes a
 * one-liner.
 *
 * Math gate
 *   ────────
 *   Block does NOT touch math. Per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const JURISDICTION_PRECEDENCE_KEYS
 *   export function resolveJurisdiction(model?: object): string | null
 *   export function defaultConfig(): JurisdictionGateConfig
 *   export function resolveConfig(model?: object): JurisdictionGateConfig
 *   export function emitJurisdictionGateCSS(cfg): string  (no-op)
 *   export function emitJurisdictionGateRuntime(cfg): string
 *
 * Lifecycle
 *   • resolveJurisdiction is a pure helper — synchronously imported by
 *     every gate block so the precedence chain stays consistent.
 *   • Runtime emit is boot-time only. Listens to no HookBus events.
 *     Sets window.__SLOT_JURISDICTION__ + emits onJurisdictionResolved
 *     once at boot so downstream consumers (cert harness, audit trail,
 *     telemetry) can record the active jurisdiction without re-walking
 *     the precedence chain themselves.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onJurisdictionResolved  payload: { jurisdiction, source }
 *
 * GDD knobs (under `model.jurisdictionGate`)
 *   • enabled    bool   (default true — gate is always-on when model has
 *                        any jurisdiction signal; disable only for unit-
 *                        test sandboxes that want zero side effects)
 *
 * Honest scope
 *   This block does NOT replace the per-gate obligation logic. Each
 *   downstream block (autoplay, winCap, realityCheck, germany/netherlands/
 *   euAiAct gate) still owns its own obligation flags + events; the only
 *   responsibility extracted here is the precedence chain itself.
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

/* Frozen list documenting the precedence chain. Order is significant:
 * first match wins. Each entry is a dotted-path string the resolver
 * walks via _readPath. */
export const JURISDICTION_PRECEDENCE_KEYS = Object.freeze([
  'regulator.profile',
  'responsibleGambling.jurisdiction',
]);

function _readPath(obj, dotted) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * resolveJurisdiction — single source of truth for the precedence chain.
 *
 * @param {object} [model]
 * @param {object} [opts]
 * @param {string} [opts.fallbackKey] additional dotted path (e.g.
 *        'autoplay.jurisdiction') consulted AFTER the canonical chain
 *        so per-block opt-in still works
 * @returns {string|null} uppercase jurisdiction code, or null
 */
export function resolveJurisdiction(model, opts) {
  if (!model || typeof model !== 'object') return null;
  for (const key of JURISDICTION_PRECEDENCE_KEYS) {
    const v = _readPath(model, key);
    if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
  }
  /* Per-block opt-in fallback. Caller passes its own knob path so the
   * helper stays a one-liner at the call site. */
  if (opts && typeof opts.fallbackKey === 'string') {
    const v = _readPath(model, opts.fallbackKey);
    if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
  }
  return null;
}

/**
 * resolveJurisdictionWithSource — variant that returns the resolved
 * jurisdiction PLUS which path it came from. Used by the boot-time
 * audit emit so the source is recorded in the audit trail.
 *
 * @returns {{ jurisdiction: string|null, source: string|null }}
 */
export function resolveJurisdictionWithSource(model, opts) {
  if (!model || typeof model !== 'object') {
    return { jurisdiction: null, source: null };
  }
  for (const key of JURISDICTION_PRECEDENCE_KEYS) {
    const v = _readPath(model, key);
    if (typeof v === 'string' && v.trim()) {
      return { jurisdiction: v.trim().toUpperCase(), source: key };
    }
  }
  if (opts && typeof opts.fallbackKey === 'string') {
    const v = _readPath(model, opts.fallbackKey);
    if (typeof v === 'string' && v.trim()) {
      return { jurisdiction: v.trim().toUpperCase(), source: opts.fallbackKey };
    }
  }
  return { jurisdiction: null, source: null };
}

/* ─── Block config + emit shape ──────────────────────────────────────── */

const DEFAULTS = Object.freeze({
  enabled: true,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.jurisdictionGate) || {};
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  /* Stash the resolved jurisdiction + source so the runtime emit can
   * bake them as literals (no client-side re-walking of the precedence
   * chain). resolveConfig is called at orchestrator time. */
  const { jurisdiction, source } = resolveJurisdictionWithSource(model);
  cfg.jurisdiction = jurisdiction;
  cfg.source = source;
  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────── */

export function emitJurisdictionGateCSS(_cfg) {
  return '';
}

/* ─── Runtime emit ──────────────────────────────────────────────────── */

export function emitJurisdictionGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  /* Skip the emit when no jurisdiction signal in the model — the gate
   * has nothing to declare. Downstream gates also bail out without
   * a jurisdiction so no audit event is missed. */
  if (!c.jurisdiction) return '';
  const jurJSON = JSON.stringify(c.jurisdiction);
  const srcJSON = JSON.stringify(c.source || '');
  return `
/* jurisdictionGate runtime — single audit emit of resolved jurisdiction */
(function jurisdictionGateInit() {
  var JURISDICTION = ${jurJSON};
  var SOURCE = ${srcJSON};
  if (typeof window === 'undefined') return;
  window.__SLOT_JURISDICTION__ = JURISDICTION;
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    try {
      window.HookBus.emit('onJurisdictionResolved', {
        jurisdiction: JURISDICTION,
        source: SOURCE,
      });
    } catch (_) {}
  }
})();
`;
}
