#!/usr/bin/env node
/**
 * Phase A — Test parser on real production GDDs.
 *
 * The only two files we are allowed to feed in:
 *   1. ~/Desktop/WoO-GDD/WRATH_OF_OLYMPUS_GAME_GDD.md
 *   2. ~/Desktop/CrystalForge-GDD/CRYSTAL_FORGE_GAME_GDD.md
 *
 * (Math GDD companions are read additively when present so RTP / max-win
 * land in the model.)
 *
 * What this asserts:
 *   - parser extracts name + topology + symbols + features (sanity floor)
 *   - resulting model maps cleanly into a SlotGameIR draft via the
 *     `@boki/slot-game-ir` canonical Zod schema (Phase 0)
 *   - every gap is logged with file + path + message so we can fix
 *
 * NOT a vitest — pure Node so it runs without dev deps installed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseGDD } from '../src/parser.mjs';
import { parseGameIR } from '../vendor/slot-game-ir/index.js';

const FIXTURES = [
  {
    label: 'Wrath of Olympus',
    game: resolve(homedir(), 'Desktop/WoO-GDD/WRATH_OF_OLYMPUS_GAME_GDD.md'),
    math: resolve(homedir(), 'Desktop/WoO-GDD/WRATH_OF_OLYMPUS_MATH_GDD.md'),
  },
  {
    label: 'Crystal Forge',
    game: resolve(homedir(), 'Desktop/CrystalForge-GDD/CRYSTAL_FORGE_GAME_GDD.md'),
    math: resolve(homedir(), 'Desktop/CrystalForge-GDD/CRYSTAL_FORGE_MATH_GDD.md'),
  },
];

function bar(ch = '─', n = 70) {
  return ch.repeat(n);
}

function parseFixture(fx) {
  if (!existsSync(fx.game)) {
    console.log(`✗ ${fx.label}: missing GAME GDD at ${fx.game}`);
    return null;
  }
  const gameText = readFileSync(fx.game, 'utf-8');
  const mathText = existsSync(fx.math) ? readFileSync(fx.math, 'utf-8') : '';
  // feed the combined text so the parser can pick math signals up too
  const combined = mathText ? gameText + '\n\n' + mathText : gameText;
  return parseGDD(combined, 'md');
}

function describe(model, label) {
  console.log(bar('='));
  console.log(`📄 ${label}`);
  console.log(bar('='));
  console.log(`name        : ${model.name}`);
  console.log(
    `topology    : ${model.topology.reels}×${model.topology.rows} · ${model.topology.paylines} lines  (conf ${model.confidence.topology.toFixed(2)})`
  );
  console.log(
    `theme tags  : ${model.theme.tags.join(', ') || '—'}  (mood: ${model.theme.mood || '—'})`
  );
  console.log(`palette     : ${model.theme.palette.join(' ') || '—'}`);
  const symTotal =
    model.symbols.high.length +
    model.symbols.mid.length +
    model.symbols.low.length +
    model.symbols.specials.length;
  console.log(
    `symbols     : ${symTotal} (HP=${model.symbols.high.length} MP=${model.symbols.mid.length} LP=${model.symbols.low.length} ★=${model.symbols.specials.length})  (conf ${model.confidence.symbols.toFixed(2)})`
  );
  console.log(
    `features (${model.features.length}): ${model.features.map(f => f.kind).join(', ') || '—'}  (conf ${model.confidence.features.toFixed(2)})`
  );
  console.log(
    `math        : RTP=${model.rtp ?? '—'}%  vol=${model.volatility ?? '—'}  maxWin=${model.maxWin ?? '—'}x  (conf ${model.confidence.math.toFixed(2)})`
  );
}

/** Build a minimal SlotGameIR candidate from the parsed model. */
function toIRDraft(model) {
  const allSyms = [
    ...model.symbols.high.map(s => ({ id: s.id, name: s.name, kind: 'hp' })),
    ...model.symbols.mid.map(s => ({ id: s.id, name: s.name, kind: 'hp' })),
    ...model.symbols.low.map(s => ({ id: s.id, name: s.name, kind: 'lp' })),
    ...model.symbols.specials.map(s => ({
      id: s.id,
      name: s.name,
      kind: /wild/i.test(s.name) ? 'wild' : 'scatter',
      ...(/wild/i.test(s.name) ? { substitutes: '*' } : {}),
    })),
  ];
  // dedup symbols by id (table parser may double-count "ID/Name" headers in some forms)
  const seen = new Set();
  const symbols = [];
  for (const s of allSyms) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    symbols.push(s);
  }
  if (symbols.length < 2) {
    // pad to satisfy Zod min(2) so we can see downstream gaps, not stop here
    symbols.push({ id: '_PAD_A', name: 'pad-A', kind: 'hp' });
    symbols.push({ id: '_PAD_B', name: 'pad-B', kind: 'lp' });
  }
  const allIds = symbols.map(s => s.id);
  const reelStrip = allIds;
  const reelsArr = Array.from({ length: model.topology.reels }, () => reelStrip);

  // paytable: assign trivial pays to every symbol (placeholder — math GDD
  // overlay comes later in Phase B)
  const paytable = {};
  for (const s of symbols) {
    paytable[s.id] = { 3: 1, 4: 2, 5: 5 };
  }

  // single dummy payline using middle row
  const middleRow = Math.floor(model.topology.rows / 2);
  const payline = Array.from({ length: model.topology.reels }, () => middleRow);

  return {
    schema_version: '1.0.0',
    meta: {
      id: model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: model.name,
      version: '0.1.0',
      theme_tags: model.theme.tags,
    },
    topology: {
      kind: 'rectangular',
      reels: model.topology.reels,
      rows: model.topology.rows,
    },
    symbols,
    reels: { mode: 'strips', base: reelsArr },
    evaluation: {
      kind: 'lines',
      paylines: [payline],
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    paytable,
    features: [], // map model.features → IR Feature in Phase B
    rng: { kind: 'pcg64', default_seed: 42 },
    bet: { currency: 'EUR', base_bet: 1.0, denominations: [0.1, 0.5, 1, 2, 5] },
    limits: {
      target_rtp: model.rtp != null ? model.rtp / 100 : 0.96,
      rtp_tolerance: 0.002,
      max_win_x: model.maxWin ?? 5000,
      win_cap_apply: 'per_spin',
      target_volatility: model.volatility ?? 'medium',
      hit_freq_target: 0.25,
    },
    compliance: {
      jurisdictions: ['UKGC'],
      rtp_range_required: [0.92, 0.98],
      max_win_cap_required: 10000,
      near_miss_rule: 'must_be_random',
      ldw_disclosure: true,
      session_time_display: true,
    },
    rtp_allocation: {
      base_game: model.rtp != null ? (model.rtp / 100) * 0.74 : 0.71,
      free_spins: model.rtp != null ? (model.rtp / 100) * 0.21 : 0.2,
      hold_and_win: 0.0,
      jackpot: model.rtp != null ? (model.rtp / 100) * 0.05 : 0.05,
      tolerance: 0.002,
    },
  };
}

