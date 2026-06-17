/**
 * src/blocks/spainComplianceGate.mjs
 *
 * W58.J-ES — Spanish DGOJ (Dirección General de Ordenación del Juego)
 * compliance gate.
 *
 * Centralized opt-in block that enforces DGOJ's slot-mechanics obligations
 * at boot time. Spain regulates online casino under Real Decreto 958/2020
 * + Real Decreto 176/2023 + DGOJ technical specifications.
 *
 *   No autoplay (RD 958/2020 Art.26)
 *     "El jugador deberá iniciar de forma manual y consciente cada
 *     partida individual." Every spin must be manually initiated. This
 *     block sets `window.__ES_AUTOPLAY_BANNED__ = true` + emits
 *     onAutoplayBanned.
 *
 *   Minimum spin duration (DGOJ Tech Spec §5)
 *     DGOJ mandates a minimum 3-second spin animation to preserve the
 *     "perception of skill / risk". Sets `window.__ES_MIN_SPIN_MS__ = 3000`.
 *
 *   Mandatory reality-check interval (RD 958/2020 Art.21)
 *     Every 60 minutes of play, a forced reality-check modal must surface
 *     showing session duration + spend. Sets
 *     `window.__ES_REALITY_CHECK_INTERVAL_MIN__ = 60` + emits
 *     onMandatoryRealityCheckIntervalEnforced.
 *
 *   RGIAJ self-exclusion register check (RD 958/2020 Art.28)
 *     RGIAJ (Registro General de Interdicciones de Acceso al Juego) is
 *     the Spanish central self-exclusion register. Operators MUST verify
 *     the player before the first spin. Sets `__ES_RGIAJ_CHECK_REQUIRED__`
 *     + emits onRgiajCheckRequired. Operator session-init flips
 *     __ES_RGIAJ_CHECK_PASSED__ true after back-end verification.
 *
 *   Bonus offer restriction (RD 958/2020 Art.25)
 *     RD 958/2020 prohibits unsolicited bonus offers; the existing
 *     bonusBuy block already covers the bonus-buy ban (W57.A4). This
 *     block sets `window.__ES_BONUS_OFFERS_RESTRICTED__ = true` so the
 *     marketing layer (out-of-scope) knows the restriction applies.
 *
 * Math gate
 *   ────────
 *   Block does NOT compute RTP / volatility. DGOJ RTP floor (≥ 90%) is
 *   a math-layer parameter and out-of-scope per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const ES_MIN_SPIN_MS_DEFAULT
 *   export const ES_MIN_SPIN_MS_BOUNDS
 *   export const ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT
 *   export function defaultConfig(): SpainComplianceGateConfig
 *   export function resolveConfig(model?: object): SpainComplianceGateConfig
 *   export function emitSpainComplianceGateCSS(cfg): string  (no-op)
 *   export function emitSpainComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM.
 *     Sets five window flags + emits four audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onAutoplayBanned                       payload: { jurisdiction, rule }
 *   • onMinSpinDurationEnforced              payload: { jurisdiction, minSpinMs, rule }
 *   • onMandatoryRealityCheckIntervalEnforced payload: { jurisdiction, intervalMin, rule }
 *   • onRgiajCheckRequired                   payload: { jurisdiction, rule }
 *
 * Note: onAutoplayBanned + onMinSpinDurationEnforced +
 * onMandatoryRealityCheckIntervalEnforced are shared multi-jurisdiction
 * events (FR + IT + ES). LEGO sole-owner gate is satisfied per-runtime
 * (each gate is the sole owner when its jurisdiction matches). The
 * jurisdiction field on every payload distinguishes the source.
 *
 * GDD knobs (under `model.spainComplianceGate`)
 *   • enabled                bool   (default false — opt-in or auto when ES)
 *   • jurisdiction           string (3-key precedence)
 *   • minSpinMs              int    (default 3000, bounds [1000, 30000])
 *   • realityCheckIntervalMin int   (default 60, bounds [15, 240])
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const ES_MIN_SPIN_MS_DEFAULT = 3000;
export const ES_MIN_SPIN_MS_BOUNDS = Object.freeze([1000, 30000]);
export const ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT = 60;
export const ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS = Object.freeze([15, 240]);

const DGOJ_JURISDICTIONS = Object.freeze(['ES']);

const DEFAULTS = Object.freeze({
  enabled:                 false,
  jurisdiction:            null,
  minSpinMs:               ES_MIN_SPIN_MS_DEFAULT,
  realityCheckIntervalMin: ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.spainComplianceGate) || {};

  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'spainComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && DGOJ_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  const ms = clampInt(src.minSpinMs, ES_MIN_SPIN_MS_BOUNDS[0], ES_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;

  const rcMin = clampInt(src.realityCheckIntervalMin,
    ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS[0],
    ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS[1]);
  if (rcMin !== null) cfg.realityCheckIntervalMin = rcMin;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitSpainComplianceGateCSS(_cfg) {
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitSpainComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const minSpinMs = c.minSpinMs;
  const rcIntervalMin = c.realityCheckIntervalMin;

  return `
/* spainComplianceGate runtime — DGOJ RD 958/2020 + 176/2023 */
(function spainComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS = ${minSpinMs};
  var RC_INTERVAL_MIN = ${rcIntervalMin};

  if (typeof window === 'undefined') return;
  var _hasBus = function () {
    return window.HookBus && typeof window.HookBus.emit === 'function';
  };

  /* RD 958/2020 Art.26 — No autoplay. */
  window.__ES_AUTOPLAY_BANNED__ = true;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onAutoplayBanned', {
        jurisdiction: JURISDICTION,
        rule: 'ES-RD-958-2020-Art.26',
      });
    } catch (_) {}
  }

  /* DGOJ Tech Spec §5 — Minimum spin duration. */
  window.__ES_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onMinSpinDurationEnforced', {
        jurisdiction: JURISDICTION,
        minSpinMs: MIN_SPIN_MS,
        rule: 'ES-DGOJ-TechSpec-§5',
      });
    } catch (_) {}
  }

  /* RD 958/2020 Art.21 — Mandatory reality-check interval. */
  window.__ES_REALITY_CHECK_INTERVAL_MIN__ = RC_INTERVAL_MIN;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onMandatoryRealityCheckIntervalEnforced', {
        jurisdiction: JURISDICTION,
        intervalMin: RC_INTERVAL_MIN,
        rule: 'ES-RD-958-2020-Art.21',
      });
    } catch (_) {}
  }

  /* RD 958/2020 Art.28 — RGIAJ self-exclusion register check. */
  window.__ES_RGIAJ_CHECK_REQUIRED__ = true;
  if (typeof window.__ES_RGIAJ_CHECK_PASSED__ === 'undefined') {
    window.__ES_RGIAJ_CHECK_PASSED__ = false;
  }
  if (_hasBus()) {
    try {
      window.HookBus.emit('onRgiajCheckRequired', {
        jurisdiction: JURISDICTION,
        rule: 'ES-RD-958-2020-Art.28',
      });
    } catch (_) {}
  }

  /* RD 958/2020 Art.25 — Bonus offer restrictions (marketing-layer flag). */
  window.__ES_BONUS_OFFERS_RESTRICTED__ = true;
})();
`;
}
