/**
 * Slot GDD Factory · winRollup BLOCK
 *
 * Base-game total-win counter that ticks "TOTAL WIN: €X.XX" with a
 * slot-machine digit-by-digit rollup whenever a regular win lands and
 * stays as a steady display until the next spin. Sits ABOVE the hub
 * (between the reels and the balance HUD) — Boki rule 05.06.2026:
 * *"obican counter u base game iznad Hub-a koji stoji"*.
 *
 * Industry reference (statusBarController.rollupWin):
 *   • centi-precision linear counter, 30 updates/s, no easing
 *   • duration scales with award (default 400 ms for sub-1× wins,
 *     scaled by award/bet ratio so big stacks count longer)
 *   • suppressed when award/bet ≥ bigWinTriggerRatio (default 10×) —
 *     bigWinTier owns that frame
 *   • currency formatted identically to balanceHud (single UX source
 *     of truth for the slot)
 *
 * Lifecycle hooks (LEGO doctrine):
 *   onWinPresentationStart → start rollup if award>0 & ratio<bigWinTrigger
 *   onWinPresentationEnd   → ensure final value is shown (defensive)
 *   onBigWinTierEntered    → suppress (big-win is taking over the screen)
 *   preSpin                → reset display to idle (next spin begins)
 *   onFsTrigger            → suppress during FS intro
 *   onFsEnd                → reset
 *
 * GDD-driven configuration (consumed from `model.winRollup`):
 *   enabled              boolean   (default true — every base game needs this)
 *   labelText            string    label prefix    (default "TOTAL WIN")
 *   bigWinTriggerRatio   number    suppress threshold (default 10 — matches
 *                                  bigWinTier tier-1 default)
 *   minDurationMs        number    rollup floor      (default 400)
 *   maxDurationMs        number    rollup ceiling    (default 2000)
 *   msPerBetMultiple     number    extra rollup ms per 1× bet above 1×
 *                                  (default 60 — at 5× bet → ~640 ms,
 *                                  at 10× bet → ~940 ms then capped at
 *                                  bigWinTriggerRatio)
 *   holdMs               number    steady-display hold after counter
 *                                  reaches target (default 0 — Boki rule
 *                                  "stoji" means the display persists
 *                                  until next preSpin clears it)
 *
 * Public API:
 *   defaultConfig()                 → safe defaults
 *   resolveConfig(model)            → merge defaults with GDD override
 *                                     (inherits currency from balanceHud)
 *   emitWinRollupCSS(config)        → CSS string
 *   emitWinRollupMarkup(config)     → HTML fragment mounted above the hub
 *   emitWinRollupRuntime(config)    → runtime JS (lifecycle wiring)
 *
 * Runtime contract:
 *   window.WIN_ROLLUP_STATE         { enabled, active, lastAward, suppressed }
 *   window.winRollupShow(amount)    programmatic kick (test hook)
 *   window.winRollupClear()         clear display (test hook)
 *
 * Owned events (emits — registered in HookBus canonical list):
 *   none — passive presenter. Subscribes to the win-presentation chain
 *   but does not produce new events. Audio bus listens to the existing
 *   onWinPresentationStart/End — winRollup is a sibling UI presenter.
 */

