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
    /* Industry-default ON. Autoplay is a baseline player control across
     * every modern HTML5 slot vendor; only GDDs that explicitly forbid
     * autoplay (jurisdictional restriction) flip this to false. */
    enabled: true,
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
  /* ── industry-reference autoplay modal (Wrath-of-Olympus pattern) ──
     Trigger lives in `.sideHud #autoBtn` (orchestrator-owned). When the
     player taps it we open a FULL-SCREEN dark-gold modal with:
       • header  — "AUTOPLAY" + close (×)
       • numberOfSpins — chip grid (10/25/50/.../1000)
       • stopConditions — feature toggle + 3 numeric thresholds
       • footer  — "BACK" (cancel) + "START AUTOPLAY" (gold CTA)
     During a live session the remaining-spins counter overlays
     bottom-center of the reels area; `.autoplay-counter` is the same. */
  return `
  /* ── autoplay BLOCK — emitted by src/blocks/autoplay.mjs ──────────── */

  /* Backdrop — full-screen dim layer with focus trap. z-index 40 puts it
     above stage + utility rail but under the FS overlay (which is 60+). */
  .autoplay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: autoplay-fade-in 180ms ease-out;
  }
  .autoplay-backdrop[hidden] { display: none !important; }
  @keyframes autoplay-fade-in { from { opacity: 0; } to { opacity: 1; } }

  /* Modal — centred sheet, max-width capped so it reads as a dialog,
     not a full-bleed pane. Gold border + soft glow follows the
     industry-reference dark-gold palette. */
  .autoplay-modal {
    width: min(420px, 100%);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: linear-gradient(180deg, rgba(${c.modalBgColor}, 0.98), rgba(${c.modalBgColor}, 1));
    border: 1px solid rgba(${c.chipColor}, 0.45);
    border-radius: 18px;
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.65),
      inset 0 1px 0 rgba(${c.chipColor}, 0.18);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    animation: autoplay-pop-in 220ms cubic-bezier(.2,.9,.3,1.1);
  }
  @keyframes autoplay-pop-in {
    from { transform: translateY(8px) scale(0.96); opacity: 0; }
    to   { transform: translateY(0)    scale(1);    opacity: 1; }
  }

  .autoplay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 12px 20px;
    border-bottom: 1px solid rgba(${c.chipColor}, 0.22);
  }
  .autoplay-title {
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: rgb(${c.chipColor});
    margin: 0;
  }
  .autoplay-close {
    background: transparent;
    border: 1px solid rgba(${c.chipColor}, 0.45);
    color: rgb(${c.chipTextColor});
    width: 30px; height: 30px;
    border-radius: 50%;
    font-size: 16px; font-weight: 800;
    line-height: 1;
    cursor: pointer;
    transition: transform 120ms ease-out, background 160ms ease-out;
  }
  .autoplay-close:hover  { background: rgba(${c.chipColor}, 0.18); transform: scale(1.06); }
  .autoplay-close:active { transform: scale(0.94); }

  .autoplay-section { padding: 14px 20px; }
  .autoplay-section + .autoplay-section { border-top: 1px solid rgba(${c.chipColor}, 0.12); }
  .autoplay-section-title {
    font-size: 11px;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    opacity: 0.66;
    margin-bottom: 10px;
  }

  /* Step picker — wraps to two rows on the seven-value baseline. */
  .autoplay-steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .autoplay-step {
    background: rgba(${c.chipColor}, 0.10);
    border: 1px solid rgba(${c.chipColor}, 0.42);
    color: rgb(${c.chipTextColor});
    border-radius: 10px;
    padding: 10px 0;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    text-align: center;
    transition: background 140ms ease-out, transform 100ms ease-out, border-color 140ms ease-out;
  }
  .autoplay-step:hover  { background: rgba(${c.chipColor}, 0.22); }
  .autoplay-step:active { transform: scale(0.96); }
  .autoplay-step.is-selected {
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.75), rgba(${c.chipColor}, 0.55));
    border-color: rgba(${c.chipColor}, 1);
    color: rgb(${c.modalBgColor});
    box-shadow: 0 0 14px rgba(${c.chipColor}, 0.45), inset 0 1px 0 rgba(255,255,255,0.22);
  }

  /* Stop-conditions rows — toggle on the left, numeric input on the right. */
  .autoplay-stop-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px dashed rgba(${c.chipColor}, 0.12);
  }
  .autoplay-stop-row:last-of-type { border-bottom: none; }
  .autoplay-stop-label {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.4px;
    line-height: 1.3;
    opacity: 0.92;
  }
  .autoplay-stop-hint {
    display: block;
    font-size: 10.5px;
    font-weight: 500;
    opacity: 0.55;
    margin-top: 2px;
  }
  .autoplay-toggle {
    position: relative;
    width: 40px;
    height: 22px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(${c.chipColor}, 0.4);
    border-radius: 999px;
    cursor: pointer;
    transition: background 180ms ease-out, border-color 180ms ease-out;
  }
  .autoplay-toggle::after {
    content: '';
    position: absolute;
    top: 2px; left: 2px;
    width: 16px; height: 16px;
    background: rgb(${c.chipTextColor});
    border-radius: 50%;
    transition: transform 180ms cubic-bezier(.4,1.4,.5,1);
    box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  .autoplay-toggle[aria-pressed="true"] {
    background: rgba(${c.chipColor}, 0.65);
    border-color: rgb(${c.chipColor});
  }
  .autoplay-toggle[aria-pressed="true"]::after { transform: translateX(18px); }
  .autoplay-input {
    width: 92px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid rgba(${c.chipColor}, 0.4);
    background: rgba(0, 0, 0, 0.4);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 700;
    font-size: 13px;
    text-align: right;
    -moz-appearance: textfield;
  }
  .autoplay-input::-webkit-outer-spin-button,
  .autoplay-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .autoplay-input:disabled { opacity: 0.45; cursor: not-allowed; }
  .autoplay-input:focus { outline: 2px solid rgba(${c.chipColor}, 0.7); outline-offset: 1px; }
  .autoplay-input-prefix {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    opacity: 0.7;
    margin-right: 6px;
  }

  /* Footer — two CTAs side-by-side. */
  .autoplay-actions {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 10px;
    padding: 14px 20px 20px 20px;
    border-top: 1px solid rgba(${c.chipColor}, 0.18);
  }
  .autoplay-action {
    padding: 12px 0;
    border-radius: 12px;
    font-weight: 900;
    font-size: 13px;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 100ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out;
  }
  .autoplay-action:active { transform: scale(0.97); }
  .autoplay-action--cancel {
    background: transparent;
    border: 1.5px solid rgba(${c.chipColor}, 0.45);
    color: rgb(${c.chipTextColor});
  }
  .autoplay-action--cancel:hover { background: rgba(${c.chipColor}, 0.10); }
  .autoplay-action--start {
    background: linear-gradient(180deg, rgba(${c.chipColor}, 1), rgba(${c.chipColor}, 0.78));
    border: 1.5px solid rgba(${c.chipColor}, 1);
    color: rgb(${c.modalBgColor});
    box-shadow:
      0 4px 18px rgba(${c.chipColor}, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.32);
  }
  .autoplay-action--start:hover {
    box-shadow:
      0 6px 22px rgba(${c.chipColor}, 0.65),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }

  /* During an active session the modal stays closed; this floating chip
     shows the count remaining. Re-uses bottom-center under the reels. */
  .autoplay-counter {
    position: fixed;
    bottom: calc(max(18px, env(safe-area-inset-bottom, 18px)) + 110px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 22;
    padding: 7px 16px;
    border-radius: 16px;
    border: 1px solid rgba(${c.chipColor}, 0.6);
    background: rgba(0, 0, 0, 0.72);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 1.6px;
    pointer-events: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
  }
  .autoplay-counter[hidden] { display: none !important; }

  @media (max-width: 620px) {
    .autoplay-backdrop  { padding: 14px; }
    .autoplay-modal     { width: 100%; border-radius: 14px; }
    .autoplay-header    { padding: 14px 16px 10px 16px; }
    .autoplay-section   { padding: 12px 16px; }
    .autoplay-actions   { padding: 12px 16px 16px 16px; }
    .autoplay-steps     { grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .autoplay-step      { padding: 9px 0; font-size: 12px; }
    .autoplay-input     { width: 78px; font-size: 12px; }
    .autoplay-counter   { font-size: 12px; bottom: 96px; }
  }

  /* Reduced-motion gate — kill the pop-in animation + toggle transition. */
  @media (prefers-reduced-motion: reduce) {
    .autoplay-modal { animation: none; }
    .autoplay-backdrop { animation: none; }
    .autoplay-toggle::after { transition: none; }
  }
`;
}

