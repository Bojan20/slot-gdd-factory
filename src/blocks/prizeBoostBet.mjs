import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/prizeBoostBet.mjs
 *
 * Wave LEGO-SIDEBET (B-7 · 2/2) — Prize boost side bet.
 *
 * @module prizeBoostBet
 *
 * Purpose:
 *   Pre-spin toggle that lets the player add a cost premium (default
 *   +50% bet) in exchange for a multiplier on the next win (default
 *   ×2 on the line/cluster pay). Visual + state surface only — math
 *   layer reads `window.PRIZE_BOOST_ON` + `window.PRIZE_BOOST_MULT`
 *   for PAR Phase 2 RTP rebalance.
 *
 * Industry-reference (vendor-neutral):
 *   Prize-boost side bets are an emerging 2024-2026 pattern. Player
 *   pays a premium for an explicit win multiplier on the next spin.
 *   Industry baseline: +25-75% bet for ×1.5-3.0 multiplier. Sister
 *   pattern to insurance — opposite risk profile (insurance protects
 *   downside, prize boost amplifies upside). Same jurisdiction matrix.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitPrizeBoostBetCSS(cfg)                → CSS string
 *   emitPrizeBoostBetMarkup(cfg)             → HTML string
 *   emitPrizeBoostBetRuntime(cfg)            → runtime JS string
 *   PRIZE_BOOST_BANNED_JURISDICTIONS         → re-exported hard-ban list
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onFsTrigger — lock toggle
 *                onFsEnd     — unlock
 *   emits:       onPrizeBoostChanged { on, costMult, winMult }
 *
 * a11y / perf:
 *   • role="switch" with aria-checked + visible focus ring
 *   • Keyboard: Enter/Space toggle
 *   • prefers-reduced-motion honored
 *   • Tokens hoisted
 *   • Hard-disabled under UKGC/SE/DE/NL (parity with bonusBuy)
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const PRIZE_BOOST_BANNED_JURISDICTIONS = Object.freeze(['UKGC', 'SE', 'DE', 'NL']);

const TOKENS = Object.freeze({
  topPad:        14,
  topPadMobile:  10,
  /* offset to clear insurance toggle (right 404) — sit further left. */
  rightPad:      540,
  rightPadMobile: 420,
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
    label: 'BOOST',
    costMult: 1.50,    /* +50% bet */
    winMult: 2.0,      /* ×2 win on hit */
    color:    '#ffaa66',
    colorDark: '#a04020',
  });
}

function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('prizeBoostBet', defaultConfig(), model) };
  const m = model.prizeBoostBet || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('prizeBoostBet', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.costMult)) cfg.costMult = _clampFloat(m.costMult, 1.01, 5.0, cfg.costMult);
  if (Number.isFinite(m.winMult)) cfg.winMult = _clampFloat(m.winMult, 1.01, 10.0, cfg.winMult);
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'prize_boost' || f.kind === 'win_boost' || f.kind === 'boost_bet')) {
    const ctxOverride = applyGridProfile('prizeBoostBet', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  const jurisdiction = _resolveJurisdiction(model);
  if (jurisdiction && PRIZE_BOOST_BANNED_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = false;
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = true;
  } else if (jurisdiction) {
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = false;
  }

  return cfg;
}

export { PRIZE_BOOST_BANNED_JURISDICTIONS };

export function emitPrizeBoostBetCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  const pct = Math.round((cfg.costMult - 1) * 100);
  return `
/* ─── prize boost bet toggle ────────────────────────────────────── */
.prize-boost-bet {
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
.prize-boost-bet:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.prize-boost-bet .pb-switch {
  position: relative; display: inline-block;
  width: ${T.switchW}px; height: ${T.switchH}px;
  background: #333; border-radius: 9px;
  transition: background .15s;
}
.prize-boost-bet .pb-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: ${T.knobSize}px; height: ${T.knobSize}px;
  background: ${cfg.color}; border-radius: 50%;
  transition: transform .18s cubic-bezier(.4, 1.4, .5, 1);
}
.prize-boost-bet[aria-checked="true"] .pb-switch { background: ${cfg.color}; }
.prize-boost-bet[aria-checked="true"] .pb-switch::after {
  transform: translateX(${T.knobShift}px); background: #fff;
}
.prize-boost-bet .pb-pct { font-size: 0.66rem; opacity: 0.7; margin-left: 2px; }
.prize-boost-bet[data-locked="true"] { opacity: 0.5; pointer-events: none; }
@media (max-width: 620px) {
  .prize-boost-bet {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    right: ${T.rightPadMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .prize-boost-bet .pb-switch,
  .prize-boost-bet .pb-switch::after { transition: none; }
}
`;
}

export function emitPrizeBoostBetMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pct = Math.round((cfg.costMult - 1) * 100);
  const winLabel = '×' + cfg.winMult;
  return tagBlockMarkup(`<button id="prizeBoostBet" class="prize-boost-bet" type="button"
        role="switch" aria-checked="false" data-locked="false"
        aria-label="Toggle prize boost (+${pct}% bet, ${winLabel} win)">
  <span>${escapeHtml(cfg.label)}</span>
  <span class="pb-switch" aria-hidden="true"></span>
  <span class="pb-pct">+${pct}%</span>
</button>`, 'prizeBoostBet');
}

export function emitPrizeBoostBetRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* prizeBoostBet: disabled */`;
  return `/* ─── prize boost bet runtime ────────────────────────────────── */
const PB_COST_MULT = ${cfg.costMult};
const PB_WIN_MULT  = ${cfg.winMult};

(function wirePrizeBoostBet(){
  const btn = document.getElementById('prizeBoostBet');
  if (!btn) return;

  function toggle() {
    if (btn.getAttribute('data-locked') === 'true') return;
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    if (typeof window !== 'undefined') {
      window.PRIZE_BOOST_ON        = next;
      window.PRIZE_BOOST_COST_MULT = PB_COST_MULT;
      window.PRIZE_BOOST_WIN_MULT  = PB_WIN_MULT;
    }
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onPrizeBoostChanged', {
        on: next, costMult: PB_COST_MULT, winMult: PB_WIN_MULT,
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
