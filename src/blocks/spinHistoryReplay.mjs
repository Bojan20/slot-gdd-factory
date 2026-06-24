import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/spinHistoryReplay.mjs
 *
 * Wave LEGO-REPLAY (B-2 · 1/2) — Spin history buffer + replay engine.
 *
 * @module spinHistoryReplay
 *
 * Purpose:
 *   Captures the last N spin outcomes (grid snapshot + win + timestamp)
 *   into a ring buffer on `window.__SPIN_HISTORY__`. Exposes a replay
 *   API consumed by `replayControlBar.mjs` (the player-facing UI). The
 *   replay is a VISUAL re-paint of the previously captured grid — it
 *   never re-runs the engine, so RNG / RTP integrity is preserved.
 *
 * Industry-reference (vendor-neutral):
 *   Spin replay is an industry-standard player surface for two
 *   reasons: (1) regulator transparency — players can review outcomes
 *   after a session for trust; (2) emotional satisfaction — review
 *   the moment of a big-win. Industry baseline: buffer 10-20 spins,
 *   visual re-paint, frame-by-frame stepping with pause/resume.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitSpinHistoryReplayCSS(cfg)            → CSS string (replay frame overlay)
 *   emitSpinHistoryReplayMarkup(cfg)         → HTML string (replay host)
 *   emitSpinHistoryReplayRuntime(cfg)        → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinResult — capture frame into ring buffer
 *                onFsTrigger  — suppress capture (FS has own history)
 *                onFsEnd      — resume capture
 *   emits:       onSpinReplayStart  { spinIndex, totalSpins }
 *                onSpinReplayEnd    { reason }
 *                onSpinReplayPaused { spinIndex }
 *
 * Shared state contract:
 *   window.__SPIN_HISTORY__ = {
 *     buffer: Array<{ at, win, grid: string[] | null }>,
 *     maxSize: number,
 *     currentIndex: number,    // playback index (or -1 when not replaying)
 *     isReplaying: boolean,
 *     replay(idx?), stop(), step(delta), getBuffer()
 *   }
 *
 * a11y / perf:
 *   • Replay frame overlay role="region" + aria-label "Spin replay".
 *   • Capture is bounded — only DOM snapshot via outerHTML of #gridHost
 *     (cheap clone). No deep state serialization.
 *   • Replay paints by restoring the captured outerHTML — no re-spin.
 *   • prefers-reduced-motion honored (overlay fades instantly).
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  bannerTop:        14,
  bannerPadV:       6,
  bannerPadH:       12,
  zIndex:           63,
  fontRem:          0.78,
  overlayFadeMs:    160,
  borderRadius:     12,
});

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'REPLAY',
    /* Ring buffer size — last N spins kept in memory. */
    maxBuffer: 10,
    /* Should FS spins also be captured? Default false — FS rounds are
     * presentation-heavy and tend to overflow the buffer with cinematic
     * frames that don't replay well outside their original sequence. */
    captureFs: false,
    color:    '#7fffd4',
    haloRGB:  '127,255,212',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('spinHistoryReplay', defaultConfig(), model) };
  const m = model.spinHistoryReplay || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('spinHistoryReplay', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.maxBuffer)) cfg.maxBuffer = _clampInt(m.maxBuffer, 1, 100, cfg.maxBuffer);
  if (typeof m.captureFs === 'boolean') cfg.captureFs = m.captureFs;
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(m.color)) cfg.color = m.color;

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'spin_replay' || f.kind === 'spin_history')) {
    const ctxOverride = applyGridProfile('spinHistoryReplay', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitSpinHistoryReplayCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── spin replay banner overlay ─────────────────────────────────── */
.spin-replay-banner {
  position: fixed;
  top: ${T.bannerTop}px; left: 50%; transform: translateX(-50%);
  z-index: ${T.zIndex};
  padding: ${T.bannerPadV}px ${T.bannerPadH}px;
  background: rgba(0,0,0,.72);
  border: 1px solid rgba(${cfg.haloRGB},.55);
  border-radius: ${T.borderRadius}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: ${cfg.color};
  opacity: 0; pointer-events: none;
  transition: opacity ${T.overlayFadeMs}ms ease;
}
.spin-replay-banner[data-active="true"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .spin-replay-banner { transition: none !important; }
}
`;
}

export function emitSpinHistoryReplayMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="spinReplayBanner" class="spin-replay-banner"
     role="region" aria-label="Spin replay banner"
     data-active="false">${escapeHtml(cfg.label)} <span id="spinReplayIndex">—</span></div>`, 'spinHistoryReplay');
}

export function emitSpinHistoryReplayRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* spinHistoryReplay: disabled */`;
  return `/* ─── spin replay runtime ────────────────────────────────────── */
const SHR_MAX_BUFFER = ${cfg.maxBuffer};
const SHR_CAPTURE_FS = ${cfg.captureFs};

(function wireSpinReplay(){
  const banner = document.getElementById('spinReplayBanner');
  const indexEl = document.getElementById('spinReplayIndex');

  if (typeof window !== 'undefined' && !window.__SPIN_HISTORY__) {
    window.__SPIN_HISTORY__ = {
      buffer: [],
      maxSize: SHR_MAX_BUFFER,
      currentIndex: -1,
      isReplaying: false,
    };
  }
  const state = window.__SPIN_HISTORY__;
  let savedHTML = null;
  let inBonus = false;

  function captureFrame(payload) {
    if (inBonus && !SHR_CAPTURE_FS) return;
    const host = document.getElementById('gridHost') ||
                 document.querySelector('.grid, .reels, .gameArea');
    const snapshot = host ? host.outerHTML : null;
    const frame = {
      at: Date.now(),
      win: (payload && Number.isFinite(payload.totalWin)) ? payload.totalWin : 0,
      gridHTML: snapshot,
    };
    state.buffer.push(frame);
    while (state.buffer.length > state.maxSize) state.buffer.shift();
  }

  function replay(idx) {
    if (state.buffer.length === 0) return false;
    const targetIdx = (Number.isFinite(idx) && idx >= 0 && idx < state.buffer.length)
      ? idx : state.buffer.length - 1;
    const frame = state.buffer[targetIdx];
    if (!frame || !frame.gridHTML) return false;

    if (savedHTML === null) {
      const host = document.getElementById('gridHost') ||
                   document.querySelector('.grid, .reels, .gameArea');
      savedHTML = host ? host.outerHTML : null;
    }

    /* Restore the captured DOM */
    const host = document.getElementById('gridHost') ||
                 document.querySelector('.grid, .reels, .gameArea');
    if (host && host.parentNode) {
      const wrap = document.createElement('div');
      wrap.innerHTML = frame.gridHTML;
      const newHost = wrap.firstElementChild;
      if (newHost) host.parentNode.replaceChild(newHost, host);
    }

    state.currentIndex = targetIdx;
    state.isReplaying = true;
    banner.setAttribute('data-active', 'true');
    indexEl.textContent = (targetIdx + 1) + '/' + state.buffer.length;
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onSpinReplayStart', {
        spinIndex: targetIdx, totalSpins: state.buffer.length
      });
    }
    return true;
  }

  function stop() {
    if (!state.isReplaying) return;
    if (savedHTML !== null) {
      const host = document.getElementById('gridHost') ||
                   document.querySelector('.grid, .reels, .gameArea');
      if (host && host.parentNode) {
        const wrap = document.createElement('div');
        wrap.innerHTML = savedHTML;
        const newHost = wrap.firstElementChild;
        if (newHost) host.parentNode.replaceChild(newHost, host);
      }
      savedHTML = null;
    }
    state.currentIndex = -1;
    state.isReplaying = false;
    banner.setAttribute('data-active', 'false');
    indexEl.textContent = '—';
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onSpinReplayEnd', { reason: 'user' });
    }
  }

  function step(delta) {
    if (!state.isReplaying) return false;
    const next = state.currentIndex + delta;
    if (next < 0 || next >= state.buffer.length) {
      if (typeof HookBus.emit === 'function') {
        HookBus.emit('onSpinReplayPaused', { spinIndex: state.currentIndex });
      }
      return false;
    }
    return replay(next);
  }

  state.replay = replay;
  state.stop = stop;
  state.step = step;
  state.getBuffer = function(){ return state.buffer.slice(); };

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', captureFrame) : void 0);
  HookBus.on('onFsTrigger', function(){ inBonus = true; });
  HookBus.on('onFsEnd', function(){ inBonus = false; });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
