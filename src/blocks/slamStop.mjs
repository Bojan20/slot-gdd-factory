/**
 * src/blocks/slamStop.mjs
 *
 * Wave V1 — Slam-Stop button block.
 *
 * Industry-standard pattern (fast-stop / "slam" command):
 *   • A button (and optional whole-reels click area) that the player can
 *     press DURING a spin to collapse the reels into their final landed
 *     positions immediately, skipping the motion-blur rotation phase.
 *   • Pre-response phase: server result has NOT yet arrived; the engine
 *     must arm a one-shot wait (HookBus.once('onSpinResult', …)) and only
 *     collapse once the strip is known.
 *   • Post-response phase: server result already arrived; engine collapses
 *     directly.
 *   • Hidden during turbo mode and autoSpin mode by design (those modes
 *     own the spin cadence end-to-end and any slam would be a UI glitch).
 *
 * Lifecycle (HookBus contract):
 *
 *   preSpin       → show the button after `requireMinSpinMs` (gives the
 *                   spin a brief unskippable phase so the player perceives
 *                   reels actually spinning) UNLESS hideOnTurbo + turbo or
 *                   hideOnAutoSpin + autoSpin active.
 *   onSlamComplete → hide button (engine fires this once reels collapsed).
 *   postSpin      → hide button (covers the case where reels stop on their
 *                   own without slam).
 *   onFsTrigger / onFsEnd → hide button (FS transitions own the screen).
 *
 * The block ONLY emits `onSlamRequested` (it never reaches into the engine
 * directly). reelEngine.mjs subscribes and decides the pre-vs-post phase
 * branch. That is the LEGO ownership invariant: slamStop publishes intent,
 * engine owns the action.
 *
 * Composition contract:
 *   - reelEngine.mjs is the SOLE subscriber that performs the actual
 *     reel-collapse; it also emits onSlamComplete back so this block can
 *     reset its UI state.
 *   - postSpin.mjs is the coordinator that drives show/hide for spin /
 *     slam / skip button triad — slamStop only listens to its own
 *     show/hide-relevant lifecycle events here.
 *
 * Bake-time config (resolved from `model.slamStop`):
 *   { enabled, chipLabel, chipColor, chipTextColor,
 *     requireMinSpinMs, hideOnTurbo, hideOnAutoSpin,
 *     reelsClickAreaEnabled, ariaLabel, pulseAnimation }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitSlamStopCSS(cfg)     → button overlay styles + pulse keyframe
 *   emitSlamStopMarkup(cfg)  → button host
 *   emitSlamStopRuntime(cfg) → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *   slamStopShow() / slamStopHide() / slamStopRequest(source) /
 *   SLAM_STOP_STATE on window (visible | armed | requireMinSpinMs timer).
 *
 * Runtime dependencies: HookBus (window.HookBus), document, setTimeout.
 */

const VALID_SOURCES = Object.freeze(['button', 'reelsArea', 'keyboard']);

