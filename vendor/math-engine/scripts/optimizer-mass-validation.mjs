#!/usr/bin/env node
//
// W152 Wave 21 — Optimizer Mass-Validation Report.
// Closes Faza 13.1 ⚠️ acceptance: "target tuple ✅; mass-validation
// report ⚠️" → ✅.
//
// Procedure:
//   1. Generate N=50 synthetic optimizer-target IRs (3-reel + variable
//      starting weights + variable target_rtp ∈ [0.88, 0.97]).
//   2. For each: run `tunePaytableToTarget` and record convergence.
//   3. Aggregate per-target: converged?, iterations used, final RTP,
//      drift from target.
//   4. Output `reports/optimizer/MASS_VALIDATION.{json,md}` with summary.
//
// Pass criterion: ≥ 95% of synthetic targets converge within ±0.5% RTP.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'optimizer');

// ── Config ────────────────────────────────────────────────────────────────
const N_TARGETS = 50;
const TUNER_SPINS = 50_000;
const TUNER_TOLERANCE = 0.005;
const PASS_RATE_THRESHOLD = 0.95;

// ── Synthetic IR generator ──────────────────────────────────────────────

let lcgState = 7777;
function lcg() {
  lcgState = (lcgState * 1664525 + 1013904223) >>> 0;
  return lcgState / 0x100000000;
}

function randInt(lo, hi) {
  return Math.floor(lo + lcg() * (hi - lo + 1));
}

function randFloat(lo, hi) {
  return lo + lcg() * (hi - lo);
}

