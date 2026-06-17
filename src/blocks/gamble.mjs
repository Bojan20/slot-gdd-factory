/**
 * src/blocks/gamble.mjs
 *
 * Wave P2 — Gamble (Double-or-Nothing) feature block.
 *
 * After a winning spin, player can gamble the win. Standard variants:
 *   • Card color (red/black) — 50% double
 *   • Card suit — 25% quadruple
 *   • Ladder — step up/down with progressive multiplier
 *
 * Industry references: card / colour gamble (industry-standard post-win risk feature).
 *
 * GDD knobs:
 *   • mode: 'color' | 'suit' | 'ladder'
 *   • maxRounds: number — max consecutive gambles (default 5)
 *   • multiplier: number — payout multiplier per success (2 for color, 4 for suit)
 *   • collectThresholdX: number — auto-collect cap (0 = no cap)
 *   • haloColor: 'r,g,b'
 */

const Z_INDEX_GAMBLE = 88;
const MAX_ROUNDS_HARD_CAP = 20;
const MULT_MIN = 1.1;
const MULT_MAX = 16;
const COLLECT_CAP_MAX = 1_000_000;
const STAKE_PRECISION = 100; // 2-decimal rounding

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'color',
    maxRounds: 5,
    multiplier: 2,
    collectThresholdX: 0,
    haloColor: '200,80,80',
  });
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.gamble || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'color' || m.mode === 'suit' || m.mode === 'ladder') {
    cfg.mode = m.mode;
    if (m.mode === 'suit') cfg.multiplier = 4;
    if (m.mode === 'color') cfg.multiplier = 2;
  }
  if (Number.isFinite(m.maxRounds)) cfg.maxRounds = clampInt(m.maxRounds, 1, MAX_ROUNDS_HARD_CAP);
  if (Number.isFinite(m.multiplier) && !m.mode) cfg.multiplier = clampFloat(m.multiplier, MULT_MIN, MULT_MAX);
  if (Number.isFinite(m.collectThresholdX)) cfg.collectThresholdX = clampInt(m.collectThresholdX, 0, COLLECT_CAP_MAX);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'gamble')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitGambleCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── gamble ────────────────────────────────────────────────────── */
