#!/usr/bin/env node
/**
 * tests/contracts/compare-games.test.mjs
 *
 * N2 (2026-06-23) — Side-by-side compare contract.
 *
 * Verifies tools/compare-games.mjs:
 *   - buildComparison(a, b) returns expected shape (ok + summary + 6 dims)
 *   - Same-vs-same comparison: 0 differing rows + 100% shared features
 *   - Different-topology pair: topology row marked as differ
 *   - setDiff math is sound (shared / onlyA / onlyB partition)
 *   - renderAscii emits all 6 section headers + uses box-drawing
 *   - renderMarkdown emits all 6 section headers + summary block
 *   - Missing slug returns ok=false + helpful error
 *   - Comparison is symmetric in row count (A vs B has same row count
 *     as B vs A even though identity of A/B changes per cell)
 */

import {
  buildComparison, renderAscii, renderMarkdown, setDiff,
} from '../../tools/compare-games.mjs';

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

console.log('COMPARE-GAMES contract · test suite');

test('setDiff partitions correctly (shared/onlyA/onlyB)', () => {
  const d = setDiff(['a','b','c'], ['b','c','d']);
  assert(JSON.stringify(d.shared) === JSON.stringify(['b','c']), `shared, got ${JSON.stringify(d.shared)}`);
  assert(JSON.stringify(d.onlyA)  === JSON.stringify(['a']),     `onlyA, got ${JSON.stringify(d.onlyA)}`);
  assert(JSON.stringify(d.onlyB)  === JSON.stringify(['d']),     `onlyB, got ${JSON.stringify(d.onlyB)}`);
});

test('setDiff handles empty inputs', () => {
  const d1 = setDiff([], []);
  assert(d1.shared.length === 0 && d1.onlyA.length === 0 && d1.onlyB.length === 0, 'empty');
  const d2 = setDiff(null, ['x']);
  assert(d2.onlyB.length === 1 && d2.onlyB[0] === 'x', 'null A');
});

test('buildComparison returns expected shape (ok + summary + sections)', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  assert(r.ok === true, `ok, got ${r.error}`);
  assert(r.slugA === 'starlight-travellers-gdd', 'slugA');
  assert(r.slugB === 'cash-eruption-foundry-gdd', 'slugB');
  assert(typeof r.generatedAt === 'string', 'generatedAt');
  assert(typeof r.summary === 'object', 'summary');
  assert(Array.isArray(r.basics), 'basics array');
  assert(Array.isArray(r.symbols), 'symbols array');
  assert(typeof r.features === 'object', 'features object');
  assert(typeof r.kernels === 'object', 'kernels object');
  assert(Array.isArray(r.convergence), 'convergence array');
  assert(typeof r.compliance === 'object', 'compliance object');
});

test('Same-vs-same comparison: 0 differing rows + all features shared', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'starlight-travellers-gdd');
  assert(r.ok === true, 'ok');
  assert(r.summary.differingRows === 0, `expect 0 diffs, got ${r.summary.differingRows}`);
  assert(r.summary.onlyAFeatures === 0, 'only-A features = 0');
  assert(r.summary.onlyBFeatures === 0, 'only-B features = 0');
  assert(r.features.shared.length > 0, 'must share features');
  /* Every row in basics/symbols/convergence must be match=true. */
  for (const row of [...r.basics, ...r.symbols, ...r.convergence]) {
    assert(row.match === true, `row '${row.label}' should match self`);
  }
});

test('Different-topology pair: topology marked as differ', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  assert(r.ok === true, 'ok');
  /* Starlight is cluster, cash-eruption is lock_respin → must differ. */
  const topoRow = r.basics.find(b => b.label === 'Topology');
  assert(topoRow, 'topology row exists');
  assert(topoRow.match === false, `topology should differ (A=${topoRow.a}, B=${topoRow.b})`);
});

test('Summary counts add up: identical + differing = total', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  assert(r.ok === true, 'ok');
  assert(r.summary.identicalRows + r.summary.differingRows === r.summary.totalRows,
    `${r.summary.identicalRows} + ${r.summary.differingRows} != ${r.summary.totalRows}`);
});