function buildSyntheticIR(targetRtp) {
  // 3-reel × 1-row, 4 symbols, variable weights.
  const wA = randInt(8, 18);
  const wB = randInt(6, 12);
  const wH = randInt(2, 6);
  const wW = randInt(1, 3);
  const payA = randFloat(0.3, 0.6);
  const payB = randFloat(0.6, 1.2);
  const payH = randFloat(3, 8);
  const payW = payH * 2; // wild pays 2× HP
  return {
    schema_version: '1.0.0',
    meta: { id: `synth-${lcgState}`, name: `Synthetic ${targetRtp.toFixed(3)}`, version: '1.0.0', theme_tags: ['synth'] },
    topology: { kind: 'rectangular', reels: 3, rows: 1 },
    symbols: [
      { id: 'A', name: 'A', kind: 'lp' },
      { id: 'B', name: 'B', kind: 'lp' },
      { id: 'H', name: 'H', kind: 'hp' },
      { id: 'W', name: 'W', kind: 'wild', substitutes: '*' },
    ],
    reels: { mode: 'weighted', base: [{ A: wA, B: wB, H: wH, W: wW }, { A: wA, B: wB, H: wH, W: wW }, { A: wA, B: wB, H: wH, W: wW }] },
    paytable: {
      A: { '3': payA },
      B: { '3': payB },
      H: { '3': payH },
      W: { '3': payW },
    },
    evaluation: { kind: 'lines', paylines: [[0, 0, 0]], direction: 'ltr' },
    features: [],
    rng: { kind: 'mulberry32', default_seed: 42 },
    bet: { currency: 'EUR', base_bet: 1, denominations: [1] },
    limits: {
      target_rtp: targetRtp,
      rtp_tolerance: 0.005,
      max_win_x: 100,
      win_cap_apply: 'per_spin',
      target_volatility: 'low',
      hit_freq_target: 0.3,
    },
    compliance: {
      jurisdictions: ['MGA'],
      rtp_range_required: [0.85, 0.99],
      max_win_cap_required: 100,
      near_miss_rule: 'must_be_random',
      ldw_disclosure: false,
      session_time_display: false,
    },
    rtp_allocation: { base_game: 1, free_spins: 0, hold_and_win: 0, jackpot: 0, tolerance: 0.01 },
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const tuner = await import(join(REPO_ROOT, 'dist', 'solver', 'parTuner.js'));
  const tunePaytableToTarget = tuner.tunePaytableToTarget;

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Mass-validating ${N_TARGETS} synthetic optimizer-target configs…`);

  const results = [];
  for (let i = 0; i < N_TARGETS; i++) {
    const targetRtp = randFloat(0.88, 0.97);
    const ir = buildSyntheticIR(targetRtp);
    const t0 = Date.now();
    let res;
    try {
      res = await tunePaytableToTarget(ir, targetRtp, {
        spins: TUNER_SPINS,
        seed: 12345,
        tolerance: TUNER_TOLERANCE,
        maxIterations: 8,
      });
    } catch (e) {
      results.push({
        targetIdx: i,
        targetRtp,
        converged: false,
        iterations: 0,
        finalRtp: 0,
        rtpError: NaN,
        wallMs: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      });
      process.stdout.write('!');
      continue;
    }
    const wallMs = Date.now() - t0;
    const rtpError = Math.abs(res.finalRtp - targetRtp);
    const converged = rtpError <= TUNER_TOLERANCE;
    results.push({
      targetIdx: i,
      targetRtp,
      converged,
      iterations: res.iterations,
      finalRtp: res.finalRtp,
      rtpError,
      wallMs,
    });
    process.stdout.write(converged ? '.' : 'x');
  }
  console.log('');

  const convergedCount = results.filter((r) => r.converged).length;
  const passRate = convergedCount / results.length;
  const allPassed = passRate >= PASS_RATE_THRESHOLD;
  const meanIter = results.reduce((s, r) => s + r.iterations, 0) / results.length;
  const meanWall = results.reduce((s, r) => s + r.wallMs, 0) / results.length;

  const meta = {
    generatedAtUtc: new Date().toISOString(),
    nTargets: N_TARGETS,
    tunerSpins: TUNER_SPINS,
    tolerance: TUNER_TOLERANCE,
    passRateThreshold: PASS_RATE_THRESHOLD,
    convergedCount,
    passRate,
    passed: allPassed,
    meanIterations: meanIter,
    meanWallMs: meanWall,
  };

  writeFileSync(join(OUT_DIR, 'MASS_VALIDATION.json'), JSON.stringify({ meta, results }, null, 2) + '\n');

  // Markdown
  const md = [];
  md.push('# Optimizer Mass-Validation Report');
  md.push('');
  md.push(`> **W152 Wave 21 — Faza 13.1 acceptance proof.** Generated ${meta.generatedAtUtc}.`);
  md.push('');
  md.push(`**Headline:** ${allPassed ? '✅ PASS' : '❌ FAIL'} — ${convergedCount}/${N_TARGETS} synthetic targets converged within ±${(TUNER_TOLERANCE * 100).toFixed(2)}% (${(passRate * 100).toFixed(1)}% pass rate vs ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}% threshold).`);
  md.push('');
  md.push('## Aggregate stats');
  md.push('');
  md.push(`- Mean tuner iterations: ${meanIter.toFixed(2)}`);
  md.push(`- Mean wall-clock per tune: ${meanWall.toFixed(0)} ms`);
  md.push(`- Total time: ${results.reduce((s, r) => s + r.wallMs, 0).toFixed(0)} ms`);
  md.push('');
  md.push('## Failed targets (top 10)');
  md.push('');
  const failures = results.filter((r) => !r.converged).slice(0, 10);
  if (failures.length === 0) {
    md.push('_(all targets converged — no failures)_');
  } else {
    md.push('| Idx | Target RTP | Final RTP | Error | Iter | Time |');
    md.push('|---|---:|---:|---:|---:|---:|');
    for (const f of failures) {
      md.push(`| ${f.targetIdx} | ${(f.targetRtp * 100).toFixed(3)}% | ${(f.finalRtp * 100).toFixed(3)}% | ${(f.rtpError * 100).toFixed(3)}% | ${f.iterations} | ${f.wallMs} ms |`);
    }
  }
  md.push('');
  md.push('## Methodology');
  md.push('');
  md.push(`- **N targets**: ${N_TARGETS} synthetic IRs (3-reel × 1-row, 4 symbols, variable weights, target_rtp ∈ [0.88, 0.97]).`);
  md.push(`- **Tuner**: \`tunePaytableToTarget\` (paytable bisection from \`src/solver/parTuner.ts\`).`);
  md.push(`- **Pass criterion**: ≥ ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}% targets converge within ±${(TUNER_TOLERANCE * 100).toFixed(2)}% RTP.`);
  md.push(`- **Determinism**: LCG seed=7777 for IR generation; tuner seed=12345.`);
  md.push('');
  writeFileSync(join(OUT_DIR, 'MASS_VALIDATION.md'), md.join('\n'));
  console.log(`Wrote ${join(OUT_DIR, 'MASS_VALIDATION.json')}`);
  console.log(`Wrote ${join(OUT_DIR, 'MASS_VALIDATION.md')}`);
  process.exit(allPassed ? 0 : 1);
}

await main();