let pass = 0;
let fail = 0;

for (const fx of FIXTURES) {
  console.log('\n');
  const model = parseFixture(fx);
  if (!model) {
    fail++;
    continue;
  }
  describe(model, fx.label);

  // floor sanity
  const symTotal =
    model.symbols.high.length +
    model.symbols.mid.length +
    model.symbols.low.length +
    model.symbols.specials.length;
  const floorOK =
    model.confidence.name >= 0.5 &&
    model.confidence.topology >= 0.4 &&
    symTotal >= 4 &&
    model.features.length >= 1;

  if (!floorOK) {
    console.log(`\n⚠ ${fx.label}: parser confidence floor NOT met`);
    fail++;
  } else {
    console.log(`\n✓ ${fx.label}: parser floor PASS`);
  }

  // try IR mapping
  const ir = toIRDraft(model);
  const result = parseGameIR(ir);
  if (result.ok) {
    console.log(`✓ ${fx.label}: maps cleanly into SlotGameIR via @boki/slot-game-ir`);
    pass++;
  } else {
    console.log(`✗ ${fx.label}: SlotGameIR gaps:`);
    for (const issue of result.issues) {
      console.log(`    /${issue.path.replaceAll('/', '/')}  ${issue.message}`);
    }
    fail++;
  }
}

console.log('\n' + bar('='));
console.log(`Summary: ${pass} pass / ${fail} fail`);
console.log(bar('='));
process.exit(fail > 0 ? 1 : 0);
