/**
 * Slot GDD Factory · dailyJackpot BLOCK
 *
 * Time-gated jackpot pool that contributes from every spin's bet, rolls
 * a per-spin probability check, and on hit awards the live pool snapshot
 * to the player via a centered overlay banner. Resets each UTC day at
 * the configured hour.
 *
 * Industry reference (vendor-neutral):
 *   • Per-spin contribution rate (e.g. 1% of bet) feeds an in-memory
 *     pool — pool starts at minPoolAmount each reset day.
 *   • Pool is clamped to maxPoolAmount; overflow is the operator's
 *     reserve (out of scope for this presenter).
 *   • Trigger probability is a deterministic random roll per spin (no
 *     scatter / paytable interaction) — keeps the math layer simple
 *     and orthogonal to base-game RTP.
 *   • Suppressed during FS / BW / BigWin overlays so two banners never
 *     stack.
 *
 * Lifecycle hooks (LEGO doctrine):
 *   preSpin                → contribute (pool += bet * contribRate)
 *   postSpin               → random-roll; on hit, emit onDailyJackpotAward
 *                            + paint banner, reset pool to minPoolAmount
 *   onFsTrigger            → set suppressed=true (skip rolls during FS)
 *   onFsEnd                → suppressed=false
 *   onBigWinTierEntered    → suppressed=true
 *   onBigWinTierExited     → suppressed=false
 *
 * GDD-driven configuration (consumed from `model.dailyJackpot`):
 *   enabled              boolean (default false — opt-in)
 *   labelText            string  banner label (default "DAILY JACKPOT")
 *   resetUTCHour         number  0..23 (default 0 = midnight UTC)
 *   minPoolAmount        number  pool floor (default 1000)
 *   maxPoolAmount        number  pool ceiling (default 100000)
 *   contribRate          number  per-bet contribution (default 0.01)
 *   triggerProbability   number  per-spin hit chance (default 0.00001)
 *   holdMs               number  banner duration ms (default 5000)
 *
 * Currency:
 *   Inherited from balanceHud per project convention.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                 → frozen safe defaults
 *   resolveConfig(model)            → merge defaults with GDD override
 *   emitDailyJackpotCSS(config)     → CSS string (banner + a11y)
 *   emitDailyJackpotMarkup(config)  → HTML fragment (banner host)
 *   emitDailyJackpotRuntime(config) → runtime JS (state + hooks + public API)
 *
 * HookBus contract:
 *   Emits         : onDailyJackpotAward({ amount, currency, atUtcDay })
 *   Subscribes    : preSpin, postSpin, onFsTrigger, onFsEnd,
 *                   onBigWinTierEntered, onBigWinTierExited
 *
 * Runtime contract:
 *   window.DAILY_JACKPOT_STATE     { enabled, pool, lastResetUtcDay, suppressed }
 *   window.dailyJackpotShow(amt)   programmatic banner kick (QA hook)
 *   window.dailyJackpotForce()     forces next postSpin to award
 *
 * Senior-grade contract:
 *   • Idempotent emit (resolveConfig() with no input → frozen defaults)
 *   • Defensive on input (every numeric clamped, every string length-bounded)
 *   • prefers-reduced-motion collapses banner animation
 *   • ARIA role="status" + aria-live="polite" on banner
 *   • 0 magic numbers in CSS — opacity/blur named constants
 *   • Vendor-neutral
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
  const cfg = defaultConfig();
  const src = (model && model.dailyJackpot) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (isPlainText(src.labelText, 24)) cfg.labelText = src.labelText;
  cfg.resetUTCHour       = clampInt(src.resetUTCHour,       0,        23,       cfg.resetUTCHour);
  cfg.minPoolAmount      = clampNum(src.minPoolAmount,      1,        1e9,      cfg.minPoolAmount);
  cfg.maxPoolAmount      = clampNum(src.maxPoolAmount,      cfg.minPoolAmount, 1e9, cfg.maxPoolAmount);
  cfg.contribRate        = clampNum(src.contribRate,        0,        1,        cfg.contribRate);
  cfg.triggerProbability = clampNum(src.triggerProbability, 0,        1,        cfg.triggerProbability);
  cfg.holdMs             = clampNum(src.holdMs,             500,      30000,    cfg.holdMs);

  /* Currency inherit — same chain as winRollup. */
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

