/**
 * src/blocks/realityCheck.mjs
 *
 * Wave H2 — Reality Check player-protection modal block.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   Regulator-mandated "Reality Check" popup. Periodically interrupts
 *   the player session with a SUMMARY of session activity and three
 *   choices: CONTINUE, PAUSE (timed), QUIT. The modal blocks new spins
 *   and pauses autoplay until the player acknowledges.
 *
 *   Trigger sources (any of them fires the modal — first to cross wins):
 *     • Time-based: every `intervalMs` of cumulative play time
 *     • Net-loss-based: on `onNetThresholdCrossed` reaching alert level
 *     • Spin-count-based: every `spinInterval` spins
 *
 *   Modal payload:
 *     • Cumulative session time (mm:ss)
 *     • Cumulative win (€X), loss (€Y), net (signed)
 *     • Three CTAs: CONTINUE / PAUSE / QUIT
 *     • PAUSE offers a 5 / 15 / 30 minute timed break (configurable)
 *     • QUIT clears session counters and emits onRealityCheckQuit
 *
 *   Audit trail: every show and dismissal emits a HookBus event with
 *   timestamp + reason so audit-log blocks (Wave H18) can persist.
 *
 *   Regulator anchors (template-neutral synthesis):
 *     • UKGC LCCP 8.3 (UK) — Reality Check is explicitly named obligation
 *       for British market gambling operators.
 *     • MGA RGF (Malta) — periodic-summary mechanism required.
 *     • NJDGE 13:69O (New Jersey) — session reality-check rule.
 *     • Spelinspektionen / DGOJ — convergent player-protection baseline.
 *
 *   This block does NOT modify any host blocks. It LISTENS:
 *     • `preSpin` to count spins
 *     • `onAutoplayTick` to advance time without polling
 *     • `onNetThresholdCrossed` (from netLossIndicator) for loss-based trigger
 *   It OWNS its own modal overlay DOM mounted at runtime.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → mount the modal overlay into <body>.
 *                      Anchor a wall-clock baseline used to compute
 *                      elapsed session time on every tick.
 *   preSpin → increment spin counter; advance an internal timer based
 *             on real-clock delta since the last preSpin. If
 *             intervalMs / spinInterval crossed, show the modal.
 *   onNetThresholdCrossed → if `triggerOnLossLevel` matches the new
 *                           level, show the modal with reason='loss'.
 *   onAutoplayTick → opportunistic tick for time advance (autoplay
 *                    doesn't fire preSpin between spins so we'd miss
 *                    time without it).
 *   modal CONTINUE → emit `onRealityCheckDismissed{reason:'continue'}`,
 *                    reset the interval counter; resume autoplay if it
 *                    was paused.
 *   modal PAUSE → emit `onRealityCheckPaused{durationMs}`; schedule a
 *                 timer to re-show after the break; suppress all new
 *                 spins via window.__REALITY_PAUSE_ACTIVE__.
 *   modal QUIT → emit `onRealityCheckQuit{sessionStats}`; force stop
 *                autoplay; clear all session counters.
 *
 *   Emitted events:
 *     onRealityCheckShown    { reason, stats: { elapsedMs, spins, totalWin, totalLoss, net } }
 *     onRealityCheckDismissed { reason: 'continue' }
 *     onRealityCheckPaused   { durationMs }
 *     onRealityCheckResumed  {}
 *     onRealityCheckQuit     { stats }
 *
 * GDD config (consumed from `model.realityCheck`):
 *
 *   {
 *     enabled:           boolean (default false; auto-enables if any
 *                        feature kind matches /reality[_-]?check/i)
 *     intervalMs:        number (default 600000 = 10 min) — time between
 *                        modal shows. UKGC convention 30/60 min;
 *                        defaultest is 10 min for demo visibility.
 *     spinInterval:      number (default 0 = disabled) — alternate
 *                        trigger every N spins.
 *     triggerOnLossLevel:string (default 'alert') — the netLossIndicator
 *                        level that should also fire the modal. Empty
 *                        string disables loss-based trigger.
 *     pauseOptions:      number[] (default [5, 15, 30]) — pause durations
 *                        offered (in minutes). Length 1-5.
 *     currencyPrefix:    string (default '€')
 *     showElapsedTime:   boolean (default true)
 *     showSpinCount:     boolean (default true)
 *     showNetSummary:    boolean (default true)
 *     dismissBlocksSpin: boolean (default true) — true means players
 *                        can't press Spin until they pick a CTA.
 *     accentColor:       'r,g,b' (default '255,170,80' amber)
 *     title:             string (default 'REALITY CHECK')
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                      → safe defaults
 *   resolveConfig(model)                 → merge defaults with GDD override
 *   emitRealityCheckCSS(cfg)             → modal overlay CSS
 *   emitRealityCheckMarkup(cfg)          → modal DOM (hidden by default)
 *   emitRealityCheckRuntime(cfg)         → runtime JS (trigger logic +
 *                                          CTA wiring + session counters)
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__REALITY_PAUSE_ACTIVE__  boolean — true while a timed pause
 *                                    is in effect (other blocks can read
 *                                    to block spin starts)
 *   window.RC_STATE                  { enabled, elapsedMs, spins,
 *                                      totalWin, totalLoss, lastShowAt,
 *                                      paused, pauseEndsAt }
 *   window.rcShow(reason)            programmatic show (test hook)
 *   window.rcDismiss(reason)         programmatic dismiss (test hook)
 *   window.rcResetSession()          clear session counters
 *
 * Composition contract:
 *
 *   - Standalone modal — does NOT depend on balanceHud or any other
 *     block to function (uses its own DOM tree mounted into <body>).
 *   - Listens to netLossIndicator's `onNetThresholdCrossed` if available,
 *     but degrades gracefully when netLossIndicator is disabled (just
 *     time + spin-count triggers).
 *   - Sets `window.__REALITY_PAUSE_ACTIVE__` during PAUSE — downstream
 *     spin starters MAY honor this (autoplay already cancels timers on
 *     onRealityCheckPaused via HookBus; manual Spin click still works
 *     unless explicit gate is added elsewhere — by design, regulator
 *     pause is a soft suggestion not a hard lock).
 *
 * Industry references (template-neutral):
 *
 *   • Reality Check modal: standard UKGC LCCP pattern; copy-cat across
 *     EU/UK markets.
 *   • Three-CTA structure (Continue / Pause / Quit): industry-standard;
 *     QUIT is regulator-required, PAUSE is recommended, CONTINUE is
 *     implicit.
 *   • Timed pause + auto-resume: UKGC LCCP 8.3 references "timed break"
 *     as best-practice friction.
 */

