#!/usr/bin/env node
//
// W152 Wave 94 — Multiplicative Wild Stack acceptance (Wave 93).
//
// 6 PAR-style configs × 100K episodes = 600K total MC.
//
// Operator deliverable: `reports/acceptance/MULTIPLICATIVE_WILD_STACK.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xFADECAFE;
const TOL_EY_REL = 0.10;
const TOL_VAR_REL = 0.40;
const TOL_W_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_netent_hotline_style',
    description: 'Vendor D-Hotline 5x reels, rare q=0.1, fixed x2 wilds',
    cfg: {
      reelsR: 5,
      wildLandingProbabilityPerReel: 0.10,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 1 },
      ],
      meanBaseWinX: 0.5,
      varianceBaseWinX: 1,
    },
  },
  {
    name: 'B_classic_5reel_multi_tier',
    description: '5 reels, q=0.2, multi-tier x2/x3/x5/x10 distribution',
    cfg: {
      reelsR: 5,
      wildLandingProbabilityPerReel: 0.20,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 60 },
        { label: 'x3', valueX: 3, weight: 25 },
        { label: 'x5', valueX: 5, weight: 12 },
        { label: 'x10', valueX: 10, weight: 3 },
      ],
      meanBaseWinX: 1.0,
      varianceBaseWinX: 2.0,
    },
  },
  {
    name: 'C_high_density_low_mult',
    description: 'High q=0.6, simple x2 wilds — moderate stacking',
    cfg: {
      reelsR: 5,
      wildLandingProbabilityPerReel: 0.6,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 1 },
      ],
      meanBaseWinX: 0.5,
      varianceBaseWinX: 1,
    },
  },
  {
    name: 'D_moderate_5reel_balanced',
    description: '5 reels, q=0.25, balanced x2/x3/x5 — moderate variance regime',
    cfg: {
      reelsR: 5,
      wildLandingProbabilityPerReel: 0.25,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 50 },
        { label: 'x3', valueX: 3, weight: 30 },
        { label: 'x5', valueX: 5, weight: 20 },
      ],
      meanBaseWinX: 0.5,
      varianceBaseWinX: 1,
    },
  },
  {
    name: 'E_p1_guaranteed',
    description: 'p=1 (guaranteed wilds every reel) — deterministic mult product',
    cfg: {
      reelsR: 3,
      wildLandingProbabilityPerReel: 1,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 1 },
      ],
      meanBaseWinX: 1,
      varianceBaseWinX: 1,
    },
  },
  {
    name: 'F_p0_no_wilds',
    description: 'p=0 corner — no wilds, Y = B (baseline)',
    cfg: {
      reelsR: 5,
      wildLandingProbabilityPerReel: 0,
      multiplierDistribution: [
        { label: 'x2', valueX: 2, weight: 1 },
      ],
      meanBaseWinX: 1,
      varianceBaseWinX: 1,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMultiplicativeWildStack, simulateMultiplicativeWildStack } = await import(
    join(REPO_ROOT, 'dist', 'features', 'multiplicativeWildStack.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Multiplicative Wild Stack configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMultiplicativeWildStack(c.cfg);
    const mc = simulateMultiplicativeWildStack(c.cfg, EPISODES, SEED);

    const eyRel = cf.expectedTotalPayoutX > 1e-9
      ? relErr(cf.expectedTotalPayoutX, mc.observedMeanPayoutX)
      : Math.abs(cf.expectedTotalPayoutX - mc.observedMeanPayoutX);
    const wRel = cf.expectedCombinedMultiplier > 1e-9
      ? relErr(cf.expectedCombinedMultiplier, mc.observedMeanCombinedMultiplier)
      : Math.abs(cf.expectedCombinedMultiplier - mc.observedMeanCombinedMultiplier);
    const varRel = cf.varianceTotalPayoutX > 1e-9
      ? relErr(cf.varianceTotalPayoutX, mc.observedVariancePayoutX)
      : 0;

    const checks = {
      ey_rel: eyRel,
      var_rel: varRel,
      w_rel: wRel,
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.w_rel <= TOL_W_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(30)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedTotalPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `E[W]_CF=${cf.expectedCombinedMultiplier.toFixed(3)} MC=${mc.observedMeanCombinedMultiplier.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedActiveWilds: cf.expectedActiveWilds,
        expectedMultiplierPerStack: cf.expectedMultiplierPerStack,
        expectedCombinedMultiplier: cf.expectedCombinedMultiplier,
        expectedCombinedMultiplierSquared: cf.expectedCombinedMultiplierSquared,
        varianceCombinedMultiplier: cf.varianceCombinedMultiplier,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayoutX: cf.varianceTotalPayoutX,
        probAllWilds: cf.probAllWilds,
        probZeroWilds: cf.probZeroWilds,
        maxCombinedMultiplier: cf.maxCombinedMultiplier,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanWilds: mc.observedMeanWilds,
        observedMeanCombinedMultiplier: mc.observedMeanCombinedMultiplier,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedMaxObservedMult: mc.observedMaxObservedMult,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MULTIPLICATIVE_WILD_STACK',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, w_rel: TOL_W_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MULTIPLICATIVE_WILD_STACK.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MULTIPLICATIVE_WILD_STACK — Product Wild Multiplier Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 4.5 extension: ✅ "Multiplicative Wild Stack Bonus" (Wave 93).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form via per-reel Bernoulli + product moment formula:');
  md.push('  - N ~ Binomial(R, p): E[N]=R·p, Var[N]=R·p·(1-p)');
  md.push('  - E[W] = (p·μ_M + 1-p)^R (interchange product)');
  md.push('  - E[W²] = (p·E[M²] + 1-p)^R');
  md.push('  - E[Y] = μ_B · E[W], Var[Y] = (σ²_B + μ²_B)·E[W²] − E[Y]²');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32, inverse-CDF mult sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | E[W]_CF | E[W]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedCombinedMultiplier.toFixed(3)} | ${r.monte_carlo.observedMeanCombinedMultiplier.toFixed(3)} | ` +
        `${(r.checks.w_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail metrics (per config)');
  md.push('');
  md.push('| Config | E[wilds] | P(zero) | P(all) | Var[W] | max combined |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.closed_form.expectedActiveWilds.toFixed(2)} | ` +
        `${(r.closed_form.probZeroWilds * 100).toFixed(4)}% | ` +
        `${(r.closed_form.probAllWilds * 100).toFixed(6)}% | ` +
        `${r.closed_form.varianceCombinedMultiplier.toFixed(3)} | ` +
        `${r.closed_form.maxCombinedMultiplier.toExponential(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure for multiplicative-wild features');
  md.push('- **MGA PPD §11.f** — max-payout tail-probability disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — closed-form product moment auditor-verifiable');
  md.push('- Industry use: Vendor D Hotline, Push Wanted Dead or a Wild, Hacksaw Multiplier Mayhem');

  writeFileSync(join(OUT_DIR, 'MULTIPLICATIVE_WILD_STACK.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MULTIPLICATIVE_WILD_STACK.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
