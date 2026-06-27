#!/usr/bin/env node
//
// W152 Wave 87 — Cascade Sequential Multiplier Pyramid acceptance (Wave 86).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC. Validates:
//
//   E[N] = 1/(1-q),   E[Y] = μ_W · [Σ q^(k-1)·m_k + m_max·q^L/(1-q)]
//   Var[Y], tail probabilities, mega-hit contribution
//
// Operator deliverable: `reports/acceptance/CASCADE_MULTIPLIER_PYRAMID.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xDEADCAFE;
const TOL_EY_REL = 0.05;
const TOL_VAR_REL = 0.25;
const TOL_N_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_sweet_bonanza_style',
    description: 'Sweet-Bonanza-style: q=0.4, ladder [1,2,4,8,16,32]',
    cfg: {
      cascadeContinuationProbability: 0.4,
      multiplierLadder: [1, 2, 4, 8, 16, 32],
      meanBaseWinPerStepX: 1.0,
      varianceBaseWinPerStepX: 4.0,
    },
  },
  {
    name: 'B_sugar_rush_style',
    description: 'Sugar-Rush-style: q=0.45, deep ladder [1,2,4,8,16,32,64]',
    cfg: {
      cascadeContinuationProbability: 0.45,
      multiplierLadder: [1, 2, 4, 8, 16, 32, 64],
      meanBaseWinPerStepX: 0.3,
      varianceBaseWinPerStepX: 0.5,
    },
  },
  {
    name: 'C_no_continuation',
    description: 'Single-shot (q=0) — baseline μ_W · m_1',
    cfg: {
      cascadeContinuationProbability: 0,
      multiplierLadder: [3],
      meanBaseWinPerStepX: 2.0,
      varianceBaseWinPerStepX: 1.0,
    },
  },
  {
    name: 'D_high_continuation_flat_ladder',
    description: 'High q=0.7, flat ladder [2,2,2,2,2]',
    cfg: {
      cascadeContinuationProbability: 0.7,
      multiplierLadder: [2, 2, 2, 2, 2],
      meanBaseWinPerStepX: 0.5,
      varianceBaseWinPerStepX: 1.0,
    },
  },
  {
    name: 'E_arithmetic_ladder',
    description: 'Arithmetic ladder [2,4,6,8,10] q=0.5',
    cfg: {
      cascadeContinuationProbability: 0.5,
      multiplierLadder: [2, 4, 6, 8, 10],
      meanBaseWinPerStepX: 0.5,
      varianceBaseWinPerStepX: 1.0,
    },
  },
  {
    name: 'F_long_tail_aggressive',
    description: 'q=0.8 — long-tail mega cascade chance',
    cfg: {
      cascadeContinuationProbability: 0.8,
      multiplierLadder: [1, 1.5, 2, 3, 5, 8],
      meanBaseWinPerStepX: 0.4,
      varianceBaseWinPerStepX: 0.5,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveCascadeMultiplierPyramid, simulateCascadeMultiplierPyramid } = await import(
    join(REPO_ROOT, 'dist', 'features', 'cascadeMultiplierPyramid.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Cascade Multiplier Pyramid configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCascadeMultiplierPyramid(c.cfg);
    const mc = simulateCascadeMultiplierPyramid(c.cfg, EPISODES, SEED);

    const checks = {
      ey_rel: relErr(cf.expectedTotalPayoutX, mc.observedMeanPayoutX),
      var_rel: relErr(cf.varianceTotalPayoutX, mc.observedVariancePayoutX),
      n_rel: relErr(cf.expectedCascades, mc.observedMeanCascades),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.n_rel <= TOL_N_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedTotalPayoutX.toFixed(4)} MC=${mc.observedMeanPayoutX.toFixed(4)}  ` +
        `E[N]_CF=${cf.expectedCascades.toFixed(3)} MC=${mc.observedMeanCascades.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedCascades: cf.expectedCascades,
        varianceCascades: cf.varianceCascades,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayoutX: cf.varianceTotalPayoutX,
        expectedFinalMultiplier: cf.expectedFinalMultiplier,
        probReachMaxLadder: cf.probReachMaxLadder,
        probAtLeastFiveCascades: cf.probAtLeastFiveCascades,
        probAtLeastTenCascades: cf.probAtLeastTenCascades,
        expectedMegaHitContribution: cf.expectedMegaHitContribution,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanCascades: mc.observedMeanCascades,
        observedMaxCascades: mc.observedMaxCascades,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedFinalMultiplierAvg: mc.observedFinalMultiplierAvg,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CASCADE_MULTIPLIER_PYRAMID',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, n_rel: TOL_N_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'CASCADE_MULTIPLIER_PYRAMID.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# CASCADE_MULTIPLIER_PYRAMID — Cascade × Multiplier Ladder Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 extension: ✅ "Cascade Sequential Multiplier Pyramid" (Wave 86).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form via geometric-sum interchange:');
  md.push('  - N ~ shifted-geometric: E[N]=1/(1-q), Var[N]=q/(1-q)²');
  md.push('  - E[Y] = μ_W · [Σ q^(k-1)·m_k + m_max·q^L/(1-q)]');
  md.push('  - Var[Y] via E[Y²] = σ²·E[Σm_k²] + μ²·E[S_N²]');
  md.push('  - Tail: P(N≥k) = q^(k-1), P(reach max) = q^(L-1)');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32, exact 2-point per-step distribution.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | E[N]_CF | E[N]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalPayoutX.toFixed(4)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(4)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedCascades.toFixed(3)} | ${r.monte_carlo.observedMeanCascades.toFixed(3)} | ` +
        `${(r.checks.n_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail metrics (per config)');
  md.push('');
  md.push('| Config | E[final mult]_CF | P(N≥5) | P(N≥10) | P(reach max) | mega-hit μ_W·m_max·q^(L-1) | max obs N |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.closed_form.expectedFinalMultiplier.toFixed(3)} | ` +
        `${(r.closed_form.probAtLeastFiveCascades * 100).toFixed(4)}% | ` +
        `${(r.closed_form.probAtLeastTenCascades * 100).toFixed(6)}% | ` +
        `${(r.closed_form.probReachMaxLadder * 100).toFixed(4)}% | ` +
        `${r.closed_form.expectedMegaHitContribution.toFixed(5)} | ` +
        `${r.monte_carlo.observedMaxCascades} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure required for cascade games');
  md.push('- **MGA PPD §11.f** — tail-probability disclosure for max-multiplier games');
  md.push('- **eCOGRA Generic Slots Audit** — closed-form variance + tail enables exact PAR sheet');
  md.push('- Industry use: Sweet Bonanza, Sugar Rush, Wanted Dead or a Wild cascade-multiplier games');

  writeFileSync(join(OUT_DIR, 'CASCADE_MULTIPLIER_PYRAMID.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CASCADE_MULTIPLIER_PYRAMID.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
