/**
 * src/blocks/franceComplianceGate.mjs
 *
 * W58.J-FR — French ANJ (Autorité nationale des jeux) compliance gate.
 *
 * Centralized opt-in block that enforces ANJ's slot-mechanics obligations
 * at boot time. France's online casino market is the strictest in Europe:
 * Ordonnance 2019-1015 + Decree n° 2019-1061 + ANJ Recommendation
 * 2022-01 prohibit several mechanics outright and require player-protection
 * baselines beyond the EU AI Act umbrella.
 *
 *   No autoplay (ANJ Recommendation 2022-01 §3.2)
 *     "Le joueur doit conserver la maîtrise de chaque tour de jeu. Tout
 *     enchaînement automatique de tours est interdit." Every spin must
 *     be a deliberate player action. This block sets
 *     `window.__FR_AUTOPLAY_BANNED__ = true` and emits onAutoplayBanned
 *     so downstream UI (autoplay button block) reads the flag at mount
 *     time and refuses to render the autoplay control.
 *
 *   No turbo / fast-spin (ANJ Recommendation 2022-01 §3.3)
 *     Reel-spin animation must respect the perceptual floor — fast-spin
 *     mode is considered "rapid play" and is prohibited. The block sets
 *     `window.__FR_TURBO_BANNED__ = true` and emits onTurboBanned;
 *     turboMode block consumes the flag and refuses toggle.
 *
 *   Minimum spin duration (Decree n° 2019-1061 Art.4)
 *     A spin trigger to settle must take ≥ 3 seconds (slightly slower
 *     than vanilla, slightly faster than the German 5-second floor).
 *     This block sets `window.__FR_MIN_SPIN_MS__ = 3000` so downstream
 *     dispatchers respect the floor.
 *
 *   FRJ self-exclusion register check (Decree n° 2019-1061 Art.21)
 *     Operators MUST verify the player is not on the FRJ register before
 *     the first spin of a session. Set `__FR_FRJ_CHECK_REQUIRED__` flag
 *     + emit onFrjCheckRequired. Operator session-init flips the pass
 *     flag (__FR_FRJ_CHECK_PASSED__) after back-end verification — the
 *     pattern mirrors the NL Cruks check.
 *
 * Math gate
 *   ────────
 *   Block does NOT touch RTP / volatility / hit frequency. ANJ's RTP
 *   floor (currently 85% per Decree) is a math-layer parameter and
 *   out-of-scope per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const FR_MIN_SPIN_MS_DEFAULT
 *   export const FR_MIN_SPIN_MS_BOUNDS
 *   export function defaultConfig(): FranceComplianceGateConfig
 *   export function resolveConfig(model?: object): FranceComplianceGateConfig
 *   export function emitFranceComplianceGateCSS(cfg): string  (no-op)
 *   export function emitFranceComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM.
 *     Sets four window flags + emits four audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onAutoplayBanned             payload: { jurisdiction, rule }
 *   • onTurboBanned                payload: { jurisdiction, rule }
 *   • onMinSpinDurationEnforced    payload: { jurisdiction, minSpinMs, rule }
 *   • onFrjCheckRequired           payload: { jurisdiction, rule }
 *
 * Accessibility
 *   Block is invisible to the player (boot-time DOM-free side effect).
 *   The FRJ check UI is the operator's responsibility.
 *
 * Honest scope
 *   This block sets the OBLIGATION flags + fires the audit events. It
 *   does NOT perform the back-end FRJ API call (operator-side PII). It
 *   does NOT directly remove the autoplay/turbo buttons from the DOM;
 *   the autoplay and turboMode blocks consume the flags at mount time.
 *
 * GDD knobs (under `model.franceComplianceGate`)
 *   • enabled       bool   (default false — opt-in or auto when FR)
 *   • jurisdiction  string (3-key precedence)
 *   • minSpinMs     int    (default 3000, bounds [1000, 30000])
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

/* W59.H1 — Central jurisdiction precedence resolver. */
import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const FR_MIN_SPIN_MS_DEFAULT = 3000;
export const FR_MIN_SPIN_MS_BOUNDS = Object.freeze([1000, 30000]);

const ANJ_JURISDICTIONS = Object.freeze(['FR']);

const DEFAULTS = Object.freeze({
  enabled:      false,
  jurisdiction: null,
  minSpinMs:    FR_MIN_SPIN_MS_DEFAULT,
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
  const src = (model && model.franceComplianceGate) || {};

  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'franceComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && ANJ_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  const ms = clampInt(src.minSpinMs, FR_MIN_SPIN_MS_BOUNDS[0], FR_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitFranceComplianceGateCSS(_cfg) {
  /* Operator-side renders the FRJ check UI; this block has no visual
   * surface. Returning '' keeps the orchestrator clean. */
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitFranceComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const minSpinMs = c.minSpinMs;

  return `
/* franceComplianceGate runtime — ANJ Decree 2019-1061 + Recommendation 2022-01 */
(function franceComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS = ${minSpinMs};

  if (typeof window === 'undefined') return;
  var _hasBus = function () {
    return window.HookBus && typeof window.HookBus.emit === 'function';
  };

  /* ANJ Recommendation 2022-01 §3.2 — No autoplay. */
  window.__FR_AUTOPLAY_BANNED__ = true;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onAutoplayBanned', {
        jurisdiction: JURISDICTION,
        rule: 'FR-ANJ-Reco-2022-01-§3.2',
      });
    } catch (_) {}
  }

  /* ANJ Recommendation 2022-01 §3.3 — No turbo / fast-spin. */
  window.__FR_TURBO_BANNED__ = true;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onTurboBanned', {
        jurisdiction: JURISDICTION,
        rule: 'FR-ANJ-Reco-2022-01-§3.3',
      });
    } catch (_) {}
  }

  /* Decree n° 2019-1061 Art.4 — Minimum spin duration. */
  window.__FR_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) {
    try {
      window.HookBus.emit('onMinSpinDurationEnforced', {
        jurisdiction: JURISDICTION,
        minSpinMs: MIN_SPIN_MS,
        rule: 'FR-Decree-2019-1061-Art.4',
      });
    } catch (_) {}
  }

  /* Decree n° 2019-1061 Art.21 — FRJ self-exclusion register check. */
  window.__FR_FRJ_CHECK_REQUIRED__ = true;
  if (typeof window.__FR_FRJ_CHECK_PASSED__ === 'undefined') {
    window.__FR_FRJ_CHECK_PASSED__ = false;
  }
  if (_hasBus()) {
    try {
      window.HookBus.emit('onFrjCheckRequired', {
        jurisdiction: JURISDICTION,
        rule: 'FR-Decree-2019-1061-Art.21',
      });
    } catch (_) {}
  }
})();
`;
}
