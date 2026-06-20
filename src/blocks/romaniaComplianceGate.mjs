/**
 * src/blocks/romaniaComplianceGate.mjs
 *
 * W60.J-RO (Wave F7 / HX6) — Romanian ONJN (Oficiul Naţional pentru
 * Jocuri de Noroc) compliance gate.
 *
 * OUG 77/2009 + Regulament ONJN — emerging EU market with rapid 2023
 * tightening on slots: 6% gross gaming revenue tax + mandatory daily
 * limits + tax-disclosure-on-win rules.
 *
 *   OUG 77/2009 Art.10 — Win tax disclosure
 *     Wins above 1,000 RON trigger a 10% tax that must be disclosed on
 *     the win confirmation. Block sets `__RO_WIN_TAX_PCT__ = 10` +
 *     `__RO_WIN_TAX_THRESHOLD_RON__ = 1000`.
 *
 *   ONJN Reg.2023/IX Art.5 — Mandatory daily/weekly/monthly limits
 *     Player must set deposit + loss limits before first wager. Block
 *     sets `__RO_LIMITS_REQUIRED__`.
 *
 *   OSAJ (Oficiul Statului de Auto-excludere a Jucătorilor) — self-exclusion
 *     Operator must verify the player is not on the OSAJ register.
 *
 *   OUG 77/2009 Art.13 — Spin pace floor
 *     Minimum 2,500 ms per spin per ONJN 2023 directive.
 *
 *   OUG 77/2009 Art.15 — Tax receipt on big win
 *     Win above 100,000 RON triggers mandatory printed tax receipt
 *     (operator side); slot must surface __RO_HANDPAY_THRESHOLD_RON__.
 *
 * HookBus events (sole emitter):
 *   onRoWinTaxDisclosureEnforced, onRoLimitsRequired, onRoOsajCheckRequired,
 *   onRoMinSpinPaceEnforced, onRoHandpayThresholdEnforced
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const RO_MIN_SPIN_MS_DEFAULT  = 2500;
export const RO_MIN_SPIN_MS_BOUNDS   = Object.freeze([1000, 30000]);
export const RO_WIN_TAX_PCT_DEFAULT  = 10;
export const RO_WIN_TAX_THRESHOLD    = 1000;
export const RO_HANDPAY_RON_DEFAULT  = 100000;

const ONJN_JURISDICTIONS = Object.freeze(['RO', 'ONJN', 'RO-ONJN']);

const DEFAULTS = Object.freeze({
  enabled: false, jurisdiction: null,
  minSpinMs: RO_MIN_SPIN_MS_DEFAULT,
  winTaxPct: RO_WIN_TAX_PCT_DEFAULT,
  winTaxThresholdRon: RO_WIN_TAX_THRESHOLD,
  handpayThresholdRon: RO_HANDPAY_RON_DEFAULT,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.romaniaComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'romaniaComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && ONJN_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, RO_MIN_SPIN_MS_BOUNDS[0], RO_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  return cfg;
}

export function emitRomaniaComplianceGateCSS(_cfg) { return ''; }

export function emitRomaniaComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'RO');
  return `
/* romaniaComplianceGate runtime — ONJN OUG 77/2009 + Reg 2023/IX */
(function romaniaComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  var TAX_PCT      = ${c.winTaxPct};
  var TAX_THRESHOLD_RON = ${c.winTaxThresholdRon};
  var HANDPAY_RON  = ${c.handpayThresholdRon};
  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  window.__RO_WIN_TAX_PCT__ = TAX_PCT;
  window.__RO_WIN_TAX_THRESHOLD_RON__ = TAX_THRESHOLD_RON;
  if (_hasBus()) { try { window.HookBus.emit('onRoWinTaxDisclosureEnforced', { jurisdiction: JURISDICTION, taxPct: TAX_PCT, thresholdRon: TAX_THRESHOLD_RON, rule: 'RO-OUG-77.2009-Art.10' }); } catch (_) {} }

  window.__RO_LIMITS_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onRoLimitsRequired', { jurisdiction: JURISDICTION, rule: 'RO-Reg-2023.IX-Art.5' }); } catch (_) {} }

  window.__RO_OSAJ_CHECK_REQUIRED__ = true;
  if (typeof window.__RO_OSAJ_CHECK_PASSED__ === 'undefined') window.__RO_OSAJ_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onRoOsajCheckRequired', { jurisdiction: JURISDICTION, rule: 'RO-OSAJ-Register' }); } catch (_) {} }

  window.__RO_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onRoMinSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'RO-OUG-77.2009-Art.13' }); } catch (_) {} }

  window.__RO_HANDPAY_THRESHOLD_RON__ = HANDPAY_RON;
  if (_hasBus()) { try { window.HookBus.emit('onRoHandpayThresholdEnforced', { jurisdiction: JURISDICTION, thresholdRon: HANDPAY_RON, rule: 'RO-OUG-77.2009-Art.15' }); } catch (_) {} }
})();
`;
}
