#!/usr/bin/env node
/**
 * Phase A — Test parser on real production GAME GDDs (math is out of scope).
 *
 * The only two files we feed in:
 *   1. ~/Desktop/WoO-GDD/WRATH_OF_OLYMPUS_GAME_GDD.md
 *   2. ~/Desktop/CrystalForge-GDD/CRYSTAL_FORGE_GAME_GDD.md
 *
 * Math GDD companions are EXPLICITLY ignored — Boki decree:
 * "nikakva matematika se ne radi dok ne odradimo savrseno game gdd".
 *
 * What this asserts:
 *   - parser extracts name + topology + symbols + features (sanity floor)
 *
 * NOT a vitest — pure Node so it runs without dev deps installed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseGDD } from '../src/parser.mjs';

const FIXTURES = [
  {
    label: 'Wrath of Olympus',
    game: resolve(homedir(), 'Desktop/WoO-GDD/WRATH_OF_OLYMPUS_GAME_GDD.md'),
  },
  {
    label: 'Crystal Forge',
    game: resolve(homedir(), 'Desktop/CrystalForge-GDD/CRYSTAL_FORGE_GAME_GDD.md'),
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
  return parseGDD(gameText, 'md');
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

  // floor sanity — game-only fields
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
    pass++;
  }
}

console.log('\n' + bar('='));
console.log(`Summary: ${pass} pass / ${fail} fail`);
console.log(bar('='));
process.exit(fail > 0 ? 1 : 0);
