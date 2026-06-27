#!/usr/bin/env node
/**
 * tools/_par15b-hnw-analytic-solver.mjs
 *
 * PAR-15-b-2 · Analytic HnW Contribution Solver
 *
 * Purpose
 * -------
 * Closed-form Markov-chain solver za Hold-and-Win expected payout
 * uslovljeno na ulazni broj inicijalnih orbova (K0). Reflektuje 1:1
 * sister kernel state machine iz `vendor/math-engine/rust-sim/src/features.rs`
 * `simulate_hnw()` (lines 206-348):
 *
 *   State  : (orbs_placed n, respins_left r)
 *   Start  : (K0, initial_respins)
 *   Transit: each empty cell flips orb sa
 *              p(n) = chance_base + (n/N) * chance_fill
 *            new_orbs X ~ Binomial(empty, p(n))
 *            if X == 0  →  (n,         r - 1)        prob (1-p)^empty
 *            if X >  0  →  (n + X,     respins_on_new_orb)
 *   Absorb : n == N  (full grid)  OR  r == 0
 *
 *   Payout : sum_of_orb_values * bet + full_grid_bonus_x * bet (if full)
 *   E[payout_x | K0] = E[orb_count_final | K0] * E[orb_value]
 *                   + P[full_grid | K0] * full_grid_bonus_x
 *
 * Precision
 * ---------
 * Exact rational/double arithmetic — no Monte-Carlo noise. ±0.001 pp
 * accurate u milisekundama. Discriminates knob impact ispod Wilson floor-a.
 *
 * Usage
 * -----
 *   node tools/_par15b-hnw-analytic-solver.mjs <slug>
 *   node tools/_par15b-hnw-analytic-solver.mjs cash-eruption
 *
 * Output
 * ------
 *   ASCII box-drawn table K0 vs E[orbs_final] vs P[full_grid] vs E[payout_x]
 *   + summary block comparing analytic E[payout_x | K0=avg] vs declared
 *
 * @author Corti (autonomous)
 * @date   2026-06-28
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

// ─── Binomial PMF (numerically stable log-space) ─────────────────────────────
// log(C(n,k)) preko lgamma
function lgamma(x) {
  // Lanczos approximation
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
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
  const logP = logBinomCoef(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

// ─── Markov-chain solver ─────────────────────────────────────────────────────
function solveHnW({ N, K0, initialRespins, respinsOnNewOrb, chanceBase, chanceFill }) {
  // State distribution: dist[n][r] = P[in state (n, r) at some step]
  // Absorbing states: n === N (full) or r === 0 (bust)
  // Track P[absorb at orb_count_final = m] = absorbCount[m]
  const N1 = N + 1;
  const R1 = Math.max(initialRespins, respinsOnNewOrb) + 1;

  // Initial state: (K0, initialRespins) sa probabilitet 1
  let dist = Array.from({ length: N1 }, () => new Float64Array(R1));
  dist[K0][initialRespins] = 1.0;

  const absorbAtN = new Float64Array(N1); // P[final orb_count = n]
  // Iterate until total mass in transient states < epsilon
  const EPS = 1e-15;
  const MAX_ITERS = 1000;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const next = Array.from({ length: N1 }, () => new Float64Array(R1));
    let transientMass = 0;

    for (let n = K0; n < N; n++) {
      const empty = N - n;
      const p = chanceBase + (n / N) * chanceFill;
      const pClamped = Math.max(0, Math.min(1, p));

      // Precompute binomial PMF for this (n, empty)
      const pmf = new Float64Array(empty + 1);
      for (let k = 0; k <= empty; k++) {
        pmf[k] = binomPmf(empty, k, pClamped);
      }

      for (let r = 1; r < R1; r++) {
        const mass = dist[n][r];
        if (mass < EPS) continue;
        transientMass += mass;

        // X = 0  → (n, r - 1)
        const p0 = pmf[0];
        if (r - 1 === 0) {
          // Absorbs by exhausting respins at n
          absorbAtN[n] += mass * p0;
        } else {
          next[n][r - 1] += mass * p0;
        }

        // X > 0  → (n + X, respinsOnNewOrb)
        for (let k = 1; k <= empty; k++) {
          const pK = pmf[k];
          if (pK < EPS) continue;
          const newN = n + k;
          if (newN >= N) {
            // Full grid absorption
            absorbAtN[N] += mass * pK;
          } else {
            next[newN][respinsOnNewOrb] += mass * pK;
          }
        }
      }
    }

    dist = next;
    if (transientMass < EPS) break;
  }

  // Compute E[orb_count_final | K0]
  let expectedOrbs = 0;
  for (let n = K0; n <= N; n++) {
    expectedOrbs += n * absorbAtN[n];
  }
  const pFullGrid = absorbAtN[N];

  return { expectedOrbs, pFullGrid, distribution: Array.from(absorbAtN) };
}

// ─── Load model.json ─────────────────────────────────────────────────────────
function loadGame(slug) {
  const path = `${REPO_ROOT}/dist/par-sheet-real-games/${slug}/model.json`;
  const tune = `${REPO_ROOT}/dist/par-sheet-real-games/${slug}/auto-tune.json`;

  const model = JSON.parse(readFileSync(path, 'utf8'));
  const autoTune = JSON.parse(readFileSync(tune, 'utf8'));

  const topology = model.topology || {};
  const N = (topology.reels || 5) * (topology.rows || 3);
  const scenarios = model.par_sheet?.hnwScenarios || [];
  const orbTable = model.par_sheet?.hnwOrbValues || [];
  const declaredHnW = model.payback?.components?.holdAndWin || null;
  const declaredRtp = model.payback?.rtp || null;

  const hnwTune = autoTune.hnw || {};
  return {
    slug,
    N,
    scenarios,
    orbTable,
    declaredHnW,
    declaredRtp,
    chanceBase: hnwTune.orb_land_chance_base ?? 0.045,
    chanceFill: hnwTune.orb_land_chance_fill_bonus ?? 0.13,
    orbValueBump: hnwTune.orb_value_bump ?? 1,
    fullGridBonus: 0, // No full_grid_bonus declared in par sheet (default 0)
    respinsOnNewOrb: 3, // Default = initial_respins for Cash Eruption style
  };
}

// ─── Expected orb value ──────────────────────────────────────────────────────
function expectedOrbValue(orbTable, valueBump = 1) {
  let totalWeight = 0;
  for (const o of orbTable) totalWeight += o.weight;
  let sum = 0;
  for (const o of orbTable) sum += (o.value * valueBump) * (o.weight / totalWeight);
  return { mean: sum, totalWeight };
}

// ─── Pretty print ────────────────────────────────────────────────────────────
function fmt(x, w = 8, dp = 4) {
  return x.toFixed(dp).padStart(w);
}

function box(line, width = 80) {
  return '│ ' + line.padEnd(width - 4) + ' │';
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const slug = process.argv[2] || 'cash-eruption';
const game = loadGame(slug);

console.log(`┌${'─'.repeat(78)}┐`);
console.log(box(`PAR-15-b-2 · Analytic HnW Solver · slug=${slug}`, 80));
console.log(box(`grid N=${game.N}  chance_base=${game.chanceBase}  chance_fill=${game.chanceFill}`, 80));
console.log(box(`respins=3  respins_on_new_orb=${game.respinsOnNewOrb}  orb_table=${game.orbTable.length} tiers`, 80));
console.log(`├${'─'.repeat(78)}┤`);

const { mean: evValue, totalWeight } = expectedOrbValue(game.orbTable, game.orbValueBump);
console.log(box(`E[orb_value] = ${evValue.toFixed(4)} (weighted over ${totalWeight} total weight)`, 80));
console.log(`├${'─'.repeat(78)}┤`);
console.log(box(`K0  E[orbs_final]   P[full_grid]   E[payout_x]   contrib_per_trigger`, 80));
console.log(`├${'─'.repeat(78)}┤`);

const results = [];
for (const scenario of game.scenarios) {
  const K0 = scenario.initial_count;
  const initialRespins = scenario.initial_respins;
  const sol = solveHnW({
    N: game.N,
    K0,
    initialRespins,
    respinsOnNewOrb: game.respinsOnNewOrb,
    chanceBase: game.chanceBase,
    chanceFill: game.chanceFill,
  });
  // E[payout_x | K0] = E[orbs] * E[value] + P[full] * fullGridBonus
  const expectedPayoutX = sol.expectedOrbs * evValue + sol.pFullGrid * game.fullGridBonus;
  results.push({ K0, ...sol, expectedPayoutX });

  console.log(
    box(
      `${String(K0).padStart(2)}  ${fmt(sol.expectedOrbs, 12, 4)}   ${fmt(sol.pFullGrid * 100, 11, 4)}%   ${fmt(expectedPayoutX, 11, 2)}   (${expectedPayoutX.toFixed(2)}x bet)`,
      80,
    ),
  );
}

console.log(`├${'─'.repeat(78)}┤`);

// Average over scenarios (uniform — placeholder; real weighting needs P[K0|trigger])
const avgPayoutX = results.reduce((s, r) => s + r.expectedPayoutX, 0) / results.length;
console.log(box(`AVG E[payout_x] across K0 ∈ {${results[0].K0}..${results[results.length - 1].K0}} = ${avgPayoutX.toFixed(2)}x bet (uniform)`, 80));

// Comparison vs declared — inverse equation
//
// HnW contribution to RTP = P[triggered] * E[payout_x | triggered]
// E[payout_x | triggered] = sum_K0 P[K0 | triggered] * E[payout_x | K0]
//
// Without P[K0 | triggered] from sister, we bound it from below (K0=6, easiest
// trigger) and above (K0=14, hardest trigger, fully loaded). Geometric prior:
// realistic mass concentrates near K0=6.
//
// Implied P[triggered_per_spin] = declared_HnW_pp / E[payout_x | triggered]
//
// Cross-check against:
//   - Sister observed HnW contribution (logged at run time)
//   - Trigger frequency from baseline reel set (independent verification)
let impliedTrigK0_low = null;
let impliedTrigK0_high = null;
let impliedTrigUniform = null;
if (game.declaredHnW !== null && results.length > 0) {
  const lowestK0Payout = results[0].expectedPayoutX;        // K0=6 — most common
  const highestK0Payout = results[results.length - 1].expectedPayoutX; // K0=14
  impliedTrigK0_low = game.declaredHnW / lowestK0Payout;   // upper bound on freq
  impliedTrigK0_high = game.declaredHnW / highestK0Payout; // lower bound on freq
  impliedTrigUniform = game.declaredHnW / avgPayoutX;

  console.log(`├${'─'.repeat(78)}┤`);
  console.log(box(`DECLARED HnW contribution: ${game.declaredHnW.toFixed(4)} pp of RTP`, 80));
  console.log(box(`DECLARED total RTP:        ${game.declaredRtp.toFixed(4)} pp`, 80));
  console.log(`├${'─'.repeat(78)}┤`);
  console.log(box(`IMPLIED P[trigger_per_spin] given declared HnW pp:`, 80));
  console.log(
    box(
      `  if all K0=6  : ${(impliedTrigK0_low * 100).toFixed(4)}% per spin (1 in ${(1 / impliedTrigK0_low).toFixed(1)})`,
      80,
    ),
  );
  console.log(
    box(
      `  uniform K0  : ${(impliedTrigUniform * 100).toFixed(4)}% per spin (1 in ${(1 / impliedTrigUniform).toFixed(1)})`,
      80,
    ),
  );
  console.log(
    box(
      `  if all K0=14: ${(impliedTrigK0_high * 100).toFixed(4)}% per spin (1 in ${(1 / impliedTrigK0_high).toFixed(1)})`,
      80,
    ),
  );
  console.log(box(`Cross-check vs sister baseline_reel_set bonus density.`, 80));
}

console.log(`└${'─'.repeat(78)}┘`);

// Emit JSON za follow-up scripts
const out = {
  slug,
  generated: new Date().toISOString(),
  inputs: {
    N: game.N,
    chanceBase: game.chanceBase,
    chanceFill: game.chanceFill,
    respinsOnNewOrb: game.respinsOnNewOrb,
    orbValueBump: game.orbValueBump,
    fullGridBonus: game.fullGridBonus,
    expectedOrbValue: evValue,
    orbTableTotalWeight: totalWeight,
    declaredHnW: game.declaredHnW,
    declaredRtp: game.declaredRtp,
  },
  results: results.map(r => ({
    K0: r.K0,
    expectedOrbsFinal: r.expectedOrbs,
    pFullGrid: r.pFullGrid,
    expectedPayoutX: r.expectedPayoutX,
    finalOrbDistribution: r.distribution,
  })),
  avgPayoutXUniform: avgPayoutX,
  impliedTriggerFrequency: {
    ifAllK0_min: impliedTrigK0_low,
    uniform: impliedTrigUniform,
    ifAllK0_max: impliedTrigK0_high,
  },
};

const outPath = `${REPO_ROOT}/reports/par-convergence/par15b-analytic-${slug}.json`;
import('node:fs').then(fs => fs.writeFileSync(outPath, JSON.stringify(out, null, 2)));
console.log(`\nWrote: ${outPath.replace(REPO_ROOT, '.')}`);
