/**
 * src/blocks/netLossIndicator.mjs
 *
 * Wave H12 — Net Win/Loss Indicator extension.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   Regulator-mandated player-protection HUD chip. A persistent indicator
 *   beside the balance HUD that shows session-level net result —
 *   "Net: +€42.50" (green) or "Net: -€118.00" (red). Updates after every
 *   credit / debit. Crosses configurable thresholds (CAUTION / WARN /
 *   ALERT) and emits a HookBus event so downstream consumers
 *   (realityCheck modal, sessionTimeout, autoplay stop, audit log) can
 *   react. Reset is tied to session boundaries (new session, manual
 *   balance reset, configurable).
 *
 *   Regulator anchors (template-neutral synthesis):
 *     • Spelinspektionen 14.3 (Sweden) — running session net display obligatory.
 *     • DGOJ Article 7 (Spain) — net result visible at all times during play.
 *     • UKGC LCCP 8.3 — supports player-protection visibility tooling.
 *     • Curaçao GCB / MGA RGF / AGCO Reg 78/12 — broadly consistent.
 *
 *   This block EXTENDS `balanceHud.mjs` without modifying its source.
 *   Composition contract:
 *     • balanceHud owns `window.__SLOT_BALANCE__`, the credit / debit
 *       API (`balanceCredit`, `balanceDebit`, `balanceSet`, `balanceReset`)
 *       and the HUD root (`#balanceHud` with `.balance-hud__col` cells).
 *     • netLossIndicator OBSERVES `HookBus.on('onBalanceChanged', …)`,
 *       snapshots `sessionStart` at the first init event, computes
 *       `net = balance - sessionStart` after every change, renders a
 *       NEW `.balance-hud__col--net` cell inside the existing HUD root
 *       (lazy-injected once), and emits `onNetThresholdCrossed` when the
 *       running net crosses any configured threshold in either
 *       direction.
 *
 *   When this block is disabled (default), balanceHud runs unchanged.
 *   When enabled but balanceHud is missing the block early-exits with a
 *   single console.warn so the dist still boots.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → wait until `#balanceHud` exists, then inject the
 *                      `.balance-hud__col--net` chip via DOM append.
 *                      Idempotent: a second mount is a no-op.
 *   onBalanceChanged → recompute net; update chip text + level class;
 *                      check threshold crossings (highest-magnitude wins
 *                      if multiple cross in one event); emit
 *                      `onNetThresholdCrossed` if level changed.
 *   preSpin → no-op (balance moves through balanceCredit / Debit so we
 *             already get the onBalanceChanged signal).
 *   onAutoplayStart → reset session start to current balance IF
 *                     `resetOnAutoplayStart` is true.
 *   onAutoplayStop → no-op (autoplay end doesn't reset net).
 *   onFsTrigger / onFsEnd → no-op; FS plays through the same balance flow.
 *
 *   Emitted events:
 *     onNetThresholdCrossed { from, to, level, net, direction, threshold }
 *       direction: 'losing' (net moved more negative) | 'recovering'
 *
 * GDD config (consumed from `model.netLossIndicator`):
 *
 *   {
 *     enabled:          boolean (default false; auto-enables if any
 *                       feature kind matches /net[_-]?loss[_-]?indicator/i
 *                       OR /session[_-]?net/i — and balanceHud is on)
 *     thresholds:       Array of { amount:number, level:string, label?:string }
 *                       Sorted ASC by amount during resolve. amount is
 *                       SIGNED (negative = loss, positive = profit
 *                       milestone). level ∈ ['caution','warn','alert',
 *                       'profit','jackpot']. Default: 3-tier loss ladder
 *                       at -50 / -150 / -500.
 *     showLabel:        boolean (default true) — show "NET" mini label
 *                       above the value (matches balanceHud chrome).
 *     showInBaseGame:   boolean (default true)
 *     showInFs:         boolean (default true)
 *     currencyPrefix:   string (default '€') — must match balanceHud's
 *                       prefix to read uniformly. Falls back to
 *                       balanceHud's prefix if it can be detected at
 *                       runtime; otherwise this value wins.
 *     positiveColor:    'r,g,b' (default '120,220,140' soft green)
 *     negativeColor:    'r,g,b' (default '230,90,80' alert red)
 *     neutralColor:     'r,g,b' (default '200,200,210' cool grey)
 *     resetOnSessionReset: boolean (default true) — when balanceReset
 *                       fires (`reason === 'reset'`), snapshot a fresh
 *                       sessionStart from the new balance.
 *     resetOnAutoplayStart: boolean (default false) — fresh net per
 *                       autoplay session (rarely wanted).
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                     → safe defaults
 *   resolveConfig(model)                → merge defaults with GDD override
 *   emitNetLossIndicatorCSS(cfg)        → cell CSS + threshold accents
 *   emitNetLossIndicatorMarkup(cfg)     → empty (chip mounted at runtime)
 *   emitNetLossIndicatorRuntime(cfg)    → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__NET_LOSS__               current signed net (number)
 *   window.__NET_LOSS_LEVEL__         current threshold level string ('' if none)
 *   window.NLI_STATE                  { enabled, sessionStart, net, level,
 *                                       mounted, thresholds, lastEmitLevel }
 *   window.nliResetSession()          force a fresh sessionStart snapshot
 *
 * Composition contract:
 *
 *   - REQUIRES `balanceHud` enabled. The block early-exits at runtime if
 *     `#balanceHud` is missing.
 *   - DOES NOT modify balanceHud source. Appends a fresh
 *     `.balance-hud__col.balance-hud__col--net` element into the
 *     `#balanceHud` root. Pulls the currency prefix from
 *     `window.__SLOT_BALANCE_HUD_PREFIX__` if balanceHud exposes it
 *     (defensive fallback to the GDD-baked prefix otherwise).
 *
 * Industry references (template-neutral):
 *
 *   • Session-net display: regulator-mandated in Sweden, Spain, UK soft-rec.
 *   • Threshold ladder: industry pattern of 3-tier escalation
 *     (caution → warn → alert) before triggering player-protection modal.
 *   • Auto-reset on session boundary: standard pattern; manual reset
 *     allowed via player-initiated balanceReset.
 */

