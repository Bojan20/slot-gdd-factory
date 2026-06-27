#!/usr/bin/env node
/**
 * generate-ir-library.mjs
 *
 * Idempotent generator for the studio IR library:
 *   - 16 Vendor B M-gap starter IRs   → web/studio/ir-library/lw-mgaps/
 *   - 10 industry-classic IRs    → web/studio/ir-library/classics/
 *   -  1 catalog index           → web/studio/ir-library/index.json
 *
 * The generator carries the canonical template-builder functions inline
 * so the same input always produces identical output (any rerun is a
 * no-op against `git diff`). Each emitted IR is validated against the
 * engine's Zod schema (`src/ir/schema.ts`) before write — a failed
 * validation aborts the script with a non-zero exit code.
 *
 * Usage:
 *   node scripts/generate-ir-library.mjs           # write IRs + index
 *   node scripts/generate-ir-library.mjs --dry-run # validate only
 *
 * Templates under `scripts/ir-templates/*.template.json` are reference
 * skeletons — humans edit them by hand to seed brand-new mechanics; the
 * generator does not auto-load them, so a stale template never silently
 * overwrites a curated IR.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGameIR } from '../dist/ir/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = resolve(REPO_ROOT, 'web/studio/ir-library');
const LW_DIR     = resolve(OUT_DIR, 'lw-mgaps');
const CLASSIC_DIR= resolve(OUT_DIR, 'classics');

const DRY_RUN = process.argv.includes('--dry-run');

/* ============================================================
   Shared building blocks
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
  ...STD_SYMBOLS_WITH_BONUS(),
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

const PAYLINES_25 = [
  ...PAYLINES_20,
  [1,0,1,1,1],[1,1,1,0,1],[2,1,2,1,2],[0,1,0,1,0],[1,2,1,2,1],
];

function reelsBase(reels, mapFactory) {
  return Array.from({ length: reels }, mapFactory);
}

function mkStdReelMap(extra = {}) {
  return { HP1: 2, HP2: 2, HP3: 3, HP4: 3, LP1: 6, LP2: 6, LP3: 7, LP4: 7, WLD: 1, SCT: 1, ...extra };
}

const STD_RNG  = () => ({ kind: 'mulberry32', default_seed: 42 });
const STD_BET  = () => ({ currency: 'EUR', base_bet: 1, denominations: [0.1, 1.0] });

function mkLimits({ target_rtp = 0.96, max_win_x = 5000, vol = 'high', hit = 0.30 } = {}) {
  return {
    target_rtp,
    rtp_tolerance: 0.01,
    max_win_x,
    win_cap_apply: 'per_spin',
    target_volatility: vol,
    hit_freq_target: hit,
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

/**
 * Build an rtp_allocation block whose buckets sum to target_rtp exactly
 * (within float ε). `weights` is a partial map of which buckets carry
 * positive mass; we normalise so the sum hits `target` precisely.
 */
function mkRtpAllocation(target, weights) {
  const keys = ['base_game', 'free_spins', 'hold_and_win', 'jackpot'];
  let total = 0;
  for (const k of keys) total += (weights[k] ?? 0);
  if (total <= 0) {
    return { base_game: target, free_spins: 0, hold_and_win: 0, jackpot: 0, tolerance: 0.01 };
  }
  const alloc = { base_game: 0, free_spins: 0, hold_and_win: 0, jackpot: 0, tolerance: 0.01 };
  let assigned = 0;
  const ordered = keys.filter((k) => (weights[k] ?? 0) > 0);
  for (let i = 0; i < ordered.length; i++) {
    const k = ordered[i];
    if (i === ordered.length - 1) {
      alloc[k] = +(target - assigned).toFixed(6);
    } else {
      const v = +((weights[k] / total) * target).toFixed(6);
      alloc[k] = v;
      assigned += v;
    }
  }
  return alloc;
}

/* ============================================================
   Vendor B M-gap IR builders (M1 → M16)
   ============================================================ */

function buildM1() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m1-starter',
      name: 'M1 Dragon Spin CrossLink Water',
      version: '0.1.0',
      description: 'Per-Reel Cash-Bag × Per-Row-Multiplier Coupled Accumulator starter — Dragon Spin style.',
      theme_tags: ['lw-template', 'm1', 'hold-and-win', 'composer'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 4 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 1 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 6 }, { value: 2, weight: 4 },
          { value: 5, weight: 2 }, { value: 10, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'MINI',  multiplier: 25 },
          { id: 'MINOR', multiplier: 100 },
          { id: 'MAJOR', multiplier: 500 },
          { id: 'GRAND', multiplier: 2000 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'high', hit: 0.27 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.68, hold_and_win: 0.32 }),
  };
}

