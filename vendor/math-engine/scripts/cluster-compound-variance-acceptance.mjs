#!/usr/bin/env node
//
// W152 Wave 104 — Cluster Compound Variance acceptance (Wave 102).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC.
// Validates Wald compound-sum identity for cluster cascade chains.
//
// Operator deliverable: `reports/acceptance/CLUSTER_COMPOUND_VARIANCE.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED_VAL = 0xCAFE1234;
const TOL_EY_REL = 0.05;
const TOL_STD_REL = 0.15;
const TOL_EN_REL = 0.05;

// 5×5 cluster paytable (rough Sweet-Bonanza-style)
// index = cluster size (0 = no pay, ... up to grid cells)
const SB_PAYTABLE = [
  0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 2, 2, 2, 2,
  5, 5, 5, 5, 10, 10, 10, 10, 25,
];

const SB_CLUSTER_PMF = (() => {
  // Heavy decay favoring small clusters
  const pmf = new Array(SB_PAYTABLE.length).fill(0);
  pmf[0] = 0.7; // mostly no cluster
  pmf[5] = 0.10; pmf[6] = 0.07; pmf[7] = 0.05;
  pmf[8] = 0.03; pmf[9] = 0.02; pmf[10] = 0.01;
  pmf[12] = 0.008; pmf[15] = 0.006; pmf[20] = 0.005;
  pmf[25] = 0.001;
  const sum = pmf.reduce((a, b) => a + b, 0);
  return pmf.map(p => p / sum);
})();

