import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/balanceHud.mjs
 *
 * Wave U8 — Balance HUD block.
 *
 * Industry-standard pattern (every certified slot ships one): a hub-bar
 * widget that shows BALANCE | BET | WIN (and TOTAL WIN during FS) with
 * proper currency formatting. Regulator-mandated for MGA / UKGC / NJ —
 * the player must SEE every currency change.
 *
 * The block OWNS `window.__SLOT_BALANCE__` (single source of truth):
 *   • Initialized from defaultConfig.startingBalance at boot.
 *   • Debited by `bet` on preSpin (base game; FS spins are free).
 *   • Credited by `lastWin` after winPresentation rollup completes.
 *
 * On every balance change emit `onBalanceChanged({ balance, delta,
 * reason: 'spin' | 'win' | 'reset' | 'topup' })`. autoplay.mjs already
 * listens to `window.__SLOT_BALANCE__` for `stopOnBalanceBelow` — same
 * source of truth, deterministic threshold check.
 *
 * Composition contract:
 *   • Reads window.__SLOT_BET__ (Wave U5 betSelector) on preSpin to
 *     compute debit amount. Falls back to defaultConfig.fallbackBet
 *     when betSelector is disabled (~placeholder).
 *   • Reads window.__WIN_AWARD__ (winPresentation) on postSpin to
 *     compute credit amount.
 *   • Honors Wave U6 gambleSecondary: gamble bank changes are routed
 *     through the same balance updates (gamble winnings credit, gamble
 *     loss is the bank value going to zero — that already happened
 *     against an earlier credit, so no debit needed).
 *
 * NO math computation — this block is pure accounting and display.
 *
 * Lifecycle (HookBus contract):
 *   preSpin                → debit bet (base only, FS spins free)
 *   onSpinResult           → snapshot lastWin from window
 *   postSpin               → credit lastWin (base only); emit balance event
 *   onFsEnd                → credit FS totalWin
 *   onGambleEnd (Wave U6)  → credit final bank if winner === 'player'
 *   onBetChanged           → update displayed bet column
 *
 * Bake-time config (resolved from `model.balanceHud`):
 *   { enabled, startingBalance, fallbackBet,
 *     currency, currencyPosition,
 *     showWinColumn, showTotalWinDuringFs,
 *     pulseOnChange,
 *     accentColor, debitColor, creditColor,
 *     ariaLabel }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitBalanceHudCSS(cfg)
 *   emitBalanceHudMarkup(cfg)
 *   emitBalanceHudRuntime(cfg)
 *
 * Runtime contract:
 *   balanceGet() / balanceSet(v, reason?) / balanceCredit(amount, reason?)
 *   balanceDebit(amount, reason?) / balanceReset()
 *   BALANCE_HUD_STATE on window
 *   window.__SLOT_BALANCE__ — single source of truth (number, may be
 *     read by other blocks like autoplay)
 *
 * Runtime dependencies: HookBus, document.
 */

export const BALANCE_REASONS = Object.freeze([
  'init',      /* startingBalance applied at boot */
  'spin',      /* preSpin debit of bet */
  'win',       /* postSpin / onFsEnd credit of win */
  'gamble',    /* onGambleEnd credit of final bank */
  'reset',     /* explicit balanceReset() */
  'topup',     /* dev tools — admin credit */
  'manual',    /* explicit balanceSet() outside the above */
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    /* Starting balance — industry demo-mode default 1000 (one big-win
     * worth of breathing room for a player to explore features). */
    startingBalance: 1000,
    /* Fallback bet used when betSelector is disabled / not loaded yet.
     * The same number the U5 block uses as its industry-default. */
    fallbackBet: 1.00,
    /* Currency symbol or 3–4 char industry code. 1–4 char range is
     * intentional: accepts single-glyph symbols ('€', '¥', '₿') AND
     * ISO/crypto codes ('USD', 'CHF', 'USDT'). Validator at resolveConfig. */
    currency: '€',
    /* "prefix" → "€10.00"; "suffix" → "10.00 €". MGA/UKGC accept both. */
    currencyPosition: 'prefix',
    /* Show last-spin WIN column. Off-toggle for compact mobile layouts
     * where balance + bet take precedence. */
    showWinColumn: true,
    /* During FS, show the accumulated TOTAL WIN instead of last-spin win
     * (industry pattern for free-spin rounds). */
    showTotalWinDuringFs: true,
    /* CSS pulse animation when balance changes — industry-standard
     * visual confirmation. Reduced-motion respected. */
    pulseOnChange: true,
    accentColor: '255,230,168',  /* warm cream, same as statBox__value */
    debitColor:  '255,120,120',  /* soft red for debit pulse */
    creditColor: '120,255,180',  /* soft green for credit pulse */
    ariaLabel: 'Balance HUD',
  });
}

