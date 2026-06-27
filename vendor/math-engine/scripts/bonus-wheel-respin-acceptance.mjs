#!/usr/bin/env node
//
// W152 Wave 106 — Bonus Wheel + Respin acceptance (Wave 105).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/BONUS_WHEEL_RESPIN.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED_VAL = 0xDEADC0DE;
const TOL_EV_REL = 0.05;
const TOL_VAR_REL = 0.20;
const TOL_EN_REL = 0.03;

const CONFIGS = [
  {
    name: 'A_netent_4tier_p30_respin',
    description: 'Vendor D-style 4-tier wheel + 30% respin (mini/minor/major/grand)',
    cfg: {
      paySegments: [
        { label: 'mini',  probability: 0.30, payoutX: 5 },
        { label: 'minor', probability: 0.25, payoutX: 25 },
        { label: 'major', probability: 0.10, payoutX: 100 },
        { label: 'grand', probability: 0.05, payoutX: 1000 },
      ],
      respinProbability: 0.30,
    },
  },
  {
    name: 'B_pragmatic_low_respin',
    description: 'Pragmatic-style low respin p=0.10 + tiered payouts',
    cfg: {
      paySegments: [
        { label: 'small',  probability: 0.50, payoutX: 2 },
        { label: 'mid',    probability: 0.25, payoutX: 10 },
        { label: 'big',    probability: 0.10, payoutX: 50 },
        { label: 'mega',   probability: 0.05, payoutX: 500 },
      ],
      respinProbability: 0.10,
    },
  },
  {
    name: 'C_high_respin_60pct',
    description: 'Aggressive 60% respin wheel — long chains expected',
    cfg: {
      paySegments: [
        { label: 'win10',  probability: 0.30, payoutX: 10 },
        { label: 'win100', probability: 0.10, payoutX: 100 },
      ],
      respinProbability: 0.60,
    },
  },
  {
    name: 'D_p_respin_0_no_loop',
    description: 'No respin p=0 — single-spin deterministic terminate',
    cfg: {
      paySegments: [
        { label: 'a', probability: 0.50, payoutX: 5 },
        { label: 'b', probability: 0.30, payoutX: 20 },
        { label: 'c', probability: 0.20, payoutX: 100 },
      ],
      respinProbability: 0,
    },
  },
  {
    name: 'E_balanced_5tier_p25',
    description: 'Balanced 5-tier with 25% respin',
    cfg: {
      paySegments: [
        { label: 'cash_1',  probability: 0.25, payoutX: 1 },
        { label: 'cash_5',  probability: 0.20, payoutX: 5 },
        { label: 'cash_25', probability: 0.15, payoutX: 25 },
        { label: 'cash_100', probability: 0.10, payoutX: 100 },
        { label: 'cash_500', probability: 0.05, payoutX: 500 },
      ],
      respinProbability: 0.25,
    },
  },
  {
    name: 'F_extreme_long_tail_p75',
    description: 'Extreme p=0.75 respin — very long expected chains',
    cfg: {
      paySegments: [
        { label: 'small', probability: 0.20, payoutX: 5 },
        { label: 'mega',  probability: 0.05, payoutX: 1000 },
      ],
      respinProbability: 0.75,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveBonusWheelRespin, simulateBonusWheelRespin } = await import(
    join(REPO_ROOT, 'dist', 'features', 'bonusWheelRespin.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bonus Wheel + Respin configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveBonusWheelRespin(c.cfg);
    const mc = simulateBonusWheelRespin(c.cfg, EPISODES, SEED_VAL);

    const evRel = cf.expectedFinalPayoutX > 1e-9
      ? relErr(cf.expectedFinalPayoutX, mc.observedMeanFinalPayoutX)
      : Math.abs(cf.expectedFinalPayoutX - mc.observedMeanFinalPayoutX);
    const varRel = cf.varianceFinalPayoutX > 1e-9
      ? relErr(cf.varianceFinalPayoutX, mc.observedVarianceFinalPayoutX)
      : 0;
    const enRel = relErr(cf.expectedSpinsUntilTerminate, mc.observedMeanSpins);

    const checks = { ev_rel: evRel, var_rel: varRel, en_rel: enRel };
    const pass = evRel <= TOL_EV_REL && varRel <= TOL_VAR_REL && enRel <= TOL_EN_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `E[V]_CF=${cf.expectedFinalPayoutX.toFixed(3)} MC=${mc.observedMeanFinalPayoutX.toFixed(3)}  ` +
        `E[N]_CF=${cf.expectedSpinsUntilTerminate.toFixed(3)} MC=${mc.observedMeanSpins.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedSpinsUntilTerminate: cf.expectedSpinsUntilTerminate,
        varianceSpinsUntilTerminate: cf.varianceSpinsUntilTerminate,
        expectedFinalPayoutX: cf.expectedFinalPayoutX,
        varianceFinalPayoutX: cf.varianceFinalPayoutX,
        probAtLeastTwoSpins: cf.probAtLeastTwoSpins,
        probAtLeastFiveSpins: cf.probAtLeastFiveSpins,
        probAtLeastTenSpins: cf.probAtLeastTenSpins,
        maxPayoutX: cf.maxPayoutX,
        probHitMax: cf.probHitMax,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanSpins: mc.observedMeanSpins,
        observedMeanFinalPayoutX: mc.observedMeanFinalPayoutX,
        observedVarianceFinalPayoutX: mc.observedVarianceFinalPayoutX,
        observedMaxSpinsObserved: mc.observedMaxSpinsObserved,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BONUS_WHEEL_RESPIN',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED_VAL,
    tolerances: { ev_rel: TOL_EV_REL, var_rel: TOL_VAR_REL, en_rel: TOL_EN_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BONUS_WHEEL_RESPIN.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BONUS_WHEEL_RESPIN — Wheel + Respin Markov Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 4.6 extension: ✅ "Bonus Wheel + Respin Markov" (Wave 105).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form shifted-geometric + conditional segment distribution:');
  md.push('  - N ~ shifted-geometric: E[N]=1/(1-p_respin), Var[N]=p_respin/(1-p_respin)²');
  md.push('  - Conditional payout V (given terminate):');
  md.push('    - P(V=v_i) = p_i / (1-p_respin)');
  md.push('    - μ_V = Σ p_i·v_i / (1-p_respin)');
  md.push('    - σ²_V = E[V²] − μ²_V');
  md.push('  - Tail: P(N≥k) = p_respin^(k-1)');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32 PRNG.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[V]_CF | E[V]_MC | rel | E[N]_CF | E[N]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedFinalPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanFinalPayoutX.toFixed(3)} | ` +
        `${(r.checks.ev_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedSpinsUntilTerminate.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanSpins.toFixed(3)} | ` +
        `${(r.checks.en_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail metrics (per config)');
  md.push('');
  md.push('| Config | max V | P(hit max) | P(N≥2) | P(N≥5) | P(N≥10) |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.closed_form.maxPayoutX} | ` +
        `${(r.closed_form.probHitMax * 100).toFixed(3)}% | ` +
        `${(r.closed_form.probAtLeastTwoSpins * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probAtLeastFiveSpins * 100).toFixed(4)}% | ` +
        `${(r.closed_form.probAtLeastTenSpins * 100).toFixed(6)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure for wheel features');
  md.push('- **MGA PPD §11.f** — max-payout tail-probability disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — shifted-geometric chain auditor-verifiable');
  md.push('- Industry use: Vendor D wheel bonuses, Pragmatic Money Wheel, Vendor A Wheel of Fortune');

  writeFileSync(join(OUT_DIR, 'BONUS_WHEEL_RESPIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BONUS_WHEEL_RESPIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
