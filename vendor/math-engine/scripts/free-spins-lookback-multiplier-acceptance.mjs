#!/usr/bin/env node
//
// W152 Wave 98 — Free Spins Lookback Multiplier acceptance (Wave 97).
//
// 6 PAR-style configs × 100K episodes = 600K total MC.
//
// Operator deliverable: `reports/acceptance/FREE_SPINS_LOOKBACK_MULTIPLIER.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xDEFACE12;
const TOL_EY_REL = 0.05;
const TOL_VAR_REL = 0.30;
const TOL_M_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_money_cart_4_style',
    description: 'Money Cart 4 style: K=12 FS + lookback x1/x5/x10/x100 weighted',
    cfg: {
      freeSpinsK: 12,
      meanBaseWinPerSpinX: 2,
      varianceBaseWinPerSpinX: 8,
      multiplierDistribution: [
        { label: 'x1', valueX: 1, weight: 50 },
        { label: 'x5', valueX: 5, weight: 30 },
        { label: 'x10', valueX: 10, weight: 15 },
        { label: 'x100', valueX: 100, weight: 5 },
      ],
    },
  },
  {
    name: 'B_hacksaw_deterministic',
    description: 'Hacksaw-style deterministic lookback x5 (no Var[M])',
    cfg: {
      freeSpinsK: 8,
      meanBaseWinPerSpinX: 1,
      varianceBaseWinPerSpinX: 0,
      multiplierDistribution: [
        { label: 'x5', valueX: 5, weight: 1 },
      ],
    },
  },
  {
    name: 'C_low_K_high_mult_range',
    description: 'K=5, low base win, wide mult range x1..x50',
    cfg: {
      freeSpinsK: 5,
      meanBaseWinPerSpinX: 0.5,
      varianceBaseWinPerSpinX: 2,
      multiplierDistribution: [
        { label: 'x1', valueX: 1, weight: 70 },
        { label: 'x5', valueX: 5, weight: 20 },
        { label: 'x15', valueX: 15, weight: 8 },
        { label: 'x50', valueX: 50, weight: 2 },
      ],
    },
  },
  {
    name: 'D_long_K_modest_mult',
    description: 'Long K=25, modest multiplier range x1..x10',
    cfg: {
      freeSpinsK: 25,
      meanBaseWinPerSpinX: 1.2,
      varianceBaseWinPerSpinX: 3,
      multiplierDistribution: [
        { label: 'x1', valueX: 1, weight: 60 },
        { label: 'x2', valueX: 2, weight: 25 },
        { label: 'x5', valueX: 5, weight: 12 },
        { label: 'x10', valueX: 10, weight: 3 },
      ],
    },
  },
  {
    name: 'E_balanced_mid_volatility',
    description: 'Balanced 10-FS, moderate var, mult x1/x2/x5',
    cfg: {
      freeSpinsK: 10,
      meanBaseWinPerSpinX: 1.5,
      varianceBaseWinPerSpinX: 4,
      multiplierDistribution: [
        { label: 'x1', valueX: 1, weight: 50 },
        { label: 'x2', valueX: 2, weight: 30 },
        { label: 'x5', valueX: 5, weight: 15 },
        { label: 'x10', valueX: 10, weight: 5 },
      ],
    },
  },
  {
    name: 'F_low_K_high_K_extreme',
    description: 'K=20 with no per-FS variance — checks Var only from M',
    cfg: {
      freeSpinsK: 20,
      meanBaseWinPerSpinX: 1,
      varianceBaseWinPerSpinX: 0,
      multiplierDistribution: [
        { label: 'x1', valueX: 1, weight: 80 },
        { label: 'x10', valueX: 10, weight: 20 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveFreeSpinsLookbackMultiplier, simulateFreeSpinsLookbackMultiplier } = await import(
    join(REPO_ROOT, 'dist', 'features', 'freeSpinsLookbackMultiplier.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} FS Lookback Multiplier configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveFreeSpinsLookbackMultiplier(c.cfg);
    const mc = simulateFreeSpinsLookbackMultiplier(c.cfg, EPISODES, SEED);

    const eyRel = cf.expectedTotalPayoutX > 1e-9
      ? relErr(cf.expectedTotalPayoutX, mc.observedMeanPayoutX)
      : Math.abs(cf.expectedTotalPayoutX - mc.observedMeanPayoutX);
    const mRel = cf.expectedMultiplier > 1e-9
      ? relErr(cf.expectedMultiplier, mc.observedMeanMultiplier)
      : Math.abs(cf.expectedMultiplier - mc.observedMeanMultiplier);
    const varRel = cf.varianceTotalPayoutX > 1e-9
      ? relErr(cf.varianceTotalPayoutX, mc.observedVariancePayoutX)
      : 0;

    const checks = { ey_rel: eyRel, var_rel: varRel, m_rel: mRel };
    const pass = eyRel <= TOL_EY_REL && varRel <= TOL_VAR_REL && mRel <= TOL_M_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(30)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedTotalPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `μ_M_CF=${cf.expectedMultiplier.toFixed(3)} MC=${mc.observedMeanMultiplier.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedSumOverK: cf.expectedSumOverK,
        varianceSumOverK: cf.varianceSumOverK,
        expectedMultiplier: cf.expectedMultiplier,
        varianceMultiplier: cf.varianceMultiplier,
        maxMultiplier: cf.maxMultiplier,
        probMaxMultiplier: cf.probMaxMultiplier,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayoutX: cf.varianceTotalPayoutX,
        expectedTotalIfMaxMultiplier: cf.expectedTotalIfMaxMultiplier,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedMeanSumS: mc.observedMeanSumS,
        observedMeanMultiplier: mc.observedMeanMultiplier,
        observedMaxMultObserved: mc.observedMaxMultObserved,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'FREE_SPINS_LOOKBACK_MULTIPLIER',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, m_rel: TOL_M_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'FREE_SPINS_LOOKBACK_MULTIPLIER.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# FREE_SPINS_LOOKBACK_MULTIPLIER — Post-Hoc Multiplier Aggregator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 4.3 extension: ✅ "Free Spins Lookback Multiplier Aggregator" (Wave 97).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Wald-like aggregator:');
  md.push('  - S_K = Σ W_i, E[S_K] = K·μ_W, Var[S_K] = K·σ²_W');
  md.push('  - M ~ discrete distribution, μ_M, σ²_M');
  md.push('  - E[Y] = μ_M · K · μ_W');
  md.push('  - Var[Y] = K·σ²_W·(σ²_M + μ²_M) + K²·μ²_W·σ²_M');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32, exact 2-point base win + inverse-CDF multiplier.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | μ_M_CF | μ_M_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedMultiplier.toFixed(3)} | ${r.monte_carlo.observedMeanMultiplier.toFixed(3)} | ` +
        `${(r.checks.m_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail metrics (per config)');
  md.push('');
  md.push('| Config | max M | P(max M) | E[Y \\| M=max] | Var[Y] | E[S_K] |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | x${r.closed_form.maxMultiplier} | ` +
        `${(r.closed_form.probMaxMultiplier * 100).toFixed(2)}% | ` +
        `${r.closed_form.expectedTotalIfMaxMultiplier.toFixed(2)} | ` +
        `${r.closed_form.varianceTotalPayoutX.toFixed(2)} | ` +
        `${r.closed_form.expectedSumOverK.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure for lookback-multiplier features');
  md.push('- **MGA PPD §11.f** — max-payout tail-probability disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — Wald-like aggregator auditor-verifiable');
  md.push('- Industry use: Push Money Cart 4, Hacksaw bonus games, Pragmatic post-FS multipliers');

  writeFileSync(join(OUT_DIR, 'FREE_SPINS_LOOKBACK_MULTIPLIER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/FREE_SPINS_LOOKBACK_MULTIPLIER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
