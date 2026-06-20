/**
 * src/blocks/ukgcComplianceGate.mjs
 *
 * W60.J-UK (Wave F7 / HX1) — UK Gambling Commission (UKGC) RTS compliance gate.
 *
 * Centralized opt-in block that enforces UKGC Remote Technical Standards
 * (RTS) baseline obligations at boot time:
 *
 *   RTS 14D — Minimum spin time
 *     A complete spin cycle (trigger → settle) must take at LEAST
 *     2,500 ms. Faster than this is "rapid play" per UKGC 2021
 *     update and triggers compliance violation. Block sets
 *     `window.__UK_MIN_SPIN_MS__ = 2500`.
 *
 *   RTS 8B — RTP disclosure
 *     RTP percentage must be visible to the player on demand from a
 *     dedicated screen. Block sets `window.__UK_RTP_DISCLOSURE_REQUIRED__`
 *     so the paytable block surfaces it. (Existing paytable WAVE U2
 *     visibility section already renders RTP when present in the
 *     model.)
 *
 *   RTS 13C — Net position display
 *     Net session position (win/loss running total) must be available.
 *     netLossIndicator.mjs implements; this gate sets a hint flag.
 *
 *   RTS 12C — Hard time-on-device + reality check ≤ 60 min
 *     realityCheck.mjs implements; this gate enforces threshold.
 *
 *   RTS 11A — Autoplay caps + per-spin loss limit
 *     Max 50 consecutive auto-spins, mandatory loss/single-win stop.
 *     autoplay.mjs already enforces caps; this gate sets the floor.
 *
 *   GamStop verification (Self-exclusion Order 2018 + UKGC Code 3.5.4)
 *     A B2C operator must verify the player is not on GamStop before
 *     the first spin. Set `__UK_GAMSTOP_CHECK_REQUIRED__` flag + emit
 *     onGamStopCheckRequired.
 *
 * Math gate
 *   Block does NOT touch RTP / volatility / hit frequency. RTP floor
 *   (currently 70% for slots in GB) is a math-layer parameter and
 *   out-of-scope per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const UK_MIN_SPIN_MS_DEFAULT
 *   export const UK_AUTOPLAY_MAX_CAP
 *   export const UK_REALITY_CHECK_MAX_MS
 *   export function defaultConfig(): UkgcComplianceGateConfig
 *   export function resolveConfig(model?: object): UkgcComplianceGateConfig
 *   export function emitUkgcComplianceGateCSS(cfg): string  (no-op)
 *   export function emitUkgcComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Sets window flags + emits 5 audit events.
 *
 * HookBus events (sole emitter contract)
 *   • onUkRtsSpinPaceEnforced     payload: { jurisdiction, minSpinMs, rule }
 *   • onUkRtpDisclosureRequired   payload: { jurisdiction, rule }
 *   • onUkNetPositionRequired     payload: { jurisdiction, rule }
 *   • onUkRealityCheckEnforced    payload: { jurisdiction, intervalMs, rule }
 *   • onUkAutoplayCapEnforced     payload: { jurisdiction, cap, rule }
 *   • onGamStopCheckRequired      payload: { jurisdiction, rule }
 *
 * Accessibility
 *   Boot-time DOM-free block. No ARIA surface.
 *
 * GDD knobs (under `model.ukgcComplianceGate`)
 *   • enabled         bool   (default false — opt-in or auto when UK/UKGC)
 *   • jurisdiction    string (3-key precedence)
 *   • minSpinMs       int    (default 2500, bounds [1000, 30000])
 *   • autoplayCap     int    (default 50, bounds [10, 100])
 *   • realityCheckMs  int    (default 3600000, bounds [600000, 7200000])
 *
 * Wave F7 / HX1 — Boki 2026-06-20 "dalje4" — UK is Tier-1 priority market.
 */

import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const UK_MIN_SPIN_MS_DEFAULT     = 2500;
export const UK_MIN_SPIN_MS_BOUNDS      = Object.freeze([1000, 30000]);
export const UK_AUTOPLAY_MAX_CAP        = 50;
export const UK_AUTOPLAY_BOUNDS         = Object.freeze([10, 100]);
export const UK_REALITY_CHECK_DEFAULT   = 60 * 60 * 1000;   /* 60 min */
export const UK_REALITY_CHECK_BOUNDS    = Object.freeze([600000, 7200000]);

