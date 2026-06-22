#!/usr/bin/env node
/**
 * tools/math-volatility-calc.mjs
 *
 * MATH-5 — volatility index calculator.
 *
 * Reads RTP probe output (reports/math-rtp/<slug>.json) and computes:
 *   • per-spin variance (σ²)
 *   • standard deviation (σ)
 *   • coefficient of variation (σ / mean)
 *   • volatility index 1-10 mapping (per industry segmentation)
 *
 * Volatility tier mapping (GLI-19 reference, vendor-neutral):
 *   CV < 2.5      → low      (idx 3)
 *   CV 2.5-5      → low-med  (idx 4)
 *   CV 5-10       → medium   (idx 5)
 *   CV 10-20      → med-high (idx 7)
 *   CV 20-50      → high     (idx 8)
 *   CV > 50       → extreme  (idx 10)
 *
 * RTP probe output sufficient (uses winHistogram for variance estimate).
 *
 * INPUT
 *   --slug X     game slug (default cash-eruption-foundry-gdd)
 *   --probe FILE explicit probe report path (else infer from slug)
 *
 * OUTPUT
 *   reports/math-volatility/<slug>.json — measured vol stats
 *   stdout one-line comparison vs declared
 *
 * EXIT
 *   0 — vol calc successful
 *   1 — probe report missing or invalid
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/math-volatility`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const PROBE_PATH = argVal('--probe')
  || join(REPO, `reports/math-rtp/${SLUG}.json`);

if (!existsSync(PROBE_PATH)) {
  console.error(`▸ probe report missing: ${PROBE_PATH}`);
  console.error(`▸ run: node tools/math-rtp-probe.mjs --slug ${SLUG} first`);
  process.exit(1);
}

const probe = JSON.parse(readFileSync(PROBE_PATH, 'utf8'));

/* ── Compute variance via histogram bucket midpoints ──────────────────
 * Use bucket midpoints as the win value estimate per bucket:
 *   <1×       midpoint 0.5
 *   1-5×      midpoint 3
 *   5-25×     midpoint 15
 *   25-100×   midpoint 62.5
 *   100×+     midpoint = maxSingleSpinX (best available)
 * Variance = Σ (count[b] × (midpoint[b] - mean)²) / N
 */
const wh = probe.winHistogram || {};
const RUNS = probe.runs;
const BET  = probe.bet || 1;

const bucketMid = {
  lt1x:     0.5,
  '1-5x':   3,
  '5-25x':  15,
  '25-100x': 62.5,
  '100x+':  Math.max(150, probe.maxSingleSpinX || 150),
};

let sumWin = 0;
let n = 0;
for (const k of Object.keys(bucketMid)) {
  const cnt = wh[k] || 0;
  sumWin += cnt * bucketMid[k];
  n += cnt;
}
/* Losing spins (no win) — N - n hits */
const losingCount = RUNS - n;
const losingMid = 0;

const totalCount = RUNS;
const mean = (sumWin + losingCount * losingMid) / totalCount;

let variance = 0;
for (const k of Object.keys(bucketMid)) {
  const cnt = wh[k] || 0;
  const diff = bucketMid[k] - mean;
  variance += cnt * diff * diff;
}
variance += losingCount * (losingMid - mean) ** 2;
variance /= totalCount;

const sigma = Math.sqrt(variance);
const cv = mean > 0 ? sigma / mean : null;

/* CV → volatility tier mapping (vendor-neutral, GLI-19 reference). */
function cvToTier(cv) {
  if (cv == null) return { tier: null, idx: null };
  if (cv < 2.5)  return { tier: 'low',         idx: 3 };
  if (cv < 5)    return { tier: 'low-medium',  idx: 4 };
  if (cv < 10)   return { tier: 'medium',      idx: 5 };
  if (cv < 20)   return { tier: 'medium-high', idx: 7 };
  if (cv < 50)   return { tier: 'high',        idx: 8 };
  return                 { tier: 'extreme',    idx: 10 };
}

const t = cvToTier(cv);

/* Load model to compare against declared. */
const modelPath = join(REPO, `dist/real-games/${SLUG}/model.json`);
const model = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, 'utf8')) : {};
const declaredTier = model.theme?.volatility || null;
const declaredIdx  = model.payback?.volatilityIdx || null;

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-volatility-calc.mjs',
  slug: SLUG,
  source: PROBE_PATH,
  runs: RUNS,
  mean:     +mean.toFixed(4),
  variance: +variance.toFixed(4),
  sigma:    +sigma.toFixed(4),
  cv:       cv != null ? +cv.toFixed(2) : null,
  measuredTier: t.tier,
  measuredIdx:  t.idx,
  declaredTier, declaredIdx,
  tierMatch: t.tier === declaredTier,
  idxDelta:  (declaredIdx != null && t.idx != null) ? t.idx - declaredIdx : null,
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`MATH-5 volatility · ${SLUG}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Mean win/spin:     ${summary.mean} × bet`);
console.log(`  Variance (σ²):     ${summary.variance}`);
console.log(`  Std dev (σ):       ${summary.sigma}`);
console.log(`  Coef of variation: ${summary.cv}`);
console.log(`  Measured tier:     ${summary.measuredTier}   idx ${summary.measuredIdx}`);
console.log(`  Declared tier:     ${summary.declaredTier ?? 'n/a'}   idx ${summary.declaredIdx ?? 'n/a'}`);
console.log(`  Tier match:        ${summary.tierMatch}`);
console.log(`  Report:            ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(t.tier ? '✓ PASS — volatility calc complete' : '⚠ WARN — insufficient data');
process.exit(0);
