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

export function defaultConfig() {
  return {
    enabled: false,
    costMultiplier: 1.25,   // +25% bet (industry-standard ante-bet reference)
    triggerMultiplier: 2,   // doubles scatter probability when on (placeholder)
    label: 'ANTE BET',
    color: '#ffe066',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.anteBet || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.costMultiplier)) cfg.costMultiplier = clampFloat(m.costMultiplier, 1.01, 5);
  if (Number.isFinite(m.triggerMultiplier)) cfg.triggerMultiplier = clampFloat(m.triggerMultiplier, 1.01, 10);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (typeof m.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(m.color)) cfg.color = m.color;

  // Auto-enable when ante_bet feature is detected
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'ante_bet')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitAnteBetCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = Math.round((cfg.costMultiplier - 1) * 100);
  return `
/* ─── ante bet ───────────────────────────────────────────────────── */
.ante-bet {
  position: fixed;
  bottom: 22px; left: 22px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0,0,0,.6);
  border: 1px solid rgba(${hexToRgb(cfg.color)},.6);
  border-radius: 14px;
  padding: 0.55rem 0.9rem;
  color: ${cfg.color};
  font-size: 0.78rem;
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
  width: 32px; height: 18px;
  background: #333;
  border-radius: 9px;
  transition: background .15s;
}
.ante-bet .switch::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 14px; height: 14px;
  background: ${cfg.color};
  border-radius: 50%;
  transition: transform .18s cubic-bezier(.4,1.4,.5,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.6);
}
.ante-bet[data-on="true"] .switch { background: ${cfg.color}; }
.ante-bet[data-on="true"] .switch::after {
  transform: translateX(14px);
  background: #fff;
}
.ante-bet .pct {
  font-size: 0.65rem;
  opacity: 0.7;
  margin-left: 2px;
}
@media (max-width: 620px) {
  .ante-bet { padding: 0.4rem 0.7rem; font-size: 0.7rem; bottom: 14px; left: 14px; }
  .ante-bet .switch { width: 26px; height: 14px; }
  .ante-bet .switch::after { width: 11px; height: 11px; }
  .ante-bet[data-on="true"] .switch::after { transform: translateX(11px); }
}
`;
}

export function emitAnteBetMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = Math.round((cfg.costMultiplier - 1) * 100);
  return `<div id="anteBetToggle" class="ante-bet" data-on="false" role="switch" aria-checked="false" tabindex="0">
  <span>${escapeHtml(cfg.label)}</span>
  <span class="switch" aria-hidden="true"></span>
  <span class="pct">+${pct}%</span>
</div>`;
}

export function emitAnteBetRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* anteBet: disabled */`;
  return `/* ─── ante bet runtime ───────────────────────────────────────── */
const ANTE_BET_COST_MULT    = ${cfg.costMultiplier};
const ANTE_BET_TRIGGER_MULT = ${cfg.triggerMultiplier};
let ANTE_BET_ON = false;
if (typeof window !== 'undefined') window.ANTE_BET_ON = false;

(function wireAnteBet(){
  const el = document.getElementById('anteBetToggle');
  if (!el) return;
  function setOn(on) {
    ANTE_BET_ON = !!on;
    el.dataset.on = ANTE_BET_ON ? 'true' : 'false';
    el.setAttribute('aria-checked', ANTE_BET_ON ? 'true' : 'false');
    if (typeof window !== 'undefined') window.ANTE_BET_ON = ANTE_BET_ON;
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
})();
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
