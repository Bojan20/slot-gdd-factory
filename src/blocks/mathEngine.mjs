/**
 * src/blocks/mathEngine.mjs
 *
 * MATH-7 — slot-math-engine-template WASM oracle wrapper.
 *
 * Lazy-loads sister repo's compiled WASM (`~/Projects/slot-math-engine-template/
 * packages/slot-math-wasm/pkg/`) when available; falls back to vanilla
 * JS calculation when WASM is not present or import fails.
 *
 * EXPOSED API (deterministic, vendor-neutral)
 *
 *   buyFeatureRtp(bonusAvgPayXBet, buyCostXBet)
 *     → Buy feature variant RTP = bonus_avg_pay / buy_cost
 *
 *   bothWaysRtp(ltrOnlyRtp, linePayShare)
 *     → Total RTP when "Win Both Ways" topology adds RTL share
 *
 *   payAnywhereExpectedPay(nCells, pPerCell, payTable)
 *     → Σ over thresholds: P[X ≥ k] × pay_k × bet
 *
 *   buyFeatureUkgcRts13cPass(bonusAvgPay, buyCost, baseGameRtp, tolerancePp)
 *     → UKGC RTS 13C compliance gate (|buy_rtp - base_rtp| ≤ tolerance)
 *
 *   buyFeatureMgaPass(bonusAvgPay, buyCost, ceilingRtp)
 *     → MGA RG 2021/02 ceiling gate
 *
 *   binomialPmfGe(n, p, kMin)
 *     → P[X ≥ kMin | n, p]   (binomial PMF tail probability)
 *
 *   getEngineKind()
 *     → 'wasm' | 'js-fallback'
 *
 * BROWSER vs NODE
 *   Node: tries dynamic import from sister repo path.
 *   Browser: caller-supplied URL via `loadWasm(url)` (not auto-loaded).
 *
 * NO LLM. Pure deterministic numeric.
 */

let _wasm = null;
let _engineKind = 'js-fallback';

/* ── Try to load WASM from sister repo (Node only) ─────────────────── */
async function _tryLoadWasm() {
  if (_wasm) return _wasm;
  if (typeof process === 'undefined' || !process.env) return null;
  const HOME = process.env.HOME || process.env.USERPROFILE;
  if (!HOME) return null;
  const path = `${HOME}/Projects/slot-math-engine-template/packages/slot-math-wasm/pkg/slot_math_wasm.js`;
  try {
    const m = await import(path);
    _wasm = m;
    _engineKind = 'wasm';
    return m;
  } catch (_) {
    return null;
  }
}

/* ── Vanilla JS fallback implementations ──────────────────────────── */

function _jsBinomialPmfGe(n, p, kMin) {
  if (kMin <= 0) return 1;
  if (kMin > n) return 0;
  /* Direct sum P[X = k] from kMin to n. */
  let sum = 0;
  for (let k = kMin; k <= n; k++) {
    sum += _jsBinomialPmfExact(n, p, k);
  }
  return sum;
}

function _jsBinomialPmfExact(n, p, k) {
  /* nCk × p^k × (1-p)^(n-k) via log to avoid overflow. */
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log(n - i + 1) - Math.log(i);
  const logPmf = logC + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logPmf);
}

function _jsBuyFeatureRtp(bonusAvgPay, buyCost) {
  if (!Number.isFinite(buyCost) || buyCost <= 0) return 0;
  return bonusAvgPay / buyCost;
}

function _jsBothWaysRtp(ltrOnlyRtp, linePayShare) {
  /* Both-ways doubles the line pay share (RTL = LTR symmetric). */
  return ltrOnlyRtp * (1 + linePayShare);
}

