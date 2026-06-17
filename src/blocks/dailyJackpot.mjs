/**
 * Slot GDD Factory · dailyJackpot BLOCK
 *
 * Vendor-neutral DAILY JACKPOT presenter — a persistent pool that grows
 * by a fraction of every bet, resets each UTC day at a configured hour,
 * and on a per-spin random roll awards the current pool snapshot to the
 * player. On hit, the block paints a centered banner overlay and emits
 * `onDailyJackpotAward` so audio, QA harness and analytics can react.
 * Disabled by default — every GDD opts in explicitly (matches the
 * industry baseline: jackpots are an optional layer above the math).
 *
 * Industry reference (jackpotController contribution + roll loop):
 *   • Pool seed → minPoolAmount at the start of every UTC reset window
 *   • Per-spin contribution → bet × contribRate, clamped to maxPoolAmount
 *   • Per-spin award roll  → Math.random() < triggerProbability
 *   • Award snapshot       → current pool value at the moment of the hit
 *   • Reset cadence        → UTC day rollover at configured resetUTCHour
 *   • Suppressed while a higher-priority overlay owns the screen
 *     (FS intro, bigWinTier) so two banners never stack
 *
 * Lifecycle hooks (LEGO doctrine):
 *   preSpin                → check UTC reset, contribute bet to pool
 *   postSpin               → random-roll for award (skipped when suppressed)
 *   onFsTrigger            → suppress (FS intro takes over)
 *   onFsEnd                → un-suppress
 *   onBigWinTierEntered    → suppress (big-win owns the screen)
 *   onBigWinTierExited     → un-suppress
 *
 * GDD-driven configuration (consumed from `model.dailyJackpot`):
 *   enabled              boolean   (default false — off until GDD opts in)
 *   labelText            string    banner label   (default "DAILY JACKPOT")
 *   resetUTCHour         number    0..23 daily reset hour (default 0 — midnight UTC)
 *   minPoolAmount        number    pool floor     (default 1000)
 *   maxPoolAmount        number    pool ceiling   (default 100000)
 *   contribRate          number    per-bet contribution rate (default 0.01 — 1%)
 *   triggerProbability   number    per-spin hit chance (default 0.00001)
 *   holdMs               number    banner visibility duration (default 5000)
 *
 * Currency:
 *   Inherits from balanceHud by default (single UX source of truth for
 *   currency formatting across the slot). Per-block override is exposed
 *   for completeness but rarely set in practice.
 *
 * Public API:
 *   defaultConfig()                  → frozen safe defaults
 *   resolveConfig(model)             → merge defaults with GDD override
 *   emitDailyJackpotCSS(config)      → CSS string (banner + reduced-motion)
 *   emitDailyJackpotMarkup(config)   → HTML fragment (banner host + ARIA)
 *   emitDailyJackpotRuntime(config)  → runtime JS (state, hooks, public API)
 *
 * Runtime contract:
 *   window.DAILY_JACKPOT_STATE       { enabled, pool, lastResetUtcDay, suppressed }
 *   window.dailyJackpotShow(amount)  programmatic kick (QA hook)
 *   window.dailyJackpotForce()       forces next postSpin to award (force chip)
 *
 * Owned events (emits — registered in HookBus canonical list):
 *   onDailyJackpotAward { amount, currency, atUtcDay }
 *     amount   : pool snapshot at the moment of the hit (number)
 *     currency : resolved currency glyph (string)
 *     atUtcDay : reset-window day index for the award
 *
 * Subscribes (no new emits beyond the one above): preSpin, postSpin,
 * onFsTrigger, onFsEnd, onBigWinTierEntered, onBigWinTierExited.
 *
 * Performance budget: emit (CSS + markup + runtime string construction)
 * targets < 200 µs total; per-spin runtime work < 20 µs (one Date.now,
 * one arithmetic compare, one RNG call); zero per-frame allocations.
 */

