#!/usr/bin/env node
/**
 * tests/contracts/cluster-kernel-bridge.test.mjs
 *
 * MATH-DEEP B++ — Cluster-pays kernel bridge contract (2026-06-23).
 *
 * Verifies:
 *   1. computeClusterPaysKernelRtp(model) returns structured result
 *   2. Sister-repo cluster_pays kernel reachable via custom runner
 *   3. Topology gate (rejects non-cluster models)
 *   4. Deterministic across calls
 *   5. Cache works
 *   6. Empirical override (clusterCountDistribution param) used when present
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeClusterPaysKernelRtp,
  _resetCache,
} from '../../src/blocks/featureSimPlugins/clusterEvalKernelBridge.mjs';
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

console.log('CLUSTER KERNEL BRIDGE contract · test suite');

const STARLIGHT = JSON.parse(readFileSync(
  join(REPO, 'dist/real-games/starlight-travellers-gdd/model.json'), 'utf8'));

/* ── (1) Structured result shape ──────────────────────────────────────── */

test('computeClusterPaysKernelRtp returns { ok, rtpContribution, perSymbol[] }', async () => {
  _resetCache();
  const r = await computeClusterPaysKernelRtp(STARLIGHT);
  assert(typeof r === 'object', 'object');
  assert(typeof r.ok === 'boolean', 'ok boolean');
  if (r.ok) {
    assert(typeof r.rtpContribution === 'number', 'rtpContribution number');
    assert(Array.isArray(r.perSymbol), 'perSymbol array');
    assert(r.minClusterSize === 5, `minClusterSize: ${r.minClusterSize}`);
    assert(r.kernelEngine === 'python-kernel', `engine: ${r.kernelEngine}`);
  }
});

/* ── (2) RTP contribution positive for cluster game ──────────────────── */

test('Starlight cluster rtpContribution > 0 (kernel reachable)', async () => {
  _resetCache();
  const r = await computeClusterPaysKernelRtp(STARLIGHT);
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped — sister repo unavailable)'); return; }
    throw new Error(`kernel failed: ${r.reason}`);
  }
  assert(r.rtpContribution > 0, `expected > 0, got ${r.rtpContribution}`);
});

/* ── (3) Topology gate — non-cluster rejected ────────────────────────── */

test('Non-cluster model is rejected with reason', async () => {
  const m = { topology: { reels: 5, rows: 3, evaluation: 'lines' } };
  const r = await computeClusterPaysKernelRtp(m);
  assert(r.ok === false, `expected ok=false for lines topology`);
  assert(r.reason.includes('not cluster'), `reason: ${r.reason}`);
});

/* ── (4) Deterministic across calls ──────────────────────────────────── */

test('Same model → same rtpContribution (deterministic)', async () => {
  _resetCache();
  const r1 = await computeClusterPaysKernelRtp(STARLIGHT);
  _resetCache();
  const r2 = await computeClusterPaysKernelRtp(STARLIGHT);
  if (!r1.ok || !r2.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error('calls failed');
  }
  assert(r1.rtpContribution === r2.rtpContribution,
    `non-deterministic: ${r1.rtpContribution} ≠ ${r2.rtpContribution}`);
});

/* ── (5) Cache: 2nd call instant ─────────────────────────────────────── */

test('Cache hit: 2nd call (same model) much faster than fresh', async () => {
  _resetCache();
  const t1Start = Date.now();
  const r1 = await computeClusterPaysKernelRtp(STARLIGHT);
  const t1 = Date.now() - t1Start;
  const t2Start = Date.now();
  await computeClusterPaysKernelRtp(STARLIGHT);
  const t2 = Date.now() - t2Start;
  if (r1.ok) {
    assert(t2 < t1 || t2 < 50, `cache miss? t1=${t1}, t2=${t2}`);
  }
});

/* ── (6) Empirical override (clusterCountDistribution) used ───────────── */

test('Empirical clusterCountDistribution override used when provided', async () => {
  _resetCache();
  const customDist = { 'X': { 5: 0.5, 6: 0.2 } };
  const customPay = { 'X': { 5: 10, 6: 50 } };
  const r = await computeClusterPaysKernelRtp(STARLIGHT, {
    clusterCountDistribution: customDist,
    payTable: customPay,
  });
  if (!r.ok) {
    const d = detectKernelEngine();
    if (!d.available) { console.log('    (skipped)'); return; }
    throw new Error(`failed: ${r.reason}`);
  }
  /* RTP = 0.5 × 10 + 0.2 × 50 = 5 + 10 = 15. */
  assert(Math.abs(r.rtpContribution - 15.0) < 1e-6,
    `expected 15.0, got ${r.rtpContribution}`);
});

/* ── Result ──────────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
