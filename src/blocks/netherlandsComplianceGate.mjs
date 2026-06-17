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
 *     W58.J-NL.3 dopuna: persistent local cool-off lifecycle. The
 *     block exposes an idempotent helper `window.startNlCoolOff(hours)`
 *     that operator session-init / sessionTimeout / realityCheck can
 *     call to start a local cool-off — the deadline is written to
 *     localStorage `__NL_COOL_OFF_UNTIL__` (ms epoch) and survives
 *     page reload. At boot the gate checks the persisted deadline:
 *       • If now < deadline → window.__NL_COOL_OFF_ACTIVE__ = true,
 *         fire onCoolOffPeriodActive { jurisdiction, remainingMs }.
 *         Spin dispatcher consumes the flag to refuse first spin.
 *       • If now >= deadline → remove the key, fire
 *         onCoolOffPeriodExpired { jurisdiction } so cert-harness
 *         records the auto-clear. Cross-operator enforcement still
 *         lives at Cruks; this only makes single-operator persistence
 *         honest.
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
 *   • onCoolOffPeriodActive  payload: { jurisdiction, remainingMs, rule } (W58.J-NL.3)
 *   • onCoolOffPeriodExpired payload: { jurisdiction, rule } (W58.J-NL.3)
 *   • onCoolOffPeriodStarted payload: { jurisdiction, hours, rule } (W58.J-NL.3)
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

/* W59.H1 — Central jurisdiction precedence resolver. */
import { resolveJurisdiction } from './jurisdictionGate.mjs';

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

  /* W59.H1 — Central jurisdiction precedence resolver. Same semantics:
   * regulator.profile > RG > netherlandsComplianceGate.jurisdiction. */
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'netherlandsComplianceGate.jurisdiction' });
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

  /* W58.J-NL.3 — Persistent local cool-off lifecycle.
   *
   * On boot we read localStorage __NL_COOL_OFF_UNTIL__ (ms epoch). If
   * the deadline lies in the future we set window.__NL_COOL_OFF_ACTIVE__
   * and fire onCoolOffPeriodActive so downstream spin dispatcher can
   * refuse first-spin. If the deadline is in the past we remove the key
   * and fire onCoolOffPeriodExpired so cert-harness records the auto-
   * clear. localStorage may throw in private mode → silent try/catch.
   *
   * window.startNlCoolOff(hours) is an idempotent helper that operator
   * session-init / sessionTimeout / realityCheck can call when the
   * player opts into a session pause. It writes the deadline to
   * localStorage + sets the active flag + fires onCoolOffPeriodStarted.
   * Cross-operator enforcement still lives at Cruks; this only makes
   * single-operator persistence honest. */
  var COOL_OFF_KEY = '__NL_COOL_OFF_UNTIL__';
  var _coolOffRead = function () {
    try {
      var raw = window.localStorage.getItem(COOL_OFF_KEY);
      if (typeof raw !== 'string' || raw.length === 0) return 0;
      var n = parseInt(raw, 10);
      return (isFinite(n) && n > 0) ? n : 0;
    } catch (_) { return 0; }
  };
  var _coolOffWrite = function (untilMs) {
    try {
      window.localStorage.setItem(COOL_OFF_KEY, String(untilMs));
      return true;
    } catch (_) { return false; }
  };
  var _coolOffClear = function () {
    try { window.localStorage.removeItem(COOL_OFF_KEY); } catch (_) {}
  };
  var _coolOffHasBus = function () {
    return window.HookBus && typeof window.HookBus.emit === 'function';
  };
  /* Boot-time evaluation. */
  var _persistedUntil = _coolOffRead();
  if (_persistedUntil > 0) {
    var _now = Date.now();
    if (_now < _persistedUntil) {
      window.__NL_COOL_OFF_ACTIVE__ = true;
      if (_coolOffHasBus()) {
        try {
          window.HookBus.emit('onCoolOffPeriodActive', {
            jurisdiction: JURISDICTION,
            remainingMs: _persistedUntil - _now,
            rule: 'NL-WetKSA-§33',
          });
        } catch (_) {}
      }
    } else {
      _coolOffClear();
      if (_coolOffHasBus()) {
        try {
          window.HookBus.emit('onCoolOffPeriodExpired', {
            jurisdiction: JURISDICTION,
            rule: 'NL-WetKSA-§33',
          });
        } catch (_) {}
      }
    }
  }
  /* Public helper. Idempotent: re-calling with a larger window extends
   * the deadline; calling with a smaller value never SHORTENS an
   * existing active cool-off (regulator default). Returns true on
   * write success, false on localStorage failure (private mode). */
  window.startNlCoolOff = function (hours) {
    var hrs = parseFloat(hours);
    if (!isFinite(hrs) || hrs <= 0) hrs = COOL_OFF_HOURS;
    var untilMs = Date.now() + Math.floor(hrs * 3600 * 1000);
    var existing = _coolOffRead();
    if (existing > untilMs) untilMs = existing; /* never shrink */
    var ok = _coolOffWrite(untilMs);
    if (ok) {
      window.__NL_COOL_OFF_ACTIVE__ = true;
      if (_coolOffHasBus()) {
        try {
          window.HookBus.emit('onCoolOffPeriodStarted', {
            jurisdiction: JURISDICTION,
            hours: hrs,
            rule: 'NL-WetKSA-§33',
          });
        } catch (_) {}
      }
    }
    return ok;
  };
})();
`;
}
