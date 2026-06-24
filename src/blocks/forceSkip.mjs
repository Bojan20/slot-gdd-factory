import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/forceSkip.mjs
 *
 * Wave V2 — Force-Skip button block.
 *
 * Industry-standard pattern (force-skip command for rollup/intro/outro):
 *   • A button shown during win-presentation, FS-intro, FS-outro, and
 *     other long-running animation phases. Press = immediately bail to
 *     the final state (skip rollup, skip celebration banner, jump to
 *     first FS spin, etc.).
 *   • Sets a global skipped flag (`window.__SLOT_SKIPPED__ = true`) that
 *     long-running animation chains (winPresentation, scatterCelebration,
 *     freeSpins) poll at every setTimeout step and bail to final state.
 *   • Emits `onSkipRequested` with current phase so animation-owning
 *     blocks can decide whether they own the cancellation.
 *
 * Lifecycle (HookBus contract):
 *
 *   onSpinResult        → maybe-show (depending on award size + showDuringRollup)
 *   onFsTrigger         → maybe-show (showDuringFsIntro)
 *   onFsEnd             → maybe-show (showDuringFsOutro)
 *   onSkipComplete      → hide + clear skipped flag
 *   postSpin (no award) → hide (idle path doesn't need skip)
 *   onFsSpinResult      → hide (already deep into FS round, no transition)
 *
 * The block ONLY emits `onSkipRequested` (it never cancels animations
 * directly). Animation-owning blocks (winPresentation, scatterCelebration,
 * freeSpins) subscribe and decide what cancellation means for their phase.
 *
 * Composition contract:
 *   - winPresentation.mjs subscribes to onSkipRequested(phase='rollup') →
 *     finalize rollup amount immediately and emit onSkipComplete.
 *   - scatterCelebration.mjs subscribes to onSkipRequested(phase='celebration')
 *     → tear down banner, emit onSkipComplete.
 *   - freeSpins.mjs subscribes to onSkipRequested(phase='fsIntro' | 'fsOutro')
 *     → collapse intro/outro animation, emit onSkipComplete.
 *
 * Bake-time config (resolved from `model.forceSkip`):
 *   { enabled, chipLabel, chipColor, chipTextColor,
 *     disabledPressed, hidePressed,
 *     showDuringRollup, showDuringFsIntro, showDuringFsOutro,
 *     showDuringCelebration,
 *     minRollupMsForShow, ariaLabel }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitForceSkipCSS(cfg)
 *   emitForceSkipMarkup(cfg)
 *   emitForceSkipRuntime(cfg)
 *
 * Runtime contract (after emitted JS executes):
 *   forceSkipShow(phase) / forceSkipHide() / forceSkipRequest(source) /
 *   FORCE_SKIP_STATE on window.
 *
 * Runtime dependencies: HookBus (window.HookBus), document, setTimeout.
 *
 * Performance budget:
 *   - onSpinResult listener: ~50µs (1 setTimeout schedule + payload read).
 *   - show/hide/request: ≤3 DOM reads per call (single getElementById).
 *   - Zero allocations in steady state when no skip is requested.
 *   - prefers-reduced-motion query elides transition + active-scale cost.
 */

const VALID_PHASES = Object.freeze(['rollup', 'fsIntro', 'fsOutro', 'celebration']);

/* Visual / layout constants — lifted from the CSS template so GDD and
 * sibling blocks can reason about the contract without scraping the
 * string literal. Mirrors the Wave AL-4/Fable-3 pattern from
 * anticipation.mjs. Z_INDEX 25 sits above slam-stop (20) and below
 * uiToast (30). MIN_HEIGHT_PX 44 is the WCAG 2.5.5 touch-target floor. */
const Z_INDEX              = 25;
const BOTTOM_PX            = 20;
const MIN_WIDTH_PX         = 140;
const MIN_HEIGHT_PX        = 44;
const PADDING_Y_PX         = 8;
const PADDING_X_PX         = 24;
const BORDER_RADIUS_PX     = 22;
const BORDER_WIDTH_PX      = 2;
const FONT_SIZE_PX         = 14;
const LETTER_SPACING_PX    = 1.5;
const TEXT_SHADOW_Y_PX     = 1;
const TEXT_SHADOW_BLUR_PX  = 2;
const BOX_GLOW_BLUR_PX     = 18;
const BOX_SHADOW_Y_PX      = 3;
const BOX_SHADOW_BLUR_PX   = 8;
const MOBILE_BREAKPOINT_PX = 480;
const MOBILE_FONT_SIZE_PX  = 12;
const MOBILE_MIN_WIDTH_PX  = 110;
const MOBILE_MIN_HEIGHT_PX = 38;
const BG_OPACITY           = 0.85;
const GLOW_OPACITY         = 0.45;
const TEXT_SHADOW_OPACITY  = 0.4;
const BOX_SHADOW_OPACITY   = 0.35;
const DISABLED_OPACITY     = 0.5;
const TRANSFORM_MS         = 100;
const OPACITY_MS           = 140;
const ACTIVE_SCALE         = 0.96;
const HOOKBUS_BIND_RETRIES = 50;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    chipLabel: 'SKIP',
    /* Distinct from slam-stop red so the player can't confuse them. */
    chipColor: '90,180,255',
    chipTextColor: '255,255,255',
    /* Industry pattern `disabledPressed`: once pressed, disable the
     * button so a second click cannot re-fire the skip request
     * mid-collapse. */
    disabledPressed: true,
    /* Industry pattern `hidePressed`: optionally also hide visually
     * after press. Default off because the button typically gets hidden
     * by onSkipComplete anyway; setting hidePressed forces immediate hide
     * for designs where the post-press flash is undesirable. */
    hidePressed: false,
    /* Phase gating — let GDD opt-out for specific phases. Default: show
     * for rollup + FS intro + FS outro, NOT for celebration banner
     * (industry pattern: most slots let scatter-celebration play out). */
    showDuringRollup:      true,
    showDuringFsIntro:     true,
    showDuringFsOutro:     true,
    showDuringCelebration: false,
    /* For very short rollups (< 600ms total) the skip button would flash
     * faster than the human eye can react. Suppress in that case. */
    minRollupMsForShow: 600,
    ariaLabel: 'Skip animation',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.forceSkip) || {};

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
  if (m.disabledPressed != null) cfg.disabledPressed = !!m.disabledPressed;
  if (m.hidePressed != null)     cfg.hidePressed     = !!m.hidePressed;

  if (m.showDuringRollup      != null) cfg.showDuringRollup      = !!m.showDuringRollup;
  if (m.showDuringFsIntro     != null) cfg.showDuringFsIntro     = !!m.showDuringFsIntro;
  if (m.showDuringFsOutro     != null) cfg.showDuringFsOutro     = !!m.showDuringFsOutro;
  if (m.showDuringCelebration != null) cfg.showDuringCelebration = !!m.showDuringCelebration;

  if (Number.isFinite(m.minRollupMsForShow)) {
    cfg.minRollupMsForShow = clampInt(m.minRollupMsForShow, 0, 5000);
  }
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }

  /* Auto-enable when GDD declares a force-skip feature kind. */
  if (model.features && Array.isArray(model.features)) {
    const hasSkipFeature = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(force[_-]?skip|skip[_-]?animation)$/i.test(f.kind),
    );
    if (hasSkipFeature) cfg.enabled = true;
  }

  return cfg;
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function _skipEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitForceSkipCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ forceSkip: cfg });
  return `
  /* ── forceSkip BLOCK — emitted by src/blocks/forceSkip.mjs ────────── */
  .force-skip-btn {
    position: fixed;
    bottom: ${BOTTOM_PX}px;
    left: 50%;
    transform: translateX(-50%);
    z-index: ${Z_INDEX};
    min-width: ${MIN_WIDTH_PX}px;
    min-height: ${MIN_HEIGHT_PX}px;
    padding: ${PADDING_Y_PX}px ${PADDING_X_PX}px;
    border-radius: ${BORDER_RADIUS_PX}px;
    border: ${BORDER_WIDTH_PX}px solid rgba(${c.chipColor}, 1);
    background: rgba(${c.chipColor}, ${BG_OPACITY});
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 700;
    font-size: ${FONT_SIZE_PX}px;
    letter-spacing: ${LETTER_SPACING_PX}px;
    text-transform: uppercase;
    text-shadow: 0 ${TEXT_SHADOW_Y_PX}px ${TEXT_SHADOW_BLUR_PX}px rgba(0, 0, 0, ${TEXT_SHADOW_OPACITY});
    box-shadow: 0 0 ${BOX_GLOW_BLUR_PX}px rgba(${c.chipColor}, ${GLOW_OPACITY}), 0 ${BOX_SHADOW_Y_PX}px ${BOX_SHADOW_BLUR_PX}px rgba(0, 0, 0, ${BOX_SHADOW_OPACITY});
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform ${TRANSFORM_MS}ms ease-out, opacity ${OPACITY_MS}ms ease-out;
  }
  .force-skip-btn[hidden] { display: none !important; }
  .force-skip-btn:active { transform: translateX(-50%) scale(${ACTIVE_SCALE}); }
  .force-skip-btn:disabled { opacity: ${DISABLED_OPACITY}; cursor: default; }
  @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
    .force-skip-btn { font-size: ${MOBILE_FONT_SIZE_PX}px; min-width: ${MOBILE_MIN_WIDTH_PX}px; min-height: ${MOBILE_MIN_HEIGHT_PX}px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .force-skip-btn { transition: none; }
    .force-skip-btn:active { transform: translateX(-50%); }
  }
`;
}

