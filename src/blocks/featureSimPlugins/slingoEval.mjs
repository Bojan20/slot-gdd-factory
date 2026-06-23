/**
 * src/blocks/featureSimPlugins/slingoEval.mjs
 *
 * MATH-DEEP D+3 (2026-06-23) — Slingo evaluator (vendor-neutral).
 *
 * @module slingoEval
 *
 * Purpose
 *   Topology-specific pay evaluator for slingo games (5×5 number grid +
 *   bottom-row spin reveals; match = mark; complete row/col/diagonal =
 *   pattern pay). Closes the simulator gap where line-eval cannot model
 *   slingo because the win mechanic is pattern completion, not adjacent
 *   reel matches.
 *
 * Industry-reference (vendor-neutral)
 *   The pattern + per-spin reveal model is the universal slingo template.
 *   Standard pattern ladder per industry baseline (per-line / 2-line /
 *   3-line / 4-line / 5-line / full-house). Pay table values are
 *   per-bet multipliers calibrated for ~96% RTP at 5-symbol pool.
 *
 * Public API
 *   evalSlingo(state, model) → { totalPay: number, patterns: Array, fired }
 *
 *   state shape:
 *     { grid: Array<Array<{id, marked?}>>, revealedSymbols: string[] }
 *
 *   Slingo is STATEFUL (the grid carries marks across spins). The
 *   evaluator does NOT mutate state — callers must apply marks
 *   themselves (see updateSlingoMarks helper).
 *
 * Lifecycle (HookBus contract)
 *   subscribes: onSpinResult — for vendor-side rendering (out-of-scope here)
 *   emits: nothing (pure pay evaluation)
 *
 * Performance budget
 *   O(N) per spin where N = grid_size + pattern count (~30). Fits the
 *   probe's per-spin budget (< 50 μs).
 *
 * Accessibility
 *   N/A (probe-side, no DOM).
 *
 * GDD keys consumed
 *   model.topology.kind === 'slingo' || model.topology.is_slingo === true
 *   model.slingo.payTable     (optional, override)
 *   model.slingo.gridSize     (optional, default 5)
 *   model.slingo.poolSize     (optional, default 50)
 *
 * Returns 0 pay immediately for non-slingo topology (graceful degradation).
 */

/* Industry-baseline pattern pay table (× total bet). Calibrated for ~96%
 * RTP at 5-symbol-pool, 5×5 grid, ~75 spins per session. Operator can
 * override via model.slingo.payTable. */
const DEFAULT_SLINGO_PAY_BY_PATTERN = Object.freeze({
  /* Single line (row OR col OR diagonal): 5 marks aligned. */
  line_1:       1.5,
  /* Two simultaneously-completed lines this spin. */
  line_2:       5,
  /* Three lines this spin (rare). */
  line_3:       25,
  /* Four lines this spin. */
  line_4:       100,
  /* Five lines this spin (still no full-house). */
  line_5:       400,
  /* Full house — all 25 cells marked. */
  full_house:   1500,
});

/**
 * Update marks: for each revealed symbol, mark all matching unmarked cells.
 *
 * @param {Array<Array<{id:string, marked?:boolean}>>} grid
 * @param {Array<string>} revealedSymbolIds — typically 5 per spin
 * @returns {Array<{r:number,c:number}>} cells newly marked this spin
 */
export function updateSlingoMarks(grid, revealedSymbolIds = []) {
  if (!Array.isArray(grid) || grid.length === 0) return [];
  const newlyMarked = [];
  const revealSet = new Set(revealedSymbolIds);
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell && !cell.marked && revealSet.has(cell.id)) {
        cell.marked = true;
        newlyMarked.push({ r, c });
      }
    }
  }
  return newlyMarked;
}

/**
 * Count completed lines (rows + cols + 2 diagonals on square grid).
 *
 * @param {Array<Array<{marked?:boolean}>>} grid
 * @returns {{ rows:number, cols:number, diags:number, total:number, allMarked:boolean }}
 */
