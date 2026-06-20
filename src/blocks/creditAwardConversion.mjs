/**
 * src/blocks/creditAwardConversion.mjs
 *
 * Wave D-17.8 (Foundry-family gap closure) — Single-source-of-truth
 * credit → money conversion contract. Centralizes the canonical
 * `coin_value = total_bet / fixedCoinCount` derivation + per-pay-type
 * award-unit modes so every block in the repo reads the same award
 * unit semantics. Prevents the historical drift bug where line wins
 * were paid x coin_value while pattern/scatter awards were paid x
 * total_bet without a single shared rule.
 *
 * @module creditAwardConversion
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind helper API that exposes:
 *     • current coin_value (derived from total_bet / fixedCoinCount)
 *     • a per-pay-type conversion contract (line × coin, scatter ×
 *       total_bet, pattern × total_bet, pot = absolute credits,
 *       holdAndWin = absolute credits)
 *     • a convert(credits, payType) public function downstream blocks
 *       call to render display money values
 *     • body[data-award-unit] attribute hook for CSS-level inspection
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   The "credits as the canonical award unit, money as a derived
 *   display value" model is the certification-standard pattern across
 *   regulated land-based + online RGS deployments. Per the Foundry
 *   §04.5 / §06.1 specification:
 *     "money = credits × coin_value, where coin_value = total_bet / 20.
 *      Line pays = x line_bet (= x 1 coin). Scatter/pattern wins =
 *      x total_bet. Hold-and-Win values = absolute credits, NOT
 *      bet-scaled."
 *   This block is the structural generalization (configurable coin
 *   count, per-pay-type mode whitelist) of that single-rule contract.
 *
 * Math gate
 *   This block does NOT decide award amounts. It NEVER alters payouts.
 *   It ONLY exposes a deterministic conversion function downstream
 *   blocks consume so multiple blocks reading the same credit value
 *   render the same money value. There is no internal RNG, no
 *   weighting, no payout calculation.
 *
 * Public API
 *   export function defaultConfig(): CreditAwardConversionConfig
 *   export function resolveConfig(model?: object): ...
 *   export function emitCreditAwardConversionCSS(cfg): string
 *   export function emitCreditAwardConversionRuntime(cfg): string
 *   export function deriveCoinValue(totalBet, cfg): number       (test)
 *   export function convertCredits(credits, payType, ctx, cfg): number  (test)
 *
 * Lifecycle (when enabled)
 *   • onBetChanged (or boot) → recompute coin_value + emit
 *     onCoinValueChanged → tag body[data-award-unit]
 *   • Any block needing to render a money string calls
 *     window.creditAwardConvert(credits, payType) which returns a
 *     numeric money value rounded to 2 decimals.
 *
 * HookBus events (sole emitter contract)
 *   • onCoinValueChanged   payload: { coinValue, totalBet, fixedCoinCount }
 *   • onAwardConverted     payload: { credits, payType, money }
 *
 * Force chip (per rule_force_buttons_real_spin) — not applicable.
 *   The conversion is deterministic; there is no probabilistic state
 *   to force. The block exposes only a getter for QA inspection.
 *
 * Accessibility
 *   • body[data-award-unit] hook (e.g. data-award-unit="credits") so
 *     downstream presentation blocks can switch display units without
 *     reaching into this block's internals.
 *   • prefers-reduced-motion: not applicable (no animation).
 *
 * Perf budget
 *   • 0 JS per frame. Convert helper is a pure function called on
 *     demand; result is not cached (per-call cost ≈ 1 multiplication
 *     + 1 toFixed/Math.round).
 *
 * Honest scope
 *   This block does NOT enforce that other blocks USE the helper. It
 *   only EXPOSES the canonical contract. Adoption is the responsibility
 *   of downstream blocks; a future LEGO-gate audit can grep for
 *   non-helper conversions and flag drift.
 *
 * GDD knobs (under `model.creditAwardConversion`)
 *   • enabled            bool                    (default false — opt-in)
 *   • fixedCoinCount     int 1..1000             (default 20)
 *   • payTypeModes       Object<payType, mode>   (default per-canonical-rule)
 *   • defaultBet         number                  (default 1.0 — for boot)
 *   • emitOnBoot         bool                    (default true)
 *   • bodyAttrName       string                  (default 'data-award-unit')
 *   • bodyAttrValue      string                  (default 'credits')
 */