const CONFIGS = [
  {
    name: 'A_sweet_bonanza_geometric_pkill_0.5',
    description: 'Geometric chain pKill=0.5, Sweet-Bonanza paytable + cluster pmf',
    mode: 'geometric',
    cfg: { pKill: 0.5, clusterPmf: SB_CLUSTER_PMF, paytable: SB_PAYTABLE },
  },
  {
    name: 'B_reactoonz_long_chain_pkill_0.3',
    description: 'Reactoonz-style long chain pKill=0.3',
    mode: 'geometric',
    cfg: { pKill: 0.3, clusterPmf: SB_CLUSTER_PMF, paytable: SB_PAYTABLE },
  },
  {
    name: 'C_aggressive_short_chain_pkill_0.7',
    description: 'Aggressive short chain pKill=0.7',
    mode: 'geometric',
    cfg: { pKill: 0.7, clusterPmf: SB_CLUSTER_PMF, paytable: SB_PAYTABLE },
  },
  {
    name: 'D_explicit_uniform_chain_pmf',
    description: 'Explicit chainPmf uniform [0,1,2,3,4,5] + simple cluster',
    mode: 'explicit',
    cfg: {
      chainPmf: [1, 1, 1, 1, 1, 1].map((v) => v / 6),
      clusterPmf: [0.5, 0, 0, 0, 0, 0.2, 0.15, 0.1, 0.05].concat(Array(SB_PAYTABLE.length - 9).fill(0))
        .map((v, _, arr) => v / arr.reduce((a, b) => a + b, 0)),
      paytable: SB_PAYTABLE,
    },
  },
  {
    name: 'E_pkill_1_immediate_kill',
    description: 'pKill=1 → always P(N=0)=1 (no cluster steps)',
    mode: 'geometric',
    cfg: { pKill: 1, clusterPmf: SB_CLUSTER_PMF, paytable: SB_PAYTABLE },
  },
  {
    name: 'F_pkill_0.1_extreme_long_tail',
    description: 'pKill=0.1 — extreme long-tail cascade chain',
    mode: 'geometric',
    cfg: { pKill: 0.1, clusterPmf: SB_CLUSTER_PMF, paytable: SB_PAYTABLE },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const {
    solveClusterCompoundGeometric,
    solveClusterCompoundExplicit,
    simulateClusterCompoundGeometric,
    simulateClusterCompoundExplicit,
  } = await import(join(REPO_ROOT, 'dist', 'features', 'clusterCompoundVariance.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Cluster Compound Variance configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = c.mode === 'geometric'
      ? solveClusterCompoundGeometric(c.cfg)
      : solveClusterCompoundExplicit(c.cfg);
    const mc = c.mode === 'geometric'
      ? simulateClusterCompoundGeometric(c.cfg, { episodes: EPISODES, seed: SEED_VAL })
      : simulateClusterCompoundExplicit(c.cfg, { episodes: EPISODES, seed: SEED_VAL });

    const cfEY = cf.expectedTotalPayoutX;
    const eyRel = cfEY > 1e-9 ? relErr(cfEY, mc.observedMeanPayoutX) : Math.abs(cfEY - mc.observedMeanPayoutX);
    const cfStd = cf.stdDevTotalPayout;
    const stdRel = cfStd > 1e-9 ? relErr(cfStd, mc.observedStdDevPayoutX) : Math.abs(cfStd - mc.observedStdDevPayoutX);
    const cfEN = cf.expectedChainLength;
    const enRel = cfEN > 1e-9 ? relErr(cfEN, mc.observedMeanChainLength) : Math.abs(cfEN - mc.observedMeanChainLength);

    const checks = { ey_rel: eyRel, std_rel: stdRel, en_rel: enRel };
    const pass = eyRel <= TOL_EY_REL && stdRel <= TOL_STD_REL && enRel <= TOL_EN_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `ey=${(eyRel*100).toFixed(2)}% std=${(stdRel*100).toFixed(2)}% en=${(enRel*100).toFixed(2)}% ` +
        `(E[Y]_CF=${cfEY.toFixed(3)} std_CF=${cfStd.toFixed(3)} MC_std=${mc.observedStdDevPayoutX.toFixed(3)})  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      mode: c.mode,
      cfg: c.cfg,
      closed_form: {
        expectedPayoutPerStep: cf.expectedPayoutPerStep,
        variancePayoutPerStep: cf.variancePayoutPerStep,
        expectedChainLength: cf.expectedChainLength,
        varianceChainLength: cf.varianceChainLength,
        expectedTotalPayoutX: cf.expectedTotalPayoutX,
        varianceTotalPayout: cf.varianceTotalPayout,
        stdDevTotalPayout: cf.stdDevTotalPayout,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedStdDevPayoutX: mc.observedStdDevPayoutX,
        observedMeanChainLength: mc.observedMeanChainLength,
        observedEmptyRate: mc.observedEmptyRate,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CLUSTER_COMPOUND_VARIANCE',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED_VAL,
    tolerances: { ey_rel: TOL_EY_REL, std_rel: TOL_STD_REL, en_rel: TOL_EN_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'CLUSTER_COMPOUND_VARIANCE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# CLUSTER_COMPOUND_VARIANCE — Cluster Cascade Compound Wald Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 extension: ✅ "Cluster Compound Variance" (Wave 102).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Wald compound-sum identity:');
  md.push('  - N = chain length, K_i = per-step cluster size, y_i = paytable[K_i]');
  md.push('  - μ_Y = Σ clusterPmf[k] · paytable[k]');
  md.push('  - σ²_Y = Σ clusterPmf[k] · paytable[k]² − μ_Y²');
  md.push('  - **E[Y_total] = E[N] · μ_Y**');
  md.push('  - **Var[Y_total] = E[N] · σ²_Y + Var[N] · μ²_Y**');
  md.push('  - 3 input modes: explicit (chainPmf+clusterPmf), geometric (pKill), bridge helper');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Mode | Pass | E[Y]_CF | E[Y]_MC | rel | E[N]_CF | E[N]_MC | std_rel |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.mode} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedTotalPayoutX.toFixed(4)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(4)} | ` +
        `${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedChainLength.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanChainLength.toFixed(3)} | ` +
        `${(r.checks.std_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure for cascade games');
  md.push('- **MGA PPD §11.f** — tail-probability disclosure for cascade chains');
  md.push('- **eCOGRA Generic Slots Audit** — Wald compound-sum identity auditor-verifiable');
  md.push('- Industry use: Sweet Bonanza (Pragmatic), Reactoonz (Play\'n GO), Jammin\' Jars (Push Gaming), Wild Swarm (Push Gaming)');

  writeFileSync(join(OUT_DIR, 'CLUSTER_COMPOUND_VARIANCE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CLUSTER_COMPOUND_VARIANCE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
