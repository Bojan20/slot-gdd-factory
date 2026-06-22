/**
 * Slot GDD Factory · winPresentation BLOCK
 *
 * Orchestrates how winning combinations are PRESENTED to the player after
 * reels settle — token cancellation, per-event cycling, payline-aware
 * detection, mode dispatch. The single source of truth for "what happens
 * when a win exists on the grid".
 *
 * GDD-driven configuration (consumed from `model.winPresentation`):
 *   mode         'per-line' | 'cluster' | 'all-at-once'   (default 'per-line')
 *   perEventMs   number (forces constant) | 'auto'         (default 'auto')
 *   maxEvents    number                                    (default 8)
 *   noWinChance  number in [0, 1]                          (default 0.30)
 *   winCycle     boolean (false → entire block disabled)   (default true)
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                       → safe defaults
 *   resolveConfig(model)                  → merge defaults with GDD override
 *   emitWinPresentationRuntime(config)    → runtime JS string for orchestrator
 *
 * Runtime contract (after emitted code executes):
 *   WINSYM_CYCLE_TOKEN     module-local int, bumped by cancelWinSymCycle
 *   cancelWinSymCycle()    invalidates in-flight cycle
 *   playWinSymCycle(...)   walks events one-by-one, returns Promise
 *   detectLineWins()       payline evaluator → events
 *   applyWinHighlight()    public façade: detect + dispatch + cycle
 *
 * Runtime dependencies (must exist in enclosing scope):
 *   grid, FSM, FREESPINS, SYMBOL_REGISTRY, PAYLINE_POOL, RECT_REELS, ROWS,
 *   clearWinHighlight, clearPaylineOverlay, drawPaylineOverlay,
 *   detectWinCombos
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const DEFAULTS = Object.freeze({
  mode: 'per-line',
  perEventMs: 'auto',
  maxEvents: 8,
  noWinChance: 0.30,
  winCycle: true,
  /* Big-win symbol celebration window (Boki rule 05.06.2026: when a big
   * win lands, the reference flow is "symbol pulse → big-win banner",
   * NOT "per-line cycle → big-win banner". A single coordinated 800 ms
   * pulse on ALL winning cells replaces the per-event walk so the
   * player doesn't see a redundant line-by-line preview before the
   * tiered big-win banner takes over. Matches the reference presentation
   * SYMBOL_CELEBRATION duration. */
  bigWinCelebMs: 800,
  /* Wave V5 — cascade-stagger mode step. Per-event delay when mode is
   * 'cascade-stagger' (vs default ~500ms for per-line cycle). Industry
   * range 60-120 ms; the lower bound matches modern fast-cascade
   * pacing where the player reads the chain in one breath instead of
   * one-by-one. Falls back to perEventMs when mode != 'cascade-stagger'. */
  staggerStepMs: 80,
  /* Wave LDW (W48 spin-quality) — Losses Disguised as Wins suppression.
   * Regulator-driven: when totalAward ≤ currentBet, the round is a net
   * LOSS for the player but legacy designs still celebrate it (rollup
   * counter ticks up, sound triggers, screen-shake, big-win pulse).
   * Regulators class this as deceptive presentation.
   *
   * Citations:
   *   • Dixon, M. (2010). "Losses Disguised as Wins in Modern Multi-Line
   *     Video Slot Machines". Addiction Research & Theory.
   *   • UKGC Remote Gambling Technical Standards (RTS) 7C — Game design:
   *     "must not present a net loss as a win".
   *   • Ontario AGCO Standard 4.07 § Win presentation — net delta gate.
   *   • UKGC 17-Jan-2025 amendment — explicit false-win prohibition.
   *
   * When `suppressLDW: true` AND `totalAward ≤ currentBet`:
   *   • onWinPresentationStart NOT emitted
   *   • symbol cycle / big-win pulse NOT played
   *   • SKIP_ROLLUP CTA NOT shown
   *   • balance credit still happens (player got their amount back, just
   *     no fake celebration)
   *
   * Default is TRUE because regulator-strictest jurisdictions (UK, ON)
   * are an industry baseline; relaxed markets can opt out via GDD. */
  suppressLDW: true,
});

/* Validation bounds for GDD-supplied overrides — kept frozen and adjacent
   to DEFAULTS so resolveConfig has no unnamed literals. Range intent
   (industry pacing windows) is named here, not re-derived at every site. */
const LIMITS = Object.freeze({
  STAGGER_MIN_MS: 20, STAGGER_MAX_MS: 500,
  MAX_EVENTS_CAP: 50,
  BIG_WIN_MIN_MS: 100, BIG_WIN_MAX_MS: 5000,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

/* Merge defaults with model.winPresentation, accepting only known keys with
   the correct shape — defends against malformed GDD overrides. */
export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.winPresentation) || {};

  if (
    src.mode === 'per-line' ||
    src.mode === 'cluster' ||
    src.mode === 'all-at-once' ||
    src.mode === 'cascade-stagger'   /* Wave V5 — new cascade-pace cycle mode */
  ) {
    cfg.mode = src.mode;
  }
  if (
    typeof src.staggerStepMs === 'number' &&
    src.staggerStepMs >= LIMITS.STAGGER_MIN_MS && src.staggerStepMs <= LIMITS.STAGGER_MAX_MS
  ) {
    cfg.staggerStepMs = Math.floor(src.staggerStepMs);
  }
  if (src.perEventMs === 'auto' || (typeof src.perEventMs === 'number' && src.perEventMs > 0)) {
    cfg.perEventMs = src.perEventMs;
  }
  if (typeof src.maxEvents === 'number' && src.maxEvents > 0 && src.maxEvents <= LIMITS.MAX_EVENTS_CAP) {
    cfg.maxEvents = Math.floor(src.maxEvents);
  }
  if (typeof src.noWinChance === 'number' && src.noWinChance >= 0 && src.noWinChance <= 1) {
    cfg.noWinChance = src.noWinChance;
  }
  if (src.winCycle === false) cfg.winCycle = false;
  if (typeof src.bigWinCelebMs === 'number' && src.bigWinCelebMs >= LIMITS.BIG_WIN_MIN_MS && src.bigWinCelebMs <= LIMITS.BIG_WIN_MAX_MS) {
    cfg.bigWinCelebMs = Math.floor(src.bigWinCelebMs);
  }
  /* Wave LDW — accept either model.winPresentation.suppressLDW or the
   * regulator-profile alias model.responsibleGambling.suppressLDW. */
  if (typeof src.suppressLDW === 'boolean') cfg.suppressLDW = src.suppressLDW;
  const rg = (model && model.responsibleGambling) || {};
  if (typeof rg.suppressLDW === 'boolean') cfg.suppressLDW = rg.suppressLDW;

  return cfg;
}

/* Wave T-slim — extract of win-highlight + win-symbol-cycle CSS from
 * buildSlotHTML.mjs orchestrator (originally inline, ~95 LOC). Kept as
 * an enabled-always block because every grid kind uses these selectors;
 * disabling would break the no-trigger win presentation cycle. */
/* Contract: caller passes a resolved cfg (or omits for defaults). We do
   NOT re-run resolveConfig — matches emitDetectWinCombosRuntime and avoids
   the asymmetric "partial cfg silently dropped, defaults stacked twice"
   misuse that the senior review flagged. */
