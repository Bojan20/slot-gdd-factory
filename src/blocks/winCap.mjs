/**
 * src/blocks/winCap.mjs
 *
 * Wave N3 — Win Cap terminator block.
 *
 * Regulator-mandated max-win enforcement. When cumulative win exceeds
 * maxWinX × bet, current spin/round terminates immediately and a
 * "MAX WIN!" overlay is shown. Industry baseline: regulator-mandated max-win
 * cap — typical 5000x / 10 000x bet thresholds.
 *
 * GDD knobs:
 *   • maxWinX: number — multiplier of base bet (default 5000)
 *   • mode: 'round' | 'spin' — cap applied per-round (default) or per-spin
 *   • overlayLabel: string
 *   • overlayMs: number — duration of MAX WIN overlay
 *   • color: 'r,g,b'
 *   • forceRoundEnd: boolean — true = kill FS round on cap hit
 */

export function defaultConfig() {
  return {
    enabled: false,
    maxWinX: 5000,
    mode: 'round',
    overlayLabel: 'MAX WIN!',
    overlayMs: 2400,
    color: '255,215,0',
    forceRoundEnd: true,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.winCap || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.maxWinX)) cfg.maxWinX = clampInt(m.maxWinX, 100, 1000000);
  if (m.mode === 'round' || m.mode === 'spin') cfg.mode = m.mode;
  if (typeof m.overlayLabel === 'string' && m.overlayLabel.length > 0 && m.overlayLabel.length <= 30) {
    cfg.overlayLabel = m.overlayLabel;
  }
  if (Number.isFinite(m.overlayMs)) cfg.overlayMs = clampInt(m.overlayMs, 400, 12000);
  if (typeof m.color === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.color)) cfg.color = m.color;
  if (m.forceRoundEnd != null) cfg.forceRoundEnd = !!m.forceRoundEnd;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'win_cap')) {
    cfg.enabled = true;
  }
  /* Also enable from explicit limits.max_win_x in JSON IR */
  if (model.limits && Number.isFinite(model.limits.max_win_x)) {
    cfg.enabled = true;
    cfg.maxWinX = clampInt(model.limits.max_win_x, 100, 1000000);
  }
  return cfg;
}

export function emitWinCapCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── win cap overlay ───────────────────────────────────────────── */
.wincap-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle, rgba(0,0,0,.55), rgba(0,0,0,.85));
  backdrop-filter: blur(6px);
  pointer-events: none;
}
.wincap-overlay[data-show="true"] {
  display: flex;
  animation: wcFade 320ms ease-out;
}
.wincap-overlay .wc-card {
  background: linear-gradient(135deg, rgba(${cfg.color},.18), rgba(${cfg.color},.05));
  border: 2.5px solid rgba(${cfg.color},.85);
  border-radius: 18px;
  padding: 1.5rem 2.4rem;
  color: rgba(${cfg.color},1);
  font-size: 2.4rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-align: center;
  box-shadow: 0 0 60px rgba(${cfg.color},.65);
  text-shadow: 0 0 22px rgba(${cfg.color},.85);
  animation: wcPulse 1.4s ease-in-out infinite;
}
@keyframes wcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes wcPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
  .wincap-overlay[data-show="true"], .wincap-overlay .wc-card { animation: none; }
}
@media (max-width: 620px) {
  .wincap-overlay .wc-card { font-size: 1.5rem; padding: 1rem 1.5rem; }
}
`;
}

export function emitWinCapMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="winCapOverlay" class="wincap-overlay" data-show="false" role="alert">
  <div class="wc-card">${escapeHtml(cfg.overlayLabel)}</div>
</div>`;
}

export function emitWinCapRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* winCap: disabled */`;
  return `/* ─── win cap runtime ─────────────────────────────────────────── */
const WIN_CAP_MAX_X        = ${cfg.maxWinX};
const WIN_CAP_MODE         = ${JSON.stringify(cfg.mode)};
const WIN_CAP_OVERLAY_MS   = ${cfg.overlayMs};
const WIN_CAP_FORCE_END    = ${cfg.forceRoundEnd ? 'true' : 'false'};
let WIN_CAP_CUMULATIVE_X = 0;

function winCapAdd(winX) {
  if (!Number.isFinite(winX) || winX <= 0) return false;
  if (WIN_CAP_MODE === 'spin') {
    if (winX >= WIN_CAP_MAX_X) { winCapTrigger(); return true; }
    return false;
  }
  WIN_CAP_CUMULATIVE_X += winX;
  if (WIN_CAP_CUMULATIVE_X >= WIN_CAP_MAX_X) { winCapTrigger(); return true; }
  return false;
}

function winCapTrigger() {
  const overlay = document.getElementById('winCapOverlay');
  if (overlay) {
    overlay.dataset.show = 'true';
    setTimeout(() => { overlay.dataset.show = 'false'; }, WIN_CAP_OVERLAY_MS);
  }
  if (WIN_CAP_FORCE_END && typeof FSM_enterOutro === 'function') {
    /* Skip rest of round, jump to outro */
    setTimeout(() => { try { FSM_enterOutro(); } catch(e) {} }, WIN_CAP_OVERLAY_MS / 2);
  }
}

function winCapReset() {
  WIN_CAP_CUMULATIVE_X = 0;
  const overlay = document.getElementById('winCapOverlay');
  if (overlay) overlay.dataset.show = 'false';
}

function winCapGet() { return WIN_CAP_CUMULATIVE_X; }

if (typeof window !== 'undefined') {
  window.winCapAdd     = winCapAdd;
  window.winCapTrigger = winCapTrigger;
  window.winCapReset   = winCapReset;
  window.winCapGet     = winCapGet;
  window.WIN_CAP_MAX_X = WIN_CAP_MAX_X;
}

/* HookBus wire-up — winCap watches every settled win event and short-
   circuits the round when the cumulative payout reaches WIN_CAP_MAX_X.
   onFsTrigger resets the cumulative ledger so each FS round starts fresh.
   Without these handlers winCap is dead code (function defined but never
   called). */
if (typeof HookBus !== 'undefined') {
  HookBus.on('postSpin', ({ events } = {}) => {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const ev of events) {
      const winX = Number(ev && ev.payX);
      if (Number.isFinite(winX) && winX > 0 && winCapAdd(winX)) break;
    }
  });
  HookBus.on('preSpin', () => {
    if (WIN_CAP_MODE === 'spin') winCapReset();
  });
  HookBus.on('onFsTrigger', () => { winCapReset(); });
  HookBus.on('onFsEnd',     () => { winCapReset(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