export function emitDailyJackpotCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) return `\n/* dailyJackpot BLOCK (disabled by GDD) — no CSS emitted */\n`;

  /* Named visual constants — strings to preserve byte-identity in
   * emitted CSS (e.g. "0.90" must not collapse to "0.9"). */
  const BANNER_BG_OPACITY        = '0.92'; /* solid backdrop on banner host */
  const BANNER_BORDER_OPACITY    = '0.85'; /* gold accent border alpha */
  const BANNER_GLOW_OPACITY      = '0.40'; /* outer glow alpha */
  const BANNER_FADE_DURATION_MS  = 320;    /* fade-in / fade-out cycle */
  const BANNER_LIFT_PX           = 24;     /* enter-from-below offset */

  return `
/* ── dailyJackpot BLOCK — emitted by src/blocks/dailyJackpot.mjs ──────────
   GDD knobs (baked at build time):
     enabled            = ${c.enabled}
     labelText          = ${c.labelText}
     resetUTCHour       = ${c.resetUTCHour}
     minPoolAmount      = ${c.minPoolAmount}
     maxPoolAmount      = ${c.maxPoolAmount}
     triggerProbability = ${c.triggerProbability}
     holdMs             = ${c.holdMs}
*/
.dailyJackpot-host {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 60;
}
.dailyJackpot-host[data-show="false"] { display: none; }
.dailyJackpot-banner {
  background: rgba(8, 7, 10, ${BANNER_BG_OPACITY});
  border: 2px solid rgba(201, 162, 39, ${BANNER_BORDER_OPACITY});
  box-shadow: 0 0 60px rgba(201, 162, 39, ${BANNER_GLOW_OPACITY});
  padding: 26px 48px;
  border-radius: 16px;
  color: #f6f1d6;
  text-align: center;
  animation: dailyJackpot-enter ${BANNER_FADE_DURATION_MS}ms ease-out;
}
.dailyJackpot-label  { font-size: 14px; letter-spacing: 0.18em; opacity: 0.7; }
.dailyJackpot-amount { font-size: 42px; font-weight: 700; margin-top: 6px; }
@keyframes dailyJackpot-enter {
  from { opacity: 0; transform: translateY(${BANNER_LIFT_PX}px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dailyJackpot-banner { animation: none; }
}
`;
}

function _escape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;',
  }[ch]));
}

export function emitDailyJackpotMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) return '';
  return `
  <div id="dailyJackpotHost" class="dailyJackpot-host" data-show="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="dailyJackpot-banner">
      <div class="dailyJackpot-label">${_escape(c.labelText)}</div>
      <div class="dailyJackpot-amount" id="dailyJackpotAmount" data-amount="0">${_escape(c.currencyPosition === 'prefix' ? c.currency : '')}0${_escape(c.currencyPosition === 'suffix' ? c.currency : '')}</div>
    </div>
  </div>`;
}

