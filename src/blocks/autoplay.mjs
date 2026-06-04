/**
 * src/blocks/autoplay.mjs
 *
 * Wave U4 — Autoplay session block.
 *
 * Industry-standard pattern (auto-spin settings panel + session runner):
 *   • Player picks N from a set of supported steps (10 / 25 / 50 / 100 /
 *     250 / 500 / 1000 is the industry baseline).
 *   • Player optionally configures stop-conditions:
 *       - Stop on ANY feature trigger (FS / lightning / bonus pick)
 *       - Stop if single-spin win ≥ X× bet
 *       - Stop if balance falls below Y
 *       - Stop if cumulative session loss ≥ Z
 *       - Stop if cumulative session win ≥ W
 *   • Each autoplay-driven spin runs through the same lifecycle as a
 *     manual spin — the block simply re-fires the spin button (or directly
 *     invokes `window.runOneBaseSpin`) at the right time.
 *
 * The block ONLY owns autoplay session state + the three new HookBus
 * intent events (onAutoplayStart / onAutoplayTick / onAutoplayStop). It
 * NEVER reaches into reelEngine or freeSpins directly — every spin trip
 * goes through the existing spin button click path.
 *
 * Composition contract:
 *   • slamStop (Wave V1) honors `window.__SLOT_AUTOSPIN_ACTIVE__` set by
 *     this block; player can still slam an autoplay spin and that fires
 *     onSlamRequested → reelEngine collapses → we observe and STOP the
 *     session (reason: 'slam') because the player took manual control.
 *   • forceSkip (Wave V2) is unaffected — it only fires during win
 *     presentation / FS intro, which we already handle via stop-on-feature.
 *   • freeSpins (Wave B) takes over when FS triggers; we pause the
 *     autoplay session until onFsEnd, then either resume or stop based
 *     on stopOnAnyFeatureTrigger.
 *
 * Lifecycle (HookBus contract):
 *   onSpinResult    → record single-spin win against threshold
 *   postSpin        → tick session counter; emit onAutoplayTick; decide
 *                     whether to fire next spin or stop
 *   onFsTrigger     → if stopOnAnyFeatureTrigger → stop session; else
 *                     pause until onFsEnd
 *   onFsEnd         → if paused, optionally resume (rare — most players
 *                     want auto to stop on FS)
 *   onSlamRequested → mark session for stop (reason: 'slam') so the
 *                     after-spin tick doesn't fire next spin
 *
 * Bake-time config (resolved from `model.autoplay`):
 *   { enabled, stepValues, defaultStep, betUnitFallback,
 *     stopOnAnyFeatureTrigger, stopOnSingleWinX, stopOnBalanceBelow,
 *     stopOnLossAbove, stopOnWinAbove,
 *     interSpinDelayMs, showCounter,
 *     chipColor, chipTextColor, ariaLabel }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitAutoplayCSS(cfg)     → button + dropdown + counter styles
 *   emitAutoplayMarkup(cfg)  → button host
 *   emitAutoplayRuntime(cfg) → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *   autoplayStart(step?)   / autoplayStop(reason?) / autoplayIsActive()
 *   AUTOPLAY_STATE         on window for introspection
 *
 * Runtime dependencies: HookBus, document, setTimeout, window.runOneBaseSpin.
 */

const INDUSTRY_STEPS = Object.freeze([10, 25, 50, 100, 250, 500, 1000]);

