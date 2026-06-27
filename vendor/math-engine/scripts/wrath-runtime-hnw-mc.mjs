#!/usr/bin/env node
// Standalone Monte Carlo of the Pattern-WO Hold & Win feature
// using the EXACT algorithm from web/studio/public/runner/runtime.js
// (function runHoldAndWinHeadless), reading the canonical IR.
//
// Goal: prove whether the algorithm correctly produces the validated
// per-trigger mean payout (~44× bet) when fed the canonical IR.

import { readFileSync } from 'node:fs';

const IR = JSON.parse(readFileSync(`${process.env.HOME}/Desktop/wrath-of-olympus.ir.json`, 'utf8'));
const F_HNW = IR.features.find((f) => f.kind === 'hold_and_win');

const REELS = IR.topology.reels;
const ROWS = IR.topology.rows;

// Mulberry32 PRNG so runs are reproducible.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, list) {
  let total = 0;
  for (const e of list) total += Math.max(0, e.weight);
  let x = rng() * total;
  for (const e of list) {
    x -= Math.max(0, e.weight);
    if (x <= 0) return e.value;
  }
  return list[list.length - 1].value;
}

// EXACT copy of runHoldAndWinHeadless from runtime.js
function runHoldAndWinHeadless(rng, initialOrbCount) {
  const respinsInitial = F_HNW.respins_initial || 3;
  const orbLandBase = F_HNW.orb_land_chance_base || 0.04;
  const orbLandFill = F_HNW.orb_land_chance_fill_bonus || 0;
  const fullGridBonus = F_HNW.full_grid_bonus_x || 0;
  const cashDist = F_HNW.cash_value_distribution || [{ value: 1, weight: 1 }];
  const jackpots = F_HNW.jackpot_tiers || [];
  const unifiedPool = [
    ...cashDist.map((c) => ({ value: c.value, weight: Math.max(0, c.weight) })),
    ...jackpots.map((j) => ({ value: j.multiplier, weight: Math.max(0, j.weight) })),
  ];
  const totalCells = REELS * ROWS;
  let filled = Math.min(initialOrbCount, totalCells);
  let total = 0;
  for (let i = 0; i < filled; i++) total += pickWeighted(rng, unifiedPool);
  let respins = respinsInitial;
  while (respins > 0 && filled < totalCells) {
    let landed = 0;
    const free = totalCells - filled;
    const filledFrac = filled / totalCells;
    const p = orbLandBase + orbLandFill * filledFrac;
    for (let c = 0; c < free; c++) {
      if (rng() < p) { total += pickWeighted(rng, unifiedPool); landed++; }
    }
    filled += landed;
    if (landed > 0 && F_HNW.respin_reset_on_new) respins = respinsInitial;
    else respins--;
  }
  if (filled >= totalCells && fullGridBonus > 0) total += fullGridBonus;
  return { total, filled };
}

// Run N triggers across a sweep of initial orb counts that mirror what
// the engine actually feeds in (6, 7, 8, 9... up to 15 with declining
// probability).  For acceptance, fix initial = 6 (the typical trigger).
const N = 200_000;
const rng = mulberry32(12345);

const buckets = {};
let totalSum = 0, totalSq = 0, totalRuns = 0;
let totalFinalOrbs = 0;
for (let i = 0; i < N; i++) {
  // Sample initial count weighted toward 6 (most common trigger value).
  // Approximate distribution from a Wrath-style 5×3 grid with bonus
  // symbol weighting — for our purposes we just want to see if at
  // initial=6 we hit the expected ~44× per trigger.
  const initial = 6;
  const { total, filled } = runHoldAndWinHeadless(rng, initial);
  totalSum += total;
  totalSq += total * total;
  totalRuns++;
  totalFinalOrbs += filled;
  const b = buckets[filled] || (buckets[filled] = { runs: 0, sum: 0 });
  b.runs++;
  b.sum += total;
}

const mean = totalSum / totalRuns;
const variance = (totalSq / totalRuns) - mean * mean;
const sigma = Math.sqrt(variance);
const stderr = sigma / Math.sqrt(totalRuns);

console.log(`\n  Wrath H&W runtime.js algorithm — ${N.toLocaleString()} triggers @ initial=6`);
console.log(`  ─────────────────────────────────────────────────────────`);
console.log(`  Per-trigger mean       ${mean.toFixed(4)}× bet`);
console.log(`  σ                      ${sigma.toFixed(4)}`);
console.log(`  ±1.96σ CI95            [${(mean - 1.96 * stderr).toFixed(4)}, ${(mean + 1.96 * stderr).toFixed(4)}]`);
console.log(`  Avg final orb count    ${(totalFinalOrbs / totalRuns).toFixed(2)} / ${REELS * ROWS}`);
console.log(`\n  Final-orb-count distribution:`);
const sortedKeys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
for (const k of sortedKeys) {
  const b = buckets[k];
  console.log(`    ${String(k).padStart(2)} orbs · ${String(b.runs).padStart(6)} runs (${(100 * b.runs / totalRuns).toFixed(2)}%) · mean ${(b.sum / b.runs).toFixed(2)}×`);
}

const target = 44.16; // 39.78% / (1/110.91) — expected per-trigger from validated_metrics
console.log(`\n  Target per-trigger     ~${target}× (39.78% / 1-in-111)`);
console.log(`  Delta                  ${(mean - target).toFixed(2)}×  (${((mean / target - 1) * 100).toFixed(1)}%)`);
console.log(`  Verdict                ${Math.abs(mean - target) < 4 ? '✓ within ±4× tolerance' : '✗ algorithm gives wrong per-trigger mean'}`);