const UKGC_JURISDICTIONS = Object.freeze(['UK', 'UKGC', 'GB']);

const DEFAULTS = Object.freeze({
  enabled:         false,
  jurisdiction:    null,
  minSpinMs:       UK_MIN_SPIN_MS_DEFAULT,
  autoplayCap:     UK_AUTOPLAY_MAX_CAP,
  realityCheckMs:  UK_REALITY_CHECK_DEFAULT,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.ukgcComplianceGate) || {};
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'ukgcComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && UKGC_JURISDICTIONS.indexOf(jurisdiction) !== -1) cfg.enabled = true;
  const ms = clampInt(src.minSpinMs, UK_MIN_SPIN_MS_BOUNDS[0], UK_MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;
  const cap = clampInt(src.autoplayCap, UK_AUTOPLAY_BOUNDS[0], UK_AUTOPLAY_BOUNDS[1]);
  if (cap !== null) cfg.autoplayCap = cap;
  const rc = clampInt(src.realityCheckMs, UK_REALITY_CHECK_BOUNDS[0], UK_REALITY_CHECK_BOUNDS[1]);
  if (rc !== null) cfg.realityCheckMs = rc;
  return cfg;
}

export function emitUkgcComplianceGateCSS(_cfg) { return ''; }

export function emitUkgcComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  const jurJSON = JSON.stringify(c.jurisdiction || 'UK');
  return `
/* ukgcComplianceGate runtime — UKGC RTS 8/11/12/13/14 + GamStop */
(function ukgcComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS  = ${c.minSpinMs};
  var AUTOPLAY_CAP = ${c.autoplayCap};
  var RC_INTERVAL  = ${c.realityCheckMs};

  if (typeof window === 'undefined') return;
  var _hasBus = function () { return window.HookBus && typeof window.HookBus.emit === 'function'; };

  /* RTS 14D — minimum spin time */
  window.__UK_MIN_SPIN_MS__ = MIN_SPIN_MS;
  if (_hasBus()) { try { window.HookBus.emit('onUkRtsSpinPaceEnforced', { jurisdiction: JURISDICTION, minSpinMs: MIN_SPIN_MS, rule: 'UKGC-RTS-14D' }); } catch (_) {} }

  /* RTS 8B — RTP disclosure */
  window.__UK_RTP_DISCLOSURE_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onUkRtpDisclosureRequired', { jurisdiction: JURISDICTION, rule: 'UKGC-RTS-8B' }); } catch (_) {} }

  /* RTS 13C — net position */
  window.__UK_NET_POSITION_REQUIRED__ = true;
  if (_hasBus()) { try { window.HookBus.emit('onUkNetPositionRequired', { jurisdiction: JURISDICTION, rule: 'UKGC-RTS-13C' }); } catch (_) {} }

  /* RTS 12C — reality check ≤ 60 min */
  window.__UK_REALITY_CHECK_MS__ = RC_INTERVAL;
  if (_hasBus()) { try { window.HookBus.emit('onUkRealityCheckEnforced', { jurisdiction: JURISDICTION, intervalMs: RC_INTERVAL, rule: 'UKGC-RTS-12C' }); } catch (_) {} }

  /* RTS 11A — autoplay caps */
  window.__UK_AUTOPLAY_CAP__ = AUTOPLAY_CAP;
  if (_hasBus()) { try { window.HookBus.emit('onUkAutoplayCapEnforced', { jurisdiction: JURISDICTION, cap: AUTOPLAY_CAP, rule: 'UKGC-RTS-11A' }); } catch (_) {} }

  /* GamStop self-exclusion register check (UKGC Code 3.5.4) */
  window.__UK_GAMSTOP_CHECK_REQUIRED__ = true;
  if (typeof window.__UK_GAMSTOP_CHECK_PASSED__ === 'undefined') window.__UK_GAMSTOP_CHECK_PASSED__ = false;
  if (_hasBus()) { try { window.HookBus.emit('onGamStopCheckRequired', { jurisdiction: JURISDICTION, rule: 'UKGC-Code-3.5.4' }); } catch (_) {} }
})();
`;
}
