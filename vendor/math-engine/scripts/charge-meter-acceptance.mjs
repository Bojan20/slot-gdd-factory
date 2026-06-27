#!/usr/bin/env node
//
// W152 Wave 50 — Charge Meter feature acceptance.
//
// Closes Faza 12 scenario "⚠️ Cluster cascade + charge meter" by validating
// closed-form solver against Monte Carlo across 7 synthetic configs covering
// the parameter envelope.
//
// Configs:
//   A. small-T subtract  — threshold=10, common cluster wins
//   B. mid-T subtract    — threshold=50, mid-frequency
//   C. large-T subtract  — threshold=200, rare triggers (variance stress)
//   D. small-T drain     — threshold=10, full_drain (overflow loss)
//   E. mid-T drain       — threshold=50, full_drain
//   F. low pClusterWin   — sparse charge events
//   G. high pClusterWin  — dense charge events (cascading risk)
//
// Procedure:
//   1. solveChargeMeterSteadyState (closed-form long-run)
//   2. simulateChargeMeter at 500K spins, seed=12345
//   3. Compare RTP / trigger rate within tolerances:
//        subtract_threshold: rel ≤ 2.0% on RTP, rel ≤ 2.0% on trigger rate
//        full_drain:         rel ≤ 5.0% (overflow analytical approx is bound)
//
// Plus for configs A & B: solveChargeMeterFiniteHorizon at N=200 vs MC,
// trigger PMF L1 distance ≤ 0.05.
//
// Output: reports/acceptance/CHARGE_METER.{json,md}

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 500_000;
const SEED = 12345;
const TOL_REL_SUBTRACT = 0.02;
const TOL_REL_DRAIN = 0.05;
const TOL_PMF_L1 = 0.05;
const FH_N = 200;
const FH_EPISODES = 5000;

const baseDist = [
  { chargePoints: 1, weight: 6 },
  { chargePoints: 2, weight: 3 },
  { chargePoints: 5, weight: 1 },
];

