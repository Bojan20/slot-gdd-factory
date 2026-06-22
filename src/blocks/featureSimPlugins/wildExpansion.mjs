/**
 * src/blocks/featureSimPlugins/wildExpansion.mjs
 *
 * OPCIJA A · A-2 — Wild expansion plugin za math-rtp-probe.mjs.
 *
 * Cash Eruption GDD §5.3 / §6.5 / §7 Expanding Wild spec:
 *   1. Score all 20 paylines treating each landed Wild as its single landed position.
 *   2. For every Wild that contributes to at least one winning line,
 *      expand it to the full 3-high reel (Big Wild render).
 *   3. Re-evaluate all 20 paylines with expanded Wilds in place.
 *   4. Pay the recomputed result.
 *
 * Wilds appear on reels 2-5 only (never reel 1 in base game).
 *
 * INPUT: grid (5×3 array), model
 * OUTPUT: mutated grid sa expanded Wilds + boolean expansionsTriggered
 *
 * Process:
 *   Pass 1: iterate paylines, find runs starting from reel 1 that include a Wild
 *           somewhere on reels 2-5. Mark those Wild positions as "winning".
 *   Pass 2: for each winning Wild's reel, mark ALL cells in that reel as Wild
 *           (Big Wild expansion).
 *
 * Vendor-neutral: any GDD with model.expandingWild.enabled=true uses this.
 */

/**
 * Expand Wilds that contribute to a winning line.
 * Mutates grid in-place. Returns { expansionsTriggered, expandedReels }.
 *
 * @param {Array<Array<{id, wild, scatter, tier}>>} grid
 * @param {object} model
 * @param {Array<Array<number>>} paylineMap - optional explicit row indices
 * @returns {{ expansionsTriggered: number, expandedReels: number[] }}
 */
export function applyWildExpansion(grid, model, paylineMap) {
  const reels = grid.length;
  const rows = grid[0]?.length || 0;
  if (reels < 2 || rows < 1) return { expansionsTriggered: 0, expandedReels: [] };

  /* Reuse paylineMap from probe context; fallback to single center-row line. */
  const lines = Array.isArray(paylineMap) && paylineMap.length > 0
    ? paylineMap
    : [[Math.floor(rows / 2), Math.floor(rows / 2), Math.floor(rows / 2),
        Math.floor(rows / 2), Math.floor(rows / 2)]];

  /* Set of reel indices to expand (each reel becomes all-Wild if any wild
   * within contributes to a winning line). */
  const reelsToExpand = new Set();

  for (const rowMap of lines) {
    if (!Array.isArray(rowMap) || rowMap.length < reels) continue;
    const reel0row = rowMap[0];
    const reel0cell = grid[0]?.[reel0row];
    if (!reel0cell || reel0cell.scatter || reel0cell.wild) continue;
    const matchId = reel0cell.id;
    /* Walk reels 2..reels checking for run continuation. Wild substitutes. */
    let runLen = 1;
    const wildsInRun = [];
    for (let r = 1; r < reels; r++) {
      const yIdx = rowMap[r];
      const cell = grid[r]?.[yIdx];
      if (!cell) break;
      if (cell.id === matchId) {
        runLen++;
      } else if (cell.wild) {
        runLen++;
        wildsInRun.push(r);
      } else {
        break;
      }
    }
    if (runLen >= 3) {
      /* This line is a winner — each Wild in the run is a "contributing" Wild. */
      for (const r of wildsInRun) reelsToExpand.add(r);
    }
  }

  /* Expand each marked reel: set ALL cells in that reel to Wild. */
  const expandedReels = [...reelsToExpand].sort((a, b) => a - b);
  for (const r of expandedReels) {
    for (let y = 0; y < rows; y++) {
      const orig = grid[r][y];
      grid[r][y] = {
        id: 'BigWild', name: 'Big Wild',
        wild: true, scatter: false, bonus: false,
        tier: orig?.tier || 'sp',
      };
    }
  }

  return { expansionsTriggered: expandedReels.length, expandedReels };
}

export const PLUGIN_ID = 'wildExpansion';
export const PLUGIN_NAME = 'Big Wild expansion (only_if_winning, reels 2-5)';