function buildM2() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m2-starter',
      name: "M2 Huff N' Puff Frame Upgrade",
      version: '0.1.0',
      description: 'Multi-State Frame Upgrade Markov aggregator — Huff N\' Puff style frame escalation.',
      theme_tags: ['lw-template', 'm2', 'free-spins', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 1, MLT: 1 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8, '4': 12, '5': 20 } },
        global_multiplier: 1,
        modifiers: ['multiplier_ladder'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.935, vol: 'low', hit: 0.32 }),
    compliance: mkCompliance(['UKGC', 'MGA']),
    rtp_allocation: mkRtpAllocation(0.935, { base_game: 0.65, free_spins: 0.35 }),
  };
}

function buildM3() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m3-starter',
      name: 'M3 Ultimate Fire Link Grid-Expansion',
      version: '0.1.0',
      description: 'Dynamic Grid-Expansion Hold-and-Spin aggregator — Ultimate Fire Link / cascade-grid style.',
      theme_tags: ['lw-template', 'm3', 'cascade', 'aggregator'],
    },
    topology: { kind: 'cluster_grid', columns: 6, rows: 5, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(6, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'cluster',
      min_cluster_size: 5,
      cluster_pay_table: { '5': 1, '8': 3, '12': 10, '20': 50 },
    },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [
      { kind: 'cascade', replacement: 'drop', max_chain: 6, multiplier_progression: [1, 2, 3, 5, 8, 12] },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.955 }),
  };
}

function buildM4() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m4-starter',
      name: 'M4 Dancing Drums Explosion',
      version: '0.1.0',
      description: 'Deterministic Explosion Multiplier-Drop aggregator — Dancing Drums explosion mechanics.',
      theme_tags: ['lw-template', 'm4', 'free-spins', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ MLT: 2 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ MLT: 4 })),
    },
    evaluation: {
      kind: 'ways',
      direction: 'ltr',
      min_match: 3,
      max_ways_per_spin: 243,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8, '4': 12, '5': 18 } },
        global_multiplier: 2,
        modifiers: ['multiplier_ladder'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'high', hit: 0.29 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.62, free_spins: 0.38 }),
  };
}

function buildM5() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m5-starter',
      name: 'M5 Quick Hit Reel-Bound Mystery',
      version: '0.1.0',
      description: 'Reel-Bound Mystery Progressive — Quick Hit Platinum style mystery reveal mechanic.',
      theme_tags: ['lw-template', 'm5', 'mystery', 'base'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: [
      ...STD_SYMBOLS_RECT(),
      { id: 'MYS', name: 'Mystery', kind: 'mystery' },
    ],
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ MYS: 3 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'mystery_symbol',
        symbol_id: 'MYS',
        reveal_distribution: { HP1: 1, HP2: 1, HP3: 2, LP1: 3, LP2: 3 },
      },
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10 } },
        global_multiplier: 2,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'ultra', hit: 0.25 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.70, free_spins: 0.30 }),
  };
}

function buildM6() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m6-starter',
      name: 'M6 Triple Cash Wheel',
      version: '0.1.0',
      description: 'Stacked Multi-Wheel Composition aggregator — Vendor H Triple/Quick Hit Cash Wheel.',
      theme_tags: ['lw-template', 'm6', 'wheel', 'composer'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'ways',
      direction: 'ltr',
      min_match: 3,
      max_ways_per_spin: 243,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'wheel',
        segments: [
          { id: 'w_mini',   weight: 4, pay_multiplier: 5 },
          { id: 'w_minor',  weight: 3, pay_multiplier: 15 },
          { id: 'w_major',  weight: 2, pay_multiplier: 50 },
          { id: 'w_grand',  weight: 1, pay_multiplier: 250 },
          { id: 'w_2x',     weight: 4, pay_multiplier: 2 },
          { id: 'w_3x',     weight: 3, pay_multiplier: 3 },
          { id: 'w_5x',     weight: 2, pay_multiplier: 5 },
          { id: 'w_10x',    weight: 1, pay_multiplier: 10 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'high', hit: 0.27 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.72, free_spins: 0.28 }),
  };
}

function buildM7() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m7-starter',
      name: 'M7 Spartacus Colossal Reels',
      version: '0.1.0',
      description: 'Colossal Reels Wild-Transfer Two-Grid aggregator — WMS Spartacus dual-grid wild lockstep.',
      theme_tags: ['lw-template', 'm7', 'colossal', 'composer'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 4 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8, '4': 12, '5': 20 } },
        global_multiplier: 1,
        modifiers: ['sticky_wilds'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.66, free_spins: 0.34 }),
  };
}

