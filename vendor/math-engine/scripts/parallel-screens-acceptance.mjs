#!/usr/bin/env node
//
// W152 Wave 58 — Parallel Screens acceptance.
//
// 6 synthetic configs × 500K MC spins = 3M total.
//   - Independent vs correlated
//   - Homogeneous (shared dist) vs heterogeneous (per-screen dist)
//   - Small N (2 screens) vs large N (8 screens)
//
// Tolerances: E[Y] rel ≤ 2.0%, Var[Y] rel ≤ 10%, P(Y=0) abs ≤ 0.01.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 500_000;
const SEED = 12345;
const TOL_EY_REL = 0.02;
const TOL_VAR_REL = 0.10;
const TOL_P0_ABS = 0.01;

const stdDist = [
  { valueX: 0, weight: 70 },
  { valueX: 1, weight: 20 },
  { valueX: 5, weight: 8 },
  { valueX: 25, weight: 2 },
];

const richDist = [
  { valueX: 0, weight: 60 },
  { valueX: 2, weight: 20 },
  { valueX: 10, weight: 12 },
  { valueX: 50, weight: 6 },
  { valueX: 250, weight: 2 },
];

const CONFIGS = [
  {
    name: 'A_3screens_shared_indep',
    description: '3 shared identical screens, independent (pShared=0)',
    cfg: { numScreens: 3, shared: true, screenDistributions: [stdDist] },
  },
  {
    name: 'B_5screens_shared_indep',
    description: '5 shared screens, independent',
    cfg: { numScreens: 5, shared: true, screenDistributions: [stdDist] },
  },
  {
    name: 'C_3screens_correlated_30pct',
    description: '3 shared screens, pSharedOutcome=0.30',
    cfg: { numScreens: 3, shared: true, screenDistributions: [stdDist], pSharedOutcome: 0.30 },
  },
  {
    name: 'D_2screens_fully_correlated',
    description: '2 shared screens, pSharedOutcome=1.0 (always shared)',
    cfg: { numScreens: 2, shared: true, screenDistributions: [stdDist], pSharedOutcome: 1.0 },
  },
  {
    name: 'E_heterogeneous_2screen',
    description: '2 heterogeneous screens (stdDist + richDist)',
    cfg: {
      numScreens: 2,
      shared: false,
      screenDistributions: [stdDist, richDist],
    },
  },
  {
    name: 'F_8screens_max_independence',
    description: '8 shared screens, independent (large N regime)',
    cfg: { numScreens: 8, shared: true, screenDistributions: [stdDist] },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveParallelScreens, simulateParallelScreens } = await import(
    join(REPO_ROOT, 'dist', 'features', 'parallelScreens.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} parallel-screen configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveParallelScreens(c.cfg);
    const mc = simulateParallelScreens(c.cfg, SPINS, SEED);

    const checks = {
      ey_rel: relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayout),
      var_rel: relErr(cf.variancePayoutPerSpin, mc.observedVariancePayout),
      p0_abs: Math.abs(cf.probZeroPayout - mc.observedZeroPayoutFraction),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.p0_abs <= TOL_P0_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(32)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]=${cf.expectedPayoutPerSpin.toFixed(3)} (MC=${mc.observedMeanPayout.toFixed(3)}, rel=${(checks.ey_rel*100).toFixed(2)}%)  ` +
        `σ=${cf.stdDevPayoutPerSpin.toFixed(2)}  ` +
        `PMF=${cf.aggregatePmf ? cf.aggregatePmf.length + ' pts' : 'null'}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        stdDevPayoutPerSpin: cf.stdDevPayoutPerSpin,
        volatilityIndex: cf.volatilityIndex,
        probZeroPayout: cf.probZeroPayout,
        hitRate: cf.hitRate,
        perScreenExpected: cf.perScreenExpected,
        perScreenVariance: cf.perScreenVariance,
        aggregatePmfSize: cf.aggregatePmf ? cf.aggregatePmf.length : null,
      },
      monte_carlo: {
        observedMeanPayout: mc.observedMeanPayout,
        observedVariancePayout: mc.observedVariancePayout,
        observedStdDevPayout: mc.observedStdDevPayout,
        observedHitRate: mc.observedHitRate,
        observedZeroPayoutFraction: mc.observedZeroPayoutFraction,
        spins: SPINS,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PARALLEL_SCREENS',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, p0_abs: TOL_P0_ABS },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'PARALLEL_SCREENS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# PARALLEL_SCREENS — N-screen Aggregate Distribution Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Parallel screens (N independent screens spun together)".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form: Independent ⇒ Y = ΣY_i, E[Y] = ΣE[Y_i], Var[Y] = ΣVar[Y_i].');
  md.push('Correlated mixture: pShared × N×V + (1−pShared) × ΣY_i. Var via E[Y²] decomposition.');
  md.push('Aggregate PMF via discrete convolution (independent mode only).');
  md.push('MC verified against closed-form at 500K spins per config.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF E[Y] | MC E[Y] | rel | CF σ | hit rate | P(Y=0) | PMF size |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedPayoutPerSpin.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayout.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.stdDevPayoutPerSpin.toFixed(2)} | ${r.closed_form.hitRate.toFixed(4)} | ` +
        `${r.closed_form.probZeroPayout.toFixed(4)} | ${r.closed_form.aggregatePmfSize ?? '—'} |`,
    );
  }

  writeFileSync(join(OUT_DIR, 'PARALLEL_SCREENS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/PARALLEL_SCREENS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
