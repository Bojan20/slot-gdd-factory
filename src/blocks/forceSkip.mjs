/**
 * src/blocks/forceSkip.mjs
 *
 * Wave V2 — Force-Skip button block.
 *
 * Industry-reference pattern (playa-slot ForceSkipCommand.ts):
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
 */

const VALID_PHASES = Object.freeze(['rollup', 'fsIntro', 'fsOutro', 'celebration']);

export function defaultConfig() {
  return {
    enabled: false,
    chipLabel: 'SKIP',
    /* Distinct from slam-stop red so the player can't confuse them. */
    chipColor: '90,180,255',
    chipTextColor: '255,255,255',
    /* Mirror of playa-slot ForceSkipCommand `_disabledPressed`: once
     * pressed, disable the button so a second click cannot re-fire the
     * skip request mid-collapse. */
    disabledPressed: true,
    /* Mirror of playa-slot `_hidePressed`: optionally also hide visually
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
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
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
  /* z-index 25: above slam-stop (20), below uiToast (30). */
  return `
  /* ── forceSkip BLOCK — emitted by src/blocks/forceSkip.mjs ────────── */
  .force-skip-btn {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 25;
    min-width: 140px;
    min-height: 44px;
    padding: 8px 24px;
    border-radius: 22px;
    border: 2px solid rgba(${c.chipColor}, 1);
    background: rgba(${c.chipColor}, 0.85);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 18px rgba(${c.chipColor}, 0.45), 0 3px 8px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 100ms ease-out, opacity 140ms ease-out;
  }
  .force-skip-btn[hidden] { display: none !important; }
  .force-skip-btn:active { transform: translateX(-50%) scale(0.96); }
  .force-skip-btn:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 480px) {
    .force-skip-btn { font-size: 12px; min-width: 110px; min-height: 38px; }
  }
`;
}

export function emitForceSkipMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ forceSkip: cfg });
  const safeLabel = _skipEscape(c.chipLabel);
  const safeAria = _skipEscape(c.ariaLabel);
  return `
  <button
    id="forceSkipBtn"
    class="force-skip-btn"
    type="button"
    aria-label="${safeAria}"
    hidden
    data-phase=""
  >${safeLabel}</button>`;
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

    var STATE = {
      enabled: true,
      visible: false,
      currentPhase: null,
    };
    if (typeof window !== 'undefined') {
      window.FORCE_SKIP_STATE = STATE;
      window.__SLOT_SKIPPED__ = false;
    }

    function _btn() { return document.getElementById('forceSkipBtn'); }

    function _phaseGated(phase) {
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
      if (typeof window !== 'undefined') window.__SLOT_SKIPPED__ = false;
    }

    /* forceSkipRequest(source) — emits onSkipRequested with current phase
     * and sets the global __SLOT_SKIPPED__ flag. Animation-owning blocks
     * poll the flag and bail. They are expected to fire onSkipComplete
     * back; this block then resets the flag via the onSkipComplete
     * listener below. */
    function forceSkipRequest(source) {
      if (!STATE.visible) return;
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

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      /* onSpinResult → if award > 0, the rollup phase begins; show after
       * the engine emits the eventual rollup duration. We can't know the
       * duration here so we defer the decision: just call forceSkipShow
       * via a microtask delay so winPresentation has wired its own state
       * first. If the rollup turns out shorter than MIN_ROLLUP_MS_FOR_SHOW,
       * winPresentation can call forceSkipHide pre-emptively. */
      window.HookBus.on('onSpinResult', function (payload) {
        /* Defer to a tick so payload.totalAward (if set by winPresentation
         * listener with priority > 0) is visible. */
        setTimeout(function () {
          if (window.__WIN_ROLLUP_MS__ != null && window.__WIN_ROLLUP_MS__ < MIN_ROLLUP_MS_FOR_SHOW) return;
          if (window.__WIN_AWARD__ != null && window.__WIN_AWARD__ <= 0) return;
          forceSkipShow('rollup');
        }, 0);
      }, { priority: -10 });

      window.HookBus.on('onFsTrigger', function () { forceSkipShow('fsIntro'); });
      window.HookBus.on('onFsEnd',     function () { forceSkipShow('fsOutro'); });

      window.HookBus.on('onSkipComplete', function () { forceSkipHide(); });

      window.HookBus.on('preSpin', function () { forceSkipHide(); });
      window.HookBus.on('postSpin', function () {
        /* Hide if no rollup follows. winPresentation calls forceSkipShow
         * itself when it kicks off rollup; otherwise we don't show here. */
        if (!STATE.visible) return;
      });
    }
  })();
`;
}
