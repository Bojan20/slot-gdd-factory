/**
 * src/blocks/featureSimPlugins/kernelRegistry.mjs
 *
 * MATH-DEEP KERNEL REGISTRY (2026-06-23) — discovery API for all 22 sister-
 * repo kernels + 2 inverse solvers.
 *
 * Purpose
 *   Single source of truth for kernel metadata. Tooling (cross-game probe,
 *   audit reports, kernel chooser UI) imports this instead of hardcoding
 *   kernel names + categories. Adding a new kernel = one entry here +
 *   one bridge function elsewhere.
 *
 * Public API
 *   - KERNEL_REGISTRY: Object.freeze({ <kernelName>: <metadata> })
 *   - listKernels(category?) — filter by category
 *   - getKernelMetadata(name) — single lookup
 *   - assertKernelExists(name) — throw if name unknown
 *
 * Metadata fields per kernel
 *   - category: 'forward-rtp' | 'composite' | 'inverse-solver' | 'audit'
 *   - topology: array of topology hints where kernel is applicable
 *   - feature: string label of mechanic kernel models
 *   - bridgeFunction: name of exported async fn in extraKernelBridges.mjs
 *     OR holdAndWinKernelBridge.mjs / clusterEvalKernelBridge.mjs
 *   - sisterRepoModule: name of the Python module in slot-math-kernels
 *   - paramsShape: short docstring describing required params
 */

export const KERNEL_REGISTRY = Object.freeze({
  /* ── Forward RTP kernels (20) ──────────────────────────────────────── */

  money_collect: Object.freeze({
    category: 'forward-rtp',
    topology: ['lock_respin', 'hold_and_win'],
    feature: 'cash collection + respin',
    bridgeFunction: 'computeHoldAndWinKernelRtp',
    bridgeModule: 'holdAndWinKernelBridge.mjs',
    sisterRepoModule: 'slot_math_kernels.money_collect',
    paramsShape: 'p_per_cell, n_cells, trigger_count_min, value_table, respins_reset',
  }),

  hold_and_win: Object.freeze({
    category: 'composite',
    topology: ['lock_respin', 'hold_and_win'],
    feature: 'cash collection + jackpot tiers',
    bridgeFunction: 'computeHoldAndWinKernelRtp',
    bridgeModule: 'holdAndWinKernelBridge.mjs',
    sisterRepoModule: 'slot_math_kernels.hold_and_win',
    paramsShape: 'money_params: MoneyCollectParams + jackpot_pots: tuple[MustHitByPot]',
  }),

  cluster_pays: Object.freeze({
    category: 'forward-rtp',
    topology: ['cluster'],
    feature: 'cluster-pays orthogonal flood-fill',
    bridgeFunction: 'computeClusterPaysKernelRtp',
    bridgeModule: 'clusterEvalKernelBridge.mjs',
    sisterRepoModule: 'slot_math_kernels.cluster_pays',
    paramsShape: 'cluster_count_distribution: {sym: {size: count}}, pay_table: {sym: {size: pay}}, min_cluster_size',
  }),

  expanding_symbol: Object.freeze({
    category: 'forward-rtp',
    topology: ['lines'],
    feature: 'Book-style FS expansion (single chosen symbol)',
    bridgeFunction: 'computeExpandingSymbolKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.expanding_symbol',
    paramsShape: 'fs_trigger_p, fs_initial_spins, reels, rows, p_per_cell_in_fs, pay_table',
  }),

  sticky_wilds: Object.freeze({
    category: 'forward-rtp',
    topology: ['lines', 'ways', 'cluster'],
    feature: 'sticky wild respin chain',
    bridgeFunction: 'computeStickyWildsKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.sticky_wilds',
    paramsShape: 'trigger_p, n_respins, n_cells, p_wild_per_cell_per_respin, pay_per_wild_count',
  }),

  cascade: Object.freeze({
    category: 'forward-rtp',
    topology: ['cascade', 'tumble', 'cluster'],
    feature: 'cascade (tumble) chain with multiplier ladder',
    bridgeFunction: 'computeCascadeKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.cascade',
    paramsShape: 'p_initial_win, base_pay_per_cascade_x_bet, p_win_per_cascade, multiplier_ladder, max_chain',
  }),

  ways_evaluator: Object.freeze({
    category: 'forward-rtp',
    topology: ['ways', 'megaways'],
    feature: 'variable-ways pay evaluation',
    bridgeFunction: 'computeWaysEvaluatorKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.ways_evaluator',
    paramsShape: 'row_distribution_per_reel: tuple[dict[int,float]], per_way_rtp_x_bet',
  }),

  pay_anywhere: Object.freeze({
    category: 'forward-rtp',
    topology: ['pay_anywhere'],
    feature: 'position-independent count-based pay',
    bridgeFunction: 'computePayAnywhereKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.pay_anywhere',
    paramsShape: 'n_cells, p_per_cell, pay_table: dict[int,float], min_pay_count, symbol_name',
  }),

  stacked_wilds: Object.freeze({
    category: 'forward-rtp',
    topology: ['lines', 'ways'],
    feature: 'stacked wild reels',
    bridgeFunction: 'computeStackedWildsKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.stacked_wilds',
    paramsShape: 'n_reels, p_stacked_per_reel, pay_per_stacked_count: dict[int,float]',
  }),

  both_ways: Object.freeze({
    category: 'forward-rtp',
    topology: ['lines'],
    feature: 'bidirectional line pay (LTR + RTL)',
    bridgeFunction: 'computeBothWaysKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.both_ways',
    paramsShape: 'ltr_only_rtp, line_pay_share',
  }),

  buy_feature: Object.freeze({
    category: 'audit',
    topology: ['any'],
    feature: 'bonus-buy economics + UKGC/MGA compliance flags',
    bridgeFunction: 'computeBuyFeatureAudit',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.buy_feature',
    paramsShape: 'bonus_average_pay_x_bet, buy_cost_x_bet, base_game_rtp, target_buy_rtp',
  }),

  persistent_multiplier: Object.freeze({
    category: 'forward-rtp',
    topology: ['lines', 'ways', 'cluster'],
    feature: 'FS sticky multiplier with bump chain',
    bridgeFunction: 'computePersistentMultiplierKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.persistent_multiplier',
    paramsShape: 'fs_trigger_p, fs_initial_spins, base_pay_per_spin_x_bet, initial_multiplier, bump_increment, p_bump_per_spin, max_multiplier',
  }),

  must_hit_by: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'mystery jackpot must-hit-by',
    bridgeFunction: 'computeMustHitByKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.must_hit_by',
    paramsShape: 'pots: tuple[MustHitByPot]',
  }),

  wheel: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'wheel bonus + spin-again chain',
    bridgeFunction: 'computeWheelKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.wheel',
    paramsShape: 'trigger_p, segments: tuple[WheelSegment], max_spin_again',
  }),

  asymmetric_paytable: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'per-symbol per-shape contribution sum',
    bridgeFunction: 'computeAsymmetricPaytableKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.asymmetric_paytable',
    paramsShape: 'per_symbol_contributions: dict[str, dict[str, float]]',
  }),

  charge_meter: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'charge meter (player-visible bonus tracker)',
    bridgeFunction: 'computeChargeMeterKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.charge_meter',
    paramsShape: 'expected_charge_per_spin, tiers: tuple[ChargeTier], persistent_across_sessions',
  }),

  crash_kernel: Object.freeze({
    category: 'audit',
    topology: ['crash'],
    feature: 'crash-game house edge + ruin estimate',
    bridgeFunction: 'computeCrashKernelAudit',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.crash_kernel',
    paramsShape: 'house_edge, cashout_multiplier',
  }),

  pick_chain: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'pick-and-click bonus with advance tokens',
    bridgeFunction: 'computePickChainKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.pick_chain',
    paramsShape: 'trigger_p, levels: tuple[PickLevel]',
  }),

  state_machine: Object.freeze({
    category: 'forward-rtp',
    topology: ['any'],
    feature: 'game-state Markov chain (base/super/mega/fury)',
    bridgeFunction: 'computeStateMachineKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.state_machine',
    paramsShape: 'states: tuple[GameState], transitions: tuple[tuple[float]]',
  }),

  both_ways_expanding_wild: Object.freeze({
    category: 'composite',
    topology: ['lines'],
    feature: 'composite: both_ways base + expanding_symbol FS',
    bridgeFunction: 'computeBothWaysExpandingWildKernelRtp',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.both_ways_expanding_wild',
    paramsShape: 'both_ways_params: BothWaysParams + expanding_params: ExpandingSymbolParams',
  }),

  /* ── Inverse solvers (2) ────────────────────────────────────────────── */

  inverse_solver: Object.freeze({
    category: 'inverse-solver',
    topology: ['any'],
    feature: '1D Newton-Raphson / bisection: target RTP → param',
    bridgeFunction: 'solveForParam',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.inverse_solver',
    paramsShape: 'kernel, solveFor, targetRtp, paramLo, paramHi, method, fixed',
  }),

  multi_dim_inverse_solver: Object.freeze({
    category: 'inverse-solver',
    topology: ['any'],
    feature: 'N-D Newton-Raphson: target vector → params vector',
    bridgeFunction: 'solveMultiDim',
    bridgeModule: 'extraKernelBridges.mjs',
    sisterRepoModule: 'slot_math_kernels.multi_dim_inverse_solver',
    paramsShape: 'kernel, solveFor[], targets[], initialGuess[], bounds[], fixed',
  }),
});

