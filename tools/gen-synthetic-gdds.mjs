#!/usr/bin/env node
/**
 * tools/gen-synthetic-gdds.mjs — Wave UQ (Ultimate QA) atom U1
 *
 * Synthetic GDD generator. Emits a battery of vendor-neutral GDD test
 * fixtures into `tools/_qa/ultimate-fixtures/` that cross every
 * realistic industry pattern with every compatible grid kind. Each
 * fixture is a fully self-contained Markdown GDD that the existing
 * parser → buildSlotHTML → dist pipeline can ingest.
 *
 * Coverage axes:
 *   • Grid kind × industry pattern (~14 kinds × ~30 patterns where
 *     compatible — gridProfile veto matrix filters incompatible combos
 *     so we don't emit nonsense like "wheel + paylines")
 *   • Feature density tiers: MINIMAL (just trigger), STANDARD
 *     (industry-typical bundle), MAXIMAL (every compatible feature
 *     stacked) — proves both lean GDDs and feature-bloated GDDs render
 *   • Stress edge cases: zero-symbol roster, zero-feature list, exotic
 *     reels (1×1, 8×8, 12×12), missing typography, malformed sections
 *
 * Each emitted fixture has:
 *   • H1 game name
 *   • Topology table (Reels / Rows / Paylines / Evaluation)
 *   • Symbol roster (HP × N + MP × N + LP × N + specials)
 *   • Feature list with industry-standard kind labels
 *   • Pattern-specific sections (e.g. ## Bonus Buy, ## Wheel Bonus,
 *     ## Hold and Win) so the parser fires every extractor it can.
 *
 * Deterministic output — same inputs produce byte-identical fixtures
 * so git diff stays clean across re-runs.
 *
 * Usage:
 *   node tools/gen-synthetic-gdds.mjs            # writes ~60 fixtures
 *   node tools/gen-synthetic-gdds.mjs --print    # stdout one path/line
 *   node tools/gen-synthetic-gdds.mjs --list     # just print combo list
 *
 * Vendor-neutral: zero studio / title / franchise mentions anywhere.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT  = resolvePath(REPO, 'tools/_qa/ultimate-fixtures');

const ARGS       = new Set(process.argv.slice(2));
const PRINT_ONLY = ARGS.has('--print');
const LIST_ONLY  = ARGS.has('--list');

/* ── Grid kind catalog — must match `src/registry/gridProfile.mjs` ──
 * Each kind has a baseline topology + which evaluation modes are
 * native (used to skip emitting payline patterns onto a hex grid etc). */
const KINDS = Object.freeze({
  rectangular:                { reels: 5, rows: 3, evals: ['lines', 'ways', 'pay_anywhere'] },
  rectangular_stacked_scatter:{ reels: 5, rows: 4, evals: ['lines', 'ways'] },
  variable_reel:              { reels: 6, rows: 5, evals: ['ways'] },
  expanding:                  { reels: 5, rows: 3, evals: ['lines', 'ways'] },
  infinity:                   { reels: 3, rows: 3, evals: ['ways'] },
  dual:                       { reels: 5, rows: 4, evals: ['lines', 'ways'] },
  cluster:                    { reels: 7, rows: 7, evals: ['cluster'] },
  megaclusters:               { reels: 4, rows: 4, evals: ['cluster'] },
  hexagonal:                  { reels: 7, rows: 5, evals: ['cluster'] },
  diamond:                    { reels: 5, rows: 5, evals: ['pay_anywhere'] },
  pyramid:                    { reels: 5, rows: 3, evals: ['pay_anywhere'] },
  cross:                      { reels: 5, rows: 5, evals: ['pay_anywhere'] },
  l_shape:                    { reels: 5, rows: 5, evals: ['pay_anywhere'] },
  lock_respin:                { reels: 5, rows: 4, evals: ['lines'] },
  wheel:                      { reels: 0, rows: 0, evals: ['wheel'] },
  radial:                     { reels: 0, rows: 0, evals: ['wheel'] },
  crash:                      { reels: 0, rows: 0, evals: ['crash'] },
  plinko:                     { reels: 0, rows: 0, evals: ['plinko'] },
  slingo:                     { reels: 5, rows: 5, evals: ['slingo'] },
});

/* ── Industry pattern catalog ────────────────────────────────────────
 *
 * Each pattern declares:
 *   id          — short slug (used in filename)
 *   label       — human display
 *   description — single-line vendor-neutral summary
 *   features    — list of feature kind strings the parser recognises
 *   sections    — optional extra MD sections to emit (e.g. Bonus Buy
 *                  knobs, Wheel segments, Hold-and-win jackpots)
 *   compatible  — predicate(kind) → boolean (gates which grids the
 *                  pattern can ride on; respects gridProfile veto rules)
 *
 * Vendor-neutral language — describes mechanics by industry term
 * (cascade, Hold & Win, Buy Bonus, jackpot ladder), never by studio
 * or title. */
