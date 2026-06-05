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
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

/* Merge defaults with model.winPresentation, accepting only known keys with
   the correct shape — defends against malformed GDD overrides. */
export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.winPresentation) || {};

  if (src.mode === 'per-line' || src.mode === 'cluster' || src.mode === 'all-at-once') {
    cfg.mode = src.mode;
  }
  if (src.perEventMs === 'auto' || (typeof src.perEventMs === 'number' && src.perEventMs > 0)) {
    cfg.perEventMs = src.perEventMs;
  }
  if (typeof src.maxEvents === 'number' && src.maxEvents > 0 && src.maxEvents <= 50) {
    cfg.maxEvents = Math.floor(src.maxEvents);
  }
  if (typeof src.noWinChance === 'number' && src.noWinChance >= 0 && src.noWinChance <= 1) {
    cfg.noWinChance = src.noWinChance;
  }
  if (src.winCycle === false) cfg.winCycle = false;
  if (typeof src.bigWinCelebMs === 'number' && src.bigWinCelebMs >= 100 && src.bigWinCelebMs <= 5000) {
    cfg.bigWinCelebMs = Math.floor(src.bigWinCelebMs);
  }

  return cfg;
}

/* Wave T-slim — extract of win-highlight + win-symbol-cycle CSS from
 * buildSlotHTML.mjs orchestrator (originally inline, ~95 LOC). Kept as
 * an enabled-always block because every grid kind uses these selectors;
 * disabling would break the no-trigger win presentation cycle. */
export function emitWinPresentationCSS(/* cfg = defaultConfig() */) {
  return `
  /* ── Placeholder win highlight — emitted by src/blocks/winPresentation.mjs
     Visual-only: winning cells stay full opacity + nudge scale, non-winning
     cells dim to ~35%. No keyframes, no glow — just enough to read the
     combo at a glance. Real win-evaluator (matched line / cluster) lands
     with the math layer. Scoped to .gridHost so it works for both flat
     grids and nested SVG/text grids. */
  .gridHost.has-winselection .cell,
  .gridHost.has-winselection text         { opacity: 0.32; transition: opacity 180ms ease, transform 180ms ease; }
  .gridHost.has-winselection .cell.is-win,
  .gridHost.has-winselection text.is-win  { opacity: 1;     transform: scale(1.06); }
  @media (prefers-reduced-motion: reduce) {
    .gridHost.has-winselection .cell,
    .gridHost.has-winselection text,
    .gridHost.has-winselection .cell.is-win,
    .gridHost.has-winselection text.is-win { transition: none; transform: none; }
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
    opacity: 0.30;
    transition: opacity 140ms ease;
  }
  .gridHost.is-winsym-cycling .cell--winsym,
  .gridHost.is-winsym-cycling text.cell--winsym {
    opacity: 1 !important;
    animation: winsym-pulse 500ms ease-in-out 1;
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
  const c = resolveConfig({ winPresentation: cfg });
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
      events.push({ symbol, tier, cells: list.concat(wildCells) });
    }
    /* Wild-only event: if there are >= 3 wild cells and NO matching
       regular hit yet, fire a standalone wild celebration so the wild
       presence still reads. (Rare but possible on wild-reel features.) */
    if (events.length === 0 && wildCells.length >= 3 && wildId) {
      events.push({ symbol: wildId, tier: 'WILD', cells: wildCells.slice() });
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
                 number → constant override */
  const perEventMsJS = c.perEventMs === 'auto'
    ? `(events.length <= 4 ? 500 : 400)`
    : String(c.perEventMs);

  return `
  /* ── winPresentation BLOCK — emitted by src/blocks/winPresentation.mjs ─
     GDD-driven knobs (baked at build time):
       mode         = ${JSON.stringify(c.mode)}
       perEventMs   = ${JSON.stringify(c.perEventMs)}
       maxEvents    = ${c.maxEvents}
       noWinChance  = ${c.noWinChance}
       winCycle     = ${c.winCycle}
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
      /* Highlight every distinct winning cell at once. */
      const cellSet = new Set();
      for (const ev of events) {
        const cells = Array.isArray(ev && ev.cells) ? ev.cells : [];
        for (const c of cells) {
          if (c && c.classList) cellSet.add(c);
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
      const stepMs  = reduced ? 200 : perEventMs;
      const token = ++WINSYM_CYCLE_TOKEN;
      grid.classList.add('is-winsym-cycling');
      let i = 0;
      const playOne = () => {
        if (token !== WINSYM_CYCLE_TOKEN) return;          /* cancelled */
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
           symbols. Defensive filter prevents TypeError on classList.add. */
        const cells = Array.isArray(ev && ev.cells) ? ev.cells : [];
        for (const c of cells) { if (c && c.classList) c.classList.add('cell--winsym'); }
        /* If this event carries a lineIndex it came from detectLineWins
           (payline mode) → draw the polyline through the matched cells.
           Cluster-mode events (detectWinCombos) have no lineIndex and
           skip the overlay; they rely on the per-cell pulse alone. */
        if (typeof ev.lineIndex === 'number') drawPaylineOverlay(ev);
        i++;
        setTimeout(playOne, stepMs);
      };
      playOne();
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
        await runTumbleChain(() => synth, { duringFs });
      }
      window.__WIN_AWARD__ = forcedAward;
      window.__FORCE_BIG_WIN_TIER__ = null;       /* one-shot reset */
      window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      /* BW force is by definition a big-win path — emit isBigWin:true and
       * use the symbol-celebration pulse, matching the reference flow
       * (SYMBOL_CELEBRATION → BIG_WIN). With synthesised forceCells the
       * 800 ms pulse is now VISIBLE on screen prior to the tier banner. */
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
       onTumbleStep event. */
    if (Math.random() < ${c.noWinChance}) {
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
        const events = detect() || [];
        _applyMultToEvents(events);
        return events;
      };
      const result = await runTumbleChain(wrappedDetect, { duringFs });
      allEvents = (result && result.events) || [];
    } else {
      /* No cascade slot — single detection. tumble's disabled stub still emits
         onTumbleStep so listeners (orb/persistent mult) react identically. */
      let events = detect() || [];
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
    if (totalAward > 0) {
      /* Boki rule 05.06.2026 — big-win path skips the per-line cycle and
       * goes straight to a coordinated symbol-celebration pulse, then
       * cedes the screen to bigWinTier. Reference flow:
       *   small/medium win:  WIN_PRESHOW → per-line TOTAL_ROLLUP
       *   big win:           SYMBOL_CELEBRATION (single pulse) → BIG_WIN
       * Threshold + enabled state come from BIG_WIN_TIER_STATE; if the
       * block isn't wired (disabled or absent) we fall through to the
       * regular per-line cycle so the slot still presents wins. */
      var __bet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0)
        ? window.__SLOT_BET__ : 1;
      var __bwState = (typeof window !== 'undefined') ? window.BIG_WIN_TIER_STATE : null;
      var __bwThreshold = (__bwState && Array.isArray(__bwState.thresholds) && __bwState.thresholds[0] > 0)
        ? __bwState.thresholds[0] : Infinity;
      var __bwEnabled  = !!(__bwState && __bwState.enabled);
      var __isBigWin   = __bwEnabled && (totalAward / __bet) >= __bwThreshold;

      if (typeof window !== 'undefined') {
        window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      }
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
    window.applyWinHighlight = applyWinHighlight;
    window.cancelWinSymCycle = cancelWinSymCycle;
  }
`;
}
