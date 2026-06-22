/**
 * src/blocks/featureSimPlugins/patternWin.mjs
 *
 * OPCIJA A · A-1 — Pattern Win plugin za math-rtp-probe.mjs.
 *
 * Cash Eruption GDD §5.2 Pattern Win spec:
 *   Reel 1: Red7 (stacked 3-high — all 3 rows on reel 1 must be Red7)
 *   Reels 2-5: Big Wild (expanded Wild covering all 3 rows)
 *   Award: 1000× total bet (FLAT, supersedes constituent Red7/Wild lines)
 *
 * INPUT: grid (5×3 array, each cell = {id, wild, scatter, ...})
 * OUTPUT: { patternHit: boolean, patternPayXBet: number }
 *
 * EVALUATION ORDER (per GDD §5.3):
 *   Pattern Win evaluated AFTER Wild expansion, REPLACES constituent line wins.
 *   In probe (no Wild expansion yet), check ako already has all-Red7 reel 1 +
 *   Wild on each of reels 2-5 (which would have expanded post-§5.3 step 6).
 *
 * Vendor-neutral: works for any GDD that declares a "pattern win" with similar
 * topology (top-symbol-stack reel-1 + wilds-elsewhere). Cash Eruption pattern
 * symbol is "Red7" — passable via config (default: first HP symbol).
 */

/**
 * Evaluate Pattern Win for a single grid.
 * @param {Array<Array<{id:string,wild:boolean,scatter:boolean}>>} grid - reels × rows
 * @param {object} model - parsed GDD model
 * @returns {{ patternHit: boolean, patternPayXBet: number }}
 */
export function evalPatternWin(grid, model) {
  const reels = grid.length;
  if (reels < 5) return { patternHit: false, patternPayXBet: 0 };
  const rows = grid[0]?.length || 0;
  if (rows < 3) return { patternHit: false, patternPayXBet: 0 };

  /* Pattern symbol: first HP symbol (Red7 in Cash Eruption). */
  const hpSyms = model.symbols?.high || [];
  const patternSym = hpSyms[0]?.id || hpSyms[0]?.name || 'Red7';

  /* Reel 1: ALL rows must match pattern symbol. */
  for (let y = 0; y < rows; y++) {
    const cell = grid[0][y];
    if (!cell || cell.id !== patternSym) {
      return { patternHit: false, patternPayXBet: 0 };
    }
  }

  /* Reels 2-5: EVERY cell must be Wild (representing post-§5.3-step-6
   * Wild-expansion state where each contributing Wild has become Big Wild
   * filling all 3 rows). This is strict — Pattern Win = ALL Wilds across
   * reels 2-5 AFTER expansion. Pre-expansion check would require simulating
   * the expansion logic; for now we model the post-state directly. */
  for (let r = 1; r < reels; r++) {
    for (let y = 0; y < rows; y++) {
      const cell = grid[r][y];
      if (!cell || !cell.wild) return { patternHit: false, patternPayXBet: 0 };
    }
  }

  /* GDD §5.2: Pattern Win = 1000× total bet (Cash Eruption baseline).
   * Future games may override via model.patternWin.payXBet. */
  const payXBet = model.patternWin?.payXBet ?? 1000;
  return { patternHit: true, patternPayXBet: payXBet };
}

/** Plugin self-identification for diagnostics. */
export const PLUGIN_ID = 'patternWin';
export const PLUGIN_NAME = 'Pattern Win (Red7 stack + Big Wilds reels 2-5)';