.gamble-overlay {
  position: fixed;
  inset: 0;
  z-index: ${Z_INDEX_GAMBLE};
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.85);
  backdrop-filter: blur(8px);
}
.gamble-overlay[data-show="true"] { display: flex; }
.gamble-modal {
  background: linear-gradient(160deg, #14080a, #060304);
  border: 2.5px solid rgba(${cfg.haloColor},.75);
  border-radius: 18px;
  padding: 1.5rem 1.8rem;
  color: #f3eede;
  min-width: min(360px, 92vw);
  text-align: center;
  box-shadow: 0 0 60px rgba(${cfg.haloColor},.5);
}
.gamble-title {
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: rgba(${cfg.haloColor},1);
  margin-bottom: 0.75rem;
  text-shadow: 0 0 10px rgba(${cfg.haloColor},.6);
}
.gamble-stake {
  font-size: 0.95rem;
  margin-bottom: 1rem;
  opacity: 0.9;
}
.gamble-buttons {
  display: flex;
  gap: 0.6rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}
.gamble-btn {
  background: rgba(${cfg.haloColor},.9);
  color: #1a0808;
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1.2rem;
  font-weight: 900;
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  min-width: 90px;
  box-shadow: 0 0 12px rgba(${cfg.haloColor},.5);
}
.gamble-btn--alt { background: rgba(40,40,40,.95); color: #fff; }
.gamble-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.gamble-result {
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  min-height: 1.4rem;
  margin-bottom: 0.5rem;
}
.gamble-collect {
  background: rgba(255,255,255,.12);
  color: #fff;
  border: 1px solid rgba(255,255,255,.3);
  border-radius: 10px;
  padding: 0.55rem 1.2rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  cursor: pointer;
  font-size: 0.85rem;
}
@media (prefers-reduced-motion: reduce) {
  .gamble-overlay { backdrop-filter: none; }
  .gamble-modal, .gamble-btn, .gamble-title { box-shadow: none; text-shadow: none; }
}
`;
}

export function emitGambleMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  let buttons = '';
  if (cfg.mode === 'color') {
    buttons = `<button class="gamble-btn" data-pick="red" aria-label="Pick red">RED</button><button class="gamble-btn gamble-btn--alt" data-pick="black" aria-label="Pick black">BLACK</button>`;
  } else if (cfg.mode === 'suit') {
    buttons = `<button class="gamble-btn" data-pick="hearts" aria-label="Pick hearts">♥</button><button class="gamble-btn gamble-btn--alt" data-pick="spades" aria-label="Pick spades">♠</button><button class="gamble-btn" data-pick="diamonds" aria-label="Pick diamonds">♦</button><button class="gamble-btn gamble-btn--alt" data-pick="clubs" aria-label="Pick clubs">♣</button>`;
  } else {
    buttons = `<button class="gamble-btn" data-pick="up">↑ HIGHER</button><button class="gamble-btn gamble-btn--alt" data-pick="down">↓ LOWER</button>`;
  }
  return `<div id="gambleOverlay" class="gamble-overlay" data-show="false" role="dialog" aria-modal="true">
  <div class="gamble-modal">
    <div class="gamble-title">DOUBLE OR NOTHING</div>
    <div class="gamble-stake">Stake: ×<span id="gambleStake">0</span></div>
    <div id="gambleResult" class="gamble-result" aria-live="polite">Pick to continue</div>
    <div class="gamble-buttons">${buttons}</div>
    <button id="gambleCollect" class="gamble-collect" type="button">COLLECT</button>
  </div>
</div>`;
}

export function emitGambleRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* gamble: disabled */`;
  return `/* ─── gamble runtime ──────────────────────────────────────────── */
const GAMBLE_MODE       = ${JSON.stringify(cfg.mode)};
const GAMBLE_MAX_ROUNDS = ${cfg.maxRounds};
const GAMBLE_MULT       = ${cfg.multiplier};
const GAMBLE_COLLECT_THRESHOLD = ${cfg.collectThresholdX};
const GAMBLE_STATE = { active: false, stakeX: 0, rounds: 0 };

function _gambleWinChance() {
  if (GAMBLE_MODE === 'color')  return 0.5;
  if (GAMBLE_MODE === 'suit')   return 0.25;
  if (GAMBLE_MODE === 'ladder') return 0.5;
  return 0.5;
}

function gambleOpen(stakeX) {
  if (GAMBLE_STATE.active) return;
  GAMBLE_STATE.active = true;
  GAMBLE_STATE.stakeX = Number.isFinite(stakeX) && stakeX > 0 ? stakeX : 1;
  GAMBLE_STATE.rounds = 0;
  GAMBLE_STATE._prevFocus = (typeof document !== 'undefined') ? document.activeElement : null;
  const ov = document.getElementById('gambleOverlay');
  if (ov) ov.dataset.show = 'true';
  const stake = document.getElementById('gambleStake');
  if (stake) stake.textContent = String(GAMBLE_STATE.stakeX);
  const result = document.getElementById('gambleResult');
  if (result) result.textContent = 'Pick to continue';
  document.querySelectorAll('.gamble-btn').forEach(b => b.disabled = false);
  const firstBtn = document.querySelector('.gamble-btn');
  if (firstBtn && typeof firstBtn.focus === 'function') { try { firstBtn.focus(); } catch (_) {} }
  GAMBLE_STATE._keydownHandler = (e) => { if (e && e.key === 'Escape') gambleCollect(); };
  document.addEventListener('keydown', GAMBLE_STATE._keydownHandler);
}

function _gambleResolvePick(pickToken) {
  if (!GAMBLE_STATE.active) return;
  GAMBLE_STATE.rounds++;
  const won = Math.random() < _gambleWinChance();
  const result = document.getElementById('gambleResult');
  if (won) {
    GAMBLE_STATE.stakeX = Math.round(GAMBLE_STATE.stakeX * GAMBLE_MULT * ${STAKE_PRECISION}) / ${STAKE_PRECISION};
    if (result) result.textContent = 'WIN! Stake ×' + GAMBLE_STATE.stakeX;
    const stake = document.getElementById('gambleStake');
    if (stake) stake.textContent = String(GAMBLE_STATE.stakeX);
    if (GAMBLE_STATE.rounds >= GAMBLE_MAX_ROUNDS ||
        (GAMBLE_COLLECT_THRESHOLD > 0 && GAMBLE_STATE.stakeX >= GAMBLE_COLLECT_THRESHOLD)) {
      document.querySelectorAll('.gamble-btn').forEach(b => b.disabled = true);
    }
  } else {
    GAMBLE_STATE.stakeX = 0;
    if (result) result.textContent = 'LOST. Stake gone.';
    const stake = document.getElementById('gambleStake');
    if (stake) stake.textContent = '0';
    document.querySelectorAll('.gamble-btn').forEach(b => b.disabled = true);
  }
}

function gambleCollect() {
  const collected = GAMBLE_STATE.stakeX;
  GAMBLE_STATE.active = false;
  GAMBLE_STATE.stakeX = 0;
  GAMBLE_STATE.rounds = 0;
  const ov = document.getElementById('gambleOverlay');
  if (ov) ov.dataset.show = 'false';
  if (GAMBLE_STATE._keydownHandler) {
    document.removeEventListener('keydown', GAMBLE_STATE._keydownHandler);
    GAMBLE_STATE._keydownHandler = null;
  }
  if (GAMBLE_STATE._prevFocus && typeof GAMBLE_STATE._prevFocus.focus === 'function') {
    try { GAMBLE_STATE._prevFocus.focus(); } catch (_) {}
    GAMBLE_STATE._prevFocus = null;
  }
  return collected;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.gamble-btn').forEach(btn => {
    btn.addEventListener('click', () => _gambleResolvePick(btn.dataset.pick));
  });
  const cb = document.getElementById('gambleCollect');
  if (cb) cb.addEventListener('click', gambleCollect);
});

if (typeof window !== 'undefined') {
  window.gambleOpen    = gambleOpen;
  window.gambleCollect = gambleCollect;
  window.GAMBLE_STATE  = GAMBLE_STATE;
}

/* HookBus wire-up — gamble is offered after a winning base spin (postSpin).
   FS boundaries close any open gamble session so it can't leak. */
if (typeof HookBus !== 'undefined') {
  /* Single owner-listener for postSpin: natural-win path first, then the
   * forced-open path (UFP chip → spin → modal even with no real win). */
  HookBus.on('postSpin', ({ duringFs, events } = {}) => {
    if (duringFs) return; /* gamble is BASE-only — don't offer during FS */
    if (Array.isArray(events) && events.length > 0) {
      const totalX = events.reduce((a, e) => a + (Number(e && e.payX) || 0), 0);
      if (totalX > 0 && !GAMBLE_STATE.active) {
        try { gambleOpen(totalX); } catch (e) { /* defensive */ }
        return;
      }
    }
    if (window.__FORCE_GAMBLE_OPEN__ && !GAMBLE_STATE.active) {
      window.__FORCE_GAMBLE_OPEN__ = false;
      try { gambleOpen(1); } catch (_) { /* defensive */ }
    }
  }, { priority: -60 });
  HookBus.on('onFsTrigger', () => { if (GAMBLE_STATE.active) gambleCollect(); });
  HookBus.on('onFsEnd',     () => { if (GAMBLE_STATE.active) gambleCollect(); });
  HookBus.on('onForceFeatureRequested', (payload) => {
    if (!payload || payload.kind !== 'gamble') return;
    window.__FORCE_GAMBLE_OPEN__ = true;
  });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
