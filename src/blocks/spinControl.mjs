/**
 * src/blocks/spinControl.mjs
 *
 * Wave V3 — Unified primary-action button (SPIN / STOP / SKIP).
 *
 * Industry-reference pattern (PlayCore / every major studio modern slot):
 * the primary CTA in the sideHud is ONE contextual button whose label +
 * icon + color morph based on the round phase. This block REPLACES the
 * inline `<button id="spinBtn">` that lived in buildSlotHTML.mjs and
 * supersedes the standalone `slamStop` + `forceSkip` button blocks (V1,
 * V2). When enabled, those two are markup/CSS suppressed and spinControl
 * emits their intent events directly on HookBus.
 *
 * State machine (driven by HookBus lifecycle):
 *
 *      ┌──────────── onPlayerSpin ───────────┐
 *      ▼                                     │
 *   [SPIN] ──preSpin──▶ [STOP_PRE] ──onSpinResult──▶ [STOP_POST]
 *                          │                                │
 *                          │                       postSpin │ (rollup begins)
 *                          ▼                                ▼
 *                       postSpin (no win)             [SKIP_ROLLUP] ─onSkipComplete─▶ [SPIN]
 *                          │                                │
 *                          ▼                                │
 *                       [SPIN]                              │
 *                                                           │
 *   onFsTrigger    ──▶ [SKIP_FSINTRO]   ─onSkipComplete──▶  │
 *   onFsEnd        ──▶ [SKIP_FSOUTRO]   ─onSkipComplete──▶  │
 *   (celebration)  ──▶ [SKIP_CELEBRATION] ─onSkipComplete─▶ ▼
 *                                                       [SPIN]
 *
 * Each state owns:
 *   • data-state attribute       (CSS variant selector)
 *   • aria-label                 (accessibility)
 *   • visible SVG icon           (one of 3 baked into markup, sibling
 *                                  visibility toggled via data-state)
 *   • click intent               (HookBus emit on tap)
 *
 * Click-intent dispatch (single click handler, state-aware):
 *
 *   STATE              CLICK EMITS                    SIDE EFFECT
 *   ─────────────────  ─────────────────────────────  ────────────────────────────
 *   SPIN               onPlayerSpin                   buildSlotHTML wires → runOneBaseSpin()
 *   STOP_PRE           onSlamRequested(phase:'pre')   reelEngine awaits onSpinResult then collapses
 *   STOP_POST          onSlamRequested(phase:'post')  reelEngine collapses immediately
 *   SKIP_ROLLUP        onSkipRequested(phase:'rollup')        + window.__SLOT_SKIPPED__ = true
 *   SKIP_FSINTRO       onSkipRequested(phase:'fsIntro')       + window.__SLOT_SKIPPED__ = true
 *   SKIP_FSOUTRO       onSkipRequested(phase:'fsOutro')       + window.__SLOT_SKIPPED__ = true
 *   SKIP_CELEBRATION   onSkipRequested(phase:'celebration')   + window.__SLOT_SKIPPED__ = true
 *
 * Reels-area click forwarding: when in any STOP state, a pointerup on the
 * reels host is forwarded to the same slam dispatch path — industry parity
 * with players tapping anywhere on the reels to fast-stop.
 *
 * Bake-time config (resolved from `model.spinControl`):
 *   { enabled, requireMinSpinMs, hideOnTurbo, hideOnAutoSpin,
 *     reelsClickAreaEnabled, minRollupMsForShow,
 *     showDuringRollup, showDuringFsIntro, showDuringFsOutro,
 *     showDuringCelebration,
 *     spinAriaLabel, stopAriaLabel, skipAriaLabel,
 *     stopColor, skipColor }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitSpinControlCSS(cfg)       → variant CSS (data-state selectors)
 *   emitSpinControlMarkup(cfg)    → <button id="spinBtn"> with 3 SVG icons
 *   emitSpinControlRuntime(cfg)   → state machine + click dispatch
 *
 * Runtime contract (after emitted JS executes):
 *   window.SpinControl.setState(name) / getState() / SPIN_CONTROL_STATE
 *
 * Runtime dependencies: HookBus (window.HookBus), document, setTimeout.
 *
 * Composition contract:
 *   - buildSlotHTML.mjs MUST suppress emitSlamStopMarkup/CSS/Runtime and
 *     emitForceSkipMarkup/CSS/Runtime when spinControl.enabled === true
 *     (gated via `!spinCtlCfg.enabled && …` ternary). Their runtime stubs
 *     are still re-attached as no-op `window.slamStopShow/Hide/Request`
 *     so any third-party consumer that probes those names finds them.
 *   - The inline click-listener that called `runOneBaseSpin()` directly
 *     is removed from buildSlotHTML and replaced with a HookBus listener
 *     on `onPlayerSpin` that calls runOneBaseSpin (preserves FSM gating).
 *
 * Z-index ownership: spinControl reuses `.spinBtn` base styles (already
 * positioned in sideHud column, no z-index needed). Variant overlays
 * (stop ring pulse, skip glow) are pseudo-elements that stay within
 * the button's stacking context.
 */