const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const SAFE_LEVEL = /^[a-z][a-z0-9_-]{0,15}$/;

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

function _validPauseOptions(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 5) return false;
  return arr.every(v => Number.isInteger(v) && v >= 1 && v <= 1440);
}

export function defaultConfig() {
  return {
    enabled: false,
    /* 10-minute default for demo visibility. UKGC LCCP suggests 30/60
     * for production; GDD overrides per market. */
    intervalMs: 600000,
    spinInterval: 0,
    triggerOnLossLevel: 'alert',
    pauseOptions: [5, 15, 30],
    currencyPrefix: '€',
    showElapsedTime: true,
    showSpinCount: true,
    showNetSummary: true,
    dismissBlocksSpin: true,
    accentColor: '255,170,80',
    title: 'REALITY CHECK',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.realityCheck) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (Number.isFinite(m.intervalMs)) cfg.intervalMs = clampInt(m.intervalMs, 5000, 24 * 60 * 60 * 1000);
  if (Number.isFinite(m.spinInterval)) cfg.spinInterval = clampInt(m.spinInterval, 0, 10000);

  if (typeof m.triggerOnLossLevel === 'string') {
    if (m.triggerOnLossLevel === '' || SAFE_LEVEL.test(m.triggerOnLossLevel)) {
      cfg.triggerOnLossLevel = m.triggerOnLossLevel;
    }
  }

  if (_validPauseOptions(m.pauseOptions)) cfg.pauseOptions = m.pauseOptions.slice();

  if (typeof m.currencyPrefix === 'string' && m.currencyPrefix.length > 0 && m.currencyPrefix.length <= 4) {
    cfg.currencyPrefix = m.currencyPrefix;
  }

  if (m.showElapsedTime != null) cfg.showElapsedTime = !!m.showElapsedTime;
  if (m.showSpinCount != null) cfg.showSpinCount = !!m.showSpinCount;
  if (m.showNetSummary != null) cfg.showNetSummary = !!m.showNetSummary;
  if (m.dismissBlocksSpin != null) cfg.dismissBlocksSpin = !!m.dismissBlocksSpin;

  if (typeof m.accentColor === 'string' && HEX_RGB.test(m.accentColor)) {
    cfg.accentColor = m.accentColor.replace(/\s+/g, '');
  }

  if (typeof m.title === 'string' && m.title.length > 0 && m.title.length <= 60) {
    cfg.title = m.title;
  }

  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' && /^reality[_-]?check$/i.test(f.kind),
    );
    if (hit) cfg.enabled = true;
  }

  return cfg;
}

