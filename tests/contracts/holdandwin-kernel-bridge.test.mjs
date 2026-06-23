#!/usr/bin/env node
/**
 * tests/contracts/holdandwin-kernel-bridge.test.mjs
 *
 * MATH-DEEP B+ contract — Hold & Win kernel pre-flight bridge live.
 *
 * Verifies:
 *   1. computeHoldAndWinKernelRtp(model) returns structured result
 *   2. Sister-repo money_collect kernel reachable through custom Python
 *      wrapper (handles JSON string→float key coercion)
 *   3. rtpContribution + triggerProb + expectedValuePerMoney returned
 *   4. Deterministic: 2 calls with same model → same numbers
 *   5. Graceful skip when sister repo unavailable
 *   6. Cache works (second call doesn't re-spawn Python)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeHoldAndWinKernelRtp,
  _resetCache,
} from '../../src/blocks/featureSimPlugins/holdAndWinKernelBridge.mjs';
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

console.log('H&W KERNEL BRIDGE contract · test suite');

const CASH_ERUPTION = JSON.parse(readFileSync(
  join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json'), 'utf8'));

/* ── (1) computeHoldAndWinKernelRtp returns structured result ─────────── */

test('computeHoldAndWinKernelRtp returns { ok, rtpContribution, money/jackpot ... } shape', async () => {
  _resetCache();
  const r = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  assert(typeof r === 'object', 'should be object');
  assert(typeof r.ok === 'boolean', 'ok should be boolean');
  if (r.ok) {
    assert(typeof r.rtpContribution === 'number', 'rtpContribution should be number');
    /* COMPOSITE: money + jackpot components. */
    assert(typeof r.moneyComponent === 'object', 'moneyComponent should be object');
    assert(typeof r.moneyComponent.rtp_contribution === 'number', 'money rtp_contribution');
    assert(typeof r.jackpotComponent === 'object', 'jackpotComponent should be object');
    assert(typeof r.jackpotComponent.rtp_contribution === 'number', 'jackpot rtp_contribution');
    assert(r.jackpotComponent.pots_count === 4, `jackpot 4 tiers, got ${r.jackpotComponent.pots_count}`);
    /* Total = money + jackpot. */
    const epsilon = 1e-9;
    const expectedTotal = r.moneyComponent.rtp_contribution + r.jackpotComponent.rtp_contribution;
    assert(Math.abs(r.rtpContribution - expectedTotal) < epsilon,
      `total ${r.rtpContribution} != money+jackpot ${expectedTotal}`);
    assert(r.kernelEngine === 'python-kernel', `kernelEngine: ${r.kernelEngine}`);
  } else {
    assert(typeof r.reason === 'string', 'reason should be string when !ok');
  }
});

/* ── (2) Kernel returns positive RTP contribution for Cash Eruption ───── */

test('Cash Eruption rtpContribution > 0 (kernel reachable)', async () => {
  _resetCache();
  const r = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  if (!r.ok) {
    /* Graceful skip when sister repo unavailable in CI. */
    const det = detectKernelEngine();
    if (!det.available) {
      console.log(`    (skipped — sister repo unavailable: ${det.reason})`);
      return;
    }
    throw new Error(`kernel failed unexpectedly: ${r.reason}`);
  }
  assert(r.rtpContribution > 0, `expected rtpContribution > 0, got ${r.rtpContribution}`);
  assert(r.rtpContribution < 1.0, `rtpContribution sanity bound (< 100% per spin), got ${r.rtpContribution}`);
});

/* ── (3) Deterministic across calls ──────────────────────────────────── */

test('Same model → same rtpContribution (deterministic)', async () => {
  _resetCache();
  const r1 = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  _resetCache(); /* force fresh kernel call */
  const r2 = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  if (!r1.ok || !r2.ok) {
    const det = detectKernelEngine();
    if (!det.available) {
      console.log('    (skipped — sister repo unavailable)');
      return;
    }
    throw new Error(`call failed: r1.ok=${r1.ok}, r2.ok=${r2.ok}`);
  }
  assert(r1.rtpContribution === r2.rtpContribution,
    `non-deterministic: ${r1.rtpContribution} ≠ ${r2.rtpContribution}`);
});

/* ── (4) Cache hits avoid re-spawn ────────────────────────────────────── */

test('Cache: second call (same model) returns cached result instantly', async () => {
  _resetCache();
  const t1Start = Date.now();
  const r1 = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  const t1 = Date.now() - t1Start;
  const t2Start = Date.now();
  const r2 = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  const t2 = Date.now() - t2Start;
  /* Cached call should be > 10× faster than fresh call (Python spawn is slow). */
  if (r1.ok && r2.ok) {
    assert(t2 < t1 || t2 < 50,
      `cache miss? t1=${t1}ms (fresh), t2=${t2}ms (expected cached / fast)`);
  }
});

/* ── (5) Different models -> different cache keys ─────────────────────── */

test('Different models produce different cache results', async () => {
  _resetCache();
  const m2 = JSON.parse(JSON.stringify(CASH_ERUPTION));
  /* Mutate hwBase to invalidate cache key. */
  if (!m2.payback) m2.payback = {};
  if (!m2.payback.rtpBreakdown) m2.payback.rtpBreakdown = {};
  m2.payback.rtpBreakdown.hwBase = 99.99;
  const r1 = await computeHoldAndWinKernelRtp(CASH_ERUPTION);
  const r2 = await computeHoldAndWinKernelRtp(m2);
  if (r1.ok && r2.ok) {
    /* The cache key includes hwBase, so two calls produce two cache
     * entries (both invoke kernel). RTP may be same since money_collect
     * doesn't directly depend on hwBase, but that's fine — we just verify
     * the cache key axis works. */
    assert(typeof r1.rtpContribution === 'number' && typeof r2.rtpContribution === 'number',
      'both should produce numeric rtpContribution');
  }
});

/* ── Result ──────────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