function _jsPayAnywhereExpectedPay(nCells, pPerCell, payTableKeys, payTableValues) {
  let total = 0;
  for (let i = 0; i < payTableKeys.length; i++) {
    const k = payTableKeys[i];
    const pay = payTableValues[i];
    /* Marginal: P[exactly k] = P[≥k] - P[≥k+1]. */
    const ge = _jsBinomialPmfGe(nCells, pPerCell, k);
    const ge1 = _jsBinomialPmfGe(nCells, pPerCell, k + 1);
    total += (ge - ge1) * pay;
  }
  return total;
}

function _jsBuyFeatureUkgcPass(bonusAvgPay, buyCost, baseGameRtp, tolerancePp) {
  /* WASM Rust spec: tolerance_pp is in PERCENTAGE POINTS (whole),
   * divided by 100 internally. Match the same convention here. */
  const buyRtp = _jsBuyFeatureRtp(bonusAvgPay, buyCost);
  return Math.abs(buyRtp - baseGameRtp) <= tolerancePp / 100;
}

function _jsBuyFeatureMgaPass(bonusAvgPay, buyCost, ceilingRtp) {
  const buyRtp = _jsBuyFeatureRtp(bonusAvgPay, buyCost);
  return buyRtp <= ceilingRtp;
}

/* ── Public API ──────────────────────────────────────────────────── */

export async function loadWasm() {
  return _tryLoadWasm();
}

export function getEngineKind() {
  return _engineKind;
}

export async function buyFeatureRtp(bonusAvgPay, buyCost) {
  await _tryLoadWasm();
  if (_wasm && typeof _wasm.buy_feature_rtp === 'function') {
    return _wasm.buy_feature_rtp(bonusAvgPay, buyCost);
  }
  return _jsBuyFeatureRtp(bonusAvgPay, buyCost);
}

export async function bothWaysRtp(ltrOnlyRtp, linePayShare) {
  await _tryLoadWasm();
  if (_wasm && typeof _wasm.both_ways_rtp === 'function') {
    return _wasm.both_ways_rtp(ltrOnlyRtp, linePayShare);
  }
  return _jsBothWaysRtp(ltrOnlyRtp, linePayShare);
}

export async function payAnywhereExpectedPay(nCells, pPerCell, payTable) {
  await _tryLoadWasm();
  const keys = Array.isArray(payTable) ? payTable.map(r => r.threshold ?? r.k) : [];
  const vals = Array.isArray(payTable) ? payTable.map(r => r.pay ?? r.value) : [];
  if (_wasm && typeof _wasm.pay_anywhere_expected_pay === 'function') {
    return _wasm.pay_anywhere_expected_pay(
      nCells, pPerCell,
      new Uint32Array(keys),
      new Float64Array(vals)
    );
  }
  return _jsPayAnywhereExpectedPay(nCells, pPerCell, keys, vals);
}

export async function buyFeatureUkgcRts13cPass(bonusAvgPay, buyCost, baseGameRtp, tolerancePp) {
  await _tryLoadWasm();
  if (_wasm && typeof _wasm.buy_feature_ukgc_rts13c_pass === 'function') {
    return _wasm.buy_feature_ukgc_rts13c_pass(bonusAvgPay, buyCost, baseGameRtp, tolerancePp);
  }
  return _jsBuyFeatureUkgcPass(bonusAvgPay, buyCost, baseGameRtp, tolerancePp);
}

export async function buyFeatureMgaPass(bonusAvgPay, buyCost, ceilingRtp) {
  await _tryLoadWasm();
  if (_wasm && typeof _wasm.buy_feature_mga_pass === 'function') {
    return _wasm.buy_feature_mga_pass(bonusAvgPay, buyCost, ceilingRtp);
  }
  return _jsBuyFeatureMgaPass(bonusAvgPay, buyCost, ceilingRtp);
}

export async function binomialPmfGe(n, p, kMin) {
  await _tryLoadWasm();
  if (_wasm && typeof _wasm.binomialPmfGe === 'function') {
    return _wasm.binomialPmfGe(n, p, kMin);
  }
  return _jsBinomialPmfGe(n, p, kMin);
}