const DEFAULTS = Object.freeze({
  enabled:            false,
  labelText:          'DAILY JACKPOT',
  resetUTCHour:       0,
  minPoolAmount:      1000,
  maxPoolAmount:      100000,
  contribRate:        0.01,
  triggerProbability: 0.00001,
  holdMs:             5000,
  /* Currency knobs — inherited from balanceHud by default in resolveConfig.
   * Surfaced here so a future GDD can override per-block if needed. */
  currency:           '€',
  currencyPosition:   'prefix',
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isPlainText(s, max = 24) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && !/[<>{}]/.test(s);
}

function clampNum(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(n, lo, hi, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.dailyJackpot) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (isPlainText(src.labelText, 24)) cfg.labelText = src.labelText;
  cfg.resetUTCHour       = clampInt(src.resetUTCHour,       0,                 23,    cfg.resetUTCHour);
  cfg.minPoolAmount      = clampNum(src.minPoolAmount,      1,                 1e9,   cfg.minPoolAmount);
  /* Fable review HIGH-severity catch: when GDD raises minPoolAmount but
   * omits maxPoolAmount, the fallback (default 100000) might be < the
   * new floor. Force the result through Math.max(min, ...) so the
   * documented `max >= min` invariant cannot be violated silently. */
  cfg.maxPoolAmount      = Math.max(
    cfg.minPoolAmount,
    clampNum(src.maxPoolAmount, cfg.minPoolAmount, 1e9, Math.max(cfg.maxPoolAmount, cfg.minPoolAmount))
  );
  cfg.contribRate        = clampNum(src.contribRate,        0,                 1,     cfg.contribRate);
  cfg.triggerProbability = clampNum(src.triggerProbability, 0,                 1,     cfg.triggerProbability);
  cfg.holdMs             = clampNum(src.holdMs,             500,               30000, cfg.holdMs);

  /* Currency inherit: balanceHud > explicit override > default. Mirrors
   * the winRollup / bigWinTier inheritance rule so the WHOLE slot reads
   * currency from a single source. */
  const bh = (model && model.balanceHud) || {};
  if (typeof bh.currency === 'string' && bh.currency.length > 0 && bh.currency.length <= 4) {
    cfg.currency = bh.currency;
  }
  if (bh.currencyPosition === 'prefix' || bh.currencyPosition === 'suffix') {
    cfg.currencyPosition = bh.currencyPosition;
  }
  if (typeof src.currency === 'string' && src.currency.length > 0 && src.currency.length <= 4) {
    cfg.currency = src.currency;
  }
  if (src.currencyPosition === 'prefix' || src.currencyPosition === 'suffix') {
    cfg.currencyPosition = src.currencyPosition;
  }
  return cfg;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[ch]));
}

/* Fable review (medium): single source of truth for the zero-state
 * money string. The markup's initial banner placeholder and the
 * runtime's _fmtMoney would otherwise own decimal precision and
 * suffix-spacing rules independently — a future tweak to one would
 * silently desync from the other until the first award repainted. */
function _formatMoney(n, currency, currencyPosition) {
  let v = Number(n);
  if (!Number.isFinite(v) || v < 0) v = 0;
  const s = v.toFixed(2);
  return currencyPosition === 'suffix' ? (s + ' ' + currency) : (currency + s);
}

