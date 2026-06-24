import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/replayControlBar.mjs
 *
 * Wave LEGO-REPLAY (B-2 · 2/2) — Player-facing replay control bar.
 *
 * @module replayControlBar
 *
 * Purpose:
 *   Bottom-center floating control bar with REPLAY · ⏮ · ⏯ · ⏭ · STOP
 *   buttons that drive the `window.__SPIN_HISTORY__` API exposed by
 *   `spinHistoryReplay.mjs`. Sibling to that block — this owns the UI,
 *   that owns the data + frame restore.
 *
 * Industry-reference (vendor-neutral):
 *   Replay control bar is the visible player surface for the spin
 *   history feature. Industry baseline: 4-5 button cluster (REPLAY
 *   to enter mode + ◀ Prev / ⏯ Pause / ▶ Next + STOP to exit). All
 *   buttons disabled when buffer is empty.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitReplayControlBarCSS(cfg)             → CSS string
 *   emitReplayControlBarMarkup(cfg)          → HTML string
 *   emitReplayControlBarRuntime(cfg)         → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinReplayStart  — UI sync
 *                onSpinReplayEnd    — restore base state
 *                onSpinReplayPaused — keep play button highlighted
 *                onFsTrigger        — disable bar mid-bonus
 *                onFsEnd            — re-enable post-bonus
 *   emits:       onReplayControlInvoked { command, fromIndex }
 *
 * a11y / perf:
 *   • role="toolbar" with aria-label "Replay controls"
 *   • Each button has aria-label + visible focus ring
 *   • Buttons disabled visually + via aria-disabled when buffer empty
 *   • Keyboard: Tab through buttons; ←/→ Arrow nav in toolbar
 *   • prefers-reduced-motion honored
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  bottom:        80,
  bottomMobile:  60,
  zIndex:        59,
  btnSize:       40,
  btnSizeMobile: 34,
  btnGap:        6,
  borderRadius:  14,
  fontRem:       1.1,
  fontRemMobile: 0.95,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'REPLAY',
    color:     '#7fffd4',
    colorDark: '#205045',
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('replayControlBar', defaultConfig(), model) };
  const m = model.replayControlBar || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('replayControlBar', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  /* Auto-enable when spinHistoryReplay is enabled — the bar is the
   * UI complement to the history block. */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'spin_replay' || f.kind === 'spin_history' || f.kind === 'replay_bar')) {
    const ctxOverride = applyGridProfile('replayControlBar', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitReplayControlBarCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── replay control bar ────────────────────────────────────────── */
.replay-control-bar {
  position: fixed;
  bottom: ${T.bottom}px; left: 50%; transform: translateX(-50%);
  z-index: ${T.zIndex};
  display: inline-flex; align-items: center; gap: ${T.btnGap}px;
  padding: 6px 10px;
  background: rgba(0,0,0,.72);
  border: 1px solid rgba(255,255,255,.18);
  border-radius: ${T.borderRadius}px;
  box-shadow: 0 4px 18px rgba(0,0,0,.45);
}
.replay-control-bar .rcb-btn {
  appearance: none;
  width: ${T.btnSize}px; height: ${T.btnSize}px;
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
  border: 1px solid rgba(255,255,255,.4);
  border-radius: 10px;
  font-size: ${T.fontRem}rem; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: filter .15s ease, transform .12s ease;
}
.replay-control-bar .rcb-btn:hover { filter: brightness(1.15); }
.replay-control-bar .rcb-btn:active { transform: scale(0.94); }
.replay-control-bar .rcb-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.replay-control-bar .rcb-btn[aria-disabled="true"],
.replay-control-bar .rcb-btn[disabled] {
  opacity: 0.45; cursor: not-allowed; filter: grayscale(0.4);
}
.replay-control-bar[data-locked="true"] { opacity: 0.5; pointer-events: none; }
@media (max-width: 620px) {
  .replay-control-bar { bottom: ${T.bottomMobile}px; }
  .replay-control-bar .rcb-btn {
    width: ${T.btnSizeMobile}px; height: ${T.btnSizeMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .replay-control-bar .rcb-btn { transition: none; }
}
`;
}

export function emitReplayControlBarMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="replayControlBar" class="replay-control-bar"
     role="toolbar" aria-label="Replay controls" data-locked="false">
  <button class="rcb-btn" type="button" id="rcbReplay" aria-label="Replay last spin">▶</button>
  <button class="rcb-btn" type="button" id="rcbPrev"   aria-label="Previous spin" aria-disabled="true">⏮</button>
  <button class="rcb-btn" type="button" id="rcbNext"   aria-label="Next spin"     aria-disabled="true">⏭</button>
  <button class="rcb-btn" type="button" id="rcbStop"   aria-label="Stop replay"   aria-disabled="true">■</button>
</div>`, 'replayControlBar');
}

export function emitReplayControlBarRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* replayControlBar: disabled */`;
  return `/* ─── replay control bar runtime ─────────────────────────────── */
(function wireReplayControlBar(){
  const bar    = document.getElementById('replayControlBar');
  const playBtn = document.getElementById('rcbReplay');
  const prevBtn = document.getElementById('rcbPrev');
  const nextBtn = document.getElementById('rcbNext');
  const stopBtn = document.getElementById('rcbStop');
  if (!bar || !playBtn || !prevBtn || !nextBtn || !stopBtn) return;

  function setDisabled(btn, disabled) {
    if (disabled) {
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('disabled', 'disabled');
    } else {
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('disabled');
    }
  }

  function syncButtons() {
    const state = window.__SPIN_HISTORY__;
    const hasBuffer = state && state.buffer && state.buffer.length > 0;
    const replaying = state && state.isReplaying;
    setDisabled(playBtn, !hasBuffer || replaying);
    setDisabled(prevBtn, !replaying);
    setDisabled(nextBtn, !replaying);
    setDisabled(stopBtn, !replaying);
  }

  function invoke(command) {
    const state = window.__SPIN_HISTORY__;
    if (!state) return;
    const fromIdx = state.currentIndex;
    if (command === 'replay' && state.replay) state.replay();
    else if (command === 'prev' && state.step) state.step(-1);
    else if (command === 'next' && state.step) state.step(+1);
    else if (command === 'stop' && state.stop) state.stop();
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onReplayControlInvoked', { command: command, fromIndex: fromIdx });
    }
    syncButtons();
  }

  playBtn.addEventListener('click', function(){ invoke('replay'); });
  prevBtn.addEventListener('click', function(){ invoke('prev'); });
  nextBtn.addEventListener('click', function(){ invoke('next'); });
  stopBtn.addEventListener('click', function(){ invoke('stop'); });

  /* Toolbar arrow-key navigation */
  const btns = [playBtn, prevBtn, nextBtn, stopBtn];
  btns.forEach(function(btn, idx){
    btn.addEventListener('keydown', function(e){
      let next = idx;
      if (e.key === 'ArrowRight') next = (idx + 1) % btns.length;
      else if (e.key === 'ArrowLeft') next = (idx - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End')  next = btns.length - 1;
      else return;
      e.preventDefault();
      btns[next].focus();
    });
  });

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinReplayStart',  syncButtons) : void 0);
  HookBus.on('onSpinReplayEnd',    syncButtons);
  HookBus.on('onSpinReplayPaused', syncButtons);
  HookBus.on('onSpinResult',       syncButtons);
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){
    bar.setAttribute('data-locked', 'true');
    if (window.__SPIN_HISTORY__ && window.__SPIN_HISTORY__.isReplaying && window.__SPIN_HISTORY__.stop) {
      window.__SPIN_HISTORY__.stop();
    }
  }) : void 0);
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', function(){ bar.setAttribute('data-locked', 'false'); syncButtons(); }) : void 0);

  syncButtons();
})();
`;
}
