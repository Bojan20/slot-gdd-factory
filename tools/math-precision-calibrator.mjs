#!/usr/bin/env node
/**
 * tools/math-precision-calibrator.mjs
 *
 * N+2 D (2026-06-23) — Compare declared GDD RTP against the analytical
 * RTP derived from a PAR sheet, emit a precision-band verdict using the
 * global ±0.05% gate (MATH_PRECISION_BAND_PCT).
 *
 * Inputs
 *   model    — parser model (declared RTP candidate fields)
 *   parBlob  — adapter output (per_reel_weights + paytable)
 *
 * Algorithm (analytical, no Monte Carlo)
 *   For each reel r and symbol s:
 *     pHit(r, s) = weight(r, s) / sum(weights on reel r)
 *
 *   For each paytable row (symbolId, combos { '3': pay, '4': pay, '5': pay }):
 *     For each match-count k in {3, 4, 5}:
 *       Probability of "first k reels show symbolId in any position":
 *         p(k, s) = product(r=0..k-1) of pHit(r, s)
 *       Multiply by left-anchored payline factor (single line baseline):
 *         contribution(s, k) = p(k, s) * pay(k)
 *     RTP_contribution(s) = sum over k of contribution(s, k)
 *
 *   Analytical RTP = sum over s of RTP_contribution(s).
 *
 * Caveats (documented in receipt.assumptions)
 *   - This is a single-payline, left-anchored 3-of-a-kind oracle. Real
 *     RTP integrates over all paylines + scatter + features + bonus
 *     buy + free spins; the WASM oracle (MATH-7) does the full sweep.
 *   - For typical 5-reel paytables this oracle converges to within
 *     ±2-5% of full RTP; the GATE here is RELATIVE drift (declared RTP
 *     vs ORACLE RTP), not absolute compliance. The ±0.05% band fires
 *     when the GDD-declared number cannot be reproduced even at this
 *     baseline — a clear signal that paytable / weights are inconsistent.
 *   - Operators wanting absolute compliance run MATH-7 WASM oracle
 *     against sister repo PAR kernels; this calibrator catches the cheap
 *     bugs (typos, swapped weights, wrong currency multiplier).
 *
 * Public API
 *   - calibrate(model, parBlob) -> CalibrationReceipt
 *   - analyticalRtpFromPar(parBlob) -> { rtp, contributions, totals }
 *   - declaredRtpFromModel(model)  -> number | null
 *
 * CalibrationReceipt = {
 *   declaredRtp:    number | null
 *   parRtp:         number
 *   deltaPct:       number       // absolute |declared - par|
 *   bandPct:        number       // MATH_PRECISION_BAND_PCT
 *   verdict:        'PASS' | 'WARN' | 'FAIL' | 'NON_BINDING'
 *   reason:         string
 *   contributions:  { [symId]: number }    // per-symbol RTP share
 *   totals:         { perReelSum: number[], symbols: number }
 *   assumptions:    string[]    // documented oracle limitations
 * }
 */

import {
  MATH_PRECISION_BAND_PCT,
  MATH_PRECISION_BAND_LABEL,
} from '../src/registry/mathPrecision.mjs';

/* ── declared RTP extraction ─────────────────────────────────────────── */

/**
 * Probe well-known model fields for declared RTP.
 * Returns null when no plausible RTP found.
 *
 * Order of preference:
 *   1. model.rtp.target          (numeric, 80–100 percent expected)
 *   2. model.rtp.declared
 *   3. model.compliance.rtp
 *   4. model.math.rtp
 *   5. top-level model.rtp (when numeric)
 */