export function defaultConfig() {
  return {
    enabled: false,
    /* Industry-baseline step values. GDD can override to a subset
     * (e.g. low-volatility games may cap at 250). */
    stepValues: INDUSTRY_STEPS.slice(),
    defaultStep: 25,
    /* Fallback bet unit used for the single-win-X comparison when the
     * GDD doesn't specify model.bet.defaultBet. Industry default 1.0. */
    betUnitFallback: 1.0,
    /* Stop conditions — all default OFF; the GDD enables what the math
     * profile requires (e.g. high-volatility profiles often pre-set
     * stopOnSingleWinX = 50 to honor MGA/UKGC autoplay rules). */
    stopOnAnyFeatureTrigger: true,
    stopOnSingleWinX:        null,   /* X bet — null = no stop */
    stopOnBalanceBelow:      null,   /* currency unit — null = no stop */
    stopOnLossAbove:         null,
    stopOnWinAbove:          null,
    /* Inter-spin delay (ms). Default 250ms gives the player time to read
     * the result before the next spin starts; many vendors use 600-800ms
     * for "casual" mode and 100-150ms for "rapid" mode. */
    interSpinDelayMs: 250,
    /* Show the remaining-spins counter overlay during a session. */
    showCounter: true,
    chipColor:     '90,180,255',
    chipTextColor: '255,255,255',
    ariaLabel: 'Auto-spin',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.autoplay) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (Array.isArray(m.stepValues) && m.stepValues.length > 0) {
    const cleaned = m.stepValues
      .filter(n => Number.isFinite(n) && n > 0 && n <= 10000)
      .map(n => Math.round(n));
    /* Drop duplicates while preserving order. */
    const seen = new Set();
    const dedup = [];
    for (const n of cleaned) { if (!seen.has(n)) { seen.add(n); dedup.push(n); } }
    if (dedup.length > 0) cfg.stepValues = dedup;
  }
  /* defaultStep must be one of the allowed stepValues. */
  if (Number.isFinite(m.defaultStep) && cfg.stepValues.includes(Math.round(m.defaultStep))) {
    cfg.defaultStep = Math.round(m.defaultStep);
  } else if (!cfg.stepValues.includes(cfg.defaultStep)) {
    /* Fallback: pick the first allowed step. */
    cfg.defaultStep = cfg.stepValues[0];
  }

  if (Number.isFinite(m.betUnitFallback) && m.betUnitFallback > 0) {
    cfg.betUnitFallback = Math.max(0.01, Math.min(10000, Number(m.betUnitFallback)));
  }

  if (m.stopOnAnyFeatureTrigger != null) cfg.stopOnAnyFeatureTrigger = !!m.stopOnAnyFeatureTrigger;
  for (const key of ['stopOnSingleWinX', 'stopOnBalanceBelow', 'stopOnLossAbove', 'stopOnWinAbove']) {
    if (m[key] === null) {
      cfg[key] = null;
    } else if (Number.isFinite(m[key]) && m[key] > 0) {
      cfg[key] = Number(m[key]);
    }
  }

  if (Number.isFinite(m.interSpinDelayMs)) {
    cfg.interSpinDelayMs = Math.max(0, Math.min(5000, Math.round(m.interSpinDelayMs)));
  }
  if (m.showCounter != null) cfg.showCounter = !!m.showCounter;

  if (typeof m.chipColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipColor)) {
    cfg.chipColor = m.chipColor.replace(/\s+/g, '');
  }
  if (typeof m.chipTextColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipTextColor)) {
    cfg.chipTextColor = m.chipTextColor.replace(/\s+/g, '');
  }
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }

  /* Auto-enable from feature kind. */
  if (model.features && Array.isArray(model.features)) {
    const hasAuto = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(autoplay|auto[_-]?spin|auto[_-]?play)$/i.test(f.kind),
    );
    if (hasAuto) cfg.enabled = true;
  }

  return cfg;
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitAutoplayCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ autoplay: cfg });
  return `
  /* ── autoplay BLOCK — emitted by src/blocks/autoplay.mjs ─────────────
     The session button sits inside .sideHud beside the SPIN button; it
     pops up an inline panel with step value picker + stop-condition
     toggles. The remaining-spins counter overlays bottom-center of the
     reels area while a session is in progress. */
  .autoplay-btn {
    width: var(--spin-auto-size);
    height: var(--spin-auto-size);
    border-radius: 50%;
    border: 2px solid rgba(${c.chipColor}, 0.7);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.25), rgba(${c.chipColor}, 0.1));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.45);
    transition: transform 120ms ease-out, opacity 140ms ease-out;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .autoplay-btn:hover  { transform: scale(1.06); opacity: 0.95; }
  .autoplay-btn:active { transform: scale(0.96); }
  .autoplay-btn.is-active {
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.55), rgba(${c.chipColor}, 0.35));
    border-color: rgba(${c.chipColor}, 1);
    box-shadow:
      0 0 18px rgba(${c.chipColor}, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .autoplay-panel {
    position: absolute;
    bottom: 64px;
    right: 8px;
    z-index: 28;
    min-width: 200px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid rgba(${c.chipColor}, 0.5);
    background: linear-gradient(180deg, rgba(20, 24, 32, 0.96), rgba(8, 10, 14, 0.98));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
  }
  .autoplay-panel[hidden] { display: none !important; }
  .autoplay-panel h4 {
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    opacity: 0.75;
    margin-bottom: 8px;
  }
  .autoplay-steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-bottom: 10px;
  }
  .autoplay-step {
    background: rgba(${c.chipColor}, 0.12);
    border: 1px solid rgba(${c.chipColor}, 0.4);
    color: rgb(${c.chipTextColor});
    border-radius: 8px;
    padding: 6px 0;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
  }
  .autoplay-step.is-selected {
    background: rgba(${c.chipColor}, 0.7);
    border-color: rgba(${c.chipColor}, 1);
  }
  .autoplay-start {
    width: 100%;
    padding: 8px 0;
    border-radius: 8px;
    border: 2px solid rgba(${c.chipColor}, 1);
    background: rgba(${c.chipColor}, 0.85);
    color: rgb(${c.chipTextColor});
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .autoplay-counter {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 22;
    padding: 6px 14px;
    border-radius: 14px;
    border: 1px solid rgba(${c.chipColor}, 0.5);
    background: rgba(0, 0, 0, 0.65);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 1.5px;
    pointer-events: none;
  }
  .autoplay-counter[hidden] { display: none !important; }
  @media (max-width: 480px) {
    .autoplay-panel { right: 4px; min-width: 180px; padding: 10px; }
    .autoplay-counter { bottom: 12px; font-size: 12px; }
  }
`;
}