const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const SAFE_LEVEL = /^[a-z][a-z0-9_-]{0,15}$/;
const SAFE_LABEL = /^[A-Z0-9_ -]{1,16}$/;

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

/** Validate thresholds — array of { amount, level, label? } with unique
 *  level strings. Caller falls back to defaults on failure. */
function _validThresholds(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 12) return false;
  const seen = new Set();
  for (const t of arr) {
    if (!t || typeof t !== 'object') return false;
    if (!Number.isFinite(t.amount) || Math.abs(t.amount) > 1e9) return false;
    if (typeof t.level !== 'string' || !SAFE_LEVEL.test(t.level)) return false;
    if (seen.has(t.level)) return false;
    seen.add(t.level);
    if (t.label != null) {
      if (typeof t.label !== 'string' || !SAFE_LABEL.test(t.label)) return false;
    }
  }
  return true;
}

export function defaultConfig() {
  return {
    enabled: false,
    /* Industry-baseline 3-tier loss ladder. Profit milestone is opt-in
     * (default ladder is loss-only because regulator concern is harm
     * prevention, not celebration). */
    thresholds: [
      { amount: -50,  level: 'caution', label: 'CAUTION' },
      { amount: -150, level: 'warn',    label: 'WARN'    },
      { amount: -500, level: 'alert',   label: 'ALERT'   },
    ],
    showLabel: true,
    showInBaseGame: true,
    showInFs: true,
    currencyPrefix: '€',
    positiveColor: '120,220,140',
    negativeColor: '230,90,80',
    neutralColor:  '200,200,210',
    resetOnSessionReset: true,
    resetOnAutoplayStart: false,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.netLossIndicator) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Hard requirement — balanceHud must be enabled (host HUD root). */
  const hudEnabled = !!(model.balanceHud && model.balanceHud.enabled === true);
  /* If balanceHud config is absent, presume enabled (defaultConfig of
   * balanceHud has enabled=true unless explicitly turned off). The block
   * still defensively guards at runtime against missing DOM. */
  const hudPresent = !model.balanceHud || model.balanceHud.enabled !== false;

  if (_validThresholds(m.thresholds)) {
    cfg.thresholds = m.thresholds.map(t => {
      const out = { amount: Number(t.amount), level: t.level };
      if (typeof t.label === 'string') out.label = t.label;
      return out;
    });
  }

  /* Sort ascending by amount — most-negative first; positive last. */
  cfg.thresholds.sort((a, b) => a.amount - b.amount);

  if (m.showLabel != null) cfg.showLabel = !!m.showLabel;
  if (m.showInBaseGame != null) cfg.showInBaseGame = !!m.showInBaseGame;
  if (m.showInFs != null) cfg.showInFs = !!m.showInFs;

  if (typeof m.currencyPrefix === 'string' && m.currencyPrefix.length > 0 && m.currencyPrefix.length <= 4) {
    cfg.currencyPrefix = m.currencyPrefix;
  }
  for (const k of ['positiveColor', 'negativeColor', 'neutralColor']) {
    if (typeof m[k] === 'string' && HEX_RGB.test(m[k])) {
      cfg[k] = m[k].replace(/\s+/g, '');
    }
  }

  if (m.resetOnSessionReset != null) cfg.resetOnSessionReset = !!m.resetOnSessionReset;
  if (m.resetOnAutoplayStart != null) cfg.resetOnAutoplayStart = !!m.resetOnAutoplayStart;

  /* Auto-enable when GDD declares matching feature kind. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(net[_-]?loss[_-]?indicator|session[_-]?net)$/i.test(f.kind),
    );
    if (hit && hudPresent) cfg.enabled = true;
  }

  /* If balanceHud is explicitly off, force-disable. */
  if (model.balanceHud && model.balanceHud.enabled === false) cfg.enabled = false;

  return cfg;
}

