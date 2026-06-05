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
  if (Number.isFinite(m.fadeMs))  cfg.fadeMs  = clampInt(m.fadeMs,  100, 1200);

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
  /* Three banner states drive the fade choreography:
   *   data-show="enter" — fade-in + scale-up (300ms)
   *   data-show="hold"  — steady on screen during count-up
   *   data-show="exit"  — fade-out + scale-down (300ms)
   * Compound walkthrough uses enter → hold → exit per tier with the
   * next tier's enter following immediately. */
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

    /* _renderTier — mount a fresh banner for 'tier' in the "enter" fade-in
     * state. Counter starts at 'startX' (continuous from the previous
     * tier's end). */
    function _renderTier(tier, startX) {
      var host = _host();
      if (!host) return;
      while (host.firstChild) host.removeChild(host.firstChild);
      var node = document.createElement('div');
      node.className = 'big-win-tier-banner';
      node.setAttribute('data-tier', String(tier));
      node.setAttribute('data-show', 'enter');
      var inner = LABELS[tier - 1];
      inner += '<span class="big-win-tier-amount" data-count="' + startX + '">×' + _fmt(startX) + '</span>';
      node.innerHTML = inner;
      host.appendChild(node);
      /* After fade-in completes, flip to "hold" so the static state
       * remains until count-up + hold time expires. */
      var hold = setTimeout(function () {
        if (node && node.parentNode === host) node.setAttribute('data-show', 'hold');
      }, FADE_MS);
      STATE.timers.push(hold);
    }

    /* _fmt — display formatter. ×amounts ≥ 100 drop decimals; smaller
     * amounts keep up to 2 decimals, stripping trailing .00. */
    function _fmt(v) {
      if (!Number.isFinite(v) || v < 0) return '0';
      if (v >= 100) return v.toFixed(0);
      return v.toFixed(2).replace(/\\.00$/, '').replace(/0$/, '');
    }

    /* _countUp — rAF-driven count-up from 'from' to 'to' over 'dur' ms
     * using easeOutCubic. Returns a Promise so the compound sequencer
     * can await each tier's count completion. */
    function _countUp(from, to, dur) {
      return new Promise(function (resolve) {
        var amtEl = _host() && _host().querySelector('.big-win-tier-amount');
        if (!amtEl || !(dur > 0) || !(to > from)) {
          if (amtEl) {
            amtEl.textContent = '×' + _fmt(to);
            amtEl.setAttribute('data-count', String(to));
          }
          resolve();
          return;
        }
        var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var rafToken = STATE.rafToken = (STATE.rafToken || 0) + 1;
        function step() {
          if (rafToken !== STATE.rafToken) { resolve(); return; }
          var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          var p = Math.min(1, (now - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);   /* easeOutCubic — decelerating tween */
          var current = from + (to - from) * eased;
          amtEl.textContent = '×' + _fmt(current);
          amtEl.setAttribute('data-count', String(current));
          if (p < 1) {
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
            else { amtEl.textContent = '×' + _fmt(to); resolve(); }
          } else {
            amtEl.textContent = '×' + _fmt(to);
            amtEl.setAttribute('data-count', String(to));
            resolve();
          }
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
        else { amtEl.textContent = '×' + _fmt(to); resolve(); }
      });
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

    /* _runCompound — sequencer for the walkthrough. Walks tier 1..final,
     * each step: render banner (fade-in) → count-up to that tier's
     * threshold (or to finalX on the last tier) → fade-out. The final
     * tier holds the climax amount for the remaining duration before
     * fading. Emits onBigWinTierEntered/Exited per tier, then a single
     * onBigWinTierEnd to close the sequence. */
    function _runCompound(finalTier, finalX) {
      _clearTimers();
      STATE.walkActive = true;
      STATE.finalTier  = finalTier;
      STATE.finalX     = finalX;
      var firstTier = COMPOUND ? 1 : finalTier;
      var prevX = 0;
      var idx = firstTier;

      function nextTier() {
        if (!STATE.walkActive) return;
        STATE.current = idx;
        STATE.label   = LABELS[idx - 1];
        if (typeof window !== 'undefined') window.__BIG_WIN_TIER__ = idx;
        /* Target amount for this tier — either its threshold (if more
         * tiers to walk) or the final climax X (if this is the last). */
        var isFinal = (idx === finalTier);
        var targetX = isFinal ? finalX : THRESHOLDS[idx - 1];
        var dur     = DURATIONS[idx - 1];
        /* Allocate 70% of duration to count-up, 30% to hold-after on the
         * final tier; intermediate tiers spend their hold time mostly on
         * the count-up (compound dramaturgy). */
        var countDur = Math.max(200, Math.round(dur * 0.70));
        var holdDur  = Math.max(0,   dur - countDur);

        _renderTier(idx, prevX);
        _emitEntered({
          tier: idx, x: targetX, label: STATE.label,
          durationMs: dur, soundBus: SOUND_BUSES[idx - 1],
          isFinal: isFinal,
        });

        _delay(FADE_MS).then(function () {
          if (!STATE.walkActive) return;
          return _countUp(prevX, targetX, countDur);
        }).then(function () {
          if (!STATE.walkActive) return;
          return _delay(holdDur);
        }).then(function () {
          if (!STATE.walkActive) return;
          return _fadeOutCurrent();
        }).then(function () {
          if (!STATE.walkActive) return;
          _emitExited({ tier: idx, reason: 'natural' });
          prevX = targetX;
          if (idx < finalTier) { idx += 1; nextTier(); }
          else { _finishSequence('natural'); }
        });
      }
      nextTier();
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

    /* bigWinTierEnter(tier, x) — public entry. Idempotent: a second call
     * during an active walkthrough is ignored. If the block is COMPOUND,
     * starts a tier-1→tier walkthrough; otherwise jumps to the tier. */
    function bigWinTierEnter(tier, x) {
      tier = Math.floor(Number(tier));
      if (!(tier >= ${BIG_WIN_TIER_MIN} && tier <= ${BIG_WIN_TIER_MAX})) return;
      if (STATE.walkActive) return;
      var finalX = Number.isFinite(x) ? x : THRESHOLDS[tier - 1];
      _runCompound(tier, finalX);
    }

    /* bigWinTierExit(reason) — fast-finalize the sequence. Skips remaining
     * tiers, renders the final tier instantaneously with the climax
     * amount, then emits onBigWinTierEnd. Used by skip CTA + preSpin
     * flush. */
    function bigWinTierExit(reason) {
      if (!STATE.walkActive) return;
      var finalTier = STATE.finalTier;
      var finalX    = STATE.finalX;
      _clearTimers();
      STATE.rafToken += 1;
      /* Show the final tier briefly (instant render, no fade) so the
       * player sees what they would have seen at the end of the
       * compound walkthrough. Total visible time ≤ FADE_MS so a fast
       * spinner doesn't get stalled. */
      _cleanupHost();
      var host = _host();
      if (host) {
        var node = document.createElement('div');
        node.className = 'big-win-tier-banner';
        node.setAttribute('data-tier', String(finalTier));
        node.setAttribute('data-show', 'hold');
        node.innerHTML = LABELS[finalTier - 1] + '<span class="big-win-tier-amount" data-count="' + finalX + '">×' + _fmt(finalX) + '</span>';
        host.appendChild(node);
      }
      _emitExited({ tier: finalTier, reason: 'skipped' });
      var t = setTimeout(function () { _fadeOutCurrent().then(function () { _finishSequence('skipped'); }); }, FADE_MS);
      STATE.timers.push(t);
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
        _runCompound(tier, ratio);
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
