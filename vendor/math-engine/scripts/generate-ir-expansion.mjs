#!/usr/bin/env node
/**
 * generate-ir-expansion.mjs — CORTI 200.8 Production Studio expansion.
 *
 * Emits 80+ additional starter IR templates organised across 8 new
 * categories (megaways / cluster / cascade / hold-and-win / free-spins
 * / bonus / jackpot / hybrid) plus 5 additional classic-lines variants
 * and 4 enhanced variants per Vendor B M-gap (16 × 4 = 64).
 *
 * Outputs:
 *   - web/studio/ir-library/megaways/*.ir.json
 *   - web/studio/ir-library/cluster/*.ir.json
 *   - web/studio/ir-library/cascade/*.ir.json
 *   - web/studio/ir-library/holdwin/*.ir.json
 *   - web/studio/ir-library/freespins/*.ir.json
 *   - web/studio/ir-library/bonus/*.ir.json
 *   - web/studio/ir-library/jackpot/*.ir.json
 *   - web/studio/ir-library/hybrid/*.ir.json
 *   - web/studio/ir-library/classic-lines/*.ir.json
 *   - web/studio/ir-library/lw-enhanced/*.ir.json
 *   - web/studio/ir-library/index-expansion.json
 *
 * Every IR is validated via parseGameIR before write. The script is
 * idempotent — rerun produces no diff.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGameIR } from '../dist/ir/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = resolve(REPO_ROOT, 'web/studio/ir-library');

const DRY_RUN = process.argv.includes('--dry-run');

/* ============================================================
   Shared building blocks (mirror of generate-ir-library.mjs)
   ============================================================ */

const STD_SYMBOLS_RECT = () => [
  { id: 'HP1', name: 'HP1', kind: 'hp' },
  { id: 'HP2', name: 'HP2', kind: 'hp' },
  { id: 'HP3', name: 'HP3', kind: 'hp' },
  { id: 'HP4', name: 'HP4', kind: 'hp' },
  { id: 'LP1', name: 'LP1', kind: 'lp' },
  { id: 'LP2', name: 'LP2', kind: 'lp' },
  { id: 'LP3', name: 'LP3', kind: 'lp' },
  { id: 'LP4', name: 'LP4', kind: 'lp' },
  { id: 'WLD', name: 'Wild', kind: 'wild', substitutes: '*' },
  { id: 'SCT', name: 'Scatter', kind: 'scatter' },
];

const STD_SYMBOLS_WITH_BONUS = () => [
  ...STD_SYMBOLS_RECT(),
  { id: 'BNS', name: 'Bonus', kind: 'bonus' },
];

const STD_SYMBOLS_WITH_BONUS_MULT = () => [
  ...STD_SYMBOLS_RECT(),
  { id: 'BNS', name: 'Bonus', kind: 'bonus' },
  { id: 'MLT', name: 'Multiplier', kind: 'multiplier' },
];

const STD_PAYTABLE_LINES = () => ({
  HP1: { '3': 5,   '4': 25,  '5': 100 },
  HP2: { '3': 4,   '4': 20,  '5': 80  },
  HP3: { '3': 3,   '4': 15,  '5': 60  },
  HP4: { '3': 2.5, '4': 12,  '5': 50  },
  LP1: { '3': 1,   '4': 4,   '5': 15  },
  LP2: { '3': 0.8, '4': 3,   '5': 12  },
  LP3: { '3': 0.6, '4': 2.5, '5': 10  },
  LP4: { '3': 0.5, '4': 2,   '5': 8   },
});

const STD_PAYTABLE_CLUSTER = () => ({
  HP1: { '5': 5,   '8': 25,  '12': 100 },
  HP2: { '5': 4,   '8': 20,  '12': 80  },
  HP3: { '5': 3,   '8': 15,  '12': 60  },
  HP4: { '5': 2.5, '8': 12,  '12': 50  },
  LP1: { '5': 1,   '8': 4,   '12': 15  },
  LP2: { '5': 0.8, '8': 3,   '12': 12  },
  LP3: { '5': 0.6, '8': 2.5, '12': 10  },
  LP4: { '5': 0.5, '8': 2,   '12': 8   },
});

const PAYLINES_20 = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
  [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
  [2,1,1,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,0,2,0,0],[2,2,0,2,2],
  [1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],[0,1,2,2,2],
];

function reelsBase(reels, mapFactory) {
  return Array.from({ length: reels }, mapFactory);
}

function mkStdReelMap(extra = {}) {
  return { HP1: 2, HP2: 2, HP3: 3, HP4: 3, LP1: 6, LP2: 6, LP3: 7, LP4: 7, WLD: 1, SCT: 1, ...extra };
}

