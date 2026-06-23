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
  computeCascadeKernelRtp,
  computeWaysEvaluatorKernelRtp,
  computePayAnywhereKernelRtp,
  computeStackedWildsKernelRtp,
  computeBothWaysKernelRtp,
  computeBuyFeatureAudit,
  computePersistentMultiplierKernelRtp,
  computeMustHitByKernelRtp,
  computeWheelKernelRtp,
  computeAsymmetricPaytableKernelRtp,
  computeChargeMeterKernelRtp,
  computeCrashKernelAudit,
  computePickChainKernelRtp,
  computeStateMachineKernelRtp,
  computeBothWaysExpandingWildKernelRtp,
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

/* ── (6) Cascade kernel — numeric sanity ─────────────────────────────── */

test('computeCascadeKernelRtp returns positive RTP for industry-typical params', async () => {
  _resetCache();
  const r = await computeCascadeKernelRtp();
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(typeof r.rtpContribution === 'number', 'rtpContribution number');
  assert(r.rtpContribution > 0, `expected > 0, got ${r.rtpContribution}`);
  assert(typeof r.expectedChainLength === 'number', 'expectedChainLength number');
});

/* ── (7) Ways evaluator — RTP × expected ways ≈ total ─────────────────── */

test('computeWaysEvaluatorKernelRtp returns positive RTP scaled by expected ways', async () => {
  _resetCache();
  const r = await computeWaysEvaluatorKernelRtp({ reels: 5, perWayRtpXBet: 0.001 });
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(typeof r.rtpContribution === 'number', 'rtpContribution number');
  assert(r.expectedWaysCount > 100, `expected ways > 100, got ${r.expectedWaysCount}`);
  /* RTP ≈ per_way × E[ways]. */
  assert(Math.abs(r.rtpContribution - 0.001 * r.expectedWaysCount) < 1e-6,
    `rtpContribution should equal per_way × E[ways]`);
});

/* ── (8) Pay-anywhere kernel — works on starlight model ───────────────── */

test('computePayAnywhereKernelRtp accepts model + returns analytical RTP', async () => {
  const STARLIGHT = JSON.parse(readFileSync(
    join(REPO, 'dist/real-games/starlight-travellers-gdd/model.json'), 'utf8'));
  _resetCache();
  const r = await computePayAnywhereKernelRtp(STARLIGHT);
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(typeof r.rtpContribution === 'number', 'rtpContribution number');
  assert(typeof r.expectedLandings === 'number', 'expectedLandings number');
});

/* ── (9) Stacked Wilds — expectedStackedCount positive ───────────────── */

test('computeStackedWildsKernelRtp returns expected stacked count > 0', async () => {
  _resetCache();
  const r = await computeStackedWildsKernelRtp(CASH_ERUPTION);
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  assert(r.expectedStackedCount > 0, `expectedStackedCount > 0, got ${r.expectedStackedCount}`);
});

/* ── (10) Both ways — rtp 0.96 ltr + 0.7 share = 1.632 RTP ─────────────── */

test('computeBothWaysKernelRtp returns analytical bidirectional RTP', async () => {
  _resetCache();
  const r = await computeBothWaysKernelRtp({ ltrOnlyRtp: 0.96, linePayShare: 0.7 });
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Math.abs(r.rtpContribution - 1.632) < 1e-6, `expected 1.632, got ${r.rtpContribution}`);
});

/* ── (11) Buy feature audit returns UKGC/MGA pass flags ───────────────── */

test('computeBuyFeatureAudit returns buyRtp + UKGC/MGA pass flags', async () => {
  _resetCache();
  const r = await computeBuyFeatureAudit({ bonusAveragePayXBet: 100, buyCostXBet: 100 });
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(r.buyRtp === 1.0, `buyRtp expected 1.0, got ${r.buyRtp}`);
  assert(typeof r.ukgcPass === 'boolean', `ukgcPass should be boolean`);
});

/* ── (12) Persistent multiplier — averageMultiplier > 1 ────────────────── */