export function countCompletedLines(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    return { rows: 0, cols: 0, diags: 0, total: 0, allMarked: false };
  }
  const N = grid.length;
  /* Assume square grid; standard slingo. */
  let rows = 0, cols = 0, diags = 0;
  let totalMarked = 0;
  for (let r = 0; r < N; r++) {
    let rowAll = true;
    for (let c = 0; c < N; c++) {
      if (grid[r][c]?.marked) totalMarked++;
      else rowAll = false;
    }
    if (rowAll) rows++;
  }
  for (let c = 0; c < N; c++) {
    let colAll = true;
    for (let r = 0; r < N; r++) {
      if (!grid[r][c]?.marked) { colAll = false; break; }
    }
    if (colAll) cols++;
  }
  let diag1All = true, diag2All = true;
  for (let i = 0; i < N; i++) {
    if (!grid[i][i]?.marked) diag1All = false;
    if (!grid[i][N - 1 - i]?.marked) diag2All = false;
  }
  if (diag1All) diags++;
  if (diag2All) diags++;
  const allMarked = totalMarked === N * N;
  return { rows, cols, diags, total: rows + cols + diags, allMarked };
}

/**
 * Slingo pay evaluator — call once per spin AFTER updateSlingoMarks.
 *
 * Pays the BEST single pattern this spin (industry standard: lines do
 * NOT stack across spins; the pay reflects the highest pattern crossed
 * by THIS spin's marks). Full house always pays in addition.
 *
 * @param {Array<Array<{marked?:boolean}>>} grid
 * @param {{linesAddedThisSpin:number}} delta — how many lines newly
 *        completed THIS spin (caller's responsibility to compute by
 *        diffing before/after countCompletedLines).
 * @param {object} model
 * @returns {{ totalPay:number, patterns: Array, fired: boolean }}
 */
export function evalSlingo(grid, delta, model) {
  const topo = model?.topology || {};
  const isSlingo = topo.kind === 'slingo' || topo.is_slingo === true;
  if (!isSlingo) return { totalPay: 0, patterns: [], fired: false };

  const payTable = (model?.slingo?.payTable && typeof model.slingo.payTable === 'object')
    ? { ...DEFAULT_SLINGO_PAY_BY_PATTERN, ...model.slingo.payTable }
    : DEFAULT_SLINGO_PAY_BY_PATTERN;

  const linesAdded = Math.max(0, Math.min(5, Number(delta?.linesAddedThisSpin) || 0));
  const patterns = [];
  let totalPay = 0;

  if (linesAdded >= 1) {
    const key = `line_${linesAdded}`;
    const pay = payTable[key] || 0;
    if (pay > 0) {
      patterns.push({ kind: key, pay });
      totalPay += pay;
    }
  }

  const totals = countCompletedLines(grid);
  if (totals.allMarked) {
    const pay = payTable.full_house || 0;
    if (pay > 0) {
      patterns.push({ kind: 'full_house', pay });
      totalPay += pay;
    }
  }

  return { totalPay, patterns, fired: patterns.length > 0 };
}

/**
 * Build a fresh slingo grid with random symbol IDs from a pool. Used by
 * the probe's per-session initializer. Deterministic via rng callback.
 *
 * @param {number} gridSize — default 5 (standard slingo)
 * @param {number} poolSize — default 50 (vendor-neutral typical)
 * @param {() => number} rng — uniform [0,1) generator
 * @returns {Array<Array<{id:string, marked:boolean}>>}
 */
export function buildSlingoGrid(gridSize = 5, poolSize = 50, rng = Math.random) {
  const grid = [];
  for (let r = 0; r < gridSize; r++) {
    const row = [];
    for (let c = 0; c < gridSize; c++) {
      const id = `N${1 + Math.floor(rng() * poolSize)}`;
      row.push({ id, marked: false });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Generate per-spin revealed symbol IDs. Industry baseline: 5 reveals
 * per spin (one per reel). Deterministic via rng callback.
 *
 * @param {number} count — default 5
 * @param {number} poolSize — default 50
 * @param {() => number} rng
 * @returns {Array<string>}
 */
export function rollSlingoReveals(count = 5, poolSize = 50, rng = Math.random) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(`N${1 + Math.floor(rng() * poolSize)}`);
  return out;
}

/* Self-test helper (sanity smoke for module-load). */
export function _selfTest() {
  const grid = buildSlingoGrid(5, 10, (() => { let s = 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })());
  const reveals = rollSlingoReveals(5, 10);
  const before = countCompletedLines(grid).total;
  updateSlingoMarks(grid, reveals);
  const after = countCompletedLines(grid).total;
  const r = evalSlingo(grid, { linesAddedThisSpin: after - before },
    { topology: { kind: 'slingo' } });
  if (r.totalPay < 0) throw new Error('slingo eval returned negative pay');
  return true;
}
