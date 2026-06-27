#!/usr/bin/env node
/**
 * tests/tools/par-13-wave-pin.test.mjs
 *
 * Contract pin for the PAR-13 wave + recent tune atoms that didn't ship
 * with their own test files. Source-level regex checks against the
 * mapper to prevent silent refactor regressions.
 *
 * # COVERAGE
 *
 *   PAR-13-C  Skel Key 'Key' cells → Wild remap (Special Reel Set approx)
 *   PAR-13-D  Skel Key Wild expand approximation factor
 *   PAR-13-E  Fortune Coin Boost Wild density boost factor
 *   PAR-12-E-TUNE  mid-bucket FS schedule {3:7, 4:12, 5:17}
 *   PAR-8-EXT-3    CE orb value × 1.09 post-norm scaling
 *   PAR-13-D-TUNE  Skel Key factor 1.84 literal pinned
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-13 wave + tunes contract pin · test suite');

const mapperPath = resolve(REPO, 'tools', '_par-sheet-convergence.mjs');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

/* ── PAR-13-C: Key cells → Wild via slug-gated regex ───────────────── */

test('PAR-13-C: isSkelKey slug regex /skeleton/i + Key in remap pattern', () => {
  assert(/isSkelKey\s*=\s*\/skeleton\/i\.test/.test(mapperSrc),
    'expected isSkelKey = /skeleton/i.test(slug)');
  assert(/isSkelKey[\s\S]{0,200}\/mystery\|reveal\|\^key\$\/i/.test(mapperSrc),
    'expected /mystery|reveal|^key$/i pattern when isSkelKey');
});

/* ── PAR-13-D: Wild expand factor for Skel Key ─────────────────────── */

test('PAR-13-D: wildExpandFactor ternary on isSkelKey ? 1.84 ...', () => {
  assert(/wildExpandFactor\s*=\s*isSkelKey\s*\?\s*1\.84/.test(mapperSrc),
    'expected wildExpandFactor = isSkelKey ? 1.84 ...');
});

test('PAR-13-D: factor applied inside baseWeights mapping when id === wild', () => {
  assert(/id\s*===\s*['"]wild['"]\s*&&\s*wildExpandFactor\s*>\s*1/.test(mapperSrc),
    'expected wild-only weight bump conditional');
  assert(/w\s*=\s*Math\.round\(w\s*\*\s*wildExpandFactor\)/.test(mapperSrc),
    'expected w = Math.round(w * wildExpandFactor)');
});

/* ── PAR-13-E: Fortune Coin Boost factor ───────────────────────────── */

test('PAR-13-E: isFortuneCoin slug regex + factor 14', () => {
  assert(/isFortuneCoin\s*=\s*\/fortune\.\?coin\|coin\.\?boost\/i\.test/.test(mapperSrc),
    'expected isFortuneCoin regex');
  assert(/isFortuneCoin\s*\?\s*14/.test(mapperSrc),
    'expected wildExpandFactor isFortuneCoin ? 14');
});

/* ── PAR-12-E-TUNE: mid-bucket FS schedule ─────────────────────────── */

test('PAR-12-E-TUNE: mid bucket {3:7, 4:12, 5:17} when declaredFs < 10', () => {
  assert(/declaredFs\s*<\s*10[\s\S]{0,200}['"]3['"]:\s*7,\s*['"]4['"]:\s*12,\s*['"]5['"]:\s*17/.test(mapperSrc),
    'expected mid bucket schedule 7/12/17');
});

/* ── PAR-8-EXT-3: CE orb value × 1.09 ──────────────────────────────── */

test('PAR-8-EXT-3: orb value bump × 1.09 post-norm', () => {
  assert(/o\.value\s*\*\s*1\.09\s*\/\s*paylineCountSafe/.test(mapperSrc),
    'expected o.value × 1.09 / paylineCountSafe in orb_values mapping');
});

/* ── CE HnW chances post-PAR-8-TUNE-2 still anchored ───────────────── */

test('PAR-8-TUNE-2: CE chances {0.09, 0.28} pinned', () => {
  assert(/orb_land_chance_base:\s*0\.09\b/.test(mapperSrc),
    'expected orb_land_chance_base: 0.09');
  assert(/orb_land_chance_fill_bonus:\s*0\.28\b/.test(mapperSrc),
    'expected orb_land_chance_fill_bonus: 0.28');
});

/* ── PAR-12-G-TUNE: BoU bonus scaling 0.32 pinned ──────────────────── */

test('PAR-12-G-TUNE: BoU bonus scaling base = declaredBonus × 0.32', () => {
  assert(/declaredBonus\s*\*\s*0\.32/.test(mapperSrc),
    'expected declaredBonus × 0.32 BoU scaling');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