const DEFAULTS = Object.freeze({
  enabled:            true,
  labelText:          'TOTAL WIN',
  bigWinTriggerRatio: 10,
  minDurationMs:      400,
  maxDurationMs:      2000,
  msPerBetMultiple:   60,
  holdMs:             0,
  /* Currency knobs — inherited from balanceHud by default in resolveConfig.
   * Surfaced here so a future GDD can override per-block if needed. */
  currency:           '€',
  currencyPosition:   'prefix',
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isPlainText(s, max = 40) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && !/[<>{}]/.test(s);
}

function clampNum(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.winRollup) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (isPlainText(src.labelText, 24)) cfg.labelText = src.labelText;
  if (Number.isFinite(src.bigWinTriggerRatio) && src.bigWinTriggerRatio > 0) {
    cfg.bigWinTriggerRatio = src.bigWinTriggerRatio;
  }
  const minResolved = clampNum(src.minDurationMs, 50, 5000, cfg.minDurationMs);
  cfg.minDurationMs = minResolved;
  cfg.maxDurationMs = clampNum(
    src.maxDurationMs,
    minResolved,
    10000,
    Math.max(cfg.maxDurationMs, minResolved)
  );
  cfg.msPerBetMultiple = clampNum(src.msPerBetMultiple, 0,  1000,  cfg.msPerBetMultiple);
  cfg.holdMs           = clampNum(src.holdMs,           0,  10000, cfg.holdMs);

  /* Currency inherit: balanceHud > explicit override > default. Mirrors
   * the bigWinTier inheritance rule so the WHOLE slot reads currency
   * from a single source. */
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

export function emitWinRollupCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ winRollup: cfg });
  if (!c.enabled) return `\n/* winRollup BLOCK (disabled) — no CSS emitted */\n`;
  return `
/* ── winRollup BLOCK — emitted by src/blocks/winRollup.mjs ────────────
   Sits above the .hub element. Hidden when no win is active; fades in
   when onWinPresentationStart fires with a sub-big-win award. The host
   is a flex row so the label + value stay on one line at any width;
   container queries shrink font + gap on narrow viewports.

   Layout integration (LEGO ownership — the block injects its own grid
   row into the stage so themeCSS doesn't have to know about it). The
   default .stage grid is "header / play / hub"; when the host exists
   we insert a 4th row "winRollup" between play and hub via :has(). */
.stage:has(#winRollupHost) {
  grid-template-areas:
    "header"
    "play"
    "winRollup"
    "hub";
  grid-template-rows: auto 1fr auto auto;
}
.win-rollup-host {
  grid-area: winRollup;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 6px 0 4px;
  margin: 0 auto;
  width: 100%;
  pointer-events: none;
  min-height: 36px;
}
.win-rollup-banner {
  display: inline-flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 18px;
  border-radius: 12px;
  background: rgba(15, 12, 10, 0.55);
  border: 1px solid rgba(255, 214, 110, 0.32);
  backdrop-filter: blur(4px);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 230, 170, 0.95);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 220ms ease, transform 220ms ease, border-color 320ms ease;
  white-space: nowrap;
}
.win-rollup-banner[data-show="true"] {
  opacity: 1;
  transform: translateY(0);
}
.win-rollup-banner .win-rollup-label {
  font-size: clamp(11px, 1.4vw, 14px);
  color: rgba(255, 214, 110, 0.78);
}
.win-rollup-banner .win-rollup-amount {
  font-size: clamp(18px, 2.6vw, 26px);
  color: rgba(255, 240, 200, 1);
  font-variant-numeric: tabular-nums;     /* digits don't jiggle while counting */
  letter-spacing: 0.04em;
  filter:
    drop-shadow(0 1px 0 rgba(0,0,0,0.55))
    drop-shadow(0 3px 6px rgba(255, 200, 80, 0.35));
}
/* Tier accent — tracks the soft "medium win" celebration band used by
 * the industry reference (multiplier 1×–10× = warm glow, no big-win
 * overlay). Class added by runtime when ratio >= 1 but < bigWinTrigger. */
.win-rollup-banner.is-celebrate {
  border-color: rgba(255, 214, 110, 0.7);
  box-shadow: 0 0 24px rgba(255, 214, 110, 0.28);
}
.win-rollup-banner.is-celebrate .win-rollup-amount {
  filter:
    drop-shadow(0 1px 0 rgba(0,0,0,0.65))
    drop-shadow(0 4px 10px rgba(255, 200, 80, 0.55));
}
@media (max-width: 620px) {
  .win-rollup-banner { padding: 4px 12px; gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .win-rollup-banner { transition: opacity 0ms, transform 0ms; }
}
`;
}

export function emitWinRollupMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ winRollup: cfg });
  if (!c.enabled) return '';
  /* aria-live polite — assistive tech announces the final amount, but
   * not every rollup tick (avoids screen-reader spam). */
  return `<div class="win-rollup-host" id="winRollupHost">
      <div class="win-rollup-banner" id="winRollupBanner" data-show="false" aria-live="polite" aria-atomic="true">
        <span class="win-rollup-label" id="winRollupLabel">${esc(c.labelText)}</span>
        <span class="win-rollup-amount" id="winRollupAmount" data-count="0">${esc(c.currencyPosition === 'suffix' ? '0.00 ' + c.currency : c.currency + '0.00')}</span>
      </div>
    </div>`;
}