export function defaultConfig() {
  return {
    enabled: false,
    chipLabel: 'STOP',
    /* "r,g,b" — kept as comma-separated triplets like uiToast to allow rgba()
     * with alpha modulation in CSS without re-parsing. */
    chipColor: '255,80,80',
    chipTextColor: '255,255,255',
    /* Industry baseline: ~250ms unskippable phase. Below that the slam
     * button would flash visible/clickable too fast for the player to even
     * see the reels move. Above ~400ms players start tapping in vain
     * waiting for it to appear. */
    requireMinSpinMs: 250,
    hideOnTurbo: true,
    hideOnAutoSpin: true,
    /* If true, the entire reel-grid container also fires onSlamRequested
     * on pointerup (industry pattern: a transparent overlay on the
     * reel grid forwards pointerup → processSlamStop, so the player
     * can tap anywhere on the reels to slam, not only the button). */
    reelsClickAreaEnabled: true,
    ariaLabel: 'Stop reels',
    pulseAnimation: true,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.slamStop) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (typeof m.chipLabel === 'string' && m.chipLabel.length > 0 && m.chipLabel.length <= 16) {
    cfg.chipLabel = m.chipLabel;
  }
  if (typeof m.chipColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipColor)) {
    cfg.chipColor = m.chipColor.replace(/\s+/g, '');
  }
  if (typeof m.chipTextColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipTextColor)) {
    cfg.chipTextColor = m.chipTextColor.replace(/\s+/g, '');
  }
  if (Number.isFinite(m.requireMinSpinMs)) {
    cfg.requireMinSpinMs = clampInt(m.requireMinSpinMs, 0, 2000);
  }
  if (m.hideOnTurbo != null) cfg.hideOnTurbo = !!m.hideOnTurbo;
  if (m.hideOnAutoSpin != null) cfg.hideOnAutoSpin = !!m.hideOnAutoSpin;
  if (m.reelsClickAreaEnabled != null) cfg.reelsClickAreaEnabled = !!m.reelsClickAreaEnabled;
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }
  if (m.pulseAnimation != null) cfg.pulseAnimation = !!m.pulseAnimation;

  /* Auto-enable when GDD declares a slam-stop feature kind. */
  if (model.features && Array.isArray(model.features)) {
    const hasSlamFeature = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(slam[_-]?stop|quick[_-]?stop)$/i.test(f.kind),
    );
    if (hasSlamFeature) cfg.enabled = true;
  }

  return cfg;
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/* HTML escape — applied to any string baked into runtime JS that will
 * eventually reach innerHTML. The chipLabel passes through this. */
function _slamEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitSlamStopCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ slamStop: cfg });
  /* z-index 20: above reels (10), below uiToast (30) and force-skip (25).
   * See Wave V8 stacking doc in master TODO. */
  return `
  /* ── slamStop BLOCK — emitted by src/blocks/slamStop.mjs ─────────── */
  .slam-stop-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    z-index: 20;
    min-width: 120px;
    min-height: 120px;
    border-radius: 50%;
    border: 3px solid rgba(${c.chipColor}, 1);
    background: radial-gradient(circle at 30% 30%, rgba(${c.chipColor}, 0.95), rgba(${c.chipColor}, 0.65) 70%, rgba(${c.chipColor}, 0.45));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: 2px;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    box-shadow: 0 0 24px rgba(${c.chipColor}, 0.55), 0 4px 12px rgba(0, 0, 0, 0.45);
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease-out, opacity 160ms ease-out;
  }
  .slam-stop-btn[hidden] { display: none !important; }
  .slam-stop-btn:active { transform: translate(-50%, -50%) scale(0.94); }
  .slam-stop-btn:disabled { opacity: 0.55; cursor: default; }
  ${c.pulseAnimation ? `
  .slam-stop-btn.is-pulsing { animation: slamStopPulse 1100ms ease-in-out infinite; }
  @keyframes slamStopPulse {
    0%   { box-shadow: 0 0 24px rgba(${c.chipColor}, 0.55), 0 4px 12px rgba(0, 0, 0, 0.45); transform: translate(-50%, -50%) scale(1); }
    50%  { box-shadow: 0 0 36px rgba(${c.chipColor}, 0.85), 0 6px 16px rgba(0, 0, 0, 0.55); transform: translate(-50%, -50%) scale(1.04); }
    100% { box-shadow: 0 0 24px rgba(${c.chipColor}, 0.55), 0 4px 12px rgba(0, 0, 0, 0.45); transform: translate(-50%, -50%) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .slam-stop-btn.is-pulsing { animation: none; }
  }` : ''}
  ${c.reelsClickAreaEnabled ? `
  /* When the click-area pattern is enabled, the reels container becomes
   * a slam target while the button is visible. We mark this via a class
   * on the host so other CSS doesn't fight the pointer cursor. */
  .reelsHost.slam-armed { cursor: pointer; }
  ` : ''}
  @media (max-width: 480px) {
    .slam-stop-btn { min-width: 96px; min-height: 96px; font-size: 18px; }
  }
`;
}