test('renderAscii emits 6 section headers + uses box-drawing', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  const ascii = renderAscii(r);
  assert(typeof ascii === 'string', 'string');
  assert(ascii.includes('1. Basics'), 'section 1');
  assert(ascii.includes('2. Symbols'), 'section 2');
  assert(ascii.includes('3. Features'), 'section 3');
  assert(ascii.includes('4. Kernel coverage'), 'section 4');
  assert(ascii.includes('5. RTP convergence'), 'section 5');
  assert(ascii.includes('6. Compliance'), 'section 6');
  /* Box drawing characters (HARD RULE #3). */
  assert(ascii.includes('┌') && ascii.includes('┐'), 'top corners');
  assert(ascii.includes('├') && ascii.includes('┤'), 'mid borders');
  assert(ascii.includes('└') && ascii.includes('┘'), 'bottom corners');
  assert(ascii.includes('│'), 'vertical bars');
});

test('renderMarkdown emits 6 section headers + summary block', async () => {
  const r = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  const md = renderMarkdown(r);
  assert(typeof md === 'string', 'string');
  assert(md.includes('## Summary'), 'summary section');
  assert(md.includes('## 1. Basics'), 'section 1');
  assert(md.includes('## 2. Symbols'), 'section 2');
  assert(md.includes('## 3. Features'), 'section 3');
  assert(md.includes('## 4. Kernel coverage'), 'section 4');
  assert(md.includes('## 5. RTP convergence'), 'section 5');
  assert(md.includes('## 6. Compliance'), 'section 6');
  assert(md.includes('starlight-travellers-gdd'), 'slugA in header');
  assert(md.includes('cash-eruption-foundry-gdd'), 'slugB in header');
});

test('Missing slug returns ok=false + helpful error', async () => {
  const r = await buildComparison('nonexistent-slug-xyz', 'starlight-travellers-gdd');
  assert(r.ok === false, 'ok=false');
  assert(typeof r.error === 'string' && r.error.includes('nonexistent-slug-xyz'),
    `error should mention bad slug, got: ${r.error}`);
  const md = renderMarkdown(r);
  assert(md.includes('ERROR'), 'md error block');
  const ascii = renderAscii(r);
  assert(ascii.includes('ERROR'), 'ascii error block');
});

test('Comparison symmetry: A-vs-B same row count as B-vs-A', async () => {
  const rAB = await buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd');
  const rBA = await buildComparison('cash-eruption-foundry-gdd', 'starlight-travellers-gdd');
  assert(rAB.ok && rBA.ok, 'both ok');
  assert(rAB.basics.length === rBA.basics.length, 'basics count');
  assert(rAB.symbols.length === rBA.symbols.length, 'symbols count');
  assert(rAB.convergence.length === rBA.convergence.length, 'convergence count');
  assert(rAB.summary.totalRows === rBA.summary.totalRows, 'total rows');
  /* The number of differing rows must be the same regardless of order. */
  assert(rAB.summary.differingRows === rBA.summary.differingRows,
    `differing rows: AB=${rAB.summary.differingRows} BA=${rBA.summary.differingRows}`);
  /* Feature partitioning swaps onlyA ↔ onlyB. */
  assert(rAB.features.onlyA.length === rBA.features.onlyB.length, 'features onlyA ↔ onlyB');
  assert(rAB.features.onlyB.length === rBA.features.onlyA.length, 'features onlyB ↔ onlyA');
  assert(rAB.features.shared.length === rBA.features.shared.length, 'features shared invariant');
});

test('Shared kernel detection: gates vs cash-eruption (both 5×3 line evaluators)', async () => {
  const r = await buildComparison('gates-of-olympus-1000-gdd', 'cash-eruption-foundry-gdd');
  assert(r.ok === true, 'ok');
  /* Both use kernel coverage — applicable count must be > 0 for each. */
  const appRow = r.kernels.counts.find(c => c.label === 'Applicable');
  assert(appRow, 'applicable row');
  assert(appRow.raw.a > 0, `gates applicable > 0, got ${appRow.raw.a}`);
  assert(appRow.raw.b > 0, `cash-eruption applicable > 0, got ${appRow.raw.b}`);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