export function emitDailyJackpotCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) return `\n/* dailyJackpot BLOCK (disabled by GDD) — no CSS emitted */\n`;

  /* ── private CSS magic-number constants ────────────────────────────────
     Every opacity / blur / accent literal that would otherwise live
     inline in the template has exactly one named declaration (same
     pattern as anticipation.mjs Wave AL-4 / Fable-3). Opacities are
     kept as STRINGS so the emitted CSS text is byte-identical to the
     hand-tuned values — Number.prototype.toString() would collapse
     "0.40" → "0.4" and break any visual-regression snapshots. */

  // Banner backdrop fill — translucent dark plate beneath the glyphs.
  const OPACITY_BANNER_BG          = '0.92';
  // Banner gold rim at steady state.
  const OPACITY_BANNER_BORDER      = '0.85';
  // Outer halo glow alpha — soft warm spread behind the banner.
  const OPACITY_BANNER_GLOW        = '0.40';
  // Label glyph color alpha — slightly recessed under the amount glyph.
  const OPACITY_LABEL              = '0.70';

  // Outer halo blur radius — the soft warm spread behind the banner.
  const BLUR_BANNER_GLOW           = '60px';

  // Banner border width.
  const BORDER_WIDTH_BANNER        = '2px';
  // Banner corner radius.
  const RADIUS_BANNER              = '16px';
  // Banner padding (vertical / horizontal).
  const PAD_BANNER_V               = '26px';
  const PAD_BANNER_H               = '48px';

  // Enter-from-below offset for the fade-in keyframe.
  const LIFT_BANNER_ENTER          = '24px';
  // Fade-in / fade-out cycle duration.
  const DUR_BANNER_FADE_MS         = '320ms';

  // Z-index for the fixed overlay — above the stage and reels but below
  // any modal (modals in this repo park at z >= 1000).
  const Z_INDEX_OVERLAY            = '60';

  // Typography — extracted so a future GDD theme override touches one
  // declaration each. (Currently constants by design: vendor-neutral.)
  const FS_LABEL                   = '14px';
  const FS_AMOUNT                  = '42px';
  const LS_LABEL                   = '0.18em';
  const MARGIN_AMOUNT_TOP          = '6px';

  // Dark plate RGB triplet — translucent base under the gold rim.
  const BANNER_PLATE_RGB           = '8, 7, 10';
  // Gold accent RGB triplet — the celebratory warm color. Centralised
  // here so a future theme override would touch one place.
  const GOLD_ACCENT_RGB            = '201, 162, 39';
  // Cream glyph color — the amount text fill (no transparency needed).
  const TEXT_BANNER_HEX            = '#f6f1d6';

  /* Fable review (medium): isPlainText rejects angle brackets and braces
   * but not the close-comment digraph. A 24-char label could otherwise
   * terminate the knob comment block in the emitted CSS and inject
   * arbitrary rules. Neutralize the digraph by inserting a space
   * between asterisk and slash before baking the label into the
   * comment context. */
  const _labelForCssComment = String(c.labelText).replace(/\x2A\x2F/g, '* /');
  return `
/* ── dailyJackpot BLOCK — emitted by src/blocks/dailyJackpot.mjs ──────────
   GDD knobs (baked at build time):
     enabled            = ${c.enabled}
     labelText          = ${_labelForCssComment}
     resetUTCHour       = ${c.resetUTCHour}
     minPoolAmount      = ${c.minPoolAmount}
     maxPoolAmount      = ${c.maxPoolAmount}
     contribRate        = ${c.contribRate}
     triggerProbability = ${c.triggerProbability}
     holdMs             = ${c.holdMs}

   Fixed-position banner overlay centered over the stage. Fades in on
   award and stays visible for holdMs before fading out. Sits above the
   reels but beneath any modal so a bonusPick or BW overlay still claims
   focus. */
.dailyJackpot-host {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: ${Z_INDEX_OVERLAY};
}
.dailyJackpot-host[data-show="false"] { display: none; }
.dailyJackpot-banner {
  background: rgba(${BANNER_PLATE_RGB}, ${OPACITY_BANNER_BG});
  border: ${BORDER_WIDTH_BANNER} solid rgba(${GOLD_ACCENT_RGB}, ${OPACITY_BANNER_BORDER});
  box-shadow: 0 0 ${BLUR_BANNER_GLOW} rgba(${GOLD_ACCENT_RGB}, ${OPACITY_BANNER_GLOW});
  padding: ${PAD_BANNER_V} ${PAD_BANNER_H};
  border-radius: ${RADIUS_BANNER};
  color: ${TEXT_BANNER_HEX};
  text-align: center;
  animation: dailyJackpot-enter ${DUR_BANNER_FADE_MS} ease-out;
}
.dailyJackpot-label  {
  font-size: ${FS_LABEL};
  letter-spacing: ${LS_LABEL};
  opacity: ${OPACITY_LABEL};
  text-transform: uppercase;
}
.dailyJackpot-amount {
  font-size: ${FS_AMOUNT};
  font-weight: 700;
  margin-top: ${MARGIN_AMOUNT_TOP};
  font-variant-numeric: tabular-nums;
}
@keyframes dailyJackpot-enter {
  from { opacity: 0; transform: translateY(${LIFT_BANNER_ENTER}); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dailyJackpot-banner { animation: none; }
}
`;
}