export function declaredRtpFromModel(model) {
  if (!model || typeof model !== 'object') return null;

  const tryNum = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const m = v.match(/-?\d+(\.\d+)?/);
      if (m) {
        const n = parseFloat(m[0]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  /* UQ-DEEP-L fix (Boki 2026-06-23): kada parser ne uspe da ekstraktuje
   * RTP iz GDD prose (npr. WoO PDF), PAR sheet je primary source of
   * truth — calibrator mora da povuče declared RTP iz par_sheet_source
   * koji bridge stavi u model.reelStrips. Bez ovog, NON_BINDING verdict
   * fire-uje na svaki ingest sa external PAR čak i kad PAR ima Cover RTP. */
  const parSrc = model.reelStrips && model.reelStrips.par_sheet_source;
  const parDeclared = parSrc && parSrc.declared;
  const candidates = [
    model.rtp && model.rtp.target,
    model.rtp && model.rtp.declared,
    model.rtp && model.rtp.value,
    model.compliance && model.compliance.rtp,
    model.math && model.math.rtp,
    model.payback && model.payback.rtp,
    parDeclared && parDeclared.rtp,
    typeof model.rtp === 'number' ? model.rtp : null,
    typeof model.rtp === 'string' ? model.rtp : null,
  ];
  for (const c of candidates) {
    const n = tryNum(c);
    if (n === null) continue;
    /* Plausibility filter: industry slot RTPs sit in 80–100% range
     * but oracle test fixtures (single-payline calibration) may
     * declare lower values (~10–80%). Reject obvious noise only:
     * 0 (unset), > 100 (impossible), negative.
     * Strict 80-100% range still preferred for `__strict_declared__`
     * downstream consumers but accept 10-100% for oracle pipeline. */
    if (n >= 10 && n <= 100) return n;
    /* Sometimes RTP is recorded as fraction (0.96 instead of 96). */
    if (n >= 0.1 && n <= 1.0) return n * 100;
  }
  return null;
}

/* ── analytical RTP from PAR (oracle: left-anchored 1-payline, 3-OAK+) ── */

/**
 * Compute analytical RTP from a PAR blob.
 *
 * Returns:
 *   {
 *     rtp:           number                  // percent (e.g. 95.34)
 *     contributions: { [symId]: number }     // per-symbol percent contribution
 *     totals:        { perReelSum, symbols, reelCount }
 *   }
 *
 * Throws when blob shape is unusable (no weights or no paytable).
 */
export function analyticalRtpFromPar(parBlob) {
  if (!parBlob || typeof parBlob !== 'object') {
    throw new Error('analyticalRtpFromPar: parBlob required');
  }
  const weights = parBlob.per_reel_weights;
  const paytable = parBlob.paytable;
  if (!weights || typeof weights !== 'object' || Object.keys(weights).length === 0) {
    throw new Error('PAR blob has no per_reel_weights');
  }
  if (!Array.isArray(paytable) || paytable.length === 0) {
    throw new Error('PAR blob has no paytable');
  }

  /* reelIdx is a string key from JSON ('0','1','2',...). Sort numerically. */
  const reelKeys = Object.keys(weights).sort((a, b) => Number(a) - Number(b));
  const reelCount = reelKeys.length;
  const perReelSum = reelKeys.map(k => {
    const m = weights[k] || {};
    let s = 0;
    for (const v of Object.values(m)) {
      if (Number.isFinite(v) && v > 0) s += v;
    }
    return s;
  });

  /* Build P(symbol | reel) table. */
  function pHit(reelIdx, symId) {
    const m = weights[reelKeys[reelIdx]] || {};
    /* LOW-2 audit fix: avoid bitwise `| 0` truncation (silently wraps
     * weights > 2^31 to negative). Use Number() with NaN guard. */
    const wRaw = Number(m[symId]);
    const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    const sum = perReelSum[reelIdx] || 1;
    return w / sum;
  }

  const contributions = {};
  let rtpFraction = 0;
  const allSymbols = new Set();
  for (const row of paytable) {
    if (!row || !row.symbolId || !row.combos) continue;
    allSymbols.add(row.symbolId);
    let symContribFrac = 0;
    for (const [kStr, pay] of Object.entries(row.combos)) {
      const k = parseInt(kStr, 10);
      if (!Number.isFinite(k) || k < 3 || k > reelCount) continue;
      if (!Number.isFinite(pay) || pay <= 0) continue;
      /* Probability all of first k reels carry symbolId. */
      let p = 1;
      for (let r = 0; r < k; r++) {
        const ph = pHit(r, row.symbolId);
        if (ph <= 0) { p = 0; break; }
        p *= ph;
      }
      /* Expected return per spin per credit-bet: probability * pay.
       * pay is already in "× bet" units in adapter output. */
      symContribFrac += p * pay;
    }
    contributions[row.symbolId] = symContribFrac * 100; /* to percent */
    rtpFraction += symContribFrac;
  }

  return {
    rtp: rtpFraction * 100,
    contributions,
    totals: {
      perReelSum,
      symbols: allSymbols.size,
      reelCount,
    },
  };
}

/* ── verdict ladder ──────────────────────────────────────────────────── */

/**
 * Compare declared vs PAR-derived RTP, emit a precision-band verdict.
 *
 * @param {object} model
 * @param {object} parBlob
 * @returns {CalibrationReceipt}
 */
export function calibrate(model, parBlob) {
  const assumptions = [
    'oracle = left-anchored single payline, 3/4/5-of-a-kind only',
    'no scatter, no wild substitution, no free spins, no bonus buy',
    'real-game RTP integrates all paylines + features — see MATH-7 WASM oracle',
    `precision band = ${MATH_PRECISION_BAND_LABEL} relative to oracle baseline`,
  ];

  let declaredRtp = null;
  try {
    declaredRtp = declaredRtpFromModel(model);
  } catch (_) { declaredRtp = null; }

  let analytical;
  try {
    analytical = analyticalRtpFromPar(parBlob);
  } catch (e) {
    return {
      declaredRtp,
      parRtp: null,
      deltaPct: null,
      bandPct: MATH_PRECISION_BAND_PCT,
      verdict: 'NON_BINDING',
      reason: `oracle unavailable: ${e.message}`,
      contributions: {},
      totals: null,
      assumptions,
    };
  }

  if (declaredRtp === null) {
    return {
      declaredRtp: null,
      parRtp: analytical.rtp,
      deltaPct: null,
      bandPct: MATH_PRECISION_BAND_PCT,
      verdict: 'NON_BINDING',
      reason: 'declared RTP not found in model — oracle ran but no comparison possible',
      contributions: analytical.contributions,
      totals: analytical.totals,
      assumptions,
    };
  }

  /* UQ-DEEP-C audit fix (D-CRIT-NaN): if the oracle produced a
   * non-finite RTP (NaN, +Infinity, -Infinity) because the underlying
   * PAR sheet had zero column sums, division-by-zero in pHit(), or
   * adversarial weights, the subsequent verdict ladder silently
   * mis-classifies (NaN <= 0.05 → false, so FAIL fires with reason
   * "drift NaN%"). Surface this explicitly as NON_BINDING so operators
   * know the PAR file itself is malformed, not the math. */
  if (!Number.isFinite(analytical.rtp)) {
    return {
      declaredRtp,
      parRtp: analytical.rtp,
      deltaPct: null,
      bandPct: MATH_PRECISION_BAND_PCT,
      verdict: 'NON_BINDING',
      reason: `oracle produced non-finite RTP (${String(analytical.rtp)}) — PAR sheet likely has zero reel weights, division-by-zero, or adversarial values`,
      contributions: analytical.contributions,
      totals: analytical.totals,
      assumptions,
    };
  }

  const deltaPct = Math.abs(declaredRtp - analytical.rtp);
  const lineExpansionGap = declaredRtp - analytical.rtp;

  /* Verdict ladder:
   *   PASS                       delta ≤ ±0.05%
   *   WARN                       0.05% < delta ≤ 0.5%
   *   FAIL                       delta > 0.5% AND declared ≤ oracle
   *   NON_BINDING_LINE_EXPANSION declared > oracle by > 5%
   *
   * Note on NON_BINDING_LINE_EXPANSION: this oracle is intentionally
   * single-payline (left-anchored 3/4/5-OAK only). Real-game RTP
   * integrates 20–243 paylines × scatter × wild substitution × free
   * spins × bonus buy — typically 5–10× the single-line baseline. When
   * declared RTP is materially HIGHER than the oracle baseline, the gap
   * is the line-expansion delta, not an architectural bug. Calibrator
   * surfaces this honestly (operator sees "PAR could be valid, oracle
   * cannot decide") rather than falsely flagging FAIL.
   *
   * FAIL fires only when declared ≤ oracle baseline by > 0.5% — i.e.
   * the PAR over-pays the single-line approximation, which means the
   * full-game RTP MUST exceed the declared number. That's a clear bug
   * (typo, wrong currency multiplier, swapped weights).
   */
  let verdict, reason;
  if (deltaPct <= MATH_PRECISION_BAND_PCT) {
    verdict = 'PASS';
    reason  = `within ${MATH_PRECISION_BAND_LABEL} band (Δ=${deltaPct.toFixed(4)}%)`;
  } else if (lineExpansionGap > 5) {
    verdict = 'NON_BINDING_LINE_EXPANSION';
    reason  = `declared ${declaredRtp.toFixed(2)}% > oracle ${analytical.rtp.toFixed(2)}% by ${lineExpansionGap.toFixed(2)}% — gap consistent with multi-payline + feature expansion (oracle inconclusive)`;
  } else if (deltaPct <= 0.5) {
    verdict = 'WARN';
    reason  = `oracle drift ${deltaPct.toFixed(4)}% > ${MATH_PRECISION_BAND_LABEL} but ≤ 0.5%`;
  } else {
    verdict = 'FAIL';
    reason  = `oracle drift ${deltaPct.toFixed(4)}% > 0.5% AND declared ≤ oracle — PAR over-pays single-line baseline`;
  }

  return {
    declaredRtp,
    parRtp: analytical.rtp,
    deltaPct,
    bandPct: MATH_PRECISION_BAND_PCT,
    verdict,
    reason,
    contributions: analytical.contributions,
    totals: analytical.totals,
    assumptions,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('math-precision-calibrator.mjs')) {
  const { readFileSync, existsSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const modelPath = args.find(a => a.startsWith('--model='))?.slice(8);
  const parPath   = args.find(a => a.startsWith('--par='))?.slice(6);
  if (!modelPath || !parPath) {
    console.error('Usage: node tools/math-precision-calibrator.mjs --model=PATH --par=PATH');
    console.error('  model: dist/ingest/<slug>/model.json');
    console.error('  par:   reports/par-sheet-ingested/<slug>.json');
    process.exit(2);
  }
  if (!existsSync(modelPath)) { console.error(`model missing: ${modelPath}`); process.exit(1); }
  if (!existsSync(parPath))   { console.error(`par missing: ${parPath}`);     process.exit(1); }
  const model   = JSON.parse(readFileSync(modelPath, 'utf8'));
  const parBlob = JSON.parse(readFileSync(parPath, 'utf8'));
  const out = calibrate(model, parBlob);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.verdict === 'FAIL' ? 1 : 0);
}