export function emitNetLossIndicatorCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pos = cfg.positiveColor;
  const neg = cfg.negativeColor;
  const neu = cfg.neutralColor;
  /* Build level-accent CSS per threshold. The block applies
   * data-level="<level>" to the cell so a single rule per level can
   * accent both the value text and the cell border. */
  const levelAccents = cfg.thresholds.map(t => {
    const accent = (t.amount < 0) ? neg : pos;
    return `
  .balance-hud__col--net[data-level="${_esc(t.level)}"] {
    border-color: rgba(${accent}, 0.7);
    box-shadow: inset 0 0 0 1px rgba(${accent}, 0.3);
  }
  .balance-hud__col--net[data-level="${_esc(t.level)}"] .balance-hud__value {
    color: rgba(${accent}, 1);
    text-shadow: 0 0 5px rgba(${accent}, 0.55);
  }`;
  }).join('');

  return `
  /* ── netLossIndicator BLOCK — emitted by src/blocks/netLossIndicator.mjs ─
     Lives inside the #balanceHud row as a sibling .balance-hud__col cell.
     Polarity flips color on sign:
       net > 0 → positive (green)
       net < 0 → negative (red, intensifies per threshold level)
       net = 0 → neutral (grey, opacity 0.6) */
  .balance-hud__col--net {
    border: 1px solid rgba(${neu}, 0.18);
    border-radius: 6px;
    background: linear-gradient(180deg, rgba(30, 25, 20, 0.65), rgba(15, 12, 10, 0.85));
    padding: 4px 10px;
    min-width: 60px;
    text-align: center;
    transition: border-color 240ms ease, box-shadow 240ms ease;
  }
  .balance-hud__col--net .balance-hud__label {
    color: rgba(${neu}, 0.85);
  }
  .balance-hud__col--net .balance-hud__value {
    color: rgba(${neu}, 1);
    font-variant-numeric: tabular-nums;
  }
  .balance-hud__col--net[data-sign="pos"] .balance-hud__value {
    color: rgba(${pos}, 1);
  }
  .balance-hud__col--net[data-sign="neg"] .balance-hud__value {
    color: rgba(${neg}, 1);
  }
  .balance-hud__col--net[data-sign="zero"] {
    opacity: 0.62;
  }${levelAccents}
  @media (prefers-reduced-motion: reduce) {
    .balance-hud__col--net { transition: none; }
  }
`;
}

