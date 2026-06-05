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
 *     1→2→3→4→5 in sequence. Optional `passthrough` flag walks lower
 *     tiers briefly (each `passthroughMs` ms) before settling on the
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
 *     (`bigWinThresholdX`/`megaWinThresholdX`/`epicWinThresholdX` left as
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
    /* Vendor-neutral placeholder labels. Real games override with their
     * own copy. Numeric tier survives independent of label vocabulary. */
    labels:        ['TIER 1', 'TIER 2', 'TIER 3', 'TIER 4', 'TIER 5'],
    /* Banner lifetimes per tier. Ascending — tier 5 deserves the longest
     * moment. */
    durations:     [1800, 2400, 3200, 4800, 6400],
    /* Default cool-to-warm palette: yellow → gold → orange → magenta →
     * white-hot. Per-game palette overrides via GDD. */
    colors: [
      '255,210,90',   // tier 1 — warm yellow
      '255,170,60',   // tier 2 — gold
      '255,110,60',   // tier 3 — flame orange
      '230,80,170',   // tier 4 — magenta
      '255,240,200',  // tier 5 — white-hot climax
    ],
    passthrough:   false,
    passthroughMs: 280,
    /* Opaque pickup keys for the audio block. The audio block decides
     * which Howler bus or asset maps to each key — this block does NOT
     * play audio directly (LEGO separation: visual vs audio). */
    soundBuses: ['low', 'mid', 'high', 'peak', 'climax'],
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

  if (m.passthrough != null) cfg.passthrough = !!m.passthrough;
  if (Number.isFinite(m.passthroughMs)) cfg.passthroughMs = clampInt(m.passthroughMs, 80, 1500);

  if (Array.isArray(m.soundBuses) && m.soundBuses.length === TIER_COUNT) {
    const bs = m.soundBuses.map(v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v)) ? v : null);
    if (bs.every(Boolean)) cfg.soundBuses = bs;
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
  }
  .big-win-tier-banner .big-win-tier-amount {
    display: block;
    font-size: 0.6em;
    font-weight: 800;
    letter-spacing: 0.22em;
    margin-top: 0.5rem;
    opacity: 0.92;
  }
  .big-win-tier-banner[data-show="true"] { animation: bigWinTierIn 460ms cubic-bezier(.4,1.6,.45,1) forwards; }
  .big-win-tier-banner[data-show="exit"] { animation: bigWinTierOut 360ms ease-in forwards; }
  .big-win-tier-banner[data-tier="1"] { border-color: rgba(${c[0]},.95); color: rgba(${c[0]},1); box-shadow: 0 0 70px rgba(${c[0]},.55);  font-size: 2.4rem; }
  .big-win-tier-banner[data-tier="2"] { border-color: rgba(${c[1]},.95); color: rgba(${c[1]},1); box-shadow: 0 0 80px rgba(${c[1]},.6);   font-size: 2.7rem; }
  .big-win-tier-banner[data-tier="3"] { border-color: rgba(${c[2]},.95); color: rgba(${c[2]},1); box-shadow: 0 0 90px rgba(${c[2]},.65);  font-size: 3.0rem; }
  .big-win-tier-banner[data-tier="4"] { border-color: rgba(${c[3]},.95); color: rgba(${c[3]},1); box-shadow: 0 0 100px rgba(${c[3]},.7);  font-size: 3.3rem; }
  .big-win-tier-banner[data-tier="5"] { border-color: rgba(${c[4]},.95); color: rgba(${c[4]},1); box-shadow: 0 0 110px rgba(${c[4]},.78); font-size: 3.8rem; }
  @keyframes bigWinTierIn {
    0%   { opacity: 0; transform: scale(0.6) translateY(-26px); }
    55%  { opacity: 1; transform: scale(1.08) translateY(0); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes bigWinTierOut {
    0%   { opacity: 1; transform: scale(1) translateY(0); }
    100% { opacity: 0; transform: scale(0.85) translateY(-14px); }
  }
  /* Tier-4 + tier-5 add a radial backdrop flash for cinematic weight. */
  .big-win-tier-host.is-tier-4::before,
  .big-win-tier-host.is-tier-5::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: -1;
    animation: bigWinTierFlash 1400ms ease-out forwards;
  }
  .big-win-tier-host.is-tier-4::before { background: radial-gradient(circle at center, rgba(${c[3]},.20), rgba(${c[3]},0) 62%); }
  .big-win-tier-host.is-tier-5::before { background: radial-gradient(circle at center, rgba(${c[4]},.26), rgba(${c[4]},0) 65%); }
  @keyframes bigWinTierFlash {
    0%   { opacity: 0; }
    25%  { opacity: 1; }
    100% { opacity: 0; }
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
    .big-win-tier-banner[data-show="true"],
    .big-win-tier-banner[data-show="exit"] { animation: none; opacity: 1; transform: none; }
    .big-win-tier-host.is-tier-4::before,
    .big-win-tier-host.is-tier-5::before { animation: none; opacity: 0; }
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
     Owns emit of: onBigWinTierEntered, onBigWinTierExited.
     Listens: onWinPresentationEnd, onSkipRequested(phase==='bigWinTier'),
              preSpin (flush stale banner). */
  (function () {
    var THRESHOLDS   = ${thresholds};
    var LABELS       = ${labels};
    var DURATIONS    = ${durations};
    var SOUND_BUSES  = ${soundBuses};
    var PASSTHROUGH  = ${cfg.passthrough};
    var PASSTHROUGH_MS = ${cfg.passthroughMs};

    var STATE = {
      enabled: true,
      current: 0,             /* 0 = no tier in flight; 1..5 = active tier */
      x: 0,                   /* totalAward / bet at entry time */
      label: '',
      timers: [],             /* outstanding setTimeout handles (for clean cancel) */
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

    function _render(tier) {
      var host = _host();
      if (!host) return;
      while (host.firstChild) host.removeChild(host.firstChild);
      for (var ti = 1; ti <= 5; ti++) host.classList.remove('is-tier-' + ti);
      if (tier < 1) return;
      var node = document.createElement('div');
      node.className = 'big-win-tier-banner';
      node.setAttribute('data-tier', String(tier));
      node.setAttribute('data-show', 'true');
      var idx = tier - 1;
      var inner = LABELS[idx];
      if (Number.isFinite(STATE.x) && STATE.x > 0 && tier === STATE.current) {
        var amt = STATE.x.toFixed(2).replace(/\\.00$/, '');
        inner += '<span class="big-win-tier-amount">×' + amt + '</span>';
      }
      node.innerHTML = inner;
      host.appendChild(node);
      host.classList.add('is-tier-' + tier);
    }

    function _hide() {
      var node = _banner();
      if (node) node.setAttribute('data-show', 'exit');
      var t = setTimeout(function () {
        var host = _host();
        if (host) {
          while (host.firstChild) host.removeChild(host.firstChild);
          for (var ti = 1; ti <= 5; ti++) host.classList.remove('is-tier-' + ti);
        }
      }, 360);
      STATE.timers.push(t);
    }

    /* bigWinTierEnter(tier) — public entry. Idempotent: a second call with
     * the same tier is a no-op; a higher tier upgrades in flight; a lower
     * tier ignored. Test hook also calls this directly. */
    function bigWinTierEnter(tier, x, opts) {
      tier = Math.floor(Number(tier));
      if (!(tier >= ${BIG_WIN_TIER_MIN} && tier <= ${BIG_WIN_TIER_MAX})) return;
      if (STATE.current === tier) return;
      if (STATE.current > tier) return;
      _clearTimers();
      STATE.current = tier;
      STATE.x       = Number.isFinite(x) ? x : 0;
      STATE.label   = LABELS[tier - 1];
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = tier;
      _render(tier);
      var dur = DURATIONS[tier - 1];
      _emitEntered({
        tier: tier,
        x: STATE.x,
        label: STATE.label,
        durationMs: dur,
        soundBus: SOUND_BUSES[tier - 1],
      });
      var t = setTimeout(function () { bigWinTierExit('natural'); }, dur);
      STATE.timers.push(t);
    }

    /* bigWinTierExit(reason) — cancel timers, render exit, emit Exited. */
    function bigWinTierExit(reason) {
      if (STATE.current < 1) return;
      _clearTimers();
      var tier = STATE.current;
      _hide();
      _emitExited({ tier: tier, reason: (reason === 'skipped' ? 'skipped' : 'natural') });
      STATE.current = 0;
      STATE.x       = 0;
      STATE.label   = '';
      if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = 0;
    }

    /* Passthrough sequence — render tiers 1..(final-1) briefly before
     * settling on the final tier. Used only when PASSTHROUGH config flag
     * is true. */
    function _enterWithPassthrough(finalTier, x) {
      if (!PASSTHROUGH || finalTier <= 1) {
        bigWinTierEnter(finalTier, x);
        return;
      }
      var step = 0;
      function next() {
        if (step < finalTier - 1) {
          step += 1;
          _render(step);
          var t = setTimeout(next, PASSTHROUGH_MS);
          STATE.timers.push(t);
        } else {
          bigWinTierEnter(finalTier, x);
        }
      }
      _clearTimers();
      next();
    }

    if (typeof window !== 'undefined') {
      window.bigWinTierEnter = bigWinTierEnter;
      window.bigWinTierExit  = bigWinTierExit;
    }

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onWinPresentationEnd', function () {
        var award = (typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) ? window.__WIN_AWARD__ : 0;
        var bet   = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
        var ratio = award / bet;
        var tier = tierFromRatio(ratio);
        if (tier < 1) return;
        _enterWithPassthrough(tier, ratio);
      });

      window.HookBus.on('onSkipRequested', function (p) {
        if (!p || p.phase !== 'bigWinTier') return;
        if (STATE.current < 1) return;
        bigWinTierExit('skipped');
      });

      /* Defensive: a fresh spin must wipe any banner still on screen
       * (rapid play, autoplay, etc). */
      window.HookBus.on('preSpin', function () {
        if (STATE.current >= 1) bigWinTierExit('skipped');
      });
    }
  })();
`;
}