export function emitDailyJackpotMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) return '';
  /* role="status" + aria-live="polite" — assistive tech announces the
   * award once when the banner appears (a single state change, no risk
   * of screen-reader spam). */
  const zero = _formatMoney(0, c.currency, c.currencyPosition);
  return `<div id="dailyJackpotHost" class="dailyJackpot-host" data-show="false" role="status" aria-live="polite" aria-atomic="true">
      <div class="dailyJackpot-banner">
        <div class="dailyJackpot-label" id="dailyJackpotLabel">${esc(c.labelText)}</div>
        <div class="dailyJackpot-amount" id="dailyJackpotAmount" data-amount="0">${esc(zero)}</div>
      </div>
    </div>`;
}

export function emitDailyJackpotRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) {
    return `
  /* ── dailyJackpot BLOCK (disabled by GDD) — no-op stubs ─────────────── */
  (function () {
    /* Fable review (low): same install guard as the enabled path so a
     * stray duplicate emit (or a hot-rebuild flipping enabled) cannot
     * clobber a live STATE object or QA hooks already wired by the
     * enabled stub. */
    if (typeof window === 'undefined') return;
    if (window.__DAILY_JACKPOT_INSTALLED__) return;
    window.DAILY_JACKPOT_STATE = { enabled: false, pool: 0, lastResetUtcDay: -1, suppressed: false };
    window.dailyJackpotShow  = function () {};
    window.dailyJackpotForce = function () {};
    window.__DAILY_JACKPOT_INSTALLED__ = true;
  })();
`;
  }
  return `
  /* ── dailyJackpot BLOCK — emitted by src/blocks/dailyJackpot.mjs ─────
     Reference flow (industry baseline jackpotController):
       1. preSpin  → check UTC reset window → contribute bet * rate to pool
       2. postSpin → random-roll for award (suppressed during FS / BW)
       3. On award → snapshot pool, emit onDailyJackpotAward, paint banner,
                     reset pool to floor, hide after holdMs
     Currency formatting mirrors balanceHud._formatMoney exactly so the
     player reads a single, consistent currency glyph across the slot. */
  (function () {
    /* Fable review (medium): re-init guard. Hot-reload / re-mount paths
     * would otherwise double-subscribe every HookBus listener and
     * compound contributions/awards. Idempotent flag on window — the
     * flag is only SET after subscriptions are actually wired so that
     * if HookBus is missing at install time a later retry can wire up
     * properly instead of being permanently stuck in an inert state. */
    if (typeof window !== 'undefined' && window.__DAILY_JACKPOT_INSTALLED__) return;
    var LABEL_TEXT     = ${JSON.stringify(c.labelText)};
    var RESET_UTC_HOUR = ${c.resetUTCHour};
    var MIN_POOL       = ${c.minPoolAmount};
    var MAX_POOL       = ${c.maxPoolAmount};
    var CONTRIB_RATE   = ${c.contribRate};
    var TRIGGER_PROB   = ${c.triggerProbability};
    var HOLD_MS        = ${c.holdMs};
    var CURRENCY       = ${JSON.stringify(c.currency)};
    var CUR_POS        = ${JSON.stringify(c.currencyPosition)};

    var MS_PER_DAY = 86400000;
    var MS_PER_HOUR = 3600000;

    var STATE = {
      enabled:         true,
      pool:            MIN_POOL,
      lastResetUtcDay: -1,
      suppressed:      false,
      forceNext:       false,
      awarding:        false,
      timers:          [],
    };
    if (typeof window !== 'undefined') window.DAILY_JACKPOT_STATE = STATE;

    function _host()     { return document.getElementById('dailyJackpotHost'); }
    function _amountEl() { return document.getElementById('dailyJackpotAmount'); }

    function _currentBet() {
      return (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
        ? window.__SLOT_BET__ : 0;
    }

    function _fmtMoney(v) {
      var n = Number(v);
      if (!Number.isFinite(n) || n < 0) n = 0;
      var s = n.toFixed(2);
      return CUR_POS === 'suffix' ? (s + ' ' + CURRENCY) : (CURRENCY + s);
    }

    function _clearTimers() {
      for (var i = 0; i < STATE.timers.length; i++) {
        try { clearTimeout(STATE.timers[i]); } catch (_) {}
      }
      STATE.timers.length = 0;
    }

    /* Reset-window day index. The day "rolls over" at RESET_UTC_HOUR — so
     * for resetUTCHour=6, a Date.now() at 04:00 UTC is still inside the
     * previous day's window. Shift the timestamp back by RESET_UTC_HOUR
     * before flooring to days so each day index aligns with the slot's
     * own jackpot rollover, not the calendar midnight. */
    function _currentResetDay(nowMs) {
      var shifted = nowMs - (RESET_UTC_HOUR * MS_PER_HOUR);
      return Math.floor(shifted / MS_PER_DAY);
    }

    function _maybeResetPool() {
      var today = _currentResetDay(Date.now());
      /* Fable review (medium): monotonic guard. NTP correction, leap
       * second, or device clock skew nudging Date.now() backward across
       * the reset boundary would otherwise wipe an in-flight pool.
       * Only reset on forward day-index advance. */
      if (STATE.lastResetUtcDay === -1) {
        STATE.lastResetUtcDay = today;
        STATE.pool = MIN_POOL;
        return;
      }
      if (today <= STATE.lastResetUtcDay) return;
      STATE.lastResetUtcDay = today;
      STATE.pool = MIN_POOL;
    }

    function _contribute(bet) {
      if (!(bet > 0) || !(CONTRIB_RATE > 0)) return;
      var next = STATE.pool + (bet * CONTRIB_RATE);
      if (next > MAX_POOL) next = MAX_POOL;
      STATE.pool = next;
    }

    function _setAmount(amount) {
      var el = _amountEl();
      if (!el) return;
      el.textContent = _fmtMoney(amount);
      el.setAttribute('data-amount', String(amount));
    }

    function _show() {
      var h = _host();
      if (!h) return;
      h.setAttribute('data-show', 'true');
    }

    function _hide() {
      var h = _host();
      if (!h) return;
      h.setAttribute('data-show', 'false');
    }

    function dailyJackpotShow(amount) {
      amount = Number(amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      /* Fable review (high): claim the awarding gate before painting so
       * a QA-triggered banner shares the same idempotent fence as the
       * organic _award() path — otherwise the next postSpin random-roll
       * could fire _award on top of an already-visible banner. */
      STATE.awarding = true;
      _clearTimers();
      _setAmount(amount);
      _show();
      var tid = setTimeout(function () {
        _hide();
        STATE.awarding = false;
      }, HOLD_MS);
      STATE.timers.push(tid);
    }

    function dailyJackpotForce() {
      STATE.forceNext = true;
    }

    function _award() {
      /* Idempotent guard — never emit a second award while a banner is
       * still on screen. The runtime's postSpin only fires once per spin,
       * but a force chip + organic hit in the same tick could double-fire
       * without this. */
      if (STATE.awarding) return;
      STATE.awarding = true;

      var amount = STATE.pool;
      var atDay  = _currentResetDay(Date.now());

      /* Reset pool to floor for the next contribution cycle. The next
       * UTC reset will land on the same value (idempotent). */
      STATE.pool = MIN_POOL;
      STATE.forceNext = false;

      if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
        try {
          HookBus.emit('onDailyJackpotAward', {
            amount:   amount,
            currency: CURRENCY,
            atUtcDay: atDay,
          });
        } catch (e) {
          /* Fable review (medium): never silently swallow — log the
           * subscriber error so analytics/audio drops are observable.
           * Spin lifecycle still continues (the catch survives the
           * throw), but the diagnostic signal reaches console. */
          if (typeof console !== 'undefined' && console.error) {
            console.error('[dailyJackpot] onDailyJackpotAward subscriber threw:', e);
          }
        }
      }
      dailyJackpotShow(amount);
    }

    if (typeof window !== 'undefined') {
      window.dailyJackpotShow  = dailyJackpotShow;
      window.dailyJackpotForce = dailyJackpotForce;
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      /* preSpin: roll the daily reset window FIRST so a fresh UTC day
       * always starts clean, THEN contribute the current bet. Order
       * matters — if we contributed before checking reset, a bet that
       * landed across the rollover boundary would be wiped. Contribution
       * is skipped while suppressed (FS / BW) — the player isn't paying
       * a base-game bet during those overlays. */
      HookBus.on('preSpin', function () {
        _maybeResetPool();
        if (STATE.suppressed) return;
        _contribute(_currentBet());
      });

      /* postSpin: random-roll for the award unless suppressed. Force chip
       * bypasses the probability roll but still respects suppression — a
       * QA force during FS would otherwise paint over the FS intro. */
      HookBus.on('postSpin', function () {
        if (STATE.suppressed) return;
        if (STATE.awarding)   return;
        /* Fable review (medium): injectable RNG so golden-master tests
         * + replay tooling can drive deterministic outcomes. Production
         * path is unchanged (Math.random) when no override is set. */
        var _rng = (typeof window !== 'undefined' && typeof window.__SLOT_RNG__ === 'function')
          ? window.__SLOT_RNG__
          : Math.random;
        var hit = STATE.forceNext || (_rng() < TRIGGER_PROB);
        if (hit) _award();
      });

      /* FS intro takes over the screen — suppress and hide. Fable review
       * (low): also clear pending forceNext so a QA-pressed force can't
       * fire surprisingly when the FS round eventually ends. */
      HookBus.on('onFsTrigger', function () {
        STATE.suppressed = true;
        STATE.forceNext  = false;
        _clearTimers();
        _hide();
        STATE.awarding = false;
      });
      HookBus.on('onFsEnd', function () {
        STATE.suppressed = false;
      });

      /* Big-win override — bigWinTier is the dominant celebration.
       * Step out of the way so the player reads one banner at a time.
       * Also clear forceNext per the same QA-surprise reasoning above. */
      HookBus.on('onBigWinTierEntered', function () {
        STATE.suppressed = true;
        STATE.forceNext  = false;
        _clearTimers();
        _hide();
        STATE.awarding = false;
      });
      HookBus.on('onBigWinTierExited', function () {
        STATE.suppressed = false;
      });
      /* Subscriptions wired — only NOW mark the block installed so a
       * later retry can recover from a missing-HookBus first attempt. */
      if (typeof window !== 'undefined') window.__DAILY_JACKPOT_INSTALLED__ = true;
    } else if (typeof console !== 'undefined' && console.error) {
      console.error('[dailyJackpot] HookBus missing — block inert');
    }
  })();
`;
}
