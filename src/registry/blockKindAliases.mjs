/**
 * src/registry/blockKindAliases.mjs
 *
 * UQ-DEEP-AO · AO-7 — snake_case ↔ camelCase alias resolution
 *
 * Why
 * ---
 * Parser emit-uje feature.kind u snake_case ("free_spins", "hold_and_win").
 * Blocks (src/blocks/) i blockMapper koriste camelCase block id-eve
 * ("freeSpins", "holdAndWin"). Bez alias table-a coverage probe javlja
 * phantom "missing" blokove — GDD declara `free_spins`, engine activates
 * `freeSpins`, oba ulaze u declared set, ratio se prepolovi (0.48 umesto ~0.95).
 *
 * What
 * ----
 * - ALIASES        — frozen snake → camel whitelist (≥ 25 entries)
 * - REVERSE_ALIASES — inverse map for round-trip
 * - resolveBlockName(kind)    — snake → camel (whitelist + auto-convert fallback)
 * - resolveFeatureKind(name)  — camel → snake (reverse + auto-convert fallback)
 *
 * Unknown kinds pass through preko deterministic auto-conversion (snake↔camel),
 * tako da je modul safe za bilo koji parser ili novi block bez explicit entry.
 *
 * @module blockKindAliases
 */

export const SCHEMA_VERSION = '1';

/* Maps feature.kind (snake_case from parser) → block name (camelCase from src/blocks/).
 * Bidirectional resolution. Whitelist — unknown kinds pass through unchanged.
 *
 * QA-B (UQ-DEEP-AO) otkrio: snake/camel split kreira phantom "missing"
 * blokove u coverage probe. Alias table reseva 0.48 → ~0.95 ratio. */
export const ALIASES = Object.freeze({
  /* Snake → camel */
  'free_spins': 'freeSpins',
  'hold_and_win': 'holdAndWin',
  'bonus_buy': 'bonusBuy',
  'ante_bet': 'anteBet',
  'cluster_pays': 'clusterPaysEval',
  'all_ways': 'allWaysEval',
  'pay_anywhere': 'payAnywhereEval',
  'pick_bonus': 'pickBonus',
  'wheel_bonus': 'wheelBonus',
  'walking_wild': 'walkingWild',
  'expanding_wild': 'expandingWild',
  'sticky_wild': 'stickyWild',
  'mystery_wild': 'mysteryWildReveal',
  'cascade': 'tumble',  /* legacy alias */
  'tumble': 'tumble',
  'multiplier': 'multiplier',  /* canonical */
  'persistent_multiplier': 'persistentMultiplier',
  'mystery_symbol': 'mysterySymbol',
  'super_symbol': 'superSymbol',
  'big_symbol': 'bigSymbolRender2x2',
  'mega_wild_cluster': 'megaWildCluster',
  'random_wild_burst': 'randomWildBurst',
  'cascading_wild_persistence': 'cascadingWildPersistence',
  'fs_expansion_wilds': 'fsExpansionWilds',
  'win_cap': 'winCap',
  'free_spin': 'freeSpins',  /* sometimes singular */
  'reality_check': 'realityCheck',
  'session_timeout': 'sessionTimeout',
  'spin_control': 'spinControl',
  'live_rtp_hud': 'liveRtpHud',
  'hold_and_win_credit_bucket': 'holdAndWinCreditBucket',
  'hold_and_win_frame_multiplier': 'holdAndWinFrameMultiplier',
  'hold_and_win_locked_orb_multiplier': 'holdAndWinLockedOrbMultiplier',
  'per_fs_spin_multiplier': 'perFsSpinMultiplier',
  'retrigger_multiplier_bump': 'retriggerMultiplierBump',
  'cluster_size_multiplier': 'clusterSizeMultiplier',
  'total_multiplier_chip': 'totalMultiplierChip',
});

/* Reverse map for camel → snake (rarely needed but useful for round-trip).
 * Note: 'tumble' → 'tumble' i 'multiplier' → 'multiplier' su identity entries;
 * dvostruki 'freeSpins' (od 'free_spins' + 'free_spin') resolves to whichever
 * je poslednji put unsert-ovan u Object.fromEntries (ovde 'free_spin'). To
 * je svesno — koristi se samo za auto-convert fallback assist. */
export const REVERSE_ALIASES = Object.freeze(
  Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [v, k]))
);

/**
 * Resolve a feature.kind (snake_case) to a block name (camelCase).
 * Whitelist hit → mapped value. Snake_case fallback → auto-converted camelCase.
 * Single-word or already-camelCase input passes through unchanged.
 *
 * @param {string} kind — feature.kind from parser
 * @returns {string|null} block name, or null for invalid input
 */
export function resolveBlockName(kind) {
  if (typeof kind !== 'string' || !kind) return null;
  if (ALIASES[kind]) return ALIASES[kind];
  /* Auto-convert snake_case → camelCase as fallback for unknowns. */
  if (/_/.test(kind)) {
    return kind.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  /* Already camelCase or single-word — pass through. */
  return kind;
}

/**
 * Resolve a block name (camelCase) back to a feature.kind (snake_case).
 * Reverse whitelist hit → mapped value. Otherwise auto-convert camelCase → snake_case.
 *
 * @param {string} blockName — block id (e.g. 'freeSpins')
 * @returns {string|null} feature.kind, or null for invalid input
 */
export function resolveFeatureKind(blockName) {
  if (typeof blockName !== 'string' || !blockName) return null;
  if (REVERSE_ALIASES[blockName]) return REVERSE_ALIASES[blockName];
  /* Auto-convert camelCase → snake_case as fallback. */
  return blockName.replace(/[A-Z]/g, (c, i) => (i > 0 ? '_' : '') + c.toLowerCase());
}
