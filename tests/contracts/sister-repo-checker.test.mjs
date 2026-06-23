#!/usr/bin/env node
/**
 * tests/contracts/sister-repo-checker.test.mjs
 *
 * N7 (2026-06-23) — Sister repo checker contract.
 */

import s from '../../tools/sister-repo-checker.mjs';
const { listSisterKernels, listBridgeKnownKernels, diffSets, buildReport, renderReport } = s;

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

console.log('SISTER-REPO-CHECKER contract · test suite');

test('diffSets: equal arrays → inSync true', () => {
  const d = diffSets(['a','b','c'], ['a','b','c']);
  assert(d.inSync === true, 'inSync');
  assert(d.newKernels.length === 0 && d.staleKernels.length === 0, 'no drift');
  assert(d.shared.length === 3, 'all shared');
});

test('diffSets: new in sister detected', () => {
  const d = diffSets(['a','b','c'], ['a','b']);
  assert(d.newKernels.length === 1 && d.newKernels[0] === 'c', 'c new');
  assert(d.staleKernels.length === 0, 'no stale');
  assert(d.inSync === false, 'not in sync');
});

test('diffSets: stale in bridge detected', () => {
  const d = diffSets(['a','b'], ['a','b','x']);
  assert(d.staleKernels.length === 1 && d.staleKernels[0] === 'x', 'x stale');
  assert(d.newKernels.length === 0, 'no new');
  assert(d.inSync === false, 'not in sync');
});

test('listBridgeKnownKernels: parses live bridge file', () => {
  const list = listBridgeKnownKernels();
  assert(Array.isArray(list), 'array');
  assert(list.length > 0, 'has kernels');
  assert(list.includes('both_ways'), 'both_ways present');
  assert(list.includes('cluster_pays'), 'cluster_pays present');
});

test('listSisterKernels: returns null if sister repo absent or kernels found', () => {
  const list = listSisterKernels();
  /* Either null (sister not installed) or non-empty array. */
  if (list === null) {
    console.log('    (sister repo not installed — null returned as expected)');
    return;
  }
  assert(Array.isArray(list), 'array');
  assert(list.length > 0, 'has kernels');
  assert(list.every(k => !k.startsWith('_')), 'no private files');
});

test('buildReport: end-to-end produces ok report when both sides present', () => {
  const r = buildReport();
  if (!r.ok) {
    /* OK to skip if sister repo not present in dev environment. */
    assert(r.error.includes('sister') || r.error.includes('KNOWN_KERNELS'),
      `error message helpful, got: ${r.error}`);
    return;
  }
  assert(typeof r.generatedAt === 'string', 'generatedAt');
  assert(typeof r.diff === 'object', 'diff');
  assert(Array.isArray(r.diff.newKernels), 'newKernels array');
  assert(Array.isArray(r.diff.staleKernels), 'staleKernels array');
  assert(typeof r.diff.inSync === 'boolean', 'inSync bool');
});

test('renderReport: uses box-drawing + lists counts (HARD RULE #3)', () => {
  const fake = {
    ok: true, generatedAt: 'x',
    sister: { dir: '/x', count: 22, kernels: [] },
    bridge: { path: '/y', count: 22, kernels: [] },
    diff: { newKernels: ['kx'], staleKernels: [], shared: [], inSync: false },
  };
  const r = renderReport(fake);
  assert(r.includes('┌') && r.includes('└') && r.includes('│'), 'box-drawing');
  assert(r.includes('NEW') && r.includes('kx'), 'new kernel listed');
  assert(r.includes('In sync'), 'sync status');
});

test('renderReport: error path', () => {
  const r = renderReport({ ok: false, error: 'something broke' });
  assert(r.includes('ERROR') && r.includes('something broke'), 'error rendered');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
