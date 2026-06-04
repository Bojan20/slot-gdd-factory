/**
 * src/blocks/uiToast.mjs
 *
 * Wave U3 — Unified UI toast block.
 *
 * Centralised "celebration" overlay for win tiers and feature triggers.
 * Replaces per-block ad-hoc divs (lightning banner, respin banner,
 * bonus-buy flash) with one queue-based toast renderer so the visual
 * cadence is consistent across the whole slot template.
 *
 * Tier vocabulary:
 *
 *   BIG  WIN   sum payX ≥ bigWinThresholdX        (default 10x)
 *   MEGA WIN   sum payX ≥ megaWinThresholdX       (default 50x)
 *   EPIC WIN   sum payX ≥ epicWinThresholdX       (default 250x)
 *   FEATURE    feature trigger banner             (RESPIN! / LIGHTNING! / etc)
 *   NEUTRAL    informational toast                (e.g. round number)
 *
 * Lifecycle (HookBus contract):
 *
 *   postSpin       → pick win tier, queue toast if payX crosses threshold
 *   onFsTrigger    → queue "FREE SPINS!" toast
 *   onFsEnd        → optional total summary toast (queueOnFsEnd flag)
 *
 * Plus direct runtime API for blocks that fire ad-hoc feature toasts:
 *   uiShowToast(label, opts?)     queue a toast (label, tier, ms, payload)
 *   uiClearToasts()               flush the queue + hide current
 *   uiGetQueueLength()            current queue depth (for tests)
 *   TOAST_STATE                   { current, queue, paused }
 *
 * Composition contract:
 *   - winPresentation handles per-spin small-win pulse (sub-BIG)
 *   - winCap owns its own MAX WIN! overlay (different z-layer / lifetime)
 *   - audio block emits sound cues independently (postSpin tier selector
 *     is duplicated by design — visual+sound are independent LEGO blocks
 *     that both react to the same lifecycle event)
 *
 * Bake-time config (resolved from `model.uiToast`):
 *   { enabled, bigWinThresholdX, megaWinThresholdX, epicWinThresholdX,
 *     bigDurationMs, megaDurationMs, epicDurationMs, featureDurationMs,
 *     queueOnFsEnd, fsTriggerLabel,
 *     colors: { big, mega, epic, feature, neutral }, maxQueue }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitUiToastCSS(cfg)       → toast container + tier classes + keyframes
 *   emitUiToastMarkup(cfg)    → host div
 *   emitUiToastRuntime(cfg)   → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *   uiShowToast / uiClearToasts / uiGetQueueLength / TOAST_STATE on window.
 *
 * Runtime dependencies: HookBus, document (toast host), setTimeout.
 */

const TIERS = Object.freeze(['big', 'mega', 'epic', 'feature', 'neutral']);