/* ── Public helpers ────────────────────────────────────────────────────── */

/**
 * List kernels, optionally filtered by category.
 * @param {string} [category] — 'forward-rtp' | 'composite' | 'inverse-solver' | 'audit'
 * @returns {Array<{ name: string, ...metadata }>}
 */
export function listKernels(category) {
  const all = Object.entries(KERNEL_REGISTRY).map(([name, meta]) => ({ name, ...meta }));
  if (!category) return all;
  return all.filter(k => k.category === category);
}

/**
 * Single-kernel lookup.
 * @returns {object|null}
 */
export function getKernelMetadata(name) {
  return KERNEL_REGISTRY[name] || null;
}

/**
 * Throw if kernel name not in registry.
 */
export function assertKernelExists(name) {
  if (!KERNEL_REGISTRY[name]) {
    const available = Object.keys(KERNEL_REGISTRY).join(', ');
    throw new Error(`unknown kernel: ${name}. Available: ${available}`);
  }
}

/* Category counts for quick health-check. */
export function kernelCounts() {
  const counts = { 'forward-rtp': 0, 'composite': 0, 'inverse-solver': 0, 'audit': 0 };
  for (const meta of Object.values(KERNEL_REGISTRY)) {
    counts[meta.category] = (counts[meta.category] || 0) + 1;
  }
  return { total: Object.keys(KERNEL_REGISTRY).length, byCategory: counts };
}
