#!/usr/bin/env node
//
// W152 Wave 103 — Symbol Upgrade Chain Markov acceptance (Wave 101).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/SYMBOL_UPGRADE_CHAIN.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xC0DE7E5C;
const TOL_EY_REL = 0.03;
const TOL_VAR_REL = 0.15;
const TOL_DIST_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_pragmatic_6tier_K20',
    description: 'Pragmatic 6-tier ladder, K=20 FS, p=0.15 advance',
    cfg: {
      freeSpinsK: 20,
      advanceProbabilityPerSpin: 0.15,
      payoutValuesPerState: [1, 3, 10, 25, 75, 250],
    },
  },
  {
    name: 'B_btg_aggressive_3tier_K8',
    description: 'BTG aggressive 3-tier ladder, K=8 FS, p=0.4',
    cfg: {
      freeSpinsK: 8,
      advanceProbabilityPerSpin: 0.4,
      payoutValuesPerState: [1, 5, 50],
    },
  },
  {
    name: 'C_high_p_short_K',
    description: 'High p=0.6 + short K=5, easily reach top tier',
    cfg: {
      freeSpinsK: 5,
      advanceProbabilityPerSpin: 0.6,
      payoutValuesPerState: [1, 4, 20, 100],
    },
  },
  {
    name: 'D_long_K_low_p',
    description: 'Long K=30, low p=0.1, rare top tier',
    cfg: {
      freeSpinsK: 30,
      advanceProbabilityPerSpin: 0.1,
      payoutValuesPerState: [1, 2, 5, 10, 50, 200, 1000],
    },
  },
  {
    name: 'E_p0_corner',
    description: 'p=0 deterministic stay at base, P(F=0)=1',
    cfg: {
      freeSpinsK: 10,
      advanceProbabilityPerSpin: 0,
      payoutValuesPerState: [1, 5, 25],
    },
  },
  {
    name: 'F_p1_full_advance',
    description: 'p=1 deterministic reach top (K=10 ≥ L=4)',
    cfg: {
      freeSpinsK: 10,
      advanceProbabilityPerSpin: 1,
      payoutValuesPerState: [1, 5, 25, 100, 500],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveSymbolUpgradeChain, simulateSymbolUpgradeChain } = await import(
    join(REPO_ROOT, 'dist', 'features', 'symbolUpgradeChainMarkov.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Symbol Upgrade Chain configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveSymbolUpgradeChain(c.cfg);
    const mc = simulateSymbolUpgradeChain(c.cfg, EPISODES, SEED);

    const eyRel = cf.expectedPayoutX > 1e-9
      ? relErr(cf.expectedPayoutX, mc.observedMeanPayoutX)
      : Math.abs(cf.expectedPayoutX - mc.observedMeanPayoutX);
    const varRel = cf.variancePayoutX > 1e-9
      ? relErr(cf.variancePayoutX, mc.observedVariancePayoutX)
      : 0;
    // Max relative distribution error (only states with > 1% theoretical prob)
    let maxDistErr = 0;
    for (let i = 0; i < cf.finalStateDistribution.length; i++) {
      if (cf.finalStateDistribution[i] > 0.01) {
        const r = Math.abs(cf.finalStateDistribution[i] - mc.observedStateHistogram[i]) /
          cf.finalStateDistribution[i];
        if (r > maxDistErr) maxDistErr = r;
      }
    }

    const checks = { ey_rel: eyRel, var_rel: varRel, max_dist_rel: maxDistErr };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.max_dist_rel <= TOL_DIST_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `P(top)_CF=${cf.probReachTopState.toFixed(4)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedAdvances: cf.expectedAdvances,
        varianceAdvances: cf.varianceAdvances,
        finalStateDistribution: cf.finalStateDistribution,
        expectedPayoutX: cf.expectedPayoutX,
        variancePayoutX: cf.variancePayoutX,
        probReachTopState: cf.probReachTopState,
        probStayAtBase: cf.probStayAtBase,
        probReachHalfway: cf.probReachHalfway,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedStateHistogram: mc.observedStateHistogram,
        observedMaxState: mc.observedMaxState,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SYMBOL_UPGRADE_CHAIN',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, max_dist_rel: TOL_DIST_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'SYMBOL_UPGRADE_CHAIN.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# SYMBOL_UPGRADE_CHAIN — Markov Ladder Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 extension: ✅ "Symbol Upgrade Chain Markov" (Wave 101).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Markov-chain solver:');
  md.push('  - A ~ Binomial(K, p): E[A]=K·p, Var[A]=K·p·(1-p)');
  md.push('  - F = min(A, L) (final state, clipped at top)');
  md.push('  - P(F=i) = C(K,i)·p^i·(1-p)^(K-i) for i < L');
  md.push('  - P(F=L) = 1 − Σ_{i<L} P(F=i)');
  md.push('  - E[Y] = Σ P(F=i)·v_i, Var[Y] = Σ P(F=i)·v_i² − E[Y]²');
  md.push('  - Tail: P(reach top), P(stay at base), P(reach halfway)');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32, per-spin Bernoulli advance.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | P(top) | P(base) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${(r.closed_form.probReachTopState * 100).toFixed(3)}% | ` +
        `${(r.closed_form.probStayAtBase * 100).toFixed(3)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure required for ladder/upgrade features');
  md.push('- **MGA PPD §11.f** — tail-probability disclosure (P(reach top) per session)');
  md.push('- **eCOGRA Generic Slots Audit** — closed-form Markov chain auditor-verifiable');
  md.push('- Industry use: Pragmatic upgrade FS, BTG Megaways tier ladders, Push Gaming Quantum');

  writeFileSync(join(OUT_DIR, 'SYMBOL_UPGRADE_CHAIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/SYMBOL_UPGRADE_CHAIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
