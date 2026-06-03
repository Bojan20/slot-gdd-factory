/**
 * src/blocks/bonusBuy.mjs
 *
 * Wave K4 — Bonus Buy button (direct purchase into FS bonus).
 *
 * When GDD declares a `bonus_buy` feature, this block emits:
 *   • A "Buy Bonus" button in the footer
 *   • Runtime listener that forces an FS trigger on click
 *   • Cost label baked from GDD (default 100x current bet)
 *
 * Math layer is placeholder — Phase 2 will wire real bet × cost
 * deduction. For now: click forces FORCE_TRIGGER + N scatters.
 */

export function defaultConfig() {
  return {
    enabled: false,
    costX: 100,            // 100x current bet (Gates of Olympus reference)
    label: 'BUY BONUS',
    forceScatters: 4,      // guaranteed scatter count when bought
    color: '#ff5050',
    confirmMessage: '',    // optional confirmation prompt; empty = no confirm
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.bonusBuy || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.costX)) cfg.costX = clampInt(m.costX, 1, 10000);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.forceScatters)) cfg.forceScatters = clampInt(m.forceScatters, 3, 12);
  if (typeof m.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(m.color)) cfg.color = m.color;
  if (typeof m.confirmMessage === 'string' && m.confirmMessage.length <= 200) cfg.confirmMessage = m.confirmMessage;

  // Auto-enable when bonus_buy feature is detected
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'bonus_buy')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitBonusBuyCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── bonus buy ──────────────────────────────────────────────────── */
.bonus-buy-btn {
  position: fixed;
  bottom: 22px; right: 22px;
  z-index: 60;
  background: linear-gradient(135deg, ${cfg.color}, #b03030);
  color: #fff;
  border: 2px solid rgba(255,255,255,.4);
  border-radius: 14px;
  padding: 0.65rem 1.2rem;
  font-size: 0.85rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(255,80,80,.5), inset 0 1px 0 rgba(255,255,255,.4);
  transition: transform .12s, box-shadow .12s;
}
.bonus-buy-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 22px rgba(255,80,80,.7), inset 0 1px 0 rgba(255,255,255,.5);
}
.bonus-buy-btn:active { transform: translateY(0); }
.bonus-buy-btn .cost {
  display: block;
  font-size: 0.65rem;
  font-weight: 700;
  opacity: 0.88;
  margin-top: 2px;
}
.bonus-buy-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 620px) {
  .bonus-buy-btn { padding: 0.5rem 0.9rem; font-size: 0.72rem; bottom: 14px; right: 14px; }
}
`;
}

export function emitBonusBuyMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<button id="bonusBuyBtn" class="bonus-buy-btn" type="button" aria-label="Buy bonus feature">
  ${escapeHtml(cfg.label)}
  <span class="cost">${cfg.costX}× BET</span>
</button>`;
}

export function emitBonusBuyRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* bonusBuy: disabled */`;
  const CONFIRM = cfg.confirmMessage ? JSON.stringify(cfg.confirmMessage) : 'null';
  const FORCE_N = cfg.forceScatters;
  return `/* ─── bonus buy runtime ──────────────────────────────────────── */
const BONUS_BUY_COST_X = ${cfg.costX};
const BONUS_BUY_FORCE_SCATTERS = ${FORCE_N};
const BONUS_BUY_CONFIRM = ${CONFIRM};

(function wireBonusBuy(){
  const btn = document.getElementById('bonusBuyBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (typeof FSM !== 'undefined' && FSM.phase !== 'BASE') return; // can't buy mid-bonus
    if (BONUS_BUY_CONFIRM) {
      if (!window.confirm(BONUS_BUY_CONFIRM)) return;
    }
    if (typeof FORCE_TRIGGER === 'undefined') return;
    FORCE_TRIGGER = BONUS_BUY_FORCE_SCATTERS;
    if (typeof window !== 'undefined') window.FORCE_TRIGGER = BONUS_BUY_FORCE_SCATTERS;
    if (typeof runOneBaseSpin === 'function') runOneBaseSpin();
    btn.setAttribute('disabled', 'disabled');
    setTimeout(() => btn.removeAttribute('disabled'), 1200);
  });
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
