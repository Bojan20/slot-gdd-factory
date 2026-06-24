import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/bonusBuy.mjs
 *
 * Wave K4 — Bonus Buy button (direct purchase into FS bonus).
 *
 * @module bonusBuy
 *
 * Purpose:
 *   When GDD declares a `bonus_buy` feature, this block emits a "Buy Bonus"
 *   button in the footer (default `enabled: false`) plus a runtime click listener that forces
 *   a free-spins trigger by injecting N guaranteed scatters into the next spin.
 *   The button label carries the cost-multiplier baked from the GDD
 *   (default 75× current bet — industry-median midpoint).
 *
 * Industry-reference (vendor-neutral):
 *   "Bonus buy" is now a cross-vendor industry baseline feature in
 *   non-restricted jurisdictions: a single button that costs 50-100× the
 *   current bet and guarantees a free-spins entry on the next spin. The
 *   block models the visual + control surface only; the math layer
 *   (real-cash deduction, RTP rebalance) lands with PAR hot-swap in
 *   Phase 2.
 *
 * Public API:
 *   defaultConfig()                    → frozen safe defaults
 *   resolveConfig(model)               → merge defaults with GDD override
 *   emitBonusBuyCSS(cfg)               → CSS string (button styles)
 *   emitBonusBuyMarkup(cfg)            → HTML string (button host)
 *   emitBonusBuyRuntime(cfg)           → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  — (none — purely user-input driven)
 *   emits:       onBonusBuyRequested { scatterCount, costX }
 *
 * a11y / perf:
 *   • Button is a real <button> with aria-label + visible focus ring.
 *   • Optional `confirmMessage` GDD knob → confirm() before commit.
 *   • CSS / Markup / Runtime emitters all gate on `cfg.enabled`.
 *   • Re-arm guard (`rearmMs`) prevents double-click spam.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Wave T-bonus (2026-06-04) — industry median is 50-100× current bet.
     * Default to 75× as a neutral midpoint; concrete games override via
     * model.bonusBuy.costX. The template no longer leans toward any one
     * vendor's price point. */
    costX: 75,
    label: 'BUY BONUS',
    forceScatters: 4,      // guaranteed scatter count when bought
    color: '#ff5050',
    colorDark: '#b03030',  // dark gradient stop; override alongside `color`
    shadowRGB: '255,80,80', // r,g,b tuple for glow; alpha applied per-state
    rearmMs: 1200,         // re-enable delay after a buy click
    confirmMessage: '',    // optional confirmation prompt; empty = no confirm
  });
}

/* W57.A4 — Cross-jurisdiction bonus-buy ban matrix.
 *
 * Operators deploying under any of these regulator profiles MUST NOT
 * surface the buy-the-bonus path. Forced disable at resolveConfig time
 * matches the same precedence pattern as winCap.mjs jurisdiction
 * routing (regulator.profile > responsibleGambling.jurisdiction).
 *
 * Citations:
 *   • UKGC LCCP — Jun-2026 bonus-buy ban
 *   • SE Spelinspektionen — Spellag 14:6 bonus-buy ban
 *   • DE GlüStV — §11(3) bonus-buy ban
 *   • NL KSA — Spel-1 §31 bonus-buy ban
 *
 * UKGC / NL / SE / DE are HARD bans. Any other jurisdiction (MGA, ON,
 * NJ, IT, OFF) honors the GDD's enabled flag.
 */
const BONUS_BUY_BANNED_JURISDICTIONS = Object.freeze(['UKGC', 'SE', 'DE', 'NL']);

function _resolveBonusBuyJurisdiction(model) {
  const m  = (model && model.bonusBuy) || {};
  const rg = (model && model.responsibleGambling) || {};
  const reg = (model && model.regulator) || {};
  let j = null;
  if (typeof m.jurisdiction   === 'string') j = m.jurisdiction.toUpperCase();
  if (typeof rg.jurisdiction  === 'string') j = rg.jurisdiction.toUpperCase();
  if (typeof reg.profile      === 'string') j = reg.profile.toUpperCase();
  return j;
}

