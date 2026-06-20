/**
 * src/blocks/switzerlandComplianceGate.mjs
 *
 * W60.J-CH (Wave F7 / HX5) — Swiss ESBK (Eidgenössische Spielbankenkommission)
 * + Comlot compliance gate.
 *
 * Bundesgesetz über Geldspiele (BGS, SR 935.51) + Verordnung über Geldspiele
 * (VGS) — Switzerland blocks all non-whitelisted operators at the ISP level
 * and runs aggressive responsible-gambling baselines.
 *
 *   BGS Art.86 — Whitelisted-operator check
 *     Player session may only proceed if the operator is on ESBK's
 *     whitelist. Block sets `__CH_WHITELIST_REQUIRED__` so back-end
 *     verifies the operator GUID before first wager.
 *
 *   VGS Art.79 — Reality check every 30 min
 *     Mirrors DK frequency but with Swiss-specific opt-out semantics.
 *
 *   VGS Art.81 — Aggregate session-loss display
 *     Player must see net session loss in CHF on every reality check.
 *
 *   BGS Art.80 — Spin pace floor
 *     Minimum 2,500 ms per spin per ESBK 2022 guideline.
 *
 *   BGS Art.85 — Cantonal restrictions
 *     Some cantons block certain mechanics (e.g. Bonus Buy in Geneva).
 *     Block surfaces `__CH_CANTON_RESTRICTION__` so operator UI filters.
 *
 *   BGS Art.83 — Self-exclusion register (Spielbankensperrregister)
 *     Operator must check the federal self-exclusion register before
 *     first spin.
 *
 * HookBus events (sole emitter):
 *   onChWhitelistRequired, onChRealityCheckEnforced, onChLossDisplayRequired,
 *   onChMinSpinPaceEnforced, onChCantonRestrictionEnforced,
 *   onChSelfExclusionCheckRequired
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const CH_MIN_SPIN_MS_DEFAULT = 2500;
export const CH_MIN_SPIN_MS_BOUNDS  = Object.freeze([1000, 30000]);
export const CH_RC_DEFAULT          = 30 * 60 * 1000;
export const CH_RC_BOUNDS           = Object.freeze([600000, 3600000]);

const ESBK_JURISDICTIONS = Object.freeze(['CH', 'ESBK', 'CH-ESBK', 'COMLOT']);

const DEFAULTS = Object.freeze({
  enabled: false, jurisdiction: null,
  minSpinMs: CH_MIN_SPIN_MS_DEFAULT,
  realityCheckMs: CH_RC_DEFAULT,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.switzerlandComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'switzerlandComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && ESBK_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, CH_MIN_SPIN_MS_BOUNDS[0], CH_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  const rc = clampInt(src.realityCheckMs, CH_RC_BOUNDS[0], CH_RC_BOUNDS[1]);
  if (rc !== null) cfg.realityCheckMs = rc;
  return cfg;
}

export function emitSwitzerlandComplianceGateCSS(_cfg) { return ''; }

export function emitSwitzerlandComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'CH');
  return `
/* switzerlandComplianceGate runtime — ESBK BGS SR 935.51 + VGS */
(function switzerlandComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  var RC_INTERVAL  = ${c.realityCheckMs};
  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  window.__CH_WHITELIST_REQUIRED__ = true;
  if (typeof window.__CH_WHITELIST_PASSED__ === 'undefined') window.__CH_WHITELIST_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onChWhitelistRequired', { jurisdiction: JURISDICTION, rule: 'CH-BGS-Art.86' }); } catch (_) {} }

  window.__CH_REALITY_CHECK_MS__ = RC_INTERVAL;
  if (_hasBus()) { try { window.HookBus.emit('onChRealityCheckEnforced', { jurisdiction: JURISDICTION, intervalMs: RC_INTERVAL, rule: 'CH-VGS-Art.79' }); } catch (_) {} }

  window.__CH_LOSS_DISPLAY_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onChLossDisplayRequired', { jurisdiction: JURISDICTION, rule: 'CH-VGS-Art.81' }); } catch (_) {} }

  window.__CH_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onChMinSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'CH-BGS-Art.80' }); } catch (_) {} }

  window.__CH_CANTON_RESTRICTION__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onChCantonRestrictionEnforced', { jurisdiction: JURISDICTION, rule: 'CH-BGS-Art.85' }); } catch (_) {} }

  window.__CH_SELF_EXCLUSION_CHECK_REQUIRED__ = true;
  if (typeof window.__CH_SELF_EXCLUSION_CHECK_PASSED__ === 'undefined') window.__CH_SELF_EXCLUSION_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onChSelfExclusionCheckRequired', { jurisdiction: JURISDICTION, rule: 'CH-BGS-Art.83' }); } catch (_) {} }
})();
`;
}
