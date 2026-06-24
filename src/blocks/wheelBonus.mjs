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

/* Hoisted constants — senior contract "0 magic numbers" so tuning,
 * audit, and theming are all traceable from one place. Referenced from
 * both the resolve path and the emit (CSS / runtime) paths. */
const WB = {
  MIN_DUR_MS: 800,
  MAX_DUR_MS: 12000,
  MAX_SEGMENTS: 24,
  MAX_LABEL_LEN: 10,
  MAX_TITLE_LEN: 40,
  OVERLAY_Z: 92,
  SPIN_REVOLUTIONS: 6,
  ANIM_TAIL_MS: 80,
  AUTO_DELAY_MS: 250,
  FALLBACK_SEG_COLOR: '#c0a850',
  MIN_SEGMENTS: 4,
};

export function defaultConfig() {
  return Object.freeze({
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
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.wheelBonus || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  /* Floor raised to WB.MIN_SEGMENTS (4) — CSS wedge geometry uses
   * skewY(-(90 - segDeg)); for n<4 segDeg≥90 so the skew goes
   * non-negative and slices render inverted/overlapping. */
  if (Array.isArray(m.segments) && m.segments.length >= WB.MIN_SEGMENTS && m.segments.every(s => s && typeof s.label === 'string')) {
    cfg.segments = m.segments.slice(0, WB.MAX_SEGMENTS).map(s => {
      const out = {
        label: s.label.slice(0, WB.MAX_LABEL_LEN),
        value: Number.isFinite(s.value) ? s.value : 0,
        color: (typeof s.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.color)) ? s.color : WB.FALLBACK_SEG_COLOR,
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
  if (Number.isFinite(m.spinDurationMs)) cfg.spinDurationMs = clampInt(m.spinDurationMs, WB.MIN_DUR_MS, WB.MAX_DUR_MS);
  /* Defensive-input rule: regex confirms shape, then clamp components
   * to the 0–255 RGB gamut — `999,999,999` matches the regex but is
   * invalid colour data and renders unpredictably across engines. */
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) {
    const parts = m.haloColor.split(',').map(Number);
    if (parts.every(n => Number.isFinite(n) && n >= 0 && n <= 255)) cfg.haloColor = parts.join(',');
  }
  if (m.autoSpin != null) cfg.autoSpin = !!m.autoSpin;
  if (typeof m.title === 'string' && m.title.length > 0 && m.title.length <= WB.MAX_TITLE_LEN) cfg.title = m.title;

  /* UQ-DEEP-S HIGH-7 fix (P2): features[].config inheritance. Parser emit
   * `features:[{kind:'wheel_bonus', config:{segments, spinDurationMs,
   * title}}]` — pre fix samo auto-enable, segments/duration/title silent
   * drop unless author writes model.wheelBonus.* explicitly. */
  if (Array.isArray(model.features)) {
    const f = model.features.find(x => x && (x.kind === 'wheel_bonus' || x.kind === 'wheelBonus'));
    if (f) {
      cfg.enabled = true;
      const fc = f.config || f.opts || {};
      if (Array.isArray(fc.segments) && fc.segments.length >= WB.MIN_SEGMENTS
          && fc.segments.every(s => s && typeof s.label === 'string')
          && !Array.isArray(m.segments)) {
        cfg.segments = fc.segments.slice(0, WB.MAX_SEGMENTS).map(s => ({
          label: s.label.slice(0, WB.MAX_LABEL_LEN),
          value: Number.isFinite(s.value) ? s.value : 0,
          color: (typeof s.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.color)) ? s.color : WB.FALLBACK_SEG_COLOR,
        }));
      }
      if (Number.isFinite(fc.spinDurationMs) && m.spinDurationMs == null) {
        cfg.spinDurationMs = clampInt(fc.spinDurationMs, WB.MIN_DUR_MS, WB.MAX_DUR_MS);
      }
      if (typeof fc.title === 'string' && fc.title.length > 0 && fc.title.length <= WB.MAX_TITLE_LEN
          && m.title == null) cfg.title = fc.title;
    }
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
  z-index: ${WB.OVERLAY_Z};
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.86);
}
/* @supports gate — backdrop-filter is a known jank trigger on browsers
 * that fall back to software compositing; opt in only when supported. */
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .wb-overlay { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
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
/* WCAG 2.4.7 (F4 A2) — focus ring */
.wb-spin:focus-visible { outline: 2px solid rgba(${cfg.haloColor}, 0.95); outline-offset: 2px; }
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
/* WCAG 2.4.7 (F4 A2) — focus ring */
.wb-close:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.95); outline-offset: 2px; }

/* Fable audit (critical, accessibility): vestibular users must not
 * receive the 3.8s rotation animation. Collapse all transitions and
 * heavy transforms when the OS reports reduced-motion preference. */
@media (prefers-reduced-motion: reduce) {
  .wb-wheel { transition: none !important; }
  .wb-overlay { transition: none !important; }
}
`;
}

export function emitWheelBonusMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const n = cfg.segments.length;
  const segDeg = 360 / n;
  /* Clamp skew defensively: when segDeg >= 90 (n<4) the CSS triangle
   * clip flips; resolveConfig already enforces n >= WB.MIN_SEGMENTS but
   * direct emit callers might bypass it. Floor at a tiny positive
   * value to keep skew strictly negative. */
  const skew = Math.max(0.0001, 90 - segDeg);
  const segs = cfg.segments.map((s, i) => {
    const rotate = i * segDeg;
    return `<div class="wb-seg" style="transform: rotate(${rotate}deg) skewY(-${skew}deg); background:${s.color}"><span style="transform: skewY(${skew}deg) rotate(${segDeg / 2}deg); display:inline-block;">${escapeHtml(s.label)}</span></div>`;
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
// Perf budget: ≤ 1 paint per frame, ≤ 8ms scripting/frame on mid-tier
// mobile; backdrop-filter is gated behind @supports to avoid jank on
// unsupported browsers.
// Canonical HookBus events:
//   wheelBonus.open     (host → UI)  open the modal
//   wheelBonus.close    (host → UI)  close the modal
//   wheelBonus.request  (host → UI)  ask UI to start a spin
//   wheelBonus.spin     (UI → math)  UI requests a draw from math layer
//   wheelBonus.result   (math → UI)  math returns { segmentIndex }
//   wheelBonus.complete (UI → host)  fired after settle with { value, label }
const WB_SEGMENTS = ${JSON.stringify(cfg.segments).replace(/</g, '\\u003c')};
const WB_DUR = ${cfg.spinDurationMs};
const WB_AUTO = ${cfg.autoSpin ? 'true' : 'false'};
const WB_REVS = ${WB.SPIN_REVOLUTIONS};
const WB_SETTLE_MS = ${WB.ANIM_TAIL_MS};
const WB_AUTO_DELAY_MS = ${WB.AUTO_DELAY_MS};
const WB_STATE = { active: false, spinning: false, result: null };
function _wbReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* Fable audit (critical, a11y): the dialog declared role="dialog" +
 * aria-modal="true" but had NO focus trap, NO Escape handler, and NO
 * focus restoration — so screen-reader and keyboard-only users could
 * tab out of the modal and lose context. Track the previously-focused
 * element and restore it on close; Escape closes when not mid-spin. */
let WB_PRIOR_FOCUS = null;
function _wbTrapFocus(e) {
  if (!WB_STATE.active) return;
  if (e.key === 'Escape' && !WB_STATE.spinning) { wbClose(); return; }
  if (e.key !== 'Tab') return;
  const ov = document.getElementById('wbOverlay');
  if (!ov) return;
  const focusables = ov.querySelectorAll('button:not([disabled])');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function wbOpen() {
  if (WB_STATE.active) return;
  WB_STATE.active = true;
  WB_STATE.result = null;
  WB_PRIOR_FOCUS = document.activeElement;
  const ov = document.getElementById('wbOverlay');
  if (ov) ov.dataset.show = 'true';
  const wheel = document.getElementById('wbWheel');
  if (wheel) wheel.style.transform = 'rotate(0deg)';
  const result = document.getElementById('wbResult');
  if (result) result.textContent = '';
  const spinBtn = document.getElementById('wbSpin');
  if (spinBtn) { spinBtn.disabled = false; spinBtn.style.display = 'inline-block'; spinBtn.focus(); }
  const closeBtn = document.getElementById('wbClose');
  if (closeBtn) closeBtn.dataset.show = 'false';
  document.addEventListener('keydown', _wbTrapFocus, true);
  /* Announce so extensions (e.g. weightedWheelSegments) can repaint
   * tier badges every time the modal opens — wheelBonus may rebuild
   * .wb-seg nodes on re-entry. */
  if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
    try { HookBus.emit('onWheelModalOpened', {}); } catch (_) {}
  }
  if (WB_AUTO) setTimeout(wbSpin, WB_AUTO_DELAY_MS);
}

/* Single-owner rule: UI does NOT draw the winning segment. wbSpin
 * arms the spin and emits wheelBonus.spin; the math layer answers with
 * wheelBonus.result { segmentIndex } and wbAnimateTo runs the visual.
 *
 * 2026-06-16 (Boki: "Wheel bonus ne radi, ne radi spin"): the math layer
 * is GATED in the current pre-math phase, so nobody answers wheelBonus.spin
 * and the wheel never rotates. To keep the UI playable without breaking
 * the single-owner contract, install a FALLBACK timer: if no wheelBonus.result
 * arrives within WB_FALLBACK_MS, the UI draws uniformly random from the
 * baked segments and self-animates. Math-layer integrators (when wired)
 * will still race the fallback — their wbAnimateTo call cancels the timer. */
var WB_FALLBACK_TIMER = null;
var WB_FALLBACK_MS = 250;

function _wbCancelFallback() {
  if (WB_FALLBACK_TIMER) {
    try { clearTimeout(WB_FALLBACK_TIMER); } catch (_) {}
    WB_FALLBACK_TIMER = null;
  }
}

function _wbFallbackDraw() {
  WB_FALLBACK_TIMER = null;
  if (!WB_STATE.active || !WB_STATE.spinning) return;
  if (!Array.isArray(WB_SEGMENTS) || WB_SEGMENTS.length === 0) return;
  /* WAVE Y4 force-guard (Boki 2026-06-20 "dalje"): if UFP set
   * __FORCE_WHEEL_SEGMENT__, land on that exact index. One-shot. */
  var idx;
  try {
    var _force = window.__FORCE_WHEEL_SEGMENT__;
    if (Number.isInteger(_force) && _force >= 0 && _force < WB_SEGMENTS.length) {
      idx = _force;
      window.__FORCE_WHEEL_SEGMENT__ = null;
    } else {
      idx = Math.floor(Math.random() * WB_SEGMENTS.length);
    }
  } catch (_) {
    idx = Math.floor(Math.random() * WB_SEGMENTS.length);
  }
  if (typeof console !== 'undefined' && console.debug) {
    try { console.debug('[wheelBonus] math layer silent; UI fallback draw idx=' + idx); } catch (_) {}
  }
  try { wbAnimateTo(idx); } catch (_) {}
}

function wbSpin() {
  if (!WB_STATE.active || WB_STATE.spinning) return;
  WB_STATE.spinning = true;
  const spinBtn = document.getElementById('wbSpin');
  if (spinBtn) spinBtn.disabled = true;
  if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
    try { HookBus.emit('wheelBonus.spin', {}); } catch (_) {}
  }
  /* Arm fallback — math layer or any other resolver has WB_FALLBACK_MS
   * to call wbAnimateTo via wheelBonus.result. After that, UI self-draws. */
  _wbCancelFallback();
  WB_FALLBACK_TIMER = setTimeout(_wbFallbackDraw, WB_FALLBACK_MS);
}

function wbAnimateTo(winIdx) {
  if (!WB_STATE.active) return;
  /* Any caller (math layer or fallback) reaching wbAnimateTo means the
   * draw has resolved — cancel the pending fallback so we never race. */
  _wbCancelFallback();
  if (!(Number.isInteger(winIdx) && winIdx >= 0 && winIdx < WB_SEGMENTS.length)) winIdx = 0;
  WB_STATE.spinning = true;
  const segDeg = 360 / WB_SEGMENTS.length;
  WB_STATE.result = WB_SEGMENTS[winIdx];
  const targetDeg = -(winIdx * segDeg) - (segDeg / 2) + (360 * WB_REVS);
  const wheel = document.getElementById('wbWheel');
  const spinBtn = document.getElementById('wbSpin');
  const reduce = _wbReducedMotion();
  if (wheel) {
    if (reduce) {
      /* Snap with no transition; settle fires synchronously below. */
      const prev = wheel.style.transition;
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
      void wheel.offsetWidth;
      wheel.style.transition = prev;
    } else {
      wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
    }
  }
  const settle = () => {
    WB_STATE.spinning = false;
    const result = document.getElementById('wbResult');
    if (result) result.textContent = 'YOU WON ' + WB_STATE.result.label + '!';
    const closeBtn = document.getElementById('wbClose');
    if (closeBtn) closeBtn.dataset.show = 'true';
    if (spinBtn) spinBtn.style.display = 'none';
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      try { HookBus.emit('onWheelSettled', { index: winIdx, segment: WB_STATE.result }); } catch (_) {}
      try { HookBus.emit('wheelBonus.complete', { value: WB_STATE.result.value, label: WB_STATE.result.label }); } catch (_) {}
    }
  };
  if (reduce) settle();
  else setTimeout(settle, WB_DUR + WB_SETTLE_MS);
}

function wbClose() {
  /* Cancel any pending fallback so a late timer doesn't fire after close. */
  _wbCancelFallback();
  /* Emit collect FIRST so listeners (e.g. weightedWheelSegments) can
   * compute __WIN_AWARD__ before the overlay tears down. Payload carries
   * the current result (or null when closed without a spin) so the
   * listener can early-return on phantom collects. */
  if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
    try { HookBus.emit('onWheelCollect', { result: WB_STATE.result }); } catch (_) {}
  }
  WB_STATE.active = false;
  WB_STATE.spinning = false;
  const ov = document.getElementById('wbOverlay');
  if (ov) ov.dataset.show = 'false';
  document.removeEventListener('keydown', _wbTrapFocus, true);
  /* Restore focus to whatever opened the dialog. */
  if (WB_PRIOR_FOCUS && typeof WB_PRIOR_FOCUS.focus === 'function') {
    try { WB_PRIOR_FOCUS.focus(); } catch (_) {}
    WB_PRIOR_FOCUS = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sb = document.getElementById('wbSpin');
  if (sb) sb.addEventListener('click', wbSpin);
  const cb = document.getElementById('wbClose');
  if (cb) cb.addEventListener('click', wbClose);
  /* Wave H15 — deterministic readiness signal so extensions can install
   * their draw strategy + initial paint without polling. Fired exactly
   * once per page, after DOM wiring is complete. */
  if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
    try { HookBus.emit('onWheelBonusReady', {}); } catch (_) {}
  }
});

if (typeof window !== 'undefined') {
  window.wbOpen      = wbOpen;
  window.wbSpin      = wbSpin;
  window.wbClose     = wbClose;
  window.wbAnimateTo = wbAnimateTo;
  window.WB_STATE    = WB_STATE;
  /* Wave H15 — expose the bakeline segments + duration so the
   * weightedWheelSegments extension can read the live config without
   * baking a duplicate copy. */
  window.WB_SEGMENTS = WB_SEGMENTS;
  window.WB_DUR      = WB_DUR;
  window.WB_REVS     = WB_REVS;
  window.WB_SETTLE_MS = WB_SETTLE_MS;
}

/* HookBus wire-up — wheel modal is opened explicitly by parser-side
   trigger logic; HookBus listeners ensure the modal closes safely at FS
   boundaries so it can't leak into the next round. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('onFsTrigger', () => { if (WB_STATE.open) wbClose(); });
  HookBus.on('onFsEnd',     () => { if (WB_STATE.open) wbClose(); });
  /* Canonical lifecycle — host opens/closes the modal and feeds the
   * draw result back from the math layer. */
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('wheelBonus.open',  () => { try { wbOpen();  } catch (_) {} }) : void 0);
  HookBus.on('wheelBonus.close', () => { try { wbClose(); } catch (_) {} });
  HookBus.on('wheelBonus.request', () => {
    if (typeof HookBus.emit === 'function') {
      try { HookBus.emit('wheelBonus.spin', {}); } catch (_) {}
    }
  });
  HookBus.on('wheelBonus.result', (payload) => {
    if (!payload || typeof payload.segmentIndex !== 'number') return;
    try { wbAnimateTo(payload.segmentIndex); } catch (_) {}
  });
  /* 2026-06-10 (Boki: "wheel mi ne radi, force") — UFP chip emits
   * onForceFeatureRequested but wheelBonus never had a listener, so
   * clicking the WHEEL chip only painted the generic banner. Open the
   * actual modal now so the chip behaves like every other force CTA. */
  /* 2026-06-11 (Boki rule "pritisnes force dugme odradi se spin i onda se
   * dobije ishod forsa") — chip click arms the modal for the next postSpin
   * instead of opening immediately. Player sees: chip → reels spin →
   * settle → wheel modal opens. */
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onForceFeatureRequested', (payload) => {
    if (!payload || payload.kind !== 'wheel_bonus') return;
    window.__FORCE_WHEEL_OPEN__ = true;
  }) : void 0);
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('postSpin', (p) => {
    if (!window.__FORCE_WHEEL_OPEN__) return;
    if (p && p.duringFs) return;          /* honour FS-boundary safety */
    window.__FORCE_WHEEL_OPEN__ = false;
    try { wbOpen(); } catch (_) { /* defensive */ }
  }, { priority: -60 }) : void 0);
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