function buildM8() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m8-starter',
      name: 'M8 Goldfish Race Competitive Pick',
      version: '0.1.0',
      description: 'Race/Competitive Pick One-Winner-Among-N aggregator — Goldfish race bonus.',
      theme_tags: ['lw-template', 'm8', 'pick', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'pick',
        prize_pool: [
          { id: 'fish_1',  weight: 8, pay_multiplier: 2  },
          { id: 'fish_2',  weight: 6, pay_multiplier: 5  },
          { id: 'fish_3',  weight: 4, pay_multiplier: 10 },
          { id: 'fish_4',  weight: 3, pay_multiplier: 25 },
          { id: 'fish_5',  weight: 2, pay_multiplier: 50 },
          { id: 'fish_6',  weight: 1, pay_multiplier: 200 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.945, vol: 'medium', hit: 0.31 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.945, { base_game: 0.78, free_spins: 0.22 }),
  };
}

function buildM9() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m9-starter',
      name: 'M9 Big Bet UK Paid-Package',
      version: '0.1.0',
      description: 'Big Bet Paid-Package Multi-Spin Schedule aggregator — Barcrest UK Big Bet.',
      theme_tags: ['lw-template', 'm9', 'free-spins', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
      free_spins: reelsBase(5, () => mkStdReelMap({ HP1: 4, HP2: 4 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 5 } },
        global_multiplier: 3,
      },
      {
        kind: 'buy_feature',
        offers: [
          { id: 'big_bet_30',  cost_x: 30,  guaranteed: '5-spin enhanced package' },
          { id: 'big_bet_50',  cost_x: 50,  guaranteed: '5-spin premium package' },
          { id: 'big_bet_100', cost_x: 100, guaranteed: '5-spin ultra package' },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.97, vol: 'ultra', hit: 0.24 }),
    compliance: mkCompliance(['UKGC']),
    rtp_allocation: mkRtpAllocation(0.97, { base_game: 0.60, free_spins: 0.40 }),
  };
}

function buildM10() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m10-starter',
      name: 'M10 RR Megaways Bonus Bank',
      version: '0.1.0',
      description: 'Bonus Bank Running-Balance Offset aggregator — Roaring Riches Megaways bank.',
      theme_tags: ['lw-template', 'm10', 'megaways', 'aggregator'],
    },
    topology: {
      kind: 'variable_rows',
      reels: 6,
      row_range_per_reel: [[2, 7], [2, 7], [2, 7], [2, 7], [2, 7], [2, 7]],
      ways_cap: 117649,
    },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(6, () => mkStdReelMap({ BNS: 1 })),
    },
    evaluation: {
      kind: 'ways',
      direction: 'ltr',
      min_match: 3,
      max_ways_per_spin: 117649,
    },
    paytable: {
      HP1: { '3': 5,   '4': 25,  '5': 100, '6': 500 },
      HP2: { '3': 4,   '4': 20,  '5': 80,  '6': 400 },
      HP3: { '3': 3,   '4': 15,  '5': 60,  '6': 300 },
      HP4: { '3': 2.5, '4': 12,  '5': 50,  '6': 250 },
      LP1: { '3': 1,   '4': 4,   '5': 15,  '6': 75  },
      LP2: { '3': 0.8, '4': 3,   '5': 12,  '6': 60  },
      LP3: { '3': 0.6, '4': 2.5, '5': 10,  '6': 50  },
      LP4: { '3': 0.5, '4': 2,   '5': 8,   '6': 40  },
    },
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10, '4': 15, '5': 25 } },
        retrigger: { by: 'scatter_count', thresholds: { '3': 5 }, max_total: 50 },
        global_multiplier: 1,
        modifiers: ['multiplier_ladder'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'ultra', hit: 0.22 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.55, free_spins: 0.45 }),
  };
}

function buildM11() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m11-starter',
      name: 'M11 Player-Elects Composition',
      version: '0.1.0',
      description: 'Player-Elects Feature Composition aggregator — pre-spin feature election.',
      theme_tags: ['lw-template', 'm11', 'cascade', 'composer'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 4 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 1, MLT: 1 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ BNS: 1, MLT: 3 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8 } },
        global_multiplier: 1,
        modifiers: ['multiplier_ladder', 'sticky_wilds'],
      },
      { kind: 'cascade', replacement: 'drop', max_chain: 5, multiplier_progression: [1, 2, 3, 5, 10] },
      { kind: 'ante_bet', extra_multiplier: 1.25, enabled_by_default: false },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'high', hit: 0.27 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.60, free_spins: 0.40 }),
  };
}

