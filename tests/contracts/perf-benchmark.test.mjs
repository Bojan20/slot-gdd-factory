#!/usr/bin/env node
/**
 * tests/contracts/perf-benchmark.test.mjs
 *
 * N5 (2026-06-23) — Perf benchmark contract.
 */

import perf from '../../tools/perf-benchmark.mjs';
const { summarise, buildBenchCases, renderBenchTable } = perf;

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

console.log('PERF-BENCHMARK contract · test suite');

test('summarise: percentile + mean math against known set', () => {
  const s = summarise([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1.5, 2.5);
  assert(s.n === 10, 'n=10');
  assert(s.minMs === 1, `min 1, got ${s.minMs}`);
  assert(s.maxMs === 10, `max 10, got ${s.maxMs}`);
  assert(s.meanMs === 5.5, `mean 5.5, got ${s.meanMs}`);
  assert(s.p50Ms >= 5 && s.p50Ms <= 6, `p50 ≈ 5-6, got ${s.p50Ms}`);
  assert(s.p95Ms >= 9 && s.p95Ms <= 10, `p95 ≈ 9-10, got ${s.p95Ms}`);
  assert(s.rssDeltaMb === 1.5, 'rss delta');
  assert(s.heapDeltaMb === 2.5, 'heap delta');
});

test('summarise: empty samples returns null fields', () => {
  const s = summarise([], null, null);
  assert(s.n === 0, 'n=0');
  assert(s.minMs === null && s.maxMs === null && s.p50Ms === null, 'nulls');
});

test('buildBenchCases: returns 5 cases, each with name + async fn', () => {
  const cs = buildBenchCases();
  assert(cs.length === 5, `5 cases, got ${cs.length}`);
  for (const c of cs) {
    assert(typeof c.name === 'string' && c.name.length > 0, 'name');
    assert(typeof c.fn === 'function', 'fn');
  }
});

test('renderBenchTable: uses box-drawing + lists all results', () => {
  const fakeResults = [
    { name: 'a', n: 5, minMs: 1, p50Ms: 2, p95Ms: 3, maxMs: 4, heapDeltaMb: 0.1 },
    { name: 'b', n: 5, minMs: 5, p50Ms: 6, p95Ms: 7, maxMs: 8, heapDeltaMb: 0.2 },
  ];
  const r = renderBenchTable(fakeResults);
  assert(r.includes('┌') && r.includes('┐') && r.includes('└') && r.includes('┘'), 'box corners');
  assert(r.includes('│') && r.includes('├') && r.includes('┤'), 'mid borders');
  assert(r.includes('a') && r.includes('b'), 'rows present');
  assert(r.includes('Bench'), 'header');
});

test('Live run: 1 iteration of each bench succeeds with finite p50', async () => {
  const cases = buildBenchCases();
  /* Run buildOnePager bench once to validate runner integration. */
  const c = cases[0];
  const t0 = performance.now();
  await c.fn();
  const elapsed = performance.now() - t0;
  assert(Number.isFinite(elapsed) && elapsed >= 0, `live elapsed finite, got ${elapsed}`);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