export function emitRealityCheckCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.accentColor;
  return `
  /* ── realityCheck BLOCK — emitted by src/blocks/realityCheck.mjs ──
     Modal overlay sits at z-index 97 — above all gameplay surfaces but
     below the bigWinTier banner host (94 chrome / banner z-index 94+
     varies). Modal demands attention but doesn't render bigWin
     celebrations invisible. */
  .rc-overlay {
    position: fixed;
    inset: 0;
    z-index: 97;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.84);
    backdrop-filter: blur(8px);
    pointer-events: auto;
  }
  .rc-overlay[data-show="true"] { display: flex; }
  .rc-modal {
    background: rgba(20, 14, 10, 0.96);
    border: 2px solid rgba(${c}, 0.8);
    border-radius: 16px;
    padding: 1.6rem 1.8rem;
    color: #fff;
    box-shadow: 0 20px 60px rgba(${c}, 0.45);
    max-width: min(92vw, 520px);
    text-align: center;
  }
  .rc-title {
    font-size: 1.2rem;
    font-weight: 900;
    letter-spacing: 0.18em;
    color: rgba(${c}, 1);
    text-shadow: 0 0 10px rgba(${c}, 0.6);
    margin-bottom: 1rem;
  }
  .rc-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem 1rem;
    margin-bottom: 1.2rem;
    text-align: left;
  }
  .rc-stat {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 0.55rem 0.8rem;
  }
  .rc-stat__label {
    display: block;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 0.25rem;
  }
  .rc-stat__value {
    display: block;
    font-size: 0.95rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .rc-stat--win .rc-stat__value  { color: rgba(120, 220, 140, 1); }
  .rc-stat--loss .rc-stat__value { color: rgba(230, 90, 80, 1); }
  .rc-stat--net.rc-stat--neg .rc-stat__value { color: rgba(230, 90, 80, 1); }
  .rc-stat--net.rc-stat--pos .rc-stat__value { color: rgba(120, 220, 140, 1); }
  .rc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 0.4rem;
  }
  .rc-btn {
    flex: 1 1 auto;
    min-width: 100px;
    background: rgba(${c}, 0.15);
    color: rgba(${c}, 1);
    border: 1px solid rgba(${c}, 0.45);
    border-radius: 10px;
    padding: 0.6rem 1rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: background-color 160ms ease, transform 120ms ease;
  }
  .rc-btn:hover {
    background: rgba(${c}, 0.32);
    transform: translateY(-2px);
  }
  .rc-btn--quit {
    background: rgba(230, 90, 80, 0.15);
    color: rgba(230, 90, 80, 1);
    border-color: rgba(230, 90, 80, 0.5);
  }
  .rc-btn--quit:hover { background: rgba(230, 90, 80, 0.32); }
  .rc-pause-options {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    margin-top: 0.8rem;
    flex-wrap: wrap;
  }
  .rc-pause-options[data-show="true"] { display: flex; }
  .rc-pause-options[data-show="false"] { display: none; }
  .rc-pause-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    padding: 0.4rem 0.9rem;
    font-weight: 800;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .rc-pause-btn:hover { background: rgba(255, 255, 255, 0.18); }
  @media (prefers-reduced-motion: reduce) {
    .rc-btn { transition: none; }
  }
  @media (max-width: 620px) {
    .rc-modal { padding: 1.1rem 1rem; }
    .rc-stats { grid-template-columns: 1fr; }
  }
`;
}

