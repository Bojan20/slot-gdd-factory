/**
 * src/blocks/italyComplianceGate.mjs
 *
 * W58.J-IT — Italian ADM (Agenzia delle Dogane e dei Monopoli, formerly
 * AAMS) compliance gate.
 *
 * Centralized opt-in block that enforces ADM's slot-mechanics obligations
 * at boot time. Italy regulates online casino under Legislative Decree
 * 132/2020 + Decreto Dignità (Decree-Law 87/2018, converted Law 96/2018)
 * + ADM technical specifications.
 *
 *   No autoplay (ADM Technical Spec §6.2)
 *     "Il giocatore deve confermare ciascuna giocata; non sono ammessi
 *     meccanismi che avviano automaticamente giocate successive." Every
 *     spin requires explicit player confirmation. This block sets
 *     `window.__IT_AUTOPLAY_BANNED__ = true` and emits onAutoplayBanned.
 *
 *   No turbo / fast-spin (ADM Technical Spec §6.3)
 *     Reel-spin animation must not be skippable below the perceptual
 *     floor. Sets `window.__IT_TURBO_BANNED__ = true` + emits
 *     onTurboBanned.
 *
 *   Minimum spin duration (ADM Technical Spec §6.4)
 *     ADM mandates a 3-second minimum spin duration. Sets
 *     `window.__IT_MIN_SPIN_MS__ = 3000`.
 *
 *   Mandatory reality-check interval (Decreto Dignità Art.9 + ADM Spec §8)
 *     Every 60 minutes of play, a forced reality-check modal must surface
 *     showing session duration + net loss. Sets
 *     `window.__IT_REALITY_CHECK_INTERVAL_MIN__ = 60` and emits
 *     onMandatoryRealityCheckIntervalEnforced; downstream realityCheck
 *     block consumes the flag to clamp its interval at the floor.
 *
 *   RUA self-exclusion register check (Legislative Decree 132/2020 Art.5)
 *     RUA (Registro Unico Auto-esclusi) is the Italian central self-
 *     exclusion register. Operators MUST verify the player before the
 *     first spin. Sets `__IT_RUA_CHECK_REQUIRED__` + emits onRuaCheckRequired.
 *     Operator session-init flips __IT_RUA_CHECK_PASSED__ true after
 *     back-end verification (pattern mirrors NL Cruks + FR FRJ).
 *
 * Math gate
 *   ────────
 *   Block does NOT compute RTP / volatility. ADM RTP floor (≥ 90%) is
 *   a math-layer parameter and out-of-scope per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const IT_MIN_SPIN_MS_DEFAULT
 *   export const IT_MIN_SPIN_MS_BOUNDS
 *   export const IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT
 *   export function defaultConfig(): ItalyComplianceGateConfig
 *   export function resolveConfig(model?: object): ItalyComplianceGateConfig
 *   export function emitItalyComplianceGateCSS(cfg): string  (no-op)
 *   export function emitItalyComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM.
 *     Sets five window flags + emits five audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onAutoplayBanned                       payload: { jurisdiction, rule }
 *   • onTurboBanned                          payload: { jurisdiction, rule }
 *   • onMinSpinDurationEnforced              payload: { jurisdiction, minSpinMs, rule }
 *   • onMandatoryRealityCheckIntervalEnforced payload: { jurisdiction, intervalMin, rule }
 *   • onRuaCheckRequired                     payload: { jurisdiction, rule }
 *
 * Note: onAutoplayBanned / onTurboBanned / onMinSpinDurationEnforced are
 * shared cross-jurisdiction events (FR + IT + ES all emit the same shape).
 * LEGO sole-owner gate is satisfied because EACH jurisdiction gate is the
 * SOLE OWNER for its OWN runtime, and per-emission the jurisdiction field
 * distinguishes the source. We declare these as multi-owner in lego-gate.
 *
 * GDD knobs (under `model.italyComplianceGate`)
 *   • enabled                bool   (default false — opt-in or auto when IT)
 *   • jurisdiction           string (3-key precedence)
 *   • minSpinMs              int    (default 3000, bounds [1000, 30000])
 *   • realityCheckIntervalMin int   (default 60, bounds [15, 240])
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const IT_MIN_SPIN_MS_DEFAULT = 3000;
export const IT_MIN_SPIN_MS_BOUNDS = Object.freeze([1000, 30000]);
export const IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT = 60;
export const IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS = Object.freeze([15, 240]);

const ADM_JURISDICTIONS = Object.freeze(['IT']);

const DEFAULTS = Object.freeze({
  enabled:                 false,
  jurisdiction:            null,
  minSpinMs:               IT_MIN_SPIN_MS_DEFAULT,
  realityCheckIntervalMin: IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT,
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.italyComplianceGate) || {};

  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'italyComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && ADM_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  const ms = clampInt(src.minSpinMs, IT_MIN_SPIN_MS_BOUNDS[0], IT_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;

  const rcMin = clampInt(src.realityCheckIntervalMin,
    IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS[0],
    IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS[1]);
  if (rcMin !== null) cfg.realityCheckIntervalMin = rcMin;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitItalyComplianceGateCSS(_cfg) {
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitItalyComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const minSpinMs = c.minSpinMs;
  const rcIntervalMin = c.realityCheckIntervalMin;

  return `
/* italyComplianceGate runtime — ADM Tech Spec + LD 132/2020 + Decreto Dignità */
(function italyComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS = ${minSpinMs};
  var RC_INTERVAL_MIN = ${rcIntervalMin};

  if (typeof window === 'undefined') return;
  var _hasBus = function () {
    return window.HookBus && typeof window.HookBus.emit === 'function';
  };

  /* ADM Technical Spec §6.2 — No autoplay. */
  window.__IT_AUTOPLAY_BANNED__ = true;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onAutoplayBanned', {
        jurisdiction: JURISDICTION,
        rule: 'IT-ADM-TechSpec-§6.2',
      });
    } catch (_) {}
  }

  /* ADM Technical Spec §6.3 — No turbo / fast-spin. */
  window.__IT_TURBO_BANNED__ = true;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onTurboBanned', {
        jurisdiction: JURISDICTION,
        rule: 'IT-ADM-TechSpec-§6.3',
      });
    } catch (_) {}
  }

  /* ADM Technical Spec §6.4 — Minimum spin duration. */
  window.__IT_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onMinSpinDurationEnforced', {
        jurisdiction: JURISDICTION,
        minSpinMs: MIN_SPIN_MS,
        rule: 'IT-ADM-TechSpec-§6.4',
      });
    } catch (_) {}
  }

  /* Decreto Dignità Art.9 + ADM Spec §8 — Mandatory reality-check interval. */
  window.__IT_REALITY_CHECK_INTERVAL_MIN__ = RC_INTERVAL_MIN;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onMandatoryRealityCheckIntervalEnforced', {
        jurisdiction: JURISDICTION,
        intervalMin: RC_INTERVAL_MIN,
        rule: 'IT-DecretoDignita-Art.9',
      });
    } catch (_) {}
  }

  /* Legislative Decree 132/2020 Art.5 — RUA self-exclusion register check. */
  window.__IT_RUA_CHECK_REQUIRED__ = true;
  if (typeof window.__IT_RUA_CHECK_PASSED__ === 'undefined') {
    window.__IT_RUA_CHECK_PASSED__ = false;
  }
  if (_hasBus()) {
    try {
      window.HookBus.emit('onRuaCheckRequired', {
        jurisdiction: JURISDICTION,
        rule: 'IT-LD-132-2020-Art.5',
      });
    } catch (_) {}
  }
})();
`;
}
