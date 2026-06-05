/**
 * src/blocks/bigWinTier.mjs
 *
 * Wave H5 — Big-Win Tier Ladder block.
 *
 * Five-tier celebration ladder for any win whose total-award-to-bet ratio
 * exceeds a configurable threshold. Vendor-neutral by design: every tier
 * is addressed by INT (1..5) in the code; the player-facing label,
 * threshold, duration, and color are all GDD-driven. Two games can share
 * the same block while showing entirely different vocabulary
 * ("BIG WIN" / "ZEUS STRIKE" / "DRAGON GOLD" — code never knows).
 *
 * Industry pattern (single-source-of-truth interpretation of the slot-CTA
 * baseline + audit-grade tier classification):
 *
 *   • Win-magnitude tier = deterministic lookup
 *       tier = max { t : thresholds[t-1] <= totalAward / bet }
 *     Result is one of 0 (no big-win), 1, 2, 3, 4, 5.
 *   • Cascade rule: only the HIGHEST tier renders. We do NOT walk
 *     1→2→3→4→5 in sequence. Optional 'passthrough' flag walks lower
 *     tiers briefly (each 'passthroughMs' ms) before settling on the
 *     final tier — purely a dramaturgy preference per GDD.
 *   • Skip integration: `onSkipRequested{phase:'bigWinTier'}` jumps to
 *     the final tier's end-state instantly. spinControl morphs the CTA
 *     to SKIP for the duration so the player can fast-finalize.
 *   • Round emit order (per slot-CTA baseline):
 *       postSpin (winPresentation cycle done)
 *         → onBigWinTierEntered { tier, x, label, durationMs }
 *         → tier banner + particle FX render
 *         → onBigWinTierExited  { tier, reason: 'natural' | 'skipped' }
 *
 * Lifecycle (HookBus contract):
 *
 *   onWinPresentationEnd → look at window.__WIN_AWARD__ / __SLOT_BET__,
 *                          map → tier; if tier >= 1 enter the ladder and
 *                          emit onBigWinTierEntered. If 0, no-op.
 *   onSkipRequested      → if phase === 'bigWinTier', cancel passthrough
 *                          timers, jump to final tier end-state, emit
 *                          onBigWinTierExited{reason:'skipped'}.
 *   preSpin              → flush any pending tier banner so a fresh
 *                          spin doesn't inherit a stale celebration.
 *
 * GDD config (consumed from `model.bigWinTier`):
 *
 *   {
 *     enabled:       boolean (default false; auto-enables if any feature
 *                    kind matches /^big[_-]?win[_-]?tier$/i or 'win_ladder')
 *     thresholds:    [t1, t2, t3, t4, t5]
 *                    Sorted ascending × bet. Default
 *                    [10, 25, 50, 200, 1000] (audit-baseline).
 *     labels:        [s1, s2, s3, s4, s5]
 *                    Display strings per tier. Code never inspects these.
 *                    Default: numeric placeholders ('TIER 1' … 'TIER 5').
 *     durations:     [ms1, ms2, ms3, ms4, ms5]
 *                    Banner lifetime per tier. Default
 *                    [1800, 2400, 3200, 4800, 6400].
 *     colors:        [c1, c2, c3, c4, c5]  rgb triplet strings.
 *                    Default low→high temperature palette.
 *     passthrough:   boolean (default false). If true, tiers below the
 *                    final one render briefly in sequence before settling.
 *     passthroughMs: number (default 280). Per-lower-tier flash duration
 *                    when passthrough is true.
 *     soundBuses:    [key1, key2, key3, key4, key5]
 *                    Opaque keys forwarded to the audio block ADB pickup
 *                    (Wave H17). Default ['low','mid','high','peak','climax'].
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                 → safe defaults
 *   resolveConfig(model)            → merge defaults with GDD override
 *   emitBigWinTierCSS(cfg)          → banner + tier accents + flash overlay
 *   emitBigWinTierMarkup(cfg)       → host node (banner mount point)
 *   emitBigWinTierRuntime(cfg)      → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__BIG_WIN_TIER__              current tier (0=none, 1..5)
 *   window.bigWinTierEnter(tier)         programmatic enter (test hook)
 *   window.bigWinTierExit(reason)        programmatic exit (test hook)
 *   window.BIG_WIN_TIER_STATE            { current, x, label, timers[] }
 *
 *   HookBus events:
 *     onBigWinTierEntered { tier, x, label, durationMs }    (this block owns)
 *     onBigWinTierExited  { tier, reason }                  (this block owns)
 *
 * Composition contract:
 *
 *   - winPresentation publishes window.__WIN_AWARD__ and emits
 *     onWinPresentationEnd. This block listens on End — NOT on postSpin —
 *     so the tier banner appears AFTER the per-line rollup cycle, which
 *     is the slot-CTA-baseline order.
 *   - spinControl listens to onBigWinTierEntered and morphs CTA to
 *     SKIP_BIGWIN. (Wired in spinControl Wave V5 — V5.3 atom.)
 *   - uiToast.mjs (Wave U3) is a SEPARATE block that can co-exist for
 *     non-big-win feature toasts. When bigWinTier is enabled in the same
 *     model, GDD authors should disable uiToast's tier path
 *     ('bigWinThresholdX'/'megaWinThresholdX'/'epicWinThresholdX' left as
 *     defaults still works because uiToast only fires its tier toast
 *     when its OWN thresholds are crossed AND uiToast.enabled). Two
 *     toasts on top of each other are gated by GDD config, not enforced
 *     in code — separate LEGO surfaces are the contract.
 *
 * Industry references (template-neutral):
 *
 *   • Slot-CTA baseline §6 — tier ladder = monotonic threshold table,
 *     highest matching tier wins, lower tiers optional passthrough.
 *   • Win-presentation order §4 — banner emit after rollup cycle, before
 *     CTA reverts to PLAY. Source-of-truth for the
 *     onWinPresentationEnd → onBigWinTierEntered chain.
 *   • Audit-grade win classification §3 — fixed numeric tier IDs (1..5)
 *     plus per-game label override is the regulator-friendly path.
 */

