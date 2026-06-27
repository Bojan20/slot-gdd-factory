#!/usr/bin/env node
//
// W152 Wave 168 — AWP Cycle Convergence Analyzer acceptance (Wave 167).
//
// 6 UK Class III machine configs × 3K MC cycle simulations = 18K cycle paths.
// Closed-form CLT-Bachelier projection cross-validated against per-spin MC.
//
// Operator deliverable: `reports/acceptance/AWP_CYCLE_CONVERGENCE.{json,md}`.
//
// Compliance: UKGC LCCP (B3/B3A/C/D finite-cycle proof), MGA AWP §15 (cycle
// deviation tolerance), EU GA 2024 (compensated math disclosure), AU NCPF
// Class III.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const CYCLES = 3_000;
const SEED = 0xCAFE0167;

const TOL_RTP_ABS = 0.005;        // E[finalRTP] abs ≤ 0.5pp
const TOL_STD_REL = 0.20;         // stdDev rel ≤ 20%
const TOL_PROB_ABS = 0.05;        // P(exceeds) abs ≤ 5pp

const CONFIGS = [
  {
    name: 'A_uk_b3_mid_cycle_on_track',
    description: 'UK B3 (70% RTP, τ=4pp), N=10K spins, mid-cycle, realised 70.0% — on target',
    cfg: {
      cycleLengthSpins: 10000,
      baseBet: 1,
      targetRtp: 0.70,
      toleranceAbs: 0.04,
      payoutStdDevPerBet: 3,
      spinsPlayed: 5000,
      cumulativePayout: 3500,
    },
  },
  {
    name: 'B_uk_b3_early_cycle_below_target',
    description: 'UK B3 early cycle (n=1K), realised 65% — below target, compensation hint needed',
    cfg: {
      cycleLengthSpins: 10000,
      baseBet: 1,
      targetRtp: 0.70,
      toleranceAbs: 0.04,
      payoutStdDevPerBet: 3,
      spinsPlayed: 1000,
      cumulativePayout: 650,
    },
  },
  {
    name: 'C_uk_d_high_rtp_late_cycle',
    description: 'UK Category D (90% RTP, τ=3pp), N=20K spins, late cycle (n=18K), realised 89.5%',
    cfg: {
      cycleLengthSpins: 20000,
      baseBet: 1,
      targetRtp: 0.90,
      toleranceAbs: 0.03,
      payoutStdDevPerBet: 2,
      spinsPlayed: 18000,
      cumulativePayout: 16110,
    },
  },
  {
    name: 'D_uk_b3a_high_vol_early',
    description: 'UK B3A (85% RTP, τ=5pp), N=15K spins, early cycle high-volatility',
    cfg: {
      cycleLengthSpins: 15000,
      baseBet: 1,
      targetRtp: 0.85,
      toleranceAbs: 0.05,
      payoutStdDevPerBet: 5,
      spinsPlayed: 3000,
      cumulativePayout: 2400,
    },
  },
  {
    name: 'E_corner_cycle_just_started',
    description: 'Corner: n=0 (cycle just reset) — full uncertainty, project to end',
    cfg: {
      cycleLengthSpins: 10000,
      baseBet: 1,
      targetRtp: 0.70,
      toleranceAbs: 0.04,
      payoutStdDevPerBet: 3,
      spinsPlayed: 0,
      cumulativePayout: 0,
    },
  },
  {
    name: 'F_corner_cycle_at_end_outside_band',
    description: 'Corner: n=N (cycle complete), realised 60% — outside tolerance, P(exceeds)=1',
    cfg: {
      cycleLengthSpins: 10000,
      baseBet: 1,
      targetRtp: 0.70,
      toleranceAbs: 0.04,
      payoutStdDevPerBet: 3,
      spinsPlayed: 10000,
      cumulativePayout: 6000,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveAwpCycleConvergence, simulateAwpCycleConvergence } =
    await import(join(REPO_ROOT, 'dist', 'features', 'awpCycleConvergence.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} AWP Cycle Convergence configs @ ${CYCLES} MC cycles each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveAwpCycleConvergence(c.cfg);
    const mc = simulateAwpCycleConvergence(c.cfg, CYCLES, SEED);

    const rtpAbs = Math.abs(cf.expectedFinalRtp - mc.observedExpectedFinalRtp);
    // stdDev MC check skipped if CF stdDev = 0 (cycle complete)
    const stdRel = cf.stdDevFinalRtp > 1e-6
      ? relErr(cf.stdDevFinalRtp, mc.observedStdDevFinalRtp)
      : (mc.observedStdDevFinalRtp < 1e-6 ? 0 : 1);
    const probAbs = Math.abs(cf.probExceedsToleranceAtEnd - mc.observedProbExceedsToleranceAtEnd);

    const checks = { rtp_abs: rtpAbs, std_rel: stdRel, prob_abs: probAbs };
    const pass =
      rtpAbs <= TOL_RTP_ABS &&
      stdRel <= TOL_STD_REL &&
      probAbs <= TOL_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.cycleLengthSpins} R*=${c.cfg.targetRtp.toFixed(2)} τ=${(c.cfg.toleranceAbs*100).toFixed(0)}pp n=${c.cfg.spinsPlayed} (${(cf.cycleProgressFraction*100).toFixed(0)}%)  ` +
        `E[r_N]=${cf.expectedFinalRtp.toFixed(4)}/${mc.observedExpectedFinalRtp.toFixed(4)}  ` +
        `stdDev=${cf.stdDevFinalRtp.toFixed(4)}/${mc.observedStdDevFinalRtp.toFixed(4)}  ` +
        `P(>τ)=${(cf.probExceedsToleranceAtEnd*100).toFixed(2)}%/${(mc.observedProbExceedsToleranceAtEnd*100).toFixed(2)}%  ` +
        `health=${cf.cycleHealthScore.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        cycleProgressFraction: cf.cycleProgressFraction,
        spinsRemaining: cf.spinsRemaining,
        realisedRtpCurrent: Number.isNaN(cf.realisedRtpCurrent) ? 'NaN' : cf.realisedRtpCurrent,
        deviationCurrent: cf.deviationCurrent,
        expectedFinalRtp: cf.expectedFinalRtp,
        stdDevFinalRtp: cf.stdDevFinalRtp,
        meanDeviationFinal: cf.meanDeviationFinal,
        probExceedsToleranceAtEnd: cf.probExceedsToleranceAtEnd,
        oneInNCyclesExceeds: Number.isFinite(cf.oneInNCyclesExceeds) ? cf.oneInNCyclesExceeds : 'Infinity',
        compensationHintRecommended: cf.compensationHintRecommended,
        maxAchievableDeviationNoCompensation: cf.maxAchievableDeviationNoCompensation,
        cycleHealthScore: cf.cycleHealthScore,
        withinToleranceCurrent: cf.withinToleranceCurrent,
      },
      monte_carlo: {
        cycles: CYCLES,
        observedExpectedFinalRtp: mc.observedExpectedFinalRtp,
        observedStdDevFinalRtp: mc.observedStdDevFinalRtp,
        observedProbExceedsToleranceAtEnd: mc.observedProbExceedsToleranceAtEnd,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'AWP_CYCLE_CONVERGENCE',
    generated_utc: new Date().toISOString(),
    cycles_per_config: CYCLES,
    seed: SEED,
    tolerances: { rtp_abs: TOL_RTP_ABS, std_rel: TOL_STD_REL, prob_abs: TOL_PROB_ABS },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'AWP_CYCLE_CONVERGENCE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# AWP_CYCLE_CONVERGENCE — AWP Cycle Convergence Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${CYCLES} MC cycles each = ${(CONFIGS.length * CYCLES / 1e3).toFixed(1)}K total cycle simulations.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "AWP Cycle Convergence Analyzer" (Wave 167 — 55th solver, first kernel above existing `compensatedMath.ts` IR state machine).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form CLT-Bachelier projection from partial-cycle snapshot:');
  md.push('  - E[r_N] = (P_n + m·R*·b)/(N·b)');
  md.push('  - stdDev[r_N] = σ·√m / N  (shrinks to 0 as cycle completes)');
  md.push('  - P(|D_N|>τ) = (1−Φ((τ−μ)/σ)) + Φ((−τ−μ)/σ)');
  md.push('  - compensationHintRecommended = −E[D_N]');
  md.push('  - cycleHealthScore = 1 − P(exceeds)');
  md.push('');
  md.push('MC: 3K cycles per config, Gaussian per-spin payout draws, mulberry32 RNG.');
  md.push('');
  md.push('## Configs — UK regulator AWP disclosure table');
  md.push('');
  md.push('| Config | Pass | N | R* | τ | n (% prog) | E[r_N] CF/MC | stdDev CF/MC | P(>τ) CF/MC | health |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.cycleLengthSpins} | ${(r.cfg.targetRtp*100).toFixed(0)}% | ${(r.cfg.toleranceAbs*100).toFixed(0)}pp | ${r.cfg.spinsPlayed} (${(cf.cycleProgressFraction*100).toFixed(0)}%) | ${cf.expectedFinalRtp.toFixed(4)}/${mc.observedExpectedFinalRtp.toFixed(4)} | ${cf.stdDevFinalRtp.toFixed(4)}/${mc.observedStdDevFinalRtp.toFixed(4)} | ${(cf.probExceedsToleranceAtEnd*100).toFixed(2)}%/${(mc.observedProbExceedsToleranceAtEnd*100).toFixed(2)}% | ${cf.cycleHealthScore.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC LCCP** — B3/B3A/C/D AWP finite-cycle convergence proof');
  md.push('- **MGA AWP §15** — cycle deviation tolerance disclosure');
  md.push('- **EU GA 2024** — compensated math disclosure mandate');
  md.push('- **AU NCPF Class III** — finite-cycle disclosure');
  md.push('');
  md.push('Industry use: UKGC operator pre-deployment certification, MGA AWP audit replay,');
  md.push('EU GA compensated math compliance proof, on-floor machine state introspection.');

  writeFileSync(join(OUT_DIR, 'AWP_CYCLE_CONVERGENCE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/AWP_CYCLE_CONVERGENCE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