const STD_RNG = () => ({ kind: 'mulberry32', default_seed: 42 });
const STD_BET = () => ({ currency: 'EUR', base_bet: 1, denominations: [0.1, 1.0] });

function mkLimits({ target_rtp = 0.96, max_win_x = 5000, vol = 'high', hit = 0.30 } = {}) {
  return {
    target_rtp, rtp_tolerance: 0.01, max_win_x, win_cap_apply: 'per_spin',
    target_volatility: vol, hit_freq_target: hit,
  };
}

function mkCompliance(jurisdictions = ['UKGC', 'MGA', 'ADM']) {
  return {
    jurisdictions,
    rtp_range_required: [0.88, 0.99],
    max_win_cap_required: 10000,
    near_miss_rule: 'must_be_random',
    ldw_disclosure: true,
    session_time_display: true,
  };
}

function mkRtpAllocation(target, weights) {
  const keys = ['base_game', 'free_spins', 'hold_and_win', 'jackpot'];
  let total = 0;
  for (const k of keys) total += (weights[k] ?? 0);
  if (total <= 0) return { base_game: target, free_spins: 0, hold_and_win: 0, jackpot: 0, tolerance: 0.01 };
  const alloc = { base_game: 0, free_spins: 0, hold_and_win: 0, jackpot: 0, tolerance: 0.01 };
  let assigned = 0;
  const ordered = keys.filter((k) => (weights[k] ?? 0) > 0);
  for (let i = 0; i < ordered.length; i++) {
    const k = ordered[i];
    if (i === ordered.length - 1) alloc[k] = +(target - assigned).toFixed(6);
    else {
      const v = +((weights[k] / total) * target).toFixed(6);
      alloc[k] = v;
      assigned += v;
    }
  }
  return alloc;
}

/* ============================================================
   Builder factories — parametrised by variant
   ============================================================ */

// Classic lines variants (5)
const CLASSIC_LINES_VARIANTS = [
  { id: 'classic-lines-777',         name: 'Classic 777 Lucky Sevens',         theme: '777',        paylines: 10, vol: 'medium', hit: 0.35, rtp: 0.95 },
  { id: 'classic-lines-liberty-bell',name: 'Classic Liberty Bell',             theme: 'liberty',    paylines: 5,  vol: 'low',    hit: 0.40, rtp: 0.94 },
  { id: 'classic-lines-fruit',       name: 'Classic Fruit Salad',              theme: 'fruit',      paylines: 9,  vol: 'medium', hit: 0.36, rtp: 0.95 },
  { id: 'classic-lines-diamonds',    name: 'Classic Diamonds Triple Down',     theme: 'diamonds',   paylines: 15, vol: 'high',   hit: 0.28, rtp: 0.96 },
  { id: 'classic-lines-lucky-7',     name: 'Classic Lucky 7 Hot Reels',        theme: 'lucky-7',    paylines: 20, vol: 'high',   hit: 0.30, rtp: 0.96 },
];

function buildClassicLines(v) {
  const lines = PAYLINES_20.slice(0, v.paylines);
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id,
      name: v.name,
      version: '0.1.0',
      description: `${v.name} — ${v.paylines}-line classic Vegas slot.`,
      theme_tags: ['classic', 'lines', v.theme],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: { mode: 'weighted', base: reelsBase(5, () => mkStdReelMap()) },
    evaluation: { kind: 'lines', paylines: lines, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [{ kind: 'free_spins', trigger: { by: 'scatter_count', thresholds: { '3': 8 } }, global_multiplier: 1 }],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: v.vol, hit: v.hit }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: 0.78, free_spins: 0.22 }),
  };
}

// Megaways family (10)
const MEGAWAYS_VARIANTS = [
  { id: 'megaways-bonanza',     name: 'Bonanza Megaways Style',         reels: 6, rtp: 0.96 },
  { id: 'megaways-donkey-kong', name: 'Donkey Kong Megaways Style',     reels: 6, rtp: 0.955 },
  { id: 'megaways-extra-chilli',name: 'Extra Chilli Megaways Style',    reels: 6, rtp: 0.965 },
  { id: 'megaways-vikings',     name: 'Vikings Unleashed Megaways',     reels: 6, rtp: 0.96 },
  { id: 'megaways-fishin',      name: 'Fishin Frenzy Megaways',         reels: 6, rtp: 0.955 },
  { id: 'megaways-buffalo',     name: 'Buffalo Megaways Style',         reels: 6, rtp: 0.96 },
  { id: 'megaways-7x',          name: '7-Reel Megaways Mega Edition',   reels: 7, rtp: 0.96 },
  { id: 'megaways-cascadia',    name: 'Cascadia Megaways Cascade',      reels: 6, rtp: 0.965 },
  { id: 'megaways-mystery',     name: 'Mystery Megaways Variant',       reels: 6, rtp: 0.96 },
  { id: 'megaways-classic',     name: 'Classic Megaways 4-7 Rows',      reels: 6, rtp: 0.96 },
];