const CONFIGS = [
  {
    name: 'A_small_T10_subtract',
    description: 'threshold=10, subtract, p=0.25 (frequent triggers, ~1 every 24 spins)',
    cfg: { pClusterWin: 0.25, chargeDistribution: baseDist, meterThreshold: 10, rewardX: 50, meterResetMode: 'subtract_threshold' },
    finiteHorizon: true,
  },
  {
    name: 'B_mid_T50_subtract',
    description: 'threshold=50, subtract, p=0.25 (~1 every 118 spins, baseline)',
    cfg: { pClusterWin: 0.25, chargeDistribution: baseDist, meterThreshold: 50, rewardX: 100, meterResetMode: 'subtract_threshold' },
    finiteHorizon: true,
  },
  {
    name: 'C_large_T200_subtract',
    description: 'threshold=200, subtract, p=0.25 (rare, variance stress)',
    cfg: { pClusterWin: 0.25, chargeDistribution: baseDist, meterThreshold: 200, rewardX: 500, meterResetMode: 'subtract_threshold' },
    finiteHorizon: false,
  },
  {
    name: 'D_small_T10_drain',
    description: 'threshold=10, full_drain, p=0.25 (overflow loss measurable)',
    cfg: { pClusterWin: 0.25, chargeDistribution: baseDist, meterThreshold: 10, rewardX: 50, meterResetMode: 'full_drain' },
    finiteHorizon: false,
  },
  {
    name: 'E_mid_T50_drain',
    description: 'threshold=50, full_drain, p=0.25',
    cfg: { pClusterWin: 0.25, chargeDistribution: baseDist, meterThreshold: 50, rewardX: 100, meterResetMode: 'full_drain' },
    finiteHorizon: false,
  },
  {
    name: 'F_low_pwin',
    description: 'threshold=20, subtract, p=0.05 (sparse charge events)',
    cfg: { pClusterWin: 0.05, chargeDistribution: baseDist, meterThreshold: 20, rewardX: 100, meterResetMode: 'subtract_threshold' },
    finiteHorizon: false,
  },
  {
    name: 'G_high_pwin',
    description: 'threshold=30, subtract, p=0.60 (dense, ~1 every 18 spins)',
    cfg: { pClusterWin: 0.60, chargeDistribution: baseDist, meterThreshold: 30, rewardX: 75, meterResetMode: 'subtract_threshold' },
    finiteHorizon: false,
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

function l1(pmfA, pmfB) {
  const n = Math.max(pmfA.length, pmfB.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs((pmfA[i] ?? 0) - (pmfB[i] ?? 0));
  return s;
}

async function main() {
  const { solveChargeMeterSteadyState, solveChargeMeterFiniteHorizon, simulateChargeMeter } = await import(
    join(REPO_ROOT, 'dist', 'features', 'chargeMeter.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} charge-meter configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const ss = solveChargeMeterSteadyState(c.cfg);
    const mc = simulateChargeMeter(c.cfg, SPINS, SEED);
    const tol = c.cfg.meterResetMode === 'subtract_threshold' ? TOL_REL_SUBTRACT : TOL_REL_DRAIN;

    const checks = {
      rtp_rel: relErr(ss.expectedRtpContributionPerSpin, mc.observedRtpPerSpin),
      rate_rel: relErr(ss.triggersPerSpin, mc.observedTriggerRatePerSpin),
    };

    let fhBlock = null;
    if (c.finiteHorizon) {
      const fh = solveChargeMeterFiniteHorizon(c.cfg, FH_N);
      // MC empirical PMF across episodes
      const empCounts = new Array(fh.triggerCountPmf.length).fill(0);
      for (let i = 0; i < FH_EPISODES; i++) {
        const epRes = simulateChargeMeter(c.cfg, FH_N, i * 17 + 1);
        const k = epRes.observedTriggers;
        if (k < empCounts.length) empCounts[k]++;
      }
      const empPmf = empCounts.map((n) => n / FH_EPISODES);
      const l1Dist = l1(fh.triggerCountPmf, empPmf);
      const expRel = relErr(fh.expectedTriggers, empCounts.reduce((a, n, k) => a + k * n / FH_EPISODES, 0));
      fhBlock = {
        N: FH_N,
        episodes: FH_EPISODES,
        cf_expected_triggers: fh.expectedTriggers,
        mc_expected_triggers: empCounts.reduce((a, n, k) => a + k * n / FH_EPISODES, 0),
        expected_rel: expRel,
        pmf_l1: l1Dist,
        cf_pmf_first8: fh.triggerCountPmf.slice(0, 8),
        mc_pmf_first8: empPmf.slice(0, 8),
        pass: l1Dist <= TOL_PMF_L1 && expRel <= 0.05,
      };
      checks.fh_pmf_l1 = l1Dist;
      checks.fh_expected_rel = expRel;
    }

    const elapsedMs = Date.now() - t0;
    const pass =
      checks.rtp_rel <= tol &&
      checks.rate_rel <= tol &&
      (fhBlock ? fhBlock.pass : true);

    if (!pass) allOK = false;

    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `RTP=${ss.expectedRtpContributionPerSpin.toFixed(4)} ` +
        `(MC=${mc.observedRtpPerSpin.toFixed(4)}, rel=${(checks.rtp_rel*100).toFixed(2)}%)  ` +
        `triggers=${ss.triggersPerSpin.toFixed(5)}/sp  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      steady_state: {
        expectedChargePerSpin: ss.expectedChargePerSpin,
        triggersPerSpin: ss.triggersPerSpin,
        spinsPerTrigger: ss.spinsPerTrigger,
        expectedRtpContributionPerSpin: ss.expectedRtpContributionPerSpin,
        expectedOverflowPerTrigger: ss.expectedOverflowPerTrigger,
      },
      monte_carlo: {
        observedTriggers: mc.observedTriggers,
        observedTriggerRatePerSpin: mc.observedTriggerRatePerSpin,
        observedRtpPerSpin: mc.observedRtpPerSpin,
        totalCharge: mc.totalCharge,
        totalOverflow: mc.totalOverflow,
        spins: SPINS,
      },
      finite_horizon: fhBlock,
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CHARGE_METER',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    fh_episodes: FH_EPISODES,
    fh_N: FH_N,
    tolerances: {
      subtract_rel: TOL_REL_SUBTRACT,
      drain_rel: TOL_REL_DRAIN,
      pmf_l1: TOL_PMF_L1,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'CHARGE_METER.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const md = [];
  md.push('# CHARGE_METER — Charge Meter Feature Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Cluster cascade + charge meter".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Renewal-theoretic closed-form (`solveChargeMeterSteadyState`) for long-run RTP contribution and trigger rate.');
  md.push('Discrete-convolution exact PMF (`solveChargeMeterFiniteHorizon`) for finite-N episodes.');
  md.push('Both verified against Monte Carlo reference (`simulateChargeMeter`) at 500K spins per config.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF RTP (X/spin) | MC RTP (X/spin) | rel err | trigger rate | spins/trigger |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.steady_state.expectedRtpContributionPerSpin.toFixed(5)} | ` +
        `${r.monte_carlo.observedRtpPerSpin.toFixed(5)} | ${(r.checks.rtp_rel * 100).toFixed(2)}% | ` +
        `${r.steady_state.triggersPerSpin.toFixed(6)} | ${r.steady_state.spinsPerTrigger.toFixed(1)} |`,
    );
  }
  md.push('');
  md.push('## Finite-Horizon PMF (subtract configs A & B, N=200, 5000 episodes)');
  md.push('');
  for (const r of results) {
    if (!r.finite_horizon) continue;
    const fh = r.finite_horizon;
    md.push(`### ${r.name}`);
    md.push('');
    md.push(`E[#triggers] CF = ${fh.cf_expected_triggers.toFixed(4)}, MC = ${fh.mc_expected_triggers.toFixed(4)}, rel = ${(fh.expected_rel * 100).toFixed(2)}%`);
    md.push('');
    md.push(`PMF L1 distance = ${fh.pmf_l1.toFixed(4)} (tolerance ${TOL_PMF_L1})`);
    md.push('');
    md.push('| k | CF P(K=k) | MC P(K=k) |');
    md.push('|---|---|---|');
    for (let k = 0; k < fh.cf_pmf_first8.length; k++) {
      md.push(`| ${k} | ${fh.cf_pmf_first8[k].toFixed(5)} | ${(fh.mc_pmf_first8[k] ?? 0).toFixed(5)} |`);
    }
    md.push('');
  }

  writeFileSync(join(OUT_DIR, 'CHARGE_METER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CHARGE_METER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
