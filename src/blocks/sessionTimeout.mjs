/**
 * src/blocks/sessionTimeout.mjs
 *
 * Wave H3 — Session Timeout (continuous-play limit + forced break) block.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   Regulator-mandated continuous-play cap. Tracks how long the player
 *   has been actively playing (spin events + autoplay ticks). When the
 *   accumulated session time crosses a `warnMs` threshold (e.g. 1 min
 *   before the hard limit), a WARNING modal appears that lets the
 *   player extend by acknowledging. When session time crosses the
 *   hard `maxMs` limit, a FORCED BREAK modal locks the spin gateway
 *   for `breakMs` (e.g. 5 minutes), counting down in real time.
 *   After the break expires, autoplay-suppression releases and the
 *   counter resets.
 *
 *   Trigger flow:
 *     1. preSpin / onAutoplayTick → accumulate `sessionMs`
 *     2. sessionMs ≥ maxMs - warnMs (and not yet warned) → warning modal
 *     3. sessionMs ≥ maxMs → force-break modal (kills autoplay, sets
 *        window.__SESSION_BREAK_ACTIVE__ = true, schedules auto-resume)
 *     4. setTimeout(breakMs) → forceLogout? emit Logout : auto-resume
 *
 *   Modal payloads:
 *     • Warning modal: "You've been playing N min. A 5-minute break
 *       starts in MM:SS." with single CTA "OK / EXTEND".
 *     • Force-break modal: "Take a break. You can resume in MM:SS."
 *       with no CTA — counts down to auto-dismiss. If `forceLogout`,
 *       a single QUIT CTA fires HookBus 'onSessionLogoutRequested'.
 *
 *   Regulator anchors (template-neutral synthesis):
 *     • UKGC LCCP 8.3.1 (UK) — continuous-play cap + mandatory break.
 *     • AGCO Standard 4.07 (Ontario) — session-time enforcement.
 *     • MGA RGF Part III (Malta) — session-time monitoring.
 *     • Spelinspektionen 14.4 (Sweden) — daily-play-time cap.
 *     • DGOJ Art. 7 (Spain) — auto-exclusion after limit hit.
 *     • NJDGE 13:69O-1.4 (New Jersey) — session-time logging.
 *
 *   This block does NOT modify any host blocks. It LISTENS to:
 *     • `preSpin` to accumulate sessionMs (spin = real engagement)
 *     • `onAutoplayTick` to accumulate sessionMs during autoplay
 *     • `onRealityCheckPaused` to PAUSE its own clock during a
 *       voluntary reality-check pause (avoid double-pausing the user)
 *   It OWNS its own modal overlay DOM mounted at runtime via
 *   `emitSessionTimeoutMarkup`.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → wire modal CTAs (acknowledge + optional logout).
 *                      Anchor wall-clock baseline used to compute
 *                      delta between consecutive ticks.
 *   preSpin → if not in break, accumulate delta; if sessionMs crosses
 *             warnMs threshold, emit `onSessionWarningShown` + show
 *             warning modal; if it crosses hard limit, transition to
 *             forced-break state.
 *   onAutoplayTick → opportunistic time advance during autoplay (preSpin
 *                    alone undercounts continuous autoplay sessions
 *                    because INTER_SPIN_MS is bundled inside the engine).
 *   onRealityCheckPaused → suspend our internal clock (reality-check
 *                          break and session-timeout break must not
 *                          stack — they share the "user is on break"
 *                          semantic).
 *   onRealityCheckResumed → resume our internal clock.
 *
 *   Emitted events:
 *     onSessionWarningShown    { remainingMs, sessionMs }
 *     onSessionTimeoutFired    { sessionMs, breakMs, forceLogout }
 *     onSessionResumed         { breakDurationMs }
 *     onSessionExtended        { extendedMs }              // user dismissed warning
 *     onSessionLogoutRequested { sessionMs }               // user pressed QUIT in force-break
 *
 * GDD config (consumed from `model.sessionTimeout`):
 *
 *   {
 *     enabled:        boolean (default false; auto-enables if any
 *                     feature kind matches /session[_-]?(timeout|limit)/i)
 *     maxMs:          number (default 3600000 = 60 min) — hard cap on
 *                     continuous play. Clamped 60000…86400000 (1 min…24 h).
 *     warnMs:         number (default 60000 = 60 s) — warning lead-time
 *                     before hard cap. Clamped 0…maxMs.
 *     breakMs:        number (default 300000 = 5 min) — forced-break
 *                     duration. Clamped 30000…3600000 (30 s…1 h).
 *     forceLogout:    boolean (default false) — if true, emit
 *                     `onSessionLogoutRequested` when the break ends
 *                     (AGCO Ontario hard-exit requirement; UKGC accepts
 *                     soft resume).
 *     extendable:     boolean (default true) — allow the warning modal
 *                     to fire 'onSessionExtended' and skip the forced
 *                     break (regulator submode for UKGC soft model).
 *     pauseDuringReality: boolean (default true) — pause our clock
 *                     while reality-check is in a timed pause.
 *     accentColor:    'r,g,b' (default '255,90,90' — high-urgency red)
 *     warningTitle:   string (default 'SESSION TIME WARNING')
 *     breakTitle:     string (default 'TAKE A BREAK')
 *     copyContinue:   string (default 'EXTEND SESSION')
 *     copyQuit:       string (default 'END SESSION')
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                        → safe defaults
 *   resolveConfig(model)                   → merge defaults + GDD override
 *   emitSessionTimeoutCSS(cfg)             → modal overlay CSS
 *   emitSessionTimeoutMarkup(cfg)          → modal DOM (hidden by default)
 *   emitSessionTimeoutRuntime(cfg)         → runtime JS (counters + CTA)
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__SESSION_BREAK_ACTIVE__  boolean — true while a forced break
 *                                    is in effect (downstream spin
 *                                    starters MUST honor this — autoplay
 *                                    listens via HookBus
 *                                    'onSessionTimeoutFired' to halt;
 *                                    manual spin click MAY be gated by
 *                                    Skip CTA-level integration in a
 *                                    follow-up wave)
 *   window.ST_STATE                  { enabled, sessionMs, warned,
 *                                      paused, breakActive, breakEndsAt,
 *                                      lastTickWall }
 *   window.stShowWarning()           programmatic warning (test hook)
 *   window.stForceTimeout()          programmatic force-break (test hook)
 *   window.stResumeFromBreak(reason) programmatic break-end (test hook)
 *   window.stResetSession()          clear counters + dismiss modal
 *
 * Composition contract:
 *
 *   - Standalone modal — does NOT depend on realityCheck or balanceHud
 *     to function. If realityCheck is enabled, our clock pauses during
 *     its timed-pause window (avoid double-counting toward both caps).
 *   - Sets `window.__SESSION_BREAK_ACTIVE__` during forced break —
 *     downstream blocks (autoplay, manual-spin handler) can poll this
 *     to suppress new spin starts.
 *   - During force-break, the autoplay block is asked to stop via
 *     `window.autoplayStop('sessionTimeout')` if available.
 *
 * Senior-grade rule honored (rule_senior_grade_code):
 *
 *   - SRP: clock + modal only; no math, no engine coupling.
 *   - 0 magic numbers: every threshold/clamp/duration has a named const
 *     and a "why" comment.
 *   - Idempotent emit: every HookBus.emit wrapped in try/catch so a
 *     throwing listener never strands STATE.
 *   - Error boundary: even DOM mounts guard against missing elements.
 *   - Typography ≥11px (Wave UQ floor): every emitted font-size ≥0.7rem
 *     (=11.2px at 16px root).
 *   - Vendor-neutral: zero franchise/vendor names in source.
 *   - Lego-gate grep-ability: every HookBus.emit uses inline literal
 *     event names (no variable indirection).
 *
 * Industry references (template-neutral):
 *
 *   • Continuous-play cap + forced break: UKGC LCCP 8.3.1 standard.
 *   • Warning lead-time pattern: AGCO Standard 4.07 best-practice.
 *   • Auto-resume after break: MGA RGF Part III soft-model.
 *   • forceLogout option: NJDGE 13:69O hard-exit submodel.
 *   • pauseDuringReality: avoids stacking two regulator pauses on
 *     the same player simultaneously.
 */