function buildMegaways(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — variable-rows Megaways topology.`,
      theme_tags: ['classic', 'megaways', 'variable-rows'],
    },
    topology: {
      kind: 'variable_rows',
      reels: v.reels,
      row_range_per_reel: Array.from({ length: v.reels }, () => [2, 7]),
      ways_cap: 117649,
    },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: { mode: 'weighted', base: reelsBase(v.reels, () => mkStdReelMap({ BNS: 2 })) },
    evaluation: { kind: 'ways', direction: 'ltr', min_match: 3, max_ways_per_spin: 117649 },
    paytable: {
      HP1: { '3': 5,   '4': 25,  '5': 100, '6': 500, '7': 1000 },
      HP2: { '3': 4,   '4': 20,  '5': 80,  '6': 400, '7': 800  },
      HP3: { '3': 3,   '4': 15,  '5': 60,  '6': 300, '7': 600  },
      HP4: { '3': 2.5, '4': 12,  '5': 50,  '6': 250, '7': 500  },
      LP1: { '3': 1,   '4': 4,   '5': 15,  '6': 75,  '7': 150  },
      LP2: { '3': 0.8, '4': 3,   '5': 12,  '6': 60,  '7': 120  },
      LP3: { '3': 0.6, '4': 2.5, '5': 10,  '6': 50,  '7': 100  },
      LP4: { '3': 0.5, '4': 2,   '5': 8,   '6': 40,  '7': 80   },
    },
    features: [
      { kind: 'cascade', replacement: 'drop', max_chain: 8, multiplier_progression: [1, 2, 3, 5, 10] },
      { kind: 'free_spins', trigger: { by: 'scatter_count', thresholds: { '3': 12, '4': 16, '5': 24 } }, global_multiplier: 1 },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: 'high', hit: 0.27 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: 0.62, free_spins: 0.38 }),
  };
}

// Cluster family (10)
const CLUSTER_VARIANTS = [
  { id: 'cluster-6x6',       name: 'Cluster Pay 6x6',          cols: 6, rows: 6, rtp: 0.96 },
  { id: 'cluster-7x7-v2',    name: 'Cluster Pay 7x7 Premium',  cols: 7, rows: 7, rtp: 0.96 },
  { id: 'cluster-8x8',       name: 'Cluster Pay 8x8 Mega',     cols: 8, rows: 8, rtp: 0.965 },
  { id: 'cluster-5x5',       name: 'Cluster Pay 5x5 Compact',  cols: 5, rows: 5, rtp: 0.955 },
  { id: 'cluster-hex',       name: 'Hexagonal Cluster Pay',    cols: 6, rows: 5, rtp: 0.96 },
  { id: 'cluster-diagonal',  name: 'Diagonal-Adjacency Cluster', cols: 7, rows: 7, rtp: 0.96 },
  { id: 'cluster-mini',      name: 'Mini Cluster 4x4',         cols: 4, rows: 4, rtp: 0.95 },
  { id: 'cluster-mega',      name: 'Mega Cluster 9x9',         cols: 9, rows: 9, rtp: 0.97 },
  { id: 'cluster-rectangle', name: 'Rectangular Cluster 8x6',  cols: 8, rows: 6, rtp: 0.96 },
  { id: 'cluster-tall',      name: 'Tall Cluster 5x8',         cols: 5, rows: 8, rtp: 0.96 },
];

function buildCluster(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — cluster-pay grid topology.`,
      theme_tags: ['classic', 'cluster', 'cluster-pay'],
    },
    topology: { kind: 'cluster_grid', columns: v.cols, rows: v.rows, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_RECT(),
    reels: { mode: 'weighted', base: reelsBase(v.cols, () => mkStdReelMap()) },
    evaluation: { kind: 'cluster', min_cluster_size: 5, cluster_pay_table: { '5': 1, '8': 4, '12': 12, '20': 60 } },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [{ kind: 'cascade', replacement: 'drop', max_chain: 6, multiplier_progression: [1, 2, 3, 5, 10] }],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: v.rtp }),
  };
}