export function emitDailyJackpotRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ dailyJackpot: cfg });
  if (!c.enabled) {
    return `
  /* ── dailyJackpot BLOCK (disabled by GDD) ──────────────────────────── */
  const DAILY_JACKPOT_STATE = { enabled: false, pool: 0, lastResetUtcDay: -1, suppressed: false };
  if (typeof window !== 'undefined') window.DAILY_JACKPOT_STATE = DAILY_JACKPOT_STATE;
  if (typeof window !== 'undefined') {
    window.dailyJackpotShow  = function () {};
    window.dailyJackpotForce = function () {};
  }
`;
  }
  return `
  /* ── dailyJackpot BLOCK — emitted by src/blocks/dailyJackpot.mjs ──────
     GDD knobs (baked at build time):
       resetUTCHour       = ${c.resetUTCHour}
       minPoolAmount      = ${c.minPoolAmount}
       maxPoolAmount      = ${c.maxPoolAmount}
       contribRate        = ${c.contribRate}
       triggerProbability = ${c.triggerProbability}
       holdMs             = ${c.holdMs}
  */
  const DJ_CFG = Object.freeze({
    resetUTCHour:       ${c.resetUTCHour},
    minPoolAmount:      ${c.minPoolAmount},
    maxPoolAmount:      ${c.maxPoolAmount},
    contribRate:        ${c.contribRate},
    triggerProbability: ${c.triggerProbability},
    holdMs:             ${c.holdMs},
  });
  const DJ_CURRENCY = ${JSON.stringify(c.currency)};
  const DJ_CURRENCY_POSITION = ${JSON.stringify(c.currencyPosition)};

  const DAILY_JACKPOT_STATE = {
    enabled: true,
    pool: DJ_CFG.minPoolAmount,
    lastResetUtcDay: -1,
    suppressed: false,
  };
  if (typeof window !== 'undefined') window.DAILY_JACKPOT_STATE = DAILY_JACKPOT_STATE;

  let _djForceNext = false;
  let _djHideTimer = null;

  function _djCurrentUtcDay() {
    const now = new Date();
    /* Day index = floor((now − dayShift) / 86400 sec), where dayShift
     * accounts for resetUTCHour so each "day" starts at the configured
     * UTC hour (default midnight). */
    const hourShiftMs = DJ_CFG.resetUTCHour * 3600 * 1000;
    return Math.floor((now.getTime() - hourShiftMs) / 86400000);
  }

  function _djFormatAmount(n) {
    const v = (Math.round(n * 100) / 100).toFixed(2);
    return DJ_CURRENCY_POSITION === 'prefix' ? (DJ_CURRENCY + v) : (v + DJ_CURRENCY);
  }

  function _djShowBanner(amount) {
    const host = document.getElementById('dailyJackpotHost');
    const amt  = document.getElementById('dailyJackpotAmount');
    if (!host || !amt) return;
    amt.textContent = _djFormatAmount(amount);
    amt.setAttribute('data-amount', String(amount));
    host.setAttribute('data-show', 'true');
    if (_djHideTimer) clearTimeout(_djHideTimer);
    _djHideTimer = setTimeout(() => {
      host.setAttribute('data-show', 'false');
      _djHideTimer = null;
    }, DJ_CFG.holdMs);
  }

  function _djAward() {
    const amount = DAILY_JACKPOT_STATE.pool;
    if (typeof HookBus !== 'undefined') {
      try { HookBus.emit('onDailyJackpotAward', { amount, currency: DJ_CURRENCY, atUtcDay: _djCurrentUtcDay() }); } catch (_) {}
    }
    _djShowBanner(amount);
    DAILY_JACKPOT_STATE.pool = DJ_CFG.minPoolAmount;
  }

  function _djResetIfNewDay() {
    const today = _djCurrentUtcDay();
    if (today !== DAILY_JACKPOT_STATE.lastResetUtcDay) {
      DAILY_JACKPOT_STATE.lastResetUtcDay = today;
      DAILY_JACKPOT_STATE.pool = DJ_CFG.minPoolAmount;
    }
  }

  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', (p) => {
      _djResetIfNewDay();
      if (DAILY_JACKPOT_STATE.suppressed) return;
      const bet = (p && Number.isFinite(p.bet)) ? p.bet : 0;
      DAILY_JACKPOT_STATE.pool = Math.min(
        DAILY_JACKPOT_STATE.pool + bet * DJ_CFG.contribRate,
        DJ_CFG.maxPoolAmount
      );
    });
    HookBus.on('postSpin', () => {
      if (DAILY_JACKPOT_STATE.suppressed) return;
      const hit = _djForceNext || (Math.random() < DJ_CFG.triggerProbability);
      _djForceNext = false;
      if (hit) _djAward();
    });
    HookBus.on('onFsTrigger',         () => { DAILY_JACKPOT_STATE.suppressed = true; });
    HookBus.on('onFsEnd',             () => { DAILY_JACKPOT_STATE.suppressed = false; });
    HookBus.on('onBigWinTierEntered', () => { DAILY_JACKPOT_STATE.suppressed = true; });
    HookBus.on('onBigWinTierExited',  () => { DAILY_JACKPOT_STATE.suppressed = false; });
  }

  if (typeof window !== 'undefined') {
    window.dailyJackpotShow  = function (amt) {
      const n = Number(amt);
      if (Number.isFinite(n) && n >= 0) _djShowBanner(n);
    };
    window.dailyJackpotForce = function () { _djForceNext = true; };
  }
`;
}