export function defaultConfig() {
  return {
    enabled: false,
    /* Tier thresholds — duplicated from audio block by design. Visual
       and auditory cues are independent blocks. */
    bigWinThresholdX:  10,
    megaWinThresholdX: 50,
    epicWinThresholdX: 250,
    /* Per-tier toast lifetimes. Industry baseline: BIG ~1.8s, MEGA ~2.4s,
       EPIC ~3.2s, feature triggers ~1.4s. */
    bigDurationMs:     1800,
    megaDurationMs:    2400,
    epicDurationMs:    3200,
    featureDurationMs: 1400,
    /* Whether to queue a "FS COMPLETE" toast at the end of a FS round. */
    queueOnFsEnd: true,
    /* Label fired on onFsTrigger. */
    fsTriggerLabel: 'FREE SPINS!',
    /* Color palette — "r,g,b" each. */
    colors: {
      big:     '255,210,90',
      mega:    '210,120,255',
      epic:    '255,80,140',
      feature: '110,200,255',
      neutral: '255,255,255',
    },
    /* Max in-flight queue length. Older toasts get dropped past this so a
       feature-spam spin doesn't leave the player staring at the queue. */
    maxQueue: 6,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.uiToast) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (Number.isFinite(m.bigWinThresholdX))  cfg.bigWinThresholdX  = clampInt(m.bigWinThresholdX,  1, 100000);
  if (Number.isFinite(m.megaWinThresholdX)) cfg.megaWinThresholdX = clampInt(m.megaWinThresholdX, cfg.bigWinThresholdX + 1, 1000000);
  if (Number.isFinite(m.epicWinThresholdX)) cfg.epicWinThresholdX = clampInt(m.epicWinThresholdX, cfg.megaWinThresholdX + 1, 10000000);

  if (Number.isFinite(m.bigDurationMs))     cfg.bigDurationMs     = clampInt(m.bigDurationMs,     400, 12000);
  if (Number.isFinite(m.megaDurationMs))    cfg.megaDurationMs    = clampInt(m.megaDurationMs,    400, 12000);
  if (Number.isFinite(m.epicDurationMs))    cfg.epicDurationMs    = clampInt(m.epicDurationMs,    400, 14000);
  if (Number.isFinite(m.featureDurationMs)) cfg.featureDurationMs = clampInt(m.featureDurationMs, 300, 8000);

  if (m.queueOnFsEnd != null) cfg.queueOnFsEnd = !!m.queueOnFsEnd;
  if (typeof m.fsTriggerLabel === 'string' && m.fsTriggerLabel.length > 0 && m.fsTriggerLabel.length <= 32) {
    cfg.fsTriggerLabel = m.fsTriggerLabel;
  }
  if (Number.isFinite(m.maxQueue)) cfg.maxQueue = clampInt(m.maxQueue, 1, 32);

  if (m.colors && typeof m.colors === 'object') {
    for (const tier of TIERS) {
      const c = m.colors[tier];
      if (typeof c === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(c)) {
        cfg.colors[tier] = c;
      }
    }
  }

  /* Auto-enable from feature kinds — 'ui_toast' explicit or any of the
     tier-driving feature kinds when the slot already has them wired. */
  if (Array.isArray(model.features) && model.features.some(f =>
    f.kind === 'ui_toast' || f.kind === 'win_celebration' || f.kind === 'big_win' || f.kind === 'mega_win'
  )) {
    cfg.enabled = true;
  }

  return cfg;
}

export function emitUiToastCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.colors;
  return `
/* ─── ui toast (Wave U3) ─────────────────────────────────────────── */
.ui-toast-host {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 95;
  pointer-events: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
}
.ui-toast {
  position: absolute;
  pointer-events: none;
  background: rgba(0,0,0,.72);
  border: 2.5px solid rgba(255,255,255,.6);
  border-radius: 18px;
  padding: 1.2rem 2.4rem;
  color: #fff;
  font-size: 2.2rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-align: center;
  text-shadow: 0 0 14px rgba(255,255,255,.6);
  box-shadow: 0 0 60px rgba(255,255,255,.45);
  opacity: 0;
  transform: scale(0.6);
  transition: none;
  white-space: nowrap;
}
.ui-toast .ui-toast-amount {
  display: block;
  font-size: 0.62em;
  font-weight: 800;
  letter-spacing: 0.18em;
  margin-top: 0.45rem;
  opacity: 0.92;
}
.ui-toast[data-show="true"]                 { animation: uiToastIn 380ms cubic-bezier(.4,1.55,.5,1) forwards; }
.ui-toast[data-show="exit"]                 { animation: uiToastOut 320ms ease-in forwards; }
.ui-toast[data-tier="big"]      { border-color: rgba(${c.big},.95);     color: rgba(${c.big},1);     box-shadow: 0 0 70px rgba(${c.big},.55);     text-shadow: 0 0 18px rgba(${c.big},.8); }
.ui-toast[data-tier="mega"]     { border-color: rgba(${c.mega},.95);    color: rgba(${c.mega},1);    box-shadow: 0 0 80px rgba(${c.mega},.6);     text-shadow: 0 0 22px rgba(${c.mega},.85); font-size: 2.7rem; }
.ui-toast[data-tier="epic"]     { border-color: rgba(${c.epic},.95);    color: rgba(${c.epic},1);    box-shadow: 0 0 100px rgba(${c.epic},.7);    text-shadow: 0 0 26px rgba(${c.epic},.9);  font-size: 3.2rem; }
.ui-toast[data-tier="feature"]  { border-color: rgba(${c.feature},.85); color: rgba(${c.feature},1); box-shadow: 0 0 40px rgba(${c.feature},.45); text-shadow: 0 0 12px rgba(${c.feature},.7); font-size: 1.6rem; padding: 0.8rem 1.6rem; }
.ui-toast[data-tier="neutral"]  { border-color: rgba(${c.neutral},.55); color: rgba(${c.neutral},1); }
@keyframes uiToastIn {
  0%   { opacity: 0; transform: scale(0.6) translateY(-30px); }
  60%  { opacity: 1; transform: scale(1.08) translateY(0); }
  100% { opacity: 1; transform: scale(1)    translateY(0); }
}
@keyframes uiToastOut {
  0%   { opacity: 1; transform: scale(1)   translateY(0); }
  100% { opacity: 0; transform: scale(0.85) translateY(-12px); }
}
/* Epic-tier flash overlay — adds a brief screen flash behind the toast.
   Pure CSS, no DOM node needed. */
.ui-toast-host.is-epic::before {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at center, rgba(${c.epic},.18), rgba(${c.epic},0) 60%);
  pointer-events: none;
  animation: uiToastEpicFlash 1200ms ease-out forwards;
  z-index: -1;
}
@keyframes uiToastEpicFlash {
  0%   { opacity: 0; }
  20%  { opacity: 1; }
  100% { opacity: 0; }
}
@media (max-width: 620px) {
  .ui-toast              { font-size: 1.6rem; padding: 0.9rem 1.6rem; }
  .ui-toast[data-tier="mega"] { font-size: 1.9rem; }
  .ui-toast[data-tier="epic"] { font-size: 2.2rem; }
  .ui-toast[data-tier="feature"] { font-size: 1.2rem; padding: 0.6rem 1.1rem; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-toast[data-show="true"], .ui-toast[data-show="exit"] { animation: none; opacity: 1; transform: none; }
  .ui-toast-host.is-epic::before { animation: none; opacity: 0; }
}
`;
}