function buildM12() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m12-starter',
      name: 'M12 Munchkinland Random Injection',
      version: '0.1.0',
      description: 'Random Feature-Injection During FS aggregator — Munchkinland mid-FS modifier injection.',
      theme_tags: ['lw-template', 'm12', 'free-spins', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 1, MLT: 1 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 3 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8 } },
        global_multiplier: 1,
        modifiers: ['sticky_wilds', 'expanding_wilds', 'multiplier_ladder'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'medium', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.62, free_spins: 0.38 }),
  };
}

function buildM13() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m13-starter',
      name: 'M13 WOZ YBR Glinda Reshape',
      version: '0.1.0',
      description: 'Mid-Spin Random Reel-Reshape Mixture aggregator — WMS Wizard of Oz Glinda reshape.',
      theme_tags: ['lw-template', 'm13', 'cluster', 'composer'],
    },
    topology: { kind: 'cluster_grid', columns: 7, rows: 7, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(7, () => mkStdReelMap({ BNS: 1 })),
    },
    evaluation: {
      kind: 'cluster',
      min_cluster_size: 5,
      cluster_pay_table: { '5': 0.5, '8': 2, '12': 8, '16': 25, '20': 75 },
    },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [
      { kind: 'cascade', replacement: 'drop', max_chain: 8, multiplier_progression: [1, 2, 3, 5, 8, 12, 20, 50] },
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 12 } },
        global_multiplier: 1,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'ultra', hit: 0.25 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.65, free_spins: 0.35 }),
  };
}

function buildM14() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m14-starter',
      name: 'M14 LOTR Two Towers Nested Slot',
      version: '0.1.0',
      description: 'Nested Mini-Slot Inside Bonus compositional aggregator — Lord of the Rings nested bonus slot.',
      theme_tags: ['lw-template', 'm14', 'free-spins', 'composer'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
      free_spins: reelsBase(5, () => mkStdReelMap({ BNS: 3, HP1: 4 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10, '4': 15, '5': 25 } },
        global_multiplier: 2,
        modifiers: ['multiplier_ladder', 'sticky_wilds'],
      },
      {
        kind: 'pick',
        prize_pool: [
          { id: 'tower_orcs',   weight: 8, pay_multiplier: 5  },
          { id: 'tower_uruks',  weight: 4, pay_multiplier: 25 },
          { id: 'tower_nazgul', weight: 2, pay_multiplier: 100 },
          { id: 'tower_sauron', weight: 1, pay_multiplier: 500 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.965, vol: 'ultra', hit: 0.22 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.965, { base_game: 0.55, free_spins: 0.45 }),
  };
}

function buildM15() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m15-starter',
      name: 'M15 Rich Little Piggies Multi-Pot',
      version: '0.1.0',
      description: 'Multi-Pot Branched H&S Sub-Feature Selection aggregator — Vendor H Rich Little Piggies pots.',
      theme_tags: ['lw-template', 'm15', 'hold-and-win', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 4 },
    symbols: STD_SYMBOLS_WITH_BONUS_MULT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2, MLT: 1 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 6 }, { value: 2, weight: 5 },
          { value: 3, weight: 4 }, { value: 5, weight: 3 },
          { value: 10, weight: 2 }, { value: 25, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'POT_MINI',  multiplier: 20 },
          { id: 'POT_MINOR', multiplier: 80 },
          { id: 'POT_MAJOR', multiplier: 400 },
          { id: 'POT_GRAND', multiplier: 1500 },
        ],
        grid_full_award: 'POT_GRAND',
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'medium', hit: 0.26 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.65, hold_and_win: 0.35 }),
  };
}

function buildM16() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'lw-m16-starter',
      name: 'M16 Stellar Jackpots Arcade',
      version: '0.1.0',
      description: 'Arcade-Shooter Survival Level Progression aggregator — Lightning Box Stellar Jackpots wrapper.',
      theme_tags: ['lw-template', 'm16', 'jackpot', 'aggregator'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_25,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'wheel',
        segments: [
          { id: 'stellar_mini',  weight: 6, pay_multiplier: 10 },
          { id: 'stellar_minor', weight: 4, pay_multiplier: 50 },
          { id: 'stellar_major', weight: 2, pay_multiplier: 200 },
          { id: 'stellar_grand', weight: 1, pay_multiplier: 1000 },
          { id: 'stellar_5x',    weight: 5, pay_multiplier: 5 },
          { id: 'stellar_3x',    weight: 5, pay_multiplier: 3 },
        ],
      },
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 8 } },
        global_multiplier: 1,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.92, vol: 'low', hit: 0.34 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.92, { base_game: 0.55, free_spins: 0.20, jackpot: 0.25 }),
  };
}

/* ============================================================
   Industry-classic IR builders (10)
   ============================================================ */

