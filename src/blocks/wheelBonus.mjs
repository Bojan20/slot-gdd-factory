/**
 * src/blocks/wheelBonus.mjs
 *
 * Wave O2 — Wheel Bonus / Wheel of Fortune mini-game block.
 *
 * Overlay with a wheel of N segments. Spin button spins the wheel,
 * easing decel, pointer reveals the winning segment. Industry baseline:
 * spin-wheel bonus pattern — N-segment wheel with ease-out decel.
 *
 * GDD knobs:
 *   • segments: array of { label, value, color }
 *   • spinDurationMs: number
 *   • haloColor: 'r,g,b'
 *   • autoSpin: boolean (true = auto-fire on open, no Spin button)
 *   • title: string
 */

export function defaultConfig() {
  return {
    enabled: false,
    segments: [
      { label: '×2',  value: 2,  color: '#e8c270' },
      { label: '×5',  value: 5,  color: '#d28a3a' },
      { label: '×10', value: 10, color: '#c45050' },
      { label: '×20', value: 20, color: '#7050c4' },
      { label: '×50', value: 50, color: '#3aa0c2' },
      { label: '×100', value: 100, color: '#2bb56b' },
      { label: '×500', value: 500, color: '#e84f8a' },
      { label: '×1000', value: 1000, color: '#ffd24a' },
    ],
    spinDurationMs: 3800,
    haloColor: '255,210,90',
    autoSpin: false,
    title: 'BONUS WHEEL',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.wheelBonus || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Array.isArray(m.segments) && m.segments.length >= 3 && m.segments.every(s => s && typeof s.label === 'string')) {
    cfg.segments = m.segments.slice(0, 24).map(s => {
      const out = {
        label: s.label.slice(0, 10),
        value: Number.isFinite(s.value) ? s.value : 0,
        color: (typeof s.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.color)) ? s.color : '#c0a850',
      };
      /* Wave H15 — preserve optional jackpotTier label (e.g. 'GRAND')
       * so the weightedWheelSegments extension can read it from the
       * baked segments JSON. Defensive: only safe label format. */
      if (typeof s.jackpotTier === 'string' && /^[A-Z0-9_ -]{1,16}$/.test(s.jackpotTier)) {
        out.jackpotTier = s.jackpotTier;
      }
      return out;
    });
  }
  if (Number.isFinite(m.spinDurationMs)) cfg.spinDurationMs = clampInt(m.spinDurationMs, 800, 12000);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (m.autoSpin != null) cfg.autoSpin = !!m.autoSpin;
  if (typeof m.title === 'string' && m.title.length > 0 && m.title.length <= 40) cfg.title = m.title;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'wheel_bonus')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitWheelBonusCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── wheel bonus ───────────────────────────────────────────────── */
.wb-overlay {
  position: fixed;
  inset: 0;
  z-index: 92;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.86);
  backdrop-filter: blur(8px);
}
.wb-overlay[data-show="true"] { display: flex; }
.wb-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.wb-title {
  font-size: 1.3rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 12px rgba(${cfg.haloColor},.7);
}
.wb-stage {
  position: relative;
  width: min(420px, 86vw);
  aspect-ratio: 1;
}
.wb-pointer {
  position: absolute;
  top: -10px; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 14px solid transparent;
  border-right: 14px solid transparent;
  border-top: 28px solid rgba(${cfg.haloColor},1);
  z-index: 3;
  filter: drop-shadow(0 0 8px rgba(${cfg.haloColor},.8));
}
.wb-wheel {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 4px solid rgba(${cfg.haloColor},.7);
  box-shadow: 0 0 38px rgba(${cfg.haloColor},.45);
  transform: rotate(0deg);
  transition: transform var(--wb-dur, 3800ms) cubic-bezier(.2,.6,.1,1);
  overflow: hidden;
}
.wb-seg {
  position: absolute;
  width: 50%; height: 50%;
  top: 0; left: 50%;
  transform-origin: 0% 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  color: #1a1010;
  font-weight: 900;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 2px rgba(255,255,255,.4);
  clip-path: polygon(0 100%, 0 0, 100% 0);
}
.wb-spin {
  background: linear-gradient(135deg, rgba(${cfg.haloColor},1), rgba(${cfg.haloColor},.65));
  color: #1a1010;
  border: none;
  border-radius: 12px;
  padding: 0.75rem 1.7rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  font-size: 0.95rem;
  cursor: pointer;
  box-shadow: 0 0 16px rgba(${cfg.haloColor},.5);
}
.wb-spin:disabled { opacity: 0.6; cursor: not-allowed; }
.wb-result {
  font-size: 1.4rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 14px rgba(${cfg.haloColor},.8);
  min-height: 1.6rem;
}
.wb-close {
  background: rgba(255,255,255,.12);
  color: #fff;
  border: 1px solid rgba(255,255,255,.3);
  border-radius: 10px;
  padding: 0.55rem 1.4rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  cursor: pointer;
  display: none;
}
.wb-close[data-show="true"] { display: inline-block; }
`;
}

export function emitWheelBonusMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const n = cfg.segments.length;
  const segDeg = 360 / n;
  const segs = cfg.segments.map((s, i) => {
    const rotate = i * segDeg;
    return `<div class="wb-seg" style="transform: rotate(${rotate}deg) skewY(-${90 - segDeg}deg); background:${s.color}"><span style="transform: skewY(${90 - segDeg}deg) rotate(${segDeg / 2}deg); display:inline-block;">${escapeHtml(s.label)}</span></div>`;
  }).join('');
  return `<div id="wbOverlay" class="wb-overlay" data-show="false" role="dialog" aria-modal="true" aria-labelledby="wbTitle">
  <div class="wb-modal">
    <div id="wbTitle" class="wb-title">${escapeHtml(cfg.title)}</div>
    <div class="wb-stage">
      <div class="wb-pointer" aria-hidden="true"></div>
      <div id="wbWheel" class="wb-wheel" style="--wb-dur:${cfg.spinDurationMs}ms;">${segs}</div>
    </div>
    <div id="wbResult" class="wb-result" aria-live="polite"></div>
    <button id="wbSpin" class="wb-spin" type="button">SPIN</button>
    <button id="wbClose" class="wb-close" data-show="false" type="button">COLLECT</button>
  </div>
