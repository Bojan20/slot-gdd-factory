/**
 * Slot GDD Factory · triggerCounting BLOCK
 *
 * Emits the two helpers that turn a settled grid into a "scatter count →
 * spins awarded" answer. Decoupled from the reel engine itself so that
 * cluster / megaclusters / SVG / variable_reel kinds all share the same
 * counting rules — countMode (`perReel` | `any`) is honored everywhere.
 *
 * Emitted runtime functions:
 *   countTriggerSymbols()  → integer count of visible trigger symbols
 *   spinsForCount(count)   → integer FS spins awarded (0 if no trigger)
 *
 * Runtime dependencies (must exist in enclosing scope):
 *   SHAPE, RECT_REELS, REELS, ROWS, FREESPINS, grid
 *
 * GDD-driven configuration (consumed from `model.triggerCounting`):
 *   defaultThreshold   number — fallback trigger threshold       (default 3)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitTriggerCountingRuntime(cfg) → runtime JS string
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const DEFAULTS = Object.freeze({
  defaultThreshold: 3,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.triggerCounting) || {};
  if (typeof src.defaultThreshold === 'number' &&
      src.defaultThreshold >= 1 && src.defaultThreshold <= 20) {
    cfg.defaultThreshold = Math.floor(src.defaultThreshold);
  }
  return cfg;
}

export function emitTriggerCountingRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ triggerCounting: cfg });
  return `
  /* ── triggerCounting BLOCK — emitted by src/blocks/triggerCounting.mjs ─
     GDD knobs baked at build time:
       defaultThreshold = ${c.defaultThreshold}

     Count how many trigger-symbols are visible on the current grid. For
     rectangular kinds we look at the VISIBLE strip rows (indexes 1..ROWS),
     not the buffer cells above/below the mask. Wheel/crash render through
     SVG <text> nodes, not .cell divs — those get a dedicated path. */
  function countTriggerSymbols() {
    const id = (FREESPINS.triggerSymbol || "S").toUpperCase();
    const countMode = (FREESPINS.countMode === 'any') ? 'any' : 'perReel';
    /* 2026-06-09 — Boki bug fix: ALL kinds that use buildReelColumns
       (rectangular, variable_reel, lock_respin, expanding, cross, l_shape,
       diamond, pyramid — every UNIFORM_REEL_KIND) populate RECT_REELS with
       per-column visible strips. The previous gate let only rectangular /
       variable_reel through RECT_REELS and routed every other column-grid
       through the .cell DOM scan with (i mod REELS) modulo, which silently
       miscounted column-major DOM grids (lock_respin is column-major +
       buffer cells, so the modulo cycled through columns multiple times
       within a single real column, producing 1 instead of 3 for a clean
       3-scatter plant). Use RECT_REELS whenever it exists — that gives an
       authoritative per-column view, immune to DOM ordering. */
    if (RECT_REELS && RECT_REELS.length > 0) {
      let n = 0;
      for (const reel of RECT_REELS) {
        let hits = 0;
        const vis = reel.visibleRows || ROWS;
        for (let i = 1; i <= vis; i++) {
          if ((reel.cells[i].textContent || "").toUpperCase() === id) hits++;
        }
        n += (countMode === 'any') ? hits : (hits > 0 ? 1 : 0);
      }
      return n;
    }
    /* HTML non-rectangular kinds that are flat row-major cell grids with
       a well-defined REELS×ROWS column shape (cluster / megaclusters /
       lock_respin / expanding / infinity). The .cell DOM order is row-
       major so column index = i % REELS. */
    const COL_KINDS = new Set([
      'cluster', 'megaclusters', 'lock_respin', 'expanding', 'infinity',
    ]);
    if (countMode === 'perReel' && COL_KINDS.has(SHAPE.kind)) {
      const cells = grid.querySelectorAll('.cell');
      if (REELS && cells.length > 0) {
        const colsHit = new Set();
        cells.forEach((c, i) => {
          if ((c.textContent || '').toUpperCase() === id) {
            colsHit.add(i % REELS);
          }
        });
        return colsHit.size;
      }
    }
    /* Wheel / crash / radial / slingo / plinko / hex / diamond / pyramid /
       cross / l_shape / variable_reel — no clean column dedupe. */
    let n = 0;
    const nodes = grid.querySelectorAll(".cell, text");
    nodes.forEach(c => {
      if ((c.textContent || "").toUpperCase() === id) n++;
    });
    return n;
  }

  /* Map a scatter count to the awarded number of spins, using the GDD's
     award table. Returns 0 if the count doesn't trigger anything. */
  function spinsForCount(count) {
    if (!FREESPINS.enabled) return 0;
    /* Match the highest threshold ≤ count. */
    const awards = (FREESPINS.awards || []).slice().sort((a, b) => a.count - b.count);
    let award = 0;
    for (const a of awards) {
      if (count >= a.count) award = a.spins;
    }
    return award;
  }

  /* Wave S LEGO conformance — triggerCounting registers onSpinResult to
     pre-compute the scatter count and cache it on HookBus state. The postSpin
     orchestrator still calls countTriggerSymbols() for branch decisions, but
     observers (DEV FS panel, playground inspector, audio cue blocks) can read
     window.__LAST_SCATTER_COUNT__ without re-walking the grid. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('onSpinResult', (p) => {
      const count = countTriggerSymbols();
      if (typeof window !== 'undefined') {
        window.__LAST_SCATTER_COUNT__ = count;
        window.__LAST_SCATTER_AWARD__ = spinsForCount(count);
        window.__LAST_SCATTER_DURING_FS__ = !!(p && p.duringFs);
      }
    }, { priority: 5 });
    /* Reset on preSpin so a held cache from the previous spin can't leak
       into the new one (helps DEV FS button + Playground display). */
    HookBus.on('preSpin', () => {
      if (typeof window !== 'undefined') {
        window.__LAST_SCATTER_COUNT__ = 0;
        window.__LAST_SCATTER_AWARD__ = 0;
      }
    }, { priority: 5 });
  }
`;
}
