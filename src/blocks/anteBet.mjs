import { applyGridProfile } from '../registry/gridProfile.mjs';
/**
 * src/blocks/anteBet.mjs
 *
 * Wave K5 — Ante Bet toggle (+25% bet, doubled trigger probability).
 *
 * When GDD declares an `ante_bet` feature, this block emits:
 *   • A toggle switch in the footer ("ANTE BET +25%")
 *   • Runtime state flag `window.ANTE_BET_ON`
 *   • Cost-multiplier baked from GDD (default 1.25)
 *
 * Math layer (real bet × 1.25, scatter weight doubling) lands with
 * PAR hot-swap injector — Phase 2. For now: toggle is visual + flag.
 */

/* Wave AL-6 — design tokens hoisted from emitted CSS (0 magic numbers). */
const ANTE_BET_TOKENS = {
  topPad: 18,
  topPadMobile: 10,
  zIndex: 60,
  switchW: 32,
  switchH: 18,
  knobSize: 14,
  knobShift: 14,
  mobileSwitchW: 26,
  mobileSwitchH: 14,
  mobileKnobSize: 11,
  mobileKnobShift: 11,
  fontRem: 0.78,
  mobileFontRem: 0.7,
  pctFontRem: 0.7,
  mobileBreakpoint: 620,
};

/* Shared percent helper — single source for both CSS and markup labels. */
const PCT = (m) => Math.round((m - 1) * 100);

export function defaultConfig() {
  return {
    enabled: false,
    /* Wave T-ante (2026-06-04) — kept at the verified industry baseline
     * of +25% bet (1.25× multiplier). This is the modal value across the
     * vendor landscape; concrete games override via
     * model.anteBet.costMultiplier when their math requires +20% or +50%. */
    costMultiplier: 1.25,
    triggerMultiplier: 2,   // doubles scatter probability when on (placeholder)
    label: 'ANTE BET',
    color: '#ffe066',
  };
}

export function resolveConfig(model = {}) {
  /* Wave UD — baseline → per-kind context override → explicit GDD. */
  let cfg = applyGridProfile('anteBet', defaultConfig(), model);
  const m = model.anteBet || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.costMultiplier)) cfg.costMultiplier = clampFloat(m.costMultiplier, 1.01, 5);
  if (Number.isFinite(m.triggerMultiplier)) cfg.triggerMultiplier = clampFloat(m.triggerMultiplier, 1.01, 10);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (typeof m.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(m.color)) cfg.color = m.color;

  // Auto-enable when ante_bet feature is detected.
  //
  // Wave AL-2 (4-GDD audit, 2026-06-11): explicit GDD detection of
  // `ante_bet` MUST override the gridProfile veto. Industry-standard
  // grids (cluster, hex, wheel, etc.) default to no ante-bet because
  // their trigger model usually doesn't use it — but if a designer
  // explicitly puts ante_bet in the GDD, we honor that. Boki's rule:
  // "tačno ono što se traži, ništa više ništa manje."
  // The previous behavior re-applied `applyGridProfile` with
  // `{ enabled: true }`, which let the profile veto silently win and
  // dropped the chip for cluster GDDs that DO want ante-bet.
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'ante_bet')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitAnteBetCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = PCT(cfg.costMultiplier);
  const T = ANTE_BET_TOKENS;
  return `
/* ─── ante bet ─────────────────────────────────────────────────────
   Top-left feature toggle. Same reasoning as bonus-buy: keeps the
   bottom rails and corners free for the spin cluster and utility row. */
.ante-bet {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  left: max(${T.topPad}px, env(safe-area-inset-left, ${T.topPad}px));
  bottom: auto;
  z-index: ${T.zIndex};
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0,0,0,.6);
  border: 1px solid rgba(${hexToRgb(cfg.color)},.6);
  border-radius: 14px;
  padding: 0.55rem 0.9rem;
  color: ${cfg.color};
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  user-select: none;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.ante-bet:hover { background: rgba(0,0,0,.8); border-color: ${cfg.color}; }
.ante-bet .switch {
  position: relative;
  display: inline-block;
  width: ${T.switchW}px; height: ${T.switchH}px;
  background: #333;
  border-radius: 9px;
  transition: background .15s;
}
.ante-bet .switch::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: ${T.knobSize}px; height: ${T.knobSize}px;
  background: ${cfg.color};
  border-radius: 50%;
  transition: transform .18s cubic-bezier(.4,1.4,.5,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.6);
}
.ante-bet[data-on="true"] .switch { background: ${cfg.color}; }
.ante-bet[data-on="true"] .switch::after {
  transform: translateX(${T.knobShift}px);
  background: #fff;
}
.ante-bet .pct {
  font-size: ${T.pctFontRem}rem;  /* Wave UQ — ≥11px floor */
  opacity: 0.7;
  margin-left: 2px;
}
@media (max-width: ${T.mobileBreakpoint}px) {
  .ante-bet {
    padding: 0.4rem 0.7rem;
    font-size: ${T.mobileFontRem}rem;
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    left: max(${T.topPadMobile}px, env(safe-area-inset-left, ${T.topPadMobile}px));
  }
  .ante-bet .switch { width: ${T.mobileSwitchW}px; height: ${T.mobileSwitchH}px; }
  .ante-bet .switch::after { width: ${T.mobileKnobSize}px; height: ${T.mobileKnobSize}px; }
  .ante-bet[data-on="true"] .switch::after { transform: translateX(${T.mobileKnobShift}px); }
}
@media (prefers-reduced-motion: reduce) {
  .ante-bet, .ante-bet .switch, .ante-bet .switch::after { transition: none; }
}
`;
}

export function emitAnteBetMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = PCT(cfg.costMultiplier);
  return `<div id="anteBetToggle" class="ante-bet" data-on="false" role="switch" aria-checked="false" tabindex="0">
  <span>${escapeHtml(cfg.label)}</span>
  <span class="switch" aria-hidden="true"></span>
  <span class="pct">+${pct}%</span>
</div>`;
}

export function emitAnteBetRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* anteBet: disabled */`;
  return `/* ─── ante bet runtime ───────────────────────────────────────── */
/**
 * @perf <0.05ms toggle, 2 listeners, no rAF, no allocations on tick
 */
const ANTE_BET_COST_MULT    = ${cfg.costMultiplier};
const ANTE_BET_TRIGGER_MULT = ${cfg.triggerMultiplier};
let ANTE_BET_ON = false;
if (typeof window !== 'undefined') window.ANTE_BET_ON = false;

function wireAnteBet(){
  const el = document.getElementById('anteBetToggle');
  if (!el) return;
  function setOn(on) {
    ANTE_BET_ON = !!on;
    el.dataset.on = ANTE_BET_ON ? 'true' : 'false';
    el.setAttribute('aria-checked', ANTE_BET_ON ? 'true' : 'false');
    if (typeof window !== 'undefined') window.ANTE_BET_ON = ANTE_BET_ON;
    if (typeof HookBus !== 'undefined') HookBus.emit('anteBet:changed', { on: ANTE_BET_ON, costMult: ANTE_BET_COST_MULT, triggerMult: ANTE_BET_TRIGGER_MULT });
  }
  el.addEventListener('click', () => {
    if (typeof FSM !== 'undefined' && FSM.phase !== 'BASE') return; // locked mid-bonus
    setOn(!ANTE_BET_ON);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (typeof FSM !== 'undefined' && FSM.phase !== 'BASE') return;
      setOn(!ANTE_BET_ON);
    }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireAnteBet);
else wireAnteBet();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