// Cascade family (10)
const CASCADE_VARIANTS = [
  { id: 'cascade-avalanche',  name: 'Avalanche 5x3',            mult: [1,2,3,5,8,12],            rtp: 0.96 },
  { id: 'cascade-tumble',     name: 'Tumble Reels 5x4',         mult: [1,1,2,2,3,5],             rtp: 0.955 },
  { id: 'cascade-rolling',    name: 'Rolling Reels 5x3',        mult: [1,2,3,4,5,6],             rtp: 0.96 },
  { id: 'cascade-collapse',   name: 'Collapsing Reels Grid',    mult: [1,3,5,10,20,50],          rtp: 0.965 },
  { id: 'cascade-chain',      name: 'Chain Reaction 6x4',       mult: [1,2,4,8,16,32],           rtp: 0.96 },
  { id: 'cascade-mega-mult',  name: 'Mega Multiplier Cascade',  mult: [1,5,10,25,50,100],        rtp: 0.97 },
  { id: 'cascade-slow',       name: 'Slow Drift Cascade',       mult: [1,1.5,2,2.5,3,3.5],       rtp: 0.95 },
  { id: 'cascade-fast',       name: 'Fast Spike Cascade',       mult: [1,10,25,50,100,250],      rtp: 0.97 },
  { id: 'cascade-staircase',  name: 'Staircase Cascade',        mult: [1,2,3,4,5,8,12,20],       rtp: 0.965 },
  { id: 'cascade-rebirth',    name: 'Rebirth Cascade Reset',    mult: [1,1,2,3,5,8],             rtp: 0.96 },
];

function buildCascade(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — cascade-replacement mechanic with multiplier trail.`,
      theme_tags: ['classic', 'cascade', 'tumble'],
    },
    topology: { kind: 'cluster_grid', columns: 6, rows: 5, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_RECT(),
    reels: { mode: 'weighted', base: reelsBase(6, () => mkStdReelMap()) },
    evaluation: { kind: 'cluster', min_cluster_size: 5, cluster_pay_table: { '5': 1, '8': 4, '12': 12, '20': 60 } },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [{ kind: 'cascade', replacement: 'drop', max_chain: v.mult.length, multiplier_progression: v.mult }],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: 'ultra', hit: 0.25 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: v.rtp }),
  };
}

// Hold & Win family (10)
const HOLDWIN_VARIANTS = [
  { id: 'hw-lock-it-link', name: 'Pattern-LIL Style',     resp: 3, cells: 15, rtp: 0.955 },
  { id: 'hw-cash-fall',    name: 'Cash Fall Style',         resp: 3, cells: 15, rtp: 0.96  },
  { id: 'hw-coin-combo',   name: 'Coin Combo Style',        resp: 3, cells: 12, rtp: 0.955 },
  { id: 'hw-megaorb',      name: 'Mega Orb 7x7',            resp: 4, cells: 49, rtp: 0.965 },
  { id: 'hw-classic',      name: 'Classic Hold & Spin',     resp: 3, cells: 15, rtp: 0.95  },
  { id: 'hw-row-complete', name: 'Row Complete H&W',        resp: 3, cells: 15, rtp: 0.96  },
  { id: 'hw-column-complete', name: 'Column Complete H&W',  resp: 3, cells: 15, rtp: 0.96  },
  { id: 'hw-jackpot-orb',  name: 'Jackpot Orb H&W',         resp: 3, cells: 15, rtp: 0.96  },
  { id: 'hw-frenzy',       name: 'Frenzy H&W 6x4',          resp: 3, cells: 24, rtp: 0.97  },
  { id: 'hw-mini',         name: 'Mini H&W 4x3',            resp: 3, cells: 12, rtp: 0.95  },
];

function buildHoldwin(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — Hold & Win bonus with cash orbs and jackpot tiers.`,
      theme_tags: ['classic', 'hold-and-win', 'orbs'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: { mode: 'weighted', base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })) },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: v.resp,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 6 }, { value: 2, weight: 4 },
          { value: 5, weight: 2 }, { value: 10, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'MINI', multiplier: 25 }, { id: 'MINOR', multiplier: 100 },
          { id: 'MAJOR', multiplier: 500 }, { id: 'GRAND', multiplier: 2000 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: 0.62, hold_and_win: 0.38 }),
  };
}