export function emitWinRollupRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ winRollup: cfg });
  if (!c.enabled) {
    return `
  /* ── winRollup BLOCK (disabled) — no-op stubs ────────────────────── */
  window.WIN_ROLLUP_STATE = { enabled: false, active: false, lastAward: 0, suppressed: false };
  window.winRollupShow   = function () {};
  window.winRollupClear  = function () {};
`;
  }
  return `
  /* ── winRollup BLOCK — emitted by src/blocks/winRollup.mjs ────────
     Reference flow (industry baseline statusBarController.rollupWin):
       1. onWinPresentationStart {award, ...} arrives
       2. If award/bet < bigWinTriggerRatio → start rollup
          (else suppress — bigWinTier owns the screen)
       3. Centi-precision linear counter, 30 updates/sec, scaled by
          award magnitude so a 5× bet win counts longer than a 1× win
       4. On reaching target, hold for holdMs (default 0 → display
          persists until next preSpin)
       5. preSpin / onFsTrigger / onBigWinTierEntered clear the display
     Currency formatting mirrors balanceHud._formatMoney exactly. */
  (function () {
    var LABEL_TEXT     = ${JSON.stringify(c.labelText)};
    var BIG_RATIO      = ${c.bigWinTriggerRatio};
    var MIN_DUR        = ${c.minDurationMs};
    var MAX_DUR        = ${c.maxDurationMs};
    var MS_PER_X       = ${c.msPerBetMultiple};
    var HOLD_MS        = ${c.holdMs};
    var CURRENCY       = ${JSON.stringify(c.currency)};
    var CUR_POS        = ${JSON.stringify(c.currencyPosition)};

    var STATE = {
      enabled:    true,
      active:     false,
      lastAward:  0,
      suppressed: false,
      rafId:      null,
      timers:     [],
    };
    if (typeof window !== 'undefined') window.WIN_ROLLUP_STATE = STATE;

    function _host()    { return document.getElementById('winRollupHost'); }
    function _banner()  { return document.getElementById('winRollupBanner'); }
    function _amountEl(){ return document.getElementById('winRollupAmount'); }

    function _currentBet() {
      var b = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
        ? window.__SLOT_BET__ : 1;
      return b;
    }

    function _fmtMoney(v) {
      var n = Number(v);
      if (!Number.isFinite(n) || n < 0) n = 0;
      var s = n.toFixed(2);
      return CUR_POS === 'suffix' ? (s + ' ' + CURRENCY) : (CURRENCY + s);
    }

    function _clearTimers() {
      if (STATE.rafId !== null) {
        try { cancelAnimationFrame(STATE.rafId); } catch (_) {}
        STATE.rafId = null;
      }
      for (var i = 0; i < STATE.timers.length; i++) {
        try { clearTimeout(STATE.timers[i]); } catch (_) {}
      }
      STATE.timers.length = 0;
    }

    function _setText(amount) {
      var el = _amountEl();
      if (!el) return;
      el.textContent = _fmtMoney(amount);
      el.setAttribute('data-count', String(amount));
    }

    function _show(celebrate) {
      var b = _banner();
      if (!b) return;
      b.setAttribute('data-show', 'true');
      if (celebrate) b.classList.add('is-celebrate');
      else           b.classList.remove('is-celebrate');
    }

    function _hide() {
      var b = _banner();
      if (!b) return;
      b.setAttribute('data-show', 'false');
      b.classList.remove('is-celebrate');
    }

    function _computeDuration(award, bet) {
      if (bet <= 0) return MIN_DUR;
      var x = award / bet;
      /* Scaling: 1× bet → MIN_DUR, +MS_PER_X per additional bet multiple.
       * Cap at MAX_DUR so a near-big-win still feels snappy. */
      var d = MIN_DUR + Math.max(0, x - 1) * MS_PER_X;
      if (d < MIN_DUR) d = MIN_DUR;
      if (d > MAX_DUR) d = MAX_DUR;
      return d;
    }

    function winRollupShow(amount) {
      amount = Number(amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      var bet   = _currentBet();
      var ratio = amount / bet;
      /* Suppress in the big-win band — bigWinTier owns that screen. */
      if (ratio >= BIG_RATIO) {
        STATE.suppressed = true;
        _hide();
        return;
      }
      STATE.suppressed = false;

      _clearTimers();
      STATE.active    = true;
      STATE.lastAward = amount;

      var celebrate = ratio >= 1;     /* >= 1× bet → warm celebration tier */
      _show(celebrate);

      var duration = _computeDuration(amount, bet);
      var t0       = performance.now();
      var amtEl    = _amountEl();

      /* Centi-precision linear ramp. We tick at every rAF frame but
       * compute the current value from the precise elapsed time, so a
       * dropped frame doesn't desync the count. */
      function step() {
        if (!STATE.active) return;
        var now = performance.now();
        var p   = Math.min(1, (now - t0) / duration);
        var cur = amount * p;
        /* Quantize to cents so the visible digits change in whole steps
         * (matches the industry slot-machine counter look). */
        cur = Math.round(cur * 100) / 100;
        _setText(cur);
        if (p < 1) {
          STATE.rafId = requestAnimationFrame(step);
        } else {
          STATE.rafId = null;
          _setText(amount);
          /* Display now holds at the climax amount. If holdMs > 0, hide
           * after that window; else stay until preSpin clears. */
          if (HOLD_MS > 0) {
            var tid = setTimeout(function () {
              _hide();
              STATE.active = false;
            }, HOLD_MS);
            STATE.timers.push(tid);
          }
        }
      }
      STATE.rafId = requestAnimationFrame(step);
    }

    function winRollupClear() {
      _clearTimers();
      STATE.active     = false;
      STATE.suppressed = false;
      STATE.lastAward  = 0;
      _hide();
      _setText(0);
    }

    if (typeof window !== 'undefined') {
      window.winRollupShow  = winRollupShow;
      window.winRollupClear = winRollupClear;
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      /* Listen on Start (not End) so the counter feels reactive — the
       * digits begin climbing as soon as the rollup phase begins, the
       * way the reference statusBar.rollupWin behaves. */
      HookBus.on('onWinPresentationStart', function (p) {
        var award = (p && Number.isFinite(p.award)) ? p.award
                  : (typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) ? window.__WIN_AWARD__
                  : 0;
        winRollupShow(award);
      });

      /* Defensive: if the rollup is somehow still mid-ramp when the
       * presentation ends, snap to the final amount so the player
       * never sees a partial value frozen onscreen. */
      HookBus.on('onWinPresentationEnd', function (p) {
        if (!STATE.active || STATE.suppressed) return;
        var award = (p && Number.isFinite(p.award)) ? p.award : STATE.lastAward;
        if (STATE.rafId !== null) {
          try { cancelAnimationFrame(STATE.rafId); } catch (_) {}
          STATE.rafId = null;
        }
        _setText(award);
      });

      /* Boki rule 05.06.2026: "skip treba da skipuje i osnovni counter.
       * Kada se preskoci win linija, treba da se skipuje na rollup end."
       * spinControl emits onSkipRequested{phase:'rollup'} when the player
       * fast-finalizes the win-line cycle — winPresentation cancels the
       * line-by-line walk and we MUST snap the counter to the final
       * amount at the same moment so the two surfaces (highlights + total
       * win counter) settle together. Reference flow: industry rollup
       * controllers snap to target on skip in a single tick. */
      HookBus.on('onSkipRequested', function (p) {
        if (!p || p.phase !== 'rollup') return;
        if (!STATE.active || STATE.suppressed) return;
        if (STATE.rafId !== null) {
          try { cancelAnimationFrame(STATE.rafId); } catch (_) {}
          STATE.rafId = null;
        }
        /* Snap to the latest known target. lastAward was set the moment
         * winRollupShow() started — if no shows happened yet (skip arrived
         * before Start event landed), fall back to window.__WIN_AWARD__ so
         * we still land on the correct number. */
        var target = STATE.lastAward;
        if (!(target > 0) && typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) {
          target = window.__WIN_AWARD__;
        }
        _setText(target);
      });

      /* Big-win override — the moment bigWinTier mounts its banner, we
       * step out of the way (it's the dominant visual). */
      HookBus.on('onBigWinTierEntered', function () {
        STATE.suppressed = true;
        _clearTimers();
        STATE.active = false;
        _hide();
      });

      /* Reset on the NEXT spin so the display starts each round clean. */
      HookBus.on('preSpin', function () {
        winRollupClear();
      });

      /* FS intro takes over the screen — hide. FS end is silent for us;
       * the next preSpin will clean up if needed. */
      HookBus.on('onFsTrigger', function () {
        winRollupClear();
      });
      HookBus.on('onFsEnd', function () {
        winRollupClear();
      });
    }
  })();
`;
}
