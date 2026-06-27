#!/usr/bin/env node
/**
 * tools/_par15b4-trigger-distribution-solver.mjs
 *
 * PAR-15-b-4 · Analytic HnW Trigger Distribution Solver
 *
 * Purpose
 * -------
 * Closed-form P[trigger] + P[K0 | trigger] iz par-sheet reelStrips weights.
 * Combines sa PAR-15-b-2 conditional E[payout_x | K0] da dobije FULL analytic
 * HnW contribution to RTP. Compare vs declared (par sheet) vs sister observed
 * → definitivno localize drift.
 *
 * Model
 * -----
 * Cash Eruption reelStrips su per-reel weighted symbol tables (not circular
 * strips). Each cell sampled independently via weighted random selection.
 *
 * Per-reel scatter probability:
 *   p_r = sum_{s ∈ scatters} weight_s / total_weight_r
 *
 * Per-reel visible scatter count K_r ~ Binomial(rows, p_r)
 * Total visible scatters K = sum K_r → convolve 5 binomials
 *
 * Trigger: K >= initial_count_min (6 for Cash Eruption)
 * P[K0=k | trigger] = pdf(K=k) / sum_{j>=6} pdf(K=j)
 *
 * Full HnW contribution:
 *   E[payout_x | trigger] = sum_k P[K0=k | trigger] * E[payout_x | K0=k]
 *   HnW_pp = P[trigger] * E[payout_x | trigger]
 *
 * @author Corti
 * @date   2026-06-28
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

// ─── Binomial PMF (numerically stable) ───────────────────────────────────────
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logBinomCoef(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

function binomPmf(n, k, p) {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logBinomCoef(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// ─── Convolve two pdfs ───────────────────────────────────────────────────────
function convolve(a, b) {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] += a[i] * b[j];
    }
  }
  return out;
}

// ─── Scatter probability per reel ────────────────────────────────────────────
function scatterProbPerReel(reelWeights, scatterSymbolIds) {
  const totalW = reelWeights.reduce((s, e) => s + e.weight, 0);
  const scatterW = reelWeights
    .filter(e => scatterSymbolIds.includes(e.symbol.toLowerCase()))
    .reduce((s, e) => s + e.weight, 0);
  return scatterW / totalW;
}

// ─── Trigger distribution ────────────────────────────────────────────────────
function triggerDistribution({ reelStrips, rows, scatterSymbolIds }) {
  const perReelP = reelStrips.map(r => scatterProbPerReel(r, scatterSymbolIds));

  // Per-reel visible scatter count pdf: Binomial(rows, p_r)
  const perReelPdf = perReelP.map(p => {
    const pdf = new Float64Array(rows + 1);
    for (let k = 0; k <= rows; k++) pdf[k] = binomPmf(rows, k, p);
    return pdf;
  });

  // Convolve all reels
  let total = perReelPdf[0];
  for (let i = 1; i < perReelPdf.length; i++) total = convolve(total, perReelPdf[i]);

  return { perReelP, pdf: Array.from(total) };
}

// ─── Load PAR-15-b-2 results ─────────────────────────────────────────────────
function loadPar15b2(slug) {
  const path = `${REPO_ROOT}/reports/par-convergence/par15b-analytic-${slug}.json`;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── Load game ───────────────────────────────────────────────────────────────
function loadGame(slug) {
  const path = `${REPO_ROOT}/dist/par-sheet-real-games/${slug}/model.json`;
  const model = JSON.parse(readFileSync(path, 'utf8'));
  const topology = model.topology || {};
  const reels = topology.reels || 5;
  const rows = topology.rows || 3;
  const reelStrips = model.par_sheet?.reelStrips || [];
  const declaredHnW = model.payback?.components?.holdAndWin || null;
  const declaredRtp = model.payback?.rtp || null;

  // Identify scatter symbols by "role" in symbols.specials
  const specials = model.symbols?.specials || [];
  const scatterSymbolIds = specials
    .filter(s => ['cash', 'scatter', 'bonus'].includes((s.role || '').toLowerCase()))
    .map(s => (s.id || s.label || '').toLowerCase());

  return {
    slug,
    reels,
    rows,
    reelStrips,
    scatterSymbolIds,
    declaredHnW,
    declaredRtp,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const slug = process.argv[2] || 'cash-eruption';
const game = loadGame(slug);
const par15b2 = loadPar15b2(slug);

console.log(`┌${'─'.repeat(78)}┐`);
console.log(`│ PAR-15-b-4 · Analytic Trigger Distribution · slug=${slug}`.padEnd(79) + '│');
console.log(`│ ${game.reels}×${game.rows} grid · scatter ids=[${game.scatterSymbolIds.join(', ')}]`.padEnd(79) + '│');
console.log(`├${'─'.repeat(78)}┤`);

const { perReelP, pdf } = triggerDistribution({
  reelStrips: game.reelStrips,
  rows: game.rows,
  scatterSymbolIds: game.scatterSymbolIds,
});

console.log(`│ Per-reel scatter probabilities (P[scatter per cell]):`.padEnd(79) + '│');
perReelP.forEach((p, i) => {
  console.log(`│   Reel ${i}: ${p.toFixed(6)}  (window ${game.rows} cells)`.padEnd(79) + '│');
});

console.log(`├${'─'.repeat(78)}┤`);
console.log(`│ Distribution of total visible scatters K (5×3 = 15 cells):`.padEnd(79) + '│');
console.log(`│  K   pdf(K)         CDF (≤K)        P[K0=K | trigger]`.padEnd(79) + '│');

const initialCountMin = par15b2.results[0].K0; // 6 for Cash Eruption
const triggerCutoff = initialCountMin;

const pTrigger = pdf.slice(triggerCutoff).reduce((s, v) => s + v, 0);
console.log(`├${'─'.repeat(78)}┤`);

let cdf = 0;
for (let k = 0; k < pdf.length; k++) {
  cdf += pdf[k];
  const pK_given_trig = k >= triggerCutoff ? pdf[k] / pTrigger : 0;
  const marker = k >= triggerCutoff ? ' ★' : '  ';
  console.log(
    `│  ${String(k).padStart(2)}  ${pdf[k].toExponential(4).padStart(12)}   ${cdf.toFixed(6).padStart(10)}   ${pK_given_trig.toFixed(6).padStart(10)}${marker}`.padEnd(79) +
      '│',
  );
}

console.log(`├${'─'.repeat(78)}┤`);
console.log(`│ P[trigger_per_spin] = ${(pTrigger * 100).toFixed(6)}%  (1 in ${(1 / pTrigger).toFixed(2)})`.padEnd(79) + '│');

// Now combine with PAR-15-b-2 per-K0 payout
const k0ToPayout = new Map();
for (const r of par15b2.results) k0ToPayout.set(r.K0, r.expectedPayoutX);

let expectedPayoutGivenTrigger = 0;
for (let k = triggerCutoff; k < pdf.length; k++) {
  const pK = pdf[k] / pTrigger;
  const payout = k0ToPayout.get(k) ?? k0ToPayout.get(Math.min(k, 14)); // clamp to max in table
  expectedPayoutGivenTrigger += pK * payout;
}

const analyticHnWPp = pTrigger * expectedPayoutGivenTrigger * 100; // pp

console.log(`├${'─'.repeat(78)}┤`);
console.log(`│ E[payout_x | trigger] (weighted by P[K0|trig]) = ${expectedPayoutGivenTrigger.toFixed(4)}x bet`.padEnd(79) + '│');
console.log(`│ ANALYTIC HnW contribution = ${analyticHnWPp.toFixed(4)} pp of RTP`.padEnd(79) + '│');

console.log(`├${'─'.repeat(78)}┤`);
console.log(`│ COMPARISON:`.padEnd(79) + '│');
console.log(`│   Declared (par sheet)  : ${game.declaredHnW.toFixed(4)} pp`.padEnd(79) + '│');
console.log(`│   Analytic (this solver): ${analyticHnWPp.toFixed(4)} pp`.padEnd(79) + '│');
console.log(`│   Sister observed       : ~71.82 pp (PAR-15-a 400M run)`.padEnd(79) + '│');

const driftVsDeclared = analyticHnWPp - game.declaredHnW;
const driftVsSister = analyticHnWPp - 71.82;

console.log(`├${'─'.repeat(78)}┤`);
console.log(`│ DRIFT ANALYSIS:`.padEnd(79) + '│');
console.log(`│   analytic - declared = ${driftVsDeclared.toFixed(4)} pp`.padEnd(79) + '│');
console.log(`│   analytic - sister   = ${driftVsSister.toFixed(4)} pp`.padEnd(79) + '│');

console.log(`├${'─'.repeat(78)}┤`);
let verdict = '';
if (Math.abs(driftVsDeclared) < 0.5 && Math.abs(driftVsSister) > 5) {
  verdict = '⚠ SISTER KERNEL BUG  · analytic matches declared, sister over-fires';
} else if (Math.abs(driftVsSister) < 0.5 && Math.abs(driftVsDeclared) > 5) {
  verdict = '⚠ PAR SHEET MIS-ATTRIBUTED · analytic matches sister, declared wrong';
} else if (Math.abs(driftVsDeclared) > 5 && Math.abs(driftVsSister) > 5) {
  verdict = '⚠ MODEL GAP · neither matches → check par-sheet weights / scenarios';
} else {
  verdict = '? indeterminate · differences in tolerance band';
}
console.log(`│ VERDICT: ${verdict}`.padEnd(79) + '│');
console.log(`└${'─'.repeat(78)}┘`);

const out = {
  slug,
  generated: new Date().toISOString(),
  perReelScatterProb: perReelP,
  triggerCutoff,
  pdf: Array.from(pdf),
  pTrigger,
  expectedPayoutGivenTrigger,
  analyticHnWPp,
  declaredHnWPp: game.declaredHnW,
  sisterObservedHnWPp: 71.82,
  driftVsDeclared,
  driftVsSister,
  verdict,
};
writeFileSync(
  `${REPO_ROOT}/reports/par-convergence/par15b4-trigger-distribution-${slug}.json`,
  JSON.stringify(out, null, 2),
);
console.log(`\nWrote: ./reports/par-convergence/par15b4-trigger-distribution-${slug}.json`);