// Free spins family (15)
const FREESPINS_VARIANTS = [
  { id: 'fs-retrigger-v2',     name: 'Retrigger Free Spins+',   mod: ['sticky_wilds'], gm: 1, rtp: 0.96 },
  { id: 'fs-sticky-wilds-v2',  name: 'Sticky Wilds FS+',        mod: ['sticky_wilds'], gm: 1, rtp: 0.96 },
  { id: 'fs-expanding-v2',     name: 'Expanding Wilds FS+',     mod: ['expanding_wilds'], gm: 1, rtp: 0.96 },
  { id: 'fs-mult-trail',       name: 'Multiplier Trail FS',     mod: ['multiplier_ladder'], gm: 1, rtp: 0.965 },
  { id: 'fs-walking-wilds',    name: 'Walking Wilds FS',        mod: ['expanding_wilds'], gm: 1, rtp: 0.96 },
  { id: 'fs-mystery-symbol',   name: 'Mystery Symbol FS',       mod: ['mystery_symbol'], gm: 1, rtp: 0.96 },
  { id: 'fs-symbol-upgrade',   name: 'Symbol Upgrade FS',       mod: ['mystery_symbol'], gm: 1, rtp: 0.96 },
  { id: 'fs-locked-reels',     name: 'Locked Reels FS',         mod: ['sticky_wilds'], gm: 1, rtp: 0.96 },
  { id: 'fs-x2-multiplier',    name: '2x Multiplier FS',        mod: ['multiplier_ladder'], gm: 2, rtp: 0.965 },
  { id: 'fs-x3-multiplier',    name: '3x Multiplier FS',        mod: ['multiplier_ladder'], gm: 3, rtp: 0.97 },
  { id: 'fs-x5-multiplier',    name: '5x Multiplier FS',        mod: ['multiplier_ladder'], gm: 5, rtp: 0.97 },
  { id: 'fs-mega-spins',       name: 'Mega Free Spins 30',      mod: ['sticky_wilds'], gm: 1, rtp: 0.97, count: 30 },
  { id: 'fs-super-spins',      name: 'Super Free Spins 50',     mod: ['sticky_wilds'], gm: 1, rtp: 0.97, count: 50 },
  { id: 'fs-pickem',           name: 'Pick-Em FS Selector',     mod: [], gm: 1, rtp: 0.96 },
  { id: 'fs-double',           name: 'Double-Up FS Variant',    mod: ['multiplier_ladder'], gm: 2, rtp: 0.965 },
];

function buildFreespins(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — free-spin variant with ${v.mod.join('+') || 'standard'} modifiers.`,
      theme_tags: ['classic', 'free-spins', 'fs'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
      free_spins: reelsBase(5, () => mkStdReelMap({ WLD: 3 })),
    },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [{
      kind: 'free_spins',
      trigger: { by: 'scatter_count', thresholds: { '3': v.count ?? 10 } },
      global_multiplier: v.gm,
      modifiers: v.mod,
    }],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: v.rtp, vol: 'high', hit: 0.29 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(v.rtp, { base_game: 0.6, free_spins: 0.4 }),
  };
}

// Bonus games family (10)
const BONUS_VARIANTS = [
  { id: 'bonus-wheel-3tier',  name: 'Wheel Bonus 3-Tier+',   kind: 'wheel' },
  { id: 'bonus-wheel-5tier',  name: 'Wheel Bonus 5-Tier',    kind: 'wheel' },
  { id: 'bonus-pick-3of9',    name: 'Pick Bonus 3-of-9',     kind: 'pick' },
  { id: 'bonus-pick-5of12',   name: 'Pick Bonus 5-of-12',    kind: 'pick' },
  { id: 'bonus-map-3path',    name: 'Map Progression 3-Path', kind: 'pick' },
  { id: 'bonus-race-4lane',   name: 'Race Bonus 4-Lane',     kind: 'pick' },
  { id: 'bonus-race-6lane',   name: 'Race Bonus 6-Lane',     kind: 'pick' },
  { id: 'bonus-treasure',     name: 'Treasure Hunt Pick',    kind: 'pick' },
  { id: 'bonus-prize-board',  name: 'Prize Board Wheel',     kind: 'wheel' },
  { id: 'bonus-mystery-box',  name: 'Mystery Box Pick',      kind: 'pick' },
];

function buildBonus(v) {
  const featureBlock = v.kind === 'wheel' ? {
    kind: 'wheel',
    segments: [
      { id: 'seg-2x',  weight: 8, pay_multiplier: 2 },
      { id: 'seg-5x',  weight: 5, pay_multiplier: 5 },
      { id: 'seg-10x', weight: 3, pay_multiplier: 10 },
      { id: 'seg-25x', weight: 2, pay_multiplier: 25 },
      { id: 'seg-50x', weight: 1, pay_multiplier: 50 },
    ],
  } : {
    kind: 'pick',
    prize_pool: [
      { id: 'pick-2x',  weight: 8, pay_multiplier: 2 },
      { id: 'pick-5x',  weight: 5, pay_multiplier: 5 },
      { id: 'pick-10x', weight: 3, pay_multiplier: 10 },
      { id: 'pick-25x', weight: 2, pay_multiplier: 25 },
      { id: 'pick-50x', weight: 1, pay_multiplier: 50 },
    ],
  };
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — ${v.kind} bonus round.`,
      theme_tags: ['classic', 'bonus', v.kind],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: { mode: 'weighted', base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })) },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [featureBlock],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'medium', hit: 0.32 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.75, free_spins: 0.25 }),
  };
}

