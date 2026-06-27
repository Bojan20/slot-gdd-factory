#!/usr/bin/env npx tsx
/**
 * Export TypeScript slot config to Rust JSON format
 *
 * Usage: npx tsx rust-sim/scripts/export_ts_config.ts > rust-sim/configs/game.json
 *
 * This script reads the TypeScript model definitions and exports them
 * in a format the Rust simulator can consume.
 *
 * CUSTOMIZATION:
 * 1. Update GAME_NAME and GAME_VERSION
 * 2. Ensure your model files (symbols.ts, paytable.ts, reels.ts) are updated
 * 3. Run this script to generate the Rust config
 */

// Import from the TypeScript model
// NOTE: Adjust these paths based on your project structure
import { SymbolId, SYMBOL_DEFINITIONS } from '../../src/model/symbols.js';
import { LINE_PAYTABLE, SCATTER_PAYTABLE } from '../../src/model/paytable.js';
import { BASE_REELS, FREE_SPINS_REELS } from '../../src/model/reels.js';
import { SYMBOL_ROLES, FEATURE_FLAGS } from '../../src/config/symbolConfig.js';

// ============================================
// GAME CONFIGURATION - UPDATE FOR YOUR GAME
// ============================================

const GAME_NAME = "Slot Math Template";
const GAME_VERSION = "1.0";
const TARGET_RTP = 96.0;

// Paylines - standard 10-line setup for 5x3 slot
const PAYLINES = [
  [1, 1, 1, 1, 1],  // Line 1: Middle row
  [0, 0, 0, 0, 0],  // Line 2: Top row
  [2, 2, 2, 2, 2],  // Line 3: Bottom row
  [0, 1, 2, 1, 0],  // Line 4: V shape
  [2, 1, 0, 1, 2],  // Line 5: Inverted V
  [0, 0, 1, 0, 0],  // Line 6: Slight V top
  [2, 2, 1, 2, 2],  // Line 7: Slight V bottom
  [1, 0, 0, 0, 1],  // Line 8: U shape top
  [1, 2, 2, 2, 1],  // Line 9: U shape bottom
  [0, 1, 1, 1, 0],  // Line 10: Flat middle with edges
];

// Free Spins configuration
const FREE_SPINS_CONFIG = {
  awards: { "3": 10, "4": 12, "5": 15 },
  mult_start: 1,
  mult_increment: 1,
  mult_max: 10,
  retrigger_enabled: true,
  scatter_pays: { "3": 2, "4": 5, "5": 20 },
};

// Hold & Win configuration
const HOLD_AND_WIN_CONFIG = {
  trigger_count: 6,
  initial_respins: 3,
  respins_on_new_orb: 3,
  full_grid_bonus: 500,
  orb_values: [
    { value: 1, weight: 608 },
    { value: 2, weight: 225 },
    { value: 3, weight: 87 },
    { value: 5, weight: 40 },
    { value: 7, weight: 18 },
    { value: 10, weight: 8 },
    { value: 12, weight: 6, jackpot: "MINI" },
    { value: 25, weight: 4, jackpot: "MINOR" },
    { value: 50, weight: 3, jackpot: "MAJOR" },
    { value: 150, weight: 1, jackpot: "GRAND" },
  ],
  orb_land_chance_base: 0.035,
  orb_land_chance_fill_bonus: 0.015,
};

// Lightning multiplier configuration
const LIGHTNING_CONFIG = {
  trigger_chance: 0.15,
  trigger_chance_fs: 0,
  multipliers: [
    { value: 2, weight: 70 },
    { value: 3, weight: 18 },
    { value: 5, weight: 10 },
    { value: 10, weight: 2 },
  ],
};

const MAX_WIN_CAP = 5000;
const FEATURE_LOOP_CAP = 100;

// ============================================
// BUILD CONFIG
// ============================================

interface GameConfig {
  name: string;
  version: string;
  target_rtp: number;
  reels: number;
  rows: number;
  paylines: number[][];
  symbols: Array<{
    id: string;
    name: string;
    is_wild: boolean;
    is_scatter: boolean;
    is_bonus: boolean;
  }>;
  paytable: Record<string, { pay3: number; pay4: number; pay5: number }>;
  base_weights: Array<Array<{ symbol: string; weight: number }>>;
  fs_weights: Array<Array<{ symbol: string; weight: number }>>;
  free_spins: typeof FREE_SPINS_CONFIG;
  hold_and_win: typeof HOLD_AND_WIN_CONFIG;
  lightning: typeof LIGHTNING_CONFIG;
  max_win_cap: number;
  feature_loop_cap: number;
}

// Map SymbolId to short IDs for Rust
const symbolIdMap: Record<SymbolId, string> = {
  [SymbolId.LP_1]: 'L1',
  [SymbolId.LP_2]: 'L2',
  [SymbolId.LP_3]: 'L3',
  [SymbolId.LP_4]: 'L4',
  [SymbolId.LP_5]: 'L5',
  [SymbolId.HP_1]: 'H1',
  [SymbolId.HP_2]: 'H2',
  [SymbolId.HP_3]: 'H3',
  [SymbolId.WILD]: 'W',
  [SymbolId.SCATTER]: 'S',
  [SymbolId.BONUS]: 'B',
};

// Build symbols array
const symbols = Object.values(SymbolId).map(id => {
  const def = SYMBOL_DEFINITIONS[id];
  return {
    id: symbolIdMap[id],
    name: def.name,
    is_wild: id === SYMBOL_ROLES.wild,
    is_scatter: id === SYMBOL_ROLES.scatter,
    is_bonus: id === SYMBOL_ROLES.special,
  };
});

// Build paytable
const paytable: Record<string, { pay3: number; pay4: number; pay5: number }> = {};
for (const entry of LINE_PAYTABLE) {
  const shortId = symbolIdMap[entry.symbol];
  paytable[shortId] = {
    pay3: entry.pays[3],
    pay4: entry.pays[4],
    pay5: entry.pays[5],
  };
}

// Convert reel strips to weight format
function reelsToWeights(reels: SymbolId[][]): Array<Array<{ symbol: string; weight: number }>> {
  return reels.map(reel => {
    // Count occurrences
    const counts = new Map<SymbolId, number>();
    for (const sym of reel) {
      counts.set(sym, (counts.get(sym) || 0) + 1);
    }

    // Convert to weight format
    return Array.from(counts.entries()).map(([sym, count]) => ({
      symbol: symbolIdMap[sym],
      weight: count,
    }));
  });
}

const config: GameConfig = {
  name: GAME_NAME,
  version: GAME_VERSION,
  target_rtp: TARGET_RTP,
  reels: 5,
  rows: 3,
  paylines: PAYLINES,
  symbols,
  paytable,
  base_weights: reelsToWeights(BASE_REELS),
  fs_weights: reelsToWeights(FREE_SPINS_REELS),
  free_spins: FREE_SPINS_CONFIG,
  hold_and_win: HOLD_AND_WIN_CONFIG,
  lightning: LIGHTNING_CONFIG,
  max_win_cap: MAX_WIN_CAP,
  feature_loop_cap: FEATURE_LOOP_CAP,
};

console.log(JSON.stringify(config, null, 2));