const VALID_STATES = Object.freeze([
  'SPIN',
  'STOP_PRE',
  'STOP_POST',
  'SKIP_ROLLUP',
  'SKIP_FSINTRO',
  'SKIP_FSOUTRO',
  'SKIP_CELEBRATION',
  /* Wave V5.3 — Big-Win Tier banner is on-screen. Click emits
   * onSkipRequested{phase:'bigWinTier'} → bigWinTier listener exits. */
  'SKIP_BIGWIN',
]);

const DEFAULTS = Object.freeze({
  enabled: true,
  /* Minimum spin ms before STOP becomes available. Below the threshold
   * the button stays in SPIN visual (disabled) so the player perceives
   * reels actually spinning. Same rationale as slamStop V1. */
  requireMinSpinMs: 250,
  hideOnTurbo: true,
  hideOnAutoSpin: true,
  reelsClickAreaEnabled: true,
  /* SKIP gating — for very short rollups the skip flash would be
   * subliminal. */
  minRollupMsForShow: 600,
  showDuringRollup: true,
  showDuringFsIntro: true,
  showDuringFsOutro: true,
  showDuringCelebration: false,
  /* A11y labels (announced via aria-label change on state morph). */
  spinAriaLabel: 'Spin',
  stopAriaLabel: 'Stop reels',
  skipAriaLabel: 'Skip animation',
  /* Variant accents — comma-separated rgb triplets so emitted CSS can
   * compose them into rgba() without re-parsing at runtime. */
  stopColor: '255,80,80',
  skipColor: '90,180,255',
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function isRgbTriplet(s) {
  return typeof s === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(s);
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.spinControl) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.requireMinSpinMs)) cfg.requireMinSpinMs = clampInt(m.requireMinSpinMs, 0, 2000);
  if (m.hideOnTurbo != null) cfg.hideOnTurbo = !!m.hideOnTurbo;
  if (m.hideOnAutoSpin != null) cfg.hideOnAutoSpin = !!m.hideOnAutoSpin;
  if (m.reelsClickAreaEnabled != null) cfg.reelsClickAreaEnabled = !!m.reelsClickAreaEnabled;
  if (Number.isFinite(m.minRollupMsForShow)) cfg.minRollupMsForShow = clampInt(m.minRollupMsForShow, 0, 5000);
  if (m.showDuringRollup      != null) cfg.showDuringRollup      = !!m.showDuringRollup;
  if (m.showDuringFsIntro     != null) cfg.showDuringFsIntro     = !!m.showDuringFsIntro;
  if (m.showDuringFsOutro     != null) cfg.showDuringFsOutro     = !!m.showDuringFsOutro;
  if (m.showDuringCelebration != null) cfg.showDuringCelebration = !!m.showDuringCelebration;

  for (const key of ['spinAriaLabel', 'stopAriaLabel', 'skipAriaLabel']) {
    if (typeof m[key] === 'string' && m[key].length > 0 && m[key].length <= 64) {
      cfg[key] = m[key];
    }
  }
  if (isRgbTriplet(m.stopColor)) cfg.stopColor = m.stopColor.replace(/\s+/g, '');
  if (isRgbTriplet(m.skipColor)) cfg.skipColor = m.skipColor.replace(/\s+/g, '');

  return cfg;
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitSpinControlCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ spinControl: cfg });
  if (!c.enabled) return '';
  return `
  /* ── spinControl BLOCK — emitted by src/blocks/spinControl.mjs ─────
     Three icons stacked inside #spinBtn; the active one is shown by
     data-state. Variant accents recolor border/glow without redrawing
     the gold base gradient (cheap state-morph, no layout shift). */
  .spinBtn .spinIcon { display: none; }
  .spinBtn[data-state="SPIN"] .spinIcon--spin { display: block; }
  .spinBtn[data-state="STOP_PRE"] .spinIcon--stop,
  .spinBtn[data-state="STOP_POST"] .spinIcon--stop { display: block; }
  .spinBtn[data-state^="SKIP_"] .spinIcon--skip { display: block; }

  /* STOP variant — red ring + pulsing inner glow. */
  .spinBtn[data-state="STOP_PRE"],
  .spinBtn[data-state="STOP_POST"] {
    border-color: rgb(${c.stopColor}) rgba(${c.stopColor}, 0.7) rgba(${c.stopColor}, 0.55) rgb(${c.stopColor});
    box-shadow:
      inset 0 3px 6px rgba(255, 200, 200, 0.32),
      inset 0 -4px 8px rgba(0, 0, 0, 0.45),
      0 0 40px rgba(${c.stopColor}, 0.55),
      0 0 80px rgba(${c.stopColor}, 0.25),
      0 10px 35px rgba(0, 0, 0, 0.5),
      0 25px 60px rgba(0, 0, 0, 0.4);
  }
  .spinBtn[data-state="STOP_PRE"] { animation: spinCtlStopPulse 1100ms ease-in-out infinite; }
  @keyframes spinCtlStopPulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.04); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinBtn[data-state="STOP_PRE"] { animation: none; }
  }

  /* SKIP variant — cyan ring + steady glow. */
  .spinBtn[data-state^="SKIP_"] {
    border-color: rgb(${c.skipColor}) rgba(${c.skipColor}, 0.7) rgba(${c.skipColor}, 0.55) rgb(${c.skipColor});
    box-shadow:
      inset 0 3px 6px rgba(220, 240, 255, 0.32),
      inset 0 -4px 8px rgba(0, 0, 0, 0.45),
      0 0 40px rgba(${c.skipColor}, 0.55),
      0 0 80px rgba(${c.skipColor}, 0.25),
      0 10px 35px rgba(0, 0, 0, 0.5),
      0 25px 60px rgba(0, 0, 0, 0.4);
  }
  .spinBtn[data-state^="STOP_"] svg,
  .spinBtn[data-state^="SKIP_"] svg {
    stroke: #fff;
    fill: #fff;
  }
  .spinBtn[data-state^="STOP_"] svg { fill: rgb(${c.stopColor}); stroke: rgb(${c.stopColor}); }
  .spinBtn[data-state^="SKIP_"] svg { fill: rgb(${c.skipColor}); stroke: rgb(${c.skipColor}); }
  ${c.reelsClickAreaEnabled ? `
  /* Reels host acts as STOP target while button shows STOP_PRE / STOP_POST. */
  .reelsHost.spinctl-stop-armed { cursor: pointer; }
  ` : ''}
`;
}

