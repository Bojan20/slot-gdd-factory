/**
 * src/blocks/belgiumComplianceGate.mjs
 *
 * W60.J-BE (Wave F7 / HX4) — Belgian Gaming Commission (BGC / KSC) gate.
 *
 * Loi du 7 mai 1999 sur les jeux de hasard + Arrêté royal du 25/10/2018 —
 * Belgium runs one of Europe's strictest age/identity verification regimes
 * and bans bonus games for minors with depth.
 *
 *   AR 25/10/2018 Art.4 — EPIS register check
 *     Operator must verify the player is not enrolled in EPIS (Excluded
 *     Persons Information System) before the first spin. Block sets
 *     `__BE_EPIS_CHECK_REQUIRED__`.
 *
 *   AR 25/10/2018 Art.8 — Weekly deposit cap for under-21
 *     Players aged 18-20 are capped at 200 EUR weekly deposits without
 *     opt-up enabled. Block sets `__BE_UNDER21_WEEKLY_CAP_EUR__ = 200`.
 *
 *   AR 25/10/2018 Art.12 — Mandatory cooling-off
 *     Player can trigger a cooling-off (24 h / 1 wk / 1 mo / permanent).
 *     Block sets `__BE_COOLING_OFF_REQUIRED__`.
 *
 *   AR 25/10/2018 Art.16 — Spin pace floor
 *     Minimum 2,500 ms per spin per BGC guideline 2023.
 *
 *   AR 25/10/2018 Art.18 — Loss display in EUR
 *     Net loss must be shown in EUR (no virtual currency obfuscation).
 *
 * HookBus events (sole emitter):
 *   onBeEpisCheckRequired, onBeUnder21CapEnforced, onBeCoolingOffRequired,
 *   onBeMinSpinPaceEnforced, onBeLossDisplayRequired
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const BE_MIN_SPIN_MS_DEFAULT = 2500;
export const BE_MIN_SPIN_MS_BOUNDS  = Object.freeze([1000, 30000]);
export const BE_UNDER21_CAP_EUR_DEFAULT = 200;

const BGC_JURISDICTIONS = Object.freeze(['BE', 'BGC', 'BE-BGC']);

const DEFAULTS = Object.freeze({
  enabled: false, jurisdiction: null,
  minSpinMs: BE_MIN_SPIN_MS_DEFAULT,
  under21WeeklyCapEur: BE_UNDER21_CAP_EUR_DEFAULT,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.belgiumComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'belgiumComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && BGC_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, BE_MIN_SPIN_MS_BOUNDS[0], BE_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  return cfg;
}

export function emitBelgiumComplianceGateCSS(_cfg) { return ''; }

export function emitBelgiumComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'BE');
  return `
/* belgiumComplianceGate runtime — BGC AR 25/10/2018 + Loi 7/5/1999 */
(function belgiumComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  var U21_CAP_EUR  = ${c.under21WeeklyCapEur};
  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  /* Art.4 — EPIS check */
  window.__BE_EPIS_CHECK_REQUIRED__ = true;
  if (typeof window.__BE_EPIS_CHECK_PASSED__ === 'undefined') window.__BE_EPIS_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onBeEpisCheckRequired', { jurisdiction: JURISDICTION, rule: 'BE-AR-25.10.2018-Art.4' }); } catch (_) {} }

  /* Art.8 — under-21 weekly cap */
  window.__BE_UNDER21_WEEKLY_CAP_EUR__ = U21_CAP_EUR;
  if (_hasBus()) { try { window.HookBus.emit('onBeUnder21CapEnforced', { jurisdiction: JURISDICTION, capEur: U21_CAP_EUR, rule: 'BE-AR-25.10.2018-Art.8' }); } catch (_) {} }

  /* Art.12 — cooling-off */
  window.__BE_COOLING_OFF_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onBeCoolingOffRequired', { jurisdiction: JURISDICTION, rule: 'BE-AR-25.10.2018-Art.12' }); } catch (_) {} }

  /* Art.16 — spin pace */
  window.__BE_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onBeMinSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'BE-AR-25.10.2018-Art.16' }); } catch (_) {} }

  /* Art.18 — EUR loss display */
  window.__BE_LOSS_DISPLAY_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onBeLossDisplayRequired', { jurisdiction: JURISDICTION, rule: 'BE-AR-25.10.2018-Art.18' }); } catch (_) {} }
})();
`;
}
