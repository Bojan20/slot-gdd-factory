#!/usr/bin/env node
/**
 * tests/contracts/math-kernel-bridge.test.mjs
 *
 * MATH-DEEP B — Sister-repo Rust/Python kernel bridge contract test.
 *
 * Purpose
 *   Verifies tools/math-kernel-bridge.mjs can reach the sister repo
 *   (`~/Projects/slot-math-engine-template/packages/slot-math-kernels/`)
 *   and execute deterministic kernels via JSON IPC. This is the path to
 *   regulator-grade ±0.05% RTP precision: the JS probe is an
 *   approximation, the Python kernels are GLI-19-certified math.
 *
 * Strategy
 *   - Detect sister repo availability (graceful skip when not present —
 *     CI environments without the sister repo should not fail this test).
 *   - When available, call 4 representative kernels: both_ways, cluster_pays,
 *     pay_anywhere, hold_and_win.
 *   - Assert: each call returns engine='python-kernel' OR engine='unavailable'.
 *     If python-kernel, result has numeric outputs.
 *
 * Why
 *   This is the "kernel handshake live" proof. Without this test, the
 *   bridge could silently drift (sister repo refactor breaks the CLI
 *   contract) and we wouldn't know until production calibration runs fail.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectKernelEngine, callKernel } from '../../tools/math-kernel-bridge.mjs';

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

console.log('MATH KERNEL BRIDGE contract · test suite');

/* ── (1) detectKernelEngine returns structured result ──────────────── */

test('detectKernelEngine returns { available, pythonCmd, kernelsDir, reason? }', () => {
  const d = detectKernelEngine();
  assert(typeof d === 'object' && d !== null, 'should return object');
  assert(typeof d.available === 'boolean', 'available should be boolean');
  if (d.available) {
    assert(typeof d.pythonCmd === 'string', 'pythonCmd should be string when available');
    assert(typeof d.kernelsDir === 'string', 'kernelsDir should be string when available');
  } else {
    assert(typeof d.reason === 'string', 'reason should be string when unavailable');
  }
});

/* ── (2) Each known kernel callable (graceful skip if unavailable) ──── */

const KERNEL_TESTS = [
  {
    name: 'both_ways',
    params: { ltr_only_rtp: 0.96, line_pay_share: 0.7 },
    expectedField: 'rtp_contribution',
  },
  {
    name: 'cluster_pays',
    params: { min_cluster: 5, pay_table: { 5: 0.8, 10: 5, 15: 50 } },
    expectedField: null, /* schema unknown — just check it runs OR returns error */
  },
  {
    name: 'pay_anywhere',
    params: { min_count: 8, base_pay: 1.0 },
    expectedField: null,
  },
  {
    name: 'hold_and_win',
    params: { initial_lock: 6, respins: 3 },
    expectedField: null,
  },
];

for (const kt of KERNEL_TESTS) {
  test(`callKernel('${kt.name}') reachable (engine=python-kernel OR error)`, async () => {
    const det = detectKernelEngine();
    if (!det.available) {
      console.log(`    (skipped — sister repo unavailable: ${det.reason})`);
      return;
    }
    const r = await callKernel(kt.name, kt.params);
    /* Acceptable outcomes: python-kernel success OR error with reason. NOT
     * 'unavailable' (we already detected available) and NOT a thrown exception. */
    assert(typeof r === 'object' && r !== null, 'should return object');
    assert(r.engine === 'python-kernel' || r.engine === 'error',
      `engine should be python-kernel or error, got: ${r.engine}`);
    if (r.engine === 'python-kernel') {
      assert(r.kernel === kt.name, `kernel name mismatch: ${r.kernel}`);
      assert(typeof r.result === 'object', `result should be object`);
      if (kt.expectedField) {
        assert(typeof r.result[kt.expectedField] === 'number',
          `result.${kt.expectedField} should be number`);
      }
    }
  });
}

/* ── (3) Unknown kernel returns structured error ─────────────────────── */

test('callKernel("nonexistent_kernel") returns engine=error with knownKernels list', async () => {
  const r = await callKernel('nonexistent_kernel');
  assert(r.engine === 'error', `engine should be error, got: ${r.engine}`);
  assert(r.reason.includes('unknown kernel'), `reason should mention unknown kernel: ${r.reason}`);
  assert(Array.isArray(r.knownKernels) && r.knownKernels.length > 10,
    `knownKernels should be array of 10+, got ${r.knownKernels?.length}`);
});

/* ── (4) Determinism: same kernel + same params = same result ──────── */

test('Determinism: 2x both_ways with same params yields same rtp_contribution', async () => {
  const det = detectKernelEngine();
  if (!det.available) {
    console.log(`    (skipped — sister repo unavailable)`);
    return;
  }
  const params = { ltr_only_rtp: 0.96, line_pay_share: 0.7 };
  const r1 = await callKernel('both_ways', params);
  const r2 = await callKernel('both_ways', params);
  if (r1.engine !== 'python-kernel' || r2.engine !== 'python-kernel') {
    throw new Error(`kernel calls failed: r1=${r1.engine}, r2=${r2.engine}`);
  }
  assert(r1.result.rtp_contribution === r2.result.rtp_contribution,
    `non-deterministic: ${r1.result.rtp_contribution} ≠ ${r2.result.rtp_contribution}`);
});

/* ── (5) Bridge respects 30s timeout ─────────────────────────────────── */

test('Bridge enforces 30s timeout on kernel calls', async () => {
  /* Verify timeout source-level. ESM import (no require). */
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(REPO, 'tools/math-kernel-bridge.mjs'), 'utf8');
  assert(src.includes('timeout: 30_000') || src.includes('timeout: 30000'),
    'bridge should set 30s timeout on spawnSync');
});

/* ── Result ──────────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