const PAY_TYPES = Object.freeze(['line', 'scatter', 'pattern', 'pot', 'holdAndWin', 'feature', 'wheel']);

const PAY_MODES = Object.freeze(['xCoin', 'xTotalBet', 'credits']);

const DEFAULT_PAY_TYPE_MODES = Object.freeze({
  line:       'xCoin',
  scatter:    'xTotalBet',
  pattern:    'xTotalBet',
  pot:        'credits',
  holdAndWin: 'credits',
  feature:    'credits',
  wheel:      'xTotalBet',
});

const DEFAULTS = Object.freeze({
  enabled:         false,
  fixedCoinCount:  20,
  payTypeModes:    DEFAULT_PAY_TYPE_MODES,
  defaultBet:      1.0,
  emitOnBoot:      true,
  bodyAttrName:    'data-award-unit',
  bodyAttrValue:   'credits',
});

const BOUNDS = Object.freeze({
  fixedCoinCount: [1, 1000],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    payTypeModes: { ...DEFAULT_PAY_TYPE_MODES },
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizePayTypeModes(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  let any = false;
  for (const payType of PAY_TYPES) {
    const v = obj[payType];
    if (typeof v !== 'string') continue;
    const lower = v.trim();
    if (!PAY_MODES.includes(lower)) continue;
    out[payType] = lower;
    any = true;
  }
  return any ? out : null;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.creditAwardConversion) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  if ('fixedCoinCount' in src) {
    const v = clampInt(src.fixedCoinCount, BOUNDS.fixedCoinCount[0], BOUNDS.fixedCoinCount[1]);
    if (v !== null) cfg.fixedCoinCount = v;
  }

  if (typeof src.defaultBet === 'number' && isFinite(src.defaultBet) && src.defaultBet > 0) {
    cfg.defaultBet = src.defaultBet;
  }

  const modes = sanitizePayTypeModes(src.payTypeModes);
  if (modes) {
    /* merge partial overrides with defaults */
    cfg.payTypeModes = { ...DEFAULT_PAY_TYPE_MODES, ...modes };
  } else {
    cfg.payTypeModes = { ...DEFAULT_PAY_TYPE_MODES };
  }

  if (typeof src.emitOnBoot === 'boolean') cfg.emitOnBoot = src.emitOnBoot;

  const an = sanitizeStringKnob(src.bodyAttrName, 32);
  if (an !== null) cfg.bodyAttrName = an.replace(/[^a-zA-Z0-9_-]/g, '');

  const av = sanitizeStringKnob(src.bodyAttrValue, 32);
  if (av !== null) cfg.bodyAttrValue = av;

  return cfg;
}

/* ─── Pure helpers (test-exposed) ──────────────────────────────────────── */

/**
 * Derive coin_value from total_bet using the configured fixed coin count.
 * Returns 0 when totalBet is invalid (≤ 0, non-number, non-finite).
 */
export function deriveCoinValue(totalBet, cfg) {
  const c = cfg || defaultConfig();
  if (typeof totalBet !== 'number' || !isFinite(totalBet) || totalBet <= 0) return 0;
  if (!c.fixedCoinCount || c.fixedCoinCount <= 0) return 0;
  return totalBet / c.fixedCoinCount;
}

/**
 * Convert a credits amount to money for the given pay type. Returns 0
 * on invalid inputs (negative credits, unknown payType, etc.).
 *
 * Mode rules:
 *   • xCoin     — money = credits × coin_value
 *                 (1 credit on a 20-line slot at total_bet 1.0 = 0.05)
 *                 NOTE: line "x coin" semantics are handled at evaluator
 *                 level (line pays already x coin); here `credits` is
 *                 the same as `coins` so result is coins × coin_value.
 *   • xTotalBet — money = credits × totalBet
 *                 NOTE: in this mode `credits` is the multiplier (e.g.
 *                 1000 for a 1000x pattern win) so result is `credits ×
 *                 totalBet` not `credits × coin_value`. The pay type
 *                 carries the multiplier, not a credit count.
 *   • credits   — money = credits × coin_value (absolute credit awards
 *                 like pots and H&W; all credits convert via coin_value).
 */
export function convertCredits(credits, payType, ctx, cfg) {
  const c = cfg || defaultConfig();
  if (typeof credits !== 'number' || !isFinite(credits) || credits < 0) return 0;
  if (typeof payType !== 'string') return 0;
  const mode = c.payTypeModes[payType];
  if (!mode) return 0;
  const context = ctx || {};
  const totalBet = (typeof context.totalBet === 'number' && isFinite(context.totalBet) && context.totalBet > 0)
    ? context.totalBet
    : c.defaultBet;
  const coinValue = deriveCoinValue(totalBet, c);
  if (mode === 'xCoin')      return credits * coinValue;
  if (mode === 'credits')    return credits * coinValue;
  if (mode === 'xTotalBet')  return credits * totalBet;
  return 0;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitCreditAwardConversionCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* creditAwardConversion — body data-award-unit hook for downstream blocks */
[data-award-unit] {
  /* Downstream presentation blocks can scope on this attribute to switch
     display unit handling. Example:
       [data-award-unit="credits"] .balance-meter::after { content: " cr"; }
       [data-award-unit="money"]   .balance-meter::after { content: ""; }
  */
  transition: opacity 240ms ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-award-unit] { transition: none; }
}
`;
}

/* ─── Runtime emit ────────────────────────────────────────────────────── */

export function emitCreditAwardConversionRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    fixedCoinCount: c.fixedCoinCount,
    payTypeModes:   c.payTypeModes,
    defaultBet:     c.defaultBet,
    emitOnBoot:     c.emitOnBoot,
    bodyAttrName:   c.bodyAttrName,
    bodyAttrValue:  c.bodyAttrValue,
  });

  return `
/* creditAwardConversion runtime — SSOT credit→money conversion */
(function creditAwardConversionInit() {
  const CFG = ${cfgJSON};

  let currentBet = CFG.defaultBet;
  let currentCoinValue = (CFG.fixedCoinCount > 0) ? (currentBet / CFG.fixedCoinCount) : 0;

  function setBodyAttr() {
    try {
      if (CFG.bodyAttrName) {
        document.body.setAttribute(CFG.bodyAttrName, CFG.bodyAttrValue);
      }
    } catch (_) {}
  }

  function deriveCoinValue(totalBet) {
    if (typeof totalBet !== 'number' || !isFinite(totalBet) || totalBet <= 0) return 0;
    if (!CFG.fixedCoinCount || CFG.fixedCoinCount <= 0) return 0;
    return totalBet / CFG.fixedCoinCount;
  }

  function convertCredits(credits, payType, ctx) {
    if (typeof credits !== 'number' || !isFinite(credits) || credits < 0) return 0;
    if (typeof payType !== 'string') return 0;
    const mode = CFG.payTypeModes[payType];
    if (!mode) return 0;
    const context = ctx || {};
    const tb = (typeof context.totalBet === 'number' && isFinite(context.totalBet) && context.totalBet > 0)
      ? context.totalBet : currentBet;
    const cv = deriveCoinValue(tb);
    let money = 0;
    if (mode === 'xCoin')      money = credits * cv;
    else if (mode === 'credits') money = credits * cv;
    else if (mode === 'xTotalBet') money = credits * tb;
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onAwardConverted', {
          credits: credits, payType: payType, money: money,
        });
      } catch (_) {}
    }
    return money;
  }

  function setBet(totalBet) {
    if (typeof totalBet !== 'number' || !isFinite(totalBet) || totalBet <= 0) return;
    currentBet = totalBet;
    currentCoinValue = deriveCoinValue(totalBet);
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onCoinValueChanged', {
          coinValue:      currentCoinValue,
          totalBet:       currentBet,
          fixedCoinCount: CFG.fixedCoinCount,
        });
      } catch (_) {}
    }
  }

  /* Expose helper API for downstream blocks. */
  if (typeof window !== 'undefined') {
    window.creditAwardConvert    = convertCredits;
    window.creditAwardCoinValue  = function () { return currentCoinValue; };
    window.creditAwardSetBet     = setBet;
    window.creditAwardPayTypeMode = function (payType) {
      return CFG.payTypeModes[payType] || null;
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('onBetChanged', function (payload) {
      const tb = (payload && typeof payload.totalBet === 'number')
        ? payload.totalBet
        : (payload && typeof payload.bet === 'number') ? payload.bet : null;
      if (tb !== null) setBet(tb);
    });
  }

  /* Boot — set body attribute + emit initial onCoinValueChanged */
  function boot() {
    setBodyAttr();
    if (CFG.emitOnBoot) {
      setBet(currentBet);
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }
})();
`;
}
