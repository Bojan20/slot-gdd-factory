#!/usr/bin/env node
//
// W152 Wave 119 — Bonus Collect-N Trigger Tracker acceptance (Wave 118).
//
// 6 PAR-style configs × 50K episodes each = 300K total MC episodes.
// Each episode runs N/p ≈ 200-2000 spins, so total spins ≈ 50-100M.
//
// Operator deliverable: `reports/acceptance/BONUS_COLLECT_N.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: median + 95th percentile + horizon
// disclosure for Negative-Binomial collect-N trigger tracker.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 50_000;
const SEED = 0xCAFE0007;
const TOL_E_REL      = 0.02;  // expected wait time
const TOL_VAR_REL    = 0.10;  // variance
const TOL_HORIZON_ABS = 0.02; // P(trigger within horizon) absolute

const CONFIGS = [
  {
    name: 'A_money_cart_6coin',
    description: 'Pragmatic Money Cart style: collect 6 coins @ p=0.03',
    cfg: {
      collectProbabilityPerSpin: 0.03,
      triggerThreshold: 6,
      percentileTargets: [0.5, 0.75, 0.95],
      horizonSpins: 500,
    },
  },
  {
    name: 'B_money_train_12coin_retrigger',
    description: 'Money Train style: collect 12 coins for retrigger @ p=0.04',
    cfg: {
      collectProbabilityPerSpin: 0.04,
      triggerThreshold: 12,
      percentileTargets: [0.5, 0.95],
      horizonSpins: 800,
    },
  },
  {
    name: 'C_rare_high_threshold',
    description: 'Rare 20-collect @ p=0.01 (long-tail compliance disclosure)',
    cfg: {
      collectProbabilityPerSpin: 0.01,
      triggerThreshold: 20,
      percentileTargets: [0.5, 0.95, 0.99],
      horizonSpins: 5000,
    },
  },
  {
    name: 'D_high_freq_short_threshold',
    description: 'High-frequency p=0.20, short threshold N=3',
    cfg: {
      collectProbabilityPerSpin: 0.20,
      triggerThreshold: 3,
      percentileTargets: [0.5, 0.95],
      horizonSpins: 50,
    },
  },
  {
    name: 'E_geometric_corner_N1',
    description: 'Corner N=1 → reduces to shifted-Geometric',
    cfg: {
      collectProbabilityPerSpin: 0.05,
      triggerThreshold: 1,
      percentileTargets: [0.5, 0.95],
      horizonSpins: 100,
    },
  },
  {
    name: 'F_deterministic_p1',
    description: 'Deterministic corner: p=1 → triggers at exactly N spins',
    cfg: {
      collectProbabilityPerSpin: 1,
      triggerThreshold: 5,
      percentileTargets: [0.5, 0.95],
      horizonSpins: 10,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveBonusCollectN, simulateBonusCollectN } = await import(
    join(REPO_ROOT, 'dist', 'features', 'bonusCollectN.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bonus Collect-N configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveBonusCollectN(c.cfg);
    const mc = simulateBonusCollectN(c.cfg, EPISODES, SEED);

    const eRel = relErr(cf.expectedWaitTime, mc.observedMeanWaitTime);
    const varRel = cf.varianceWaitTime > 0
      ? relErr(cf.varianceWaitTime, mc.observedVarianceWaitTime)
      : Math.abs(cf.varianceWaitTime - mc.observedVarianceWaitTime);
    const horizonAbs = cf.probTriggerWithinHorizon !== undefined && mc.observedTriggerWithinHorizonFraction !== undefined
      ? Math.abs(cf.probTriggerWithinHorizon - mc.observedTriggerWithinHorizonFraction)
      : 0;

    const checks = {
      e_rel: eRel,
      var_rel: varRel,
      horizon_abs: horizonAbs,
    };
    const pass =
      eRel <= TOL_E_REL &&
      varRel <= TOL_VAR_REL &&
      horizonAbs <= TOL_HORIZON_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(36)} ${pass ? '✅' : '❌'}  ` +
        `E[T]_CF=${cf.expectedWaitTime.toFixed(2)} MC=${mc.observedMeanWaitTime.toFixed(2)} ` +
        `(rel=${(eRel * 100).toFixed(2)}%)  ` +
        `varRel=${(varRel * 100).toFixed(2)}%  ` +
        `P(horiz)=${(cf.probTriggerWithinHorizon * 100).toFixed(1)}%/${(mc.observedTriggerWithinHorizonFraction * 100).toFixed(1)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedWaitTime: cf.expectedWaitTime,
        varianceWaitTime: cf.varianceWaitTime,
        stdWaitTime: cf.stdWaitTime,
        medianWaitTime: cf.medianWaitTime,
        percentileWaitTimes: cf.percentileWaitTimes,
        probTriggerWithinHorizon: cf.probTriggerWithinHorizon,
        triggerRatePerSpin: cf.triggerRatePerSpin,
        expectedTriggersInHorizon: cf.expectedTriggersInHorizon,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanWaitTime: mc.observedMeanWaitTime,
        observedVarianceWaitTime: mc.observedVarianceWaitTime,
        observedMaxObserved: mc.observedMaxObserved,
        observedTriggerWithinHorizonFraction: mc.observedTriggerWithinHorizonFraction,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BONUS_COLLECT_N',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      e_rel: TOL_E_REL,
      var_rel: TOL_VAR_REL,
      horizon_abs: TOL_HORIZON_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BONUS_COLLECT_N.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BONUS_COLLECT_N — Bonus Collect-N Trigger Tracker Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC episodes.`);
  md.push('');
  md.push('Closes Faza 4.6 ext (post-W100): ✅ "Bonus Collect-N Trigger Tracker" (Wave 118).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Negative Binomial NB(N, p):');
  md.push('  - T_N ~ NB(N, p) sa support {N, N+1, ...}');
  md.push('  - **E[T_N] = N/p**, **Var[T_N] = N(1−p)/p²**');
  md.push('  - P(T_N ≤ k) = 1 − P(C_k < N) via log-space binomial PMF');
  md.push('  - Median + percentile via monotone CDF binary search');
  md.push('  - Lanczos logGamma za numerical stability');
  md.push('');
  md.push('MC: 50K episodes per config, mulberry32 RNG, per-spin Bernoulli + count tracker.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | N/p | E[T]_CF | E[T]_MC | rel | P(horiz)_CF | P(horiz)_MC |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.cfg.triggerThreshold}/${r.cfg.collectProbabilityPerSpin} | ` +
        `${r.closed_form.expectedWaitTime.toFixed(2)} | ` +
        `${r.monte_carlo.observedMeanWaitTime.toFixed(2)} | ` +
        `${(r.checks.e_rel * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probTriggerWithinHorizon * 100).toFixed(2)}% | ` +
        `${(r.monte_carlo.observedTriggerWithinHorizonFraction * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Per-config percentile disclosure (Config A — Money Cart 6-coin)');
  md.push('');
  md.push('| Percentile | k_q |');
  md.push('|---|---|');
  const pcts = results[0].closed_form.percentileWaitTimes;
  for (const [q, k] of Object.entries(pcts)) {
    md.push(`| P${(parseFloat(q) * 100).toFixed(0)} | ${k} |`);
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — median + 95th percentile wait time disclosure');
  md.push('- **MGA PPD §11.f** — operator-facing collect-rate disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies E[T_N], P(T_N≤k) match engine');
  md.push('- Industry use: Pragmatic Money Cart / Money Train series (Money Train 2/3/4),');
  md.push('  Stake Logic Wild Swarm, Hacksaw Money Hunt, Push Gaming Razor Shark.');

  writeFileSync(join(OUT_DIR, 'BONUS_COLLECT_N.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BONUS_COLLECT_N.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