export function resolveConfig(model = {}) {
  /* Wave UD — baseline → per-kind context override → explicit GDD. */
  let cfg = { ...applyGridProfile('bonusBuy', defaultConfig(), model) };
  const m = model.bonusBuy || {};
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  /* Wave LEGO-BUY parity fix — explicit GDD `enabled: true` must
   * still go through gridProfile veto. Pre-fix: wheel / crash /
   * plinko / radial could opt back in via stray GDD field. */
  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('bonusBuy', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }
  if (Number.isFinite(m.costX)) cfg.costX = clampInt(m.costX, 1, 10000);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.forceScatters)) cfg.forceScatters = clampInt(m.forceScatters, 3, 12);
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.shadowRGB === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.shadowRGB)) cfg.shadowRGB = m.shadowRGB;
  if (Number.isFinite(m.rearmMs)) cfg.rearmMs = clampInt(m.rearmMs, 100, 10000);
  if (typeof m.confirmMessage === 'string' && m.confirmMessage.length <= 200) cfg.confirmMessage = m.confirmMessage;

  /* UQ-DEEP-Z fix (Boki 2026-06-24): "ako gdd nema bonus buy, ne prikazuj
   * taj blok u igri." reference lock-respin GDD GDD eksplicitno bani bonus buy, parser
   * stampa _derivedBy.bonusBuy = 'gdd-explicit-ban-detected' i postavi
   * m.enabled = false. ALI features[] može imati 'bonus_buy' kind dodato
   * iz drugog izvora (Wave V reconcile, smart defaults), pa je auto-enable
   * brisao ban. Hard precedence: ako je ban detected ili m.enabled
   * eksplicitno false → blok ostaje OFF, ignoriši features array. */
  const banDetected = !!(model.confidence && model.confidence._derivedBy &&
                         model.confidence._derivedBy.bonusBuy === 'gdd-explicit-ban-detected');
  const explicitDisabled = (m.enabled === false);
  if (banDetected || explicitDisabled) {
    cfg.enabled = false;
  } else if (Array.isArray(model.features) && model.features.some(f => f.kind === 'bonus_buy')) {
    // Auto-enable when bonus_buy feature is detected (but only when the
    // grid topology supports buy-in — wheel / crash / plinko / radial
    // self-disable via gridProfile and an explicit feature mention should
    // NOT override that topology-level decision).
    const ctxOverride = applyGridProfile('bonusBuy', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  /* W57.A4 — Jurisdiction gate runs LAST so it overrides every other
   * enable path (explicit GDD flag, feature auto-detect, gridProfile).
   * Operator deploying under UKGC / SE / DE / NL CANNOT show bonus-buy
   * regardless of GDD intent. */
  const jurisdiction = _resolveBonusBuyJurisdiction(model);
  if (jurisdiction && BONUS_BUY_BANNED_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = false;
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = true;
  } else if (jurisdiction) {
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = false;
  }

  return cfg;
}

export { BONUS_BUY_BANNED_JURISDICTIONS };

export function emitBonusBuyCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── bonus buy ──────────────────────────────────────────────────── */
/* 2026-06-09 — Boki direktiva: "Bonus buy, stavi negde sa strane, gde ima
   mesta, ne zelim da mi preklapa bilo sta iznad rilova."
   Was: top-center → overlapped game title + universalForcePanel chips.
   Now: pinned LEFT MIDDLE, vertical orientation, narrow side dock.
   Off the reels by ~96px, fully clear of header / sub / hub. Mobile
   collapses to a top-left chip so we never eat the small viewport. */
.bonus-buy-btn {
  position: fixed;
  top: 50%;
  left: max(14px, env(safe-area-inset-left, 14px));
  transform: translateY(-50%);
  bottom: auto;
  right: auto;
  z-index: 55;             /* under universalForcePanel (60) and toasts */
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #fff;
  border: 2px solid rgba(255,255,255,.4);
  border-radius: 14px;
  padding: 0.7rem 0.55rem;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  cursor: pointer;
  /* Vertical text orientation for the side dock — narrow column, no
     overlap with the reel frame. Industry pattern: side-mounted buy
     ladder seen on most modern HTML5 buy-bonus slots. */
  writing-mode: vertical-rl;
  text-orientation: mixed;
  min-height: 120px;
  max-width: 44px;
  box-shadow: 0 4px 18px rgba(${cfg.shadowRGB},.5), inset 0 1px 0 rgba(255,255,255,.4);
  transition: transform .12s, box-shadow .12s, opacity .12s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.bonus-buy-btn:hover {
  transform: translateY(-50%) translateX(2px);
  box-shadow: 0 6px 22px rgba(${cfg.shadowRGB},.7), inset 0 1px 0 rgba(255,255,255,.5);
}
.bonus-buy-btn:active { transform: translateY(-50%) translateX(0); }
.bonus-buy-btn .cost {
  display: block;
  /* Wave UQ floor — Apple HIG / WCAG ≥ 11px. 0.7rem = 11.2px. */
  font-size: 0.7rem;
  font-weight: 700;
  opacity: 0.88;
  letter-spacing: 0.12em;
  margin-top: 4px;
}
.bonus-buy-btn[disabled] { opacity: 0.5; cursor: not-allowed; }

/* Mobile (≤620px) — collapse to a small top-left chip (no vertical text
   on narrow viewports; the left dock would steal too much screen). */
@media (max-width: 620px) {
  .bonus-buy-btn {
    top: max(10px, env(safe-area-inset-top, 10px));
    left: max(8px, env(safe-area-inset-left, 8px));
    transform: none;
    writing-mode: horizontal-tb;
    min-height: 0;
    max-width: none;
    padding: 0.45rem 0.7rem;
    font-size: 0.66rem;
    letter-spacing: 0.04em;
  }
  .bonus-buy-btn:hover  { transform: translateY(-1px); }
  .bonus-buy-btn:active { transform: translateY(0); }
  .bonus-buy-btn .cost { font-size: 0.7rem; letter-spacing: 0.02em; margin-top: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  .bonus-buy-btn, .bonus-buy-btn:hover, .bonus-buy-btn:active { transition: none; transform: translateY(-50%); }
}
`;
}

export function emitBonusBuyMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<button id="bonusBuyBtn" class="bonus-buy-btn" type="button" aria-label="Buy bonus feature" data-i18n-aria="bonusBuy.0" data-i18n-aria-fallback="Buy bonus feature">
  ${escapeHtml(cfg.label)}
  <span class="cost">${cfg.costX}× <span data-i18n="common.bet" data-i18n-fallback="BET">BET</span></span>
</button>`, 'bonusBuy');
}

export function emitBonusBuyRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* bonusBuy: disabled */`;
  const CONFIRM = cfg.confirmMessage ? JSON.stringify(cfg.confirmMessage) : 'null';
  const FORCE_N = cfg.forceScatters;
  return `/* ─── bonus buy runtime ──────────────────────────────────────── */
const REARM_MS = ${cfg.rearmMs};
const BONUS_BUY_COST_X = ${cfg.costX};
const BONUS_BUY_FORCE_SCATTERS = ${FORCE_N};
const BONUS_BUY_CONFIRM = ${CONFIRM};

/* perf budget: < 1ms click handler, < 16ms layout */
(function wireBonusBuy(){
  const btn = document.getElementById('bonusBuyBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (typeof FSM !== 'undefined' && FSM.phase !== 'BASE') return; // can't buy mid-bonus
    if (BONUS_BUY_CONFIRM) {
      if (!window.confirm(BONUS_BUY_CONFIRM)) return;
    }
    /* 2026-06-09 — Boki bug: was FORCE_TRIGGER = BONUS_BUY_FORCE_SCATTERS
       (a plain number). The reelEngine commitStopSymbols reads
       FORCE_TRIGGER.scatterCount — a number has no .scatterCount property,
       so the buy click silently produced ZERO planted scatters and the FS
       trigger never fired. Engine contract: { scatterCount: <int> }. */
    var _plant = { scatterCount: BONUS_BUY_FORCE_SCATTERS };
    if (typeof window !== 'undefined') window.FORCE_TRIGGER = _plant;
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      /* W57.A7 — canonical camelCase event name (was 'bonus.buy.requested'
       * pre-rename). LEGO gate now blocks NEW colon/dot event names;
       * legacy survivors are explicitly whitelisted in lego-gate.mjs. */
      (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onBonusBuyRequested', { scatterCount: BONUS_BUY_FORCE_SCATTERS, costX: BONUS_BUY_COST_X }) : void 0);
    }
    if (typeof runOneBaseSpin === 'function') runOneBaseSpin();
    btn.setAttribute('disabled', 'disabled');
    setTimeout(() => btn.removeAttribute('disabled'), REARM_MS);
  });
  /* Group AA HIGH fix 17.06.2026 dropped non-canonical
     HookBus.subscribe('fsm.phase.changed') listener:
       (a) subscribe API does not exist on canonical HookBus (only .on)
       (b) fsm.phase.changed uses dot-notation, not canonical onFsTrigger
     The line-238 inline IS_BASE phase-check on click is sufficient gating;
     no per-spin disable/enable round-trip needed. */
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', () => { btn.setAttribute('disabled', 'disabled'); }) : void 0);
  HookBus.on('onFsEnd',     () => { btn.removeAttribute('disabled'); });
})();

if (typeof window !== 'undefined') {
  window.BONUS_BUY_COST_X = BONUS_BUY_COST_X;
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
