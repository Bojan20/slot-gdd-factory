/**
 * src/blocks/denmarkComplianceGate.mjs
 *
 * W60.J-DK (Wave F7 / HX3) — Denmark Spillemyndigheden (DGA) compliance gate.
 *
 * Bekendtgørelse om online kasino (BEK nr 727 af 25/06/2010) +
 * Spillemyndighedens vejledning — Danish regulator's slot rules.
 *
 *   §44 — Reality check every 30 min
 *     More aggressive than the UK 60-min floor. Block sets
 *     `window.__DK_REALITY_CHECK_MS__ = 30 * 60 * 1000`.
 *
 *   §32 — Mandatory hard loss limit
 *     Player must set a session loss limit before first wager. Block
 *     sets `__DK_LOSS_LIMIT_REQUIRED__`.
 *
 *   §29 — ROFUS self-exclusion check
 *     Operator must verify the player is not on rofus.dk register before
 *     the first spin. Block sets `__DK_ROFUS_CHECK_REQUIRED__`.
 *
 *   §41 — Spin pace floor
 *     Minimum 2,000 ms per spin per Spillemyndigheden guideline 2022.
 *     Block sets `__DK_MIN_SPIN_MS__ = 2000`.
 *
 *   §40 — Win/loss notification each 30 min
 *     Cumulative wins + losses must be surfaced periodically. Mirrors
 *     reality check threshold.
 *
 * HookBus events (sole emitter):
 *   onDkRealityCheckEnforced, onDkLossLimitRequired,
 *   onDkRofusCheckRequired, onDkMinSpinPaceEnforced
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const DK_MIN_SPIN_MS_DEFAULT = 2000;
export const DK_MIN_SPIN_MS_BOUNDS  = Object.freeze([1000, 30000]);
export const DK_RC_DEFAULT          = 30 * 60 * 1000;
export const DK_RC_BOUNDS           = Object.freeze([600000, 3600000]);

const DGA_JURISDICTIONS = Object.freeze(['DK', 'DGA', 'DK-SPM']);

const DEFAULTS = Object.freeze({
  enabled: false, jurisdiction: null,
  minSpinMs: DK_MIN_SPIN_MS_DEFAULT,
  realityCheckMs: DK_RC_DEFAULT,
});

export function defaultConfig() { return Object.freeze({ ...DEFAULTS }); }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.denmarkComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'denmarkComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && DGA_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, DK_MIN_SPIN_MS_BOUNDS[0], DK_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  const rc = clampInt(src.realityCheckMs, DK_RC_BOUNDS[0], DK_RC_BOUNDS[1]);
  if (rc !== null) cfg.realityCheckMs = rc;
  return cfg;
}

export function emitDenmarkComplianceGateCSS(_cfg) { return ''; }

export function emitDenmarkComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'DK');
  return `
/* denmarkComplianceGate runtime — Spillemyndigheden BEK 727/2010 */
(function denmarkComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  var RC_INTERVAL  = ${c.realityCheckMs};
  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  window.__DK_REALITY_CHECK_MS__ = RC_INTERVAL;
  if (_hasBus()) { try { window.HookBus.emit('onDkRealityCheckEnforced', { jurisdiction: JURISDICTION, intervalMs: RC_INTERVAL, rule: 'DK-BEK-727-§44' }); } catch (_) {} }

  window.__DK_LOSS_LIMIT_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onDkLossLimitRequired', { jurisdiction: JURISDICTION, rule: 'DK-BEK-727-§32' }); } catch (_) {} }

  window.__DK_ROFUS_CHECK_REQUIRED__ = true;
  if (typeof window.__DK_ROFUS_CHECK_PASSED__ === 'undefined') window.__DK_ROFUS_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onDkRofusCheckRequired', { jurisdiction: JURISDICTION, rule: 'DK-BEK-727-§29' }); } catch (_) {} }

  window.__DK_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onDkMinSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'DK-BEK-727-§41' }); } catch (_) {} }
})();
`;
}
