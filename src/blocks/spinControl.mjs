import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/spinControl.mjs
 *
 * Wave V3 — Unified primary-action button (SPIN / STOP / SKIP).
 *
 * Perf budget: state morph ≤ 1ms; click handler ≤ 0.2ms; zero layout
 * thrash (icon swap via data-state only).
 *
 * Industry-reference pattern (industry-standard contextual primary CTA pattern):
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
  /* UQ-DEEP-AM FIX-1 — schemaVersion stamp + lockAfterSpinMs watchdog window.
   * Default 650ms je između industry-standard 400-800ms. Watchdog garantuje
   * window.__SPIN_READY__ resolve i u edge slučajevima kad lifecycle ne završi. */
  schemaVersion: '1',
  lockAfterSpinMs: 650,
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

/* Hard ceilings for resolveConfig clamps and metadata sanity. Hoisted so
 * tuning lives here, not inside the clamp call sites. */
const MAX_REQUIRE_MIN_SPIN_MS    = 2000;
const MAX_MIN_ROLLUP_MS_FOR_SHOW = 5000;
const MAX_ARIA_LABEL_LEN         = 64;
const MAX_RGB_OCTET              = 255;

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function isRgbTriplet(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})$/);
  return !!m && m.slice(1).every(n => +n <= MAX_RGB_OCTET);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.spinControl) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  cfg.requireMinSpinMs = clampInt(m.requireMinSpinMs, 0, MAX_REQUIRE_MIN_SPIN_MS);
  if (m.hideOnTurbo != null) cfg.hideOnTurbo = !!m.hideOnTurbo;
  if (m.hideOnAutoSpin != null) cfg.hideOnAutoSpin = !!m.hideOnAutoSpin;
  if (m.reelsClickAreaEnabled != null) cfg.reelsClickAreaEnabled = !!m.reelsClickAreaEnabled;
  cfg.minRollupMsForShow = clampInt(m.minRollupMsForShow, 0, MAX_MIN_ROLLUP_MS_FOR_SHOW);
  if (m.showDuringRollup      != null) cfg.showDuringRollup      = !!m.showDuringRollup;
  if (m.showDuringFsIntro     != null) cfg.showDuringFsIntro     = !!m.showDuringFsIntro;
  if (m.showDuringFsOutro     != null) cfg.showDuringFsOutro     = !!m.showDuringFsOutro;
  if (m.showDuringCelebration != null) cfg.showDuringCelebration = !!m.showDuringCelebration;

  for (const key of ['spinAriaLabel', 'stopAriaLabel', 'skipAriaLabel']) {
    if (typeof m[key] === 'string' && m[key].length > 0 && m[key].length <= MAX_ARIA_LABEL_LEN) {
      cfg[key] = m[key];
    }
  }
  if (isRgbTriplet(m.stopColor)) cfg.stopColor = m.stopColor.replace(/\s+/g, '');
  if (isRgbTriplet(m.skipColor)) cfg.skipColor = m.skipColor.replace(/\s+/g, '');

  /* UQ-DEEP-AM FIX-1 — lockAfterSpinMs clamp [200, 2000] + schemaVersion preserve. */
  cfg.lockAfterSpinMs = clampInt(m.lockAfterSpinMs != null ? m.lockAfterSpinMs : DEFAULTS.lockAfterSpinMs, 200, 2000);
  cfg.schemaVersion = DEFAULTS.schemaVersion;

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
  return tagBlockMarkup(`
  <button class="spinBtn" id="spinBtn" type="button" data-state="SPIN" data-spin-ready="true" aria-label="${aria}" data-i18n-aria="spinControl.label" data-i18n-aria-fallback="${aria}" data-dynamic-aria="true">
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
  </button>`, 'spinControl');
}

