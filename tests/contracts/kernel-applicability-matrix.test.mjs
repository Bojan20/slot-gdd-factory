#!/usr/bin/env node
/**
 * tests/contracts/kernel-applicability-matrix.test.mjs
 *
 * Verifies tools/kernel-applicability-matrix.mjs:
 *   - buildMatrix(slugs) returns expected shape (allKernels, games,
 *     colTotals, rowTotals)
 *   - All 22 kernels appear in matrix columns
 *   - Cluster_pays is column-applied to starlight only (1/5)
 *   - Pay_anywhere is column-applied to gates-of-olympus only
 *   - 'any' topology kernels apply to every game (universal column)
 *   - renderMatrix produces ASCII output containing expected markers
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMatrix, renderMatrix,
} from '../../tools/kernel-applicability-matrix.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

console.log('KERNEL APPLICABILITY MATRIX contract · test suite');

test('buildMatrix returns expected top-level shape', () => {
  const m = buildMatrix(BASELINES);
  assert(Array.isArray(m.allKernels), 'allKernels array');
  assert(m.allKernels.length === 22, `22 kernels, got ${m.allKernels.length}`);
  assert(typeof m.games === 'object', 'games object');
  assert(typeof m.colTotals === 'object', 'colTotals object');
  assert(typeof m.rowTotals === 'object', 'rowTotals object');
  assert(Array.isArray(m.skipped), 'skipped array');
});

test('All 5 baselines present in games map', () => {
  const m = buildMatrix(BASELINES);
  for (const slug of BASELINES) {
    assert(m.games[slug] instanceof Set, `${slug} should have Set of kernels`);
    assert(m.games[slug].size > 0, `${slug} should have > 0 applicable kernels`);
  }
});

test('cluster_pays applies to starlight only (1/5)', () => {
  const m = buildMatrix(BASELINES);
  assert(m.colTotals.cluster_pays === 1,
    `cluster_pays should apply to 1 game, got ${m.colTotals.cluster_pays}`);
  assert(m.games['starlight-travellers-gdd'].has('cluster_pays'),
    'starlight should have cluster_pays');
});

test('pay_anywhere applies to gates only (1/5)', () => {
  const m = buildMatrix(BASELINES);
  assert(m.colTotals.pay_anywhere === 1,
    `pay_anywhere should apply to 1 game, got ${m.colTotals.pay_anywhere}`);
  assert(m.games['gates-of-olympus-1000-gdd'].has('pay_anywhere'),
    'gates should have pay_anywhere');
});

test('Universal kernels (topology=any) apply to all 5 games', () => {
  const m = buildMatrix(BASELINES);
  /* asymmetric_paytable, charge_meter, pick_chain, state_machine,
   * must_hit_by, inverse_solver, multi_dim_inverse_solver, buy_feature
   * all declare topology=['any'] — should apply to all 5 baselines. */
  const universals = ['asymmetric_paytable', 'charge_meter', 'pick_chain',
                      'state_machine', 'must_hit_by'];
  for (const u of universals) {
    assert(m.colTotals[u] === 5,
      `${u} should apply to all 5, got ${m.colTotals[u]}`);
  }
});

test('Row totals match game Set sizes', () => {
  const m = buildMatrix(BASELINES);
  for (const slug of BASELINES) {
    assert(m.rowTotals[slug] === m.games[slug].size,
      `${slug}: rowTotal ${m.rowTotals[slug]} !== set size ${m.games[slug].size}`);
  }
});

test('Column totals sum equals total applications', () => {
  const m = buildMatrix(BASELINES);
  const colSum = Object.values(m.colTotals).reduce((s, v) => s + v, 0);
  const rowSum = Object.values(m.rowTotals).reduce((s, v) => s + v, 0);
  assert(colSum === rowSum,
    `col sum ${colSum} should equal row sum ${rowSum} (each apply counted once)`);
});

test('renderMatrix produces ASCII with kernels + legend + Σ row', () => {
  const m = buildMatrix(BASELINES);
  const out = renderMatrix(m);
  assert(typeof out === 'string', 'output is string');
  assert(out.includes('Cross-game kernel applicability matrix'), 'has header');
  assert(out.includes('Kernel index legend'), 'has legend');
  assert(out.includes('cluster_pays'), 'has cluster_pays in legend');
  assert(out.includes('Σ games-per-kernel'), 'has footer row');
  assert(out.includes('Universal kernels'), 'has universal summary');
  assert(out.includes('Total applications:'), 'has total line');
});

test('Skipped games are reported (non-existent slug)', () => {
  const m = buildMatrix(['cash-eruption-foundry-gdd', 'nonexistent-slug-xyz']);
  assert(m.skipped.length === 1, `1 skipped, got ${m.skipped.length}`);
  assert(m.skipped[0].includes('nonexistent-slug-xyz'), 'nonexistent slug skipped');
  assert(Object.keys(m.games).length === 1, '1 game in matrix');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
