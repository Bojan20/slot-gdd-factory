#!/usr/bin/env node
/**
 * tests/contracts/coverage-diff.test.mjs
 *
 * N6 (2026-06-23) — Coverage diff contract.
 */

import cov from '../../tools/coverage-diff.mjs';
const { diffCoverage, renderDiffReport } = cov;

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

console.log('COVERAGE-DIFF contract · test suite');

test('diffCoverage: identical input → 0 gained 0 lost', () => {
  const a = { kernels: [{ name: 'k1', ok: true }, { name: 'k2', ok: true }] };
  const b = { kernels: [{ name: 'k1', ok: true }, { name: 'k2', ok: true }] };
  const d = diffCoverage(a, b);
  assert(d.okGained.length === 0, 'no gain');
  assert(d.okLost.length === 0, 'no loss');
  assert(d.okCountA === 2 && d.okCountB === 2, 'counts match');
});

test('diffCoverage: gain detected', () => {
  const a = { kernels: [{ name: 'k1', ok: true }] };
  const b = { kernels: [{ name: 'k1', ok: true }, { name: 'k2', ok: true }] };
  const d = diffCoverage(a, b);
  assert(d.okGained.length === 1 && d.okGained[0] === 'k2', 'k2 gained');
  assert(d.okLost.length === 0, 'nothing lost');
});

test('diffCoverage: loss detected', () => {
  const a = { kernels: [{ name: 'k1', ok: true }, { name: 'k2', ok: true }] };
  const b = { kernels: [{ name: 'k1', ok: true }] };
  const d = diffCoverage(a, b);
  assert(d.okLost.length === 1 && d.okLost[0] === 'k2', 'k2 lost');
});

test('diffCoverage: ok=false NOT counted in okGained/okLost', () => {
  const a = { kernels: [{ name: 'k1', ok: false }] };
  const b = { kernels: [{ name: 'k1', ok: true }] };
  const d = diffCoverage(a, b);
  assert(d.okGained.length === 1, 'k1 promoted from !ok to ok = gained');
  assert(d.okLost.length === 0, 'no loss');
});

test('diffCoverage: applicable diff tracked separately from ok', () => {
  const a = { kernels: [{ name: 'k1', ok: true }] };
  const b = { kernels: [{ name: 'k1', ok: true }, { name: 'k2', ok: false }] };
  const d = diffCoverage(a, b);
  assert(d.appGained.length === 1 && d.appGained[0] === 'k2', 'k2 newly applicable');
  assert(d.okGained.length === 0, 'no ok gain (k2 is !ok)');
});

test('diffCoverage: handles null/empty input', () => {
  const d1 = diffCoverage(null, null);
  assert(d1.okGained.length === 0 && d1.okLost.length === 0, 'null null');
  const d2 = diffCoverage({ kernels: [] }, null);
  assert(d2.okGained.length === 0, 'empty A null B');
});

test('renderDiffReport: uses box-drawing + lists slugs', () => {
  const report = {
    generatedAt: 'x', fromRef: 'a', toRef: 'b',
    summary: { totalOkGained: 1, totalOkLost: 2, net: -1, gamesCompared: 2 },
    perGame: {
      'slug-1': { status: 'compared', okGained: ['k1'], okLost: [], appGained: [], appLost: [], okCountA: 5, okCountB: 6, appCountA: 5, appCountB: 6 },
      'slug-2': { status: 'compared', okGained: [], okLost: ['k2','k3'], appGained: [], appLost: [], okCountA: 5, okCountB: 3, appCountA: 5, appCountB: 5 },
    },
  };
  const r = renderDiffReport(report);
  assert(r.includes('┌') && r.includes('└') && r.includes('│'), 'box-drawing');
  assert(r.includes('slug-1') && r.includes('slug-2'), 'slugs listed');
  assert(r.includes('k1') && r.includes('k2'), 'kernels listed');
  assert(r.includes('+1') && r.includes('-2'), 'summary totals');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
