/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  src/runtime/globalsContract.mjs
 *
 *  Purpose
 *  ───────
 *    Centralised single-emit for the `window.*` exposure surface that the
 *    QA harness, headless eyes, and downstream blocks read from. Previously
 *    lived as a 20-line inline `if (typeof window !== "undefined") { … }`
 *    block in `buildSlotHTML.mjs`. Extracting it gives us:
 *      1. One audited list of every global the orchestrator publishes
 *      2. A single point of update when a new block needs a probe
 *      3. JSDoc that documents WHY each global is exposed (QA / block
 *         dependency / dev tooling)
 *
 *  Public API
 *  ──────────
 *    emitGlobalsContractRuntime() -> string
 *        Emits the window.* exposure block. Must be emitted AFTER:
 *          • `FREESPINS`, `SHAPE`, `PAYLINE_POOL`, `SYMBOL_REGISTRY` are
 *            in scope (top-of-script constants)
 *          • `RECT_REELS` is defined (closure inside emitReelEngineRuntime)
 *          • `applyWinHighlight`, `detectLineWins`, `drawPaylineOverlay`
 *            are defined (from win-presentation / payline-overlay runtimes)
 *
 *  Industry rationale
 *  ──────────────────
 *    Every commercial slot front-end exposes a `window.__SLOT_*__` probe
 *    surface for QA / cabinet integration / regulator audit. We mirror that
 *    pattern: each global has a clear consumer (Playwright harness reads
 *    `window.SHAPE.kind`; freeSpins block reads `window.REELS` to size its
 *    placard; etc.).
 *
 *  Vendor neutrality
 *  ─────────────────
 *    No game / vendor mentions. Generic abstract names only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Emits the `window.*` exposure block. Idempotent — the emitted code itself
 * guards against `typeof window === "undefined"` for SSR / Node test paths.
 * @returns {string}
 */
export function emitGlobalsContractRuntime() {
  return `
  /* ── Window exposure contract (extracted: src/runtime/globalsContract.mjs) ──
     Each global has a documented consumer:
       • FREESPINS         → QA harness reads .enabled + .awards count
       • SHAPE             → freeSpins block reads .kind / .reels / .rows
       • REELS / ROWS      → feature blocks (walkingWild, mysterySymbol, etc.)
                             that compute cell coordinates on the live grid
       • RECT_REELS        → cortex-eyes reads to verify per-reel strip state
       • PAYLINE_POOL      → QA harness verifies line composition
       • SYMBOL_REGISTRY   → reach into tier classification for HP / MP / LP
       • applyWinHighlight → dev / QA can re-trigger the cycle on demand
       • detectLineWins    → QA snapshot the detector pure-function output
       • drawPaylineOverlay→ visual regression scripts trigger overlay draws */
  if (typeof window !== "undefined") {
    window.FREESPINS = FREESPINS;
    window.SHAPE = SHAPE;
    /* Wave T5 — without these, blocks that do \`window.REELS || 5\` fell
       through to default 5×3, placing coordinates on a phantom grid (e.g.
       walkingWild registry rows beyond actual ROWS). Expose the live
       SHAPE dimensions so blocks always read the truth. */
    window.REELS = SHAPE.reels;
    window.ROWS  = SHAPE.rows;
    Object.defineProperty(window, 'RECT_REELS', {
      configurable: true,
      get: function () { return RECT_REELS; },
    });
    window.PAYLINE_POOL = PAYLINE_POOL;
    window.SYMBOL_REGISTRY = SYMBOL_REGISTRY;
    window.applyWinHighlight = applyWinHighlight;
    window.detectLineWins = detectLineWins;
    window.drawPaylineOverlay = drawPaylineOverlay;

    /* ── Canonical cell-ref normalizer (Wave D-8 LINE-PRESENTATION FIX) ───
       Different evaluators emit event.cells in different shapes:
         • detectLineWins        → DOM elements (line-pays)
         • detectWaysWins        → DOM elements (243/1024/4096 ways)
         • detectPayAnywhereWins → DOM elements (scatter-pays)
         • detectClusterWins     → {r, c, idx} plain objects (cluster-pays)
         • winLineFlash legacy   → {reel, row} plain objects (line-flash)
         • Future:               → may emit anything

       Presenters (paylineOverlay, winLineFlash, badge/decorator UIs) must
       normalize to a real DOM element before measuring geometry. Without
       this, cluster-pays games (Starlight 6×5) silently skip the polyline
       draw because the defensive guard returns null on plain objects.

       Boki 2026-06-20: "Win linije prezentracije blokovi ne rade pravilno
       u svakom gddu" — root cause was every presenter implementing its own
       shape check and ignoring shapes it didn't recognize. This canonical
       resolver eliminates that class of bug template-wide. */
    window.__resolveCellElement = function (cellRef) {
      if (!cellRef) return null;
      /* Case 1: Already a DOM element */
      if (typeof cellRef.getBoundingClientRect === 'function') return cellRef;
      /* Case 2: Plain metadata object — extract reel + row regardless of key */
      var reelIdx, rowIdx;
      if (typeof cellRef.reel === 'number' && typeof cellRef.row === 'number') {
        reelIdx = cellRef.reel; rowIdx = cellRef.row;
      } else if (typeof cellRef.c === 'number' && typeof cellRef.r === 'number') {
        /* cluster eval shape: {r: row, c: column, idx: r*REELS+c} */
        reelIdx = cellRef.c; rowIdx = cellRef.r;
      } else if (typeof cellRef.idx === 'number' && Number.isFinite(cellRef.idx)) {
        /* Linear idx fallback — derive (r, c) from grid shape. */
        var cols = (window.SHAPE && window.SHAPE.reels) || window.REELS || 5;
        reelIdx = cellRef.idx % cols;
        rowIdx = Math.floor(cellRef.idx / cols);
      } else {
        return null;
      }
      /* Resolve via RECT_REELS (canonical engine source of truth) */
      if (Array.isArray(window.RECT_REELS)) {
        var reel = window.RECT_REELS[reelIdx];
        if (reel) {
          if (typeof reel.cellAt === 'function') return reel.cellAt(rowIdx);
          if (Array.isArray(reel.cells)) {
            /* RECT_REELS uses 1-based cells[] (index 0 is the peek/buffer
               row above the viewport). Probe both 1-based and 0-based for
               topology safety — first that matches and has
               getBoundingClientRect wins. */
            var candA = reel.cells[rowIdx + 1];
            if (candA && typeof candA.getBoundingClientRect === 'function') return candA;
            var candB = reel.cells[rowIdx];
            if (candB && typeof candB.getBoundingClientRect === 'function') return candB;
          }
        }
      }
      /* Fallback: data attribute query in light DOM */
      if (typeof document !== 'undefined') {
        var sel = '.symbol-cell[data-reel="' + reelIdx + '"][data-row="' + rowIdx + '"]'
                + ', .cell[data-reel="' + reelIdx + '"][data-row="' + rowIdx + '"]';
        var el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };
  }
`;
}