export function emitForceSkipMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ forceSkip: cfg });
  const safeLabel = _skipEscape(c.chipLabel);
  const safeAria = _skipEscape(c.ariaLabel);
  return tagBlockMarkup(`
  <button
    id="forceSkipBtn"
    class="force-skip-btn"
    type="button"
    aria-label="${safeAria}"
    hidden
    data-phase=""
  >${safeLabel}</button>`, 'forceSkip');
}

export function emitForceSkipRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── forceSkip BLOCK (disabled) — stub ────────────────────────────── */
  window.forceSkipShow    = function () {};
  window.forceSkipHide    = function () {};
  window.forceSkipRequest = function () {};
  window.FORCE_SKIP_STATE = { enabled: false, visible: false, currentPhase: null };
  window.__SLOT_SKIPPED__ = false;
`;
  }

  const c = resolveConfig({ forceSkip: cfg });

  return `
  /* ── forceSkip BLOCK — emitted by src/blocks/forceSkip.mjs ───────────
     Owns: emit of onSkipRequested + global window.__SLOT_SKIPPED__ flag.
     Subscribes (for show/hide UI state):
       onSpinResult   → show during rollup (gated by showDuringRollup)
       onFsTrigger    → show during FS intro
       onFsEnd        → show during FS outro
       onSkipComplete → hide + clear flag
       preSpin        → hide (new spin begins) + clear flag
       postSpin       → hide if no rollup follows */
  (function () {
    var DISABLED_PRESSED          = ${c.disabledPressed};
    var HIDE_PRESSED              = ${c.hidePressed};
    var SHOW_DURING_ROLLUP        = ${c.showDuringRollup};
    var SHOW_DURING_FS_INTRO      = ${c.showDuringFsIntro};
    var SHOW_DURING_FS_OUTRO      = ${c.showDuringFsOutro};
    var SHOW_DURING_CELEBRATION   = ${c.showDuringCelebration};
    var MIN_ROLLUP_MS_FOR_SHOW    = ${c.minRollupMsForShow};
    var VALID_PHASES              = ${JSON.stringify([...VALID_PHASES])};
    var HOOKBUS_BIND_RETRIES      = ${HOOKBUS_BIND_RETRIES};

    var STATE = {
      enabled: true,
      visible: false,
      currentPhase: null,
      /* requested: latched true once forceSkipRequest fires; cleared on
       * forceSkipHide. Prevents a double-click / button+Enter race from
       * emitting onSkipRequested twice in the same tick before the
       * disabled attribute paints. */
      requested: false,
    };
    if (typeof window !== 'undefined') {
      window.FORCE_SKIP_STATE = STATE;
      window.__SLOT_SKIPPED__ = false;
    }

    function _btn() { return document.getElementById('forceSkipBtn'); }

    function _phaseGated(phase) {
      if (VALID_PHASES.indexOf(phase) === -1) return false;
      if (phase === 'rollup')      return SHOW_DURING_ROLLUP;
      if (phase === 'fsIntro')     return SHOW_DURING_FS_INTRO;
      if (phase === 'fsOutro')     return SHOW_DURING_FS_OUTRO;
      if (phase === 'celebration') return SHOW_DURING_CELEBRATION;
      return false;
    }

    function forceSkipShow(phase) {
      if (!_phaseGated(phase)) return;
      var btn = _btn();
      if (!btn) return;
      btn.hidden = false;
      btn.disabled = false;
      btn.setAttribute('data-phase', phase);
      STATE.visible = true;
      STATE.currentPhase = phase;
    }

    function forceSkipHide() {
      var btn = _btn();
      if (btn) {
        btn.hidden = true;
        btn.disabled = false;
        btn.setAttribute('data-phase', '');
      }
      STATE.visible = false;
      STATE.currentPhase = null;
      STATE.requested = false;
      if (typeof window !== 'undefined') window.__SLOT_SKIPPED__ = false;
    }

    /* forceSkipRequest(source) — emits onSkipRequested with current phase
     * and sets the global __SLOT_SKIPPED__ flag. Animation-owning blocks
     * poll the flag and bail. They are expected to fire onSkipComplete
     * back; this block then resets the flag via the onSkipComplete
     * listener below. */
    function forceSkipRequest(source) {
      if (!STATE.visible) return;
      if (STATE.requested) return;
      STATE.requested = true;
      var s = (typeof source === 'string' && ['button','keyboard'].indexOf(source) !== -1) ? source : 'button';
      var phase = STATE.currentPhase || 'rollup';
      if (typeof window !== 'undefined') window.__SLOT_SKIPPED__ = true;
      if (DISABLED_PRESSED) {
        var btn = _btn();
        if (btn) btn.disabled = true;
      }
      if (HIDE_PRESSED) {
        var btn2 = _btn();
        if (btn2) btn2.hidden = true;
      }
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('onSkipRequested', { phase: phase, source: s });
      }
    }

    if (typeof window !== 'undefined') {
      window.forceSkipShow    = forceSkipShow;
      window.forceSkipHide    = forceSkipHide;
      window.forceSkipRequest = forceSkipRequest;
    }

    function _wireButton() {
      var btn = _btn();
      if (!btn) return;
      btn.addEventListener('click', function () { forceSkipRequest('button'); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireButton, { once: true });
    } else {
      _wireButton();
    }

    /* Keyboard accessibility: Space / Enter triggers skip while the
     * button is visible. Mirrors the 'keyboard' source whitelisted in
     * forceSkipRequest. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (!STATE.visible) return;
      forceSkipRequest('keyboard');
    });

    /* Deferred HookBus binder: HookBus may load after this script under
     * a different bundle order. Retry on each tick until the API surface
     * appears; loud-fail after the retry budget so a misconfigured page
     * does not silently lose every lifecycle hook. */
    function _bind() {
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        /* onSpinResult → if award > 0, the rollup phase begins; show after
         * the engine emits the eventual rollup duration. We can't know the
         * duration here so we defer the decision: just call forceSkipShow
         * via a microtask delay so winPresentation has wired its own state
         * first. If the rollup turns out shorter than MIN_ROLLUP_MS_FOR_SHOW,
         * winPresentation can call forceSkipHide pre-emptively. */
        window.HookBus.on('onSpinResult', function (payload) {
          /* Read award + rollup duration off the payload first (HookBus
           * single-source-of-truth contract). Fall back to the legacy
           * window globals (__WIN_AWARD__, __WIN_ROLLUP_MS__) only when
           * payload omits the field — this preserves the existing block
           * contract during the migration to payload-only. */
          var totalAward = (payload && payload.totalAward != null)
            ? payload.totalAward
            : (typeof window.__WIN_AWARD__ === 'number' ? window.__WIN_AWARD__ : null);
          var rollupMs   = (payload && payload.rollupMs != null)
            ? payload.rollupMs
            : (typeof window.__WIN_ROLLUP_MS__ === 'number' ? window.__WIN_ROLLUP_MS__ : null);
          /* Defer to a tick so payload-mutating listeners with higher
           * priority have run. */
          setTimeout(function () {
            if (rollupMs != null && rollupMs < MIN_ROLLUP_MS_FOR_SHOW) return;
            if (totalAward != null && totalAward <= 0) return;
            forceSkipShow('rollup');
          }, 0);
        }, { priority: -10 });

        window.HookBus.on('onFsTrigger', function () { forceSkipShow('fsIntro'); });
        window.HookBus.on('onFsEnd',     function () { forceSkipShow('fsOutro'); });

        window.HookBus.on('onSkipComplete', function () { forceSkipHide(); });

        window.HookBus.on('preSpin', function () { forceSkipHide(); });
        window.HookBus.on('postSpin', function () {
          /* Belt-and-suspenders hide. winPresentation.onSpinResult listener
           * is the SOLE owner of "show skip during rollup"; by the time we
           * reach postSpin, either winPresentation has already called
           * forceSkipHide via onSkipComplete, OR no rollup ran and the
           * button must not linger into the idle phase. Either way: hide. */
          if (STATE.visible) forceSkipHide();
        });
        return;
      }
      _bind._tries = (_bind._tries || 0) + 1;
      if (_bind._tries < HOOKBUS_BIND_RETRIES) {
        setTimeout(_bind, 0);
      } else if (typeof console !== 'undefined' && console.error) {
        console.error('[forceSkip] HookBus missing — lifecycle hooks not bound');
      }
    }
    _bind();
  })();
`;
}