export function emitSlamStopMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ slamStop: cfg });
  const safeLabel = _slamEscape(c.chipLabel);
  const safeAria = _slamEscape(c.ariaLabel);
  return `
  <button
    id="slamStopBtn"
    class="slam-stop-btn"
    type="button"
    aria-label="${safeAria}"
    hidden
  >${safeLabel}</button>`;
}

export function emitSlamStopRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    /* Even when disabled, expose a stub so other blocks can call
     * slamStopShow / slamStopHide without an undefined-reference crash.
     * Stub no-ops keep composition contracts simple. */
    return `
  /* ── slamStop BLOCK (disabled) — stub ─────────────────────────────── */
  window.slamStopShow    = function () {};
  window.slamStopHide    = function () {};
  window.slamStopRequest = function () {};
  window.SLAM_STOP_STATE = { enabled: false, visible: false, armed: false };
`;
  }

  const c = resolveConfig({ slamStop: cfg });

  return `
  /* ── slamStop BLOCK — emitted by src/blocks/slamStop.mjs ─────────────
     Owns: emit of onSlamRequested.
     Subscribes (for show/hide UI state):
       preSpin        → show (after requireMinSpinMs delay)
       onSlamComplete → hide
       postSpin       → hide (reels stopped on their own)
       onFsTrigger    → hide (FS transition owns the screen)
       onFsEnd        → hide
     NEVER reaches into reelEngine directly. */
  (function () {
    var REQUIRE_MIN_SPIN_MS = ${c.requireMinSpinMs};
    var HIDE_ON_TURBO       = ${c.hideOnTurbo};
    var HIDE_ON_AUTOSPIN    = ${c.hideOnAutoSpin};
    var REELS_CLICK_AREA    = ${c.reelsClickAreaEnabled};
    var PULSE_ANIM          = ${c.pulseAnimation};

    var STATE = {
      enabled: true,
      visible: false,
      armed: false,           /* listener active on reelsHost click area */
      armTimerId: null,
      currentPhase: null,     /* 'pre' | 'post' once a result lands */
      requestLocked: false,   /* one-shot lock — prevents double-emit if two
                                 click events race before button hides */
    };
    if (typeof window !== 'undefined') window.SLAM_STOP_STATE = STATE;

    function _btn() { return document.getElementById('slamStopBtn'); }
    function _reelsHost() { return document.getElementById('reelsHost') || document.querySelector('.reelsHost'); }

    function _turboActive() {
      /* Honor a global boolean set by future turbo-mode block. Until that
       * lands, default is "no turbo" so slam works as advertised. */
      return !!(window.__SLOT_TURBO_ACTIVE__);
    }
    function _autoSpinActive() {
      return !!(window.__SLOT_AUTOSPIN_ACTIVE__);
    }

    function slamStopShow() {
      var btn = _btn();
      if (!btn) return;
      if (HIDE_ON_TURBO && _turboActive()) return;
      if (HIDE_ON_AUTOSPIN && _autoSpinActive()) return;
      /* Idempotent: bail if already showing. Without this guard a second
       * call (e.g. preSpin → FS-base-spin chain firing preSpin again
       * before the previous arm timer cleared) would re-add 'is-pulsing'
       * and re-attach the reels-area pointerup listener. */
      if (STATE.visible) return;
      btn.hidden = false;
      btn.disabled = false;
      if (PULSE_ANIM) btn.classList.add('is-pulsing');
      STATE.visible = true;
      STATE.requestLocked = false;   /* fresh spin → re-arm the one-shot lock */
      _armClickArea();
    }

    function slamStopHide() {
      var btn = _btn();
      if (btn) {
        btn.hidden = true;
        btn.classList.remove('is-pulsing');
      }
      STATE.visible = false;
      STATE.requestLocked = false;
      _disarmClickArea();
      if (STATE.armTimerId !== null) {
        clearTimeout(STATE.armTimerId);
        STATE.armTimerId = null;
      }
    }

    /* slamStopRequest(source) — fired by button click, reels-area click,
     * or future keyboard shortcut. source is one of 'button' | 'reelsArea'
     * | 'keyboard'. Emits the LEGO onSlamRequested intent and hides the
     * button so it can't be double-pressed. reelEngine.mjs will emit
     * onSlamComplete when reels visually collapsed; that re-hides too. */
    function slamStopRequest(source) {
      if (!STATE.visible) return;
      /* One-shot lock: industry pattern guarantees one slam intent per
       * spin even if two pointerup events race (button + reels-area
       * overlay can both fire on the same tap). Without the lock the
       * second emit would arrive after btn.disabled=true but before the
       * DOM repaint, causing a phantom onSlamRequested with no listener
       * symmetry. */
      if (STATE.requestLocked) return;
      STATE.requestLocked = true;
      var s = (typeof source === 'string' && ['button','reelsArea','keyboard'].indexOf(source) !== -1) ? source : 'button';
      var btn = _btn();
      if (btn) { btn.disabled = true; btn.classList.remove('is-pulsing'); }
      _disarmClickArea();
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSlamRequested', {
            phase: STATE.currentPhase || 'post',
            source: s,
          });
        } catch (e) {
          /* A listener throwing must not leave the block in a locked
           * state — re-arm so a subsequent (rare) recovery click can
           * still slam. */
          STATE.requestLocked = false;
          if (console && console.error) console.error('[slamStop] onSlamRequested listener failed:', e);
        }
      }
    }

    function _armClickArea() {
      if (!REELS_CLICK_AREA) return;
      var host = _reelsHost();
      if (!host) return;
      if (STATE.armed) return;
      host.classList.add('slam-armed');
      host.addEventListener('pointerup', _onReelsHostClick, { capture: false });
      STATE.armed = true;
    }
    function _disarmClickArea() {
      if (!REELS_CLICK_AREA) return;
      var host = _reelsHost();
      if (!host) return;
      if (!STATE.armed) return;
      host.classList.remove('slam-armed');
      host.removeEventListener('pointerup', _onReelsHostClick, { capture: false });
      STATE.armed = false;
    }
    function _onReelsHostClick() { slamStopRequest('reelsArea'); }

    if (typeof window !== 'undefined') {
      window.slamStopShow    = slamStopShow;
      window.slamStopHide    = slamStopHide;
      window.slamStopRequest = slamStopRequest;
    }

    /* Button click wiring — runs after DOM is ready. */
    function _wireButton() {
      var btn = _btn();
      if (!btn) return;
      btn.addEventListener('click', function () { slamStopRequest('button'); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireButton, { once: true });
    } else {
      _wireButton();
    }

    /* HookBus lifecycle wiring. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      /* preSpin → arm the show timer. If the reels stop before the timer
       * fires (very short spin, or slam not needed), the show never
       * happens and the timer is cleared by postSpin/onSlamComplete. */
      window.HookBus.on('preSpin', function () {
        if (STATE.armTimerId !== null) clearTimeout(STATE.armTimerId);
        STATE.currentPhase = 'pre';
        STATE.armTimerId = setTimeout(function () {
          STATE.armTimerId = null;
          slamStopShow();
        }, REQUIRE_MIN_SPIN_MS);
      });

      /* onSpinResult → server result has landed; transition phase. */
      window.HookBus.on('onSpinResult', function () {
        STATE.currentPhase = 'post';
      });

      window.HookBus.on('onSlamComplete', function () { slamStopHide(); });
      window.HookBus.on('postSpin',       function () { slamStopHide(); });
      window.HookBus.on('onFsTrigger',    function () { slamStopHide(); });
      window.HookBus.on('onFsEnd',        function () { slamStopHide(); });
    }
  })();
`;
}
