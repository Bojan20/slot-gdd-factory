#!/usr/bin/env node
/**
 * tests/tools/par-14-e-6-coin-boost-mults.test.mjs
 *
 * PAR-14-E #6 contract test — Fortune Coin Boost Coin Boost multiplier
 * extractor.
 *
 * # COVERAGE
 *
 *   - extractCoinBoostMultipliers(wb) is exported from
 *     tools/_par-sheet-to-model.mjs.
 *   - Against FCB par_001, returns {1×:3000, 2×:250, 3×:125} (verified
 *     directly from `ENHANCED_CE_0` weight table).
 *   - Source provenance carries sheet name + row + col so receipt
 *     `confidence._derivedBy.coinBoostMultipliers` lands non-empty.
 *   - Mapper `_par-sheet-convergence.mjs` reads
 *     `model.par_sheet.coinBoostMultipliers` and emits
 *     `coin_boost_multipliers: [{value, weight}]` payload (schema must
 *     match sister's CoinBoostMultiplier struct exactly — `value`, not
 *     `multiplier`, or daemon returns 422).
 *   - Empty-array fallback when par_sheet has no extractor result —
 *     non-FCB games stay zero-impact.
 *
 * NOTE: The FCB par sheet is in the sister repo under
 *   ~/Projects/slot-math-engine-template/games/fortune-coin-boost-classic/raw/
 * If absent (e.g. CI without sister checkout), the par-sheet asserts
 * are skipped (not failed) — the source-regex assertions still run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-14-E #6 Coin Boost multiplier extractor · contract test');

const modelPath = resolve(REPO, 'tools', '_par-sheet-to-model.mjs');
const mapperPath = resolve(REPO, 'tools', '_par-sheet-convergence.mjs');
const modelSrc = readFileSync(modelPath, 'utf-8');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

/* ── A: extractor exported ───────────────────────────────────────── */

test('A1: extractCoinBoostMultipliers is exported', () => {
  assert(/export\s+function\s+extractCoinBoostMultipliers\s*\(\s*wb\s*\)/.test(modelSrc),
    'expected export function extractCoinBoostMultipliers(wb)');
});

test('A2: extractor anchored on ENHANCED_CE_0 label', () => {
  assert(/LEVEL_LABEL_RX\s*=\s*\/\^\\s\*ENHANCED_CE_0/.test(modelSrc),
    'expected LEVEL_LABEL_RX matching ENHANCED_CE_0');
});

test('A3: extractor multiplier name regex \\dX form', () => {
  assert(/MULT_RX\s*=\s*\/\^\\s\*\(\\d\+\)\\s\*\[xX\]/.test(modelSrc),
    'expected MULT_RX matching \\dX form');
});

/* ── B: model emitter wires output ───────────────────────────────── */

test('B1: model emitter calls extractor', () => {
  assert(/const\s+coinBoostMultipliers\s*=\s*extractCoinBoostMultipliers\(wb\)/.test(modelSrc),
    'expected coinBoostMultipliers variable assignment');
});

test('B2: model.par_sheet.coinBoostMultipliers field emitted', () => {
  assert(/coinBoostMultipliers\.multipliers[\s\S]{0,80}coinBoostMultipliers:\s*coinBoostMultipliers\.multipliers/.test(modelSrc),
    'expected par_sheet.coinBoostMultipliers field plumbing');
});

test('B3: confidence._derivedBy.coinBoostMultipliers receipt', () => {
  assert(/coinBoostMultipliers:\s*coinBoostMultipliers\.source[\s\S]{0,100}ENHANCED_CE_0/.test(modelSrc),
    'expected confidence receipt with ENHANCED_CE_0 marker');
});

/* ── C: mapper consumes + schema match sister-side ───────────────── */

test('C1: mapper reads model.par_sheet.coinBoostMultipliers', () => {
  assert(/model\.par_sheet\?\.coinBoostMultipliers/.test(mapperSrc),
    'expected mapper to read coinBoostMultipliers from par_sheet');
});

test('C2: mapper emits {value, weight} sister schema (not {multiplier, weight})', () => {
  /* Sister-side struct field is `value: u32`, mapping mistake → 422. */
  const reMatch = mapperSrc.match(/coin_boost_multipliers:\s*\(\(\)\s*=>\s*\{[\s\S]{50,800}?\}\)\(\)/);
  assert(reMatch, 'expected coin_boost_multipliers IIFE block');
  const block = reMatch[0];
  assert(/value:\s*Math\.max\(1,\s*Math\.round/.test(block),
    'expected `value:` field (sister CoinBoostMultiplier.value: u32)');
  assert(/weight:\s*Math\.max\(0,\s*Math\.round/.test(block),
    'expected `weight:` field (sister CoinBoostMultiplier.weight: u32)');
});

test('C3: empty-array fallback when extractor absent', () => {
  const reMatch = mapperSrc.match(/coin_boost_multipliers:\s*\(\(\)\s*=>\s*\{[\s\S]{50,800}?\}\)\(\)/);
  assert(reMatch, 'expected IIFE block');
  assert(/return\s+\[\];/.test(reMatch[0]),
    'expected return [] when mults is null/empty (non-FCB games stay zero-impact)');
});

/* ── D: live extraction against FCB par sheet (skip if absent) ─── */

const FCB_PAR = resolve(
  process.env.HOME,
  'Projects/slot-math-engine-template/games/fortune-coin-boost-classic/raw/ParSheets_FortuneCoinBoost_Classic.xlsx'
);

if (existsSync(FCB_PAR)) {
  await testAsync('D1: live extract FCB par sheet → {1×:3000, 2×:250, 3×:125}', async () => {
    const { extractCoinBoostMultipliers } = await import(modelPath);
    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.readFile(FCB_PAR);
    const res = extractCoinBoostMultipliers(wb);
    assert(Array.isArray(res.multipliers), 'expected array');
    assert(res.multipliers.length === 3, `expected 3 multiplier entries, got ${res.multipliers.length}`);
    const byMult = Object.fromEntries(res.multipliers.map((m) => [m.multiplier, m.weight]));
    assert(byMult[1] === 3000, `expected 1×=3000, got ${byMult[1]}`);
    assert(byMult[2] === 250, `expected 2×=250, got ${byMult[2]}`);
    assert(byMult[3] === 125, `expected 3×=125, got ${byMult[3]}`);
    assert(res.confidence >= 0.85, `expected confidence ≥ 0.85, got ${res.confidence}`);
    assert(res.source.sheet === 'par_001', `expected sheet par_001, got ${res.source.sheet}`);
  });
} else {
  console.log('  ⚠ D1 skipped — FCB par sheet not present (sister repo absent)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