// Jackpot tiers family (10)
const JACKPOT_VARIANTS = [
  { id: 'jackpot-4tier-wap',     name: '4-Tier WAP Jackpot',           tiers: [25, 100, 500, 5000] },
  { id: 'jackpot-must-hit',      name: 'Must-Hit-By Jackpot',          tiers: [25, 100, 500, 2000] },
  { id: 'jackpot-linked',        name: 'Linked Progressive Jackpot',   tiers: [50, 200, 1000, 10000] },
  { id: 'jackpot-standalone',    name: 'Standalone Progressive',       tiers: [10, 50, 250, 1000] },
  { id: 'jackpot-5tier-mega',    name: '5-Tier Mega Jackpot',          tiers: [10, 50, 200, 1000, 25000] },
  { id: 'jackpot-3tier-basic',   name: '3-Tier Basic Jackpot',         tiers: [50, 250, 2500] },
  { id: 'jackpot-network-wap',   name: 'Network-Wide WAP Jackpot',     tiers: [100, 500, 5000, 100000] },
  { id: 'jackpot-instant',       name: 'Instant Trigger Jackpot',      tiers: [25, 100, 500, 2500] },
  { id: 'jackpot-mystery',       name: 'Mystery Jackpot Reveal',       tiers: [25, 100, 1000, 10000] },
  { id: 'jackpot-frenzy',        name: 'Jackpot Frenzy Multi',         tiers: [10, 25, 100, 500, 2500, 10000] },
];

