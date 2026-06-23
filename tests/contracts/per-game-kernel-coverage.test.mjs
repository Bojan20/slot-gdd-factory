#!/usr/bin/env node
/**
 * tests/contracts/per-game-kernel-coverage.test.mjs
 *
 * Verifies tools/per-game-kernel-coverage.mjs:
 *   - applicableKernels(model) returns non-empty list per baseline
 *   - walkGame(slug) returns structured report
 *   - All 5 baselines walk to ok=true
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  walkGame, applicableKernels, topologyHints,
} from '../../tools/per-game-kernel-coverage.mjs';

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PER-GAME KERNEL COVERAGE contract · test suite');

test('topologyHints returns Set with topology + features', () => {
  const model = { topology: { kind: 'cluster', evaluation: 'cluster' }, holdAndWin: { enabled: true } };
  const hints = topologyHints(model);
  assert(hints.has('cluster'), 'cluster in hints');
  assert(hints.has('hold_and_win'), 'hold_and_win in hints');
});

test('applicableKernels(starlight model) includes cluster_pays', () => {
  const model = { topology: { kind: 'cluster', evaluation: 'cluster' } };
  const ks = applicableKernels(model);
  assert(ks.some(k => k.name === 'cluster_pays'), 'cluster_pays should apply');
});

test('walkGame(cash-eruption) returns ok with kernelsOk > 0', async () => {
  const r = await walkGame('cash-eruption-foundry-gdd');
  assert(r.ok === true, `expected ok, got error: ${r.error}`);
  assert(r.kernelsOk > 0, `kernelsOk > 0, got ${r.kernelsOk}`);
  assert(r.kernelsApplicable >= r.kernelsOk, 'applicable >= ok');
  assert(typeof r.totalAnalyticalSumXBet === 'number', 'totalAnalyticalSumXBet number');
});

test('walkGame(starlight) detects cluster topology', async () => {
  const r = await walkGame('starlight-travellers-gdd');
  assert(r.ok === true, 'ok');
  /* Starlight is cluster — cluster_pays should be in kernels list. */
  assert(r.kernels.some(k => k.name === 'cluster_pays' && k.ok),
    'cluster_pays should fire ok');
});

test('walkGame(gates) detects pay_anywhere applicability', async () => {
  const r = await walkGame('gates-of-olympus-1000-gdd');
  assert(r.ok === true, 'ok');
  /* Gates is pay_anywhere — pay_anywhere kernel should apply. */
  assert(r.kernels.some(k => k.name === 'pay_anywhere'),
    'pay_anywhere should be applicable');
});

test('walkGame() reports inverse-solver kernels as skipped, not failed', async () => {
  const r = await walkGame('cash-eruption-foundry-gdd');
  /* Inverse solvers have topology "any" so they appear in applicable list,
   * but are skipped in coverage walk (operator-driven, not auto-discovery). */
  const solver = r.kernels.find(k => k.name === 'inverse_solver');
  if (solver) {
    assert(solver.ok === false, 'inverse_solver should be marked !ok in coverage');
    assert(solver.reason?.includes('operator-driven'), `should mention operator-driven, got: ${solver.reason}`);
  }
});

test('All 5 baselines walk to ok=true', async () => {
  const slugs = [
    'cash-eruption-foundry-gdd', 'huff-n-more-puff-gdd',
    'starlight-travellers-gdd', 'wrath-of-olympus-gdd',
    'gates-of-olympus-1000-gdd',
  ];
  for (const s of slugs) {
    const r = await walkGame(s);
    assert(r.ok === true, `${s} failed: ${r.error}`);
    assert(r.kernelsOk > 0, `${s} has 0 kernels ok`);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
