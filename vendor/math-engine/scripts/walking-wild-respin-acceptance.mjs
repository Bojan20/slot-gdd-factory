#!/usr/bin/env node
//
// W152 Wave 53 — Walking-Wild Respin variant acceptance.
//
// Closes Faza 12 scenario "⚠️ Walking-wild respin variant".
//
// 6 synthetic configs × 100K MC episodes = 600K episodes total.
//
// Tolerances:
//   E[Y]   rel ≤ 2.0%
//   E[K]   rel ≤ 1.5%
//   Var[K] rel ≤ 10%

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 12345;
const TOL_EY_REL = 0.02;
const TOL_EK_REL = 0.015;
const TOL_VARK_REL = 0.10;

const baseReward = [
  { rewardX: 1, weight: 6 },
  { rewardX: 2, weight: 3 },
  { rewardX: 5, weight: 1 },
];

const heavyTailReward = [
  { rewardX: 1, weight: 50 },
  { rewardX: 5, weight: 20 },
  { rewardX: 25, weight: 5 },
  { rewardX: 100, weight: 1 },
  { rewardX: 500, weight: 0.05 },
];

const uniformStart = (G) => new Array(G).fill(1 / G);
const centerStart = (G) => {
  const a = new Array(G).fill(0);
  a[Math.floor(G / 2)] = 1;
  return a;
};

const CONFIGS = [
  {
    name: 'A_5col_symmetric',
    description: '5 cols, uniform start, symmetric ±0.5/±0.5, base reward',
    cfg: {
      gridCols: 5,
      startColumnPmf: uniformStart(5),
      stepPmf: { left: 0.5, stay: 0, right: 0.5 },
      rewardDistribution: baseReward,
    },
  },
  {
    name: 'B_7col_with_stay',
    description: '7 cols, uniform start, 30% stay (sticky walk)',
    cfg: {
      gridCols: 7,
      startColumnPmf: uniformStart(7),
      stepPmf: { left: 0.35, stay: 0.30, right: 0.35 },
      rewardDistribution: baseReward,
    },
  },
  {
    name: 'C_strict_right',
    description: '5 cols, start at col 0, always RIGHT (deterministic K=5)',
    cfg: {
      gridCols: 5,
      startColumnPmf: [1, 0, 0, 0, 0],
      stepPmf: { left: 0, stay: 0, right: 1 },
      rewardDistribution: baseReward,
    },
  },
  {
    name: 'D_center_start_high_stay',
    description: '7 cols, center start, 70% stay (long walks)',
    cfg: {
      gridCols: 7,
      startColumnPmf: centerStart(7),
      stepPmf: { left: 0.15, stay: 0.70, right: 0.15 },
      rewardDistribution: baseReward,
    },
  },
  {
    name: 'E_biased_right',
    description: '6 cols, start at col 0, biased RIGHT (drift)',
    cfg: {
      gridCols: 6,
      startColumnPmf: [1, 0, 0, 0, 0, 0],
      stepPmf: { left: 0.20, stay: 0.10, right: 0.70 },
      rewardDistribution: baseReward,
    },
  },
  {
    name: 'F_heavy_tail_reward',
    description: '5 cols, uniform start, symmetric, Pareto-like reward',
    cfg: {
      gridCols: 5,
      startColumnPmf: uniformStart(5),
      stepPmf: { left: 0.5, stay: 0, right: 0.5 },
      rewardDistribution: heavyTailReward,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveWalkingWildRespin, simulateWalkingWildRespin } = await import(
    join(REPO_ROOT, 'dist', 'features', 'walkingWildRespin.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} walking-wild configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveWalkingWildRespin(c.cfg);
    const mc = simulateWalkingWildRespin(c.cfg, EPISODES, SEED);

    const checks = {
      ey_rel: relErr(cf.expectedPayoutPerEpisode, mc.observedMeanPayout),
      ek_rel: relErr(cf.expectedRespins, mc.observedMeanRespins),
      varK_rel: relErr(cf.varianceRespins, mc.observedVarianceRespins),
    };
    // C config has Var[K] = 0 (deterministic) → skip relative tolerance there
    const isDeterministicK = cf.varianceRespins < 1e-9;
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.ek_rel <= TOL_EK_REL &&
      (isDeterministicK || checks.varK_rel <= TOL_VARK_REL);

    if (!pass) allOK = false;

    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]=${cf.expectedPayoutPerEpisode.toFixed(3)} (MC=${mc.observedMeanPayout.toFixed(3)}, rel=${(checks.ey_rel*100).toFixed(2)}%)  ` +
        `E[K]=${cf.expectedRespins.toFixed(2)} maxK_MC=${mc.observedMaxRespins}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedRespins: cf.expectedRespins,
        varianceRespins: cf.varianceRespins,
        expectedRewardPerRespin: cf.expectedRewardPerRespin,
        varianceRewardPerRespin: cf.varianceRewardPerRespin,
        expectedPayoutPerEpisode: cf.expectedPayoutPerEpisode,
        variancePayoutPerEpisode: cf.variancePayoutPerEpisode,
        stdDevPayoutPerEpisode: cf.stdDevPayoutPerEpisode,
        expectedRespinsByStart: cf.expectedRespinsByStart,
      },
      monte_carlo: {
        observedMeanPayout: mc.observedMeanPayout,
        observedVariancePayout: mc.observedVariancePayout,
        observedStdDevPayout: mc.observedStdDevPayout,
        observedMeanRespins: mc.observedMeanRespins,
        observedVarianceRespins: mc.observedVarianceRespins,
        observedMaxRespins: mc.observedMaxRespins,
        episodes: EPISODES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'WALKING_WILD_RESPIN',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      ey_rel: TOL_EY_REL,
      ek_rel: TOL_EK_REL,
      varK_rel: TOL_VARK_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'WALKING_WILD_RESPIN.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const md = [];
  md.push('# WALKING_WILD_RESPIN — Walking-Wild Respin Variant Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Walking-wild respin variant".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form: 1D absorbing Markov chain over column position, fundamental matrix `N = (I − Q)^{-1}` →');
  md.push('E[K] + Var[K]. Wald + compound-sum variance for E[Y], Var[Y].');
  md.push('Verified vs Monte Carlo at 100K episodes per config.');
  md.push('');
  md.push('## Tolerances');
  md.push('');
  md.push('| Metric | Tolerance |');
  md.push('|---|---|');
  md.push(`| E[Y] | rel ≤ ${(TOL_EY_REL * 100).toFixed(1)}% |`);
  md.push(`| E[K] | rel ≤ ${(TOL_EK_REL * 100).toFixed(1)}% |`);
  md.push(`| Var[K] | rel ≤ ${(TOL_VARK_REL * 100).toFixed(1)}% (skipped if deterministic) |`);
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF E[Y] | MC E[Y] | rel | CF E[K] | MC E[K] | rel | CF σ[Y] |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedPayoutPerEpisode.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayout.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedRespins.toFixed(2)} | ${r.monte_carlo.observedMeanRespins.toFixed(2)} | ` +
        `${(r.checks.ek_rel*100).toFixed(2)}% | ${r.closed_form.stdDevPayoutPerEpisode.toFixed(2)} |`,
    );
  }
  md.push('');

  writeFileSync(join(OUT_DIR, 'WALKING_WILD_RESPIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/WALKING_WILD_RESPIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