export function emitAutoplayMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* Boki rule (04.06.2026): autoplay reuses the EXISTING `#autoBtn`
   * already rendered by the orchestrator inside `.sideHud` next to the
   * spin CTA. The block emits ONLY the modal backdrop + counter overlay
   * — never a duplicate floating button. The runtime wires the click +
   * active-state behaviour onto the existing `#autoBtn`. */
  /* WoO-style modal: header, spin-count grid, four stop-condition rows,
   * footer with Back + Start CTAs. All controls are accessible
   * (role="dialog" + aria-modal, focus-trap, ESC-close) and inputs
   * use type=number with inputmode=decimal for mobile keyboards. */
  return `
  <div id="autoplayBackdrop" class="autoplay-backdrop" hidden role="dialog"
       aria-modal="true" aria-labelledby="autoplayTitle">
    <div id="autoplayModal" class="autoplay-modal" role="document">
      <header class="autoplay-header">
        <h2 id="autoplayTitle" class="autoplay-title">Autoplay</h2>
        <button id="autoplayCloseBtn" class="autoplay-close" type="button"
                aria-label="Close autoplay settings">×</button>
      </header>

      <section class="autoplay-section" aria-labelledby="autoplaySpinsTitle">
        <div id="autoplaySpinsTitle" class="autoplay-section-title">Number of spins</div>
        <div id="autoplaySteps" class="autoplay-steps" role="radiogroup"
             aria-label="Number of autoplay spins"></div>
      </section>

      <section class="autoplay-section" aria-labelledby="autoplayStopTitle">
        <div id="autoplayStopTitle" class="autoplay-section-title">Stop autoplay</div>

        <div class="autoplay-stop-row">
          <div class="autoplay-stop-label">
            On any feature trigger
            <span class="autoplay-stop-hint">Stops when Free Spins or bonus is hit</span>
          </div>
          <button id="autoplayStopFeatureToggle" class="autoplay-toggle" type="button"
                  role="switch" aria-checked="true" aria-pressed="true"
                  aria-label="Stop on any feature trigger"></button>
        </div>

        <div class="autoplay-stop-row">
          <div class="autoplay-stop-label">
            If single win exceeds
            <span class="autoplay-stop-hint">Stops on a single spin payout above N×bet</span>
          </div>
          <div>
            <span class="autoplay-input-prefix">×</span>
            <input id="autoplayStopSingleWinX" class="autoplay-input" type="number"
                   min="0" step="1" inputmode="decimal"
                   aria-label="Single win threshold (multiplier of bet)" />
          </div>
        </div>

        <div class="autoplay-stop-row">
          <div class="autoplay-stop-label">
            If cash increases by
            <span class="autoplay-stop-hint">Stops when session win meets this amount</span>
          </div>
          <input id="autoplayStopWinAbove" class="autoplay-input" type="number"
                 min="0" step="0.01" inputmode="decimal"
                 aria-label="Cumulative win threshold" />
        </div>

        <div class="autoplay-stop-row">
          <div class="autoplay-stop-label">
            If cash decreases by
            <span class="autoplay-stop-hint">Stops when session loss meets this amount</span>
          </div>
          <input id="autoplayStopLossAbove" class="autoplay-input" type="number"
                 min="0" step="0.01" inputmode="decimal"
                 aria-label="Cumulative loss threshold" />
        </div>
      </section>

      <footer class="autoplay-actions">
        <button id="autoplayCancelBtn" class="autoplay-action autoplay-action--cancel"
                type="button">Back</button>
        <button id="autoplayStart" class="autoplay-action autoplay-action--start"
                type="button">Start Autoplay</button>
      </footer>
    </div>
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

    /* Reuse the existing .sideHud autoBtn rendered by the orchestrator.
     * Boki rule: no duplicate floating button. */
    function _btn()         { return document.getElementById('autoBtn'); }
    function _backdrop()    { return document.getElementById('autoplayBackdrop'); }
    function _modal()       { return document.getElementById('autoplayModal'); }
    function _closeBtn()    { return document.getElementById('autoplayCloseBtn'); }
    function _cancelBtn()   { return document.getElementById('autoplayCancelBtn'); }
    function _stepsHost()   { return document.getElementById('autoplaySteps'); }
    function _startBtn()    { return document.getElementById('autoplayStart'); }
    function _counter()     { return document.getElementById('autoplayCounter'); }
    function _featToggle()  { return document.getElementById('autoplayStopFeatureToggle'); }
    function _swxInput()    { return document.getElementById('autoplayStopSingleWinX'); }
    function _winInput()    { return document.getElementById('autoplayStopWinAbove'); }
    function _lossInput()   { return document.getElementById('autoplayStopLossAbove'); }

    /* Mutable per-session thresholds — start as bake-time values then
     * mirror any in-modal input edits. */
    var RUNTIME_STOP = {
      onFeature:    STOP_ON_FEAT,
      singleWinX:   STOP_SWX,
      winAbove:     STOP_WIN_HI,
      lossAbove:    STOP_LOSS_HI,
      balanceBelow: STOP_BAL_LO,
    };

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
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(n === STATE.step));
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
    function _syncToggle() {
      var t = _featToggle();
      if (!t) return;
      var on = !!RUNTIME_STOP.onFeature;
      t.setAttribute('aria-pressed', String(on));
      t.setAttribute('aria-checked', String(on));
    }
    function _syncInputs() {
      var swx = _swxInput();  if (swx)  swx.value  = RUNTIME_STOP.singleWinX == null ? '' : String(RUNTIME_STOP.singleWinX);
      var win = _winInput();  if (win)  win.value  = RUNTIME_STOP.winAbove   == null ? '' : String(RUNTIME_STOP.winAbove);
      var los = _lossInput(); if (los)  los.value  = RUNTIME_STOP.lossAbove  == null ? '' : String(RUNTIME_STOP.lossAbove);
    }
    function _readThresholdInput(el) {
      if (!el) return null;
      var raw = el.value;
      if (raw === '' || raw == null) return null;
      var n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    }
    function _showModal() {
      var bd = _backdrop();
      if (!bd) return;
      _renderSteps();
      _syncToggle();
      _syncInputs();
      bd.hidden = false;
      /* Move keyboard focus to Start so the player can press Enter. */
      var s = _startBtn();
      if (s) try { s.focus({ preventScroll: true }); } catch (_) { s.focus(); }
    }
    function _hideModal() {
      var bd = _backdrop();
      if (bd) bd.hidden = true;
    }
    function _isModalOpen() {
      var bd = _backdrop();
      return !!(bd && !bd.hidden);
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
      _hideModal();
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
      var swx  = RUNTIME_STOP.singleWinX;
      var loss = RUNTIME_STOP.lossAbove;
      var win  = RUNTIME_STOP.winAbove;
      var bal  = RUNTIME_STOP.balanceBelow;
      if (swx  !== null && STATE.lastWin   >= swx * BET_UNIT_FB) return 'singleWinAbove';
      if (loss !== null && STATE.totalLoss >= loss)              return 'lossLimit';
      if (win  !== null && STATE.totalWin  >= win)               return 'winLimit';
      if (STOP_BAL_LO  !== null && typeof window.__SLOT_BALANCE__ === 'number'
          && window.__SLOT_BALANCE__ < STOP_BAL_LO) return 'balanceBelow';
      return null;
    }

    /* Button wiring — runs after DOM ready. */
    function _wireDom() {
      /* The sideHud autoBtn toggles the modal; if a session is live a
       * second tap cancels it (industry-standard behaviour). */
      var b = _btn();
      if (b) b.addEventListener('click', function () {
        if (STATE.active) { autoplayStop('manual'); return; }
        if (_isModalOpen()) _hideModal(); else _showModal();
      });

      /* Footer Start CTA — commits thresholds + launches the session. */
      var s = _startBtn();
      if (s) s.addEventListener('click', function () {
        RUNTIME_STOP.singleWinX = _readThresholdInput(_swxInput());
        RUNTIME_STOP.winAbove   = _readThresholdInput(_winInput());
        RUNTIME_STOP.lossAbove  = _readThresholdInput(_lossInput());
        autoplayStart(STATE.step);
      });

      /* Footer Back + header X + backdrop click all just close the modal. */
      var cancel = _cancelBtn();
      if (cancel) cancel.addEventListener('click', _hideModal);
      var x = _closeBtn();
      if (x) x.addEventListener('click', _hideModal);
      var bd = _backdrop();
      if (bd) bd.addEventListener('click', function (ev) {
        /* Only treat clicks on the backdrop itself as dismiss — clicks
         * on the modal contents must NOT close (industry convention). */
        if (ev.target === bd) _hideModal();
      });

      /* Feature-trigger toggle — flips RUNTIME_STOP.onFeature live. */
      var ft = _featToggle();
      if (ft) ft.addEventListener('click', function () {
        RUNTIME_STOP.onFeature = !RUNTIME_STOP.onFeature;
        _syncToggle();
      });

      /* Live-mirror numeric inputs into RUNTIME_STOP so the player sees
       * their edits respected even before pressing Start. */
      var swx = _swxInput();
      if (swx) swx.addEventListener('input', function () {
        RUNTIME_STOP.singleWinX = _readThresholdInput(swx);
      });
      var win = _winInput();
      if (win) win.addEventListener('input', function () {
        RUNTIME_STOP.winAbove = _readThresholdInput(win);
      });
      var los = _lossInput();
      if (los) los.addEventListener('input', function () {
        RUNTIME_STOP.lossAbove = _readThresholdInput(los);
      });

      /* ESC key closes the modal (industry-standard a11y). */
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && _isModalOpen()) {
          ev.preventDefault();
          _hideModal();
        }
      });
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
        if (RUNTIME_STOP.onFeature) STATE.pendingStopReason = 'feature';
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