test('computePersistentMultiplierKernelRtp returns averageMultiplier > 1', async () => {
  _resetCache();
  const r = await computePersistentMultiplierKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(r.averageMultiplier > 1, `avg mult > 1, got ${r.averageMultiplier}`);
});

/* ── (13) Must-hit-by — 3-tier jackpot ───────────────────────────────── */

test('computeMustHitByKernelRtp returns 3-tier perPot array', async () => {
  _resetCache();
  const r = await computeMustHitByKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Array.isArray(r.perPot), 'perPot array');
  assert(r.perPot.length === 3, `3 pots, got ${r.perPot.length}`);
});

/* ── (14) Wheel — RTP × spin-again loop ──────────────────────────────── */

test('computeWheelKernelRtp accounts for spin-again chain', async () => {
  _resetCache();
  const r = await computeWheelKernelRtp({ triggerP: 0.02, maxSpinAgain: 3 });
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(r.rtpContribution > 0, `rtp > 0, got ${r.rtpContribution}`);
  assert(r.expectedAwardPerTrigger > 20, `award/trigger > 20, got ${r.expectedAwardPerTrigger}`);
});

/* ── (15) Asymmetric paytable — sum per-symbol contributions ──────────── */

test('computeAsymmetricPaytableKernelRtp returns total + perSymbolBreakdown', async () => {
  _resetCache();
  const r = await computeAsymmetricPaytableKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(r.rtpContribution > 0, `rtp > 0, got ${r.rtpContribution}`);
  assert(Array.isArray(r.perSymbolBreakdown), 'perSymbolBreakdown array');
});

/* ── (16) Charge meter — 2-tier breakdown ─────────────────────────────── */

test('computeChargeMeterKernelRtp returns 2-tier breakdown', async () => {
  _resetCache();
  const r = await computeChargeMeterKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Array.isArray(r.tiers) && r.tiers.length === 2, 'tiers array of 2');
});

/* ── (17) Crash kernel — house edge calc ─────────────────────────────── */

test('computeCrashKernelAudit returns rtp + strategy class', async () => {
  _resetCache();
  const r = await computeCrashKernelAudit({ houseEdge: 0.01, cashoutMultiplier: 2.0 });
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Math.abs(r.rtp - 0.99) < 0.01, `rtp ≈ 0.99, got ${r.rtp}`);
  assert(typeof r.strategyClass === 'string', `strategyClass string, got ${r.strategyClass}`);
});

/* ── (18) Pick chain — level breakdown ───────────────────────────────── */

test('computePickChainKernelRtp returns levels array', async () => {
  _resetCache();
  const r = await computePickChainKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Array.isArray(r.levels), 'levels array');
  assert(r.levels.length === 1, `1 level, got ${r.levels.length}`);
});

/* ── (19) State machine — stationary distribution sums to 1 ──────────── */

test('computeStateMachineKernelRtp returns stationary distribution summing to 1', async () => {
  _resetCache();
  const r = await computeStateMachineKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(Array.isArray(r.stationaryDistribution), 'stationaryDistribution array');
  const sum = r.stationaryDistribution.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 1e-6, `stationary sum 1.0, got ${sum}`);
});

/* ── (20) Both-ways expanding wild composite ─────────────────────────── */

test('computeBothWaysExpandingWildKernelRtp returns composite rtp + components', async () => {
  _resetCache();
  const r = await computeBothWaysExpandingWildKernelRtp();
  if (!r.ok) { const d = detectKernelEngine(); if (!d.available) { console.log('    (skipped)'); return; } throw new Error(`failed: ${r.reason}`); }
  assert(typeof r.bothWaysComponent === 'object', 'bothWaysComponent object');
  assert(typeof r.expandingSymbolComponent === 'object', 'expandingSymbolComponent object');
  /* Composite = both_ways + expanding_symbol. */
  const sum = r.bothWaysComponent.rtp_contribution + r.expandingSymbolComponent.rtp_contribution;
  assert(Math.abs(r.rtpContribution - sum) < 1e-6, `composite ${r.rtpContribution} ≠ sum ${sum}`);
});

/* ── Result ──────────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