</div>`;
}

export function emitWheelBonusRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* wheelBonus: disabled */`;
  return `/* ─── wheel bonus runtime ─────────────────────────────────────── */
const WB_SEGMENTS = ${JSON.stringify(cfg.segments)};
const WB_DUR = ${cfg.spinDurationMs};
const WB_AUTO = ${cfg.autoSpin ? 'true' : 'false'};
const WB_STATE = { active: false, spinning: false, result: null };

function wbOpen() {
  if (WB_STATE.active) return;
  WB_STATE.active = true;
  WB_STATE.result = null;
  const ov = document.getElementById('wbOverlay');
  if (ov) ov.dataset.show = 'true';
  const wheel = document.getElementById('wbWheel');
  if (wheel) wheel.style.transform = 'rotate(0deg)';
  const result = document.getElementById('wbResult');
  if (result) result.textContent = '';
  const spinBtn = document.getElementById('wbSpin');
  if (spinBtn) { spinBtn.disabled = false; spinBtn.style.display = 'inline-block'; }
  const closeBtn = document.getElementById('wbClose');
  if (closeBtn) closeBtn.dataset.show = 'false';
  if (WB_AUTO) setTimeout(wbSpin, 250);
}

function wbSpin() {
  if (!WB_STATE.active || WB_STATE.spinning) return;
  WB_STATE.spinning = true;
  const segDeg = 360 / WB_SEGMENTS.length;
  const winIdx = Math.floor(Math.random() * WB_SEGMENTS.length);
  WB_STATE.result = WB_SEGMENTS[winIdx];
  const targetDeg = -(winIdx * segDeg) - (segDeg / 2) + (360 * 6); // 6 full spins
  const wheel = document.getElementById('wbWheel');
  if (wheel) wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
  const spinBtn = document.getElementById('wbSpin');
  if (spinBtn) spinBtn.disabled = true;
  setTimeout(() => {
    WB_STATE.spinning = false;
    const result = document.getElementById('wbResult');
    if (result) result.textContent = 'YOU WON ' + WB_STATE.result.label + '!';
    const closeBtn = document.getElementById('wbClose');
    if (closeBtn) closeBtn.dataset.show = 'true';
    if (spinBtn) spinBtn.style.display = 'none';
  }, WB_DUR + 80);
}

function wbClose() {
  WB_STATE.active = false;
  WB_STATE.spinning = false;
  const ov = document.getElementById('wbOverlay');
  if (ov) ov.dataset.show = 'false';
}

document.addEventListener('DOMContentLoaded', () => {
  const sb = document.getElementById('wbSpin');
  if (sb) sb.addEventListener('click', wbSpin);
  const cb = document.getElementById('wbClose');
  if (cb) cb.addEventListener('click', wbClose);
});

if (typeof window !== 'undefined') {
  window.wbOpen      = wbOpen;
  window.wbSpin      = wbSpin;
  window.wbClose     = wbClose;
  window.WB_STATE    = WB_STATE;
  /* Wave H15 — expose the bakeline segments + duration so the
   * weightedWheelSegments extension can read the live config without
   * baking a duplicate copy. */
  window.WB_SEGMENTS = WB_SEGMENTS;
  window.WB_DUR      = WB_DUR;
}

/* HookBus wire-up — wheel modal is opened explicitly by parser-side
   trigger logic; HookBus listeners ensure the modal closes safely at FS
   boundaries so it can't leak into the next round. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('onFsTrigger', () => { if (WB_STATE.open) wbClose(); });
  HookBus.on('onFsEnd',     () => { if (WB_STATE.open) wbClose(); });
  /* 2026-06-10 (Boki: "wheel mi ne radi, force") — UFP chip emits
   * onForceFeatureRequested but wheelBonus never had a listener, so
   * clicking the WHEEL chip only painted the generic banner. Open the
   * actual modal now so the chip behaves like every other force CTA. */
  HookBus.on('onForceFeatureRequested', (payload) => {
    if (!payload || payload.kind !== 'wheel_bonus') return;
    try { wbOpen(); } catch (_) { /* defensive */ }
  });
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