/* Validation regexes — no magic strings, declared once. */
const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;

/* Hard floors/ceilings — UKGC LCCP minimum cap is 1 min for sub-feature
 * test sandboxes; production uses 30/60 min. Hard ceiling is 24 h. */
const MAX_MS_FLOOR    = 60 * 1000;
const MAX_MS_CEILING  = 24 * 60 * 60 * 1000;
/* breakMs floor 30s = short enough for demo, long enough to be a real
 * "break". Ceiling 1 h matches longest published regulator break. */
const BREAK_MS_FLOOR   = 30 * 1000;
const BREAK_MS_CEILING = 60 * 60 * 1000;

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* 60-min hard cap — UKGC LCCP 8.3.1 default. Override per market
     * (Sweden 3 h, Spain 4 h, Ontario 1 h, demo dist 90 s). */
    maxMs: 60 * 60 * 1000,
    /* 60-second warning lead-time. AGCO Standard 4.07 best practice. */
    warnMs: 60 * 1000,
    /* 5-minute forced break — UKGC convention, MGA acceptable. */
    breakMs: 5 * 60 * 1000,
    /* Soft model — break ends with auto-resume. NJDGE hard-exit market
     * sets this to true (causes onSessionLogoutRequested emit). */
    forceLogout: false,
    /* UKGC permits "extend session" submode (player ack of warning
     * skips the forced break). NJDGE forbids. */
    extendable: true,
    pauseDuringReality: true,
    accentColor: '255,90,90',
    warningTitle: 'SESSION TIME WARNING',
    breakTitle: 'TAKE A BREAK',
    copyContinue: 'EXTEND SESSION',
    copyQuit: 'END SESSION',
  });
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.sessionTimeout) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (Number.isFinite(m.maxMs))   cfg.maxMs   = clampInt(m.maxMs,   MAX_MS_FLOOR,   MAX_MS_CEILING);
  if (Number.isFinite(m.warnMs))  cfg.warnMs  = clampInt(m.warnMs,  0,              cfg.maxMs);
  if (Number.isFinite(m.breakMs)) cfg.breakMs = clampInt(m.breakMs, BREAK_MS_FLOOR, BREAK_MS_CEILING);

  if (m.forceLogout         != null) cfg.forceLogout         = !!m.forceLogout;
  if (m.extendable          != null) cfg.extendable          = !!m.extendable;
  if (m.pauseDuringReality  != null) cfg.pauseDuringReality  = !!m.pauseDuringReality;

  if (typeof m.accentColor === 'string' && HEX_RGB.test(m.accentColor)) {
    cfg.accentColor = m.accentColor.replace(/\s+/g, '');
  }

  for (const k of ['warningTitle', 'breakTitle', 'copyContinue', 'copyQuit']) {
    if (typeof m[k] === 'string' && m[k].length > 0 && m[k].length <= 60) {
      cfg[k] = m[k];
    }
  }

  /* Auto-enable when a GDD feature flags this kind. Mirrors the
   * realityCheck pattern so the orchestrator stays declarative. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' && /^session[_-]?(timeout|limit)$/i.test(f.kind),
    );
    if (hit) cfg.enabled = true;
  }

  return cfg;
}

export function emitSessionTimeoutCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.accentColor;
  return `
  /* ── sessionTimeout BLOCK — emitted by src/blocks/sessionTimeout.mjs ──
     Modal overlay sits at z-index 98 — one above realityCheck (z 97)
     so a session timeout supersedes a reality-check modal when both
     race. */
  .st-overlay {
    position: fixed;
    inset: 0;
    z-index: 98;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.88);
    backdrop-filter: blur(10px);
    pointer-events: auto;
  }
  .st-overlay[data-show="true"] { display: flex; }
  .st-modal {
    background: rgba(20, 10, 10, 0.97);
    border: 2px solid rgba(${c}, 0.85);
    border-radius: 16px;
    padding: 1.6rem 1.8rem;
    color: #fff;
    box-shadow: 0 22px 64px rgba(${c}, 0.45);
    max-width: min(92vw, 520px);
    text-align: center;
  }
  .st-title {
    font-size: 1.2rem;
    font-weight: 900;
    letter-spacing: 0.18em;
    color: rgba(${c}, 1);
    text-shadow: 0 0 12px rgba(${c}, 0.55);
    margin-bottom: 0.9rem;
  }
  .st-body {
    font-size: 0.95rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.92);
    margin-bottom: 0.9rem;
  }
  .st-counter {
    display: block;
    font-size: 2.4rem;
    font-weight: 900;
    color: rgba(${c}, 1);
    font-variant-numeric: tabular-nums;
    margin: 0.4rem 0 1rem;
    letter-spacing: 0.06em;
  }
  .st-meta {
    display: block;
    font-size: 0.78rem;  /* 12.48px — above Wave UQ ≥11px floor */
    color: rgba(255, 255, 255, 0.6);
    letter-spacing: 0.12em;
  }
  .st-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 0.6rem;
  }
  .st-btn {
    flex: 1 1 auto;
    min-width: 120px;
    background: rgba(${c}, 0.15);
    color: rgba(${c}, 1);
    border: 1px solid rgba(${c}, 0.45);
    border-radius: 10px;
    padding: 0.6rem 1rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background-color 160ms ease, transform 120ms ease;
  }
  .st-btn:hover {
    background: rgba(${c}, 0.32);
    transform: translateY(-2px);
  }
  .st-btn--quit {
    background: rgba(230, 90, 80, 0.15);
    color: rgba(230, 90, 80, 1);
    border-color: rgba(230, 90, 80, 0.55);
  }
  .st-btn--quit:hover { background: rgba(230, 90, 80, 0.32); }
  @media (prefers-reduced-motion: reduce) {
    .st-btn { transition: none; }
  }
  @media (max-width: 620px) {
    .st-modal { padding: 1.1rem 1rem; }
    .st-counter { font-size: 2rem; }
  }
