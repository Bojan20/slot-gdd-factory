#!/usr/bin/env node
/**
 * tests/contracts/extra-kernel-bridges.test.mjs
 *
 * MATH-DEEP B+++++ — extraKernelBridges contract (expanding_symbol + sticky_wilds).
 *
 * Verifies both sister-repo kernel bridges:
 *   - computeExpandingSymbolKernelRtp returns structured analytical RTP
 *   - computeStickyWildsKernelRtp returns structured analytical RTP
 *   - Both are deterministic + cache-backed
 *   - Both gracefully skip when sister repo unavailable
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeExpandingSymbolKernelRtp,
  computeStickyWildsKernelRtp,
  _resetCache,
} from '../../src/blocks/featureSimPlugins/extraKernelBridges.mjs';
import { detectKernelEngine } from '../../tools/math-kernel-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

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

console.log('EXTRA KERNEL BRIDGES contract · test suite');

const CASH_ERUPTION = JSON.parse(readFileSync(
  join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json'), 'utf8'));

/* ── (1) Expanding Symbol shape + numeric ─────────────────────────────── */

test('computeExpandingSymbolKernelRtp returns analytical RTP shape', async () => {
  _resetCache();
  const r = await computeExpandingSymbolKernelRtp(CASH_ERUPTION);
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped — sister repo unavailable)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(typeof r.rtpContribution === 'number', 'rtpContribution should be number');
  assert(r.rtpContribution >= 0 && r.rtpContribution < 1, `rtpContribution sanity: ${r.rtpContribution}`);
  assert(typeof r.expectedReelsExpandedPerSpin === 'number', 'expectedReelsExpandedPerSpin');
  assert(typeof r.expectedPayPerTrigger === 'number', 'expectedPayPerTrigger');
  assert(r.kernelEngine === 'python-kernel', `engine: ${r.kernelEngine}`);
});

/* ── (2) Sticky Wilds shape + numeric ─────────────────────────────────── */

test('computeStickyWildsKernelRtp returns analytical RTP shape', async () => {
  _resetCache();
  const r = await computeStickyWildsKernelRtp(CASH_ERUPTION);
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped — sister repo unavailable)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(typeof r.rtpContribution === 'number', 'rtpContribution should be number');
  assert(r.rtpContribution >= 0 && r.rtpContribution < 5, `rtpContribution sanity: ${r.rtpContribution}`);
  assert(Array.isArray(r.expectedWildsPerRespin), 'expectedWildsPerRespin should be array');
  assert(r.expectedWildsPerRespin.length === r.nRespins,
    `expectedWildsPerRespin length should match nRespins`);
});

/* ── (3) Both bridges deterministic ──────────────────────────────────── */

test('Expanding Symbol deterministic across calls', async () => {
  _resetCache();
  const r1 = await computeExpandingSymbolKernelRtp(CASH_ERUPTION);
  _resetCache();
  const r2 = await computeExpandingSymbolKernelRtp(CASH_ERUPTION);
  if (!r1.ok || !r2.ok) { console.log('    (skipped)'); return; }
  assert(r1.rtpContribution === r2.rtpContribution,
    `non-deterministic: ${r1.rtpContribution} ≠ ${r2.rtpContribution}`);
});

test('Sticky Wilds deterministic across calls', async () => {
  _resetCache();
  const r1 = await computeStickyWildsKernelRtp(CASH_ERUPTION);
  _resetCache();
  const r2 = await computeStickyWildsKernelRtp(CASH_ERUPTION);
  if (!r1.ok || !r2.ok) { console.log('    (skipped)'); return; }
  assert(r1.rtpContribution === r2.rtpContribution,
    `non-deterministic: ${r1.rtpContribution} ≠ ${r2.rtpContribution}`);
});

/* ── (4) Custom options override defaults ────────────────────────────── */

test('Expanding Symbol options.payTable override applied', async () => {
  _resetCache();
  const r1 = await computeExpandingSymbolKernelRtp(CASH_ERUPTION);
  _resetCache();
  /* Override pay_table with higher values → expect higher rtpContribution. */
  const r2 = await computeExpandingSymbolKernelRtp(CASH_ERUPTION, {
    payTable: { 3: 10, 4: 50, 5: 1000 },
  });
  if (!r1.ok || !r2.ok) { console.log('    (skipped)'); return; }
  assert(r2.rtpContribution > r1.rtpContribution,
    `higher payTable should yield higher rtpContribution`);
});

/* ── (5) Cache: 2nd call instant ─────────────────────────────────────── */

test('Cache hit on Sticky Wilds (2nd call fast)', async () => {
  _resetCache();
  const t1 = Date.now();
  const r1 = await computeStickyWildsKernelRtp(CASH_ERUPTION);
  const d1 = Date.now() - t1;
  const t2 = Date.now();
  await computeStickyWildsKernelRtp(CASH_ERUPTION);
  const d2 = Date.now() - t2;
  if (r1.ok) {
    assert(d2 < d1 || d2 < 50, `cache miss? d1=${d1}ms d2=${d2}ms`);
  }
});

/* ── Result ──────────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