export function emitAutoplayMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ autoplay: cfg });
  const safeAria = _escape(c.ariaLabel);
  return `
  <button id="autoplayBtn" class="autoplay-btn" type="button" aria-label="${safeAria}">AUTO</button>
  <div id="autoplayPanel" class="autoplay-panel" hidden role="dialog" aria-label="Auto-spin settings">
    <h4>Auto spins</h4>
    <div id="autoplaySteps" class="autoplay-steps"></div>
    <button id="autoplayStart" class="autoplay-start" type="button">Start</button>
  </div>
  <div id="autoplayCounter" class="autoplay-counter" hidden aria-live="polite"></div>`;
}

export function emitAutoplayRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── autoplay BLOCK (disabled) — stub ─────────────────────────────── */
  window.autoplayStart    = function () {};
  window.autoplayStop     = function () {};
  window.autoplayIsActive = function () { return false; };
  window.AUTOPLAY_STATE   = { enabled: false, active: false, remaining: 0 };
  window.__SLOT_AUTOSPIN_ACTIVE__ = false;
`;
  }

  const c = resolveConfig({ autoplay: cfg });
  /* Stringify the constants so the runtime closure carries them as literals
   * — no leaky dependency on the bake-time `c` object. */
  return `
  /* ── autoplay BLOCK — emitted by src/blocks/autoplay.mjs ──────────────
     Owns: emit of onAutoplayStart / onAutoplayTick / onAutoplayStop +
           management of window.__SLOT_AUTOSPIN_ACTIVE__ flag.
     Subscribes:
       onSpinResult     → record single-spin win for threshold check
       postSpin         → tick counter, decide next spin or stop
       onFsTrigger      → stop session (or pause, by config)
       onFsEnd          → resume (if paused) or stay stopped
       onSlamRequested  → mark session for stop reason='slam' */
  (function () {
    var STEP_VALUES    = ${JSON.stringify(c.stepValues)};
    var DEFAULT_STEP   = ${c.defaultStep};
    var BET_UNIT_FB    = ${c.betUnitFallback};
    var STOP_ON_FEAT   = ${c.stopOnAnyFeatureTrigger};
    var STOP_SWX       = ${c.stopOnSingleWinX === null ? 'null' : c.stopOnSingleWinX};
    var STOP_BAL_LO    = ${c.stopOnBalanceBelow === null ? 'null' : c.stopOnBalanceBelow};
    var STOP_LOSS_HI   = ${c.stopOnLossAbove   === null ? 'null' : c.stopOnLossAbove};
    var STOP_WIN_HI    = ${c.stopOnWinAbove    === null ? 'null' : c.stopOnWinAbove};
    var INTER_SPIN_MS  = ${c.interSpinDelayMs};
    var SHOW_COUNTER   = ${c.showCounter};

    var STATE = {
      enabled: true,
      active: false,           /* mid-session boolean */
      remaining: 0,            /* spins left in session */
      completed: 0,            /* spins completed this session */
      step: DEFAULT_STEP,      /* requested session length */
      totalWin: 0,             /* cumulative session win */
      totalLoss: 0,            /* cumulative session NET loss = sum of max(0, cost-win) */
      lastWin: 0,
      lastCost: 0,             /* captured at onSpinResult so postSpin reads the actual bet */
      paused: false,           /* paused during FS round */
      pendingStopReason: null, /* set by external events (slam, feature) */
      nextSpinTimerId: null,
    };
    if (typeof window !== 'undefined') {
      window.AUTOPLAY_STATE = STATE;
      window.__SLOT_AUTOSPIN_ACTIVE__ = false;
    }

    function _btn()      { return document.getElementById('autoplayBtn'); }
    function _panel()    { return document.getElementById('autoplayPanel'); }
    function _stepsHost(){ return document.getElementById('autoplaySteps'); }
    function _startBtn() { return document.getElementById('autoplayStart'); }
    function _counter()  { return document.getElementById('autoplayCounter'); }

    function _renderSteps() {
      var host = _stepsHost();
      if (!host) return;
      host.innerHTML = '';
      for (var i = 0; i < STEP_VALUES.length; i++) {
        var n = STEP_VALUES[i];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'autoplay-step' + (n === STATE.step ? ' is-selected' : '');
        b.textContent = String(n);
        b.setAttribute('data-step', String(n));
        b.addEventListener('click', _onStepClick);
        host.appendChild(b);
      }
    }
    function _onStepClick(ev) {
      var n = Number(ev.currentTarget.getAttribute('data-step'));
      if (!Number.isFinite(n)) return;
      STATE.step = n;
      _renderSteps();
    }
    function _togglePanel() {
      var p = _panel();
      if (!p) return;
      p.hidden = !p.hidden;
      if (!p.hidden) _renderSteps();
    }
    function _updateCounter() {
      var el = _counter();
      if (!el) return;
      if (!SHOW_COUNTER || !STATE.active) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = 'AUTO · ' + STATE.remaining + ' LEFT';
    }
    function _markBtnActive(on) {
      var b = _btn();
      if (b) b.classList.toggle('is-active', !!on);
    }

    /* ─── public API ─────────────────────────────────────────────────── */

    function autoplayStart(stepOverride) {
      if (STATE.active) return;
      var step = Number.isFinite(stepOverride) ? Math.round(stepOverride) : STATE.step;
      if (!STEP_VALUES.includes(step)) step = DEFAULT_STEP;
      STATE.active = true;
      STATE.step = step;
      STATE.remaining = step;
      STATE.completed = 0;
      STATE.totalWin = 0;
      STATE.totalLoss = 0;
      STATE.lastWin = 0;
      STATE.lastCost = 0;
      STATE.paused = false;
      STATE.pendingStopReason = null;
      if (typeof window !== 'undefined') window.__SLOT_AUTOSPIN_ACTIVE__ = true;
      var p = _panel(); if (p) p.hidden = true;
      _markBtnActive(true);
      _updateCounter();
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('onAutoplayStart', { remaining: STATE.remaining, step: step });
      }
      /* Kick first spin via the existing spin button click — keeps a
         single entry point so guards and listeners stay consistent. */
      _scheduleNextSpin(0);
    }

    function autoplayStop(reason) {
      if (!STATE.active && !STATE.pendingStopReason) return;
      var r = (typeof reason === 'string') ? reason : 'manual';
      if (STATE.nextSpinTimerId !== null) {
        clearTimeout(STATE.nextSpinTimerId);
        STATE.nextSpinTimerId = null;
      }
      var completed = STATE.completed;
      STATE.active = false;
      STATE.pendingStopReason = null;
      STATE.remaining = 0;
      STATE.paused = false;
      if (typeof window !== 'undefined') window.__SLOT_AUTOSPIN_ACTIVE__ = false;
      _markBtnActive(false);
      _updateCounter();
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('onAutoplayStop', { reason: r, completed: completed });
      }
    }

    function autoplayIsActive() { return !!STATE.active; }

    if (typeof window !== 'undefined') {
      window.autoplayStart    = autoplayStart;
      window.autoplayStop     = autoplayStop;
      window.autoplayIsActive = autoplayIsActive;
    }

    /* ─── internals ──────────────────────────────────────────────────── */

    function _scheduleNextSpin(delayMs) {
      if (STATE.nextSpinTimerId !== null) clearTimeout(STATE.nextSpinTimerId);
      STATE.nextSpinTimerId = setTimeout(function () {
        STATE.nextSpinTimerId = null;
        if (!STATE.active || STATE.paused) return;
        if (STATE.pendingStopReason) {
          autoplayStop(STATE.pendingStopReason);
          return;
        }
        /* Trigger via the existing spin button click — keeps a single
           entry point through reelEngine.runOneBaseSpin guard. */
        var spinBtn = document.getElementById('spinBtn');
        if (spinBtn && !spinBtn.disabled) spinBtn.click();
      }, Number.isFinite(delayMs) ? Math.max(0, delayMs) : INTER_SPIN_MS);
    }

    function _evalStopAfterSpin() {
      if (!STATE.active) return null;
      if (STOP_SWX !== null && STATE.lastWin >= STOP_SWX * BET_UNIT_FB) return 'singleWinAbove';
      if (STOP_LOSS_HI !== null && STATE.totalLoss >= STOP_LOSS_HI) return 'lossLimit';
      if (STOP_WIN_HI  !== null && STATE.totalWin  >= STOP_WIN_HI)  return 'winLimit';
      if (STOP_BAL_LO  !== null && typeof window.__SLOT_BALANCE__ === 'number'
          && window.__SLOT_BALANCE__ < STOP_BAL_LO) return 'balanceBelow';
      return null;
    }

    /* Button wiring — runs after DOM ready. */
    function _wireDom() {
      var b = _btn();
      if (b) b.addEventListener('click', function () {
        if (STATE.active) autoplayStop('manual');
        else _togglePanel();
      });
      var s = _startBtn();
      if (s) s.addEventListener('click', function () { autoplayStart(STATE.step); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireDom, { once: true });
    } else {
      _wireDom();
    }

    /* HookBus wiring. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {

      window.HookBus.on('onSpinResult', function () {
        if (!STATE.active) return;
        /* Sample any payout the engine has staged for this spin so the
         * single-win-X threshold can fire. winPresentation publishes
         * window.__WIN_AWARD__; if absent (cluster mode), default to 0.
         * Defensive clamp: malicious/buggy upstream writes (NaN, Infinity,
         * negative) must not corrupt session totals downstream. */
        var raw = (typeof window.__WIN_AWARD__ === 'number') ? window.__WIN_AWARD__ : 0;
        STATE.lastWin = (Number.isFinite(raw) && raw >= 0) ? Math.min(raw, 1e10) : 0;
        /* Capture per-spin cost so loss-limit threshold reflects the actual
         * bet for this spin (bet-stepper / ante / bonus-buy may differ from
         * the fallback unit). Engine publishes window.__SLOT_BET__; if not
         * present, fall back to the bake-time unit. */
        var c = (typeof window.__SLOT_BET__ === 'number' && Number.isFinite(window.__SLOT_BET__))
                  ? Math.max(0, window.__SLOT_BET__)
                  : BET_UNIT_FB;
        STATE.lastCost = c;
      }, { priority: -20 });

      window.HookBus.on('postSpin', function (p) {
        if (!STATE.active) return;
        if (p && p.duringFs) return; /* FS spins do not count against autoplay session */
        STATE.completed++;
        STATE.remaining = Math.max(0, STATE.step - STATE.completed);
        STATE.totalWin  += STATE.lastWin;
        /* Loss = actual bet for this spin (not flat fallback). For wins,
         * we treat win-vs-cost net positive as 0 contribution to loss. */
        var net = STATE.lastWin - STATE.lastCost;
        if (net < 0) STATE.totalLoss += (-net);
        _updateCounter();
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          window.HookBus.emit('onAutoplayTick', {
            remaining: STATE.remaining,
            totalWin:  STATE.totalWin,
            totalLoss: STATE.totalLoss,
            lastWin:   STATE.lastWin,
          });
        }
        /* Evaluate stop conditions. */
        var stopReason = _evalStopAfterSpin();
        if (stopReason) { autoplayStop(stopReason); return; }
        if (STATE.remaining <= 0) { autoplayStop('completed'); return; }
        if (STATE.pendingStopReason) { autoplayStop(STATE.pendingStopReason); return; }
        if (STATE.paused) return;
        _scheduleNextSpin(INTER_SPIN_MS);
      }, { priority: -25 });

      window.HookBus.on('onFsTrigger', function () {
        if (!STATE.active) return;
        /* Cancel any pending next-spin timer — FS owns the screen now and
         * the autoplay session must NOT race a spinBtn click through a
         * feature transition. Without this, an INTER_SPIN_MS timer set
         * by the most-recent postSpin (which preceded onFsTrigger by a
         * frame) would fire mid-FS and corrupt state. The setTimeout
         * callback also guards on STATE.paused, but belt-and-suspenders. */
        if (STATE.nextSpinTimerId !== null) {
          clearTimeout(STATE.nextSpinTimerId);
          STATE.nextSpinTimerId = null;
        }
        if (STOP_ON_FEAT) STATE.pendingStopReason = 'feature';
        else STATE.paused = true;
      });

      window.HookBus.on('onFsEnd', function () {
        if (!STATE.active) return;
        /* Defensive: clear any stale timer before deciding next step. */
        if (STATE.nextSpinTimerId !== null) {
          clearTimeout(STATE.nextSpinTimerId);
          STATE.nextSpinTimerId = null;
        }
        if (STATE.pendingStopReason) { autoplayStop(STATE.pendingStopReason); return; }
        STATE.paused = false;
        if (STATE.remaining > 0) _scheduleNextSpin(INTER_SPIN_MS);
        else autoplayStop('completed');
      });

      window.HookBus.on('onSlamRequested', function () {
        if (!STATE.active) return;
        STATE.pendingStopReason = 'slam';
      });
    }
  })();
`;
}
