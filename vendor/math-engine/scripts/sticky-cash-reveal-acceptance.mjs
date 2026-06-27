#!/usr/bin/env node
//
// W152 Wave 52 — Sticky Cash + Reveal Multiplier acceptance.
//
// Closes Faza 12 scenario "⚠️ Sticky cash + reveal multiplier".
//
// 6 synthetic configs × 100K MC episodes each = 600K episodes total
// (each episode = N spins on a G-cell grid + 1 reveal multiplier draw).
//
// Tolerances:
//   E[Y]                rel ≤ 2.0%
//   Var[Y]              rel ≤ 10% (high variance from tail mults)
//   E[occupied cells]   rel ≤ 1.0%
//   P(Y=0)              abs ≤ 0.01
//   E[M]                rel ≤ 2.0%

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 12345;
const TOL_EY_REL = 0.02;
const TOL_VAR_REL = 0.10;
const TOL_OCC_REL = 0.01;
const TOL_P0_ABS = 0.01;
const TOL_EM_REL = 0.02;

const baseCash = [
  { valueX: 1, weight: 6 },
  { valueX: 2, weight: 3 },
  { valueX: 5, weight: 1 },
];

const heavyTailCash = [
  { valueX: 1, weight: 50 },
  { valueX: 2, weight: 20 },
  { valueX: 5, weight: 8 },
  { valueX: 10, weight: 3 },
  { valueX: 25, weight: 1 },
  { valueX: 100, weight: 0.2 },
];

const baseReveal = [
  { multiplier: 1, weight: 60 },
  { multiplier: 2, weight: 25 },
  { multiplier: 5, weight: 10 },
  { multiplier: 10, weight: 4 },
  { multiplier: 100, weight: 1 },
];

const flatReveal = [
  { multiplier: 1, weight: 50 },
  { multiplier: 2, weight: 30 },
  { multiplier: 3, weight: 20 },
];

