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
  }
`;
}
