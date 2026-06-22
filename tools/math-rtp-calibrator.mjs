#!/usr/bin/env node
/**
 * tools/math-rtp-calibrator.mjs
 *
 * MATH-PRECISION-3 — RTP calibrator.
 *
 * Boki direktiva 2026-06-22: "mora da radi seto postgo na +- 0.05%".
 *
 * Generic-distribution probe (tools/math-rtp-probe.mjs) drift-uje ±2-5% od
 * declared RTP zbog blanket stop_distribution {hp:0.07, mp:0.13, lp:0.20,
 * wild:0.03, scatter:0.02}. Real GDD par sheet weights su confidential — bez
 * njih, kalibrator binary-search-uje na scatter + wild weights dok measured
 * RTP nije unutar precision band-a (±0.05%) od declared.
 *
 * ALGORITAM
 *   1. Probe run sa current stop_distribution → measuredRTP X
 *   2. Δ = X − declared
 *   3. If |Δ| ≤ 0.05 → converged, write calibrated weights
 *   4. Else: adjust scatter weight inverse-proportional na Δ
 *      (high RTP → reduce scatter; low RTP → increase scatter)
 *   5. Repeat do MAX_ITER (default 30) or convergence
 *   6. Persist calibrated dist u model.reelStrips.calibrated_stop_distribution
 *      so future probe runs use it. ORIGINAL stop_distribution se ne menja.
 *
 * USAGE
 *   node tools/math-rtp-calibrator.mjs                              # cash-eruption
 *   node tools/math-rtp-calibrator.mjs --slug X --target 96 --runs 50000
 *
 * EXIT
 *   0 — converged within ±0.05%
 *   1 — failed to converge in MAX_ITER (informational)
 *   2 — model missing
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { MATH_PRECISION_BAND_PCT, MATH_PRECISION_BAND_LABEL } from '../src/registry/mathPrecision.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/math-calibrator`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const TARGET_OVR = argVal('--target') ? parseFloat(argVal('--target')) : null;
const RUNS = parseInt(argVal('--runs') || '100000', 10);
const MAX_ITER = parseInt(argVal('--max-iter') || '40', 10);
const FIXED_SEED = parseInt(argVal('--seed') || '42', 10);  /* Same seed every iter — deterministic scatterW → RTP mapping for binary search. */

const MODEL_PATH = join(REPO, `dist/real-games/${SLUG}/model.json`);
if (!existsSync(MODEL_PATH)) {
  console.error(`▸ model.json missing: ${MODEL_PATH}`);
  process.exit(2);
}

const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
const TARGET_RTP = TARGET_OVR != null ? TARGET_OVR : (model.payback?.rtp ?? null);

if (TARGET_RTP == null) {
  console.error(`▸ ${SLUG} has no declared RTP target; pass --target X`);
  process.exit(2);
}

console.log(`MATH-PRECISION-3 RTP calibrator · ${SLUG}`);
console.log(`Target RTP: ${TARGET_RTP}%   Precision band: ${MATH_PRECISION_BAND_LABEL}   Runs/iter: ${RUNS}`);
console.log('');

/* Initial distribution (industry-default-weighted) */
const initial = {
  hp:      0.07,
  mp:      0.13,
  lp:      0.20,
  wild:    0.03,
  scatter: 0.02,
};

const original = model.reelStrips?.stop_distribution || initial;
let current = { ...original };

/* Run a probe iteration with a given stop_distribution.
 * Strategy: write the trial distribution into model.json (calibrator_trial_dist),
 * run probe pointing at it via env var, capture measured RTP. */
const TRIAL_FIELD = '__calibrator_trial_distribution__';
const REPORT_PATH = join(REPO, `reports/math-rtp/${SLUG}.json`);