function buildClassic5x3Lines() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-5x3-20lines',
      name: 'Classic 5x3 20 Lines',
      version: '0.1.0',
      description: 'Vegas-style 5x3 reels with 20 paylines and free-spin trigger.',
      theme_tags: ['classic', 'lines', 'rectangular'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10, '4': 15, '5': 20 } },
        global_multiplier: 2,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.70, free_spins: 0.30 }),
  };
}

function buildClassicMegaways() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-megaways-6reel',
      name: 'Megaways 6-Reel',
      version: '0.1.0',
      description: 'Variable-row 6-reel ways engine — classic Megaways topology with up to 117 649 ways.',
      theme_tags: ['classic', 'megaways', 'variable-rows'],
    },
    topology: {
      kind: 'variable_rows',
      reels: 6,
      row_range_per_reel: [[2, 7], [2, 7], [2, 7], [2, 7], [2, 7], [2, 7]],
      ways_cap: 117649,
    },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(6, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'ways',
      direction: 'ltr',
      min_match: 3,
      max_ways_per_spin: 117649,
    },
    paytable: {
      HP1: { '3': 5,   '4': 25,  '5': 100, '6': 500 },
      HP2: { '3': 4,   '4': 20,  '5': 80,  '6': 400 },
      HP3: { '3': 3,   '4': 15,  '5': 60,  '6': 300 },
      HP4: { '3': 2.5, '4': 12,  '5': 50,  '6': 250 },
      LP1: { '3': 1,   '4': 4,   '5': 15,  '6': 75  },
      LP2: { '3': 0.8, '4': 3,   '5': 12,  '6': 60  },
      LP3: { '3': 0.6, '4': 2.5, '5': 10,  '6': 50  },
      LP4: { '3': 0.5, '4': 2,   '5': 8,   '6': 40  },
    },
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 12 } },
        retrigger: { by: 'scatter_count', thresholds: { '3': 5 }, max_total: 50 },
        global_multiplier: 1,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'ultra', hit: 0.22 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.60, free_spins: 0.40 }),
  };
}

function buildClassicCluster() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-cluster-7x7',
      name: 'Classic Cluster 7x7',
      version: '0.1.0',
      description: '7x7 orthogonal cluster grid — classic Pragmatic / Net Ent cluster pay.',
      theme_tags: ['classic', 'cluster', 'orthogonal'],
    },
    topology: { kind: 'cluster_grid', columns: 7, rows: 7, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(7, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'cluster',
      min_cluster_size: 5,
      cluster_pay_table: { '5': 0.5, '8': 2, '12': 8, '16': 25, '20': 75 },
    },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10 } },
        global_multiplier: 1,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.70, free_spins: 0.30 }),
  };
}

function buildClassicCascadeMult() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-cascade-with-multiplier',
      name: 'Cascade with Multiplier Progression',
      version: '0.1.0',
      description: '6x5 cluster grid with cascade + multiplier ladder — classic tumble-multiplier mechanic.',
      theme_tags: ['classic', 'cascade', 'multiplier'],
    },
    topology: { kind: 'cluster_grid', columns: 6, rows: 5, adjacency: 'orthogonal' },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(6, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'cluster',
      min_cluster_size: 5,
      cluster_pay_table: { '5': 1, '8': 3, '12': 10, '20': 50 },
    },
    paytable: STD_PAYTABLE_CLUSTER(),
    features: [
      { kind: 'cascade', replacement: 'drop', max_chain: 6, multiplier_progression: [1, 2, 3, 5, 8, 12] },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.955, vol: 'high', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.955, { base_game: 0.955 }),
  };
}

function buildClassicHnW() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-hold-and-win',
      name: 'Hold and Win Classic',
      version: '0.1.0',
      description: 'Classic 5x3 hold-and-win with cash values + 2 jackpot tiers.',
      theme_tags: ['classic', 'hold-and-win'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'hold_and_win',
        trigger: { by: 'bonus_count', min: 6 },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: [
          { value: 1, weight: 5 }, { value: 2, weight: 3 },
          { value: 5, weight: 2 }, { value: 10, weight: 1 },
        ],
        jackpot_tiers: [
          { id: 'MINI',  multiplier: 25 },
          { id: 'MAJOR', multiplier: 100 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.25 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.70, hold_and_win: 0.30 }),
  };
}

function buildClassicFsRetrigger() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-free-spins-retrigger',
      name: 'Free Spins with Retrigger',
      version: '0.1.0',
      description: '5x3 free-spins bonus with scatter retrigger up to 50 spins total.',
      theme_tags: ['classic', 'free-spins', 'retrigger'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10 } },
        retrigger: { by: 'scatter_count', thresholds: { '3': 5 }, max_total: 50 },
        global_multiplier: 1,
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.68, free_spins: 0.32 }),
  };
}