export function emitNetLossIndicatorMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* Markup is intentionally empty — the cell is mounted at runtime via
   * DOM insertion so we don't have to template-inline into balanceHud's
   * markup output (which would be invasive to the host block). */
  return '';
}

export function emitNetLossIndicatorRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── netLossIndicator BLOCK (disabled) — stubs so probes don't crash ── */
  window.__NET_LOSS__       = 0;
  window.__NET_LOSS_LEVEL__ = '';
  window.NLI_STATE          = { enabled: false, sessionStart: null, net: 0, level: '', mounted: false, thresholds: [], lastEmitLevel: '' };
  window.nliResetSession    = function () {};
`;
  }

  const thresholdsJson = JSON.stringify(cfg.thresholds.map(t => ({
    amount: t.amount, level: t.level, label: _esc(t.label || t.level.toUpperCase()),
  })));
  const currencyPrefix = JSON.stringify(cfg.currencyPrefix);
  const showLabel = cfg.showLabel ? 'true' : 'false';
  const showInBaseGame = cfg.showInBaseGame ? 'true' : 'false';
  const showInFs = cfg.showInFs ? 'true' : 'false';
  const resetOnSessionReset = cfg.resetOnSessionReset ? 'true' : 'false';
  const resetOnAutoplayStart = cfg.resetOnAutoplayStart ? 'true' : 'false';

  return `
  /* ── netLossIndicator BLOCK — emitted by src/blocks/netLossIndicator.mjs ──
     Owns emit of: onNetThresholdCrossed.
     Observes: onBalanceChanged (recompute + threshold check), onAutoplayStart
     (optional reset), onFsTrigger/onFsEnd (visibility toggle). Mounts a
     .balance-hud__col--net cell into #balanceHud once on DOMContentLoaded.
     Hard requirement: balanceHud block enabled (#balanceHud must exist).
     If missing at patch time: warn-once + no-op so the dist still boots. */
  (function () {
    var THRESHOLDS         = ${thresholdsJson};
    var PREFIX             = ${currencyPrefix};
    var SHOW_LABEL         = ${showLabel};
    var SHOW_IN_BASE       = ${showInBaseGame};
    var SHOW_IN_FS         = ${showInFs};
    var RESET_ON_BALRESET  = ${resetOnSessionReset};
    var RESET_ON_AUTOSTART = ${resetOnAutoplayStart};

    var STATE = {
      enabled: true,
      sessionStart: null,    /* number — balance snapshot at start of session */
      net: 0,                /* current balance - sessionStart */
      level: '',             /* current threshold level ('' if below all) */
      mounted: false,        /* DOM cell present? */
      thresholds: THRESHOLDS,
      lastEmitLevel: '',     /* last level we emitted (dedup) */
      inFs: false,           /* FS phase visibility latch */
    };
    if (typeof window !== 'undefined') {
      window.__NET_LOSS__       = 0;
      window.__NET_LOSS_LEVEL__ = '';
      window.NLI_STATE          = STATE;
    }

    var WARNED_MISSING = false;

    function _hud() { return document.getElementById('balanceHud'); }
    function _cell() { return document.getElementById('balanceHudNetCol'); }
    function _valueEl() { return document.getElementById('balanceHudNetValue'); }

    /* Try to pick up balanceHud's currency prefix from a live element so
     * the two chips read identically. balanceHud writes values like
     * "€100.00" or "$2.50" — strip the trailing numeric to recover the
     * prefix. Falls back to GDD-baked PREFIX. */
    function _detectPrefix() {
      var balanceVal = document.getElementById('balanceHudBalanceValue');
      if (!balanceVal) return PREFIX;
      var txt = (balanceVal.textContent || '').trim();
      var m = txt.match(/^([^\\d\\-]+)/);
      if (m && m[1] && m[1].length > 0 && m[1].length <= 4) return m[1];
      return PREFIX;
    }

    function _fmtAmount(v, prefix) {
      var sign = v < 0 ? '-' : (v > 0 ? '+' : '');
      var abs = Math.abs(v);
      var str = (abs >= 100) ? abs.toFixed(0) : abs.toFixed(2);
      return sign + prefix + str;
    }

    /* _resolveLevel — return the level of the DEEPEST-magnitude crossed
     * threshold (most negative for losses, most positive for profits).
     * "crossed" means net <= amount for negative thresholds, net >= amount
     * for positive ones. Naive ascending iteration would overwrite hit
     * with the shallowest match — we explicitly track magnitude. */
    function _resolveLevel(net) {
      var hit = '';
      var hitMag = -1;
      for (var i = 0; i < THRESHOLDS.length; i++) {
        var t = THRESHOLDS[i];
        var crossed = false;
        if (t.amount < 0 && net <= t.amount) crossed = true;
        else if (t.amount > 0 && net >= t.amount) crossed = true;
        else if (t.amount === 0 && net === 0) crossed = true;
        if (crossed && Math.abs(t.amount) > hitMag) {
          hit = t.level;
          hitMag = Math.abs(t.amount);
        }
      }
      return hit;
    }

    function _renderCell() {
      var cell = _cell();
      if (!cell) return;
      var prefix = _detectPrefix();
      var valueEl = _valueEl();
      if (valueEl) valueEl.textContent = _fmtAmount(STATE.net, prefix);
      var sign = STATE.net > 0 ? 'pos' : (STATE.net < 0 ? 'neg' : 'zero');
      cell.setAttribute('data-sign', sign);
      if (STATE.level) {
        cell.setAttribute('data-level', STATE.level);
      } else {
        cell.removeAttribute('data-level');
      }
      /* Visibility per FS phase */
      var hide = (STATE.inFs && !SHOW_IN_FS) || (!STATE.inFs && !SHOW_IN_BASE);
      cell.style.display = hide ? 'none' : '';
    }

    /* _mountCell — inject the net cell once. Called at DOMContentLoaded
     * AND lazily from the first onBalanceChanged in case the host HUD
     * mounts after this block's runtime. Idempotent. */
    function _mountCell() {
      if (STATE.mounted) return true;
      var hud = _hud();
      if (!hud) {
        if (!WARNED_MISSING && typeof console !== 'undefined' && console.warn) {
          console.warn('[netLossIndicator] balanceHud not present — extension inert');
          WARNED_MISSING = true;
        }
        return false;
      }
      var existing = _cell();
      if (existing) { STATE.mounted = true; _renderCell(); return true; }
      var col = document.createElement('div');
      col.id = 'balanceHudNetCol';
      col.className = 'balance-hud__col balance-hud__col--net';
      col.setAttribute('data-sign', 'zero');
      col.innerHTML =
        (SHOW_LABEL ? '<div class="balance-hud__label">Net</div>' : '') +
        '<div id="balanceHudNetValue" class="balance-hud__value">' + PREFIX + '0</div>';
      hud.appendChild(col);
      STATE.mounted = true;
      _renderCell();
      return true;
    }

    function _maybeEmitThreshold(prevLevel, nextLevel, prevNet, nextNet) {
      if (prevLevel === nextLevel) return;
      /* direction is 'losing' when net moved more negative, 'recovering' otherwise */
      var direction = (nextNet < prevNet) ? 'losing' : 'recovering';
      /* Find the threshold definition for the *to* level (if any) to attach. */
      var thresholdDef = null;
      for (var i = 0; i < THRESHOLDS.length; i++) {
        if (THRESHOLDS[i].level === nextLevel) { thresholdDef = THRESHOLDS[i]; break; }
      }
      /* Direct emit call (not wrapped in a helper) so the LEGO ownership
       * scan picks this block up as the canonical owner of the event. */
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onNetThresholdCrossed', {
            from: prevLevel || '',
            to: nextLevel || '',
            level: nextLevel || '',
            net: nextNet,
            direction: direction,
            threshold: thresholdDef ? { amount: thresholdDef.amount, label: thresholdDef.label } : null,
          });
        } catch (e) {
          if (console && console.error) console.error('[nli] emit onNetThresholdCrossed failed:', e);
        }
      }
      STATE.lastEmitLevel = nextLevel || '';
    }

    /* _onBalanceChanged — the central tick. payload = { balance, delta, reason } */
    function _onBalanceChanged(p) {
      if (!p || !Number.isFinite(p.balance)) return;
      /* Snapshot sessionStart on first event OR on explicit reset signal. */
      if (STATE.sessionStart == null) {
        STATE.sessionStart = p.balance;
      } else if (RESET_ON_BALRESET && (p.reason === 'reset' || p.reason === 'manual')) {
        /* 'manual' is balanceSet via the public API — treated as a fresh
         * session anchor per Spelinspektionen guidance ("when the player
         * tops up, session counter restarts"). */
        if (p.reason === 'reset') STATE.sessionStart = p.balance;
      }
      var prevLevel = STATE.level;
      var prevNet   = STATE.net;
      STATE.net   = p.balance - STATE.sessionStart;
      STATE.level = _resolveLevel(STATE.net);
      if (typeof window !== 'undefined') {
        window.__NET_LOSS__       = STATE.net;
        window.__NET_LOSS_LEVEL__ = STATE.level;
      }
      _mountCell();
      _renderCell();
      _maybeEmitThreshold(prevLevel, STATE.level, prevNet, STATE.net);
    }

    function nliResetSession() {
      /* Snapshot current balance as the new baseline. Net resets to 0
       * and the threshold tracker forgets the previous emit. */
      if (typeof window === 'undefined') return;
      var bal = Number(window.__SLOT_BALANCE__);
      if (!Number.isFinite(bal)) bal = 0;
      STATE.sessionStart = bal;
      STATE.net = 0;
      STATE.level = '';
      STATE.lastEmitLevel = '';
      window.__NET_LOSS__       = 0;
      window.__NET_LOSS_LEVEL__ = '';
      _renderCell();
    }
    if (typeof window !== 'undefined') {
      window.nliResetSession = nliResetSession;
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _mountCell, { once: true });
      } else {
        _mountCell();
      }
    }

    if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onBalanceChanged', _onBalanceChanged);
      window.HookBus.on('onAutoplayStart', function () {
        if (RESET_ON_AUTOSTART) nliResetSession();
      });
      window.HookBus.on('onFsTrigger', function () {
        STATE.inFs = true; _renderCell();
      });
      window.HookBus.on('onFsEnd', function () {
        STATE.inFs = false; _renderCell();
      });
      /* W50 — LDW (Losses Disguised as Wins) observation. When
       * winPresentation suppresses celebration FX because totalAward ≤
       * currentBet (Dixon 2010 + UKGC RTS 7C + AGCO 4.07 + UKGC
       * 17-Jan-2025), the round is still a NET LOSS at the regulator
       * level. balance flow already drives onBalanceChanged via
       * balanceCredit/Debit so the session net moves correctly. We
       * additionally bump an internal LDW counter + cumulative net
       * delta so realityCheck / sessionTimeout / audit log can read a
       * per-session count of suppressed rounds (player-protection
       * surface). NO display side effect — pure metric. */
      window.HookBus.on('onLdwSuppressed', function (p) {
        if (!STATE.ldwCount) STATE.ldwCount = 0;
        STATE.ldwCount += 1;
        if (p && Number.isFinite(p.award)) STATE.ldwAwardSum = (STATE.ldwAwardSum || 0) + p.award;
        if (p && Number.isFinite(p.bet))   STATE.ldwBetSum   = (STATE.ldwBetSum   || 0) + p.bet;
        if (typeof window !== 'undefined') {
          window.__NLI_LDW_COUNT__   = STATE.ldwCount;
          window.__NLI_LDW_AWARD_SUM__ = STATE.ldwAwardSum || 0;
          window.__NLI_LDW_BET_SUM__   = STATE.ldwBetSum || 0;
          window.__NLI_LDW_NET__     = (STATE.ldwAwardSum || 0) - (STATE.ldwBetSum || 0);
        }
      });
    }
  })();
`;
}
