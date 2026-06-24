/**
 * src/blocks/swedenComplianceGate.mjs
 *
 * W60.J-SE (Wave F7 / HX2) — Sweden Spelinspektionen (SGA) compliance gate.
 *
 * Spel om pengar — Spellagen (SFS 2018:1138) + Spelinspektionens
 * föreskrifter — Sweden's regulator runs one of the strictest player
 * protection regimes in the EU.
 *
 *   Spellag 14 kap §6 — Spin pace floor
 *     Minimum 3,000 ms per spin cycle, mirroring ANJ but capped per SGA
 *     2023 directive on rapid play. Block sets `window.__SE_MIN_SPIN_MS__`.
 *
 *   Spellag 14 kap §1 — No autoplay
 *     Autoplay forbidden by 2019 amendment. Block sets
 *     `window.__SE_AUTOPLAY_BANNED__ = true`.
 *
 *   Spellag 14 kap §7 — Deposit limit mandatory
 *     Player must set daily / weekly / monthly deposit limits BEFORE
 *     first wager. Block sets `__SE_DEPOSIT_LIMIT_REQUIRED__`.
 *
 *   Spellag 14 kap §11 — Spelpaus self-exclusion check
 *     Operator must verify the player is not enrolled in spelpaus.se
 *     before the first spin. Block sets `__SE_SPELPAUS_CHECK_REQUIRED__`.
 *
 *   Spellag 14 kap §13 — No bonus offers without consent
 *     Welcome bonus / cash-back / free spins offers may only be displayed
 *     after explicit player opt-in. Block sets `__SE_BONUS_CONSENT_REQUIRED__`.
 *
 * Math gate
 *   Block does not touch RTP. RTP floor (currently 85% for slots in SE) is
 *   math-layer, out-of-scope per rule_no_math_unless_asked.
 *
 * Public API: defaultConfig / resolveConfig / emitSwedenComplianceGateCSS /
 *             emitSwedenComplianceGateRuntime
 *
 * HookBus events (sole emitter):
 *   onSeMinSpinPaceEnforced, onAutoplayBanned, onSeDepositLimitRequired,
 *   onSeSpelpausCheckRequired, onSeBonusConsentRequired
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const SE_MIN_SPIN_MS_DEFAULT = 3000;
export const SE_MIN_SPIN_MS_BOUNDS  = Object.freeze([1000, 30000]);

const SGA_JURISDICTIONS = Object.freeze(['SE', 'SGA', 'SE-SGA']);

const DEFAULTS = Object.freeze({ enabled: false, jurisdiction: null, minSpinMs: SE_MIN_SPIN_MS_DEFAULT });

export function defaultConfig() { return Object.freeze({ ...DEFAULTS }); }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.swedenComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'swedenComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && SGA_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, SE_MIN_SPIN_MS_BOUNDS[0], SE_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  return cfg;
}

export function emitSwedenComplianceGateCSS(_cfg) { return ''; }

export function emitSwedenComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'SE');
  return `
/* swedenComplianceGate runtime — SGA Spellagen 2018:1138 */
(function swedenComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  /* Spellag 14 kap §6 — spin pace */
  window.__SE_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onSeMinSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'SE-Spellag-14k-§6' }); } catch (_) {} }

  /* Spellag 14 kap §1 — no autoplay */
  window.__SE_AUTOPLAY_BANNED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onAutoplayBanned', { jurisdiction: JURISDICTION, rule: 'SE-Spellag-14k-§1' }); } catch (_) {} }

  /* Spellag 14 kap §7 — mandatory deposit limit */
  window.__SE_DEPOSIT_LIMIT_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onSeDepositLimitRequired', { jurisdiction: JURISDICTION, rule: 'SE-Spellag-14k-§7' }); } catch (_) {} }

  /* Spellag 14 kap §11 — Spelpaus self-exclusion */
  window.__SE_SPELPAUS_CHECK_REQUIRED__ = true;
  if (typeof window.__SE_SPELPAUS_CHECK_PASSED__ === 'undefined') window.__SE_SPELPAUS_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onSeSpelpausCheckRequired', { jurisdiction: JURISDICTION, rule: 'SE-Spellag-14k-§11' }); } catch (_) {} }

  /* Spellag 14 kap §13 — bonus consent */
  window.__SE_BONUS_CONSENT_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onSeBonusConsentRequired', { jurisdiction: JURISDICTION, rule: 'SE-Spellag-14k-§13' }); } catch (_) {} }
})();
`;
}
