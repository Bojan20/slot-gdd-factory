/**
 * src/blocks/bigWinTier.mjs
 *
 * Wave H5 — Big-Win Tier Ladder block.
 *
 * Five-tier celebration ladder for any win whose total-award-to-bet ratio
 * exceeds a configurable threshold. Vendor-neutral by design: every tier
 * is addressed by INT (1..5) in the code; the player-facing label,
 * threshold, duration, and color are all GDD-driven. Defaults are
 * placeholder identifiers `BIGWINTIER1`..`BIGWINTIER5` (Boki rule
 * 05.06.2026: never `mega`/`epic`/`legendary`/`ultimate` and never any
 * theme/vendor copy from any reference game in the code).
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
 *   window.__BIG_WIN_TIER__                current tier (0=none, 1..5)
 *   window.bigWinTierEnter(tier, award?)   programmatic enter (test hook).
 *                                          When `award` is omitted, a
 *                                          synthesised value of
 *                                          thresholds[tier-1] × 1.5 × bet
 *                                          is used so the visual ladder
 *                                          still walks — this differs
 *                                          from the real money figure, so
 *                                          external integrations meant to
 *                                          drive the counter MUST pass
 *                                          their own `award`.
 *   window.bigWinTierExit(reason)          programmatic exit (test hook)
 *   window.BIG_WIN_TIER_STATE              { current, x, label, timers[] }
 *
 *   HookBus events:
 *     onBigWinTierEntered { tier, x, label, durationMs }    (this block owns)
 *     onBigWinTierExited  { tier, reason }                  (this block owns)
 *
 * Performance budget:
 *
 *   ≤1 rAF callback per frame during the money count-up ramp (single
 *   `_countUpLinear` step loop, no parallel rAFs); ≤1 DOM write per
 *   ResizeObserver burst (coalesced through `_scheduleSync` rAF); at most
 *   (finalTier − 1) outstanding tier-promotion setTimeout handles + one
 *   fade-in handle + one label-swap handle per active tier (cleared on
 *   skip / preSpin via `_clearTimers`); target ≤2 ms main-thread cost per
 *   `_emitEntered` / `_emitExited` emit (pure HookBus dispatch — no DOM
 *   work in the emit path). Aria announcement fires exactly once per
 *   sequence (no per-frame announcer churn).
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

/* Named timing + bounds constants (Boki rule: "0 magic numbers"). The CSS
 * tier-morph transition and the runtime label-swap timer MUST share the
 * same source so tuning fadeMs alone never leaves the morph mis-aligned. */
const LABEL_SWAP_MS        = 220;     /* label cross-fade swap on tier promotion */
const TIER_MORPH_MS        = 600;     /* color/font-size/filter morph between tier classes */
const SKIP_GLIMPSE_MS      = 180;     /* climax visibility window after skip before fade-out */
const RAF_FALLBACK_MS      = 16;      /* setTimeout fallback when requestAnimationFrame missing */
const MIN_TIER_DURATION_MS = 400;     /* per-tier duration lower bound */
const MAX_TIER_DURATION_MS = 20000;   /* per-tier duration upper bound */
const MAX_LABEL_LEN        = 32;      /* GDD label string cap */
const MAX_SHAKE_PX         = 16;      /* W47.S3 — translate amplitude clamp */
const MIN_SHAKE_PERIOD_MS  = 80;      /* W47.S3 — oscillator cycle lower bound */
const MAX_SHAKE_PERIOD_MS  = 600;     /* W47.S3 — oscillator cycle upper bound */
const MAX_CURRENCY_LEN     = 4;       /* currency symbol cap (e.g. "USD ") */

/** Frozen tier IDs surface — used by tests + by downstream listeners that
 *  need to clamp/validate. Keeping this exported as a frozen array is the
 *  LEGO discipline equivalent of an enum. */