function buildClassicWheel3Tier() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-wheel-bonus-3tier',
      name: 'Wheel Bonus 3-Tier',
      version: '0.1.0',
      description: '5x3 ways with 3-tier wheel bonus (Mini / Minor / Major segments).',
      theme_tags: ['classic', 'wheel', 'ways'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 1 })),
    },
    evaluation: {
      kind: 'ways',
      direction: 'ltr',
      min_match: 3,
      max_ways_per_spin: 243,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'wheel',
        segments: [
          { id: 'wheel_mini',  weight: 6, pay_multiplier: 10 },
          { id: 'wheel_minor', weight: 3, pay_multiplier: 50 },
          { id: 'wheel_major', weight: 1, pay_multiplier: 250 },
          { id: 'wheel_2x',    weight: 5, pay_multiplier: 2 },
          { id: 'wheel_3x',    weight: 4, pay_multiplier: 3 },
          { id: 'wheel_5x',    weight: 3, pay_multiplier: 5 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.95, vol: 'medium', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.95, { base_game: 0.70, free_spins: 0.30 }),
  };
}

function buildClassicPickBonus() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-pick-bonus-4of9',
      name: 'Pick Bonus 4-of-9',
      version: '0.1.0',
      description: '5x3 lines with pick-bonus prize pool — pick 4 of 9 to reveal prizes.',
      theme_tags: ['classic', 'pick', 'lines'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_WITH_BONUS(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap({ BNS: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'pick',
        prize_pool: [
          { id: 'pick_2x',  weight: 8, pay_multiplier: 2 },
          { id: 'pick_5x',  weight: 5, pay_multiplier: 5 },
          { id: 'pick_10x', weight: 3, pay_multiplier: 10 },
          { id: 'pick_25x', weight: 2, pay_multiplier: 25 },
          { id: 'pick_50x', weight: 1, pay_multiplier: 50 },
        ],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.945, vol: 'medium', hit: 0.32 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.945, { base_game: 0.78, free_spins: 0.22 }),
  };
}

function buildClassicStickyWilds() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-sticky-wilds-fs',
      name: 'Sticky Wilds Free Spins',
      version: '0.1.0',
      description: '5x3 lines with sticky-wild free-spin bonus.',
      theme_tags: ['classic', 'free-spins', 'sticky-wilds'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
      free_spins: reelsBase(5, () => mkStdReelMap({ WLD: 3 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10 } },
        global_multiplier: 1,
        modifiers: ['sticky_wilds'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.30 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.66, free_spins: 0.34 }),
  };
}

