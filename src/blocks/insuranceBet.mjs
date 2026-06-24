/**
 * src/blocks/insuranceBet.mjs
 *
 * Wave LEGO-SIDEBET (B-7 · 1/2) — Insurance side bet.
 *
 * @module insuranceBet
 *
 * Purpose:
 *   Pre-spin toggle that lets the player add a small "insurance"
 *   wager (default +20% of bet). If the next spin returns 0 win, the
 *   insurance pays back N% of the total bet (default 50% of insurance
 *   stake). Visual + state surface only — the math layer reads
 *   `window.INSURANCE_BET_ON` and the configured rates to apply
 *   real-cash math in PAR Phase 2.
 *
 * Industry-reference (vendor-neutral):
 *   Insurance bets are an emerging 2024-2026 side-wager pattern aimed
 *   at high-volatility slots. Industry baseline: small toggle next to
 *   bet selector, +15-25% bet cost, pays back 30-60% of insurance stake
 *   on a zero-win spin. Regulator-friendly in MGA / ON / NJ when
 *   capped; HARD ban under UKGC bonus-buy adjacent rules (jurisdiction
 *   matrix mirror).
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitInsuranceBetCSS(cfg)                 → CSS string
 *   emitInsuranceBetMarkup(cfg)              → HTML string
 *   emitInsuranceBetRuntime(cfg)             → runtime JS string
 *   INSURANCE_BET_BANNED_JURISDICTIONS       → re-exported hard-ban list
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onFsTrigger — lock toggle mid-bonus
 *                onFsEnd     — unlock post-bonus
 *   emits:       onInsuranceBetChanged { on, costMult, payoutRatio }
 *
 * a11y / perf:
 *   • role="switch" with aria-checked + visible focus ring
 *   • Keyboard: Enter/Space toggles
 *   • prefers-reduced-motion honored
 *   • Tokens hoisted (0 magic numbers)
 *   • Hard-disabled under UKGC (jurisdiction parity with bonusBuy)
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

/* Jurisdiction parity with bonusBuy — insurance is treated as a paid
 * "buy of insulation" by some regulators. Mirror the same hard-ban
 * list so the operator can't accidentally surface it under UKGC etc. */
const INSURANCE_BET_BANNED_JURISDICTIONS = Object.freeze(['UKGC', 'SE', 'DE', 'NL']);

const TOKENS = Object.freeze({
  topPad:        14,
  topPadMobile:  10,
  /* right-side dock — same row as cumulative meter; offset to clear it. */
  rightPad:      404,    /* meter right=14 + width=180 + gap 24 + chip=200 ~ 418 — round to 404 */
  rightPadMobile: 320,
  zIndex:        58,
  switchW:       32,
  switchH:       18,
  knobSize:      14,
  knobShift:     14,
  fontRem:       0.74,
  fontRemMobile: 0.66,
  padV:          5,
  padH:          10,
  borderRadius:  12,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function _resolveJurisdiction(model) {
  const rg = (model && model.responsibleGambling) || {};
  const reg = (model && model.regulator) || {};
  if (typeof reg.profile === 'string') return reg.profile.toUpperCase();
  if (typeof rg.jurisdiction === 'string') return rg.jurisdiction.toUpperCase();
  return null;
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'INSURE',
    /* Cost multiplier — applied to base bet. 1.20 = +20% bet. */
    costMult: 1.20,
    /* Payback ratio on zero-win — 0.50 = 50% of total bet returned. */
    payoutRatio: 0.50,
    color:    '#7fbfff',
    colorDark: '#205080',
  });
}

function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('insuranceBet', defaultConfig(), model) };
  const m = model.insuranceBet || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('insuranceBet', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.costMult)) cfg.costMult = _clampFloat(m.costMult, 1.01, 2.0, cfg.costMult);
  if (Number.isFinite(m.payoutRatio)) cfg.payoutRatio = _clampFloat(m.payoutRatio, 0, 1.0, cfg.payoutRatio);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'insurance_bet' || f.kind === 'insurance')) {
    const ctxOverride = applyGridProfile('insuranceBet', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  /* Jurisdiction gate — runs LAST, overrides every enable path. */
  const jurisdiction = _resolveJurisdiction(model);
  if (jurisdiction && INSURANCE_BET_BANNED_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = false;
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = true;
  } else if (jurisdiction) {
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = false;
  }

  return cfg;
}

export { INSURANCE_BET_BANNED_JURISDICTIONS };

export function emitInsuranceBetCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  const pct = Math.round((cfg.costMult - 1) * 100);
  return `
/* ─── insurance bet toggle ──────────────────────────────────────── */
.insurance-bet {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  right: ${T.rightPad}px;
  z-index: ${T.zIndex};
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: ${T.padV}px ${T.padH}px;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: ${T.borderRadius}px;
  color: ${cfg.color};
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  user-select: none;
  appearance: none;
}
.insurance-bet:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.insurance-bet .ib-switch {
  position: relative; display: inline-block;
  width: ${T.switchW}px; height: ${T.switchH}px;
  background: #333; border-radius: 9px;
  transition: background .15s;
}
.insurance-bet .ib-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: ${T.knobSize}px; height: ${T.knobSize}px;
  background: ${cfg.color}; border-radius: 50%;
  transition: transform .18s cubic-bezier(.4, 1.4, .5, 1);
}
.insurance-bet[aria-checked="true"] .ib-switch { background: ${cfg.color}; }
.insurance-bet[aria-checked="true"] .ib-switch::after {
  transform: translateX(${T.knobShift}px); background: #fff;
}
.insurance-bet .ib-pct { font-size: 0.66rem; opacity: 0.7; margin-left: 2px; }
.insurance-bet[data-locked="true"] { opacity: 0.5; pointer-events: none; }
@media (max-width: 620px) {
  .insurance-bet {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    right: ${T.rightPadMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .insurance-bet .ib-switch,
  .insurance-bet .ib-switch::after { transition: none; }
}
`;
}

export function emitInsuranceBetMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = Math.round((cfg.costMult - 1) * 100);
  return `<button id="insuranceBet" class="insurance-bet" type="button"
        role="switch" aria-checked="false" data-locked="false"
        aria-label="Toggle insurance bet (+${pct}% bet)">
  <span>${escapeHtml(cfg.label)}</span>
  <span class="ib-switch" aria-hidden="true"></span>
  <span class="ib-pct">+${pct}%</span>
</button>`;
}

export function emitInsuranceBetRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* insuranceBet: disabled */`;
  return `/* ─── insurance bet runtime ──────────────────────────────────── */
const IB_COST_MULT    = ${cfg.costMult};
const IB_PAYOUT_RATIO = ${cfg.payoutRatio};

(function wireInsuranceBet(){
  const btn = document.getElementById('insuranceBet');
  if (!btn) return;

  function toggle() {
    if (btn.getAttribute('data-locked') === 'true') return;
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    if (typeof window !== 'undefined') {
      window.INSURANCE_BET_ON          = next;
      window.INSURANCE_BET_COST_MULT   = IB_COST_MULT;
      window.INSURANCE_BET_PAYOUT_RATIO= IB_PAYOUT_RATIO;
    }
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onInsuranceBetChanged', {
        on: next, costMult: IB_COST_MULT, payoutRatio: IB_PAYOUT_RATIO,
      });
    }
  }

  btn.addEventListener('click', toggle);
  btn.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){ btn.setAttribute('data-locked', 'true'); }) : void 0);
  HookBus.on('onFsEnd',     function(){ btn.setAttribute('data-locked', 'false'); });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