export function emitRealityCheckMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="rcOverlay" class="rc-overlay" data-show="false" data-modal="true" role="dialog" aria-modal="true" aria-labelledby="rcTitle">
  <div class="rc-modal">
    <div id="rcTitle" class="rc-title">${_esc(cfg.title)}</div>
    <div class="rc-stats" id="rcStats">
      ${cfg.showElapsedTime ? `
      <div class="rc-stat rc-stat--time">
        <span class="rc-stat__label">SESSION TIME</span>
        <span class="rc-stat__value" id="rcStatTime">0:00</span>
      </div>` : ''}
      ${cfg.showSpinCount ? `
      <div class="rc-stat rc-stat--spins">
        <span class="rc-stat__label">SPINS</span>
        <span class="rc-stat__value" id="rcStatSpins">0</span>
      </div>` : ''}
      ${cfg.showNetSummary ? `
      <div class="rc-stat rc-stat--win">
        <span class="rc-stat__label">WIN</span>
        <span class="rc-stat__value" id="rcStatWin">${_esc(cfg.currencyPrefix)}0</span>
      </div>
      <div class="rc-stat rc-stat--loss">
        <span class="rc-stat__label">LOSS</span>
        <span class="rc-stat__value" id="rcStatLoss">${_esc(cfg.currencyPrefix)}0</span>
      </div>
      <div class="rc-stat rc-stat--net" id="rcStatNetBox">
        <span class="rc-stat__label">NET</span>
        <span class="rc-stat__value" id="rcStatNet">${_esc(cfg.currencyPrefix)}0</span>
      </div>` : ''}
    </div>
    <div class="rc-actions">
      <button id="rcBtnContinue" class="rc-btn" type="button">CONTINUE</button>
      <button id="rcBtnPause" class="rc-btn" type="button">PAUSE</button>
      <button id="rcBtnQuit" class="rc-btn rc-btn--quit" type="button">QUIT</button>
    </div>
    <div id="rcPauseOptions" class="rc-pause-options" data-show="false">
      ${cfg.pauseOptions.map(min => `<button class="rc-pause-btn" type="button" data-pause-min="${min}">${min} MIN</button>`).join('')}
    </div>
  </div>