function buildClassicExpandingWilds() {
  return {
    schema_version: '1.0.0',
    meta: {
      id: 'classic-expanding-wilds-fs',
      name: 'Expanding Wilds Free Spins',
      version: '0.1.0',
      description: '5x3 lines with expanding-wild free-spin bonus — Book-of-style.',
      theme_tags: ['classic', 'free-spins', 'expanding-wilds'],
    },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: STD_SYMBOLS_RECT(),
    reels: {
      mode: 'weighted',
      base: reelsBase(5, () => mkStdReelMap()),
      free_spins: reelsBase(5, () => mkStdReelMap({ WLD: 2 })),
    },
    evaluation: {
      kind: 'lines',
      paylines: PAYLINES_20,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable: STD_PAYTABLE_LINES(),
    features: [
      {
        kind: 'free_spins',
        trigger: { by: 'scatter_count', thresholds: { '3': 10 } },
        global_multiplier: 1,
        modifiers: ['expanding_wilds'],
      },
    ],
    rng: STD_RNG(),
    bet: STD_BET(),
    limits: mkLimits({ target_rtp: 0.96, vol: 'high', hit: 0.28 }),
    compliance: mkCompliance(),
    rtp_allocation: mkRtpAllocation(0.96, { base_game: 0.64, free_spins: 0.36 }),
  };
}

/* ============================================================
   Index + driver
   ============================================================ */

const LW_GAPS = [
  { id: 'lw-m1',  file: 'M1-dragon-spin-crosslink-water.ir.json',      title: 'M1 Dragon Spin CrossLink Water',     supplier: 'Vendor B Vendor H',         year: 2024, topology: 'rectangular',   build: buildM1  },
  { id: 'lw-m2',  file: 'M2-huff-n-puff-frame-upgrade.ir.json',         title: "M2 Huff N' Puff Frame Upgrade",      supplier: 'Vendor B Vendor B',     year: 2024, topology: 'rectangular',   build: buildM2  },
  { id: 'lw-m3',  file: 'M3-ultimate-fire-link-grid-expansion.ir.json', title: 'M3 Ultimate Fire Link Grid-Expansion', supplier: 'Vendor B Vendor H',       year: 2024, topology: 'cluster_grid',  build: buildM3  },
  { id: 'lw-m4',  file: 'M4-dancing-drums-explosion.ir.json',           title: 'M4 Dancing Drums Explosion',         supplier: 'Vendor B Shuffle Master',year: 2024, topology: 'rectangular',   build: buildM4  },
  { id: 'lw-m5',  file: 'M5-quick-hit-reel-bound-mystery.ir.json',      title: 'M5 Quick Hit Reel-Bound Mystery',    supplier: 'Vendor B Vendor H',         year: 2024, topology: 'rectangular',   build: buildM5  },
  { id: 'lw-m6',  file: 'M6-triple-cash-wheel.ir.json',                 title: 'M6 Triple Cash Wheel',               supplier: 'Vendor B Vendor H',         year: 2026, topology: 'rectangular',   build: buildM6  },
  { id: 'lw-m7',  file: 'M7-spartacus-colossal-reels.ir.json',          title: 'M7 Spartacus Colossal Reels',        supplier: 'Vendor B WMS',           year: 2024, topology: 'rectangular',   build: buildM7  },
  { id: 'lw-m8',  file: 'M8-goldfish-race.ir.json',                     title: 'M8 Goldfish Race Competitive Pick',  supplier: 'Vendor B WMS',           year: 2025, topology: 'rectangular',   build: buildM8  },
  { id: 'lw-m9',  file: 'M9-big-bet-uk.ir.json',                        title: 'M9 Big Bet UK Paid-Package',         supplier: 'Vendor B Barcrest',      year: 2024, topology: 'rectangular',   build: buildM9  },
  { id: 'lw-m10', file: 'M10-rr-megaways-bonus-bank.ir.json',           title: 'M10 RR Megaways Bonus Bank',         supplier: 'Vendor B Barcrest',      year: 2025, topology: 'variable_rows', build: buildM10 },
  { id: 'lw-m11', file: 'M11-player-elects.ir.json',                    title: 'M11 Player-Elects Composition',      supplier: 'Vendor B (multi-studio)',year: 2025, topology: 'rectangular',   build: buildM11 },
  { id: 'lw-m12', file: 'M12-munchkinland.ir.json',                     title: 'M12 Munchkinland Random Injection',  supplier: 'Vendor B WMS',           year: 2025, topology: 'rectangular',   build: buildM12 },
  { id: 'lw-m13', file: 'M13-woz-glinda.ir.json',                       title: 'M13 WOZ YBR Glinda Reshape',         supplier: 'Vendor B WMS',           year: 2026, topology: 'cluster_grid',  build: buildM13 },
  { id: 'lw-m14', file: 'M14-lotr-nested.ir.json',                      title: 'M14 LOTR Two Towers Nested Slot',    supplier: 'Vendor B WMS',           year: 2025, topology: 'rectangular',   build: buildM14 },
  { id: 'lw-m15', file: 'M15-rich-piggies.ir.json',                     title: 'M15 Rich Little Piggies Multi-Pot',  supplier: 'Vendor B Vendor H',         year: 2025, topology: 'rectangular',   build: buildM15 },
  { id: 'lw-m16', file: 'M16-stellar-jackpots.ir.json',                 title: 'M16 Stellar Jackpots Arcade',        supplier: 'Vendor B Lightning Box', year: 2025, topology: 'rectangular',   build: buildM16 },
];

const CLASSICS = [
  { id: 'classic-5x3-20lines',           file: 'classic-5x3-20lines.ir.json',           title: 'Classic 5x3 20 Lines',                topology: 'rectangular', build: buildClassic5x3Lines      },
  { id: 'classic-megaways-6reel',        file: 'megaways-6reel.ir.json',                title: 'Megaways 6-Reel',                     topology: 'variable_rows', build: buildClassicMegaways    },
  { id: 'classic-cluster-7x7',           file: 'cluster-7x7.ir.json',                   title: 'Classic Cluster 7x7',                 topology: 'cluster_grid', build: buildClassicCluster      },
  { id: 'classic-cascade-with-mult',     file: 'cascade-with-multiplier.ir.json',       title: 'Cascade with Multiplier Progression', topology: 'cluster_grid', build: buildClassicCascadeMult  },
  { id: 'classic-hold-and-win',          file: 'hold-and-win-classic.ir.json',          title: 'Hold and Win Classic',                topology: 'rectangular', build: buildClassicHnW           },
  { id: 'classic-fs-retrigger',          file: 'free-spins-retrigger.ir.json',          title: 'Free Spins with Retrigger',           topology: 'rectangular', build: buildClassicFsRetrigger   },
  { id: 'classic-wheel-3tier',           file: 'wheel-bonus-3tier.ir.json',             title: 'Wheel Bonus 3-Tier',                  topology: 'rectangular', build: buildClassicWheel3Tier    },
  { id: 'classic-pick-4of9',             file: 'pick-bonus-4-of-9.ir.json',             title: 'Pick Bonus 4-of-9',                   topology: 'rectangular', build: buildClassicPickBonus     },
  { id: 'classic-sticky-wilds-fs',       file: 'sticky-wilds-fs.ir.json',               title: 'Sticky Wilds Free Spins',             topology: 'rectangular', build: buildClassicStickyWilds   },
  { id: 'classic-expanding-wilds-fs',    file: 'expanding-wilds-fs.ir.json',            title: 'Expanding Wilds Free Spins',          topology: 'rectangular', build: buildClassicExpandingWilds},
];

function validateAndWrite(absPath, ir, label) {
  const res = parseGameIR(ir);
  if (!res.ok) {
    console.error(`[ir-library] FAIL · ${label} · ${absPath}`);
    for (const issue of res.issues.slice(0, 6)) {
      console.error(`   - ${issue.path}: ${issue.message}`);
    }
    throw new Error(`IR validation failed for ${label}`);
  }
  if (DRY_RUN) {
    console.log(`[ir-library] DRY · ${label} valid (${res.unknown_keys.length} unknown keys)`);
    return;
  }
  mkdirSync(dirname(absPath), { recursive: true });
  const json = JSON.stringify(ir, null, 2) + '\n';
  let prevSame = false;
  if (existsSync(absPath)) {
    try {
      const prev = readFileSync(absPath, 'utf8');
      prevSame = prev === json;
    } catch {
      // ignore — fall through and overwrite.
    }
  }
  if (!prevSame) {
    writeFileSync(absPath, json);
  }
  const relPath = relative(REPO_ROOT, absPath);
  console.log(`[ir-library]  OK · ${label.padEnd(42)} → ${relPath}${prevSame ? ' (unchanged)' : ''}`);
}

function main() {
  console.log(`[ir-library] generator boot — DRY_RUN=${DRY_RUN}`);
  // Vendor B M-gaps
  for (const entry of LW_GAPS) {
    const ir = entry.build();
    validateAndWrite(resolve(LW_DIR, entry.file), ir, entry.id);
  }
  // Industry classics
  for (const entry of CLASSICS) {
    const ir = entry.build();
    validateAndWrite(resolve(CLASSIC_DIR, entry.file), ir, entry.id);
  }
  // Index
  const index = {
    schema_version: '1.0.0',
    generated_by: 'scripts/generate-ir-library.mjs',
    total_items: LW_GAPS.length + CLASSICS.length,
    categories: [
      {
        id: 'lw-mgaps',
        name: 'Vendor B M-Gaps (16)',
        description: 'Vendor B mehanika M1-M16 starter IRs — closed-form solvers under W181–W196.',
        items: LW_GAPS.map((g, i) => ({
          id: g.id,
          file: `lw-mgaps/${g.file}`,
          title: g.title,
          supplier: g.supplier,
          year: g.year,
          topology: g.topology,
          mGap: `M${i + 1}`,
        })),
      },
      {
        id: 'classics',
        name: 'Industry Classics (10)',
        description: 'Cross-supplier classic mechanics — Vegas lines, Megaways, cluster, cascade, H&W, wheel, pick, sticky/expanding wilds.',
        items: CLASSICS.map((c) => ({
          id: c.id,
          file: `classics/${c.file}`,
          title: c.title,
          topology: c.topology,
        })),
      },
    ],
  };
  const indexPath = resolve(OUT_DIR, 'index.json');
  if (!DRY_RUN) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = JSON.stringify(index, null, 2) + '\n';
    let prevSame = false;
    if (existsSync(indexPath)) {
      try {
        prevSame = readFileSync(indexPath, 'utf8') === json;
      } catch {
        prevSame = false;
      }
    }
    if (!prevSame) writeFileSync(indexPath, json);
    console.log(`[ir-library]  OK · index.json (${LW_GAPS.length + CLASSICS.length} items)${prevSame ? ' (unchanged)' : ''}`);
  } else {
    console.log(`[ir-library] DRY · index.json (${LW_GAPS.length + CLASSICS.length} items)`);
  }
  console.log(`[ir-library] done — ${LW_GAPS.length} Vendor B + ${CLASSICS.length} classics validated`);
}

main();