const TIER_COUNT = 5;
const BIG_WIN_TIER_MIN = 1;
const BIG_WIN_TIER_MAX = TIER_COUNT;

/** Frozen tier IDs surface — used by tests + by downstream listeners that
 *  need to clamp/validate. Keeping this exported as a frozen array is the
 *  LEGO discipline equivalent of an enum. */
export const BIG_WIN_TIER_IDS = Object.freeze([1, 2, 3, 4, 5]);

export function defaultConfig() {
  return {
    enabled: false,
    /* Industry-baseline ladder — every game can override.
     * 10× / 25× / 50× / 200× / 1000× — covers low-vol → high-vol slot RTP
     * curves while keeping tier 1 reachable within a single base spin. */
    thresholds:    [10, 25, 50, 200, 1000],
    /* Vendor-neutral placeholder labels — Boki rule 05.06.2026:
     * "bigwintier1-5 da se zna da je big win". The identifier itself
     * IS the placeholder label so reading the code/DOM always tells you
     * exactly which tier is firing. Real games override with their own
     * GDD copy ("BIG WIN", "OLYMPUS WIN", "DRAGON GOLD", whatever). */
    labels:        ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    /* Banner segment length per tier. Counter spends `durations[i]` ms
     * climbing into tier (i+1)'s threshold. Reference GDD §6.4 + §8 —
     * each tier 4000 ms; full 5-tier compound is 20 s walkthrough. */
    durations:     [4000, 4000, 4000, 4000, 4000],
    /* End-state plaque hold after the counter reaches finalX. Banner
     * stays steady at the final tier visual + amount for this long
     * before fading out. Reference GDD §6.4 — 4 s per stage including the climax. */
    endHoldMs:     4000,
    /* Default cool-to-warm palette: yellow → gold → orange → magenta →
     * white-hot. Per-game palette overrides via GDD. */
    colors: [
      '255,210,90',   // tier 1 — warm yellow
      '255,170,60',   // tier 2 — gold
      '255,110,60',   // tier 3 — flame orange
      '230,80,170',   // tier 4 — magenta
      '255,240,200',  // tier 5 — white-hot climax
    ],
    /* Compound walkthrough — when a spin triggers tier N > 1, the banner
     * walks tier 1 → 2 → … → N in sequence with fade-in / count-up /
     * fade-out per tier. Boki rule + Reference GDD §6.4 "each tier
     * compounds". Set `compound: false` to jump straight to the final
     * tier (legacy / minimalist UX). */
    compound:      true,
    fadeMs:        300,            /* fade-in / fade-out per tier transition */
    /* Opaque pickup keys for the audio block. The audio block decides
     * which Howler bus or asset maps to each key — this block does NOT
     * play audio directly (LEGO separation: visual vs audio). */
    soundBuses: ['low', 'mid', 'high', 'peak', 'climax'],
    /* Counter formatting — Boki rule 05.06.2026: "counter ne treba da bude
     * x pa counter, nego samo counter da se broji novac, i na kraju da
     * ostane koliko se osvojilo". Display the absolute money amount with
     * the same currency formatting as balanceHud (single source of truth
     * for currency UX in the slot). Resolved automatically from
     * model.balanceHud.currency / currencyPosition. */
    currency:         '€',
    currencyPosition: 'prefix',   /* 'prefix' → "€1500.00", 'suffix' → "1500.00 €" */
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.bigWinTier) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Threshold array — must be exactly TIER_COUNT, strictly ascending,
   * positive. Reject malformed input silently and fall back to defaults
   * so a broken GDD doesn't crash the build. */
  if (Array.isArray(m.thresholds) && m.thresholds.length === TIER_COUNT) {
    const ts = m.thresholds.map(v => Number(v));
    let ok = ts.every(v => Number.isFinite(v) && v > 0);
    for (let i = 1; ok && i < ts.length; i++) {
      if (ts[i] <= ts[i - 1]) ok = false;
    }
    if (ok) cfg.thresholds = ts;
  }

  if (Array.isArray(m.labels) && m.labels.length === TIER_COUNT) {
    const ls = m.labels.map(v => (typeof v === 'string' && v.length > 0 && v.length <= 32) ? v : null);
    if (ls.every(Boolean)) cfg.labels = ls;
  }

  if (Array.isArray(m.durations) && m.durations.length === TIER_COUNT) {
    const ds = m.durations.map(v => Number(v));
    if (ds.every(v => Number.isFinite(v) && v >= 400 && v <= 20000)) cfg.durations = ds;
  }

  if (Array.isArray(m.colors) && m.colors.length === TIER_COUNT) {
    const re = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
    const cs = m.colors.map(v => (typeof v === 'string' && re.test(v)) ? v.replace(/\s+/g, '') : null);
    if (cs.every(Boolean)) cfg.colors = cs;
  }

  if (m.compound != null) cfg.compound = !!m.compound;
  if (Number.isFinite(m.fadeMs))    cfg.fadeMs    = clampInt(m.fadeMs,    100, 1200);
  if (Number.isFinite(m.endHoldMs)) cfg.endHoldMs = clampInt(m.endHoldMs, 0, 12000);

  if (Array.isArray(m.soundBuses) && m.soundBuses.length === TIER_COUNT) {
    const bs = m.soundBuses.map(v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v)) ? v : null);
    if (bs.every(Boolean)) cfg.soundBuses = bs;
  }

  /* Currency resolution — explicit override on bigWinTier > inherit from
   * balanceHud > defaults. Inheritance keeps both blocks visually unified
   * (Boki UX rule: the banner counter MUST read identically to the win
   * column in the HUD — same symbol, same position). */
  const bh = (model && model.balanceHud) || {};
  if (typeof bh.currency === 'string' && bh.currency.length > 0 && bh.currency.length <= 4) {
    cfg.currency = bh.currency;
  }
  if (bh.currencyPosition === 'prefix' || bh.currencyPosition === 'suffix') {
    cfg.currencyPosition = bh.currencyPosition;
  }
  if (typeof m.currency === 'string' && m.currency.length > 0 && m.currency.length <= 4) {
    cfg.currency = m.currency;
  }
  if (m.currencyPosition === 'prefix' || m.currencyPosition === 'suffix') {
    cfg.currencyPosition = m.currencyPosition;
  }

  /* Auto-enable when GDD declares a feature kind that maps to this block. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' && /^(big[_-]?win[_-]?tier|win[_-]?ladder|big[_-]?win[_-]?ladder)$/i.test(f.kind)
    );
    if (hit) cfg.enabled = true;
  }

  return cfg;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitBigWinTierCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.colors;
  return `
  /* ── bigWinTier BLOCK — emitted by src/blocks/bigWinTier.mjs ─────────
     Banner overlay above the reels. z-index 94 sits just under the
     uiToast layer (95) so a feature toast can still appear on top of a
     tier banner if the GDD wires them together. Pointer-events off so
     clicks pass through to the spinControl CTA underneath. */
  .big-win-tier-host {
    position: fixed;
    inset: 0;
    z-index: 94;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .big-win-tier-banner {
    pointer-events: none;
    background: rgba(0, 0, 0, 0.74);
    border: 3px solid rgba(255, 255, 255, 0.62);
    border-radius: 22px;
    padding: 1.6rem 3.4rem;
    color: #fff;
    font-weight: 900;
    letter-spacing: 0.18em;
    text-align: center;
    text-shadow: 0 0 18px rgba(255, 255, 255, 0.7);
    box-shadow: 0 0 90px rgba(255, 255, 255, 0.5);
    opacity: 0;
    transform: scale(0.65);
    white-space: nowrap;
    /* Smooth tier morph: when data-tier flips during the walkthrough,
     * border-color / glow / font-size tween continuously instead of
     * snapping. Counter never pauses. */
    transition: border-color 600ms ease, box-shadow 600ms ease, color 600ms ease, font-size 600ms ease;
  }
  .big-win-tier-banner .big-win-tier-label {
    display: block;
    transition: opacity 220ms ease;
  }
  .big-win-tier-banner[data-label-swap="true"] .big-win-tier-label { opacity: 0.0; }
  .big-win-tier-banner .big-win-tier-amount {
    display: block;
    font-size: 0.6em;
    font-weight: 800;
    letter-spacing: 0.22em;
    margin-top: 0.5rem;
    opacity: 0.92;
  }
  /* Three banner states drive the fade choreography (Wave H5.4 — Boki spec
   * 05.06.2026 "gladak prelaz bez stajanja"):
   *   data-show="enter" — fade-in + scale-up (FADE_MS)   — ONCE at start
   *   data-show="hold"  — steady on screen during the entire walkthrough,
   *                       counter ticks linearly, tier swaps in place via
   *                       data-tier attribute morph (border/glow/font-size
   *                       transition handles the smooth color escalation)
   *   data-show="exit"  — fade-out + scale-down (FADE_MS) — ONCE at the end,
   *                       after endHoldMs steady at climax amount */
  .big-win-tier-banner[data-show="enter"] { animation: bigWinTierIn  ${cfg.fadeMs}ms cubic-bezier(.4,1.55,.5,1) forwards; }
  .big-win-tier-banner[data-show="hold"]  { opacity: 1; transform: scale(1); }
  .big-win-tier-banner[data-show="exit"]  { animation: bigWinTierOut ${cfg.fadeMs}ms ease-in forwards; }
  .big-win-tier-banner[data-tier="1"] { border-color: rgba(${c[0]},.95); color: rgba(${c[0]},1); box-shadow: 0 0 70px rgba(${c[0]},.55);  font-size: 2.4rem; }
  .big-win-tier-banner[data-tier="2"] { border-color: rgba(${c[1]},.95); color: rgba(${c[1]},1); box-shadow: 0 0 80px rgba(${c[1]},.6);   font-size: 2.7rem; }
  .big-win-tier-banner[data-tier="3"] { border-color: rgba(${c[2]},.95); color: rgba(${c[2]},1); box-shadow: 0 0 90px rgba(${c[2]},.65);  font-size: 3.0rem; }
  .big-win-tier-banner[data-tier="4"] { border-color: rgba(${c[3]},.95); color: rgba(${c[3]},1); box-shadow: 0 0 100px rgba(${c[3]},.7);  font-size: 3.3rem; }
  .big-win-tier-banner[data-tier="5"] { border-color: rgba(${c[4]},.95); color: rgba(${c[4]},1); box-shadow: 0 0 110px rgba(${c[4]},.78); font-size: 3.8rem; }
  @keyframes bigWinTierIn {
    0%   { opacity: 0; transform: scale(0.7); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes bigWinTierOut {
    0%   { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.85); }
  }
  @media (max-width: 620px) {
    .big-win-tier-banner[data-tier="1"] { font-size: 1.7rem; }
    .big-win-tier-banner[data-tier="2"] { font-size: 1.9rem; }
    .big-win-tier-banner[data-tier="3"] { font-size: 2.1rem; }
    .big-win-tier-banner[data-tier="4"] { font-size: 2.3rem; }
    .big-win-tier-banner[data-tier="5"] { font-size: 2.6rem; }
    .big-win-tier-banner { padding: 1rem 1.8rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .big-win-tier-banner[data-show="enter"],
    .big-win-tier-banner[data-show="exit"] { animation: none; opacity: 1; transform: none; }
  }
`;
}

export function emitBigWinTierMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="bigWinTierHost" class="big-win-tier-host" aria-live="polite" aria-atomic="true"></div>`;
}

export function emitBigWinTierRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── bigWinTier BLOCK (disabled) — stubs so probes don't crash ─── */
  window.__BIG_WIN_TIER__       = 0;
  window.bigWinTierEnter        = function () {};
  window.bigWinTierExit         = function () {};
  window.BIG_WIN_TIER_STATE     = { enabled: false, current: 0, x: 0, label: '', timers: [] };
`;
  }

  /* Bake the GDD-resolved arrays as JS literals so the runtime never pays
   * a config-object dereference cost in the hot path. Keep order strict
   * (tier 1 first, tier 5 last) — every downstream computation indexes
   * by `tier - 1`. */
  const thresholds  = JSON.stringify(cfg.thresholds);
  const labels      = JSON.stringify(cfg.labels.map(_escape));
  const durations   = JSON.stringify(cfg.durations);
  const soundBuses  = JSON.stringify(cfg.soundBuses);

  return `
  /* ── bigWinTier BLOCK — emitted by src/blocks/bigWinTier.mjs ─────────
     Owns emit of: onBigWinTierEntered, onBigWinTierExited, onBigWinTierEnd.
     Listens: onWinPresentationEnd, onSkipRequested(phase==='bigWinTier'),
              preSpin (flush stale banner).

     Compound walkthrough (Reference GDD §6.4 "each tier compounds"):
       enter tier 1: fade-in → count 0..T1 → fade-out
       enter tier 2: fade-in → count T1..T2 → fade-out
       ...
       enter tier N: fade-in → count T(N-1)..finalX → HOLD → fade-out
       emit onBigWinTierEnd { tier:N, x:finalX, reason }
     Each per-tier step emits its own onBigWinTierEntered/Exited so audio
     and FX listeners can react per tier. Single onBigWinTierEnd at the
     end closes the sequence. */
  (function () {
    var THRESHOLDS   = ${thresholds};
    var LABELS       = ${labels};
    var DURATIONS    = ${durations};
    var SOUND_BUSES  = ${soundBuses};
    var COMPOUND     = ${cfg.compound};
    var FADE_MS      = ${cfg.fadeMs};
    var END_HOLD_MS  = ${cfg.endHoldMs};
    var CURRENCY     = ${JSON.stringify(cfg.currency)};
    var CUR_POS      = ${JSON.stringify(cfg.currencyPosition)};

    var STATE = {
      enabled: true,
      current: 0,             /* 0 = no tier in flight; 1..5 = active tier */
      finalTier: 0,           /* the highest tier this sequence will reach */
      finalX: 0,              /* the final amount (target of the last count-up) */
      x: 0,                   /* current per-tier start amount (for the running count-up) */
      label: '',
      timers: [],             /* outstanding setTimeout handles (for clean cancel) */
      rafToken: 0,            /* count-up rAF generation token (bump on exit) */
      walkActive: false,      /* true while a compound walkthrough is in flight */
      thresholds: THRESHOLDS,
      labels:     LABELS,
      durations:  DURATIONS,
    };
    if (typeof window !== 'undefined') {
      window.__BIG_WIN_TIER__   = 0;
      window.BIG_WIN_TIER_STATE = STATE;
    }

    function _host()   { return document.getElementById('bigWinTierHost'); }
    function _banner() { return _host() ? _host().querySelector('.big-win-tier-banner') : null; }

    function _clearTimers() {
      for (var i = 0; i < STATE.timers.length; i++) {
        try { clearTimeout(STATE.timers[i]); } catch (_) {}
      }
      STATE.timers.length = 0;
    }

    function _emitEntered(payload) {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onBigWinTierEntered', payload || {}); }
        catch (e) { if (console && console.error) console.error('[bigWinTier] emit Entered failed:', e); }
      }
    }
    function _emitExited(payload) {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onBigWinTierExited', payload || {}); }
        catch (e) { if (console && console.error) console.error('[bigWinTier] emit Exited failed:', e); }
      }
    }
    function _emitEnd(payload) {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onBigWinTierEnd', payload || {}); }
        catch (e) { if (console && console.error) console.error('[bigWinTier] emit End failed:', e); }
      }
    }

    /* tierFromRatio(x) — pure lookup. Returns 0 if no tier matches. */
    function tierFromRatio(x) {
      if (!Number.isFinite(x) || x <= 0) return 0;
      var found = 0;
      for (var i = 0; i < THRESHOLDS.length; i++) {
        if (x >= THRESHOLDS[i]) found = i + 1;
        else break;
      }
      return found;
    }

    /* _swapTier — change the banner's data-tier attribute (CSS handles the
     * smooth color/glow morph) and replace the label text with a brief
     * cross-fade so the swap reads as a transition, not a jump. Counter
     * keeps running uninterrupted. */
    function _swapTier(toTier) {
      var node = _banner();
      if (!node) return;
      node.setAttribute('data-tier', String(toTier));
      var labelEl = node.querySelector('.big-win-tier-label');
      if (!labelEl) return;
      node.setAttribute('data-label-swap', 'true');
      var swap = setTimeout(function () {
        labelEl.textContent = LABELS[toTier - 1];
        node.removeAttribute('data-label-swap');
      }, 220);
      STATE.timers.push(swap);
    }

    /* _fmtMoney — currency-aware display formatter. Boki rule 05.06.2026:
     * "counter ne treba da bude x pa counter, nego samo counter da se
     *  broji novac, i na kraju da ostane koliko se osvojilo a ne x26".
     * Output mirrors balanceHud._formatMoney exactly so the banner reads
     * the same as the win column in the HUD. Always 2 decimals (industry
     * default for fiat money UX — partial credits look wrong). */
    function _fmtMoney(v) {
      var n = Number(v);
      if (!Number.isFinite(n) || n < 0) n = 0;
      var s = n.toFixed(2);
      return CUR_POS === 'suffix' ? (s + ' ' + CURRENCY) : (CURRENCY + s);
    }

    /* _delay — token-aware setTimeout wrapper that resolves a promise
     * so the compound sequencer can await transition gaps without
     * stacking setTimeout chains. */
    function _delay(ms) {
      return new Promise(function (resolve) {
        var t = setTimeout(resolve, ms);
        STATE.timers.push(t);
      });
    }

    function _fadeOutCurrent() {
      var node = _banner();
      if (node) node.setAttribute('data-show', 'exit');
      return _delay(FADE_MS);
    }

    function _cleanupHost() {
      var host = _host();
      if (host) {
        while (host.firstChild) host.removeChild(host.firstChild);
      }
    }

    /* _currentBet — single source for per-spin stake. Defaults to 1 if
     * the slot hasn't published a bet yet (defensive: bigWinTier must
     * never blow up if called before betSelector mounts). */
    function _currentBet() {
      var b = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
        ? window.__SLOT_BET__ : 1;
      return b;
    }

    /* _runCompound — Boki spec 05.06.2026 (Wave H5.5):
     *   • Each tier owns exactly DURATIONS[i] ms of counter time (default 4s).
     *   • Counter runs LINEARLY in ABSOLUTE MONEY 0 → finalAward over
     *     (finalTier × tierMs) ms, same speed throughout. Display is the
     *     currency-formatted amount (€1234.56) — no "×N" ratio anywhere.
     *   • Tier promotions trigger when ratio (current/bet) crosses each
     *     THRESHOLDS[i] — tier ladder is still ratio-driven (vendor-neutral
     *     math), only the player-facing counter is money.
     *   • Single banner mounted once, fade-in only at the start. Tier name +
     *     glow color cross-fade in place when ratio crosses each threshold
     *     ("gladak prelaz bez stajanja"). No per-tier fade-out.
     *   • After the counter reaches finalAward, the banner HOLDS for
     *     endHoldMs (default 4000 ms) at climax visual + final money amount
     *     ("na kraju countera da ostane koliko se osvojilo").
     *   • Then a single fade-out (FADE_MS) closes the sequence, followed by
     *     onBigWinTierEnd emit.
     *   • Per-tier onBigWinTierEntered/Exited still fire so audio (Wave H17)
     *     can route per-tier bus crossfades; emit happens at the crossing
     *     moment, not gated on fade timing.
     * Payload contract change: emitted events still carry x for backward
     * compat with audio/test listeners, but it now represents the ABSOLUTE
     * AWARD amount (not the ratio). The ratio can be derived as x / bet. */
    function _runCompound(finalTier, finalAward) {
      _clearTimers();
      STATE.walkActive = true;
      STATE.finalTier  = finalTier;
      STATE.finalX     = finalAward;

      /* If COMPOUND is off we don't walk through lower tiers — we land on
       * finalTier from the start. Counter still runs over finalTier × dur
       * so total duration stays predictable per GDD intent. */
      var startTier = COMPOUND ? 1 : finalTier;
      STATE.current = startTier;
      STATE.label   = LABELS[startTier - 1];
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = startTier;

      /* Mount banner at startTier with fade-in. Counter starts at 0. */
      _mountBannerAt(startTier);
      _emitEntered({
        tier: startTier, x: finalAward, label: STATE.label,
        durationMs: DURATIONS[startTier - 1], soundBus: SOUND_BUSES[startTier - 1],
        isFinal: (startTier === finalTier),
      });

      /* Total count time = (#tiers walked) × per-tier duration. Linear count
       * over this window means the player sees a steady ramp regardless of
       * which tier is currently highlighted. */
      var tiersWalked = (finalTier - startTier + 1);
      var totalCountMs = 0;
      for (var ti = startTier; ti <= finalTier; ti++) totalCountMs += DURATIONS[ti - 1];

      /* After fade-in completes, start the linear counter. The counter
       * itself triggers tier swaps when current ratio crosses thresholds. */
      var fadeInDone = setTimeout(function () {
        if (!STATE.walkActive) return;
        _countUpLinear(0, finalAward, totalCountMs, startTier, finalTier).then(function () {
          if (!STATE.walkActive) return;
          /* Hold the climax plaque at finalX for endHoldMs (4 s default —
           * "big win end event isto cetiri sekunde"). */
          return _delay(END_HOLD_MS);
        }).then(function () {
          if (!STATE.walkActive) return;
          /* Single closing fade-out for the whole sequence ("da se
           * fejdoutuje plaketa"). */
          return _fadeOutCurrent();
        }).then(function () {
          if (!STATE.walkActive) return;
          _emitExited({ tier: STATE.current, reason: 'natural' });
          _finishSequence('natural');
        });
      }, FADE_MS);
      STATE.timers.push(fadeInDone);
    }

    /* _mountBannerAt — fresh banner mounted at the given tier, fade-in. */
    function _mountBannerAt(tier) {
      var host = _host();
      if (!host) return;
      while (host.firstChild) host.removeChild(host.firstChild);
      var node = document.createElement('div');
      node.className = 'big-win-tier-banner';
      node.setAttribute('data-tier', String(tier));
      node.setAttribute('data-show', 'enter');
      node.innerHTML =
        '<span class="big-win-tier-label">' + LABELS[tier - 1] + '</span>' +
        '<span class="big-win-tier-amount" data-count="0">' + _fmtMoney(0) + '</span>';
      host.appendChild(node);
      var hold = setTimeout(function () {
        if (node && node.parentNode === host) node.setAttribute('data-show', 'hold');
      }, FADE_MS);
      STATE.timers.push(hold);
    }

    /* _countUpLinear — linear ramp from 'fromAward' to 'toAward' over 'dur' ms
     * with NO easing (same speed throughout — Boki rule "non stop da broji
     * istom brzinom"). Display is currency-formatted money. Tier promotion
     * fires when the RATIO (current/bet) crosses each THRESHOLDS[i] — the
     * ladder remains vendor-neutral ratio math, only the player-facing UI
     * is absolute money. */
    function _countUpLinear(fromAward, toAward, dur, startTier, finalTier) {
      return new Promise(function (resolve) {
        var amtEl = _host() && _host().querySelector('.big-win-tier-amount');
        if (!amtEl || !(dur > 0) || !(toAward > fromAward)) {
          if (amtEl) {
            amtEl.textContent = _fmtMoney(toAward);
            amtEl.setAttribute('data-count', String(toAward));
          }
          resolve();
          return;
        }
        var bet = _currentBet();
        var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var rafToken = STATE.rafToken = (STATE.rafToken || 0) + 1;
        var activeTier = startTier;
        function step() {
          if (rafToken !== STATE.rafToken) { resolve(); return; }
          var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          var p = Math.min(1, (now - t0) / dur);
          /* LINEAR — no easing function. Each ms == same delta money. */
          var current = fromAward + (toAward - fromAward) * p;
          amtEl.textContent = _fmtMoney(current);
          amtEl.setAttribute('data-count', String(current));
          /* Tier promotion check — in RATIO space so the ladder math stays
           * vendor-neutral regardless of currency / denomination. Multiple
           * promotions per frame are possible if dur is short / award huge. */
          var currentRatio = current / bet;
          while (activeTier < finalTier && currentRatio >= THRESHOLDS[activeTier - 1]) {
            var fromTier = activeTier;
            activeTier += 1;
            _emitExited({ tier: fromTier, reason: 'natural' });
            STATE.current = activeTier;
            STATE.label   = LABELS[activeTier - 1];
            if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = activeTier;
            _swapTier(activeTier);
            _emitEntered({
              tier: activeTier, x: toAward, label: STATE.label,
              durationMs: DURATIONS[activeTier - 1],
              soundBus: SOUND_BUSES[activeTier - 1],
              isFinal: (activeTier === finalTier),
            });
          }
          if (p < 1) {
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
            else { amtEl.textContent = _fmtMoney(toAward); resolve(); }
          } else {
            amtEl.textContent = _fmtMoney(toAward);
            amtEl.setAttribute('data-count', String(toAward));
            resolve();
          }
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
        else { amtEl.textContent = _fmtMoney(toAward); resolve(); }
      });
    }

    function _finishSequence(reason) {
      var finalTier = STATE.finalTier;
      var finalX    = STATE.finalX;
      _clearTimers();
      STATE.rafToken += 1;
      _cleanupHost();
      STATE.walkActive = false;
      STATE.current    = 0;
      STATE.finalTier  = 0;
      STATE.finalX     = 0;
      STATE.x          = 0;
      STATE.label      = '';
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = 0;
      _emitEnd({
        tier: finalTier, x: finalX,
        reason: (reason === 'skipped' ? 'skipped' : 'natural'),
      });
    }

    /* bigWinTierEnter(tier, award) — public entry. Idempotent: a second
     * call during an active walkthrough is ignored. If the block is
     * COMPOUND, starts a tier-1→tier walkthrough; otherwise jumps to the
     * tier. The 'award' parameter is the ABSOLUTE money amount the player
     * actually won — counter ramps 0 → award in money, and the climax
     * plaque holds at that exact figure (Boki rule 05.06.2026 "na kraju
     * countera da ostane koliko se osvojilo"). When no award is provided
     * (test / programmatic entry), synthesise one that comfortably crosses
     * the requested tier's threshold so the visual ladder still walks. */
    function bigWinTierEnter(tier, award) {
      tier = Math.floor(Number(tier));
      if (!(tier >= ${BIG_WIN_TIER_MIN} && tier <= ${BIG_WIN_TIER_MAX})) return;
      if (STATE.walkActive) return;
      var bet = _currentBet();
      var finalAward = Number.isFinite(award) && award > 0
        ? award
        : THRESHOLDS[tier - 1] * 1.5 * bet;
      _runCompound(tier, finalAward);
    }

    /* bigWinTierExit(reason) — fast-finalize the sequence (Boki spec
     * 05.06.2026: "skip da radi kako treba i kako reference radi to"):
     *   • Snap the existing banner to the final tier + final amount
     *     (in-place — no remount, no re-fade-in, keeps continuity).
     *   • Emit onBigWinTierExited for whatever tier was active.
     *   • Single fade-out (FADE_MS) closes the plaque.
     *   • onBigWinTierEnd emitted with reason='skipped'.
     * Total visible time after click ≈ FADE_MS ms — fast spinner happy. */
    function bigWinTierExit(reason) {
      if (!STATE.walkActive) return;
      var finalTier = STATE.finalTier;
      var finalX    = STATE.finalX;
      var prevTier  = STATE.current || finalTier;
      _clearTimers();
      STATE.rafToken += 1;          /* invalidate any in-flight rAF count-up */
      /* Snap existing banner — DOM mutation, no remount, so the player
       * never sees a flash of empty host between exit and skip-finalize. */
      var node = _banner();
      if (node) {
        node.setAttribute('data-tier', String(finalTier));
        node.setAttribute('data-show', 'hold');
        var labelEl = node.querySelector('.big-win-tier-label');
        var amtEl   = node.querySelector('.big-win-tier-amount');
        if (labelEl) labelEl.textContent = LABELS[finalTier - 1];
        if (amtEl)   { amtEl.textContent = _fmtMoney(finalX); amtEl.setAttribute('data-count', String(finalX)); }
      } else {
        /* Banner never mounted (skip arrived during fade-in window) —
         * mount the climax plaque directly so the player gets a glimpse. */
        var host = _host();
        if (host) {
          var n = document.createElement('div');
          n.className = 'big-win-tier-banner';
          n.setAttribute('data-tier', String(finalTier));
          n.setAttribute('data-show', 'hold');
          n.innerHTML =
            '<span class="big-win-tier-label">' + LABELS[finalTier - 1] + '</span>' +
            '<span class="big-win-tier-amount" data-count="' + finalX + '">' + _fmtMoney(finalX) + '</span>';
          host.appendChild(n);
        }
      }
      STATE.current = finalTier;
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = finalTier;
      _emitExited({ tier: prevTier, reason: 'skipped' });
      /* Short visibility hold of the climax before fading — long enough
       * to register, short enough not to feel like an ignored skip. */
      var SKIP_GLIMPSE_MS = 180;
      var t = setTimeout(function () {
        _fadeOutCurrent().then(function () { _finishSequence('skipped'); });
      }, SKIP_GLIMPSE_MS);
      STATE.timers.push(t);
    }

    if (typeof window !== 'undefined') {
      window.bigWinTierEnter = bigWinTierEnter;
      window.bigWinTierExit  = bigWinTierExit;
    }

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onWinPresentationEnd', function () {
        var award = (typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) ? window.__WIN_AWARD__ : 0;
        var bet   = _currentBet();
        /* Tier classification = ratio space (vendor-neutral math).
         * Counter displays = absolute money (player UX). */
        var tier = tierFromRatio(award / bet);
        if (tier < 1) return;
        _runCompound(tier, award);
      });

      window.HookBus.on('onSkipRequested', function (p) {
        if (!p || p.phase !== 'bigWinTier') return;
        if (!STATE.walkActive) return;
        bigWinTierExit('skipped');
      });

      /* Defensive: a fresh spin must wipe any banner still on screen
       * (rapid play, autoplay, etc). */
      window.HookBus.on('preSpin', function () {
        if (STATE.walkActive) bigWinTierExit('skipped');
      });
    }
  })();
`;
}
