#!/usr/bin/env node
//
// W152 Wave 92 — Coin Accumulator + Mystery Values acceptance (Wave 91).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC. Validates:
//
//   E[N] = K·q,  Var[N] = K·q·(1-q)
//   μ_V, σ²_V from discrete mystery distribution
//   E[Y] = E[N]·μ_V (Wald)
//   Var[Y] = E[N]·σ²_V + Var[N]·μ²_V (compound-sum)
//   P(≥1 max-value coin) = 1 − (1 − q·p_max)^K (Bernoulli-Binomial nesting)
//
// Operator deliverable: `reports/acceptance/COIN_ACCUMULATOR_MYSTERY.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xC01DCAFE;
const TOL_EY_REL = 0.05;
const TOL_VAR_REL = 0.20;
const TOL_N_REL = 0.02;

const CONFIGS = [
  {
    name: 'A_money_train_classic',
    description: 'Money-Train classic: K=8, q=0.3, 5-tier mystery values',
    cfg: {
      freeSpinsK: 8,
      coinLandingProbabilityPerSpin: 0.30,
      coinValueOutcomes: [
        { label: 'small', valueX: 1,   weight: 60 },
        { label: 'mid',   valueX: 5,   weight: 25 },
        { label: 'big',   valueX: 20,  weight: 12 },
        { label: 'mini',  valueX: 50,  weight: 2 },
        { label: 'major', valueX: 500, weight: 1 },
      ],
    },
  },
  {
    name: 'B_high_density_low_value',
    description: 'High q=0.7, low value range — high RTP low variance',
    cfg: {
      freeSpinsK: 10,
      coinLandingProbabilityPerSpin: 0.7,
      coinValueOutcomes: [
        { label: 'a', valueX: 1, weight: 50 },
        { label: 'b', valueX: 2, weight: 30 },
        { label: 'c', valueX: 5, weight: 20 },
      ],
    },
  },
  {
    name: 'C_rare_grand_long_session',
    description: 'K=15, rare q=0.15, grand multi-tier with heavy tail',
    cfg: {
      freeSpinsK: 15,
      coinLandingProbabilityPerSpin: 0.15,
      coinValueOutcomes: [
        { label: 'small', valueX: 1,    weight: 70 },
        { label: 'mid',   valueX: 10,   weight: 20 },
        { label: 'big',   valueX: 100,  weight: 8 },
        { label: 'mega',  valueX: 1000, weight: 2 },
      ],
    },
  },
  {
    name: 'D_short_session_high_q',
    description: 'Short K=3, very high q=0.9 — guaranteed-ish coins',
    cfg: {
      freeSpinsK: 3,
      coinLandingProbabilityPerSpin: 0.9,
      coinValueOutcomes: [
        { label: 'x', valueX: 10, weight: 1 },
        { label: 'y', valueX: 50, weight: 1 },
      ],
    },
  },
  {
    name: 'E_q1_guaranteed',
    description: 'q=1 deterministic coin landing every spin',
    cfg: {
      freeSpinsK: 5,
      coinLandingProbabilityPerSpin: 1,
      coinValueOutcomes: [
        { label: 'a', valueX: 5,  weight: 60 },
        { label: 'b', valueX: 20, weight: 40 },
      ],
    },
  },
  {
    name: 'F_q0_no_coins',
    description: 'q=0 corner case — never lands, E[Y]=0',
    cfg: {
      freeSpinsK: 10,
      coinLandingProbabilityPerSpin: 0,
      coinValueOutcomes: [
        { label: 'x', valueX: 100, weight: 1 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveCoinAccumulatorMystery, simulateCoinAccumulatorMystery } = await import(
    join(REPO_ROOT, 'dist', 'features', 'coinAccumulatorMystery.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Coin Accumulator + Mystery configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCoinAccumulatorMystery(c.cfg);
    const mc = simulateCoinAccumulatorMystery(c.cfg, EPISODES, SEED);

    const eyRel = cf.expectedTotalPayoutX > 1e-9
      ? relErr(cf.expectedTotalPayoutX, mc.observedMeanPayoutX)
      : Math.abs(cf.expectedTotalPayoutX - mc.observedMeanPayoutX);
    const nRel = cf.expectedCoinsTotal > 1e-9
      ? relErr(cf.expectedCoinsTotal, mc.observedMeanCoins)
      : Math.abs(cf.expectedCoinsTotal - mc.observedMeanCoins);
    const varRel = cf.varianceTotalPayoutX > 1e-9
      ? relErr(cf.varianceTotalPayoutX, mc.observedVariancePayoutX)
      : 0;

    const checks = {
      ey_rel: eyRel,
      var_rel: varRel,
      n_rel: nRel,
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.n_rel <= TOL_N_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedTotalPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `E[N]_CF=${cf.expectedCoinsTotal.toFixed(2)} MC=${mc.observedMeanCoins.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedCoinsTotal: cf.expectedCoinsTotal,
        varianceCoinsTotal: cf.varianceCoinsTotal,
        expectedCoinValue: cf.expectedCoinValue,
        varianceCoinValue: cf.varianceCoinValue,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayoutX: cf.varianceTotalPayoutX,
        probZeroCoins: cf.probZeroCoins,
        probAllCoins: cf.probAllCoins,
        probAtLeastOneMaxValue: cf.probAtLeastOneMaxValue,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanCoins: mc.observedMeanCoins,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedMaxValueCount: mc.observedMaxValueCount,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'COIN_ACCUMULATOR_MYSTERY',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, n_rel: TOL_N_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'COIN_ACCUMULATOR_MYSTERY.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# COIN_ACCUMULATOR_MYSTERY — Money-Train-style Coin Collect Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 extension: ✅ "Coin Accumulator + Mystery Values" (Wave 91).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form via Binomial coin chain × discrete mystery distribution:');
  md.push('  - N ~ Binomial(K, q): E[N]=K·q, Var[N]=K·q·(1-q)');
  md.push('  - μ_V = Σ p_i·v_i, σ²_V = Σ p_i·v_i² − μ²_V');
  md.push('  - E[Y] = E[N]·μ_V (Wald)');
  md.push('  - Var[Y] = E[N]·σ²_V + Var[N]·μ²_V (compound-sum)');
  md.push('  - P(≥1 max-value coin) = 1 − (1 − q·p_max)^K (Bernoulli-Binomial nesting)');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32, inverse-CDF mystery sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | E[N]_CF | E[N]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedCoinsTotal.toFixed(2)} | ${r.monte_carlo.observedMeanCoins.toFixed(2)} | ` +
        `${(r.checks.n_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail metrics (per config)');
  md.push('');
  md.push('| Config | μ_V | σ²_V | P(zero) | P(all) | P(≥1 max) |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.closed_form.expectedCoinValue.toFixed(3)} | ` +
        `${r.closed_form.varianceCoinValue.toFixed(2)} | ` +
        `${(r.closed_form.probZeroCoins * 100).toFixed(4)}% | ` +
        `${(r.closed_form.probAllCoins * 100).toFixed(8)}% | ` +
        `${(r.closed_form.probAtLeastOneMaxValue * 100).toFixed(4)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure required for coin-collect features');
  md.push('- **MGA PPD §11.f** — tail-probability disclosure (P(max-value hit) per session)');
  md.push('- **eCOGRA Generic Slots Audit** — closed-form Bernoulli-Binomial nesting auditor-verifiable');
  md.push('- Industry use: Money Train (Relax), Money Cart (Relax), Wanted Dead or a Wild (Hacksaw)');

  writeFileSync(join(OUT_DIR, 'COIN_ACCUMULATOR_MYSTERY.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/COIN_ACCUMULATOR_MYSTERY.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