export function emitSpinControlRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ spinControl: cfg });
  if (!c.enabled) {
    return `
  /* ── spinControl BLOCK (disabled) — no runtime ─────────────────── */
  /* UQ-DEEP-AM FIX-1: disabled stub still resolves __SPIN_READY__ Promise
     tako da automation kod koji await-uje never wedge. */
  window.__SPIN_READY__ = Promise.resolve(true);
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
    /* UQ-DEEP-AM FIX-1 — automation-friendly readiness signal.
       __SPIN_READY__ Promise + data-spin-ready DOM attribute let test
       framework await deterministically umesto da poll-uje DOM. Watchdog
       (LOCK_AFTER_SPIN_MS) garantuje resolve i ako lifecycle ne završi. */
    var LOCK_AFTER_SPIN_MS    = ${c.lockAfterSpinMs};
    var __spinReadyResolve = null;
    function _resetSpinReady () {
      window.__SPIN_READY__ = new Promise(function (res) { __spinReadyResolve = res; });
    }
    function _markSpinReady () {
      var b = document.getElementById('spinBtn');
      if (b) b.setAttribute('data-spin-ready', 'true');
      if (typeof __spinReadyResolve === 'function') {
        try { __spinReadyResolve(true); } catch (e) {}
        __spinReadyResolve = null;
      }
    }
    function _markSpinBusy () {
      var b = document.getElementById('spinBtn');
      if (b) b.setAttribute('data-spin-ready', 'false');
      _resetSpinReady();
    }
    var __spinReadyWatchdogId = null;
    function _armSpinReadyWatchdog () {
      if (__spinReadyWatchdogId) clearTimeout(__spinReadyWatchdogId);
      __spinReadyWatchdogId = setTimeout(_markSpinReady, LOCK_AFTER_SPIN_MS);
    }
    function _disarmSpinReadyWatchdog () {
      if (__spinReadyWatchdogId) { clearTimeout(__spinReadyWatchdogId); __spinReadyWatchdogId = null; }
    }
    /* Initial: button is ready (idle CTA). */
    window.__SPIN_READY__ = Promise.resolve(true);
    if (typeof HookBus !== 'undefined' && HookBus && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () { _markSpinBusy(); _armSpinReadyWatchdog(); });
      HookBus.on('postSpin', function () { _markSpinReady(); _disarmSpinReadyWatchdog(); });
      HookBus.on('onSlamComplete', function () { _markSpinReady(); _disarmSpinReadyWatchdog(); });
    }
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
      /* Wave H5.11 (Boki rule 05.06.2026 "Ne pojavljuje mi se uvek stop
       * dugme kad igram brzo"). Timestamp of the most recent preSpin emit
       * — used to enforce REQUIRE_MIN_SPIN_MS so a rapid double-click can
       * never collapse STOP_PRE in less time than the player needs to
       * actually SEE the STOP icon. Before this fix the config existed
       * but was never read (dead var), so an instant 2nd press could
       * morph STOP_PRE → SPIN within 50 ms, leaving the player believing
       * the STOP CTA never appeared. */
      preSpinTs: 0,
      /* Pending slam intent that was suppressed because the
       * REQUIRE_MIN_SPIN_MS window had not yet elapsed. Drained by the
       * one-shot timer below the moment the window closes. */
      pendingSlam: false,
      pendingSlamTimerId: null,
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
        /* Wave H5.11 minimum-visibility gate (Boki rule "Ne pojavljuje
         * mi se uvek stop dugme kad igram brzo"). If the player double-
         * presses inside the REQUIRE_MIN_SPIN_MS window, do NOT collapse
         * STOP_PRE immediately — that's why STOP appeared to "miss" on
         * rapid play. Queue the slam intent and drain it the moment the
         * window closes so the press still registers and the round
         * settles correctly, but the STOP icon stays visible long
         * enough to be SEEN. */
        var nowTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var elapsed = nowTs - (STATE.preSpinTs || 0);
        if (s === 'STOP_PRE' && elapsed < REQUIRE_MIN_SPIN_MS) {
          var remaining = Math.max(0, REQUIRE_MIN_SPIN_MS - elapsed);
          STATE.dispatchLocked = false;   /* release lock so the queued press isn't blocked */
          if (!STATE.pendingSlam) {
            STATE.pendingSlam = true;
            STATE.pendingSlamTimerId = setTimeout(function () {
              STATE.pendingSlamTimerId = null;
              STATE.pendingSlam = false;
              /* Only fire the queued slam if we're STILL in STOP_PRE/POST
               * (round may have finished naturally during the wait). */
              var stNow = STATE.current;
              if (stNow !== 'STOP_PRE' && stNow !== 'STOP_POST') return;
              if (STATE.dispatchLocked) return;
              /* 2026-06-18 — BUG-7 fix: drop the late-fired queued slam if
               * the round was already finalized between the click and the
               * timer firing (onSlamComplete or postSpin already disarmed
               * expectsFinalize). Without this guard the queued slam would
               * emit onSlamRequested into a fully-settled round; reelEngine
               * is idempotent so no crash, but spinControl would morph SPIN
               * → SPIN (no-op) AND set slamPendingSettle=true with no
               * settlement emit to clear it, parking the CTA disabled. */
              if (!STATE.expectsFinalize) return;
              STATE.dispatchLocked = true;
              var ph = (stNow === 'STOP_PRE') ? 'pre' : 'post';
              _emit('onSlamRequested', { phase: ph, source: 'button-queued' });
              STATE.slamPendingSettle = true;
              setState('SPIN');
              var b = _btn();
              if (b) b.disabled = true;
            }, remaining);
          }
          if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
          return;
        }
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
      /* 2026-06-18 — BUG-1 fix (deep-recon Priority 2): reels-area click had
       * no slamPendingSettle guard. During the ~400ms window after a slam
       * click while reels are bouncing into final positions, the state was
       * already morphed to 'SPIN' (button disabled) but the early-return
       * above only matched STOP_*. If state hadn't morphed yet (10ms race
       * window) a second emit was possible. The slamPendingSettle flag is
       * the authoritative "in-flight settlement" signal. */
      if (STATE.slamPendingSettle) return;
      STATE.dispatchLocked = true;
      /* 2026-06-18 — BUG-8 fix: wrap emit in try/finally so a throwing
       * HookBus listener can never permanently lock the reels-area click
       * dispatcher (mirrors slamStop.mjs request-button try/finally). */
      try {
        _emit('onSlamRequested', { phase: (s === 'STOP_PRE') ? 'pre' : 'post', source: 'reelsArea' });
      } finally {
        STATE.dispatchLocked = false;
      }
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
    /* Wave V5.4 — Space-during-pending-settle queue. Boki bug 05.06.2026:
     * "Kada pritiskam space brzo da igram bas brzo igru, onda se ne pali
     * uvek dugme stop i skip nego samo play". Live probe showed that
     * during the ~500ms post-slam pending-settle window the button is
     * .disabled=true, so rapid Space presses 3..N inside that window were
     * being dropped on the floor. The player kept tapping and the engine
     * never advanced, so the next press that landed AFTER settle (state
     * already back to SPIN) just kicked a fresh spin — looking like
     * "only PLAY ever fires".
     *
     * Fix: instead of dropping the press, latch a one-shot intent flag.
     * A MutationObserver on the button's disabled attribute fires the
     * queued click the instant the engine re-enables the CTA. The intent
     * is one-shot (cleared on consumption AND on the next manual press)
     * so the queue never stacks. preSpin also clears it so a stale press
     * from a previous round can't poison a new round. */
    var __spacePending = false;
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      if (ev.repeat) { ev.preventDefault(); return; }   /* fix #2 — kill auto-repeat */
      if (_isTypingTarget(document.activeElement)) return;
      if (_modalOpen()) return;
      var btn = _btn();
      if (!btn) return;
      ev.preventDefault();
      if (btn.disabled) {
        /* Engine is mid-settle; latch the intent so it fires the moment
         * the CTA becomes interactive again. */
        __spacePending = true;
        return;
      }
      /* Live press — consume any stale latched intent so a manual + queued
       * back-to-back don't fire twice. */
      __spacePending = false;
      btn.click();
    });
    /* Drain queued Space the moment the button flips out of .disabled.
     * MutationObserver runs synchronously after the disabled attribute
     * mutation, so the latency is one microtask. */
    function _wireSpaceQueueDrain() {
      var btn = _btn();
      if (!btn || typeof MutationObserver !== 'function') return;
      var mo = new MutationObserver(function () {
        /* 2026-06-18 — BUG-2 fix: previously this drain fired whenever the
         * button became enabled regardless of whether the round had been
         * finalized. If the pending-settle drain ran AFTER _finalizeRound
         * but BEFORE the queued postSpin disarmed __spacePending, the
         * queued click would dispatch into a fresh preSpin disguised as
         * "Space-from-pending". Now the drain ONLY fires while we are
         * actually mid-settle (slamPendingSettle true). After the round
         * is finalized, any leftover __spacePending is cleared to prevent
         * a stale press from leaking into the next spin. */
        if (!btn.disabled && __spacePending) {
          if (STATE.slamPendingSettle) {
            __spacePending = false;
            btn.click();
          } else {
            /* round already settled — drop stale latch */
            __spacePending = false;
          }
        }
      });
      mo.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireSpaceQueueDrain, { once: true });
    } else {
      _wireSpaceQueueDrain();
    }
    /* preSpin safety: a press latched in the previous round must NOT
     * leak into the new round's actionable window. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('preSpin', function () { __spacePending = false; });
    }

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
        /* Wave H5.11 — stamp the spin start so STOP_PRE has guaranteed
         * minimum visibility per REQUIRE_MIN_SPIN_MS. Done BEFORE the
         * Turbo/AutoSpin guards because the timestamp is also useful for
         * non-CTA telemetry (e.g. autoplay pacing). */
        STATE.preSpinTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        /* Drain any leftover pending slam from a prior round so a
         * stale flag can never fire on the new round. */
        if (STATE.pendingSlamTimerId !== null) { clearTimeout(STATE.pendingSlamTimerId); STATE.pendingSlamTimerId = null; }
        STATE.pendingSlam = false;
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
        /* Boki rule (05.06.2026 "kada sam igrao brzo, opet mi se skipo
         * pojavio na kraju spina a nije bilo nikakvog win-a"): _finalizeRound
         * fires on the LAST event of a round (postSpin/onSlamComplete) —
         * which is ALWAYS AFTER applyWinHighlight has already emitted both
         * onWinPresentationStart and onWinPresentationEnd (handlePostSpin
         * awaits the cycle before emitting postSpin). The
         * onWinPresentationStart listener already morphs us to SKIP_ROLLUP
         * during the cycle, and onWinPresentationEnd morphs us back to SPIN
         * when it's done. If we re-morph to SKIP_ROLLUP here, we leak a
         * STALE SKIP CTA after the cycle ended (or after a skip), which
         * the player sees as an undead "skip" button on a no-win or
         * already-resolved spin.
         *
         * The SKIP_ROLLUP morph here is therefore only valid as a
         * FALLBACK for the rare edge where postSpin somehow lands while
         * we're still in STOP_PRE/STOP_POST (the onWinPresentation pair
         * never fired for some reason). Otherwise leave the existing
         * state alone — onWinPresentationEnd / onSkipComplete already set
         * the correct terminal state. */
        var inPreEndState = (STATE.current === 'STOP_PRE' || STATE.current === 'STOP_POST');
        if (SHOW_ROLLUP && (anim || (hasWin && longRoll)) && inPreEndState) {
          /* Fallback only: Win/animation branch but we never left STOP_*.
           * Means the cycle is still in flight or never started — keep
           * the SKIP_ROLLUP morph so the CTA is clickable. */
          setState('SKIP_ROLLUP');
          STATE.slamPendingSettle = false;
        } else if (inPreEndState) {
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

      /* 2026-06-18 — BUG-3 fix (deep-recon Priority 1): H&W lifecycle
       * awareness. Pre-fix spinControl was BLIND to Hold&Win phases
       * (INTRO placard, RUNNING respins, SUMMARY plaque). Player could
       * see CTA as plain SPIN during the intro/summary placards even
       * though clicking would dispatch a per-cell respin into a phase
       * the orchestrator didn't expect. Industry-standard hold-and-spin
       * UX hides the SPIN CTA during INTRO/SUMMARY (those overlays own
       * the screen) and re-paints it as the "respin trigger" during the
       * RUNNING phase so the player knows what the button does.
       *
       * We hide the spin button during INTRO + SUMMARY placards by
       * forcing it disabled, then restore on H&W end. RUNNING uses the
       * normal SPIN state — clicking it dispatches a respin via the same
       * runOneBaseSpin() funnel that the H&W per-cell branch consumes. */
      window.HookBus.on('onHoldAndWinIntro', function () {
        var btn = _btn(); if (btn) btn.disabled = true;
      });
      window.HookBus.on('onHoldAndWinStart', function () {
        /* RUNNING phase begins — restore SPIN affordance so the player
         * can dispatch the next respin manually if autoplay is off. */
        var btn = _btn(); if (btn) btn.disabled = false;
        setState('SPIN');
      });
      window.HookBus.on('onHoldAndWinEnd', function () {
        /* Round closed (natural / full-grid / forced) — flush any stale
         * morph and return to baseline so the next BASE spin starts
         * cleanly. */
        var btn = _btn(); if (btn) btn.disabled = false;
        setState('SPIN');
      });

      /* 2026-06-18 — BUG-5 fix (deep-recon Priority 1): compliance gate
       * recovery. When reelEngine.runOneBaseSpin() refuses to dispatch
       * (NL Cruks pending, DE min-spin floor, NL cool-off active, max-win
       * cap reached), it emits one of the dedicated audit events but
       * never fires preSpin → settlement. Pre-fix spinControl had already
       * morphed SPIN → STOP_PRE on the click and now sat there forever
       * waiting for a postSpin that never came.
       *
       * The fix: listen to every gate-failure event and snap the CTA
       * back to SPIN with the button re-enabled, so the player can try
       * again once the gate clears. The emit list mirrors the gating
       * surface in reelEngine.mjs::runOneBaseSpin + jurisdictionGate. */
      var _gateRecover = function () {
        var btn = _btn(); if (btn) btn.disabled = false;
        STATE.slamPendingSettle = false;
        STATE.expectsFinalize   = false;
        STATE.dispatchLocked    = false;
        STATE.pendingSlam       = false;
        setState('SPIN');
      };
      window.HookBus.on('onCruksCheckPending',       _gateRecover);
      window.HookBus.on('onManualSpinPaceBlocked',   _gateRecover);
      window.HookBus.on('onMinSpinPaceDeferred',     _gateRecover);
      window.HookBus.on('onCoolOffEnforced',         _gateRecover);
      window.HookBus.on('onWinCapReached',           _gateRecover);
      window.HookBus.on('onSelfExcludedBlocked',     _gateRecover);
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
