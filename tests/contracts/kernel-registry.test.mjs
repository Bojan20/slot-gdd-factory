#!/usr/bin/env node
/**
 * tests/contracts/kernel-registry.test.mjs
 *
 * Verifies kernel-registry.mjs discovery API matches actual bridge exports.
 */

import {
  KERNEL_REGISTRY,
  listKernels,
  getKernelMetadata,
  assertKernelExists,
  kernelCounts,
} from '../../src/blocks/featureSimPlugins/kernelRegistry.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('KERNEL REGISTRY contract · test suite');

test('Registry contains all 22 sister-repo kernels', () => {
  const counts = kernelCounts();
  assert(counts.total === 22, `expected 22 total, got ${counts.total}`);
});

test('Category counts: forward-rtp >= 15, composite >= 2, inverse-solver = 2, audit >= 2', () => {
  const { byCategory } = kernelCounts();
  assert(byCategory['forward-rtp'] >= 15, `forward-rtp count: ${byCategory['forward-rtp']}`);
  assert(byCategory['composite'] >= 2, `composite count: ${byCategory['composite']}`);
  assert(byCategory['inverse-solver'] === 2, `inverse-solver count: ${byCategory['inverse-solver']}`);
  assert(byCategory['audit'] >= 2, `audit count: ${byCategory['audit']}`);
});

test('listKernels() with no filter returns 22 entries', () => {
  const all = listKernels();
  assert(all.length === 22, `expected 22, got ${all.length}`);
  assert(all.every(k => typeof k.name === 'string'), 'every entry has name');
});

test('listKernels("inverse-solver") returns 2 entries', () => {
  const solvers = listKernels('inverse-solver');
  assert(solvers.length === 2, `expected 2 solvers, got ${solvers.length}`);
  assert(solvers.some(k => k.name === 'inverse_solver'), 'inverse_solver present');
  assert(solvers.some(k => k.name === 'multi_dim_inverse_solver'), 'multi_dim_inverse_solver present');
});

test('getKernelMetadata("hold_and_win") returns composite category', () => {
  const m = getKernelMetadata('hold_and_win');
  assert(m !== null, 'should return metadata');
  assert(m.category === 'composite', `category: ${m.category}`);
  assert(m.bridgeFunction === 'computeHoldAndWinKernelRtp', `bridgeFunction: ${m.bridgeFunction}`);
});

test('getKernelMetadata("unknown") returns null', () => {
  const m = getKernelMetadata('nonexistent_kernel_xyz');
  assert(m === null, `expected null, got ${m}`);
});

test('assertKernelExists throws for unknown name', () => {
  let threw = false;
  try { assertKernelExists('unknown_x'); } catch { threw = true; }
  assert(threw, 'should throw');
});

test('assertKernelExists does NOT throw for known name', () => {
  let threw = false;
  try { assertKernelExists('cluster_pays'); } catch { threw = true; }
  assert(!threw, 'should not throw for known kernel');
});

test('Every registry entry has required metadata fields', () => {
  for (const [name, meta] of Object.entries(KERNEL_REGISTRY)) {
    for (const k of ['category', 'topology', 'feature', 'bridgeFunction', 'bridgeModule', 'sisterRepoModule', 'paramsShape']) {
      assert(k in meta, `${name} missing field: ${k}`);
    }
  }
});

test('Bridge module references are one of the 3 known modules', () => {
  const valid = new Set([
    'extraKernelBridges.mjs',
    'holdAndWinKernelBridge.mjs',
    'clusterEvalKernelBridge.mjs',
  ]);
  for (const [name, meta] of Object.entries(KERNEL_REGISTRY)) {
    assert(valid.has(meta.bridgeModule), `${name} unknown bridgeModule: ${meta.bridgeModule}`);
  }
});

test('Registry is frozen (immutable)', () => {
  let threw = false;
  try { KERNEL_REGISTRY.test_new_entry = { category: 'test' }; }
  catch { threw = true; }
  /* In strict mode → throws; in sloppy → silently fails. Either way the
   * registry should not have the new key. */
  assert(!('test_new_entry' in KERNEL_REGISTRY), 'registry should be frozen');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
