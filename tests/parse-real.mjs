#!/usr/bin/env node
/**
 * Phase A — Test parser on real production GAME GDDs (math is out of scope).
 *
 * Fixtures live in samples/ (in-repo, portable). Math GDD companions are
 * EXPLICITLY ignored — Boki decree:
 *   "nikakva matematika se ne radi dok ne odradimo savrseno game gdd".
 *
 * What this asserts:
 *   - parser extracts name + topology + symbols + features (sanity floor)
 *
 * NOT a vitest — pure Node so it runs without dev deps installed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const SAMPLES = resolve(REPO, 'samples');

const FIXTURES = [
  { label: 'Wrath of Olympus',                       game: resolve(SAMPLES, 'WRATH_OF_OLYMPUS_GAME_GDD.md') },
  { label: 'Crystal Forge',                          game: resolve(SAMPLES, 'CRYSTAL_FORGE_GAME_GDD.md') },
  { label: 'Midnight Fangs (cluster-pays synthetic)', game: resolve(SAMPLES, 'MIDNIGHT_FANGS_GAME_GDD.md') },
  { label: 'Gates of Olympus 1000 (Pay-Anywhere)',   game: resolve(SAMPLES, 'GATES_OF_OLYMPUS_1000_GAME_GDD.md') },
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
  const layoutTail = model.topology.evaluation === 'cluster'
    ? 'cluster pays'
    : `${model.topology.paylines ?? '—'} lines`;
  console.log(
    `topology    : ${model.topology.reels}×${model.topology.rows} · ${layoutTail}  (eval=${model.topology.evaluation})  (conf ${model.confidence.topology.toFixed(2)})`
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