export function emitWinPresentationCSS(cfg = defaultConfig()) {
  return `
  /* ── Win highlight — emitted by src/blocks/winPresentation.mjs
     Visual-only: winning cells stay full opacity with a contained brightness
     pulse + inset gold rim. Non-winning cells dim to ~32%. Boki rule
     (2026-06-20, D-10 SYMBOL-OVERFLOW): NO transform here. Previous
     "transform: scale(1.06)" on ".is-win" pushed edge cells past the
     ".reelCol { overflow: hidden }" mask, so the winning symbol visibly
     "disappeared" from the reel frame. This matches the same NO-transform
     constraint already enforced for the ".is-winsym-cycling" phase below. */
  .gridHost.has-winselection .cell,
  .gridHost.has-winselection text         { opacity: 0.32; transition: opacity 180ms ease, filter 180ms ease, box-shadow 180ms ease; }
  .gridHost.has-winselection .cell.is-win,
  .gridHost.has-winselection text.is-win  { opacity: 1;
                                             filter: brightness(1.18);
                                             box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.85),
                                                         inset 0 0 6px  rgba(255, 170, 60, 0.45); }
  @media (prefers-reduced-motion: reduce) {
    .gridHost.has-winselection .cell,
    .gridHost.has-winselection text,
    .gridHost.has-winselection .cell.is-win,
    .gridHost.has-winselection text.is-win { transition: none; }
  }

  /* ── Win-symbol cycle ── independent modular block ────────────────────
     Plays AFTER reels settle on a non-trigger BASE spin. Multiple winning
     combinations cycle one-by-one, each lit for ~500ms (industry small-win
     pace), then everything undims back to neutral.

     Design constraint (Boki rule): SUBTLE — animation MUST stay entirely
     inside the reel cell. Hard rules:
       - NO transform (no scale / rotate) — glyph stays at native size
       - NO drop-shadow / external glow — every prior version bled past
         the frame edge; only INSET box-shadow is allowed
       - Inset gold rim + brightness pulse on the glyph
       - Neighbour cells dim to 0.30 for cluster contrast
     The result is a contained "lit-cell" pulse that reads on luminance
     and a soft inner rim, with zero overflow. */
  .gridHost.is-winsym-cycling .cell,
  .gridHost.is-winsym-cycling text {
    /* 2026-06-22 (V8) — Boki imperativ: "celije ne smeju da nestaju!
       odmah ide win linija". Tri prethodna pokušaja (0.30 → 0.55 → 0.55+pulse)
       svaki su izgledali kao "cells nestaju" iz player perspektive.
       Konačna odluka: skinemo non-win dim u potpunosti. Win cells i dalje
       pulse preko cell--winsym (brightness 1.28 + inset gold rim 2px) +
       polyline na svojoj win-liniji crta odmah → win cells "pop" preko
       luminance + gold rim a non-win cells stay full opacity. */
    opacity: 1;
    transition: none;
  }
  .gridHost.is-winsym-cycling .cell--winsym,
  .gridHost.is-winsym-cycling text.cell--winsym {
    opacity: 1 !important;
    /* Duration is driven by --winsym-pulse-ms set by the runtime before
       each cycle so the keyframe length tracks resolved perEventMs /
       bigWinCelebMs (fixes desync when GDD overrides the 500ms default
       — overlap on short steps, dead air on long ones). */
    animation: winsym-pulse var(--winsym-pulse-ms, 500ms) ease-in-out 1;
    transform: none;
    border-radius: 6px;
  }
  @keyframes winsym-pulse {
    0%   { filter: brightness(1.00);
           box-shadow: inset 0 0 0 0 rgba(255, 196, 90, 0); }
    35%  { filter: brightness(1.28);
           box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.92),
                       inset 0 0 8px  rgba(255, 170, 60, 0.55); }
    70%  { filter: brightness(1.14);
           box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.62),
                       inset 0 0 6px  rgba(255, 170, 60, 0.32); }
    100% { filter: brightness(1.00);
           box-shadow: inset 0 0 0 0 rgba(255, 196, 90, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .gridHost.is-winsym-cycling .cell--winsym,
    .gridHost.is-winsym-cycling text.cell--winsym {
      animation: none;
      filter: brightness(1.15);
      box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.85);
    }
  }
`;
}

/* Emit the cluster-mode evaluator runtime. Used by grids that DON'T have
   paylines (cluster / megaclusters / hex / diamond / pyramid / cross /
   l_shape / SVG) — fires one event per non-scatter symbol with ≥ 3 hits,
   wild substitutes & wild-only fallback included. */
export function emitDetectWinCombosRuntime(cfg = defaultConfig()) {
  const c = cfg; // already resolved by caller — no double-validation
  return `
  /* ── detectWinCombos — cluster-mode evaluator (emitted by winPresentation.mjs)
     For grids without paylines: bucket all non-scatter glyphs by symbol,
     wild substitutes across every bucket. Emits one event per bucket that
     reaches the 3-of-a-kind floor.
     maxEvents = ${c.maxEvents} (baked from GDD). */
  function detectWinCombos() {
    const cells = Array.from(grid.querySelectorAll(".cell, text"));
    if (cells.length < 3) return [];
    const reg = SYMBOL_REGISTRY || { regularPay: [], wild: null, scatter: null, tier: {} };
    const regularSet = new Set(reg.regularPay || []);
    const wildId  = reg.wild ? reg.wild.toUpperCase() : null;
    const scatId  = (reg.scatter ? reg.scatter : (FREESPINS.triggerSymbol || 'S')).toUpperCase();
    /* Per-symbol cell buckets, plus a dedicated wild bucket. */
    const buckets = new Map();
    const wildCells = [];
    cells.forEach(c => {
      const sym = (c.textContent || "").trim().toUpperCase();
      if (!sym) return;
      if (sym === scatId) return;                 /* scatter never participates */
      if (wildId && sym === wildId) { wildCells.push(c); return; }
      /* If registry is empty (no GDD symbol table), treat any non-scatter
         non-wild glyph as "regular" so the cycle still demos something. */
      if (regularSet.size === 0 || regularSet.has(sym)) {
        if (!buckets.has(sym)) buckets.set(sym, []);
        buckets.get(sym).push(c);
      }
    });
    /* Minimum line length — 3 OF A KIND is the universal slot floor.
       Wild count contributes toward reaching the threshold (wild is the
       universal substitute, so 2K + 1W counts as 3K). */
    const tierRank = { HP: 0, MP: 1, LP: 2, WILD: 3 };
    const MAX_EVENTS = ${c.maxEvents};
    const events = [];
    for (const [symbol, list] of buckets) {
      if (list.length + wildCells.length < 3) continue;
      const tier = (reg.tier && reg.tier[symbol]) || 'LP';
      /* Combo cells = the symbol's own cells + every wild cell (wild
         substitutes for THIS symbol on every line it could complete). */
      /* 2026-06-10 (Boki bug "nema win prezentacije") — emit payX so
         applyWinHighlight's totalAward > 0 gate fires. detectWinCombos
         is the legacy fallback for slots without explicit eval kind;
         without payX win presentation skipped these too. */
      const __comboCount = list.length + wildCells.length;
      const __tierMult = tier === 'HP' ? 1.0 : tier === 'MP' ? 0.5 : tier === 'WILD' ? 2.0 : 0.25;
      const __bet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
      const __payX = Math.min(50, __tierMult * __comboCount) * __bet;
      events.push({ symbol, tier, matchLength: __comboCount, payX: __payX, cells: list.concat(wildCells) });
    }
    /* Wild-only event: if there are >= 3 wild cells and NO matching
       regular hit yet, fire a standalone wild celebration so the wild
       presence still reads. (Rare but possible on wild-reel features.) */
    if (events.length === 0 && wildCells.length >= 3 && wildId) {
      const __wbet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
      events.push({ symbol: wildId, tier: 'WILD', matchLength: wildCells.length, payX: 2.0 * wildCells.length * __wbet, cells: wildCells.slice() });
    }
    events.sort((a, b) => {
      const ta = tierRank[a.tier] ?? 9;
      const tb = tierRank[b.tier] ?? 9;
      if (ta !== tb) return ta - tb;
      return b.cells.length - a.cells.length;  /* longer line first within a tier */
    });
    return events.slice(0, MAX_EVENTS);
  }
`;
}

/* Emit the runtime JS as a string. Config knobs are baked into the output
   as literals so the runtime doesn't need to know about the config object
   at all — keeps the browser bundle clean. */