export function emitSpinControlMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ spinControl: cfg });
  if (!c.enabled) return '';
  const aria = _esc(c.spinAriaLabel);
  /* Three icons baked in; data-state controls which one is display:block.
   * SPIN  — circular two-arrow refresh glyph (industry-standard)
   * STOP  — solid square (universal media-stop glyph)
   * SKIP  — forward double-triangle (universal media-skip glyph) */
  return `
  <button class="spinBtn" id="spinBtn" type="button" data-state="SPIN" aria-label="${aria}">
    <svg class="spinIcon spinIcon--spin" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5.6 17.4a10.5 10.5 0 0 0 18.7 5.2"/>
      <path d="M26.4 14.6A10.5 10.5 0 0 0 7.7 9.4"/>
      <polyline points="24.3,22.6 24.3,16.6 18.3,16.6"/>
      <polyline points="7.7,9.4 7.7,15.4 13.7,15.4"/>
    </svg>
    <svg class="spinIcon spinIcon--stop" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="9" width="14" height="14" rx="2" stroke-width="0"/>
    </svg>
    <svg class="spinIcon spinIcon--skip" viewBox="0 0 32 32" aria-hidden="true">
      <polygon points="6,8 16,16 6,24" stroke-width="0"/>
      <polygon points="16,8 26,16 16,24" stroke-width="0"/>
    </svg>
  </button>`;
}

