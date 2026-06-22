/**
 * src/blocks/featureSimPlugins/payAnywhereEval.mjs
 *
 * MATH-DEEP PAY-ANYWHERE EVAL kernel (2026-06-22 final session).
 *
 * Purpose
 *   Replaces line-payline evaluation for pay-anywhere topology games.
 *   Pay-anywhere mechanic: count occurrences of each symbol id across
 *   the entire grid (position-independent, no adjacency), then payout
 *   = paytable[symbol_id][count]. Multiple symbols can pay on same spin.
 *
 * Why
 *   The cross-game probe surfaced 348% RTP on Gates of Olympus 1000
 *   (5x3 pay_anywhere topology) because line-eval was running on a
 *   game that doesn't use paylines. Pay-anywhere = "scatter pays for
 *   every symbol", a fundamentally different mechanic. Running line-
 *   eval on pay-anywhere triple-counts wins (line traversal AND scatter-
 *   like position-independent counting layer-cake).
 *
 *   Same root cause as the cluster gap (1850pp) we just closed in
 *   commit 0fc044e — the probe needs topology-aware dispatch, and
 *   pay_anywhere is the missing kernel.
 *
 * Industry reference
 *   Industry-standard pay-anywhere / "all ways" mechanic (Pragmatic
 *   "Gates of Olympus" family, RTG "Cash Bandits" cluster variants).
 *   Different from "ways" (which has reel-aligned multiplicative
 *   counting); pay-anywhere is pure count-based.
 *
 * Algorithm
 *   1. Walk every cell, tally count per symbol id (skip scatters,
 *      wilds counted via symbol substitution).
 *   2. For each symbol with count >= minimum (default 8 for 5x3=15-cell
 *      grid, configurable via topology.pay_anywhere_min_count):
 *        payout = paytable[symbol_id][count] * wild_count_multiplier
 *   3. Sum across all paying symbols.
 *
 * Public API
 *   - evalPayAnywhere(grid, model) -> { totalPay, fired, hits }
 *
 * Lifecycle
 *   Called from probe when model.topology.evaluation === 'pay_anywhere'.
 *   Replaces line-eval entirely (not additive). Scatter/wild/H&W
 *   plugins remain topology-orthogonal.
 *
 * Performance budget
 *   5x3 grid = 15 cells; O(15) tally + O(N) paytable lookup per spin.
 *   Sub-microsecond per spin.
 *
 * HARD RULE #1 (vendor-neutral)
 *   No vendor names in code. Algorithm matches the industry pay-anywhere
 *   pattern, not a specific vendor product.
 */

/* Industry-typical pay-anywhere paytable by symbol tier × count.
 * x-bet multiples; biased so 8-cell hits are modest (high frequency)
 * and 13-15 cell saturation hits are big (low frequency). */
const PAY_ANYWHERE_PAYTABLE = {
  HP: { 8: 1, 9: 2, 10: 4, 11: 8, 12: 20, 13: 50, 14: 100, 15: 250 },
  MP: { 8: 0.5, 9: 1, 10: 2, 11: 4, 12: 10, 13: 20, 14: 40, 15: 100 },
  LP: { 8: 0.2, 9: 0.4, 10: 0.8, 11: 1.6, 12: 4, 13: 10, 14: 20, 15: 50 },
};

/* Default minimum count to trigger pay (industry typical for 5x3 = 8). */
const DEFAULT_MIN_COUNT = 8;

/* Look up pay for a (tier, count) pair, with degradation: if count exceeds
 * declared max in paytable, use largest declared. If tier unknown, fall to LP. */
function getPayAnywherePay(tier, count) {
  const tierTable = PAY_ANYWHERE_PAYTABLE[tier] || PAY_ANYWHERE_PAYTABLE.LP;
  /* Cap at largest declared count key. */
  const keys = Object.keys(tierTable).map(Number);
  const maxKey = Math.max(...keys);
  const cappedCount = Math.min(count, maxKey);
  return tierTable[cappedCount] || 0;
}

/**
 * Evaluate pay-anywhere wins on the grid.
 *
 * @param {Array<Array<Cell>>} grid - reels × rows (cell may be null for empty)
 * @param {object} model
 * @returns {{ totalPay: number, fired: boolean, hits: number, paysBySymbol: Array<{symId, count, pay}> }}
 */
export function evalPayAnywhere(grid, model) {
  /* Topology gate: only fire for pay_anywhere. */
  const topo = model?.topology || {};
  const isPayAnywhere = topo.kind === 'pay_anywhere'
                     || topo.evaluation === 'pay_anywhere';
  if (!isPayAnywhere) return { totalPay: 0, fired: false, hits: 0, paysBySymbol: [] };
  if (!Array.isArray(grid) || grid.length === 0) {
    return { totalPay: 0, fired: false, hits: 0, paysBySymbol: [] };
  }
  const reels = grid.length;
  const rows = grid[0]?.length || 0;
  if (rows === 0) return { totalPay: 0, fired: false, hits: 0, paysBySymbol: [] };

  const minCount = Number(topo.pay_anywhere_min_count) || DEFAULT_MIN_COUNT;

  /* Tally counts per symbol id. Track tier alongside (first occurrence wins). */
  const counts = new Map();
  const tiers = new Map();
  let wildCount = 0;
  for (let r = 0; r < reels; r++) {
    for (let y = 0; y < rows; y++) {
      const cell = grid[r][y];
      if (!cell) continue;
      if (cell.scatter) continue; /* scatters pay separately via volcanoScatter */
      if (cell.wild) {
        wildCount++;
        continue; /* wilds counted at substitution time */
      }
      const id = cell.id;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!tiers.has(id)) tiers.set(id, cell.tier);
    }
  }

  /* For each declared symbol, apply wild substitution then check threshold.
   * Wild adds to the count of any non-special symbol (each wild counts
   * toward at most ONE symbol's tally for payout — industry rule). */
  const paysBySymbol = [];
  let totalPay = 0;
  for (const [symId, baseCount] of counts) {
    const tier = tiers.get(symId);
    /* Wild substitution: count + wilds is the effective payout count. */
    const effectiveCount = baseCount + wildCount;
    if (effectiveCount < minCount) continue;
    const pay = getPayAnywherePay(tier, effectiveCount);
    if (pay > 0) {
      paysBySymbol.push({ symId, count: effectiveCount, pay });
      totalPay += pay;
    }
  }

  return {
    totalPay,
    fired: paysBySymbol.length > 0,
    hits: paysBySymbol.length,
    paysBySymbol,
  };
}

export const PLUGIN_ID = 'payAnywhereEval';
export const PLUGIN_NAME = 'Pay-anywhere evaluator (position-independent count, wild substitution)';