export const BIG_WIN_TIER_IDS = Object.freeze([1, 2, 3, 4, 5]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Industry-baseline ladder — every game can override.
     * 10× / 25× / 50× / 200× / 1000× — covers low-vol → high-vol slot RTP
     * curves while keeping tier 1 reachable within a single base spin. */
    thresholds:    [10, 25, 50, 200, 1000],
    /* Vendor-neutral placeholder labels — Boki rule 05.06.2026:
     * "bigwintier1-5 da se zna da je big win". The identifier itself
     * IS the placeholder label so reading the code/DOM always tells you
     * exactly which tier is firing. Real games override per-GDD; this
     * block never ships a non-placeholder default. */
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
    /* W47.S3 (V3 polish) — screen-shake intensity ladder per tier (px
     * amplitude on translate). Default 0 / 0 / 2 / 4 / 6 — tiers 1-2
     * stay calm (warm yellow / gold celebration), tiers 3+ ramp the
     * physicality. Gated below by `shakeMinTier` (default 3) so the
     * "BIGWINTIER1" and "BIGWINTIER2" payouts read as joyful but not
     * disruptive. Each value clamps to [0, 16] in resolveConfig. */
    shakeAmplitudePxPerTier: [0, 0, 2, 4, 6],
    shakeMinTier:            3,
    /* Frame-rate of the shake oscillator (ms per cycle). The oscillator
     * loops while a tier is on screen; cycle short enough to feel
     * intense, long enough to stay 60 fps friendly. */
    shakePeriodMs:           220,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.bigWinTier) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Default OFF (per docstring contract). Auto-enable only when the GDD
   * declares an explicit feature kind that maps to this block. The
   * regulator opt-out path is the explicit { bigWinTier: { enabled: false } }
   * branch above; the explicit { enabled: true } branch is the opt-in. */
  if (m.enabled == null) {
    const features = Array.isArray(model && model.features) ? model.features : [];
    /* Accept "big_win", "big-win", "big_win_tier", "big-win-tier",
     * "big_win_ladder", "big-win-ladder", or plain "win_ladder". */
    const BW_PATTERN = /^(big[_-]?win([_-]?(tier|ladder))?|win[_-]?ladder)$/i;
    const detected = features.some(f => f && typeof f.kind === 'string' && BW_PATTERN.test(f.kind));
    cfg.enabled = detected;
  }

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
    const ls = m.labels.map(v => (typeof v === 'string' && v.length > 0 && v.length <= MAX_LABEL_LEN) ? v : null);
    if (ls.every(Boolean)) cfg.labels = ls;
  }

  if (Array.isArray(m.durations) && m.durations.length === TIER_COUNT) {
    const ds = m.durations.map(v => Number(v));
    if (ds.every(v => Number.isFinite(v) && v >= MIN_TIER_DURATION_MS && v <= MAX_TIER_DURATION_MS)) cfg.durations = ds;
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
  if (typeof bh.currency === 'string' && bh.currency.length > 0 && bh.currency.length <= MAX_CURRENCY_LEN) {
    cfg.currency = bh.currency;
  }
  if (bh.currencyPosition === 'prefix' || bh.currencyPosition === 'suffix') {
    cfg.currencyPosition = bh.currencyPosition;
  }
  if (typeof m.currency === 'string' && m.currency.length > 0 && m.currency.length <= MAX_CURRENCY_LEN) {
    cfg.currency = m.currency;
  }
  if (m.currencyPosition === 'prefix' || m.currencyPosition === 'suffix') {
    cfg.currencyPosition = m.currencyPosition;
  }

  /* W47.S3 (V3 polish) — screen-shake ladder validation. Each amplitude
   * clamps to [0, MAX_SHAKE_PX]; the array MUST be TIER_COUNT long or we
   * keep defaults. shakeMinTier clamps to [1, TIER_COUNT]. shakePeriodMs
   * clamps to [MIN_SHAKE_PERIOD_MS, MAX_SHAKE_PERIOD_MS]. The whole
   * feature can be disabled by passing all zeroes in the amplitude
   * array OR by setting shakeMinTier above TIER_COUNT. */
  if (Array.isArray(m.shakeAmplitudePxPerTier)
      && m.shakeAmplitudePxPerTier.length === TIER_COUNT) {
    const amps = m.shakeAmplitudePxPerTier.map(v => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, MAX_SHAKE_PX);
    });
    cfg.shakeAmplitudePxPerTier = amps;
  }
  if (Number.isFinite(m.shakeMinTier)) {
    cfg.shakeMinTier = clampInt(Math.floor(m.shakeMinTier), 1, TIER_COUNT);
  }
  if (Number.isFinite(m.shakePeriodMs)) {
    const p = Number(m.shakePeriodMs);
    cfg.shakePeriodMs = Math.min(Math.max(p, MIN_SHAKE_PERIOD_MS), MAX_SHAKE_PERIOD_MS);
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
     Banner overlay anchored to the REELS FRAME, not the viewport. Boki rule
     05.06.2026: "big win flow responsive i u skladu sa velicinom ril frames".
     Industry reference pattern: the big-win banner is a layout node sized +
     positioned by the layout system — its bbox tracks the reels container,
     not the page viewport. Bitmap text and FX scale through container
     transforms on every layout resize.

     Our HTML/CSS equivalent: host stays position:fixed (so it lives ABOVE
     frame's overflow:hidden without being clipped), but its left/top/width/
     height are runtime-synced to #frameHost.getBoundingClientRect() via a
     ResizeObserver in the runtime IIFE. CSS custom properties
       --bw-frame-x  --bw-frame-y  --bw-frame-w  --bw-frame-h
     are written every observer tick. Banner font-size, padding, and gap
     then derive from --bw-frame-w via clamp() math — so a 1200-px frame
     and a 420-px frame produce visually proportionate banners with the
     same percentage of the reels area. Viewport fallbacks (100vw/100vh)
     activate before the first observer tick AND on browsers without
     ResizeObserver (graceful degradation, no jank).

     z-index 94 sits just under the uiToast layer (95) so a feature toast
     can still appear on top of a tier banner if the GDD wires them
     together. Pointer-events off so clicks pass through to the spinControl
     CTA underneath. */
  .big-win-tier-host {
    position: fixed;
    left:   var(--bw-frame-x, 0px);
    top:    var(--bw-frame-y, 0px);
    width:  var(--bw-frame-w, 100vw);
    height: var(--bw-frame-h, 100vh);
    z-index: 94;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    /* contain layout so banner size changes never reflow ancestors. */
    contain: layout;
  }
  /* Banner = transparent vertical stack (label on top, counter below) —
   * matches the industry-standard hero-typography bigwin layout. NO box,
   * NO border, NO background, NO outer glow. Just two big text elements
   * with a 3D drop-shadow depth stack so they read crisp against any
   * reels art showing through. Boki rule 05.06.2026: "nadji counter u
   * referentnoj igri i ubaci ga na istom mestu kao sto je tamo u igri". */
  .big-win-tier-banner {
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Gap, padding scale with frame width so the banner keeps the same
     * visual proportion regardless of cabinet size (Boki rule 05.06.2026
     * "u skladu sa velicinom ril frames"). The clamp() floors guarantee
     * legibility on the smallest portrait phone; the ceilings prevent
     * gigantism on ultra-wide desktops. */
    gap: clamp(8px, calc(var(--bw-frame-w, 100vw) * 0.018), 24px);
    padding:
      clamp(16px, calc(var(--bw-frame-w, 100vw) * 0.04), 60px)
      clamp(20px, calc(var(--bw-frame-w, 100vw) * 0.06), 80px);
    color: #fff;
    font-weight: 900;
    letter-spacing: 0.18em;
    text-align: center;
    opacity: 0;
    transform: scale(0.65);
    white-space: nowrap;
    /* Cap banner footprint inside the frame so it never bleeds outside
     * the reels area on tall portrait viewports — same containment the
     * industry reference layout system gets for free via fixed pixel
     * width on its big-win node. */
    max-width: 96%;
    max-height: 96%;
    /* Smooth tier morph: when data-tier flips during the walkthrough,
     * font-size + filter glow + color tween continuously. Counter never
     * pauses. Timing is hoisted (TIER_MORPH_MS) so the runtime label-swap
     * timer (LABEL_SWAP_MS) stays in lockstep with the CSS morph. */
    transition: color ${TIER_MORPH_MS}ms ease, font-size ${TIER_MORPH_MS}ms ease, filter ${TIER_MORPH_MS}ms ease;
  }
  .big-win-tier-banner .big-win-tier-label {
    display: block;
    line-height: 1;
    transition: opacity ${LABEL_SWAP_MS}ms ease;
  }
  .big-win-tier-banner[data-label-swap="true"] .big-win-tier-label { opacity: 0.0; }
  /* Skip-snap mode (Boki 05.06.2026: "Skip treba da u big winu ode na
   * kraju big wina, a ne da presence jedan po jedan tier"). The
   * walkthrough transitions (600 ms color/font-size/filter morph between
   * tier classes) make a tier-2 → tier-5 jump LOOK like a sweep through
   * tier-3 and tier-4 during the transition window. data-skip="true"
   * collapses all transitions so the climax tier snaps instantly. */
  .big-win-tier-banner[data-skip="true"] {
    transition: none;
  }
  .big-win-tier-banner[data-skip="true"] .big-win-tier-label {
    transition: none;
  }
  .big-win-tier-banner .big-win-tier-amount {
    display: block;
    /* Counter is 1.07× the label (industry-standard hero-typography
     * proportion: value reads ~7% bigger than label). */
    font-size: 1.07em;
    font-weight: 900;
    letter-spacing: 0.05em;
    line-height: 1;
    opacity: 1;
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
  /* Tier visuals — per-tier accent color drives BOTH text fill and the
   * 3D drop-shadow stack. Font-size escalates with frame-width (NOT
   * viewport-width) so the banner is sized to the reels frame the way
   * the industry reference layout system sizes its big-win node to the
   * reels container. The percentage stops 7.5% → 11.5% × frame-w produce
   * tier-1 ≈ 60-90 px and tier-5 ≈ 92-140 px on a reference 800-1200 px
   * frame — matches the reels-area-relative hero typography. clamp() floors keep tier-1 ≥ 40 px on a 360 px
   * portrait phone (legibility floor); ceilings cap tier-5 at 140 px
   * on a 4K ultrawide so the banner never dominates the cabinet.
   * The drop-shadow ladder produces a chunky 3D extrusion (industry-
   * standard hero-typography filter stack — vendor-neutral colors from
   * cfg.colors). */
  .big-win-tier-banner[data-tier="1"] {
    color: rgba(${c[0]},1);
    font-size: clamp(40px, calc(var(--bw-frame-w, 100vw) * 0.075), 90px);
    filter:
      drop-shadow(0 2px 0 rgba(0,0,0,.55))
      drop-shadow(0 4px 0 rgba(0,0,0,.45))
      drop-shadow(0 8px 14px rgba(${c[0]},.55));
  }
  .big-win-tier-banner[data-tier="2"] {
    color: rgba(${c[1]},1);
    font-size: clamp(46px, calc(var(--bw-frame-w, 100vw) * 0.085), 102px);
    filter:
      drop-shadow(0 2px 0 rgba(0,0,0,.6))
      drop-shadow(0 4px 0 rgba(0,0,0,.5))
      drop-shadow(0 10px 18px rgba(${c[1]},.6));
  }
  .big-win-tier-banner[data-tier="3"] {
    color: rgba(${c[2]},1);
    font-size: clamp(52px, calc(var(--bw-frame-w, 100vw) * 0.095), 114px);
    filter:
      drop-shadow(0 3px 0 rgba(0,0,0,.65))
      drop-shadow(0 5px 0 rgba(0,0,0,.55))
      drop-shadow(0 12px 22px rgba(${c[2]},.65));
  }
  .big-win-tier-banner[data-tier="4"] {
    color: rgba(${c[3]},1);
    font-size: clamp(58px, calc(var(--bw-frame-w, 100vw) * 0.105), 126px);
    filter:
      drop-shadow(0 3px 0 rgba(0,0,0,.7))
      drop-shadow(0 6px 0 rgba(0,0,0,.6))
      drop-shadow(0 14px 26px rgba(${c[3]},.7));
  }
  .big-win-tier-banner[data-tier="5"] {
    color: rgba(${c[4]},1);
    font-size: clamp(64px, calc(var(--bw-frame-w, 100vw) * 0.115), 140px);
    filter:
      drop-shadow(0 4px 0 rgba(0,0,0,.75))
      drop-shadow(0 7px 0 rgba(0,0,0,.65))
      drop-shadow(0 16px 30px rgba(${c[4]},.78));
  }
  @keyframes bigWinTierIn {
    0%   { opacity: 0; transform: scale(0.7); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes bigWinTierOut {
    0%   { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.85); }
  }
  /* W47.S3 (V3 polish) — screen-shake oscillator. Three keyframes (low,
   * mid, hi) staged so a per-tier CSS variable --bw-shake-amp drives
   * the amplitude without forcing distinct keyframe sets per tier. The
   * oscillator translates the WHOLE banner — not the counter alone — so
   * the visual force tracks the celebration tier without breaking the
   * count-up readability. Each cycle is symmetric round-trip so the
   * resting state of the banner is preserved between cycles. */
  @keyframes bigWinTierShake {
    0%, 100% { transform: scale(1) translate(0, 0); }
    25%      { transform: scale(1) translate(calc(var(--bw-shake-amp) * 1px),
                                              calc(var(--bw-shake-amp) * -0.5px)); }
    50%      { transform: scale(1) translate(0, calc(var(--bw-shake-amp) * 0.7px)); }
    75%      { transform: scale(1) translate(calc(var(--bw-shake-amp) * -1px),
                                              calc(var(--bw-shake-amp) * -0.4px)); }
  }
  .big-win-tier-banner.is-shaking {
    animation: bigWinTierShake var(--bw-shake-period, 220ms) ease-in-out infinite;
  }
  /* No viewport-width media query — gap/padding/font-size all derive
   * from --bw-frame-w via clamp(), so the small-screen reduction is
   * already automatic (a 360 px portrait phone gets the floor; a 1440 px
   * desktop gets the ceiling). Removing the manual @media keeps the
   * source of truth single: the reels-frame bbox. */
  @media (prefers-reduced-motion: reduce) {
    .big-win-tier-banner[data-show="enter"],
    .big-win-tier-banner[data-show="exit"] { animation: none; opacity: 1; transform: none; }
    /* W47.S3 — explicit shake kill under reduced-motion. The runtime
     * also reads matchMedia() and skips the .is-shaking class toggle,
     * but the CSS-side hard-stop is the seatbelt: if any code path
     * ever reaches the toggle, the animation still does nothing. */
    .big-win-tier-banner.is-shaking { animation: none; transform: none; }
    /* W48.V3 polish — tier stepper dots stop pulsing under reduced-motion. */
    .big-win-tier-stepper .big-win-tier-step,
    .big-win-tier-stepper .big-win-tier-step.is-active { animation: none; transform: none; }
  }

  /* W48.V3 polish — five-step tier ladder. Pure CSS-driven from the
   * banner's data-tier attribute: dots 1..N (where N == current tier)
   * light up; dots N+1..5 stay dim. During passthrough mode (where the
   * banner walks 1→2→...→finalTier), the dot fill order matches the
   * tier walk because data-tier updates at each step. Dots scale per
   * frame size — tiny on portrait phone, prominent on desktop. */
  .big-win-tier-stepper {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: clamp(6px, calc(var(--bw-frame-w, 100vw) * 0.012), 14px);
    margin-top: clamp(4px, calc(var(--bw-frame-w, 100vw) * 0.008), 10px);
    margin-bottom: clamp(2px, calc(var(--bw-frame-w, 100vw) * 0.004), 6px);
  }
  .big-win-tier-stepper .big-win-tier-step {
    width:  clamp(8px, calc(var(--bw-frame-w, 100vw) * 0.014), 16px);
    height: clamp(8px, calc(var(--bw-frame-w, 100vw) * 0.014), 16px);
    border-radius: 50%;
    background: rgba(255,255,255,0.22);
    border: 1.5px solid rgba(255,255,255,0.38);
    transition: background ${TIER_MORPH_MS}ms ease, transform ${TIER_MORPH_MS}ms ease,
                box-shadow ${TIER_MORPH_MS}ms ease, border-color ${TIER_MORPH_MS}ms ease;
  }
  /* Active dots take the current tier's color from the banner palette.
   * The CSS keyword currentColor inherits from the banner — keeps the
   * stepper visually in sync with the morphing banner color during the
   * walkthrough. */
  .big-win-tier-stepper .big-win-tier-step.is-active {
    background: currentColor;
    border-color: currentColor;
    transform: scale(1.18);
    box-shadow: 0 0 8px currentColor;
  }
  /* CSS-only fill: which dots are active depends on banner data-tier.
   * Selectors pre-target each combination so no JS toggling is needed —
   * stepper repaints instantly when banner data-tier flips. */
  .big-win-tier-banner[data-tier="1"] .big-win-tier-stepper .big-win-tier-step[data-step="1"],
  .big-win-tier-banner[data-tier="2"] .big-win-tier-stepper .big-win-tier-step[data-step="1"],
  .big-win-tier-banner[data-tier="2"] .big-win-tier-stepper .big-win-tier-step[data-step="2"],
  .big-win-tier-banner[data-tier="3"] .big-win-tier-stepper .big-win-tier-step[data-step="1"],
  .big-win-tier-banner[data-tier="3"] .big-win-tier-stepper .big-win-tier-step[data-step="2"],
  .big-win-tier-banner[data-tier="3"] .big-win-tier-stepper .big-win-tier-step[data-step="3"],
  .big-win-tier-banner[data-tier="4"] .big-win-tier-stepper .big-win-tier-step[data-step="1"],
  .big-win-tier-banner[data-tier="4"] .big-win-tier-stepper .big-win-tier-step[data-step="2"],
  .big-win-tier-banner[data-tier="4"] .big-win-tier-stepper .big-win-tier-step[data-step="3"],
  .big-win-tier-banner[data-tier="4"] .big-win-tier-stepper .big-win-tier-step[data-step="4"],
  .big-win-tier-banner[data-tier="5"] .big-win-tier-stepper .big-win-tier-step[data-step="1"],
  .big-win-tier-banner[data-tier="5"] .big-win-tier-stepper .big-win-tier-step[data-step="2"],
  .big-win-tier-banner[data-tier="5"] .big-win-tier-stepper .big-win-tier-step[data-step="3"],
  .big-win-tier-banner[data-tier="5"] .big-win-tier-stepper .big-win-tier-step[data-step="4"],
  .big-win-tier-banner[data-tier="5"] .big-win-tier-stepper .big-win-tier-step[data-step="5"] {
    background: currentColor;
    border-color: currentColor;
    transform: scale(1.18);
    box-shadow: 0 0 8px currentColor;
  }
  /* Screen-reader-only live region. Hosts the single end-of-sequence
   * announcement of the final money amount — the rAF-driven counter
   * itself is aria-hidden so SR queues never spam thousands of frames. */
  .big-win-tier-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
`;
}

export function emitBigWinTierMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* aria-live is NOT on the host (which contains the rAF-driven counter —
   * announcing every frame would either spam or get dropped). It is on the
   * dedicated screen-reader-only #bigWinTierAnnounce node, which receives
   * exactly one update per sequence (the final money amount, after the
   * endHoldMs steady-state). The visible label gets its own aria-live so
   * the ~5 tier-name swaps reach the player; the visible amount carries
   * aria-hidden because the SR-only announce node speaks for it. */
  return `<div id="bigWinTierHost" class="big-win-tier-host"><div id="bigWinTierAnnounce" class="big-win-tier-sr" role="status" aria-live="polite" aria-atomic="true"></div></div>`;
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
    var COMPOUND        = ${cfg.compound};
    var FADE_MS         = ${cfg.fadeMs};
    var END_HOLD_MS     = ${cfg.endHoldMs};
    var LABEL_SWAP_MS   = ${LABEL_SWAP_MS};
    var SKIP_GLIMPSE_MS = ${SKIP_GLIMPSE_MS};
    var RAF_FALLBACK_MS = ${RAF_FALLBACK_MS};
    var CURRENCY        = ${JSON.stringify(cfg.currency)};
    var CUR_POS         = ${JSON.stringify(cfg.currencyPosition)};
    /* W47.S3 — per-tier screen-shake amplitude + oscillator period.
     * Read by _applyShake() to drive the CSS custom properties. */
    var SHAKE_AMP       = ${JSON.stringify(cfg.shakeAmplitudePxPerTier)};
    var SHAKE_PERIOD_MS = ${cfg.shakePeriodMs};

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

    /* _announce — single end-of-sequence SR push. The visible counter
     * mutates every rAF; we keep that aria-hidden and route ONE update
     * to the dedicated polite live region after endHoldMs so SR users
     * hear the final money amount once, not the ramp. */
    function _announce(text) {
      var ann = document.getElementById('bigWinTierAnnounce');
      if (ann) ann.textContent = text;
    }

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
     * keeps running uninterrupted.
     *
     * W47.S3 (V3 polish) — also toggles the per-tier screen-shake class.
     * The shake amplitude rides as a CSS custom property so a single
     * @keyframes set scales without per-tier keyframes (see
     * emitBigWinTierCSS). Hard gates:
     *   1. prefers-reduced-motion → no class, no property set, no work.
     *   2. amplitude === 0        → no class (tier 1-2 by default stay calm).
     *   3. tier < shakeMinTier    → no class (caller-tunable gate).
     */
    function _swapTier(toTier) {
      var node = _banner();
      if (!node) return;
      node.setAttribute('data-tier', String(toTier));
      _applyShake(node, toTier);
      /* W48.V3 polish — keep the stepper progressbar aria-valuenow in
       * sync with the visible state so SR users hear "n of 5" updates
       * exactly when the visual climbs. CSS already handles dot fill. */
      var stepper = node.querySelector('.big-win-tier-stepper');
      if (stepper) stepper.setAttribute('aria-valuenow', String(toTier));
      var labelEl = node.querySelector('.big-win-tier-label');
      if (!labelEl) return;
      node.setAttribute('data-label-swap', 'true');
      var swap = setTimeout(function () {
        labelEl.textContent = LABELS[toTier - 1];
        node.removeAttribute('data-label-swap');
      }, LABEL_SWAP_MS);
      STATE.timers.push(swap);
    }

    /* _applyShake (W47.S3) — translates the per-tier amplitude into a
     * CSS custom property + class toggle. Defense in depth: the matchMedia
     * gate here is independent of the CSS @media gate, so a partial
     * platform support for prefers-reduced-motion still calms the
     * banner. The function is idempotent — re-calling with the same tier
     * is a no-op visually (animation continues on the same CSS variable). */
    function _applyShake(node, toTier) {
      var minTier = ${cfg.shakeMinTier};
      var amp = SHAKE_AMP[toTier - 1] || 0;
      var reduceMotion = (typeof window !== 'undefined' &&
                          typeof window.matchMedia === 'function' &&
                          window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (reduceMotion || amp <= 0 || toTier < minTier) {
        node.classList.remove('is-shaking');
        node.style.removeProperty('--bw-shake-amp');
        node.style.removeProperty('--bw-shake-period');
        return;
      }
      node.style.setProperty('--bw-shake-amp', String(amp));
      node.style.setProperty('--bw-shake-period', SHAKE_PERIOD_MS + 'ms');
      node.classList.add('is-shaking');
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
      if (node) {
        node.setAttribute('data-show', 'exit');
        /* W47.S3 — stop shaking before exit so the fade reads as a
         * clean settle, not a shaking ghost. The CSS-side media-query
         * gate is a backup; this line is the deterministic path. */
        node.classList.remove('is-shaking');
        node.style.removeProperty('--bw-shake-amp');
        node.style.removeProperty('--bw-shake-period');
      }
      return _delay(FADE_MS);
    }

    function _cleanupHost() {
      var host = _host();
      if (!host) return;
      /* Remove the banner only — preserve the SR-only announce region
       * so its end-of-sequence message survives the post-fade teardown
       * (and so the next sequence doesn't re-mount a duplicate node). */
      var b = host.querySelector('.big-win-tier-banner');
      if (b) host.removeChild(b);
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
      /* Idempotency guard — matches the contract documented on
       * bigWinTierEnter. A double-fired onWinPresentationEnd (or a stale
       * presentation cycle racing a fresh spin) must NOT restart the
       * ladder mid-flight; doing so would double-emit onBigWinTierEntered
       * and orphan the prior fade-out chain. */
      if (STATE.walkActive) return;
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

      /* Bump the cadence token so any in-flight tier-promotion timers
       * from a stale walkthrough are invalidated when they fire. */
      STATE.rafToken = (STATE.rafToken || 0) + 1;
      var cadenceToken = STATE.rafToken;

      /* Schedule TIME-BASED tier promotions FROM THE startTier enter
       * (T0), NOT from fade-in completion. This keeps tier i visible
       * for exactly DURATIONS[i-1] ms regardless of fade timing — Boki
       * rule 05.06.2026: "sve su to blokovi sami za sebe". The block
       * owns cadence; nothing the caller does can speed it up. */
      var cumulative = 0;
      for (var pi = startTier; pi < finalTier; pi++) {
        cumulative += DURATIONS[pi - 1];
        (function (fromT, toT, whenMs) {
          var tid = setTimeout(function () {
            if (cadenceToken !== STATE.rafToken) return;   /* cancelled by skip/preSpin */
            if (!STATE.walkActive) return;
            _emitExited({ tier: fromT, reason: 'natural' });
            STATE.current = toT;
            STATE.label   = LABELS[toT - 1];
            if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = toT;
            _swapTier(toT);
            _emitEntered({
              tier: toT, x: finalAward, label: STATE.label,
              durationMs: DURATIONS[toT - 1],
              soundBus: SOUND_BUSES[toT - 1],
              isFinal: (toT === finalTier),
            });
          }, whenMs);
          STATE.timers.push(tid);
        })(pi, pi + 1, cumulative);
      }

      /* Total count time = (#tiers walked) × per-tier duration. Linear count
       * over this window means the player sees a steady ramp regardless of
       * which tier is currently highlighted. */
      var tiersWalked = (finalTier - startTier + 1);
      var totalCountMs = 0;
      for (var ti = startTier; ti <= finalTier; ti++) totalCountMs += DURATIONS[ti - 1];

      /* After fade-in completes, start the linear counter ramp. Tier
       * promotions are owned by the scheduler above — _countUpLinear
       * only handles the money ramp. */
      var fadeInDone = setTimeout(function () {
        if (!STATE.walkActive) return;
        _countUpLinear(0, finalAward, totalCountMs).then(function () {
          if (!STATE.walkActive) return;
          /* Hold the climax plaque at finalX for endHoldMs (4 s default —
           * "big win end event isto cetiri sekunde"). */
          return _delay(END_HOLD_MS);
        }).then(function () {
          if (!STATE.walkActive) return;
          /* Single SR push of the final amount, fired exactly once per
           * sequence — see _announce() for the rationale. */
          _announce(_fmtMoney(STATE.finalX));
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

    /* _mountBannerAt — fresh banner mounted at the given tier, fade-in.
     * Removes any prior banner but preserves the SR-only announce node. */
    function _mountBannerAt(tier) {
      var host = _host();
      if (!host) return;
      var oldBanner = host.querySelector('.big-win-tier-banner');
      if (oldBanner) host.removeChild(oldBanner);
      var node = document.createElement('div');
      node.className = 'big-win-tier-banner';
      node.setAttribute('data-tier', String(tier));
      node.setAttribute('data-show', 'enter');
      /* Label gets aria-live so the ~5 tier-name swaps reach the SR;
       * amount is aria-hidden because its rAF-driven text would otherwise
       * spam the queue every frame. The final money announcement is
       * routed once through #bigWinTierAnnounce after endHoldMs. */
      node.innerHTML =
        '<span class="big-win-tier-label" aria-live="polite" aria-atomic="true">' + LABELS[tier - 1] + '</span>' +
        '<div class="big-win-tier-stepper" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + tier + '" aria-label="Win tier progress">' +
          '<span class="big-win-tier-step" data-step="1" aria-hidden="true"></span>' +
          '<span class="big-win-tier-step" data-step="2" aria-hidden="true"></span>' +
          '<span class="big-win-tier-step" data-step="3" aria-hidden="true"></span>' +
          '<span class="big-win-tier-step" data-step="4" aria-hidden="true"></span>' +
          '<span class="big-win-tier-step" data-step="5" aria-hidden="true"></span>' +
        '</div>' +
        '<span class="big-win-tier-amount" aria-hidden="true" data-count="0">' + _fmtMoney(0) + '</span>';
      host.appendChild(node);
      /* W47.S3 — start the shake right when the banner mounts so the
       * fade-in lands on a banner that's already pulsing. Subsequent
       * tier swaps re-evaluate via _swapTier → _applyShake. */
      _applyShake(node, tier);
      var hold = setTimeout(function () {
        if (node && node.parentNode === host) node.setAttribute('data-show', 'hold');
      }, FADE_MS);
      STATE.timers.push(hold);
    }

    /* _countUpLinear — pure linear money ramp from 'fromAward' to 'toAward'
     * over 'dur' ms with NO easing (Boki rule "non stop da broji istom
     * brzinom"). Display is currency-formatted money. Counter is
     * INDEPENDENT of tier swaps — those are scheduled by _runCompound on
     * a TIME-BASED cadence so the visual ladder rhythm is owned by the
     * block itself, not by the awarded amount. */
    function _countUpLinear(fromAward, toAward, dur) {
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
        var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var localToken = STATE.rafToken;       /* read once; _runCompound owns bumps */
        function step() {
          if (localToken !== STATE.rafToken) { resolve(); return; }
          var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          var p = Math.min(1, (now - t0) / dur);
          /* LINEAR — no easing function. Each ms == same delta money. */
          var current = fromAward + (toAward - fromAward) * p;
          amtEl.textContent = _fmtMoney(current);
          amtEl.setAttribute('data-count', String(current));
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
       * never sees a flash of empty host between exit and skip-finalize.
       * data-skip="true" kills the 600 ms color/font-size/filter
       * transitions + 220 ms label opacity tween that the walkthrough
       * relies on, so the climax tier appears INSTANTLY instead of
       * morphing visually through the intermediate tier classes
       * (Boki rule 05.06.2026 "ode na kraju big wina, a ne da presence
       * jedan po jedan tier"). */
      var node = _banner();
      if (node) {
        node.setAttribute('data-skip', 'true');
        /* Defensive: clear any in-flight label cross-fade attribute so
         * the climax label is visible from frame 1. */
        node.removeAttribute('data-label-swap');
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
          n.setAttribute('data-skip', 'true');     /* no transitions on the very first frame */
          n.setAttribute('data-tier', String(finalTier));
          n.setAttribute('data-show', 'hold');
          n.innerHTML =
            '<span class="big-win-tier-label" aria-live="polite" aria-atomic="true">' + LABELS[finalTier - 1] + '</span>' +
            '<div class="big-win-tier-stepper" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + finalTier + '" aria-label="Win tier progress">' +
              '<span class="big-win-tier-step" data-step="1" aria-hidden="true"></span>' +
              '<span class="big-win-tier-step" data-step="2" aria-hidden="true"></span>' +
              '<span class="big-win-tier-step" data-step="3" aria-hidden="true"></span>' +
              '<span class="big-win-tier-step" data-step="4" aria-hidden="true"></span>' +
              '<span class="big-win-tier-step" data-step="5" aria-hidden="true"></span>' +
            '</div>' +
            '<span class="big-win-tier-amount" aria-hidden="true" data-count="' + finalX + '">' + _fmtMoney(finalX) + '</span>';
          host.appendChild(n);
        }
      }
      STATE.current = finalTier;
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = finalTier;
      _emitExited({ tier: prevTier, reason: 'skipped' });
      /* Single SR push of the climax amount before fade — same one-shot
       * announce contract the natural path uses. */
      _announce(_fmtMoney(finalX));
      /* Short visibility hold of the climax before fading — long enough
       * to register, short enough not to feel like an ignored skip. */
      var t = setTimeout(function () {
        _fadeOutCurrent().then(function () { _finishSequence('skipped'); });
      }, SKIP_GLIMPSE_MS);
      STATE.timers.push(t);
    }

    if (typeof window !== 'undefined') {
      window.bigWinTierEnter = bigWinTierEnter;
      window.bigWinTierExit  = bigWinTierExit;
    }

    /* ── Frame-anchored sizing sync ──────────────────────────────────
     * Boki spec 05.06.2026: "big win flow responsive i u skladu sa
     * velicinom ril frames".
     *
     * Industry reference: big-win is a layout node whose width/height/
     * position are pushed by the layout system on every resize. The
     * banner stays sized to the reels area, not the page viewport.
     *
     * Our HTML equivalent: read #frameHost's bounding rect on every
     * resize/scroll and publish it on the host element as four CSS
     * custom properties (--bw-frame-x/y/w/h). The emitted CSS reads
     * these to position and size the host and to scale font-size,
     * padding, and gap proportionally. Falls back to viewport (100vw/h)
     * if the frame node isn't found OR before the first observer tick,
     * so initial paint never lands at 0x0.
     *
     * Performance: writes are batched per frame via rAF coalescing —
     * a burst of ResizeObserver callbacks during a window drag becomes
     * one DOM write per animation frame instead of N. */
    (function () {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;
      var FRAME_SEL = '#frameHost';
      var rafPending = 0;

      function _syncNow() {
        rafPending = 0;
        var host = _host();
        if (!host) return;
        var frame = document.querySelector(FRAME_SEL);
        if (!frame || typeof frame.getBoundingClientRect !== 'function') {
          /* No frame mounted (smoke-test / disabled host). Leave CSS vars
           * unset so the viewport fallback (100vw/h) kicks in. */
          return;
        }
        var r = frame.getBoundingClientRect();
        /* Defensive: pre-layout pass can hand back a zero-sized rect.
         * Skip the write so we don't squash the banner to 0x0 between
         * the DOM mount and the first layout pass. */
        if (!(r.width > 0 && r.height > 0)) return;
        var s = host.style;
        s.setProperty('--bw-frame-x', r.left   + 'px');
        s.setProperty('--bw-frame-y', r.top    + 'px');
        s.setProperty('--bw-frame-w', r.width  + 'px');
        s.setProperty('--bw-frame-h', r.height + 'px');
      }

      function _scheduleSync() {
        if (rafPending) return;
        if (typeof window.requestAnimationFrame === 'function') {
          rafPending = window.requestAnimationFrame(_syncNow);
        } else {
          rafPending = 1;
          setTimeout(_syncNow, RAF_FALLBACK_MS);
        }
      }

      /* Initial paint — try immediately, then again after first rAF so
       * we catch the post-mount layout pass even if the script runs
       * before the frame has been measured. */
      _syncNow();
      _scheduleSync();

      /* ResizeObserver — fires when the frame box changes (cabinet
       * rotate, viewport drag, devtools toggle). Cheapest signal. */
      if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(_scheduleSync);
        var frame = document.querySelector(FRAME_SEL);
        if (frame) ro.observe(frame);
        /* Also observe documentElement so font-size root changes
         * (zoom, accessibility) cascade through. */
        if (document.documentElement) ro.observe(document.documentElement);
      }

      /* Window resize + scroll — covers page-level reflows and the
       * fixed-position offset drift when the page is scrolled. Passive
       * listeners — never blocks scroll. */
      window.addEventListener('resize', _scheduleSync, { passive: true });
      window.addEventListener('scroll', _scheduleSync, { passive: true });

      /* Re-sync on tab refocus — Safari/iOS sometimes paints the wrong
       * bbox after backgrounding. */
      window.addEventListener('focus', _scheduleSync, { passive: true });
    })();

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      /* F3 priority 50 — presenter class. Listens to win-presentation-end
         to drive the big-win tier ladder banner. Runs alongside other
         presenters (winPresentation rollup, scatterCelebration, payline overlay)
         after state-mutators and payout evaluators have settled ev.payX. */
      window.HookBus.on('onWinPresentationEnd', function () {
        var award = (typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) ? window.__WIN_AWARD__ : 0;
        var bet   = _currentBet();
        /* Tier classification = ratio space (vendor-neutral math).
         * Counter displays = absolute money (player UX). */
        var tier = tierFromRatio(award / bet);
        if (tier < 1) return;
        _runCompound(tier, award);
      }, { priority: 50 });

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
