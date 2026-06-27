#!/usr/bin/env node
//
// W152 Wave 60 — Sticky-Cash Collector variant acceptance.
//
// 6 synthetic configs × 5K episodes × varying N = ~2-3M total spins.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 10_000;
const SEED = 12345;
const TOL_EY_REL = 0.05;
const TOL_COLLECTORS_REL = 0.05;
const TOL_STRANDED_REL = 0.15;

const baseCash = [
  { valueX: 1, weight: 6 },
  { valueX: 2, weight: 3 },
  { valueX: 5, weight: 1 },
];

const baseMult = [
  { multiplier: 1, weight: 60 },
  { multiplier: 2, weight: 25 },
  { multiplier: 5, weight: 10 },
  { multiplier: 10, weight: 5 },
];

const heavyMult = [
  { multiplier: 1, weight: 40 },
  { multiplier: 3, weight: 30 },
  { multiplier: 10, weight: 20 },
  { multiplier: 50, weight: 8 },
  { multiplier: 200, weight: 2 },
];

const CONFIGS = [
  {
    name: 'A_short_N50_classic',
    description: 'N=50, p_cash=0.15, p_collect=0.05, base dists',
    spins: 50,
    cfg: { pCash: 0.15, pCollect: 0.05, cashDistribution: baseCash, multDistribution: baseMult },
  },
  {
    name: 'B_long_N500_classic',
    description: 'N=500 (asymptotic regime)',
    spins: 500,
    cfg: { pCash: 0.15, pCollect: 0.05, cashDistribution: baseCash, multDistribution: baseMult },
  },
  {
    name: 'C_high_collect_rate',
    description: 'p_collect=0.20 (frequent collections)',
    spins: 100,
    cfg: { pCash: 0.30, pCollect: 0.20, cashDistribution: baseCash, multDistribution: baseMult },
  },
  {
    name: 'D_rare_collector',
    description: 'p_collect=0.01 (rare collections, big build-ups)',
    spins: 200,
    cfg: { pCash: 0.30, pCollect: 0.01, cashDistribution: baseCash, multDistribution: baseMult },
  },
  {
    name: 'E_heavy_mult',
    description: 'Heavy-tail collector multipliers (up to 200×)',
    spins: 100,
    cfg: { pCash: 0.20, pCollect: 0.05, cashDistribution: baseCash, multDistribution: heavyMult },
  },
  {
    name: 'F_tiny_episode',
    description: 'N=20 (transient-dominated)',
    spins: 20,
    cfg: { pCash: 0.20, pCollect: 0.10, cashDistribution: baseCash, multDistribution: baseMult },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveStickyCashCollectorSteadyState, solveStickyCashCollectorFiniteHorizon, simulateStickyCashCollector } =
    await import(join(REPO_ROOT, 'dist', 'features', 'stickyCashCollector.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} sticky-cash-collector configs @ ${EPISODES} eps each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const ss = solveStickyCashCollectorSteadyState(c.cfg);
    const fh = solveStickyCashCollectorFiniteHorizon(c.cfg, c.spins);
    const mc = simulateStickyCashCollector(c.cfg, c.spins, EPISODES, SEED);

    const checks = {
      ey_rel: relErr(fh.expectedPayoutInN, mc.observedMeanPayoutInN),
      collectors_rel: relErr(c.spins * c.cfg.pCollect, mc.observedMeanCollectors),
      stranded_rel: relErr(fh.expectedStrandedAtEnd, mc.observedMeanStrandedAtEnd),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.collectors_rel <= TOL_COLLECTORS_REL &&
      checks.stranded_rel <= TOL_STRANDED_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.spins}  ` +
        `E[Y]_CF=${fh.expectedPayoutInN.toFixed(3)} E[Y]_MC=${mc.observedMeanPayoutInN.toFixed(3)} (rel=${(checks.ey_rel*100).toFixed(2)}%)  ` +
        `eff=${(fh.efficiencyVsAsymptotic*100).toFixed(1)}%  RTP_ss=${ss.longRunRtpPerSpin.toFixed(4)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      spins: c.spins,
      cfg: c.cfg,
      steady_state: {
        longRunRtpPerSpin: ss.longRunRtpPerSpin,
        expectedStickyTotalAtCollector: ss.expectedStickyTotalAtCollector,
        expectedPayoutPerCollector: ss.expectedPayoutPerCollector,
      },
      closed_form: {
        expectedPayoutInN: fh.expectedPayoutInN,
        expectedPayoutPerSpinInN: fh.expectedPayoutPerSpinInN,
        asymptoticRtpInN: fh.asymptoticRtpInN,
        efficiencyVsAsymptotic: fh.efficiencyVsAsymptotic,
        expectedStrandedAtEnd: fh.expectedStrandedAtEnd,
      },
      monte_carlo: {
        observedMeanPayoutInN: mc.observedMeanPayoutInN,
        observedVariancePayoutInN: mc.observedVariancePayoutInN,
        observedStdDevPayoutInN: mc.observedStdDevPayoutInN,
        observedMeanCollectors: mc.observedMeanCollectors,
        observedMeanStrandedAtEnd: mc.observedMeanStrandedAtEnd,
        episodes: EPISODES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'STICKY_CASH_COLLECTOR',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, collectors_rel: TOL_COLLECTORS_REL, stranded_rel: TOL_STRANDED_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'STICKY_CASH_COLLECTOR.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# STICKY_CASH_COLLECTOR — Sticky-Cash Collector Variant Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Sticky-cash variant" (cash-collect mechanic with multiplier-collector).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Renewal-reward theory: collector triggers reset sticky total + pay M × T. Long-run RTP = p_cash · E[V] · E[M]');
  md.push('per spin (independent of p_collect in infinite horizon).');
  md.push('');
  md.push('Finite-horizon via E[T_n] moment propagation: `E[T_{n+1}] = E[T_n]·(1−p_collect) + p_cash·E[V]`,');
  md.push('cumulative `E[Y_n] = E[Y_{n-1}] + p_collect·E[M]·E[T_{n-1}]`. Tracks "stranded cash at N" deduction.');
  md.push('');
  md.push('Different from Wave 52 (Sticky Cash + Reveal Mult): W52 has deterministic single end-of-window');
  md.push('multiplier; W60 has random-arrival collector events with reset between.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | N | CF E[Y] | MC E[Y] | rel | CF eff | RTP_ss |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.spins} | ${r.closed_form.expectedPayoutInN.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutInN.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${(r.closed_form.efficiencyVsAsymptotic*100).toFixed(1)}% | ${r.steady_state.longRunRtpPerSpin.toFixed(5)} |`,
    );
  }

  writeFileSync(join(OUT_DIR, 'STICKY_CASH_COLLECTOR.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/STICKY_CASH_COLLECTOR.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