const CONFIGS = [
  {
    name: 'A_classic_5x4_10spins',
    description: '5×4 grid, 10 spins, p=0.10, base cash, 5-tier reveal',
    cfg: {
      gridSize: 20,
      spinsInWindow: 10,
      pCapturePerEmptyPerSpin: 0.10,
      cashValueDistribution: baseCash,
      revealMultiplierDistribution: baseReveal,
    },
  },
  {
    name: 'B_short_window_low_p',
    description: '5×4, 5 spins, p=0.05 (low fill rate)',
    cfg: {
      gridSize: 20,
      spinsInWindow: 5,
      pCapturePerEmptyPerSpin: 0.05,
      cashValueDistribution: baseCash,
      revealMultiplierDistribution: baseReveal,
    },
  },
  {
    name: 'C_long_window_high_p',
    description: '5×4, 20 spins, p=0.20 (near-saturation)',
    cfg: {
      gridSize: 20,
      spinsInWindow: 20,
      pCapturePerEmptyPerSpin: 0.20,
      cashValueDistribution: baseCash,
      revealMultiplierDistribution: baseReveal,
    },
  },
  {
    name: 'D_big_grid_5x7',
    description: '5×7=35 grid, 10 spins, p=0.10',
    cfg: {
      gridSize: 35,
      spinsInWindow: 10,
      pCapturePerEmptyPerSpin: 0.10,
      cashValueDistribution: baseCash,
      revealMultiplierDistribution: baseReveal,
    },
  },
  {
    name: 'E_heavy_tail_cash',
    description: '5×4, 10 spins, p=0.10, Pareto-like cash',
    cfg: {
      gridSize: 20,
      spinsInWindow: 10,
      pCapturePerEmptyPerSpin: 0.10,
      cashValueDistribution: heavyTailCash,
      revealMultiplierDistribution: baseReveal,
    },
  },
  {
    name: 'F_flat_reveal',
    description: '5×4, 10 spins, p=0.10, 3-tier flat reveal (1/2/3×)',
    cfg: {
      gridSize: 20,
      spinsInWindow: 10,
      pCapturePerEmptyPerSpin: 0.10,
      cashValueDistribution: baseCash,
      revealMultiplierDistribution: flatReveal,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveStickyCashReveal, simulateStickyCashReveal } = await import(
    join(REPO_ROOT, 'dist', 'features', 'stickyCashReveal.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} sticky-cash-reveal configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveStickyCashReveal(c.cfg);
    const mc = simulateStickyCashReveal(c.cfg, EPISODES, SEED);

    const checks = {
      ey_rel: relErr(cf.expectedPayoutPerEpisode, mc.observedMeanPayout),
      var_rel: relErr(cf.variancePayoutPerEpisode, mc.observedVariancePayout),
      occ_rel: relErr(cf.expectedOccupiedCells, mc.observedMeanOccupiedCells),
      p0_abs: Math.abs(cf.probZeroPayout - mc.observedZeroPayoutFraction),
      em_rel: relErr(cf.expectedRevealMultiplier, mc.observedMeanRevealMult),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.occ_rel <= TOL_OCC_REL &&
      checks.p0_abs <= TOL_P0_ABS &&
      checks.em_rel <= TOL_EM_REL;
    if (!pass) allOK = false;

    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]=${cf.expectedPayoutPerEpisode.toFixed(3)} (MC=${mc.observedMeanPayout.toFixed(3)}, rel=${(checks.ey_rel*100).toFixed(2)}%)  ` +
        `σ=${cf.stdDevPayoutPerEpisode.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        pCellOccupied: cf.pCellOccupied,
        expectedOccupiedCells: cf.expectedOccupiedCells,
        expectedCashPerOccupiedCell: cf.expectedCashPerOccupiedCell,
        expectedRevealMultiplier: cf.expectedRevealMultiplier,
        varianceRevealMultiplier: cf.varianceRevealMultiplier,
        expectedTotalCash: cf.expectedTotalCash,
        varianceTotalCash: cf.varianceTotalCash,
        expectedPayoutPerEpisode: cf.expectedPayoutPerEpisode,
        variancePayoutPerEpisode: cf.variancePayoutPerEpisode,
        stdDevPayoutPerEpisode: cf.stdDevPayoutPerEpisode,
        probZeroPayout: cf.probZeroPayout,
      },
      monte_carlo: {
        observedMeanPayout: mc.observedMeanPayout,
        observedVariancePayout: mc.observedVariancePayout,
        observedStdDevPayout: mc.observedStdDevPayout,
        observedMeanOccupiedCells: mc.observedMeanOccupiedCells,
        observedZeroPayoutFraction: mc.observedZeroPayoutFraction,
        observedMeanRevealMult: mc.observedMeanRevealMult,
        episodes: EPISODES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'STICKY_CASH_REVEAL',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      ey_rel: TOL_EY_REL,
      var_rel: TOL_VAR_REL,
      occ_rel: TOL_OCC_REL,
      p0_abs: TOL_P0_ABS,
      em_rel: TOL_EM_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'STICKY_CASH_REVEAL.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const md = [];
  md.push('# STICKY_CASH_REVEAL — Sticky Cash + Reveal Multiplier Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Sticky cash + reveal multiplier".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form: per-cell independent geometric (1-p)^N → q probability, cash V iid → E[T] = Gq·E[V],');
  md.push('Var[T] = G(q·E[V²]−q²·E[V]²), independent reveal M → E[Y] = E[T]·E[M],');
  md.push('Var[Y] = E[T]²·Var[M] + Var[T]·E[M]² + Var[T]·Var[M].');
  md.push('MC verification across 6 synthetic configs × 100K episodes each = 600K total.');
  md.push('');
  md.push('## Tolerances');
  md.push('');
  md.push('| Metric | Tolerance |');
  md.push('|---|---|');
  md.push(`| E[Y] | rel ≤ ${(TOL_EY_REL * 100).toFixed(1)}% |`);
  md.push(`| Var[Y] | rel ≤ ${(TOL_VAR_REL * 100).toFixed(1)}% |`);
  md.push(`| E[occupied] | rel ≤ ${(TOL_OCC_REL * 100).toFixed(1)}% |`);
  md.push(`| P(Y=0) | abs ≤ ${TOL_P0_ABS} |`);
  md.push(`| E[M] | rel ≤ ${(TOL_EM_REL * 100).toFixed(1)}% |`);
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF E[Y] | MC E[Y] | rel | CF σ[Y] | MC σ[Y] | P(Y=0) CF | P(Y=0) MC |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedPayoutPerEpisode.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayout.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.stdDevPayoutPerEpisode.toFixed(2)} | ${r.monte_carlo.observedStdDevPayout.toFixed(2)} | ` +
        `${r.closed_form.probZeroPayout.toFixed(4)} | ${r.monte_carlo.observedZeroPayoutFraction.toFixed(4)} |`,
    );
  }
  md.push('');

  writeFileSync(join(OUT_DIR, 'STICKY_CASH_REVEAL.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/STICKY_CASH_REVEAL.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
