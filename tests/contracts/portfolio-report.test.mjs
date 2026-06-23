#!/usr/bin/env node
/**
 * tests/contracts/portfolio-report.test.mjs
 *
 * Verifies tools/portfolio-report.mjs:
 *   - buildPortfolio(slugs) returns row per game with expected fields
 *   - All 5 baselines produce ok rows
 *   - renderPortfolio output contains table + summary + topology breakdown
 *   - Top kernels are sorted desc by rtpContribution
 *   - Error rows (missing game) handled gracefully
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPortfolio, renderPortfolio,
} from '../../tools/portfolio-report.mjs';

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

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

console.log('PORTFOLIO REPORT contract · test suite');

test('buildPortfolio returns row per slug with expected fields', async () => {
  const rows = await buildPortfolio(BASELINES);
  assert(Array.isArray(rows), 'rows is array');
  assert(rows.length === 5, `5 rows, got ${rows.length}`);
  for (const r of rows) {
    assert(r.slug, 'row has slug');
    assert(r.ok === true, `${r.slug} should be ok, got error: ${r.error}`);
    assert(typeof r.topology === 'string', `${r.slug} topology string`);
    assert(typeof r.kernelsOk === 'number', `${r.slug} kernelsOk number`);
    assert(typeof r.kernelsApplicable === 'number', `${r.slug} kernelsApplicable number`);
    assert(Array.isArray(r.topKernels), `${r.slug} topKernels array`);
  }
});

test('starlight portfolio row reflects cluster topology', async () => {
  const rows = await buildPortfolio(['starlight-travellers-gdd']);
  assert(rows.length === 1, '1 row');
  const r = rows[0];
  assert(r.ok === true, 'ok');
  assert(r.topology === 'cluster', `topology cluster, got ${r.topology}`);
  /* cluster_pays should be top contributor (highest analytical RTP). */
  const hasCluster = r.topKernels.some(k => k.name === 'cluster_pays');
  assert(hasCluster, 'cluster_pays in top kernels');
});

test('gates portfolio row reflects rectangular topology', async () => {
  const rows = await buildPortfolio(['gates-of-olympus-1000-gdd']);
  assert(rows.length === 1, '1 row');
  const r = rows[0];
  assert(r.ok === true, 'ok');
  assert(r.topology === 'rectangular', `topology rectangular, got ${r.topology}`);
});

test('Top kernels are sorted desc by RTP contribution', async () => {
  const rows = await buildPortfolio(BASELINES);
  for (const r of rows) {
    if (!r.ok || r.topKernels.length < 2) continue;
    for (let i = 1; i < r.topKernels.length; i++) {
      assert(r.topKernels[i - 1].rtp >= r.topKernels[i].rtp,
        `${r.slug}: top ${i - 1} (${r.topKernels[i - 1].rtp}) >= top ${i} (${r.topKernels[i].rtp})`);
    }
    assert(r.topKernels.length <= 3, `${r.slug} top kernels capped at 3, got ${r.topKernels.length}`);
  }
});

test('renderPortfolio produces ASCII with table + summary', async () => {
  const rows = await buildPortfolio(BASELINES);
  const out = renderPortfolio(rows);
  assert(typeof out === 'string', 'output is string');
  assert(out.includes('portfolio report'), 'header includes "portfolio report"');
  assert(out.includes('Topology'), 'has Topology column');
  assert(out.includes('Declared'), 'has Declared column');
  assert(out.includes('Σ analytical'), 'has Σ analytical column');
  assert(out.includes('PORTFOLIO SUMMARY'), 'has summary section');
  assert(out.includes('Topology breakdown'), 'has topology breakdown');
  assert(out.includes('Top RTP-contributing kernels'), 'has top kernels section');
});

test('Error rows are handled gracefully (missing game)', async () => {
  const rows = await buildPortfolio(['nonexistent-game-xyz']);
  assert(rows.length === 1, '1 row');
  assert(rows[0].ok === false, 'ok=false for missing');
  assert(typeof rows[0].error === 'string', 'error field set');
});

test('Summary line accurately reflects ok/error counts', async () => {
  const rows = await buildPortfolio([...BASELINES, 'nonexistent-game-xyz']);
  const out = renderPortfolio(rows);
  /* 6 total, 5 ok, 1 error. */
  assert(out.includes('6 (5 ok, 1 error)'), `summary should show 6 (5 ok, 1 error), got line: ${out.match(/Games:.*/)?.[0]}`);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
