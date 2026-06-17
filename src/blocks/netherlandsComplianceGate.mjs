/**
 * src/blocks/netherlandsComplianceGate.mjs
 *
 * W58.J-NL — NL KSA (Wet kansspelen op afstand) compliance gate.
 *
 * Centralized opt-in block that enforces TWO Dutch jurisdiction
 * obligations at boot time:
 *
 *   §31 Cruks register check
 *     Cruks (Centraal Register Uitsluiting Kansspelen) is the Dutch
 *     central self-exclusion register. Operators MUST verify the player
 *     is not on the register BEFORE the first spin of a session. This
 *     block sets a window-level flag `window.__NL_CRUKS_CHECK_REQUIRED__`
 *     at boot; the operator's session-init layer must perform the
 *     actual back-end check and flip the gate clear flag
 *     (`window.__NL_CRUKS_CHECK_PASSED__ = true`) before the spin
 *     dispatcher allows play. This block emits onCruksCheckRequired
 *     once at boot so audit-trail consumers can record the obligation.
 *
 *   §33 Cool-off period enforcement
 *     A player who voluntarily sets a cool-off period in Cruks (24h /
 *     7 days / 30 days / permanent) cannot resume play across ANY
 *     licensed operator until the period expires. The cross-operator
 *     enforcement happens at the regulator side via Cruks; locally
 *     this block exposes the configured minimum cool-off hours via
 *     `window.__NL_COOL_OFF_HOURS__` and emits onCoolOffEnforced so
 *     downstream RG blocks (sessionTimeout, realityCheck) can respect
 *     the local cool-off if the player triggers a session pause.
 *
 *   §31a Bonus-buy ban
 *     Already enforced by bonusBuy.mjs BONUS_BUY_BANNED_JURISDICTIONS
 *     (W57.A4). This block does NOT duplicate that gate.
 *
 * Math gate
 *   ────────
 *   Block does NOT compute RTP / volatility / hit frequency. The
 *   Cruks-check and cool-off are presentation/session-lifecycle gates,
 *   not math parameters. Per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const NL_COOL_OFF_HOURS_DEFAULT
 *   export const NL_COOL_OFF_HOURS_BOUNDS
 *   export function defaultConfig(): NetherlandsComplianceGateConfig
 *   export function resolveConfig(model?: object): NetherlandsComplianceGateConfig
 *   export function emitNetherlandsComplianceGateCSS(cfg): string  (no-op)
 *   export function emitNetherlandsComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM.
 *     Sets two window flags + emits two audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onCruksCheckRequired  payload: { jurisdiction, rule }
 *   • onCoolOffEnforced     payload: { jurisdiction, coolOffHours, rule }
 *
 * Accessibility
 *   Block is invisible to the player (boot-time DOM-free side effect).
 *   The actual Cruks check UI is the operator's responsibility (banner
 *   + login interstitial) and is OUT-OF-SCOPE for this block.
 *
 * Honest scope
 *   This block sets the OBLIGATION flags + fires the audit events. It
 *   does NOT perform the back-end Cruks API call (that's operator-side
 *   PII handling and out of slot-template scope). It does NOT enforce
 *   the cool-off period itself (that's regulator-side via Cruks). It
 *   only INFORMS downstream consumers that the obligation applies, so
 *   they refuse to dispatch a spin until clear-flags are set.
 *
 * GDD knobs (under `model.netherlandsComplianceGate`)
 *   • enabled       bool   (default false — opt-in or auto when NL)
 *   • jurisdiction  string (3-key precedence)
 *   • coolOffHours  int    (default 24, bounds [1, 8760])
 */

export const NL_COOL_OFF_HOURS_DEFAULT = 24;
export const NL_COOL_OFF_HOURS_BOUNDS = Object.freeze([1, 8760]); /* 1h .. 1 year */

const KSA_JURISDICTIONS = Object.freeze(['NL']);

const DEFAULTS = Object.freeze({
  enabled:      false,
  jurisdiction: null,
  coolOffHours: NL_COOL_OFF_HOURS_DEFAULT,
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
  const src = (model && model.netherlandsComplianceGate) || {};

  /* 3-key jurisdiction precedence (mirror W57.A4 / J-UKGC / J-AGCO / J-SE / J-DE) */
  let jurisdiction = null;
  if (model && model.regulator && typeof model.regulator.profile === 'string') {
    jurisdiction = model.regulator.profile.toUpperCase();
  }
  if (!jurisdiction && model && model.responsibleGambling && typeof model.responsibleGambling.jurisdiction === 'string') {
    jurisdiction = model.responsibleGambling.jurisdiction.toUpperCase();
  }
  if (!jurisdiction && typeof src.jurisdiction === 'string') {
    jurisdiction = src.jurisdiction.toUpperCase();
  }
  cfg.jurisdiction = jurisdiction;

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && KSA_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  const hrs = clampInt(src.coolOffHours, NL_COOL_OFF_HOURS_BOUNDS[0], NL_COOL_OFF_HOURS_BOUNDS[1]);
  if (hrs !== null) cfg.coolOffHours = hrs;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitNetherlandsComplianceGateCSS(_cfg) {
  /* Operator-side renders the Cruks login interstitial; this block has
   * no visual surface. Returning '' keeps the orchestrator clean. */
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitNetherlandsComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const coolOffHours = c.coolOffHours;

  return `
/* netherlandsComplianceGate runtime — §31 Cruks + §33 cool-off */
(function netherlandsComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var COOL_OFF_HOURS = ${coolOffHours};

  if (typeof window === 'undefined') return;

  /* §31 — Set the window-level Cruks-check obligation flag. Operator
   * session-init layer flips __NL_CRUKS_CHECK_PASSED__ after back-end
   * verification. Spin dispatcher checks both flags before allowing
   * the first spin of a session. */
  window.__NL_CRUKS_CHECK_REQUIRED__ = true;
  if (typeof window.__NL_CRUKS_CHECK_PASSED__ === 'undefined') {
    window.__NL_CRUKS_CHECK_PASSED__ = false;
  }
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    try {
      window.HookBus.emit('onCruksCheckRequired', {
        jurisdiction: JURISDICTION,
        rule: 'NL-WetKSA-§31',
      });
    } catch (_) {}
  }

  /* §33 — Cool-off period enforcement floor. Cross-operator enforcement
   * is regulator-side via Cruks; this block exposes the local minimum
   * cool-off hours for downstream RG blocks (sessionTimeout, realityCheck)
   * to respect if the player triggers a session pause. */
  window.__NL_COOL_OFF_HOURS__ = COOL_OFF_HOURS;
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    try {
      window.HookBus.emit('onCoolOffEnforced', {
        jurisdiction: JURISDICTION,
        coolOffHours: COOL_OFF_HOURS,
        rule: 'NL-WetKSA-§33',
      });
    } catch (_) {}
  }
})();
`;
}