export function emitWinPresentationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ winPresentation: cfg });
  /* perEventMs: 'auto' → adaptive (events.length <= 4 ? 500 : 400)
                 number → constant override
     Wave V5 — when mode === 'cascade-stagger', the cycle pace is the
     tighter `staggerStepMs` (default 80 ms) so wins read as a single
     fast cascade instead of one-by-one. Falls back to perEventMs when
     mode is per-line / cluster / all-at-once. */
  const perEventMsJS = c.mode === 'cascade-stagger'
    ? String(c.staggerStepMs)
    : (c.perEventMs === 'auto' ? `(events.length <= 4 ? 500 : 400)` : String(c.perEventMs));

  return `
  /* ── winPresentation BLOCK — emitted by src/blocks/winPresentation.mjs ─
     GDD-driven knobs (baked at build time):
       mode          = ${JSON.stringify(c.mode)}
       perEventMs    = ${JSON.stringify(c.perEventMs)}
       maxEvents     = ${c.maxEvents}
       noWinChance   = ${c.noWinChance}
       winCycle      = ${c.winCycle}
       staggerStepMs = ${c.staggerStepMs} (Wave V5 — used when mode='cascade-stagger')
     Token used to invalidate an in-flight cycle when a new spin starts —
     the next spin bumps the token, any pending cycle frame sees the
     mismatch and bails out without touching the DOM. */
  let WINSYM_CYCLE_TOKEN = 0;
  function cancelWinSymCycle() {
    WINSYM_CYCLE_TOKEN++;
    clearWinHighlight();
    clearPaylineOverlay();
  }
  /* Big-win symbol celebration — single coordinated pulse on ALL winning
     cells for BIG_WIN_CELEB_MS, then cleanup. Used in place of the
     per-line cycle when totalAward/bet crosses the bigWinTier threshold,
     matching the industry reference flow (symbol pulse → big-win banner,
     NOT line-cycle → big-win banner).
     Honors the same token + reduced-motion + FS-intro/outro guards as
     playWinSymCycle so a mid-presentation cancel propagates cleanly. */
  function playSymbolCelebration(events, durMs) {
    return new Promise(resolve => {
      if (!events || events.length === 0) { resolve(); return; }
      if (FSM && FSM.phase === 'FS_INTRO') { resolve(); return; }
      if (FSM && FSM.phase === 'FS_OUTRO') { resolve(); return; }
      const reduced = window.matchMedia &&
                      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const hold = reduced ? 200 : (durMs > 0 ? durMs : ${c.bigWinCelebMs});
      const token = ++WINSYM_CYCLE_TOKEN;
      grid.classList.add('is-winsym-cycling');
      /* Sync keyframe length with the hold window so the pulse doesn't
         finish ~300 ms before cleanup on a big-win celebration. */
      grid.style.setProperty('--winsym-pulse-ms', hold + 'ms');
      /* Highlight every distinct winning cell at once. UQ-MULTIPLIER-V11 —
         resolve cluster {r,c,idx} metadata to DOM via __resolveCellElement. */
      const __resDomSC = (typeof window !== 'undefined' && typeof window.__resolveCellElement === 'function')
        ? window.__resolveCellElement : null;
      const cellSet = new Set();
      for (const ev of events) {
        const cells = Array.isArray(ev && ev.cells) ? ev.cells : [];
        for (const c of cells) {
          let el = c;
          if (el && typeof el.classList === 'undefined' && __resDomSC) el = __resDomSC(c);
          if (el && el.classList) cellSet.add(el);
        }
      }
      for (const c of cellSet) c.classList.add('cell--winsym');
      setTimeout(() => {
        if (token !== WINSYM_CYCLE_TOKEN) { resolve(); return; }   /* cancelled */
        grid.querySelectorAll('.cell--winsym, text.cell--winsym')
          .forEach(c => c.classList.remove('cell--winsym'));
        grid.classList.remove('is-winsym-cycling');
        resolve();
      }, hold);
    });
  }
  /* Win-symbol cycle — cycles through detected win events one-by-one.
     Each event:
       • non-active cells dim (CSS .is-winsym-cycling base rule)
       • event cells get .cell--winsym → triggers winsym-pulse keyframes
       • after that event's stepMs, classes flip to the next event
     After all events: every class is cleared so the grid is fully
     undimmed (NEUTRAL) — ready for the next spin.
     Suppressed only during FS_INTRO / FS_OUTRO placards.
     Allowed inside FS_ACTIVE — Boki rule: win animations are available in FS too. */
  function playWinSymCycle(events, opts) {
    return new Promise(resolve => {
      if (FREESPINS.winCycle === false || ${c.winCycle ? 'false' : 'true'}) { resolve(); return; }
      if (!events || events.length === 0) { resolve(); return; }
      if (FSM && FSM.phase === 'FS_INTRO')  { resolve(); return; }
      if (FSM && FSM.phase === 'FS_OUTRO')  { resolve(); return; }
      const reduced = window.matchMedia &&
                      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const adaptive = ${perEventMsJS};
      const perEventMs = (opts && (opts.perEventMs || opts.perComboMs)) || adaptive;
      /* UQ-MULTIPLIER-V7 (2026-06-22) — forcedBaseline events (force MULT
         chip) get a minimum 1500ms cycle so the SKIP_ROLLUP CTA is visible
         long enough for the player to actually see and click it. With a
         single 500ms event the SKIP morph lasted ~480ms — perceived as
         "ne pokazuje se" by the player. Real detector wins keep their
         normal pace (adaptive 400/500ms). */
      var __hasForcedBaseline = false;
      for (var __fb = 0; __fb < events.length; __fb++) {
        if (events[__fb] && events[__fb].forcedBaseline === true) { __hasForcedBaseline = true; break; }
      }
      const stepMs  = reduced ? 200 :
                      (__hasForcedBaseline ? Math.max(perEventMs, 1500) : perEventMs);
      const token = ++WINSYM_CYCLE_TOKEN;
      /* UQ-MULTIPLIER-V7 (2026-06-22) — Boki bug "cells nestaju pa pojave":
         pre-mark FIRST event's win cells + draw polyline BEFORE adding the
         is-winsym-cycling class. Without this preorder, the 140ms opacity
         transition on .gridHost.is-winsym-cycling .cell catches every cell
         in a dim "blank" state for one paint frame before the playOne()
         synchronous call applies .cell--winsym. Browser composites that
         intermediate frame so player sees cells "nestaju". By pre-classing
         the win cells, when is-winsym-cycling is applied the CSS rule for
         .cell--winsym (opacity 1 !important) wins immediately on those cells
         while non-win cells dim. Win line is drawn instantly with no flash. */
      const ev0 = events[0];
      const cells0 = Array.isArray(ev0 && ev0.cells) ? ev0.cells : [];
      /* UQ-MULTIPLIER-V11 (2026-06-22) — cluster pays / ways / pay_anywhere
         detectors emit cells as {r, c, idx} metadata, not DOM elements.
         window.__resolveCellElement (canonical resolver wired by reelEngine)
         maps metadata → DOM. Without resolution, classList.add was a no-op
         in cluster mode → "cells nestaju" / no highlight. Resolve every
         cell before applying the visual class. paylineOverlay already
         uses this resolver internally so polyline is unaffected. */
      const __resolveDom = (typeof window !== 'undefined' && typeof window.__resolveCellElement === 'function')
        ? window.__resolveCellElement : null;
      for (const c of cells0) {
        let el = c;
        if (el && typeof el.classList === 'undefined' && __resolveDom) el = __resolveDom(c);
        if (el && el.classList) el.classList.add('cell--winsym');
      }
      if (typeof ev0.lineIndex === 'number') {
        drawPaylineOverlay(ev0);
      } else if (cells0.length >= 2) {
        drawPaylineOverlay(Object.assign({}, ev0, { lineIndex: 0, _virtualLine: true }));
      }
      grid.classList.add('is-winsym-cycling');
      /* Sync keyframe length with stepMs so cascade-stagger (80 ms) and
         GDD-overridden perEventMs read as one beat per cell instead of
         overlapping or leaving dead air against a fixed 500 ms keyframe. */
      grid.style.setProperty('--winsym-pulse-ms', stepMs + 'ms');
      /* V7 — start cycle at i=1 since event[0] is already rendered. The
         setTimeout fires after stepMs so the first event holds for one
         full step then transitions to the next (or clears if single). */
      let i = 1;
      const playOne = () => {
        if (token !== WINSYM_CYCLE_TOKEN) {
          /* H5.20 — Boki bug 05.06.2026: "kada rucno stopiram i skipujem
           * winove u FS, zabaguje i blokira FS blok". Root cause: this
           * function returned WITHOUT resolving the Promise on a skip,
           * so the await in handlePostSpin (the FS chain) blocked forever
           * → next FS spin never scheduled. Strip the cycle classes (the
           * skip handler already strips them but be defensive) and resolve
           * so the awaiting chain unblocks. */
          grid.classList.remove('is-winsym-cycling');
          resolve();
          return;
        }
        /* Strip previous event's markers. */
        grid.querySelectorAll('.cell--winsym, text.cell--winsym')
          .forEach(c => c.classList.remove('cell--winsym'));
        /* Drop the previous event's payline polyline before drawing the
           next one — keeps exactly ONE line visible per step. */
        clearPaylineOverlay();
        if (i >= events.length) {
          grid.classList.remove('is-winsym-cycling');
          resolve();
          return;
        }
        const ev = events[i];
        /* Wave T4 hardening — detectors can race tumble/reroll and emit events
           with stale (null/undefined) cell refs after gravity pass shifted
           symbols. Defensive filter prevents TypeError on classList.add.
           UQ-MULTIPLIER-V11 — resolve {r,c,idx} metadata to DOM (cluster mode). */
        const cells = Array.isArray(ev && ev.cells) ? ev.cells : [];
        const __resDom = (typeof window !== 'undefined' && typeof window.__resolveCellElement === 'function')
          ? window.__resolveCellElement : null;
        for (const c of cells) {
          let el = c;
          if (el && typeof el.classList === 'undefined' && __resDom) el = __resDom(c);
          if (el && el.classList) el.classList.add('cell--winsym');
        }
        /* 2026-06-18 — Boki rule (HNP backlog "Ne prikazuju mi se win
         * linije"): every win event MUST draw a visual line through its
         * matched cells. Line-pays events carry lineIndex and get the
         * canonical polyline + line-number badge. Cluster / pay_anywhere
         * / ways events have no lineIndex — we now synthesise a virtual
         * one so drawPaylineOverlay still walks the matched cells and
         * the player sees the win path instead of just per-cell pulses.
         * The virtual lineIndex is 'i' (the cycle step) so each event
         * gets its own labelled trail even in cluster grids. */
        if (typeof ev.lineIndex === 'number') {
          drawPaylineOverlay(ev);
        } else if (cells.length >= 2) {
          drawPaylineOverlay(Object.assign({}, ev, { lineIndex: i, _virtualLine: true }));
        }
        i++;
        setTimeout(playOne, stepMs);
      };
      /* V7 — first event is pre-rendered above. Schedule playOne after
         stepMs so event[0] holds for the same per-event window as the
         legacy single-call path. If events.length === 1 the next playOne
         will clear and resolve cleanly. */
      setTimeout(playOne, stepMs);
    });
  }
  /* detectLineWins — payline-based per-line event generation.
     Industry-standard slot evaluator (placeholder until math layer lands).
     For each line in PAYLINE_POOL:
       1. Walk the line LEFT→RIGHT, reading the symbol at each (reel, row)
       2. The first reel's symbol (or wild) determines the base symbol
       3. Count CONSECUTIVE matching cells from the left (wild = substitute)
       4. If matchLength >= 3 → emit one event for THIS line/symbol
     Output event shape: { lineIndex, symbol, tier, matchLength, cells[] }. */
  function detectLineWins() {
    if (!Array.isArray(PAYLINE_POOL) || PAYLINE_POOL.length === 0) return [];
    if (!RECT_REELS || RECT_REELS.length === 0) return [];
    const reg = SYMBOL_REGISTRY || { regularPay: [], wild: null, scatter: null, tier: {} };
    const wildId = reg.wild ? reg.wild.toUpperCase() : null;
    const scatId = (reg.scatter ? reg.scatter : (FREESPINS.triggerSymbol || 'S')).toUpperCase();
    const regularSet = new Set(reg.regularPay || []);
    const tierRank = { HP: 0, MP: 1, LP: 2, WILD: 3 };
    const MAX_EVENTS = ${c.maxEvents};

    /* Resolve (reel, row) → DOM cell with bounds-check. Returns null when
       the line passes through a clipped row (variable_reel diamond shape
       can have row indices that don't map to a visible cell on every reel). */
    function cellAt(reelIdx, rowIdx) {
      const reel = RECT_REELS[reelIdx];
      if (!reel) return null;
      const vis = reel.visibleRows || ROWS;
      if (rowIdx < 0 || rowIdx >= vis) return null;
      return reel.cells[1 + rowIdx] || null;
    }
    function symAtCell(cell) {
      return cell ? (cell.textContent || '').trim().toUpperCase() : '';
    }

    const events = [];
    for (let lineIdx = 0; lineIdx < PAYLINE_POOL.length; lineIdx++) {
      const line = PAYLINE_POOL[lineIdx];
      const pathCells = [];
      for (let r = 0; r < line.length && r < RECT_REELS.length; r++) {
        pathCells.push(cellAt(r, line[r]));
      }
      /* Skip lines that pass through clipped/invalid cells on the leftmost
         reel — can't evaluate without a base symbol. */
      if (!pathCells[0]) continue;

      /* Determine the base symbol: first non-wild reading on the line. If
         the line starts with a wild (or only wilds), the wild itself acts
         as the carrier (wild-line win). */
      let baseSym = symAtCell(pathCells[0]);
      if (wildId && baseSym === wildId) {
        for (let r = 1; r < pathCells.length; r++) {
          const s = symAtCell(pathCells[r]);
          if (s && s !== wildId) { baseSym = s; break; }
        }
      }
      if (!baseSym || baseSym === scatId) continue;
      /* Restrict to regularPay (or accept anything when registry empty). */
      if (regularSet.size > 0 && !regularSet.has(baseSym) && baseSym !== wildId) continue;

      /* Count consecutive matches from the left (wild substitutes). Stops
         at the first reel that holds neither baseSym nor wild, or at a
         clipped (null) cell. */
      let matchLength = 0;
      for (let r = 0; r < pathCells.length; r++) {
        const cell = pathCells[r];
        if (!cell) break;
        const s = symAtCell(cell);
        if (s === baseSym || (wildId && s === wildId)) matchLength++;
        else break;
      }

      /* Wave LEGO-FS3.1 (2026-06-19) — Win Both Ways activation:
       * when winBothWaysActivation.mjs has set the global flag (FS-only
       * mode), also count consecutive matches from the RIGHTMOST reel
       * inward. Take MAX(ltr, rtl) so the player gets credit for the
       * longer chain. Industry-standard "both ways" payline semantics. */
      if (typeof window !== 'undefined' && window.__WIN_BOTH_WAYS__ === true) {
        /* RTL anchor: re-derive baseSym from the rightmost non-wild cell
         * because a different baseSym may carry the right-to-left chain. */
        let rtlBaseSym = symAtCell(pathCells[pathCells.length - 1]);
        if (wildId && rtlBaseSym === wildId) {
          for (let r = pathCells.length - 2; r >= 0; r--) {
            const s = symAtCell(pathCells[r]);
            if (s && s !== wildId) { rtlBaseSym = s; break; }
          }
        }
        if (rtlBaseSym && rtlBaseSym !== scatId
            && (regularSet.size === 0 || regularSet.has(rtlBaseSym) || rtlBaseSym === wildId)) {
          let rtlMatchLength = 0;
          for (let r = pathCells.length - 1; r >= 0; r--) {
            const cell = pathCells[r];
            if (!cell) break;
            const s = symAtCell(cell);
            if (s === rtlBaseSym || (wildId && s === wildId)) rtlMatchLength++;
            else break;
          }
          if (rtlMatchLength > matchLength) {
            matchLength = rtlMatchLength;
            baseSym = rtlBaseSym;
          }
        }
      }

      if (matchLength < 3) continue;

      const tier = (reg.tier && reg.tier[baseSym]) || (baseSym === wildId ? 'WILD' : 'LP');
      /* Wave V5 — placeholder payX so spins actually pay out before the
       * PAR/math-engine integration phase lands. Industry-typical 3/4/5-OAK
       * multipliers per tier × current bet. Without this every line-win
       * event came back with payX undefined, totalAward stayed 0, and the
       * SKIP CTA + balance credit + history row all silently treated the
       * spin as a zero-paying outcome. Real math swaps this for PAR-table
       * lookups; the contract (event has a payX number) stays identical. */
      var _baseBet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
      var _tierPay = (tier === 'HP')   ? { 3:  5, 4:  25, 5: 100 }
                   : (tier === 'MP')   ? { 3:  2, 4:  10, 5:  30 }
                   : (tier === 'WILD') ? { 3: 10, 4:  50, 5: 250 }
                   :                     { 3:  1, 4:   3, 5:  10 };
      var _payMult = _tierPay[matchLength] || (_tierPay[5] * (matchLength - 5 + 1));
      events.push({
        lineIndex: lineIdx,
        symbol: baseSym,
        tier,
        matchLength,
        payX: _payMult * _baseBet,
        cells: pathCells.slice(0, matchLength),
      });
    }

    /* Sort: HP first, then MP, then LP, then WILD; within a tier the
       longer match goes first (5-of-a-kind reads before 3-of-a-kind). */
    events.sort((a, b) => {
      const ta = tierRank[a.tier] ?? 9;
      const tb = tierRank[b.tier] ?? 9;
      if (ta !== tb) return ta - tb;
      if (a.matchLength !== b.matchLength) return b.matchLength - a.matchLength;
      return a.lineIndex - b.lineIndex;
    });

    /* Dedupe by (symbol + cell signature). */
    const seen = new Set();
    const unique = [];
    for (const ev of events) {
      const key = ev.symbol + ':' + ev.cells.map(c => c && c.dataset && c.dataset.uid || ev.cells.indexOf(c)).join('|') + ':' + ev.matchLength;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ev);
    }
    return unique.slice(0, MAX_EVENTS);
  }

  /* ── applyWinHighlight — THE universal win-presentation orchestrator ──
     Pipeline (every BASE/FS spin that's not in INTRO/OUTRO placard):
       1. emit('onSpinResult')   — blocks annotate the settled grid
                                   (multiplierOrb adds chips, mystery
                                   reveals, sticky wilds glow, etc.)
       2. dispatch evaluator by GAME_EVAL_KIND OR fall back to the legacy
          PAYLINE_POOL heuristic:
             'line'          → detectLineWins
             'cluster'       → detectClusterWins → detectWinCombos fallback
             'ways'          → detectWaysWins → detectLineWins fallback
             'pay_anywhere'  → detectPayAnywhereWins → detectWinCombos fallback
       3. if tumble enabled → runTumbleChain(detect, onStep) loops; each
          step emits onTumbleStep so blocks can mutate HookBus.getMult()
          (multiplierOrb accumulates, persistentMultiplier escalates, etc.)
       4. else → single onTumbleStep emit with the detected events
       5. apply HookBus.getMult() to every event.payX
       6. playWinSymCycle (visual cycle)
       7. emit('postSpin')       — round-control blocks (winCap, respin,
                                   bonusPick triggers) act here
     Returns Promise so FSM_runNextFsSpin and runOneBaseSpin can chain. */
  function _pickDetector() {
    const kind = (typeof GAME_EVAL_KIND === 'string' && GAME_EVAL_KIND) || 'line';
    /* explicit GDD-declared topology.evaluation → preferred eval */
    if (kind === 'pay_anywhere' && typeof detectPayAnywhereWins === 'function') return detectPayAnywhereWins;
    if (kind === 'cluster' && typeof detectClusterWins === 'function') return detectClusterWins;
    if (kind === 'ways' && typeof detectWaysWins === 'function') return detectWaysWins;
    if (kind === 'line' && typeof detectLineWins === 'function') return detectLineWins;
    /* legacy fallback — payline pool present? line mode. else cluster. */
    const hasPaylines = Array.isArray(PAYLINE_POOL) && PAYLINE_POOL.length > 0
                       && RECT_REELS && RECT_REELS.length > 0;
    if (hasPaylines && typeof detectLineWins === 'function') return detectLineWins;
    if (typeof detectWinCombos === 'function') return detectWinCombos;
    return () => [];
  }

  function _applyMultToEvents(events) {
    if (!events || !events.length) return events;
    if (typeof HookBus === 'undefined') return events;
    const m = HookBus.getMult();
    if (!Number.isFinite(m) || m === 1) return events;
    for (const ev of events) {
      if (Number.isFinite(ev.payX)) ev.payX = ev.payX * m;
      ev.appliedMultX = m;
    }
    return events;
  }

  /* Wave S refactor: winPresentation no longer emits onSpinResult or postSpin.
     reelEngine owns onSpinResult (it knows when reels settle); postSpin block
     owns postSpin (it owns round-close orchestration). tumble owns onTumbleStep
     (it knows when each cascade step lands). winPresentation just presents.

     Returns Promise<events[]> so the postSpin orchestrator can read what was
     detected and emit postSpin with the right payload. */
  /* D-11 FIX (2026-06-20, Boki "Win prezentacije se javlajaju dok se
     okrecu rilovi, big win takodje"): hard gate before every
     onWinPresentationStart and onBigWinTierEntered emit. Waits until
     no .reelCol.is-spinning remains in the DOM (canonical "reels stopped"
     proxy set/cleared by reelEngine.mjs). Max 2000ms timeout — beyond
     that we fall through to keep the round moving so a stuck reel
     doesn't lock the entire game. The wait is rAF-paced for cheap
     idle polling without burning the main thread. */
  async function __waitReelsIdle(maxMs) {
    var deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + (maxMs || 2000);
    return new Promise(function (resolve) {
      function tick() {
        var stillSpinning = 0;
        try {
          stillSpinning = document.querySelectorAll('.reelCol.is-spinning').length;
        } catch (_) {}
        if (stillSpinning === 0) { resolve(true); return; }
        var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        if (now >= deadline) { resolve(false); return; }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
        else setTimeout(tick, 16);
      }
      tick();
    });
  }

  /* UQ-MULTIPLIER-V9 (2026-06-22) — sample REAL DOM cells iz SVAKOG reel-a
     u srednjem redu (CEO horizontalno). Industry "Line 1" prikazuje pravu
     full-length pay-line preko CELOG grida, ne samo 3 cells. Boki:
     "win linije su van okvira i ne artikulisane". Razlog je sto pre V9 smo
     uzimali samo prvih 3 reels — polyline staje na pola grida (van okvira
     gleda u stilu "ne pokriva ceo okvir").
     V9: nReels = SVE reels (5 / 6 / 7 za rectangular, mega, cluster etc).
     Triple fallback: RECT_REELS → grid querySelector po row 1 (top vis row)
     → bilo koji srednji red cells. Tako forced baseline UVEK ima cells. */
  function __forceSampleBaselineCells() {
    var picked = [];
    try {
      if (typeof RECT_REELS !== 'undefined' && Array.isArray(RECT_REELS) && RECT_REELS.length > 0) {
        /* V9 — uzmi sve reels, ne samo 3, da polyline pokriva CEO grid. */
        for (var r = 0; r < RECT_REELS.length; r++) {
          var reel = RECT_REELS[r];
          if (!reel || !Array.isArray(reel.cells)) continue;
          var vis = reel.visibleRows || (typeof ROWS !== 'undefined' ? ROWS : 3);
          var midRow = Math.floor(vis / 2);
          /* reel.cells layout: index 0 = above-buffer, 1..visibleRows = visible */
          var cell = reel.cells[1 + midRow] || reel.cells[1];
          if (cell && cell.classList) picked.push(cell);
        }
      }
      /* V9 fallback A: ako RECT_REELS prazan ili daje < 2 cells, koristi
         document.querySelector na grid → uzmi srednji red iz prvih reels. */
      if (picked.length < 2 && typeof grid !== 'undefined' && grid && grid.querySelectorAll) {
        /* Pokušaj prepoznati grid topologiju: data-reel + data-row atributi
           ako su prisutni (industry-standard); inače flat slice. */
        var midCells = grid.querySelectorAll('[data-row="1"] .cell, .cell[data-row="1"]');
        if (midCells.length >= 2) {
          for (var mi = 0; mi < midCells.length; mi++) {
            if (midCells[mi] && midCells[mi].classList) picked.push(midCells[mi]);
          }
        } else {
          /* Last-resort flat fallback — prvih 5 .cell nodes (jedan red od 5x3). */
          var nodes = grid.querySelectorAll('.cell');
          var nFb = Math.min(5, nodes.length);
          for (var i = 0; i < nFb; i++) {
            if (nodes[i] && nodes[i].classList && picked.indexOf(nodes[i]) === -1) picked.push(nodes[i]);
          }
        }
      }
      /* UQ-MULTIPLIER-V11 (2026-06-22) — Boki bug "na nekim igrama nestaju
         celije": cluster pays / mega-cluster / megaways igre nemaju RECT_REELS
         u rectangular formi i nemaju [data-row="1"] attr ni klasične .cell
         classes — koriste SVG rect ili druge custom renderere (text nodes,
         text.cell pattern). Posle 338-GDD cross-corpus probe, 5 igara je
         padalo zbog ovog gap-a. Ultimate fallback C: uzmi BILO koji
         .cell ili text.cell ili text[data-cell] node u document-u (ne samo
         pod #gridHost — neki renderers stavljaju ćelije pod .reelsHost,
         .svgGrid, .clusterHost). Garantuje da forcedBaseline UVEK ima ≥ 2
         cells preko bilo kog grid renderera. */
      if (picked.length < 2) {
        var anyNodes = (typeof document !== 'undefined' && document.querySelectorAll)
          ? document.querySelectorAll('.cell, text.cell, [data-cell], .cell-cluster, .clusterCell, .megaCell')
          : [];
        var maxPick = Math.min(5, anyNodes.length);
        for (var ai = 0; ai < anyNodes.length && picked.length < maxPick; ai++) {
          var n = anyNodes[ai];
          if (!n || !n.classList) continue;
          if (picked.indexOf(n) !== -1) continue;
          /* Skip buffer cells (clipped strip cells above/below visible row).
             Visible cell heuristic: bounding rect width >= 40 px. */
          if (typeof n.getBoundingClientRect === 'function') {
            var rect = n.getBoundingClientRect();
            if (rect && (rect.width < 40 || rect.height < 40)) continue;
          }
          picked.push(n);
        }
      }
    } catch (_) { /* defensive — fallback to [] degrades to no-visual but still pays */ }
    return picked;
  }

  async function applyWinHighlight() {
    clearWinHighlight();
    /* Wave V5 — publish award=0 defensively so subscribers never read a
       stale value from the previous round. Per Boki rule: every spin
       MUST clear the award before the next one (no leakage between
       spins). */
    if (typeof window !== 'undefined') {
      window.__WIN_AWARD__ = 0;
    }
    /* Suppressed only during FS_INTRO / FS_OUTRO placards. */
    if (FSM && (FSM.phase === 'FS_INTRO' || FSM.phase === 'FS_OUTRO')) {
      return [];
    }
    const duringFs = !!(FSM && FSM.phase === 'FS_ACTIVE');

    /* Wave H5 — early short-circuit for the BW force-big-win path. Per
     * rule_force_buttons_real_spin (Boki 05.06.2026), the BW dev button
     * sets window.__FORCE_BIG_WIN_TIER__ before runOneBaseSpin(). We must
     * consume the flag BEFORE the noWinChance dice roll below — otherwise
     * a 30% miss would swallow the forced spin and the QA cycle would
     * stall. Synthesize a single pay event over the tier threshold and
     * skip detection entirely. */
    if (typeof window !== 'undefined' && Number.isFinite(window.__FORCE_BIG_WIN_TIER__) && window.__FORCE_BIG_WIN_TIER__ >= 1 && window.__FORCE_BIG_WIN_TIER__ <= 5) {
      const bwSt = window.BIG_WIN_TIER_STATE;
      const thresholds = (bwSt && Array.isArray(bwSt.thresholds)) ? bwSt.thresholds : [10, 25, 50, 200, 1000];
      const forcedTier = window.__FORCE_BIG_WIN_TIER__;
      const bet = (Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
      const forcedAward = thresholds[forcedTier - 1] * 1.5 * bet;
      /* Boki rule 05.06.2026: "Isto napravi za force Big Win da se vidi
       * animacija simbola pre nego sto pocne big win." A real big-win
       * picks winning cells from detected lines; the BW force short-
       * circuits detection so we have to synthesise the visual targets
       * ourselves. Sample up to 8 grid cells across the reels (matches
       * the industry SYMBOL_CELEBRATION density on a 5x3 grid) so the
       * 800 ms pulse is actually visible to the player instead of a
       * silent 800 ms dead window. We DON'T touch payline overlays —
       * the synth event has no lineIndex so playSymbolCelebration's
       * cell-pulse path is the only visual side-effect, keeping the
       * BW force vendor-neutral and free of fake math. */
      const FORCE_CELL_COUNT = 8;
      const forceCells = [];
      try {
        const allCells = (typeof grid !== 'undefined' && grid && grid.querySelectorAll)
          ? Array.from(grid.querySelectorAll('.cell'))
          : (document.querySelectorAll && Array.from(document.querySelectorAll('.gridHost .cell, #gridHost .cell, .reelsHost .cell')));
        if (allCells && allCells.length > 0) {
          /* Deterministic pick (every 2nd cell from a shuffled-ish slice)
           * so the visual reads as a coordinated burst, not a random splatter. */
          const stride = Math.max(1, Math.floor(allCells.length / FORCE_CELL_COUNT));
          for (let i = 0; i < allCells.length && forceCells.length < FORCE_CELL_COUNT; i += stride) {
            if (allCells[i]) forceCells.push(allCells[i]);
          }
        }
      } catch (_) { /* defensive — pulse degrades to no-op if grid not queryable */ }
      const synth = [{
        symbol: 'FORCE', tier: 'WILD', matchLength: 5,
        payX: forcedAward, cells: forceCells, forcedBigWinTier: forcedTier,
      }];
      if (typeof runTumbleChain === 'function') {
        /* 2026-06-09 — Boki bug fix: detector returned the SAME synth array
         * on every chain iteration, so runTumbleChain looped forever
         * (TUMBLE_MAX_CHAIN times × ~1s per chain). The BW force is a
         * SINGLE-STEP visual — emit synth once, then return empty so the
         * chain breaks cleanly and the banner enters within ~1s instead
         * of ~10s. */
        let __synthFired = false;
        await runTumbleChain(() => { if (__synthFired) return []; __synthFired = true; return synth; }, { duringFs });
      }
      window.__WIN_AWARD__ = forcedAward;
      window.__FORCE_BIG_WIN_TIER__ = null;       /* one-shot reset */
      window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      /* BW force is by definition a big-win path — emit isBigWin:true and
       * use the symbol-celebration pulse, matching the reference flow
       * (SYMBOL_CELEBRATION → BIG_WIN). With synthesised forceCells the
       * 800 ms pulse is now VISIBLE on screen prior to the tier banner. */
      await __waitReelsIdle(2000);  /* D-11 gate */
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onWinPresentationStart', { award: forcedAward, eventCount: 1, isBigWin: true });
      }
      await playSymbolCelebration(synth, ${c.bigWinCelebMs});
      window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onWinPresentationEnd', { award: forcedAward, isBigWin: true });
      }
      return synth;
    }

    /* Visual variance — ${(c.noWinChance * 100).toFixed(0)}% of spins forced to no-win.
       Ask tumble for a 0-events tick so listeners (orb accumulate, persistent
       mult escalate-on-loss) react identically to a real lossy spin. tumble
       always exists — even disabled (single-spin slots) its stub emits the
       onTumbleStep event.
       UQ-MULTIPLIER-V3 (Boki 2026-06-22): kad force chip postavi
       __FORCE_BASELINE_WIN__, BYPASS noWinChance dice — Boki force klik MORA
       da uvek produkuje vidljiv win pa primeni multiplier. Bez ovog gate-a,
       30% force-klika je padalo na noWinChance return [] pre nego što stigne
       baseline injection. */
    if (Math.random() < ${c.noWinChance}
        && !(typeof window !== 'undefined' && window.__FORCE_BASELINE_WIN__ === true)) {
      if (typeof runTumbleChain === 'function') {
        await runTumbleChain(() => [], { duringFs });
      }
      return [];
    }

    const detect = _pickDetector();
    const tumbleEnabled = typeof runTumbleChain === 'function'
                          && typeof TUMBLE_MAX_CHAIN !== 'undefined';

    let allEvents = [];

    if (tumbleEnabled) {
      /* tumble block emits onTumbleStep internally now (Wave S). We just wrap
         the detector to fold HookBus.getMult into payX so escalating mults
         (orb accumulation, persistent mult, lightning) actually pay out. */
      const wrappedDetect = () => {
        let events = detect() || [];
        /* UQ-MULTIPLIER-V2 (2026-06-22): __FORCE_BASELINE_WIN__ guarantees
           mali deterministic win (3x bet) ispod BWT threshold first slot = 10x. Mult
           chip onda primeni x N na taj baseline kroz _applyMultToEvents.
           UQ-MULTIPLIER-V6 (2026-06-22): synth event MORA imati realne DOM
           cells iz prva 3 reel-a (lineIndex=0, srednji red) — bez toga
           dim-rule prebriše sve ćelije a highlight ne pogađa nijednu (player
           vidi kao da ćelije nestaju iz frame-a). Plus payline overlay
           zahteva najmanje 2 cells da nacrta liniju. */
        if (events.length === 0 && typeof window !== 'undefined'
            && window.__FORCE_BASELINE_WIN__ === true) {
          const bet = (Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
          const __forceCells = __forceSampleBaselineCells();
          events = [{ symbol: 'FORCE-BASE', tier: 'LP', matchLength: __forceCells.length || 3,
                       payX: 3 * bet, cells: __forceCells, lineIndex: 0, forcedBaseline: true }];
          window.__FORCE_BASELINE_WIN__ = null;
        }
        _applyMultToEvents(events);
        return events;
      };
      const result = await runTumbleChain(wrappedDetect, { duringFs });
      allEvents = (result && result.events) || [];
    } else {
      /* No cascade slot — single detection. tumble's disabled stub still emits
         onTumbleStep so listeners (orb/persistent mult) react identically. */
      let events = detect() || [];
      /* UQ-MULTIPLIER-V2 (2026-06-22): baseline win injection for force chip.
         UQ-MULTIPLIER-V6 (2026-06-22): isti realni-cells fix kao gore. */
      if (events.length === 0 && typeof window !== 'undefined'
          && window.__FORCE_BASELINE_WIN__ === true) {
        const bet = (Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
        const __forceCells = __forceSampleBaselineCells();
        events = [{ symbol: 'FORCE-BASE', tier: 'LP', matchLength: __forceCells.length || 3,
                     payX: 3 * bet, cells: __forceCells, lineIndex: 0, forcedBaseline: true }];
        window.__FORCE_BASELINE_WIN__ = null;
      }
      _applyMultToEvents(events);
      if (typeof runTumbleChain === 'function') {
        await runTumbleChain(() => events, { duringFs });
      }
      allEvents = events;
    }

    /* Wave V5 — publish award + presentation-active signals BEFORE the
       visual cycle so every downstream block can branch correctly while
       the rollup is still on screen:
         • balanceHud  reads window.__WIN_AWARD__ on onSpinResult to set
                       lastWin (then credits balance on postSpin).
         • spinControl morphs CTA to SKIP_ROLLUP on onWinPresentationStart
                       so the player can fast-finalize the cycle.
         • autoplay    checks lastWin against stopOnWinAbove on postSpin.
         • historyLog  records the row's win amount.
         • gambleSecondary seeds the bank with the available win.

       Without these, 5 blocks read undefined and silently behave as if
       every spin paid 0 — including balance-credit (which is why a 20-spin
       walk on rectangular dist showed balance going down by bet × N every
       time regardless of detected wins). */
    var totalAward = 0;
    for (var i = 0; i < allEvents.length; i++) {
      var p = allEvents[i] ? allEvents[i].payX : 0;
      if (Number.isFinite(p) && p > 0) totalAward += p;
    }
    if (typeof window !== 'undefined') {
      window.__WIN_AWARD__ = totalAward;
    }

    /* Visual cycle — only fire the SKIP_ROLLUP presentation window when
       the round actually paid something. Boki bug 05.06.2026: gating on
       allEvents.length > 0 made the cycle (and the SKIP CTA morph in
       spinControl) appear on any spin where the detector found candidate
       lines but every payX was 0/undefined — common during a rapid
       click race where stale events from the prior round leak in, or
       when the placeholder math returns shape events without payouts.
       Gate on totalAward > 0 so the SKIP CTA only appears when there is
       a real rollup to fast-finalize. */
    /* Wave LDW — Losses Disguised as Wins gate. Suppress celebration FX
     * when net delta (totalAward - currentBet) ≤ 0. Player still gets
     * the credit via balanceHud, just no fake win UX. Per Dixon 2010 +
     * UKGC RTS 7C + AGCO 4.07 + UKGC 17-Jan-2025. */
    var __ldwBet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
      ? window.__SLOT_BET__ : 1;
    /* UQ-MULTIPLIER-V6 (2026-06-22) — detect forcedBaseline event so both
       LDW suppression and BWT routing can bypass it. Force MULT chip must
       always show per-line cycle even if baseline 3× bet ≤ current bet. */
    var __forcedBaseline = false;
    for (var __fbi0 = 0; __fbi0 < allEvents.length; __fbi0++) {
      if (allEvents[__fbi0] && allEvents[__fbi0].forcedBaseline === true) { __forcedBaseline = true; break; }
    }
    var __ldwSuppress = ${c.suppressLDW} && (totalAward > 0) && (totalAward <= __ldwBet) && !__forcedBaseline;
    if (typeof window !== 'undefined') {
      window.__LDW_SUPPRESSED__ = !!__ldwSuppress;
    }
    if (__ldwSuppress && typeof HookBus !== 'undefined') {
      try { HookBus.emit('onLdwSuppressed', { award: totalAward, bet: __ldwBet }); } catch (_) {}
    }

    if (totalAward > 0 && !__ldwSuppress) {
      /* Boki rule 05.06.2026 — big-win path skips the per-line cycle and
       * goes straight to a coordinated symbol-celebration pulse, then
       * cedes the screen to bigWinTier. Reference flow:
       *   small/medium win:  WIN_PRESHOW → per-line TOTAL_ROLLUP
       *   big win:           SYMBOL_CELEBRATION (single pulse) → BIG_WIN
       * Threshold + enabled state come from BIG_WIN_TIER_STATE; if the
       * block isn't wired (disabled or absent) we fall through to the
       * regular per-line cycle so the slot still presents wins. */
      var __bet = __ldwBet;
      var __bwState = (typeof window !== 'undefined') ? window.BIG_WIN_TIER_STATE : null;
      var __bwThreshold = (__bwState && Array.isArray(__bwState.thresholds) && __bwState.thresholds[0] > 0)
        ? __bwState.thresholds[0] : Infinity;
      var __bwEnabled  = !!(__bwState && __bwState.enabled);
      /* UQ-MULTIPLIER-V6 (2026-06-22) — force MULT chip never routes to
         playSymbolCelebration (no payline). __forcedBaseline detected above
         next to LDW gate so a single sweep covers both bypasses. */
      var __isBigWin   = __bwEnabled && (totalAward / __bet) >= __bwThreshold && !__forcedBaseline;

      if (typeof window !== 'undefined') {
        window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      }
      await __waitReelsIdle(2000);  /* D-11 gate */
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onWinPresentationStart', {
          award: totalAward,
          eventCount: allEvents.length,
          isBigWin: __isBigWin,
        });
      }
      if (__isBigWin) {
        await playSymbolCelebration(allEvents, ${c.bigWinCelebMs});
      } else {
        await playWinSymCycle(allEvents);
      }
      if (typeof window !== 'undefined') {
        window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      }
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onWinPresentationEnd', {
          award: totalAward,
          isBigWin: __isBigWin,
        });
      }
    }

    return allEvents;
  }

  /* presentExternalWin(award) — public post-FS / post-bonus win presenter.
   * Boki rule 05.06.2026: "kad se vratim iz FS bonusa, treba da bude ako
   * postoji uslov za big win, onda mora big win da se pokaze, ako postoji
   * uslov za bilo koji win onda mora da se pokaze, dakle isto win
   * animacija counter itd."
   *
   * The FS outro placard publishes the aggregated FS total. Once the
   * placard closes (CTA click or fsOutro skip), the round MUST run the
   * same presentation chain as a base-game win:
   *   • big-win path  → symbol pulse → bigWinTier compound walkthrough
   *   • regular win   → winRollup counter ramps to award, banner stays
   *                     until next preSpin clears
   *
   * This helper synthesises that flow off-grid (FS doesn't produce real
   * line events). It picks up to 8 visible grid cells for the symbol
   * celebration (matches H5.14 BW-force convention) so the big-win pulse
   * is visible; for regular wins it emits Start/End immediately so the
   * winRollup counter starts ticking with the FS aggregate amount. */
  async function presentExternalWin(award) {
    const amt = Number(award);
    if (!(amt > 0)) return;
    if (typeof window === 'undefined') return;

    /* Wave H5.16 — let downstream listeners read the correct amount BEFORE
     * Start emits (winRollup peeks at __WIN_AWARD__ as a fallback). */
    window.__WIN_AWARD__ = amt;

    const bet      = (Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
      ? window.__SLOT_BET__ : 1;

    /* W50 — LDW gate on FS / post-bonus aggregate presentation. The base
     * spin gate (totalAward ≤ currentBet → suppress) is structurally
     * unsuitable for FS because the FS spin itself has bet=0, but the
     * FS ENTRY consumed a real base-game stake. For player-protection
     * symmetry we apply the same gate here using the BASE bet as
     * reference: if the FS aggregate amount ≤ the base bet that triggered
     * FS, the round is mathematically a wash and we must NOT play the
     * "you won" celebration. Per Dixon 2010 + UKGC RTS 7C + AGCO 4.07 +
     * UKGC 17-Jan-2025 false-win prohibition. */
    const ldwSuppress = ${c.suppressLDW} && (amt > 0) && (amt <= bet);
    window.__LDW_SUPPRESSED__ = !!ldwSuppress;
    if (ldwSuppress && typeof HookBus !== 'undefined') {
      try { HookBus.emit('onLdwSuppressed', { award: amt, bet: bet, source: 'post-fs' }); } catch (_) {}
      return;
    }

    const bwState  = window.BIG_WIN_TIER_STATE || null;
    const bwTrig   = (bwState && Array.isArray(bwState.thresholds) && bwState.thresholds[0] > 0)
      ? bwState.thresholds[0] : Infinity;
    const isBigWin = !!(bwState && bwState.enabled && (amt / bet) >= bwTrig);

    /* For big-win: synth grid cells (mirrors H5.14 BW-force) so the
     * 800ms symbol pulse is actually visible. */
    const synth = [];
    if (isBigWin) {
      const FORCE_CELL_COUNT = 8;
      const forceCells = [];
      try {
        const allCells = (typeof grid !== 'undefined' && grid && grid.querySelectorAll)
          ? Array.from(grid.querySelectorAll('.cell'))
          : (document.querySelectorAll && Array.from(document.querySelectorAll('.gridHost .cell, #gridHost .cell, .reelsHost .cell')));
        if (allCells && allCells.length > 0) {
          const stride = Math.max(1, Math.floor(allCells.length / FORCE_CELL_COUNT));
          for (let i = 0; i < allCells.length && forceCells.length < FORCE_CELL_COUNT; i += stride) {
            if (allCells[i]) forceCells.push(allCells[i]);
          }
        }
      } catch (_) { /* defensive — pulse degrades to no-op */ }
      synth.push({ symbol: 'POST_FS', tier: 'WILD', matchLength: 5, payX: amt, cells: forceCells });
    }

    window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
    await __waitReelsIdle(2000);  /* D-11 gate */
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('onWinPresentationStart', {
        award: amt,
        eventCount: isBigWin ? 1 : 0,
        isBigWin: isBigWin,
        source: 'post-fs',
      });
    }

    if (isBigWin) {
      await playSymbolCelebration(synth, ${c.bigWinCelebMs});
    } else {
      /* Regular win — no on-reel cycle (FS aggregate has no line events
       * to walk). winRollup ramps the counter from its Start listener,
       * which already fired above. Hold here briefly (single-frame
       * resolution) so the End emit sequences naturally. */
      await new Promise(r => setTimeout(r, 50));
    }

    window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('onWinPresentationEnd', {
        award: amt,
        isBigWin: isBigWin,
        source: 'post-fs',
      });
    }
  }

  /* Wave S LEGO conformance — winPresentation registers a LOW-priority (-10)
     onSpinResult listener that clears any in-flight win cycle the moment
     reels settle. Annotators (multiplierOrb, mystery, sticky/walking wild,
     wildReel, lightning, superSymbol) all run at priority 0 or higher, so
     they execute first; then this cleanup fires last to prep the grid for
     the new presentation cycle the postSpin orchestrator triggers via
     applyWinHighlight(). */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('onSpinResult', () => {
      cancelWinSymCycle();
    }, { priority: -10 });
    /* Also clear on preSpin so any retrigger / static-reroll path that
       short-circuits before settle still wipes the previous cycle visuals. */
    HookBus.on('preSpin', () => {
      cancelWinSymCycle();
      /* W50 — Reset the per-round LDW suppression flag at the START of the
         next spin so a stale "true" from the previous round doesn't bleed
         forward and accidentally mute the next spin's celebration. The
         flag is per-round contract: set by winPresentation runtime when
         this round triggers suppression, cleared at preSpin. */
      if (typeof window !== 'undefined') {
        window.__LDW_SUPPRESSED__ = false;
      }
      /* 2026-06-10 — defense-in-depth: cancelWinSymCycle bumps the
         token but the visual class may linger across a race condition
         (e.g. rapid click on TURBO while a celebration is mid-flight).
         Hard-clear the dim-base + winsym marks so the next BASE spin
         starts with FULLY visible cells, not dim-ovane "nestale" cells. */
      try {
        if (typeof grid !== 'undefined' && grid && grid.classList) {
          grid.classList.remove('is-winsym-cycling');
        }
        if (typeof grid !== 'undefined' && grid && grid.querySelectorAll) {
          grid.querySelectorAll('.cell--winsym, text.cell--winsym')
            .forEach(c => c.classList.remove('cell--winsym'));
        }
        /* 2026-06-16 (Boki bug v4): "treba da se pokazuje dobitak tek
         * kada padne celija na ril, ne kada pritisnem spin dugme i odmah
         * da se pokaze simbol". The PREVIOUS spin's .is-win class lingers
         * on cells that contain the winning symbols; as the strip rotates,
         * those highlighted cells DOM nodes travel with the rotation,
         * making the spin LOOK like wins are already lit. clearWinHighlight
         * (orchestrator-scope helper) strips .is-win + .has-winselection +
         * payline overlay in one shot. */
        if (typeof clearWinHighlight === 'function') {
          clearWinHighlight();
        }
      } catch (_) {}
    }, { priority: -10 });

    /* Wave V6 — react to force-skip during rollup/celebration. Same exit
       mechanism as cancelWinSymCycle (token bump → next playOne() step
       short-circuits). We're the rollup owner for the 'rollup' phase so
       we are also responsible for the matching onSkipComplete emit. */
    HookBus.on('onSkipRequested', (payload) => {
      if (!payload || (payload.phase !== 'rollup' && payload.phase !== 'celebration')) return;
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      cancelWinSymCycle();
      /* Clean up any dangling polylines / winsym marks so the final state
         is visually settled. */
      if (typeof grid !== 'undefined' && grid && grid.querySelectorAll) {
        grid.querySelectorAll('.cell--winsym, text.cell--winsym')
          .forEach(c => c.classList.remove('cell--winsym'));
        if (typeof clearPaylineOverlay === 'function') clearPaylineOverlay();
      }
      const duration = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      HookBus.emit('onSkipComplete', { phase: payload.phase, duration });
    });
  }

  /* Expose applyWinHighlight on window so headless QA tools can poke it
     directly without going through the full spin lifecycle. */
  if (typeof window !== 'undefined') {
    window.applyWinHighlight  = applyWinHighlight;
    window.cancelWinSymCycle  = cancelWinSymCycle;
    /* H5.16 public entry for post-FS / post-bonus presentation. freeSpins
     * calls this on FSM_enterBase when the FS aggregate qualifies. */
    window.presentExternalWin = presentExternalWin;
  }
`;
}