export function emitSpinControlRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ spinControl: cfg });
  if (!c.enabled) {
    return `
  /* ── spinControl BLOCK (disabled) — no runtime ─────────────────── */
  window.SpinControl = { setState: function () {}, getState: function () { return null; } };
`;
  }
  return `
  /* ── spinControl BLOCK — emitted by src/blocks/spinControl.mjs ──────
     Owns: #spinBtn DOM + state machine + click intent dispatch.
     Subscribes to HookBus:
       preSpin / onSpinResult / onSlamComplete / postSpin /
       onFsTrigger / onFsEnd / onSkipComplete / onWinPresentationStart /
       onScatterCelebrationStart
     Emits to HookBus:
       onPlayerSpin / onSlamRequested / onSkipRequested
     Mirrors __SLOT_SKIPPED__ flag (legacy contract from forceSkip). */
  (function () {
    var REQUIRE_MIN_SPIN_MS   = ${c.requireMinSpinMs};
    var HIDE_ON_TURBO         = ${c.hideOnTurbo};
    var HIDE_ON_AUTOSPIN      = ${c.hideOnAutoSpin};
    var REELS_CLICK_AREA      = ${c.reelsClickAreaEnabled};
    var MIN_ROLLUP_MS         = ${c.minRollupMsForShow};
    var SHOW_ROLLUP           = ${c.showDuringRollup};
    var SHOW_FS_INTRO         = ${c.showDuringFsIntro};
    var SHOW_FS_OUTRO         = ${c.showDuringFsOutro};
    var SHOW_CELEBRATION      = ${c.showDuringCelebration};
    var SPIN_LABEL            = ${JSON.stringify(c.spinAriaLabel)};
    var STOP_LABEL            = ${JSON.stringify(c.stopAriaLabel)};
    var SKIP_LABEL            = ${JSON.stringify(c.skipAriaLabel)};

    var STATE = {
      enabled: true,
      current: 'SPIN',
      armTimerId: null,
      reelsArmed: false,
      dispatchLocked: false,   /* one-shot per state — prevents double-emit on race */
      /* Wave V4 — industry "pending-settle" CTA pattern. After a slam click
       * we immediately revert the visual to SPIN (so the player sees their
       * press registered) but the button stays .disabled=true until the
       * last reel signals OnReelComplete (onSlamComplete + postSpin). This
       * flag tells _finalizeRound to re-enable the button when the
       * settlement window closes. */
      slamPendingSettle: false,
      /* Wave V5 — one-shot finalize gate. preSpin arms; first onSlamComplete
       * OR postSpin runs _finalizeRound and disarms. Subsequent stale
       * emits from the same or previous round are dropped. Prevents late
       * postSpin from a prior round leaking SKIP_ROLLUP into the next round. */
      expectsFinalize: false,
    };
    if (typeof window !== 'undefined') window.SPIN_CONTROL_STATE = STATE;

    function _btn()       { return document.getElementById('spinBtn'); }
    function _reelsHost() { return document.getElementById('reelsHost') || document.querySelector('.reelsHost'); }

    function _turboActive()    { return !!(typeof window !== 'undefined' && window.__SLOT_TURBO_ACTIVE__); }
    function _autoSpinActive() { return !!(typeof window !== 'undefined' && window.__SLOT_AUTOSPIN_ACTIVE__); }

    function _ariaForState(s) {
      if (s === 'SPIN') return SPIN_LABEL;
      if (s === 'STOP_PRE' || s === 'STOP_POST') return STOP_LABEL;
      return SKIP_LABEL;
    }

    function setState(name) {
      if (['SPIN','STOP_PRE','STOP_POST','SKIP_ROLLUP','SKIP_FSINTRO','SKIP_FSOUTRO','SKIP_CELEBRATION','SKIP_BIGWIN'].indexOf(name) === -1) return;
      if (STATE.current === name) return;
      STATE.current = name;
      STATE.dispatchLocked = false;
      var btn = _btn();
      if (btn) {
        btn.setAttribute('data-state', name);
        btn.setAttribute('aria-label', _ariaForState(name));
        /* disabled=false everywhere by default; SPIN re-enable is handled
         * by the spin engine via direct .disabled assignment (legacy).
         * STOP/SKIP states must always be clickable. */
        if (name !== 'SPIN') btn.disabled = false;
      }
      if (name === 'STOP_PRE' || name === 'STOP_POST') _armReelsArea();
      else _disarmReelsArea();
    }
    function getState() { return STATE.current; }

    if (typeof window !== 'undefined') {
      window.SpinControl = { setState: setState, getState: getState };
    }

    function _emit(eventName, payload) {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit(eventName, payload || {}); }
        catch (e) { if (console && console.error) console.error('[spinControl] emit failed:', eventName, e); }
      }
    }

    function _onClick(ev) {
      /* Snapshot the state at click time. The legacy spin-start listener
       * lives in the orchestrator and ALSO listens for click on #spinBtn;
       * if state===SPIN we must NOT preempt that path — we let the legacy
       * handler call runOneBaseSpin() and rely on its preSpin emit to
       * morph us into STOP_PRE. For STOP/SKIP we OWN the click and must
       * stop further propagation so the legacy handler doesn't double-fire
       * a fresh spin on top of the slam/skip intent. */
      var s = STATE.current;
      if (s === 'SPIN') {
        /* Hand-off to legacy listener; nothing to emit. */
        return;
      }
      if (STATE.dispatchLocked) {
        if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        return;
      }
      STATE.dispatchLocked = true;
      if (s === 'STOP_PRE' || s === 'STOP_POST') {
        var phase = (s === 'STOP_PRE') ? 'pre' : 'post';
        _emit('onSlamRequested', { phase: phase, source: 'button' });
        /* Wave V4 (Boki rule 05.06.2026 + industry pending-settle pattern):
         * immediately revert the visual to SPIN so the player sees their
         * press registered, but keep the CTA non-interactive until the
         * last reel emits OnReelComplete (which happens via onSlamComplete
         * + postSpin → _finalizeRound below). Without this morph, the
         * button reads STOP for ~400ms while reels finish their bounce
         * decay, which feels broken (Boki: "ubrzo nakon stop dugmeta treba
         * spin dugme da se pojavi"). With it, the player sees:
         * STOP-click → SPIN icon (dim/disabled) → SPIN (clickable). */
        STATE.slamPendingSettle = true;
        setState('SPIN');
        var btnSlam = _btn();
        if (btnSlam) btnSlam.disabled = true;
      } else if (s.indexOf('SKIP_') === 0) {
        var skipPhase = ({
          'SKIP_ROLLUP':       'rollup',
          'SKIP_FSINTRO':      'fsIntro',
          'SKIP_FSOUTRO':      'fsOutro',
          'SKIP_CELEBRATION':  'celebration',
          'SKIP_BIGWIN':       'bigWinTier',
        })[s];
        if (typeof window !== 'undefined') window.__SLOT_SKIPPED__ = true;
        _emit('onSkipRequested', { phase: skipPhase, source: 'button' });
      } else {
        /* Unknown state — release lock to avoid a permanent dead button. */
        STATE.dispatchLocked = false;
      }
      /* Prevent legacy spin-button handler from re-firing a fresh spin
       * on top of the slam/skip intent. */
      if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    }

    function _armReelsArea() {
      if (!REELS_CLICK_AREA) return;
      if (STATE.reelsArmed) return;
      var host = _reelsHost();
      if (!host) return;
      host.classList.add('spinctl-stop-armed');
      host.addEventListener('pointerup', _onReelsClick, { capture: false });
      STATE.reelsArmed = true;
    }
    function _disarmReelsArea() {
      if (!REELS_CLICK_AREA) return;
      if (!STATE.reelsArmed) return;
      var host = _reelsHost();
      if (host) {
        host.classList.remove('spinctl-stop-armed');
        host.removeEventListener('pointerup', _onReelsClick, { capture: false });
      }
      STATE.reelsArmed = false;
    }
    function _onReelsClick() {
      var s = STATE.current;
      if (s !== 'STOP_PRE' && s !== 'STOP_POST') return;
      if (STATE.dispatchLocked) return;
      STATE.dispatchLocked = true;
      _emit('onSlamRequested', { phase: (s === 'STOP_PRE') ? 'pre' : 'post', source: 'reelsArea' });
    }

    /* DOM wiring — single click handler. Capture phase so we run BEFORE
     * the legacy orchestrator listener which is wired in bubble phase
     * (default). This guarantees we see the CLICK-TIME state, not the
     * post-preSpin state. */
    function _wire() {
      var btn = _btn();
      if (!btn) return;
      btn.addEventListener('click', _onClick, true);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wire, { once: true });
    } else {
      _wire();
    }

    /* Wave V5 — global Space keyboard shortcut. Native <button> already
     * activates on Space when focused, but on page load the focus is on
     * <body> so the first Space press does nothing — the player has to
     * Tab to the button first. Industry slots dispatch Space as the
     * primary CTA gesture regardless of focus, so we forward
     * document-level Space presses to the spinBtn click path (which then
     * routes through _onClick state-machine logic + the legacy bubble
     * listener for SPIN starts). Guards:
     *   • ignore when focus is in an input / textarea / contentEditable
     *     so number-pickers + chat fields still get the spacebar
     *   • ignore when ANY modal-mode panel is open (autoplay / settings /
     *     paytable / historyLog / gambleSecondary) — they own the screen
     *   • respect button.disabled (pending-settle window) so a Space mash
     *     during settle can't start a new spin */
    function _isTypingTarget(el) {
      if (!el) return false;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function _modalOpen() {
      /* Defensive scan — modals reachable from the hub. Each sets
       * data-open="true" on its root element when active; that selector
       * lets us pick up new modals automatically without listing each. */
      return !!document.querySelector('[data-modal="true"][data-open="true"]');
    }
    /* Boki bug 05.06.2026: "Kada pritiskam space brzo da igram bas brzo
     * igru, onda se ne pali uvek dugme stop i skip nego samo play."
     *
     * Two root causes layered:
     *
     *   1. HTML spec: native <button> activates click on Space KEYUP (not
     *      keydown). Our document listener dispatches btn.click() on
     *      keydown. If the button is currently focused (which it is after
     *      the very first manual click or any Tab navigation — focus
     *      sticks across renders), one Space press triggers TWO clicks:
     *      ours on keydown + native on keyup. State machine then races
     *      through STOP_PRE → STOP_POST/SKIP → SPIN inside a single
     *      keypress and the player only ever sees PLAY.
     *
     *   2. OS key auto-repeat: holding Space fires keydown ~30×/s with
     *      ev.repeat=true. Each repeated keydown was dispatching a fresh
     *      click. Spamming Space (or holding it) shredded the state
     *      machine the same way as #1.
     *
     * Fix (additive, no other behavior changes):
     *   • Ignore ev.repeat — only the FIRST keydown of a press counts.
     *   • Add a keyup handler that ALSO preventDefaults Space, so the
     *     native keyup-activation never fires the second click. Our
     *     keydown click is the single source of truth.
     */
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      if (ev.repeat) { ev.preventDefault(); return; }   /* fix #2 — kill auto-repeat */
      if (_isTypingTarget(document.activeElement)) return;
      if (_modalOpen()) return;
      var btn = _btn();
      if (!btn) return;
      if (btn.disabled) { ev.preventDefault(); return; }
      ev.preventDefault();
      /* Synthesize a click — routes through capture _onClick first
       * (state-machine), then bubble legacy listener (SPIN starter).
       * Behaviorally identical to a native focused-Space activation. */
      btn.click();
    });

    /* Fix #1 — kill the native keyup-activation second click. Our keydown
     * handler already dispatched the click; the browser's built-in Space
     * activation would otherwise add a duplicate when the spinBtn is the
     * currently focused element. Guard rails mirror keydown (typing
     * target / modal open / disabled button) so we only suppress when WE
     * own the gesture. */
    document.addEventListener('keyup', function (ev) {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      if (_isTypingTarget(document.activeElement)) return;
      if (_modalOpen()) return;
      var btn = _btn();
      if (!btn) return;
      /* Only prevent native activation if the button is the focused
       * target (the only case where the native activation would fire a
       * duplicate). If Space was pressed while focus was elsewhere, the
       * native activation wouldn't fire anyway, so no need to consume. */
      if (document.activeElement === btn) {
        ev.preventDefault();
      }
    });

    /* HookBus lifecycle wiring — drives the state morphs. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {

      /* Boki rule (04.06.2026): "Treba spin da se vidi, kada se pritisne
       * spin dugme, onda se pojavi Slam, pa kad se pritisne slam, ako ima
       * wina ili neke animacije, onda se ukljucuje skip."
       *
       * Translation to state machine:
       *   - On preSpin → INSTANT STOP_PRE (no 250ms timer).
       *     Player sees Slam the moment they press Spin.
       *   - onSpinResult internally bumps to STOP_POST but the visible
       *     icon/color stay the same (both are "press to stop").
       *   - onSlamComplete + postSpin → branch:
       *       award > 0 → SKIP_ROLLUP (Skip is the active CTA)
       *       award == 0 → SPIN (back to idle)
       *   - onSkipComplete → SPIN.
       *
       * Turbo / autoplay still suppress the slam morph because in those
       * modes the engine owns the cadence and the player should not
       * interrupt mid-spin. */
      window.HookBus.on('preSpin', function () {
        if (STATE.armTimerId !== null) { clearTimeout(STATE.armTimerId); STATE.armTimerId = null; }
        /* Wave V4 safety: clear any stale pending-settle flag at the start
         * of a fresh spin, otherwise an unfinished slam round (rare edge:
         * onSlamComplete dropped due to upstream error) could leave the
         * button locked into disabled forever. */
        STATE.slamPendingSettle = false;
        /* Wave V5 anti-leak (Boki bug 05.06.2026): clear the win-presentation
         * globals at the TOP of the new round so a late postSpin / late
         * onSlamComplete from the previous round (rapid-click race during a
         * win cycle) cannot read stale __WIN_AWARD__ > 0 and falsely morph
         * the new spin's CTA into SKIP_ROLLUP. Must run BEFORE winPresentation
         * preSpin (priority -10) sees the new round so the same clear is
         * idempotent if it also wipes these. */
        if (typeof window !== 'undefined') {
          window.__WIN_AWARD__ = 0;
          window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
          window.__SLOT_SKIPPED__ = false;
        }
        /* Wave V5 — arm a one-shot finalize gate. _finalizeRound is the
         * sink for onSlamComplete + postSpin; if a stale finalize from a
         * previous round (or a duplicated emit) arrives after we already
         * processed this round's first finalize, it must be dropped so it
         * cannot push us back into SKIP_ROLLUP. */
        STATE.expectsFinalize = true;
        if (HIDE_ON_TURBO && _turboActive()) return;
        if (HIDE_ON_AUTOSPIN && _autoSpinActive()) return;
        /* INSTANT morph — no delay. Boki industry preference. */
        setState('STOP_PRE');
      });

      window.HookBus.on('onSpinResult', function () {
        /* Internal bump: STOP_PRE → STOP_POST so the slam handler uses
         * the post-response collapse path. Same visible icon/color. */
        if (STATE.current === 'STOP_PRE') {
          setState('STOP_POST');
        }
      });

      /* Win-branch decision happens on the LAST event of the round —
       * postSpin for the natural-stop path, onSlamComplete for the
       * slam-stop path. winPresentation has published __WIN_AWARD__ /
       * __WIN_ROLLUP_MS__ by then. */
      function _finalizeRound() {
        /* Wave V5 anti-leak: drop late events from a previous round whose
         * finalize already ran. Without this gate, a stale postSpin emit
         * (rapid-click race: spin 1's handlePostSpin awaits its cycle
         * cleanup and emits postSpin AFTER spin 2's preSpin already armed
         * a new round) would read stale __WIN_AWARD__ + hasWin=true and
         * morph the new spin's CTA back into SKIP_ROLLUP. The flag is
         * armed in preSpin and disarmed on the first finalize this round. */
        if (!STATE.expectsFinalize) return;
        STATE.expectsFinalize = false;
        if (STATE.armTimerId !== null) { clearTimeout(STATE.armTimerId); STATE.armTimerId = null; }
        var award    = (typeof window !== 'undefined') ? window.__WIN_AWARD__    : 0;
        var rollupMs = (typeof window !== 'undefined') ? window.__WIN_ROLLUP_MS__ : 0;
        var hasWin   = Number.isFinite(award) && award > 0;
        var longRoll = !Number.isFinite(rollupMs) || rollupMs >= MIN_ROLLUP_MS;
        var anim     = (typeof window !== 'undefined') && window.__SLOT_WIN_PRESENT_ACTIVE__ === true;
        /* Boki rule: "ako ima wina ili neke animacije, onda se ukljucuje
         * skip". So we morph to SKIP_ROLLUP on EITHER win + long rollup
         * OR active animation. Otherwise we settle directly to SPIN. */
        if (SHOW_ROLLUP && (anim || (hasWin && longRoll))) {
          /* Win/animation branch — SKIP_ROLLUP is clickable; setState here
           * sets disabled=false implicitly. Clear pending-settle flag so a
           * future round starts fresh. */
          setState('SKIP_ROLLUP');
          STATE.slamPendingSettle = false;
        } else if (STATE.current === 'STOP_PRE' || STATE.current === 'STOP_POST') {
          /* Natural-stop branch — reels stopped on their own, no slam was
           * issued. Morph directly to SPIN (clickable). */
          setState('SPIN');
        } else if (STATE.slamPendingSettle) {
          /* Pending-settle branch — slam was clicked, visual is already
           * SPIN (set in _onClick) but the button is disabled while reels
           * finished bounce decay. The last reel has now committed —
           * re-enable so the player can press again. */
          var btnDone = _btn();
          if (btnDone) btnDone.disabled = false;
          STATE.slamPendingSettle = false;
        }
      }
      window.HookBus.on('onSlamComplete', _finalizeRound);
      window.HookBus.on('postSpin',       _finalizeRound);

      /* Wave V5.3 — Big-Win Tier banner morphs CTA to SKIP_BIGWIN for the
       * full banner lifetime. Click on the cyan SKIP CTA emits
       * onSkipRequested{phase:'bigWinTier'} → bigWinTier listener calls
       * bigWinTierExit('skipped') which clears banner + emits Exited.
       * onBigWinTierExited returns CTA to SPIN (idle). Autoplay-aware:
       * during autoplay the engine owns cadence, no manual skip morph. */
      window.HookBus.on('onBigWinTierEntered', function () {
        if (HIDE_ON_AUTOSPIN && _autoSpinActive()) return;
        setState('SKIP_BIGWIN');
      });
      /* The compound walkthrough emits onBigWinTierExited per walked
       * tier (intermediate ones still have more tiers to go). Only the
       * single onBigWinTierEnd marks the sequence boundary — that's what
       * we revert on. */
      window.HookBus.on('onBigWinTierEnd', function () {
        if (STATE.current === 'SKIP_BIGWIN') setState('SPIN');
      });

      window.HookBus.on('onFsTrigger', function () { if (SHOW_FS_INTRO)  setState('SKIP_FSINTRO');  });
      window.HookBus.on('onFsEnd',     function () { if (SHOW_FS_OUTRO)  setState('SKIP_FSOUTRO');  });
      window.HookBus.on('onScatterCelebrationStart', function () { if (SHOW_CELEBRATION) setState('SKIP_CELEBRATION'); });

      /* Wave V5 — win-presentation phase morphs. winPresentation emits
       * onWinPresentationStart the moment the rollup cycle kicks off (after
       * detection, before the visual playWinSymCycle) and
       * onWinPresentationEnd when the cycle finishes naturally. We morph
       * to SKIP_ROLLUP for the duration so the player can fast-finalize
       * the win presentation in flight, then morph back to SPIN.
       * Note: SHOW_ROLLUP gating same as in _finalizeRound so a GDD-level
       * "no skip on rollup" config is respected. */
      window.HookBus.on('onWinPresentationStart', function () {
        if (HIDE_ON_AUTOSPIN && _autoSpinActive()) return;
        if (SHOW_ROLLUP) setState('SKIP_ROLLUP');
      });
      window.HookBus.on('onWinPresentationEnd', function () {
        /* Natural cycle end — if a skip click already morphed us to SPIN
         * via onSkipComplete, this is a no-op (setState bails on same
         * state). Otherwise, settle back to SPIN. */
        if (STATE.current === 'SKIP_ROLLUP') setState('SPIN');
      });

      window.HookBus.on('onSkipComplete', function () {
        if (typeof window !== 'undefined') window.__SLOT_SKIPPED__ = false;
        setState('SPIN');
      });
    }

    /* __SLOT_SKIPPED__ defaults to false so animation chains that poll it
     * before any spin happens read a defined value. */
    if (typeof window !== 'undefined' && window.__SLOT_SKIPPED__ == null) {
      window.__SLOT_SKIPPED__ = false;
    }

    /* Legacy stubs — third-party code that referenced the old block APIs
     * (slamStopRequest / forceSkipRequest / slamStopShow / forceSkipShow)
     * keeps a defined symbol. They route to the unified dispatch path so
     * a programmatic slam/skip from outside still works. */
    if (typeof window !== 'undefined') {
      if (typeof window.slamStopRequest !== 'function') {
        window.slamStopRequest = function (source) {
          var s = STATE.current;
          if (s !== 'STOP_PRE' && s !== 'STOP_POST') return;
          _emit('onSlamRequested', { phase: (s === 'STOP_PRE') ? 'pre' : 'post', source: source || 'api' });
        };
      }
      if (typeof window.forceSkipRequest !== 'function') {
        window.forceSkipRequest = function (source) {
          var s = STATE.current;
          if (s.indexOf('SKIP_') !== 0) return;
          var phase = ({
            'SKIP_ROLLUP':       'rollup',
            'SKIP_FSINTRO':      'fsIntro',
            'SKIP_FSOUTRO':      'fsOutro',
            'SKIP_CELEBRATION':  'celebration',
            'SKIP_BIGWIN':       'bigWinTier',
          })[s];
          window.__SLOT_SKIPPED__ = true;
          _emit('onSkipRequested', { phase: phase, source: source || 'api' });
        };
      }
      if (typeof window.slamStopShow    !== 'function') window.slamStopShow    = function () {};
      if (typeof window.slamStopHide    !== 'function') window.slamStopHide    = function () {};
      if (typeof window.forceSkipShow   !== 'function') window.forceSkipShow   = function () {};
      if (typeof window.forceSkipHide   !== 'function') window.forceSkipHide   = function () {};
    }
  })();
`;
}
