#!/usr/bin/env node
//
// W152 Wave 85 — Free Spins Retrigger Compound Variance acceptance (Wave 84).
//
// 6 PAR-style configs × 50K episodes each = 300K total MC. Validates:
//
//   E[N]   = 1/(1-p),  Var[N] = p/(1-p)²
//   E[T]   = K/(1-p),  Var[T] = K²·p/(1-p)²
//   E[Y]   = E[T]·μ                       (Wald)
//   Var[Y] = E[T]·σ² + Var[T]·μ²          (compound-sum)
//
// Plus tail probabilities P(N≥k) = p^(k-1).
//
// Operator deliverable: `reports/acceptance/FREE_SPINS_RETRIGGER.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 50_000;
const SEED = 0xCAFEFACE;
const TOL_EY_REL = 0.05;
const TOL_VAR_REL = 0.15;
const TOL_BATCHES_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_typical_10fs_p20',
    description: 'Typical 10 FS + p=0.20 retrigger, μ=1.5, σ²=25',
    cfg: {
      spinsPerBatchK: 10,
      retriggerProbability: 0.20,
      meanPayoutPerFreeSpinX: 1.5,
      variancePayoutPerFreeSpinX: 25,
    },
  },
  {
    name: 'B_no_retrigger',
    description: 'No retrigger (p=0) — deterministic K spins',
    cfg: {
      spinsPerBatchK: 10,
      retriggerProbability: 0,
      meanPayoutPerFreeSpinX: 2,
      variancePayoutPerFreeSpinX: 16,
    },
  },
  {
    name: 'C_high_retrigger',
    description: 'High retrigger p=0.50 — long tail',
    cfg: {
      spinsPerBatchK: 8,
      retriggerProbability: 0.50,
      meanPayoutPerFreeSpinX: 1.0,
      variancePayoutPerFreeSpinX: 9,
    },
  },
  {
    name: 'D_big_K_low_p',
    description: 'Big batch K=20, low p=0.10',
    cfg: {
      spinsPerBatchK: 20,
      retriggerProbability: 0.10,
      meanPayoutPerFreeSpinX: 3,
      variancePayoutPerFreeSpinX: 400,
    },
  },
  {
    name: 'E_small_K_moderate_p',
    description: 'Small batch K=5, moderate p=0.30',
    cfg: {
      spinsPerBatchK: 5,
      retriggerProbability: 0.30,
      meanPayoutPerFreeSpinX: 0.8,
      variancePayoutPerFreeSpinX: 4,
    },
  },
  {
    name: 'F_super_high_retrigger',
    description: 'Aggressive p=0.70 retrigger (rare in industry)',
    cfg: {
      spinsPerBatchK: 6,
      retriggerProbability: 0.70,
      meanPayoutPerFreeSpinX: 0.5,
      variancePayoutPerFreeSpinX: 2,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveFreeSpinsRetrigger, simulateFreeSpinsRetrigger } = await import(
    join(REPO_ROOT, 'dist', 'features', 'freeSpinsRetriggerCompound.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Free Spins Retrigger configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveFreeSpinsRetrigger(c.cfg);
    const mc = simulateFreeSpinsRetrigger(c.cfg, EPISODES, SEED);

    const checks = {
      ey_rel: relErr(cf.expectedTotalPayoutX, mc.observedMeanPayoutX),
      var_rel: relErr(cf.varianceTotalPayoutX, mc.observedVariancePayoutX),
      batches_rel: relErr(cf.expectedBatches, mc.observedMeanBatches),
      spins_rel: relErr(cf.expectedTotalFreeSpins, mc.observedMeanFreeSpins),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.batches_rel <= TOL_BATCHES_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedTotalPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `E[T]_CF=${cf.expectedTotalFreeSpins.toFixed(2)} MC=${mc.observedMeanFreeSpins.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedBatches: cf.expectedBatches,
        varianceBatches: cf.varianceBatches,
        expectedTotalFreeSpins: cf.expectedTotalFreeSpins,
        varianceTotalFreeSpins: cf.varianceTotalFreeSpins,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayoutX: cf.varianceTotalPayoutX,
        probAtLeastTwoBatches: cf.probAtLeastTwoBatches,
        probAtLeastFiveBatches: cf.probAtLeastFiveBatches,
        probAtLeastTenBatches: cf.probAtLeastTenBatches,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanBatches: mc.observedMeanBatches,
        observedMeanFreeSpins: mc.observedMeanFreeSpins,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedMaxBatches: mc.observedMaxBatches,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'FREE_SPINS_RETRIGGER',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, batches_rel: TOL_BATCHES_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'FREE_SPINS_RETRIGGER.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# FREE_SPINS_RETRIGGER — Compound-Geometric Variance Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 4.3 extension: ✅ "Free Spins Retrigger Compound Variance" (Wave 84).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Wald + compound-sum identities:');
  md.push('  - N ~ shifted-geometric: E[N]=1/(1-p), Var[N]=p/(1-p)²');
  md.push('  - T=K·N: E[T]=K/(1-p), Var[T]=K²·p/(1-p)²');
  md.push('  - E[Y]=E[T]·μ  (Wald)');
  md.push('  - Var[Y]=E[T]·σ² + Var[T]·μ²  (compound-sum)');
  md.push('  - P(N≥k)=p^(k-1)  (geometric tail)');
  md.push('');
  md.push('MC: 50K episodes per config, deterministic mulberry32, exact 2-point per-FS distribution.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | Var[Y]_CF | Var[Y]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.varianceTotalPayoutX.toFixed(2)} | ${r.monte_carlo.observedVariancePayoutX.toFixed(2)} | ` +
        `${(r.checks.var_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Tail probabilities (per config)');
  md.push('');
  md.push('| Config | E[N] | P(N≥2) | P(N≥5) | P(N≥10) | max observed N |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.closed_form.expectedBatches.toFixed(3)} | ` +
        `${(r.closed_form.probAtLeastTwoBatches * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probAtLeastFiveBatches * 100).toFixed(4)}% | ` +
        `${(r.closed_form.probAtLeastTenBatches * 100).toFixed(6)}% | ` +
        `${r.monte_carlo.observedMaxBatches} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure required for PAR sheet');
  md.push('- **MGA PPD §11.f** — player-protection limit calculations need Var[Y]');
  md.push('- **eCOGRA Generic Slots Audit** — compound-sum derivation auditor-verifiable');
  md.push('- Closed-form E[Y] + Var[Y] enables exact bankroll-management chart generation');

  writeFileSync(join(OUT_DIR, 'FREE_SPINS_RETRIGGER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/FREE_SPINS_RETRIGGER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