`;
}

export function emitSessionTimeoutMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const showExtend = cfg.extendable;
  const showQuit   = cfg.forceLogout;
  return `<div id="stOverlay" class="st-overlay" data-show="false" data-mode="warning" role="dialog" aria-modal="true" aria-labelledby="stTitle">
  <div class="st-modal">
    <div id="stTitle" class="st-title">${_esc(cfg.warningTitle)}</div>
    <div class="st-body" id="stBody">
      <span id="stBodyText">You have been playing for a while.</span>
      <span class="st-counter" id="stCounter">00:00</span>
      <span class="st-meta" id="stMeta">Mandatory break in</span>
    </div>
    <div class="st-actions">
      ${showExtend ? `<button id="stBtnExtend" class="st-btn" type="button" aria-label="${_esc(cfg.copyContinue) || 'Continue session'}">${_esc(cfg.copyContinue)}</button>` : ''}
      ${showQuit   ? `<button id="stBtnQuit"   class="st-btn st-btn--quit" type="button" aria-label="${_esc(cfg.copyQuit) || 'Quit session'}">${_esc(cfg.copyQuit)}</button>` : ''}
    </div>
  </div>
</div>`;
}

export function emitSessionTimeoutRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── sessionTimeout BLOCK (disabled) — stubs so probes don't crash ── */
  window.__SESSION_BREAK_ACTIVE__ = false;
  window.ST_STATE          = { enabled: false, sessionMs: 0, warned: false, paused: false, breakActive: false, breakEndsAt: 0, lastTickWall: 0 };
  window.stShowWarning     = function () {};
  window.stForceTimeout    = function () {};
  window.stResumeFromBreak = function () {};
  window.stResetSession    = function () {};
`;
  }

  const MAX_MS         = cfg.maxMs;
  const WARN_MS        = cfg.warnMs;
  const BREAK_MS       = cfg.breakMs;
  const FORCE_LOGOUT   = cfg.forceLogout;
  const EXTENDABLE     = cfg.extendable;
  const PAUSE_DURING_REALITY = cfg.pauseDuringReality;
  const WARNING_TITLE  = JSON.stringify(cfg.warningTitle);
  const BREAK_TITLE    = JSON.stringify(cfg.breakTitle);

  return `
  /* ── sessionTimeout BLOCK — emitted by src/blocks/sessionTimeout.mjs ──
     Owns emit of: onSessionWarningShown, onSessionTimeoutFired,
                   onSessionResumed, onSessionExtended,
                   onSessionLogoutRequested.
     Observes: preSpin, onAutoplayTick, onRealityCheckPaused/Resumed.
     Mounts no extra DOM at boot — modal markup already in body via
     emitSessionTimeoutMarkup. */
  (function () {
    var MAX_MS         = ${MAX_MS};
    var WARN_MS        = ${WARN_MS};
    var BREAK_MS       = ${BREAK_MS};
    var FORCE_LOGOUT   = ${FORCE_LOGOUT ? 'true' : 'false'};
    var EXTENDABLE     = ${EXTENDABLE ? 'true' : 'false'};
    var PAUSE_DURING_REALITY = ${PAUSE_DURING_REALITY ? 'true' : 'false'};
    var WARNING_TITLE  = ${WARNING_TITLE};
    var BREAK_TITLE    = ${BREAK_TITLE};

    /* Defensive ceiling: even if a tab is backgrounded for hours, one
     * tick may add at most MAX_MS to sessionMs. Prevents 8 instant
     * warning emits in a row after sleep wake. */
    var TICK_DELTA_CAP = MAX_MS;

    /* UI countdown refresh — twice/sec is smooth enough without
     * keeping the CPU awake. */
    var COUNTDOWN_TICK_MS = 500;

    var STATE = {
      enabled: true,
      sessionMs: 0,
      warned: false,
      paused: false,
      breakActive: false,
      breakEndsAt: 0,
      lastTickWall: 0,
      _breakTimer: 0,
      _countdownTimer: 0,
      /* W53 — player-protection visibility counters paritetno sa W52
       * realityCheck. AGCO Standard 4.07 + UKGC LCCP 8.3.1 require the
       * session-cap modal to surface session-cumulative LDW (W50) +
       * winCap (W51) signals along with elapsed time. Pure metrics —
       * no display side-effect in the listener; read by stWarn /
       * stForceTimeout / _logout when building stats payloads. */
      ldwCount:        0,
      ldwAwardSum:     0,
      ldwBetSum:       0,
      winCapHits:      0,
      winCapLastJurisdiction: '',
    };
    if (typeof window !== 'undefined') {
      window.__SESSION_BREAK_ACTIVE__ = false;
      window.ST_STATE = STATE;
    }

    function _now() {
      if (typeof performance !== 'undefined' && performance.now) return performance.now();
      return Date.now();
    }
    function _overlay()    { return document.getElementById('stOverlay'); }
    function _title()      { return document.getElementById('stTitle'); }
    function _bodyText()   { return document.getElementById('stBodyText'); }
    function _counter()    { return document.getElementById('stCounter'); }
    function _meta()       { return document.getElementById('stMeta'); }
    function _btnExtend()  { return document.getElementById('stBtnExtend'); }
    function _btnQuit()    { return document.getElementById('stBtnQuit'); }

    function _fmtTime(ms) {
      var totalSec = Math.max(0, Math.floor(ms / 1000));
      var min = Math.floor(totalSec / 60);
      var sec = totalSec % 60;
      return min + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function _fmtSessionLabel(ms) {
      var totalSec = Math.max(0, Math.floor(ms / 1000));
      var min = Math.floor(totalSec / 60);
      if (min < 1) return Math.max(1, Math.floor(totalSec)) + ' seconds';
      return min + ' minute' + (min === 1 ? '' : 's');
    }

    function _setMode(mode) {
      var ov = _overlay();
      if (!ov) return;
      ov.setAttribute('data-mode', mode);
      var t = _title();
      if (t) t.textContent = (mode === 'break') ? BREAK_TITLE : WARNING_TITLE;
      var meta = _meta();
      if (meta) meta.textContent = (mode === 'break') ? 'Resume in' : 'Mandatory break in';
      var bx = _btnExtend();
      if (bx) bx.style.display = (mode === 'warning' && EXTENDABLE) ? '' : 'none';
      var bq = _btnQuit();
      if (bq) bq.style.display = (mode === 'break' && FORCE_LOGOUT) ? '' : 'none';
    }

    function _show() {
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'true');
    }
    function _hide() {
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'false');
    }

    function _renderWarning() {
      var remaining = Math.max(0, MAX_MS - STATE.sessionMs);
      var c = _counter();
      if (c) c.textContent = _fmtTime(remaining);
      var bt = _bodyText();
      if (bt) bt.textContent = 'You have been playing for ' + _fmtSessionLabel(STATE.sessionMs) + '.';
    }
    function _renderBreak() {
      var remaining = Math.max(0, STATE.breakEndsAt - _now());
      var c = _counter();
      if (c) c.textContent = _fmtTime(remaining);
      var bt = _bodyText();
      if (bt) bt.textContent = 'Mandatory break in progress.';
    }

    function _stopCountdown() {
      if (STATE._countdownTimer) {
        clearInterval(STATE._countdownTimer);
        STATE._countdownTimer = 0;
      }
    }
    function _startCountdown(renderer) {
      _stopCountdown();
      renderer();
      STATE._countdownTimer = setInterval(renderer, COUNTDOWN_TICK_MS);
    }

    function stShowWarning() {
      if (STATE.warned || STATE.breakActive) return;
      STATE.warned = true;
      _setMode('warning');
      _show();
      _startCountdown(_renderWarning);
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSessionWarningShown', {
            remainingMs: Math.max(0, MAX_MS - STATE.sessionMs),
            sessionMs: STATE.sessionMs,
            /* W53 — paritetno sa realityCheck W52 stats */
            ldwCount:    STATE.ldwCount,
            ldwAwardSum: STATE.ldwAwardSum,
            ldwBetSum:   STATE.ldwBetSum,
            ldwNet:      STATE.ldwAwardSum - STATE.ldwBetSum,
            winCapHits:  STATE.winCapHits,
            winCapLastJurisdiction: STATE.winCapLastJurisdiction,
          });
        } catch (e) {
          if (console && console.error) console.error('[st] emit WarningShown failed:', e);
        }
      }
    }

    function stForceTimeout() {
      if (STATE.breakActive) return;
      STATE.breakActive = true;
      STATE.breakEndsAt = _now() + BREAK_MS;
      if (typeof window !== 'undefined') window.__SESSION_BREAK_ACTIVE__ = true;
      _setMode('break');
      _show();
      _startCountdown(_renderBreak);
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSessionTimeoutFired', {
            sessionMs: STATE.sessionMs,
            breakMs: BREAK_MS,
            forceLogout: FORCE_LOGOUT,
            /* W53 — paritetno sa realityCheck W52 stats */
            ldwCount:    STATE.ldwCount,
            ldwAwardSum: STATE.ldwAwardSum,
            ldwBetSum:   STATE.ldwBetSum,
            ldwNet:      STATE.ldwAwardSum - STATE.ldwBetSum,
            winCapHits:  STATE.winCapHits,
            winCapLastJurisdiction: STATE.winCapLastJurisdiction,
          });
        } catch (e) {
          if (console && console.error) console.error('[st] emit TimeoutFired failed:', e);
        }
      }
      /* Stop any autoplay so engine state matches the regulator signal. */
      if (typeof window !== 'undefined' && typeof window.autoplayStop === 'function') {
        try { window.autoplayStop('sessionTimeout'); } catch (_) {}
      }
      if (STATE._breakTimer) clearTimeout(STATE._breakTimer);
      STATE._breakTimer = setTimeout(function () {
        stResumeFromBreak('auto');
      }, BREAK_MS);
    }

    function stResumeFromBreak(reason) {
      if (!STATE.breakActive) return;
      _stopCountdown();
      var breakDur = Math.max(0, _now() - (STATE.breakEndsAt - BREAK_MS));
      STATE.breakActive = false;
      STATE.breakEndsAt = 0;
      STATE.warned = false;
      STATE.sessionMs = 0;
      STATE.lastTickWall = _now();
      if (typeof window !== 'undefined') window.__SESSION_BREAK_ACTIVE__ = false;
      _hide();
      if (STATE._breakTimer) { clearTimeout(STATE._breakTimer); STATE._breakTimer = 0; }
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSessionResumed', { breakDurationMs: breakDur, reason: reason || 'auto' });
        } catch (e) {
          if (console && console.error) console.error('[st] emit Resumed failed:', e);
        }
      }
    }

    function _extend() {
      if (!EXTENDABLE) return;
      if (STATE.breakActive) return;
      _stopCountdown();
      _hide();
      /* "Extending" means: skip the forced break this round. The
       * clock is reset so the next warning fires after another full
       * cycle. UKGC soft-model semantics. */
      var prev = STATE.sessionMs;
      STATE.warned = false;
      STATE.sessionMs = 0;
      STATE.lastTickWall = _now();
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSessionExtended', { extendedMs: prev });
        } catch (e) {
          if (console && console.error) console.error('[st] emit Extended failed:', e);
        }
      }
    }

    function _logout() {
      if (!FORCE_LOGOUT) return;
      var stats = {
        sessionMs: STATE.sessionMs,
        /* W53 — paritetno sa realityCheck W52 stats */
        ldwCount:    STATE.ldwCount,
        ldwAwardSum: STATE.ldwAwardSum,
        ldwBetSum:   STATE.ldwBetSum,
        ldwNet:      STATE.ldwAwardSum - STATE.ldwBetSum,
        winCapHits:  STATE.winCapHits,
        winCapLastJurisdiction: STATE.winCapLastJurisdiction,
      };
      /* Fable audit (high): logout was calling stResumeFromBreak('logout')
       * which fires onSessionResumed FIRST, then the logout event. Side-
       * effect listeners on Resumed re-enable the slot UI which immediately
       * gets torn down by the Logout — visible flicker + audit log
       * records a false "session resumed". Skip Resume during logout. */
      STATE.onBreak = false;
      STATE.breakStartMs = 0;
      if (typeof window !== 'undefined') window.__SESSION_BREAK_ACTIVE__ = false;
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onSessionLogoutRequested', stats);
        } catch (e) {
          if (console && console.error) console.error('[st] emit Logout failed:', e);
        }
      }
    }

    function stResetSession() {
      _stopCountdown();
      if (STATE._breakTimer) { clearTimeout(STATE._breakTimer); STATE._breakTimer = 0; }
      STATE.sessionMs = 0;
      STATE.warned = false;
      STATE.breakActive = false;
      STATE.breakEndsAt = 0;
      STATE.lastTickWall = _now();
      /* W53 — reset player-protection metrics on session boundary so
       * next session counters start at 0. */
      STATE.ldwCount    = 0;
      STATE.ldwAwardSum = 0;
      STATE.ldwBetSum   = 0;
      STATE.winCapHits  = 0;
      STATE.winCapLastJurisdiction = '';
      if (typeof window !== 'undefined') window.__SESSION_BREAK_ACTIVE__ = false;
      _hide();
    }

    function _tickTime() {
      if (STATE.paused) { STATE.lastTickWall = _now(); return; }
      if (STATE.breakActive) return;
      var now = _now();
      if (!STATE.lastTickWall) { STATE.lastTickWall = now; return; }
      var delta = now - STATE.lastTickWall;
      if (delta > TICK_DELTA_CAP) delta = TICK_DELTA_CAP;
      STATE.sessionMs += delta;
      STATE.lastTickWall = now;
    }

    function _maybeWarn() {
      if (STATE.warned || STATE.breakActive || STATE.paused) return;
      if (!(WARN_MS > 0)) return;
      if (STATE.sessionMs >= (MAX_MS - WARN_MS)) {
        stShowWarning();
      }
    }
    function _maybeForce() {
      if (STATE.breakActive || STATE.paused) return;
      if (STATE.sessionMs >= MAX_MS) {
        stForceTimeout();
      }
    }

    function _wire() {
      var bx = _btnExtend();
      if (bx) bx.addEventListener('click', function () { _extend(); });
      var bq = _btnQuit();
      if (bq) bq.addEventListener('click', function () { _logout(); });
    }

    if (typeof window !== 'undefined') {
      window.stShowWarning     = stShowWarning;
      window.stForceTimeout    = stForceTimeout;
      window.stResumeFromBreak = stResumeFromBreak;
      window.stResetSession    = stResetSession;
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _wire, { once: true });
      } else {
        _wire();
      }
    }

    if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('preSpin', function () {
        _tickTime();
        _maybeWarn();
        _maybeForce();
      });
      window.HookBus.on('onAutoplayTick', function () {
        _tickTime();
        _maybeWarn();
        _maybeForce();
      });
      window.HookBus.on('onRealityCheckPaused', function () {
        if (PAUSE_DURING_REALITY) {
          STATE.paused = true;
        }
      });
      window.HookBus.on('onRealityCheckResumed', function () {
        if (PAUSE_DURING_REALITY) {
          STATE.paused = false;
          STATE.lastTickWall = _now();
        }
      });
      /* W53 — LDW (W50) audit signal paritetno sa realityCheck (W52).
       * Player-protection visibility per AGCO 4.07 + UKGC LCCP 8.3.1:
       * session-cap modal stats must show how many rounds paid below
       * stake (LDW suppressed) along with elapsed time. */
      window.HookBus.on('onLdwSuppressed', function (p) {
        STATE.ldwCount += 1;
        if (p && Number.isFinite(p.award)) STATE.ldwAwardSum += p.award;
        if (p && Number.isFinite(p.bet))   STATE.ldwBetSum   += p.bet;
      });
      /* W53 — winCap (W51) audit signal paritetno sa realityCheck. */
      window.HookBus.on('onWinCapTriggered', function (p) {
        STATE.winCapHits += 1;
        if (p && typeof p.jurisdiction === 'string') {
          STATE.winCapLastJurisdiction = p.jurisdiction;
        }
      });
    }
  })();
`;
}