const PATTERNS = [
  {
    id: 'classic-lines',
    label: 'Classic Vegas line-pay',
    description: 'Fixed paylines + scatter-triggered Free Spins + simple wilds. Industry baseline 5×3.',
    features: ['free_spins', 'wild', 'multiplier'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines'),
  },
  {
    id: 'megaways-cascade',
    label: 'Modern Megaways cascade',
    description: 'Variable-reel ways evaluation + cascade + escalating multiplier on each cascade step.',
    features: ['cascade', 'ways', 'persistent_multiplier', 'free_spins'],
    sections: ['## Persistent Multiplier\nstartAt: 1\nincrementOnCascade: 1\nresetOnFsEnd: true'],
    compatible: (k) => k === 'variable_reel',
  },
  {
    id: 'cluster-pays',
    label: 'Cluster pays cascade',
    description: 'Cluster of 4+ adjacent symbols pays; cluster tumbles trigger a fresh evaluation.',
    features: ['cluster_pays', 'cascade', 'multiplier_orb'],
    sections: ['## Cluster\nminCluster: 4'],
    compatible: (k) => KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'hold-and-win',
    label: 'Hold & Win respin bonus',
    description: 'Scatter triggers a 3-respin Hold & Win round; jackpot tiers Mini / Minor / Major / Grand.',
    features: ['hold_and_win', 'respin', 'jackpot'],
    sections: [
      '## Hold and Win',
      '| Field | Value |',
      '|---|---|',
      '| **Respins** | 3 |',
      '| **Reset on collect** | 3 |',
      '| **Jackpot tiers** | Mini · Minor · Major · Grand |',
    ],
    compatible: (k) => k === 'lock_respin' || k === 'rectangular',
  },
  {
    id: 'bonus-buy',
    label: 'Bonus Buy (basic)',
    description: 'Player can purchase Free Spins entry; cost × bet, immediate trigger.',
    features: ['free_spins', 'bonus_buy'],
    sections: ['## Bonus Buy\ncostX: 75'],
    compatible: (k) => k !== 'wheel' && k !== 'radial' && k !== 'crash' && k !== 'plinko' && k !== 'slingo',
  },
  {
    id: 'bonus-buy-deterministic',
    label: 'Bonus Buy (deterministic tier picker)',
    description: 'STANDARD / PREMIUM / SUPER buy tiers — each plants explicit scatter positions.',
    features: ['free_spins', 'bonus_buy_deterministic'],
    sections: [
      '## Bonus Buy Tier',
      '| Tier | Cost | Plants | Mult |',
      '|---|--:|---|--:|',
      '| Standard | 75 | 3 scatters | 1× |',
      '| Premium | 150 | 4 scatters | 2× |',
      '| Super | 300 | 5 scatters | 3× |',
    ],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel',
  },
  {
    id: 'wheel-bonus',
    label: 'Wheel bonus with weighted segments',
    description: 'Scatter triggers a wheel; segments are non-uniformly weighted; 4 jackpot cells.',
    features: ['wheel_bonus', 'weighted_wheel_segments', 'jackpot'],
    sections: [
      '## Wheel Bonus',
      'segmentCount: 12',
      '## Weighted Wheel Segments',
      '| Segment | Value | Weight |',
      '|---|--:|--:|',
      '| 2× bet | 2 | 30 |',
      '| 5× bet | 5 | 20 |',
      '| MINI | jackpot | 5 |',
      '| MAJOR | jackpot | 1 |',
    ],
    compatible: (k) => k === 'rectangular' || k === 'wheel' || k === 'radial',
  },
  {
    id: 'tumble-multiplier',
    label: 'Tumble + multiplier orb',
    description: 'Cascade with multiplier-orb symbols that accumulate across the chain.',
    features: ['cascade', 'multiplier_orb', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('pay_anywhere') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'pay-anywhere',
    label: 'Pay-anywhere scatter',
    description: '8+ matching symbols anywhere on grid pay; cascade after.',
    features: ['scatter_pays', 'cascade'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'sticky-wild-fs',
    label: 'Sticky wild Free Spins',
    description: 'During FS, wilds stick across the remaining spins; standard scatter trigger.',
    features: ['free_spins', 'sticky_wild', 'wild'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'expanding-wild',
    label: 'Expanding wild reel',
    description: 'Wild landing expands to fill entire reel column.',
    features: ['expanding_wild', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'walking-wild',
    label: 'Walking wild',
    description: 'Wild moves one reel to the left on each FS spin; retriggers reset position.',
    features: ['walking_wild', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines'),
  },
  {
    id: 'mystery-symbol',
    label: 'Mystery symbol reveal',
    description: 'Mystery icons land then reveal a single matching paying symbol.',
    features: ['mystery_symbol', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'super-symbol',
    label: 'Super (colossal) symbol',
    description: '2×2 / 3×3 stacked symbol blocks for high-value HP icons.',
    features: ['super_symbol', 'free_spins'],
    sections: [],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel' || k === 'megaclusters',
  },
  {
    id: 'progressive-fs',
    label: 'Progressive FS multiplier',
    description: 'Multiplier escalates by +1 each FS spin; cap at 10×.',
    features: ['free_spins', 'progressive_free_spins'],
    sections: ['## Progressive Free Spins\nstartAt: 1\nincrement: 1\ncap: 10'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'lightning',
    label: 'Lightning multipliers',
    description: 'Random multiplier symbols zap during spin; sum of all hits.',
    features: ['lightning', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'gamble-card',
    label: 'Card gamble (red/black)',
    description: 'After win: optional risk on next card colour for ×2.',
    features: ['gamble'],
    sections: ['## Gamble\nmode: card'],
    compatible: (k) => k !== 'wheel' && k !== 'radial' && k !== 'crash' && k !== 'plinko',
  },
  {
    id: 'gamble-ladder',
    label: 'Ladder gamble',
    description: 'Climbing ladder gamble with steps for incremental risk; collect anytime.',
    features: ['gamble_secondary'],
    sections: ['## Gamble Ladder\nmaxRung: 10'],
    compatible: (k) => k !== 'wheel' && k !== 'radial' && k !== 'crash' && k !== 'plinko',
  },
  {
    id: 'ante-bet',
    label: 'Ante Bet (double scatter chance)',
    description: '25% extra cost boosts scatter trigger chance.',
    features: ['ante_bet', 'free_spins'],
    sections: [],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'bonus-pick',
    label: 'Pick-me bonus',
    description: 'Trigger opens a pick-from-grid bonus; each reveal a multiplier.',
    features: ['bonus_pick'],
    sections: ['## Bonus Pick\npickCount: 3\npoolSize: 9'],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel' || k === 'lock_respin',
  },
  {
    id: 'crash-curve',
    label: 'Crash multiplier curve',
    description: 'Curve grows until burst; player cashes out before crash.',
    features: ['crash'],
    sections: ['## Crash\npeakMultMax: 25'],
    compatible: (k) => k === 'crash',
  },
  {
    id: 'plinko-drop',
    label: 'Plinko ball drop',
    description: 'Single ball drops through peg field into a payout bucket.',
    features: ['plinko'],
    sections: ['## Plinko\nrows: 16'],
    compatible: (k) => k === 'plinko',
  },
  {
    id: 'slingo-board',
    label: 'Slingo board match',
    description: 'Strip generates numbers that mark a bingo board; match rows pay.',
    features: ['slingo', 'free_spins'],
    sections: [],
    compatible: (k) => k === 'slingo',
  },
  {
    id: 'win-cap-low',
    label: 'Win cap (low ceiling)',
    description: 'Hard win cap at 1000× bet — pay-anywhere style.',
    features: ['win_cap', 'scatter_pays', 'cascade'],
    sections: ['## Win Cap\nmaxWinX: 1000'],
    compatible: (k) => KINDS[k].evals.includes('pay_anywhere') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'maximalist',
    label: 'Maximalist — every compatible feature',
    description: 'Stacks every feature the grid supports — proves coexistence under feature bloat.',
    features: ['free_spins', 'wild', 'sticky_wild', 'multiplier_orb', 'cascade', 'bonus_buy', 'gamble', 'ante_bet', 'super_symbol'],
    sections: [
      '## Bonus Buy\ncostX: 75',
      '## Gamble\nmode: card',
      '## Multiplier Orb\nbonusAccumulate: true',
    ],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel',
  },
  {
    id: 'mult-bg-only',
    label: 'Base-game multiplier only',
    description: 'Base-game multiplier only — Free Spins phase is flat 1×.',
    features: ['multiplier', 'free_spins'],
    sections: ['## Base Multiplier\nappliesTo: base\nlocked: true'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'mult-fs-only',
    label: 'Free Spins multiplier only',
    description: 'Only Free Spins phase carries a multiplier; base-game is flat 1×.',
    features: ['free_spins', 'progressive_free_spins'],
    sections: ['## Base Multiplier\nappliesTo: base\nvalue: 1\nnote: BG = 1x; multiplier engages only inside Free Spins.'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'mult-bg-and-fs',
    label: 'BG + FS multiplier (FS progressive)',
    description: 'Both base-game and Free Spins carry a multiplier; FS multiplier is progressive.',
    features: ['multiplier', 'progressive_free_spins', 'free_spins'],
    sections: [
      '## Base Multiplier\nappliesTo: base',
      '## Progressive Free Spins\nstartAt: 1\nincrement: 1\ncap: 10',
    ],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'persistent-mult-bg',
    label: 'Persistent base-game multiplier',
    description: 'Multiplier persists across base-game spins; resets on session end.',
    features: ['multiplier', 'persistent_multiplier'],
    sections: ['## Persistent Multiplier\nappliesTo: base\nresetOn: session\nstartAt: 1\nincrement: 1'],
    compatible: (k) => KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'lightning-fs',
    label: 'Lightning multiplier (FS only)',
    description: 'Lightning multiplier symbols zap only during Free Spins; base-game flat.',
    features: ['lightning', 'free_spins'],
    sections: ['## Lightning\nappliesTo: fs\nnote: Lightning engages only inside Free Spins.'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'sticky-wild-bg',
    label: 'Sticky wilds in base game',
    description: 'Rare pattern — sticky wilds persist across base-game spins, not only Free Spins.',
    features: ['sticky_wild', 'wild'],
    sections: ['## Sticky Wild\nappliesTo: base\nresetOn: spin_after_stick'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'wild-reel-fs',
    label: 'Full wild reel (Free Spins)',
    description: 'During Free Spins, an entire reel can turn fully wild.',
    features: ['wild_reel', 'free_spins'],
    sections: ['## Wild Reel\nappliesTo: fs\ntriggerOn: random'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'nudging-wild',
    label: 'Nudging walking wild',
    description: 'Walking wild nudges 1 reel per spin; retrigger resets position.',
    features: ['walking_wild', 'free_spins'],
    sections: ['## Walking Wild\nnudgeStep: 1\nresetOnRetrigger: true'],
    compatible: (k) => KINDS[k].evals.includes('lines'),
  },
  {
    id: 'mystery-cluster',
    label: 'Mystery symbol on cluster pays',
    description: 'Mystery symbols land then reveal a matching paying icon; cluster cascade evaluates after reveal.',
    features: ['mystery_symbol', 'cluster_pays', 'cascade'],
    sections: ['## Mystery Symbol\nrevealsTo: single_payable\nresolveBefore: cluster_eval'],
    compatible: (k) => KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'super-symbol-fs',
    label: 'Colossal super-symbol in FS',
    description: 'Colossal 2×2 / 3×3 stacked symbol unlocks in Free Spins.',
    features: ['super_symbol', 'free_spins'],
    sections: ['## Super Symbol\nappliesTo: fs\nsizes: 2x2,3x3'],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel' || k === 'megaclusters',
  },
  {
    id: 'hold-in-fs',
    label: 'Hold & Win round inside Free Spins',
    description: 'Free Spins can spawn a Hold & Win sub-round triggered by 6+ bonus coins during FS.',
    features: ['free_spins', 'hold_and_win', 'respin'],
    sections: [
      '## Free Spins',
      '| Scatters | Spins |',
      '|--:|--:|',
      '| 3 | 14 |',
      '| 4 | 16 |',
      '| 5 | 18 |',
      '## Hold and Win',
      'triggerCount: 6\nappliesTo: fs\nrespinsAwarded: 3\nresetOnCollect: 3',
    ],
    compatible: (k) => k === 'rectangular' || k === 'lock_respin',
  },
  {
    id: 'bonus-buy-multi-tier',
    label: 'Bonus Buy — three tiers w/ FS multiplier',
    description: 'Standard / Premium / Super buy tiers; each plants explicit scatter counts and carries an FS multiplier.',
    features: ['bonus_buy', 'bonus_buy_deterministic', 'free_spins', 'progressive_free_spins'],
    sections: [
      '## Bonus Buy Tier',
      '| Tier | Cost | Plants | FS Mult |',
      '|---|--:|---|--:|',
      '| Standard | 75 | 3 scatters | 1× |',
      '| Premium | 150 | 4 scatters | 2× |',
      '| Super | 300 | 5 scatters | 3× |',
      '## Progressive Free Spins\nstartAt: 1\nincrement: 1\ncap: 10',
    ],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel',
  },
  {
    id: 'gamble-card-after-win',
    label: 'Card gamble after every win',
    description: 'Every win offers an optional red/black card gamble for ×2.',
    features: ['gamble'],
    sections: ['## Gamble\nmode: card\ntriggerOn: every_win'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'gamble-ladder-fs-totals',
    label: 'Ladder gamble on Free Spins totals',
    description: 'After Free Spins end, totals can be risked on a climbing ladder gamble.',
    features: ['gamble_secondary', 'free_spins'],
    sections: ['## Gamble Ladder\nappliesTo: fs_total\nmaxRung: 10'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'path-aware-mult-ways',
    label: 'Path-aware multiplier (ways)',
    description: 'Multiplier ladder is path-aware on a ways evaluator — different winning paths can carry different multipliers.',
    features: ['path_aware_multiplier', 'ways'],
    sections: ['## Path-Aware Multiplier\nappliesTo: ways\nladder: 1,2,3,5,10'],
    compatible: (k) => KINDS[k].evals.includes('ways'),
  },
  {
    id: 'win-cap-high',
    label: 'Win cap (high ceiling 25000×)',
    description: 'Hard win cap at 25000× bet — high enough that cap rarely fires.',
    features: ['win_cap', 'free_spins'],
    sections: ['## Win Cap\nmaxWinX: 25000'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('pay_anywhere') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'scatter-pay-hex',
    label: 'Scatter pays on hex grid',
    description: 'Hex / cluster grid evaluates 8+ matching scatter pays; cascade after.',
    features: ['scatter_pays', 'cascade'],
    sections: ['## Scatter Pays\nminMatch: 8\nappliesTo: grid'],
    compatible: (k) => k === 'hexagonal' || KINDS[k].evals.includes('cluster'),
  },
  {
    id: 'respin-on-anchor',
    label: 'Respin on anchor symbol',
    description: 'Anchor symbol locks in place and triggers a respin loop until no new anchor lands.',
    features: ['respin', 'wild'],
    sections: ['## Respin\ntriggerOn: anchor\nlockOnTrigger: true'],
    compatible: (k) => KINDS[k].evals.includes('lines') || KINDS[k].evals.includes('ways'),
  },
  {
    id: 'cascade-then-fs',
    label: 'Cascade in BG carries into Free Spins',
    description: 'Base-game uses cascade; Free Spins uses the same cascade evaluator.',
    features: ['cascade', 'free_spins'],
    sections: ['## Cascade\nappliesTo: base,fs'],
    compatible: (k) => KINDS[k].evals.includes('ways') || KINDS[k].evals.includes('pay_anywhere'),
  },
  {
    id: 'maximalist-fs-hold-mult',
    label: 'Maximalist — FS + Hold & Win + progressive mult + gamble',
    description: 'Cascade + sticky wild + multiplier orb + bonus buy + Hold & Win in FS + progressive FS multiplier + gamble.',
    features: ['cascade', 'sticky_wild', 'multiplier_orb', 'bonus_buy', 'free_spins', 'progressive_free_spins', 'hold_and_win', 'gamble'],
    sections: [
      '## Bonus Buy\ncostX: 100',
      '## Hold and Win\ntriggerCount: 6\nrespinsAwarded: 3',
      '## Progressive Free Spins\nstartAt: 1\nincrement: 1\ncap: 10',
      '## Gamble\nmode: card',
    ],
    compatible: (k) => k === 'rectangular' || k === 'variable_reel',
  },
  {
    id: 'minimalist',
    label: 'Minimalist — bare grid + minimal roster',
    description: 'Smallest viable GDD: name + grid + minimal symbol roster + Free Spins trigger only. Tests default fall-through across all blocks.',
    features: ['free_spins', 'wild', 'multiplier'],
    sections: [],
    minimal: true,
    compatible: () => true,
  },
];

/* ── Symbol roster (vendor-neutral) ──────────────────────────────────
 * Per-kind suggestions so the synthetic GDD reads naturally for the
 * grid it lives on. Cluster grids prefer geometric symbol IDs; SVG
 * kinds (wheel / crash / plinko) skip the roster since the engine
 * draws its own primitives. */
function rosterFor(kind, pattern) {
  if (pattern.minimal) {
    /* 2026-06-10 — Boki bug: minimalist with only 1 symbol triggered
       ❌ Symbols on the UI coverage report. Even a "minimal" GDD
       should still populate paytable rows; emit a thin but viable
       3-tier roster so paytable renders + confidence stays > 0.5. */
    return {
      high: [{ id: 'H1', name: 'Crystal' }, { id: 'H2', name: 'Ember' }],
      mid:  [{ id: 'A', name: 'Ace' }, { id: 'K', name: 'King' }],
      low:  [{ id: 'J', name: 'Jack' }, { id: '10', name: 'Ten' }],
      specials: [{ id: 'W', name: 'Wild' }],
    };
  }
  const isCluster = KINDS[kind].evals.includes('cluster');
  const isSvg = ['wheel', 'radial', 'crash', 'plinko'].includes(kind);
  if (isSvg) {
    /* 2026-06-10 — Boki bug "029 prevuko — crveni X, nema simbola".
       Previously SVG-only kinds (wheel/radial/crash/plinko) emitted ZERO
       symbols → parser confidence "not found" → red X markers in UI →
       Paytable empty → looks broken on screen even though the SVG
       primitive (wheel face, crash curve, plinko peg field) renders.
       Real wheel-bonus games still have a symbol roster for the
       trigger-from-base-game phase; emit a minimal vendor-neutral
       roster so confidence stays HIGH and paytable populates. */
    return {
      high: [
        { id: 'H1', name: 'Crown' }, { id: 'H2', name: 'Bell' },
      ],
      mid: [
        { id: 'A',  name: 'Ace' },   { id: 'K',  name: 'King' },
      ],
      low: [
        { id: 'J',  name: 'Jack' },  { id: '10', name: 'Ten' },
      ],
      specials: [
        { id: 'S', name: 'Scatter' },
      ],
    };
  }
  const base = isCluster
    ? { high: [
        { id: 'H1', name: 'Garnet' }, { id: 'H2', name: 'Emerald' }, { id: 'H3', name: 'Sapphire' },
      ], mid: [
        { id: 'M1', name: 'Topaz' }, { id: 'M2', name: 'Citrine' },
      ], low: [
        { id: 'L1', name: 'Amber' }, { id: 'L2', name: 'Slate' },
      ] }
    : { high: [
        { id: 'H1', name: 'Crystal' }, { id: 'H2', name: 'Ember' }, { id: 'H3', name: 'Frost' },
      ], mid: [
        { id: 'A',  name: 'Ace' }, { id: 'K',  name: 'King' }, { id: 'Q',  name: 'Queen' },
      ], low: [
        { id: 'J',  name: 'Jack' }, { id: '10', name: 'Ten' },
      ] };
  const specials = [];
  if (pattern.features.includes('wild') || pattern.features.includes('sticky_wild') ||
      pattern.features.includes('expanding_wild') || pattern.features.includes('walking_wild')) {
    specials.push({ id: 'W', name: 'Wild' });
  }
  if (pattern.features.includes('free_spins') || pattern.features.includes('progressive_free_spins') ||
      pattern.features.includes('scatter_pays') || pattern.features.includes('ante_bet') ||
      pattern.features.includes('bonus_buy') || pattern.features.includes('bonus_buy_deterministic')) {
    specials.push({ id: 'S', name: 'Scatter' });
  }
  if (pattern.features.includes('multiplier_orb')) specials.push({ id: 'M', name: 'Multiplier Orb' });
  if (pattern.features.includes('mystery_symbol')) specials.push({ id: 'MY', name: 'Mystery' });
  if (pattern.features.includes('lightning'))      specials.push({ id: 'L', name: 'Lightning' });
  if (pattern.features.includes('hold_and_win'))   specials.push({ id: 'B', name: 'Bonus Coin' });
  return { ...base, specials };
}

/* ── Renderer — emits a fully-formed GDD Markdown string ────────── */
function renderGDD(kind, pattern, idx) {
  const t = KINDS[kind];
  const sym = rosterFor(kind, pattern);
  const paylines = t.evals.includes('lines') ? Math.min(20, Math.max(10, t.reels * t.rows)) : 0;
  const evalLabel = t.evals[0] === 'lines'        ? 'Lines'
                  : t.evals[0] === 'ways'         ? 'Ways'
                  : t.evals[0] === 'cluster'      ? 'Cluster'
                  : t.evals[0] === 'pay_anywhere' ? 'Pay-Anywhere'
                  : t.evals[0];

  const out = [];
  const gameName = `Synth ${String(idx).padStart(3, '0')} ${pattern.label.replace(/\s*—\s*.*$/, '')}`;
  out.push(`# ${gameName}`);
  out.push('');
  /* 2026-06-10 — emit explicit Name line so PDF flow (which strips
     `|` separators) still surfaces the game name to parser.mjs. */
  out.push(`**Game name:** ${gameName}`);
  out.push('');
  out.push('| Field | Value |');
  out.push('|---|---|');
  out.push(`| **Internal name** | UQ-${kind}-${pattern.id} |`);
  out.push(`| **Genre** | ${pattern.id} |`);
  out.push(`| **Theme tags** | synthetic · vendor-neutral · QA fixture |`);
  out.push(`| **Mood** | balanced |`);
  out.push(`| **Setting** | abstract neon arcade |`);
  out.push(`| **Vibe refs** | retro · synthetic · QA |`);
  out.push(`| **Typography** | UI sans 14px |`);
  out.push('');
  /* PDF-flow-friendly prose form (pdfjs strips `|`). */
  out.push(`Mood: balanced.`);
  out.push(`Setting: abstract neon arcade backdrop.`);
  out.push(`Vibe references: retro · synthetic · QA.`);
  out.push('');
  out.push('## Topology');
  out.push('');
  out.push('| Field | Value |');
  out.push('|---|---|');
  /* 2026-06-10 — Boki bug "029 prevuko — crveni X". Em-dash placeholder
     for SVG-only kinds (wheel/radial/crash/plinko) confused the parser
     so it defaulted topology to 'rectangular' → SVG primitive never
     rendered → Paytable empty + confidence "not found". Emit a sane
     small number (1×1) for SVG kinds + explicit kind keyword so
     parser hits the right detection path. */
  out.push(`| **Reels** | ${t.reels || 1} |`);
  out.push(`| **Rows** | ${t.rows || 1} |`);
  out.push(`| **Paylines** | ${paylines || 1} |`);
  out.push(`| **Evaluation** | ${evalLabel} |`);
  out.push('');
  /* Explicit kind hint so parser topology detection NEVER mis-defaults
     to rectangular for SVG kinds. */
  if (['wheel', 'radial', 'crash', 'plinko', 'slingo'].includes(kind)) {
    out.push(`This game uses a ${kind} grid topology.`);
    out.push('');
  }
  if (sym.high.length > 0) {
    out.push('## Symbols');
    out.push('');
    out.push('### High-pay');
    out.push('| ID | Name |');
    out.push('|---|---|');
    for (const s of sym.high) out.push(`| \`${s.id}\` | ${s.name} |`);
    if (sym.mid.length > 0) {
      out.push('');
      out.push('### Mid-pay');
      out.push('| ID | Name |');
      out.push('|---|---|');
      for (const s of sym.mid) out.push(`| \`${s.id}\` | ${s.name} |`);
    }
    if (sym.low.length > 0) {
      out.push('');
      out.push('### Low-pay');
      out.push('| ID | Name |');
      out.push('|---|---|');
      for (const s of sym.low) out.push(`| \`${s.id}\` | ${s.name} |`);
    }
    if (sym.specials.length > 0) {
      out.push('');
      out.push('### Specials');
      out.push('| ID | Name |');
      out.push('|---|---|');
      for (const s of sym.specials) out.push(`| \`${s.id}\` | ${s.name} |`);
    }
    out.push('');
    /* 2026-06-10 — pdfjs strips `|` from cell separators so any pipe
       table becomes a number-stream after extract. Emit a redundant
       prose-form symbol roster (bullet list) so the parser also lights
       up via the alternative extractor path that scans `- \`ID\` Name`
       lines (PDF flow survives). */
    out.push('### Symbol Roster (parser-friendly fallback)');
    out.push('');
    for (const s of sym.high)     out.push(`- \`${s.id}\` — ${s.name} (HP)`);
    for (const s of sym.mid)      out.push(`- \`${s.id}\` — ${s.name} (MP)`);
    for (const s of sym.low)      out.push(`- \`${s.id}\` — ${s.name} (LP)`);
    for (const s of sym.specials) out.push(`- \`${s.id}\` — ${s.name} (Special)`);
    out.push('');
  }
  if (pattern.features.length > 0) {
    out.push('## Features');
    for (const f of pattern.features) {
      const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      out.push(`- ${label}`);
    }
    out.push('');
  }
  for (const sec of pattern.sections) {
    out.push(sec);
    out.push('');
  }
  /* 2026-06-09 — synthetic POOL has tiny symbol count (≤10), so default
     scatter weight gives ~10%/cell hit rate. With default retrigger
     enabled, FS rounds enter an infinite retrigger loop (cortex-eyes
     fleet walker debug confirmed: spinsTotal grows 15→20→25→… each
     spin while spinsRemaining barely ticks down). Synthetic fixtures
     test LIFECYCLE not balance, so we hard-disable retrigger for every
     emitted GDD that declares Free Spins. Hand-written sample GDDs
     stay untouched. */
  /* Always declare a Big-Win Tier ladder so the BW chip animates a
     visible tier walk for QA. Vendor-neutral placeholder labels. */
  out.push('## Big Win Tier');
  out.push('| Tier | Threshold (x bet) | Label |');
  out.push('|---|--:|---|');
  out.push('| 1 | 10 | BIGWINTIER1 |');
  out.push('| 2 | 25 | BIGWINTIER2 |');
  out.push('| 3 | 50 | BIGWINTIER3 |');
  out.push('| 4 | 200 | BIGWINTIER4 |');
  out.push('| 5 | 1000 | BIGWINTIER5 |');
  out.push('');
  if (pattern.features.includes('free_spins') ||
      pattern.features.includes('progressive_free_spins') ||
      pattern.features.includes('bonus_buy') ||
      pattern.features.includes('bonus_buy_deterministic') ||
      pattern.features.includes('ante_bet') ||
      pattern.features.includes('scatter_pays')) {
    /* 2026-06-09 — make synthetic FS rounds SHORT (5 spins, no retrigger)
       so the cortex-eyes fleet walker can verify the full lifecycle
       BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE inside its per-PDF
       budget. Real GDDs ship larger ladders (3/14, 4/16, 5/18); this
       only affects synthetic QA fixtures. */
    out.push('## Free Spins');
    out.push('');
    out.push('### Trigger');
    out.push('3+ Scatter symbols anywhere.');
    out.push('');
    out.push('### Award Table');
    out.push('| Scatters | Spins awarded |');
    out.push('|:---:|:---:|');
    out.push('| 3 | 5 |');
    out.push('| 4 | 5 |');
    out.push('| 5 | 5 |');
    out.push('');
    out.push('### Retrigger');
    out.push('No retrigger — synthetic QA fixture.');
    out.push('');
  }
  out.push('## Notes');
  out.push(`Synthetic fixture for Wave UQ Ultimate QA. Pattern: ${pattern.description}`);
  out.push('');
  return out.join('\n');
}

/* ── Combo expansion ────────────────────────────────────────────── */
function densitiesFor(pattern) {
  if (pattern.minimal) return ['min'];
  if (pattern.id === 'maximalist-fs-hold-mult') return ['std', 'max'];
  return ['std'];
}

function buildCombos() {
  const combos = [];
  let idx = 1;
  for (const pattern of PATTERNS) {
    for (const kind of Object.keys(KINDS)) {
      if (!pattern.compatible(kind)) continue;
      for (const density of densitiesFor(pattern)) {
        combos.push({ idx: idx++, pattern, kind, density });
      }
    }
  }
  return combos;
}

const combos = buildCombos();

if (LIST_ONLY) {
  for (const c of combos) {
    console.log(`${String(c.idx).padStart(3, '0')}  ${c.kind.padEnd(28)}  ${c.pattern.id}`);
  }
  console.log(`\n  ${combos.length} combos`);
  process.exit(0);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Clean previous run so deleted patterns don't leave stale files. */
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.md')) unlinkSync(resolvePath(OUT, f));
}

/* Feature → short camel label for filename encoding (Boki:
 * "nazovi PDF GDD-ove po featurima koje imaju, da znam sta gledam"). */
const FEATURE_LABEL = {
  free_spins: 'FS', free_spin: 'FS',
  cascade: 'Cascade', tumble: 'Cascade',
  multiplier_orb: 'MultOrb', multiplier: 'Mult',
  persistent_multiplier: 'PersistMult',
  progressive_free_spins: 'ProgFS',
  sticky_wild: 'StickyWild', expanding_wild: 'ExpandWild',
  walking_wild: 'WalkWild', wild_reel: 'WildReel', wild: 'Wild',
  mystery_symbol: 'Mystery', super_symbol: 'ColSym',
  hold_and_win: 'HoldAndWin', respin: 'Respin',
  bonus_buy: 'BonusBuy', bonus_buy_deterministic: 'BonusBuyDet',
  wheel_bonus: 'WheelBonus', weighted_wheel_segments: 'WeightedWheel',
  bonus_pick: 'BonusPick',
  gamble: 'Gamble', gamble_secondary: 'GambleLadder',
  ante_bet: 'AnteBet', lightning: 'Lightning',
  path_aware_multiplier: 'PathMult',
  ways: 'Ways', cluster_pays: 'ClusterPays', scatter_pays: 'ScatterPay',
  win_cap: 'WinCap', jackpot: 'Jackpot',
  crash: 'Crash', plinko: 'Plinko', slingo: 'Slingo',
  feature_generic: 'Feat',
};
const GRID_LABEL = {
  rectangular: 'RECT', rectangular_stacked_scatter: 'RECTSTACK',
  variable_reel: 'VARREEL', expanding: 'EXPAND', infinity: 'INF',
  dual: 'DUAL', cluster: 'CLUSTER', megaclusters: 'MEGA',
  hexagonal: 'HEX', diamond: 'DIA', pyramid: 'PYR', cross: 'CROSS',
  l_shape: 'LSHAPE', lock_respin: 'LOCK', wheel: 'WHEEL',
  radial: 'RADIAL', crash: 'CRASH', plinko: 'PLINKO', slingo: 'SLINGO',
};
function encodeFeatureFilename(c) {
  const gridSlug = GRID_LABEL[c.kind] || c.kind.toUpperCase();
  const feats = (c.pattern.features || []).map(f => FEATURE_LABEL[f] || _camel(f));
  const dedup = [];
  const seen = new Set();
  for (const f of feats) if (!seen.has(f)) { seen.add(f); dedup.push(f); }
  let featSeg;
  if (dedup.length === 0)        featSeg = 'BareGrid';
  else if (dedup.length <= 3)    featSeg = dedup.join('_');
  else                           featSeg = dedup.slice(0, 3).join('_') + '_+' + (dedup.length - 3);
  const densitySfx = c.density === 'min' ? '__min'
                   : c.density === 'max' ? '__max'
                   : '';
  return `${String(c.idx).padStart(3, '0')}__${gridSlug}__${featSeg}${densitySfx}.md`;
}
function _camel(s) {
  return String(s || '').split(/[\s_-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
}

const manifest = [];
for (const c of combos) {
  const filename = encodeFeatureFilename(c);
  const body = renderGDD(c.kind, c.pattern, c.idx);
  if (PRINT_ONLY) {
    console.log(`tools/_qa/ultimate-fixtures/${filename}`);
  } else {
    writeFileSync(resolvePath(OUT, filename), body, 'utf8');
  }
  manifest.push({
    idx: c.idx, file: filename, kind: c.kind, pattern: c.pattern.id,
    density: c.density, features: c.pattern.features,
  });
}

writeFileSync(
  resolvePath(OUT, '_manifest.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    count:       combos.length,
    fixtures:    manifest,
  }, null, 2) + '\n',
  'utf8',
);

console.log(`✓ Generated ${combos.length} synthetic GDD fixtures → tools/_qa/ultimate-fixtures/`);
const byKind = {};
const byPattern = {};
for (const m of manifest) {
  byKind[m.kind]       = (byKind[m.kind]       || 0) + 1;
  byPattern[m.pattern] = (byPattern[m.pattern] || 0) + 1;
}
console.log(`  Kinds:    ${Object.keys(byKind).length} (${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(', ')})`);
console.log(`  Patterns: ${Object.keys(byPattern).length}`);