export function resolveConfig(model = {}) {
  const src = model || {};
  const cfg = { ...defaultConfig() };
  const m = src.balanceHud || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (Number.isFinite(m.startingBalance)) {
    /* Negative input clamps to 0 (no negative starting balance is sane);
     * supra-1e9 caps at 1e9 (display layer can't render 10-digit safely). */
    cfg.startingBalance = Math.max(0, Math.min(1e9, Number(m.startingBalance)));
  }
  if (Number.isFinite(m.fallbackBet) && m.fallbackBet > 0) {
    cfg.fallbackBet = Math.max(0.01, Math.min(10000, Number(m.fallbackBet)));
  }

  /* Industry currency codes ('CHF', 'USD') and single-glyph symbols ('€',
   * '¥', '₿') both must be accepted; only over-long blobs ('EUROZONE')
   * and empty strings are rejected. */
  if (typeof m.currency === 'string' && m.currency.length > 0 && m.currency.length <= 4) {
    cfg.currency = m.currency;
  }
  if (m.currencyPosition === 'prefix' || m.currencyPosition === 'suffix') {
    cfg.currencyPosition = m.currencyPosition;
  }

  if (m.showWinColumn != null)         cfg.showWinColumn         = !!m.showWinColumn;
  if (m.showTotalWinDuringFs != null)  cfg.showTotalWinDuringFs  = !!m.showTotalWinDuringFs;
  if (m.pulseOnChange != null)         cfg.pulseOnChange         = !!m.pulseOnChange;

  for (const key of ['accentColor', 'debitColor', 'creditColor']) {
    if (typeof m[key] === 'string') {
      const m3 = m[key].match(/^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})$/);
      if (m3) {
        cfg[key] = [m3[1], m3[2], m3[3]].map(n => Math.max(0, Math.min(255, +n))).join(',');
      }
    }
  }
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }

  /* Auto-disable when GDD explicitly opts out (dev-only / kiosk demo). */
  if (src.features && Array.isArray(src.features)) {
    const explicitlyOff = src.features.some(
      (f) => f && typeof f.kind === 'string' && /^(no[_-]?balance[_-]?hud|balance[_-]?hud[_-]?disabled)$/i.test(f.kind),
    );
    if (explicitlyOff) cfg.enabled = false;
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

const STYLE = {
  GAP_PX: 4,
  COL_PAD: '4px 12px',
  RADIUS_PX: 10,
  BORDER_ALPHA: 0.18,
  BG_TRANSITION_MS: 280,
  LABEL_REM: 0.7,
  LABEL_LS_PX: 1.8,
  VALUE_REM: 0.95,
  VALUE_WEIGHT: 800,
  ZERO_OPACITY: 0.55,
  PULSE_BG_START_A: 0.35,
  PULSE_BG_END_A: 0.12,
  DEBIT_PULSE_MS: 420,
  CREDIT_PULSE_MS: 520,
  MOB_COL_PAD: '3px 6px',
  MOB_GAP_PX: 2,
  MOB_LABEL_LS_PX: 1.4,
  MOB_VALUE_REM: 0.85,
  NARROW_COL_PAD: '2px 3px',
  NARROW_GAP_PX: 1,
  NARROW_LABEL_LS_PX: 0.5,
  NARROW_LABEL_REM: 0.65,
  NARROW_VALUE_REM: 0.78,
};

export function emitBalanceHudCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg;
  return `
  /* ── balanceHud BLOCK — emitted by src/blocks/balanceHud.mjs ─────────
     Hub-bar widget: BALANCE | BET | WIN columns with proper currency.
     Pulse on change (debit red, credit green) for instant visual feedback.
     Uses existing .statBox token from themeCSS for consistent typography. */
  .balance-hud {
    display: flex;
    align-items: center;
    gap: ${STYLE.GAP_PX}px;
    color: rgb(${c.accentColor});
    font-variant-numeric: tabular-nums;
  }
  .balance-hud[hidden] { display: none !important; }
  .balance-hud__col {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${STYLE.COL_PAD};
    border-radius: ${STYLE.RADIUS_PX}px;
    border: 1px solid rgba(201, 162, 39, ${STYLE.BORDER_ALPHA});
    background: linear-gradient(180deg, rgba(30, 25, 20, 0.65), rgba(15, 12, 10, 0.85));
    min-width: 0;
    flex: 1 1 0;
    overflow: hidden;
    transition: background-color ${STYLE.BG_TRANSITION_MS}ms ease-out;
  }
  .balance-hud__label {
    /* Wave UQ — typography floor 11px (Apple HIG min readable). */
    font-size: ${STYLE.LABEL_REM}rem;
    letter-spacing: ${STYLE.LABEL_LS_PX}px;
    text-transform: uppercase;
    color: rgb(${c.accentColor});
    opacity: 0.6;
    line-height: 1;
  }
  .balance-hud__value {
    font-size: ${STYLE.VALUE_REM}rem;
    font-weight: ${STYLE.VALUE_WEIGHT};
    color: rgb(${c.accentColor});
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    margin-top: 2px;
    line-height: 1.1;
  }
  .balance-hud__col--win .balance-hud__value { color: rgb(${c.creditColor}); }
  .balance-hud__col--win .balance-hud__value.is-zero { color: rgb(${c.accentColor}); opacity: ${STYLE.ZERO_OPACITY}; }

  ${c.pulseOnChange ? `
  .balance-hud__col.is-debit-pulse {
    animation: balanceDebitPulse ${STYLE.DEBIT_PULSE_MS}ms ease-out 1;
  }
  .balance-hud__col.is-credit-pulse {
    animation: balanceCreditPulse ${STYLE.CREDIT_PULSE_MS}ms ease-out 1;
  }
  @keyframes balanceDebitPulse {
    0%   { background: linear-gradient(180deg, rgba(${c.debitColor}, ${STYLE.PULSE_BG_START_A}), rgba(${c.debitColor}, ${STYLE.PULSE_BG_END_A})); }
    100% { background: linear-gradient(180deg, rgba(30, 25, 20, 0.65), rgba(15, 12, 10, 0.85)); }
  }
  @keyframes balanceCreditPulse {
    0%   { background: linear-gradient(180deg, rgba(${c.creditColor}, ${STYLE.PULSE_BG_START_A}), rgba(${c.creditColor}, ${STYLE.PULSE_BG_END_A})); }
    100% { background: linear-gradient(180deg, rgba(30, 25, 20, 0.65), rgba(15, 12, 10, 0.85)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .balance-hud__col.is-debit-pulse,
    .balance-hud__col.is-credit-pulse { animation: none; }
  }
  ` : ''}

  @media (max-width: 620px) {
    .balance-hud__col { padding: ${STYLE.MOB_COL_PAD}; min-width: 0; }
    .balance-hud { gap: ${STYLE.MOB_GAP_PX}px; }
    /* Wave UQ — mobile typography floor 11px. */
    .balance-hud__label { font-size: ${STYLE.LABEL_REM}rem; letter-spacing: ${STYLE.MOB_LABEL_LS_PX}px; }
    .balance-hud__value { font-size: ${STYLE.MOB_VALUE_REM}rem; }
  }
  /* 2026-06-09 — extreme-narrow viewport (iPhone SE 320-390px): tighten
     padding + drop letter-spacing so the 3-column HUD never escapes the
     middle hub cell and overlaps the settings/sound icon on the edges. */
  @media (max-width: 420px) {
    .balance-hud__col { padding: ${STYLE.NARROW_COL_PAD}; }
    .balance-hud { gap: ${STYLE.NARROW_GAP_PX}px; }
    .balance-hud__label { font-size: ${STYLE.NARROW_LABEL_REM}rem; letter-spacing: ${STYLE.NARROW_LABEL_LS_PX}px; }
    .balance-hud__value { font-size: ${STYLE.NARROW_VALUE_REM}rem; }
  }
`;
}

export function emitBalanceHudMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg;
  const safeAria = _escape(c.ariaLabel);
  return tagBlockMarkup(`
  <div id="balanceHud" class="balance-hud" role="status" aria-live="polite" aria-label="${safeAria}">
    <div id="balanceHudBalanceCol" class="balance-hud__col balance-hud__col--balance">
      <div class="balance-hud__label">Balance</div>
      <div id="balanceHudBalanceValue" class="balance-hud__value">—</div>
    </div>
    <div id="balanceHudBetCol" class="balance-hud__col balance-hud__col--bet">
      <div class="balance-hud__label">Bet</div>
      <div id="balanceHudBetValue" class="balance-hud__value">—</div>
    </div>${c.showWinColumn ? `
    <div id="balanceHudWinCol" class="balance-hud__col balance-hud__col--win">
      <div id="balanceHudWinLabel" class="balance-hud__label">Win</div>
      <div id="balanceHudWinValue" class="balance-hud__value is-zero">—</div>
    </div>` : ''}
  </div>`, 'balanceHud');
}

export function emitBalanceHudRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── balanceHud BLOCK (disabled) — stub ───────────────────────────── */
  window.balanceGet    = function () { return 0; };
  window.balanceSet    = function () {};
  window.balanceCredit = function () {};
  window.balanceDebit  = function () {};
  window.balanceReset  = function () {};
  window.BALANCE_HUD_STATE = { enabled: false };
  /* Leave window.__SLOT_BALANCE__ undefined when disabled — autoplay
   * stopOnBalanceBelow already treats undefined as "no balance gate". */
`;
  }

  const c = cfg;

  return `
  /* ── balanceHud BLOCK — emitted by src/blocks/balanceHud.mjs ──────────
     Owns: window.__SLOT_BALANCE__ + emit of onBalanceChanged.
     Subscribes:
       preSpin (BASE)   → debit current bet
       postSpin (BASE)  → credit lastWin (window.__WIN_AWARD__)
       onFsEnd          → credit FS totalWin (payload.totalWin)
       onGambleEnd      → credit gamble bank if winner === 'player'
       onBetChanged     → refresh bet column display
     Emits:
       onBalanceChanged ({ balance, delta, reason }) */
  (function () {
    var STARTING_BALANCE = ${c.startingBalance};
    var FALLBACK_BET     = ${c.fallbackBet};
    var CURRENCY         = ${JSON.stringify(c.currency)};
    var CUR_POS          = ${JSON.stringify(c.currencyPosition)};
    var SHOW_WIN         = ${c.showWinColumn};
    var SHOW_TOTAL_FS    = ${c.showTotalWinDuringFs};
    var PULSE            = ${c.pulseOnChange};

    var STATE = {
      enabled: true,
      balance: STARTING_BALANCE,
      lastBet: 0,
      lastWin: 0,
      duringFs: false,
      fsTotalWin: 0,
    };
    if (typeof window !== 'undefined') {
      window.BALANCE_HUD_STATE = STATE;
      window.__SLOT_BALANCE__ = STARTING_BALANCE;
    }

    function _balCol()   { return document.getElementById('balanceHudBalanceCol'); }
    function _balVal()   { return document.getElementById('balanceHudBalanceValue'); }
    function _betCol()   { return document.getElementById('balanceHudBetCol'); }
    function _betVal()   { return document.getElementById('balanceHudBetValue'); }
    function _winCol()   { return document.getElementById('balanceHudWinCol'); }
    function _winLbl()   { return document.getElementById('balanceHudWinLabel'); }
    function _winVal()   { return document.getElementById('balanceHudWinValue'); }

    function _formatMoney(n) {
      if (!Number.isFinite(n)) return CURRENCY + '0.00';
      var v = n.toFixed(2);
      return CUR_POS === 'suffix' ? (v + ' ' + CURRENCY) : (CURRENCY + v);
    }

    function _currentBet() {
      var b = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
        ? window.__SLOT_BET__
        : FALLBACK_BET;
      return Math.max(0.01, Math.min(10000, Number(b)));
    }

    function _refreshBalance(pulseClass) {
      var el = _balVal();
      if (el) el.textContent = _formatMoney(STATE.balance);
      if (!PULSE || !pulseClass) return;
      var col = _balCol();
      if (!col) return;
      col.classList.remove('is-debit-pulse');
      col.classList.remove('is-credit-pulse');
      /* Force reflow so the next class re-triggers the animation. Read
       * a layout property — cheap and reliable across browsers. */
      void col.offsetWidth;
      col.classList.add(pulseClass);
    }

    function _refreshBet() {
      var el = _betVal();
      if (el) el.textContent = _formatMoney(_currentBet());
    }

    function _refreshWin(amount, asTotal) {
      if (!SHOW_WIN) return;
      var lbl = _winLbl();
      var el  = _winVal();
      if (!el) return;
      var n = Number(amount);
      if (!Number.isFinite(n) || n < 0) n = 0;
      if (lbl) lbl.textContent = asTotal ? 'Total Win' : 'Win';
      if (n === 0) { el.textContent = '—'; el.classList.add('is-zero'); }
      else         { el.textContent = _formatMoney(n); el.classList.remove('is-zero'); }
    }

    /* ─── public API ─────────────────────────────────────────────────── */

    function balanceGet() { return STATE.balance; }

    function balanceSet(v, reason) {
      var n = Number(v);
      if (!Number.isFinite(n) || n < 0) return;
      var delta = n - STATE.balance;
      STATE.balance = Math.max(0, Math.min(1e10, n));
      if (typeof window !== 'undefined') window.__SLOT_BALANCE__ = STATE.balance;
      var r = (typeof reason === 'string') ? reason : 'manual';
      _refreshBalance(delta < 0 ? 'is-debit-pulse' : (delta > 0 ? 'is-credit-pulse' : null));
      _emitChanged(delta, r);
    }

    function balanceCredit(amount, reason) {
      var a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) return;
      STATE.balance = Math.max(0, Math.min(1e10, STATE.balance + a));
      if (typeof window !== 'undefined') window.__SLOT_BALANCE__ = STATE.balance;
      _refreshBalance('is-credit-pulse');
      _emitChanged(a, (typeof reason === 'string') ? reason : 'win');
    }

    function balanceDebit(amount, reason) {
      var a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) return;
      STATE.balance = Math.max(0, STATE.balance - a);
      if (typeof window !== 'undefined') window.__SLOT_BALANCE__ = STATE.balance;
      _refreshBalance('is-debit-pulse');
      _emitChanged(-a, (typeof reason === 'string') ? reason : 'spin');
    }

    function balanceReset() {
      var delta = STARTING_BALANCE - STATE.balance;
      STATE.balance = STARTING_BALANCE;
      STATE.lastWin = 0;
      STATE.fsTotalWin = 0;
      if (typeof window !== 'undefined') window.__SLOT_BALANCE__ = STATE.balance;
      _refreshBalance(null);
      _refreshWin(0, false);
      _emitChanged(delta, 'reset');
    }

    function _emitChanged(delta, reason) {
      if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
      try {
        window.HookBus.emit('onBalanceChanged', {
          balance: STATE.balance,
          delta: delta,
          reason: reason,
        });
      } catch (err) {
        /* Defensive — a downstream listener must never strand the
           accounting layer. */
      }
    }

    if (typeof window !== 'undefined') {
      window.balanceGet    = balanceGet;
      window.balanceSet    = balanceSet;
      window.balanceCredit = balanceCredit;
      window.balanceDebit  = balanceDebit;
      window.balanceReset  = balanceReset;
    }

    /* Initial paint after DOM ready. */
    function _initialPaint() {
      _refreshBalance(null);
      _refreshBet();
      _refreshWin(0, false);
      _emitChanged(0, 'init');
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initialPaint, { once: true });
    } else {
      _initialPaint();
    }

    /* HookBus wiring.
     * F3 priority 0 — telemetry class (default). The postSpin listener
     * uses -25 (even later than default telemetry) so __WIN_AWARD__ is
     * already populated by the applyWinHighlight() in the postSpin
     * orchestrator chain. The other handlers stay at default 0. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {

      window.HookBus.on('preSpin', function (p) {
        var inFs = !!(p && p.duringFs);
        STATE.duringFs = inFs;
        if (inFs) return; /* FS spins are free — no debit. */
        var bet = _currentBet();
        STATE.lastBet = bet;
        balanceDebit(bet, 'spin');
        _refreshBet();
        /* Clear the WIN column at the start of each new base spin so the
         * old win doesn't visually linger across the rotation. */
        _refreshWin(0, false);
      });

      /* Bug-fix 2026-06-10: onSpinResult fires BEFORE postSpin handler
       * runs applyWinHighlight() which sets window.__WIN_AWARD__. Reading
       * the value here always gave 0 (cleared by spinControl preSpin),
       * so balanceCredit never added the win. Symptom: Boki saw HUD WIN
       * column stuck at "—" and balance going down by bet on every spin
       * regardless of actual wins. Snapshot lastWin in postSpin INSTEAD
       * (which fires AFTER applyWinHighlight) so __WIN_AWARD__ is fresh. */
      window.HookBus.on('postSpin', function (p) {
        var inFs = !!(p && p.duringFs);
        /* Read fresh __WIN_AWARD__ — set by applyWinHighlight() in the
         * postSpin orchestrator, which already finished before this emit. */
        var w = (typeof window.__WIN_AWARD__ === 'number' && window.__WIN_AWARD__ >= 0
                 && Number.isFinite(window.__WIN_AWARD__))
          ? Math.min(window.__WIN_AWARD__, 1e10)
          : 0;
        STATE.lastWin = w;
        if (!inFs && STATE.lastWin > 0) {
          balanceCredit(STATE.lastWin, 'win');
        }
        /* Refresh the WIN column — during FS, show accumulating total
         * if config asks; otherwise show last-spin win. */
        if (inFs && SHOW_TOTAL_FS) {
          STATE.fsTotalWin += STATE.lastWin;
          _refreshWin(STATE.fsTotalWin, true);
        } else if (!inFs) {
          _refreshWin(STATE.lastWin, false);
        }
      }, { priority: -25 });

      window.HookBus.on('onFsTrigger', function () {
        STATE.fsTotalWin = 0;
      });

      window.HookBus.on('onFsEnd', function (p) {
        /* UQ-DEEP-AP E-3: idempotency token. Auditor E flagged double-credit
           race if onFsEnd is re-emitted by an interrupt-arbiter / hot-reload.
           Token = freeSpins round id from payload, or wall-clock fallback. */
        var fsRoundId = (p && (p.fsRoundId || p.roundId)) || ('autocoin:' + Date.now());
        if (STATE._lastFsCreditedRoundId === fsRoundId) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[balanceHud] onFsEnd double-fire suppressed for round', fsRoundId);
          }
          return;
        }
        STATE._lastFsCreditedRoundId = fsRoundId;
        var totalWin = (p && Number.isFinite(p.totalWin) && p.totalWin >= 0)
          ? Math.min(p.totalWin, 1e10)
          : STATE.fsTotalWin;
        if (totalWin > 0) {
          balanceCredit(totalWin, 'win');
        }
        STATE.duringFs = false;
        STATE.fsTotalWin = 0;
        _refreshWin(totalWin, false);
      });

      window.HookBus.on('onGambleEnd', function (p) {
        if (!p) return;
        if (p.winner === 'player' && Number.isFinite(p.bank) && p.bank > 0) {
          balanceCredit(p.bank, 'gamble');
          _refreshWin(p.bank, false);
        }
      });

      window.HookBus.on('onBetChanged', function () {
        _refreshBet();
      });
    }
  })();
`;
}