export function emitUiToastMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="uiToastHost" class="ui-toast-host" aria-live="polite" aria-atomic="true"></div>`;
}

export function emitUiToastRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* uiToast: disabled */`;
  return `/* ─── ui toast runtime (Wave U3) ─────────────────────────────────── */
const TOAST_BIG_X       = ${cfg.bigWinThresholdX};
const TOAST_MEGA_X      = ${cfg.megaWinThresholdX};
const TOAST_EPIC_X      = ${cfg.epicWinThresholdX};
const TOAST_DUR_BIG     = ${cfg.bigDurationMs};
const TOAST_DUR_MEGA    = ${cfg.megaDurationMs};
const TOAST_DUR_EPIC    = ${cfg.epicDurationMs};
const TOAST_DUR_FEATURE = ${cfg.featureDurationMs};
const TOAST_MAX_QUEUE   = ${cfg.maxQueue};
const TOAST_FS_LABEL    = ${JSON.stringify(cfg.fsTriggerLabel)};
const TOAST_QUEUE_FS_END = ${cfg.queueOnFsEnd ? 'true' : 'false'};
const TOAST_STATE = { current: null, queue: [], paused: false };

function _toastDurFor(tier) {
  if (tier === 'big')     return TOAST_DUR_BIG;
  if (tier === 'mega')    return TOAST_DUR_MEGA;
  if (tier === 'epic')    return TOAST_DUR_EPIC;
  if (tier === 'feature') return TOAST_DUR_FEATURE;
  return TOAST_DUR_FEATURE;
}

function _toastTierFromPayX(payX) {
  if (!Number.isFinite(payX) || payX <= 0)     return null;
  if (payX >= TOAST_EPIC_X)                    return 'epic';
  if (payX >= TOAST_MEGA_X)                    return 'mega';
  if (payX >= TOAST_BIG_X)                     return 'big';
  return null;
}

function _toastEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function _toastRenderCurrent() {
  const host = document.getElementById('uiToastHost');
  if (!host) return;
  /* Remove the prior node if still in DOM */
  while (host.firstChild) host.removeChild(host.firstChild);
  host.classList.remove('is-epic');
  if (!TOAST_STATE.current) return;
  const item = TOAST_STATE.current;
  const node = document.createElement('div');
  node.className = 'ui-toast';
  node.dataset.tier = item.tier;
  node.dataset.show = 'true';
  let html = _toastEscape(item.label);
  if (item.amount != null && Number.isFinite(item.amount) && item.amount > 0) {
    html += '<span class="ui-toast-amount">×' + Number(item.amount).toFixed(2).replace(/\\.00$/, '') + '</span>';
  }
  node.innerHTML = html;
  host.appendChild(node);
  if (item.tier === 'epic') host.classList.add('is-epic');
  /* Schedule exit animation + dequeue */
  const dur = _toastDurFor(item.tier);
  setTimeout(() => {
    node.dataset.show = 'exit';
    setTimeout(() => {
      if (node.parentNode === host) host.removeChild(node);
      host.classList.remove('is-epic');
      TOAST_STATE.current = null;
      _toastDrainQueue();
    }, 360);
  }, dur);
}

function _toastDrainQueue() {
  if (TOAST_STATE.paused) return;
  if (TOAST_STATE.current) return;
  const next = TOAST_STATE.queue.shift();
  if (!next) return;
  TOAST_STATE.current = next;
  _toastRenderCurrent();
}

function uiShowToast(label, opts) {
  if (typeof label !== 'string' || label.length === 0) return false;
  if (label.length > 64) label = label.slice(0, 64);
  const o = opts || {};
  let tier = o.tier;
  if (!['big', 'mega', 'epic', 'feature', 'neutral'].includes(tier)) tier = 'feature';
  const item = {
    label,
    tier,
    amount: (Number.isFinite(o.amount) && o.amount > 0) ? o.amount : null,
    ts: Date.now(),
  };
  TOAST_STATE.queue.push(item);
  /* Cap queue length — drop oldest non-current to keep the stack sane. */
  while (TOAST_STATE.queue.length > TOAST_MAX_QUEUE) TOAST_STATE.queue.shift();
  _toastDrainQueue();
  return true;
}

function uiClearToasts() {
  TOAST_STATE.queue.length = 0;
  TOAST_STATE.current = null;
  const host = document.getElementById('uiToastHost');
  if (host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.classList.remove('is-epic');
  }
}

function uiGetQueueLength() { return TOAST_STATE.queue.length + (TOAST_STATE.current ? 1 : 0); }

if (typeof window !== 'undefined') {
  window.uiShowToast      = uiShowToast;
  window.uiClearToasts    = uiClearToasts;
  window.uiGetQueueLength = uiGetQueueLength;
  window.TOAST_STATE      = TOAST_STATE;
}

/* HookBus wire-up — win tier toast on postSpin, FS trigger banner on
   onFsTrigger, optional FS COMPLETE on onFsEnd. Sub-BIG wins emit no
   toast — winPresentation handles them with cell pulses. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('postSpin', ({ events } = {}) => {
    if (!Array.isArray(events) || events.length === 0) return;
    const totalX = events.reduce((a, e) => a + (Number(e && e.payX) || 0), 0);
    const tier = _toastTierFromPayX(totalX);
    if (!tier) return;
    const label = tier === 'epic' ? 'EPIC WIN'
                : tier === 'mega' ? 'MEGA WIN'
                                  : 'BIG WIN';
    uiShowToast(label, { tier, amount: totalX });
  });
  HookBus.on('onFsTrigger', () => {
    uiShowToast(TOAST_FS_LABEL, { tier: 'feature' });
  });
  HookBus.on('onFsEnd', ({ totalWin } = {}) => {
    if (!TOAST_QUEUE_FS_END) return;
    const tw = Number(totalWin);
    if (Number.isFinite(tw) && tw > 0) {
      uiShowToast('FS COMPLETE', { tier: 'feature', amount: tw });
    } else {
      uiShowToast('FS COMPLETE', { tier: 'feature' });
    }
  });
  /* preSpin: if a toast is still hanging when the player clicks SPIN
     again (cabinet rapid play), drop the queue so we don't pile up. */
  HookBus.on('preSpin', () => {
    if (TOAST_STATE.queue.length > 1) {
      /* Keep the currently-displayed toast; drop the queue tail. */
      TOAST_STATE.queue.length = 1;
    }
  });
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export const TOAST_TIERS = TIERS;