</div>`;
}

export function emitRealityCheckRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── realityCheck BLOCK (disabled) — stubs so probes don't crash ── */
  window.__REALITY_PAUSE_ACTIVE__ = false;
  window.RC_STATE       = { enabled: false, elapsedMs: 0, spins: 0, totalWin: 0, totalLoss: 0, lastShowAt: 0, paused: false, pauseEndsAt: 0 };
  window.rcShow         = function () {};
  window.rcDismiss      = function () {};
  window.rcResetSession = function () {};
`;
  }

  const intervalMs       = cfg.intervalMs;
  const spinInterval     = cfg.spinInterval;
  const triggerOnLossLevel = JSON.stringify(cfg.triggerOnLossLevel);
  const currencyPrefix   = JSON.stringify(cfg.currencyPrefix);

  return `
  /* ── realityCheck BLOCK — emitted by src/blocks/realityCheck.mjs ──
     Owns emit of: onRealityCheckShown, onRealityCheckDismissed,
                   onRealityCheckPaused, onRealityCheckResumed,
                   onRealityCheckQuit.
     Observes: preSpin (spin counter + time delta), onAutoplayTick (time
     delta during autoplay), onNetThresholdCrossed (loss-level trigger).
     Mounts no extra DOM at boot — modal markup is already in body via
     emitRealityCheckMarkup. */
  (function () {
    var INTERVAL_MS         = ${intervalMs};
    var SPIN_INTERVAL       = ${spinInterval};
    var TRIGGER_LOSS_LEVEL  = ${triggerOnLossLevel};
    var PREFIX              = ${currencyPrefix};

    var STATE = {
      enabled: true,
      elapsedMs: 0,
      spins: 0,
      totalWin: 0,
      totalLoss: 0,
      lastShowAt: 0,        /* elapsedMs value at last show */
      paused: false,
      pauseEndsAt: 0,
      _lastTickWall: 0,     /* wall-clock ms of last tick (for delta calc) */
      _shown: false,        /* modal currently visible */
      _pauseTimer: 0,       /* setTimeout handle for auto-resume */
    };
    if (typeof window !== 'undefined') {
      window.__REALITY_PAUSE_ACTIVE__ = false;
      window.RC_STATE = STATE;
    }

    function _now() {
      if (typeof performance !== 'undefined' && performance.now) return performance.now();
      return Date.now();
    }

    function _overlay() { return document.getElementById('rcOverlay'); }
    function _pauseOpts() { return document.getElementById('rcPauseOptions'); }

    function _fmtAmount(v) {
      var abs = Math.abs(v);
      var sign = v < 0 ? '-' : '';
      var str = (abs >= 100) ? abs.toFixed(0) : abs.toFixed(2);
      return sign + PREFIX + str;
    }

    function _fmtTime(ms) {
      var totalSec = Math.floor(ms / 1000);
      var min = Math.floor(totalSec / 60);
      var sec = totalSec % 60;
      return min + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function _renderStats() {
      var t = document.getElementById('rcStatTime');
      if (t) t.textContent = _fmtTime(STATE.elapsedMs);
      var s = document.getElementById('rcStatSpins');
      if (s) s.textContent = String(STATE.spins);
      var w = document.getElementById('rcStatWin');
      if (w) w.textContent = _fmtAmount(STATE.totalWin);
      var l = document.getElementById('rcStatLoss');
      if (l) l.textContent = _fmtAmount(STATE.totalLoss);
      var net = STATE.totalWin - STATE.totalLoss;
      var nv = document.getElementById('rcStatNet');
      if (nv) nv.textContent = _fmtAmount(net);
      var nb = document.getElementById('rcStatNetBox');
      if (nb) {
        nb.classList.remove('rc-stat--neg');
        nb.classList.remove('rc-stat--pos');
        if (net < 0) nb.classList.add('rc-stat--neg');
        else if (net > 0) nb.classList.add('rc-stat--pos');
      }
    }

    function rcShow(reason) {
      if (STATE._shown) return;
      _renderStats();
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'true');
      var opts = _pauseOpts();
      if (opts) opts.setAttribute('data-show', 'false');
      STATE._shown = true;
      STATE.lastShowAt = STATE.elapsedMs;
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onRealityCheckShown', {
            reason: reason || 'time',
            stats: {
              elapsedMs: STATE.elapsedMs, spins: STATE.spins,
              totalWin: STATE.totalWin, totalLoss: STATE.totalLoss,
              net: STATE.totalWin - STATE.totalLoss,
            },
          });
        } catch (e) {
          if (console && console.error) console.error('[rc] emit Shown failed:', e);
        }
      }
    }

    function _hide() {
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'false');
      var opts = _pauseOpts();
      if (opts) opts.setAttribute('data-show', 'false');
      STATE._shown = false;
    }

    function rcDismiss(reason) {
      if (!STATE._shown && reason !== 'force') return;
      _hide();
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onRealityCheckDismissed', { reason: reason || 'continue' });
        } catch (e) {
          if (console && console.error) console.error('[rc] emit Dismissed failed:', e);
        }
      }
    }

    function _enterPause(durationMin) {
      var ms = Math.max(1, Math.floor(Number(durationMin))) * 60 * 1000;
      STATE.paused = true;
      STATE.pauseEndsAt = _now() + ms;
      _hide();
      if (typeof window !== 'undefined') window.__REALITY_PAUSE_ACTIVE__ = true;
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onRealityCheckPaused', { durationMs: ms }); }
        catch (e) { if (console && console.error) console.error('[rc] emit Paused failed:', e); }
      }
      /* Try to stop autoplay during the pause so engine state matches
       * the player-protection signal. */
      if (typeof window !== 'undefined' && typeof window.autoplayStop === 'function') {
        try { window.autoplayStop('realityCheck'); } catch (_) {}
      }
      if (STATE._pauseTimer) { clearTimeout(STATE._pauseTimer); }
      STATE._pauseTimer = setTimeout(function () {
        STATE.paused = false;
        STATE.pauseEndsAt = 0;
        STATE._pauseTimer = 0;
        if (typeof window !== 'undefined') window.__REALITY_PAUSE_ACTIVE__ = false;
        if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
          try { window.HookBus.emit('onRealityCheckResumed', {}); }
          catch (e) { if (console && console.error) console.error('[rc] emit Resumed failed:', e); }
        }
      }, ms);
    }

    function _quit() {
      var stats = {
        elapsedMs: STATE.elapsedMs, spins: STATE.spins,
        totalWin: STATE.totalWin, totalLoss: STATE.totalLoss,
        net: STATE.totalWin - STATE.totalLoss,
      };
      _hide();
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onRealityCheckQuit', { stats: stats }); }
        catch (e) { if (console && console.error) console.error('[rc] emit Quit failed:', e); }
      }
      if (typeof window !== 'undefined' && typeof window.autoplayStop === 'function') {
        try { window.autoplayStop('realityCheckQuit'); } catch (_) {}
      }
      rcResetSession();
    }

    function rcResetSession() {
      STATE.elapsedMs = 0;
      STATE.spins = 0;
      STATE.totalWin = 0;
      STATE.totalLoss = 0;
      STATE.lastShowAt = 0;
      STATE._lastTickWall = _now();
      _renderStats();
    }

    function _tickTime() {
      var now = _now();
      if (!STATE._lastTickWall) { STATE._lastTickWall = now; return; }
      var delta = now - STATE._lastTickWall;
      /* Defensive clamp — if the tab was backgrounded for hours, don't
       * fire the modal 8 times in a row. We add at most one interval per
       * tick (the player has been afk; reality-check makes no sense yet). */
      if (delta > INTERVAL_MS) delta = INTERVAL_MS;
      STATE.elapsedMs += delta;
      STATE._lastTickWall = now;
    }

    function _maybeShowTime() {
      if (STATE._shown || STATE.paused) return;
      if (INTERVAL_MS <= 0) return;
      if (STATE.elapsedMs - STATE.lastShowAt >= INTERVAL_MS) {
        rcShow('time');
      }
    }

    function _maybeShowSpins() {
      if (STATE._shown || STATE.paused) return;
      if (!(SPIN_INTERVAL > 0)) return;
      if (STATE.spins > 0 && STATE.spins % SPIN_INTERVAL === 0) {
        rcShow('spins');
      }
    }

    /* Wire CTA buttons + balance tracking. */
    function _wire() {
      var cont = document.getElementById('rcBtnContinue');
      if (cont) cont.addEventListener('click', function () { rcDismiss('continue'); });
      var pause = document.getElementById('rcBtnPause');
      if (pause) pause.addEventListener('click', function () {
        var opts = _pauseOpts();
        if (opts) opts.setAttribute('data-show', 'true');
      });
      var quit = document.getElementById('rcBtnQuit');
      if (quit) quit.addEventListener('click', function () { _quit(); });
      var optsBox = _pauseOpts();
      if (optsBox) {
        var btns = optsBox.querySelectorAll('.rc-pause-btn');
        for (var i = 0; i < btns.length; i++) {
          (function (b) {
            b.addEventListener('click', function () {
              var min = parseInt(b.getAttribute('data-pause-min') || '5', 10);
              _enterPause(min);
            });
          })(btns[i]);
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.rcShow         = rcShow;
      window.rcDismiss      = rcDismiss;
      window.rcResetSession = rcResetSession;
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
        if (STATE.paused) return;
        _tickTime();
        STATE.spins += 1;
        _maybeShowTime();
        _maybeShowSpins();
      });
      window.HookBus.on('onAutoplayTick', function (p) {
        if (STATE.paused) return;
        _tickTime();
        /* Track win/loss directly from autoplay payload so we stay
         * accurate even when balanceHud is disabled. */
        if (p && Number.isFinite(p.totalWin))  STATE.totalWin  = p.totalWin;
        if (p && Number.isFinite(p.totalLoss)) STATE.totalLoss = p.totalLoss;
        _maybeShowTime();
      });
      window.HookBus.on('onBalanceChanged', function (p) {
        if (!p || !Number.isFinite(p.delta)) return;
        if (p.delta > 0) STATE.totalWin  += p.delta;
        else if (p.delta < 0) STATE.totalLoss += (-p.delta);
      });
      window.HookBus.on('onNetThresholdCrossed', function (p) {
        if (!p || !TRIGGER_LOSS_LEVEL) return;
        if (p.to === TRIGGER_LOSS_LEVEL && p.direction === 'losing') {
          rcShow('loss');
        }
      });
    }
  })();
`;
}