function runProbe(dist, seed) {
  /* Patch model with trial distribution, run probe, restore. */
  const orig = readFileSync(MODEL_PATH, 'utf8');
  const m = JSON.parse(orig);
  if (!m.reelStrips) m.reelStrips = {};
  m.reelStrips.stop_distribution = dist;
  writeFileSync(MODEL_PATH, JSON.stringify(m, null, 2));
  try {
    const r = spawnSync('node', [
      join(REPO, 'tools/math-rtp-probe.mjs'),
      '--slug', SLUG,
      '--runs', String(RUNS),
      '--seed', String(seed),
    ], { cwd: REPO, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`probe exit ${r.status}: ${r.stderr}`);
    const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
    /* 2026-06-23: probe now applies auto-RTP-clamp DEFAULT ON for declared
     * lines-topology games. Calibrator MUST use rawMeasuredRTP (pre-clamp
     * baseline) to measure the true gap that the calibrator is trying to
     * close. measuredRTP would be the clamped value (always ≈ declared),
     * which would short-circuit the calibration loop on iter 0. */
    return report.rawMeasuredRTP ?? report.measuredRTP;
  } finally {
    /* Restore original model. */
    writeFileSync(MODEL_PATH, orig);
  }
}

const log = [];
let converged = false;
let lastRtp = null;

/* 1-D binary-search on scatter weight (largest single-pay impact). */
let lo = 0.001;
let hi = 0.10;
let scatterW = current.scatter;

for (let iter = 0; iter < MAX_ITER; iter++) {
  const trial = { ...current, scatter: scatterW };
  const measured = runProbe(trial, FIXED_SEED);
  const delta = measured - TARGET_RTP;
  const entry = { iter, scatterW: +scatterW.toFixed(5), measuredRTP: measured, delta: +delta.toFixed(2) };
  log.push(entry);
  console.log(`  iter ${String(iter).padStart(2)}: scatterW=${entry.scatterW}  measuredRTP=${measured}%  Δ=${entry.delta} pp`);

  if (Math.abs(delta) <= MATH_PRECISION_BAND_PCT) {
    converged = true;
    lastRtp = measured;
    current = trial;
    break;
  }

  /* High measured → too many big wins → reduce scatter weight. */
  if (delta > 0) {
    hi = scatterW;
    scatterW = (lo + scatterW) / 2;
  } else {
    lo = scatterW;
    scatterW = (scatterW + hi) / 2;
  }

  /* Stagnation check: lo/hi converge */
  if (Math.abs(hi - lo) < 1e-6) {
    console.log(`  binary search stagnated at iter ${iter} (hi-lo=${(hi-lo).toExponential()})`);
    break;
  }
  lastRtp = measured;
  current = trial;
}

const calibrated = current;

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-rtp-calibrator.mjs',
  slug: SLUG,
  targetRtp: TARGET_RTP,
  precisionBand: MATH_PRECISION_BAND_LABEL,
  initial,
  original,
  calibrated,
  iterations: log,
  converged,
  finalMeasuredRtp: lastRtp,
  finalDelta: lastRtp != null ? +(lastRtp - TARGET_RTP).toFixed(3) : null,
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

if (converged) {
  /* Persist calibrated dist into model under separate field so probe can opt in. */
  const m = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
  if (!m.reelStrips) m.reelStrips = {};
  m.reelStrips.calibrated_stop_distribution = calibrated;
  writeFileSync(MODEL_PATH, JSON.stringify(m, null, 2));
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Initial scatter weight:    ${original.scatter}`);
console.log(`  Calibrated scatter weight: ${calibrated.scatter.toFixed(5)}`);
console.log(`  Final measured RTP:        ${summary.finalMeasuredRtp}%`);
console.log(`  Final Δ:                   ${summary.finalDelta} pp`);
console.log(`  Converged (≤ ${MATH_PRECISION_BAND_PCT} pp): ${converged}`);
console.log(`  Iterations:                ${log.length}`);
console.log(`  Report:                    ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(converged ? '✓ PASS — converged within precision band' : '⚠ WARN — did not converge (gap surfaces real par sheet need)');
process.exit(converged ? 0 : 1);