function buildJackpot(v) {
  const labels = ['MINI', 'MINOR', 'MAJOR', 'GRAND', 'MEGA', 'ULTRA'];
  const tiers = v.tiers.map((mult, i) => ({ id: labels[i] || `T${i}`, multiplier: mult }));
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — ${v.tiers.length}-tier jackpot structure.`,
      theme_tags: ['classic', 'jackpot', 'wap'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: { mode: 'weighted', base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })) },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [{
      kind: 'hold_and_win',
      trigger: { by: 'bonus_count', min: 6 },
      respins_initial: 3,
      respin_reset_on_new: true,
      cash_value_distribution: [
        { value: 1, weight: 6 }, { value: 2, weight: 4 }, { value: 5, weight: 2 }, { value: 10, weight: 1 },
      ],
      jackpot_tiers: tiers,
    }],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'ultra', hit: 0.26 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.58, hold_and_win: 0.32, jackpot: 0.1 }),
  };
}

// Hybrid mechanics (10)
const HYBRID_VARIANTS = [
  { id: 'hybrid-megaways-hw',       name: 'Megaways + Hold & Win Hybrid' },
  { id: 'hybrid-cluster-fs',        name: 'Cluster + Free Spins Hybrid' },
  { id: 'hybrid-cascade-jackpot',   name: 'Cascade + Jackpot Hybrid' },
  { id: 'hybrid-fs-cluster',        name: 'Free Spins + Cluster Hybrid' },
  { id: 'hybrid-mystery-hw',        name: 'Mystery + Hold & Win Hybrid' },
  { id: 'hybrid-wheel-fs',          name: 'Wheel + Free Spins Hybrid' },
  { id: 'hybrid-pick-jackpot',      name: 'Pick + Jackpot Hybrid' },
  { id: 'hybrid-mega-wheel-fs',     name: 'Mega Wheel + FS Hybrid' },
  { id: 'hybrid-cascade-fs',        name: 'Cascade + FS Hybrid' },
  { id: 'hybrid-everything',        name: 'Everything-Hybrid Mega' },
];

function buildHybrid(v) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: v.id, name: v.name, version: '0.1.0',
      description: `${v.name} — multi-feature combination template.`,
      theme_tags: ['classic', 'hybrid', 'multi-feature'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 4 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: { mode: 'weighted', base: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 1 })) },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      { kind: 'free_spins', trigger: { by: 'scatter_count', thresholds: { '3': 10 } }, global_multiplier: 2, modifiers: ['sticky_wilds', 'multiplier_ladder'] },
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 6 }, { value: 2, weight: 4 }, { value: 5, weight: 2 }, { value: 10, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'MINI', multiplier: 25 }, { id: 'MINOR', multiplier: 100 },
          { id: 'MAJOR', multiplier: 500 }, { id: 'GRAND', multiplier: 2000 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'ultra', hit: 0.24 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.5, free_spins: 0.3, hold_and_win: 0.15, jackpot: 0.015 }),
  };
}

// Vendor B enhanced variants — 4 variants per M-gap (64 total)
const LW_M_GAPS = [
  { num: 1,  base: 'dragon-spin',         supplier: 'Vendor B Vendor H',          year: 2025 },
  { num: 2,  base: 'huff-puff',           supplier: 'Vendor B Vendor B',      year: 2025 },
  { num: 3,  base: 'fire-link',           supplier: 'Vendor B Vendor H',          year: 2025 },
  { num: 4,  base: 'dancing-drums',       supplier: 'Vendor B Shuffle Master', year: 2025 },
  { num: 5,  base: 'quick-hit',           supplier: 'Vendor B Vendor H',          year: 2025 },
  { num: 6,  base: 'cash-wheel',          supplier: 'Vendor B Vendor H',          year: 2026 },
  { num: 7,  base: 'spartacus',           supplier: 'Vendor B WMS',            year: 2025 },
  { num: 8,  base: 'goldfish',            supplier: 'Vendor B WMS',            year: 2025 },
  { num: 9,  base: 'big-bet',             supplier: 'Vendor B Barcrest',       year: 2025 },
  { num: 10, base: 'rr-megaways',         supplier: 'Vendor B Barcrest',       year: 2025 },
  { num: 11, base: 'player-elects',       supplier: 'Vendor B (multi-studio)', year: 2025 },
  { num: 12, base: 'munchkinland',        supplier: 'Vendor B WMS',            year: 2025 },
  { num: 13, base: 'woz-glinda',          supplier: 'Vendor B WMS',            year: 2026 },
  { num: 14, base: 'lotr-nested',         supplier: 'Vendor B WMS',            year: 2025 },
  { num: 15, base: 'rich-piggies',        supplier: 'Vendor B Vendor H',          year: 2025 },
  { num: 16, base: 'stellar-jackpots',    supplier: 'Vendor B Lightning Box',  year: 2025 },
];

const ENHANCEMENT_PROFILES = [
  { suffix: 'classic',   label: 'Classic Edition',    rtp: 0.955, vol: 'medium' },
  { suffix: 'premium',   label: 'Premium Edition',    rtp: 0.965, vol: 'high'   },
  { suffix: 'mega',      label: 'Mega Edition',       rtp: 0.97,  vol: 'ultra'  },
  { suffix: 'turbo',     label: 'Turbo Edition',      rtp: 0.95,  vol: 'low'    },
];

function buildLwEnhanced(gap, profile) {
  return {
    schema_version: '1.0.0',
    meta: {
      id: `lw-m${gap.num}-${profile.suffix}`,
      name: `M${gap.num} ${gap.base} ${profile.label}`,
      version: '0.1.0',
      description: `Enhanced variant of M${gap.num} ${gap.base} — ${profile.label} (${profile.vol} volatility).`,
      theme_tags: ['lw-template', `m${gap.num}`, 'enhanced', profile.suffix],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 1 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 2 })),
    },
    evaluation: { kind: 'lines', paylines: PAYLINES_20, direction: 'ltr', min_match: 3, pay_left_to_right_only: true },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      { kind: 'free_spins', trigger: { by: 'scatter_count', thresholds: { '3': 10 } }, global_multiplier: 2, modifiers: ['multiplier_ladder'] },
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 6 }, { value: 2, weight: 4 }, { value: 5, weight: 2 }, { value: 10, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'MINI', multiplier: 25 }, { id: 'MINOR', multiplier: 100 },
          { id: 'MAJOR', multiplier: 500 }, { id: 'GRAND', multiplier: 2000 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: profile.rtp, vol: profile.vol, hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(profile.rtp, { base_game: 0.5, free_spins: 0.3, hold_and_win: 0.2 }),
  };
}

/* ============================================================
   Registry
   ============================================================ */

const CATEGORIES = [
  {
    id: 'classic-lines', name: 'Classic Lines (5)', dir: 'classic-lines',
    description: 'Additional classic-lines variants (777, Liberty Bell, Fruit, Diamonds, Lucky 7).',
    items: CLASSIC_LINES_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildClassicLines(v) })),
  },
  {
    id: 'megaways', name: 'Megaways Family (10)', dir: 'megaways',
    description: 'Megaways variable-rows topology templates.',
    items: MEGAWAYS_VARIANTS.map((v) => ({ ...v, topology: 'variable_rows', build: () => buildMegaways(v) })),
  },
  {
    id: 'cluster', name: 'Cluster Family (10)', dir: 'cluster',
    description: 'Cluster-pay grid topology templates.',
    items: CLUSTER_VARIANTS.map((v) => ({ ...v, topology: 'cluster_grid', build: () => buildCluster(v) })),
  },
  {
    id: 'cascade', name: 'Cascade Family (10)', dir: 'cascade',
    description: 'Cascade/avalanche mechanics templates.',
    items: CASCADE_VARIANTS.map((v) => ({ ...v, topology: 'cluster_grid', build: () => buildCascade(v) })),
  },
  {
    id: 'holdwin', name: 'Hold & Win Family (10)', dir: 'holdwin',
    description: 'Lock-it-Link / Cash Fall / Coin Combo style Hold & Win.',
    items: HOLDWIN_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildHoldwin(v) })),
  },
  {
    id: 'freespins', name: 'Free Spins Family (15)', dir: 'freespins',
    description: 'Retrigger / sticky-wild / expanding-wild / mult-trail templates.',
    items: FREESPINS_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildFreespins(v) })),
  },
  {
    id: 'bonus', name: 'Bonus Games (10)', dir: 'bonus',
    description: 'Wheel / pick / map / race bonus templates.',
    items: BONUS_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildBonus(v) })),
  },
  {
    id: 'jackpot', name: 'Jackpot Tiers (10)', dir: 'jackpot',
    description: '4-tier WAP / Must-Hit-By / Linked / Standalone jackpot structures.',
    items: JACKPOT_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildJackpot(v) })),
  },
  {
    id: 'hybrid', name: 'Hybrid Mechanics (10)', dir: 'hybrid',
    description: 'Multi-feature combination templates.',
    items: HYBRID_VARIANTS.map((v) => ({ ...v, topology: 'rectangular', build: () => buildHybrid(v) })),
  },
  {
    id: 'lw-enhanced', name: 'Vendor B Enhanced Variants (64)', dir: 'lw-enhanced',
    description: 'Enhanced variants per Vendor B M-gap (16 gaps × 4 profiles = 64).',
    items: LW_M_GAPS.flatMap((gap) =>
      ENHANCEMENT_PROFILES.map((profile) => ({
        id: `lw-m${gap.num}-${profile.suffix}`,
        title: `M${gap.num} ${gap.base} ${profile.label}`,
        supplier: gap.supplier,
        year: gap.year,
        topology: 'rectangular',
        mGap: `M${gap.num}`,
        build: () => buildLwEnhanced(gap, profile),
      })),
    ),
  },
];

function validateAndWrite(absPath, ir, label) {
  const res = parseGameIR(ir);
  if (!res.ok) {
    console.error(`[ir-expansion] FAIL · ${label} · ${absPath}`);
    for (const issue of res.issues.slice(0, 6)) {
      console.error(`   - ${issue.path}: ${issue.message}`);
    }
    throw new Error(`IR validation failed for ${label}`);
  }
  if (DRY_RUN) {
    console.log(`[ir-expansion] DRY · ${label} valid`);
    return;
  }
  mkdirSync(dirname(absPath), { recursive: true });
  const json = JSON.stringify(ir, null, 2) + '\n';
  let prevSame = false;
  if (existsSync(absPath)) {
    try { prevSame = readFileSync(absPath, 'utf8') === json; } catch {}
  }
  if (!prevSame) writeFileSync(absPath, json);
}

function main() {
  console.log(`[ir-expansion] generator boot — DRY_RUN=${DRY_RUN}`);
  let total = 0;
  const indexCategories = [];
  for (const cat of CATEGORIES) {
    const catDir = resolve(OUT_DIR, cat.dir);
    const items = [];
    for (const item of cat.items) {
      const filename = `${item.id}.ir.json`;
      const ir = item.build();
      validateAndWrite(resolve(catDir, filename), ir, item.id);
      const entry = {
        id: item.id,
        file: `${cat.dir}/${filename}`,
        title: item.title ?? item.name,
        topology: item.topology,
      };
      if (item.supplier) entry.supplier = item.supplier;
      if (item.year) entry.year = item.year;
      if (item.mGap) entry.mGap = item.mGap;
      items.push(entry);
      total++;
    }
    indexCategories.push({
      id: cat.id, name: cat.name, description: cat.description, items,
    });
  }
  const idx = {
    schema_version: '1.0.0',
    generated_by: 'scripts/generate-ir-expansion.mjs',
    total_items: total,
    categories: indexCategories,
  };
  const idxPath = resolve(OUT_DIR, 'index-expansion.json');
  if (!DRY_RUN) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = JSON.stringify(idx, null, 2) + '\n';
    let prevSame = false;
    if (existsSync(idxPath)) {
      try { prevSame = readFileSync(idxPath, 'utf8') === json; } catch {}
    }
    if (!prevSame) writeFileSync(idxPath, json);
  }
  console.log(`[ir-expansion] done — ${total} additional IR templates validated`);
}

main();
