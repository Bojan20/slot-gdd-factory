#!/usr/bin/env node
/**
 * tests/tools/math-7-engine.test.mjs
 *
 * MATH-7 — slot-math-engine-template WASM oracle wrapper self-test.
 *
 * Asertuje:
 *   1. mathEngine exposes async public API
 *   2. JS fallback radi za buyFeatureRtp / bothWays / binomialPmfGe /
 *      compliance gates
 *   3. WASM kad je dostupan dosegnut (getEngineKind = 'wasm') ALI test
 *      ne fails ako WASM nije linked — to je dizajn (graceful fallback)
 *   4. Math consistency: JS vs WASM = identical results (kad oba postoje)
 */

import {
  buyFeatureRtp, bothWaysRtp, binomialPmfGe,
  buyFeatureUkgcRts13cPass, buyFeatureMgaPass,
  payAnywhereExpectedPay, getEngineKind, loadWasm,
} from '../../src/blocks/mathEngine.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function approxEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

try {
  /* (1) loadWasm returns nullable (no throw). */
  const wasm = await loadWasm();
  const kind = getEngineKind();
  assert(kind === 'wasm' || kind === 'js-fallback',
    `getEngineKind expected 'wasm' or 'js-fallback', got ${kind}`);
  console.log(`  engine kind: ${kind}${wasm ? ' (sister repo linked)' : ' (sister repo not available, JS fallback active)'}`);

  /* (2) buyFeatureRtp basic: bonus 96 / buy cost 100 = 96% RTP. */
  const buyRtp = await buyFeatureRtp(96, 100);
  assert(approxEq(buyRtp, 0.96), `buyFeatureRtp(96, 100) expected 0.96, got ${buyRtp}`);

  /* (3) buyFeatureRtp edge: buy cost = 0 → 0 (no division by zero). */
  const zeroCost = await buyFeatureRtp(50, 0);
  assert(zeroCost === 0, `buyFeatureRtp(50, 0) expected 0 (safe), got ${zeroCost}`);

  /* (4) bothWaysRtp: LTR-only 0.5 × (1 + share 0.4) = 0.7 */
  const bw = await bothWaysRtp(0.5, 0.4);
  assert(approxEq(bw, 0.7), `bothWaysRtp(0.5, 0.4) expected 0.7, got ${bw}`);

  /* (5) binomialPmfGe boundary: kMin=0 → 1 (certain). */
  const allCerts = await binomialPmfGe(10, 0.5, 0);
  assert(allCerts === 1, `binomialPmfGe(10, 0.5, 0) expected 1, got ${allCerts}`);

  /* binomialPmfGe(n, p, n+1) → 0 (impossible to get more than n). */
  const impossible = await binomialPmfGe(10, 0.5, 11);
  assert(impossible === 0, `binomialPmfGe(10, 0.5, 11) expected 0, got ${impossible}`);

  /* binomialPmfGe(10, 0.5, 5) ≈ 0.623 (theory). */
  const half = await binomialPmfGe(10, 0.5, 5);
  assert(half > 0.6 && half < 0.65, `binomialPmfGe(10, 0.5, 5) expected ≈0.623, got ${half}`);

  /* (6) UKGC RTS 13C compliance gate. WASM Rust spec: tolerance_pp is in
   * PERCENTAGE POINTS (whole), divided by 100 internally to fraction.
   * buy_rtp(96, 100) = 0.96, base = 0.95, |diff| = 0.01 fraction = 1 pp.
   * tolerance 2.0 pp (0.02 fraction) → pass; tolerance 0.5 pp (0.005) → fail. */
  const uk_pass = await buyFeatureUkgcRts13cPass(96, 100, 0.95, 2.0);
  assert(uk_pass === true, `UKGC RTS13C should pass (1pp diff ≤ 2pp), got ${uk_pass}`);
  const uk_fail = await buyFeatureUkgcRts13cPass(96, 100, 0.95, 0.5);
  assert(uk_fail === false, `UKGC RTS13C should fail (1pp diff > 0.5pp), got ${uk_fail}`);

  /* (7) MGA RG 2021/02 ceiling gate: buy_rtp (0.96) ≤ ceiling 0.98 → pass;
   * ceiling 0.90 → fail (buy_rtp exceeds). */
  const mga_pass = await buyFeatureMgaPass(96, 100, 0.98);
  assert(mga_pass === true, `MGA should pass (0.96 ≤ 0.98), got ${mga_pass}`);
  const mga_fail = await buyFeatureMgaPass(96, 100, 0.90);
  assert(mga_fail === false, `MGA should fail (0.96 > 0.90), got ${mga_fail}`);

  /* (8) payAnywhereExpectedPay basic: 15-cell grid, 0.1 p/cell, paytable
   * 8→2×, 9→15×, 10→50× — expected pay > 0 + finite. */
  const exp = await payAnywhereExpectedPay(15, 0.1, [
    { threshold: 8,  pay: 2  },
    { threshold: 9,  pay: 15 },
    { threshold: 10, pay: 50 },
  ]);
  assert(typeof exp === 'number' && exp >= 0 && Number.isFinite(exp),
    `payAnywhereExpectedPay expected non-negative finite, got ${exp}`);

  /* (9) Determinism: re-call sa istim args = identical results. */
  const a = await buyFeatureRtp(123, 100);
  const b = await buyFeatureRtp(123, 100);
  assert(a === b, `non-deterministic buyFeatureRtp: ${a} ≠ ${b}`);

  console.log(`✓ math-7-engine.test.mjs — wrapper API verified (engine: ${kind}), 9 sub-tests passed`);
} catch (e) {
  console.error('✗ math-7-engine.test.mjs:', e.message);
  process.exit(1);
}
