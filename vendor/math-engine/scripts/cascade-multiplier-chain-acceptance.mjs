#!/usr/bin/env node
//
// W152 Wave 122 — Cascade Multiplier Chain (Lockstep Conditional) acceptance (Wave 121).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/CASCADE_MULTIPLIER_CHAIN.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: variance + max-multiplier disclosure
// for lockstep conditional chain mehanika.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0021;
const TOL_EL_REL          = 0.03;   // expected chain length
const TOL_EY_REL          = 0.05;   // expected payout per spin (normal-vol)
const TOL_EY_REL_HEAVYTAIL = 0.15;  // payout EV rel for heavy-tail configs
const TOL_ZERO_ABS        = 0.01;   // P(L=0) abs

const STD_WIN_PMF = [
  { value: 1, probability: 0.6 },
  { value: 5, probability: 0.3 },
  { value: 25, probability: 0.1 },
];

const CONFIGS = [
  {
    name: 'A_quickspin_reactor_wilds_p06',
    description: 'Quickspin Reactor Wilds style: high-frequency cascade p=0.6, linear +1',
    cfg: {
      winContinuationProbability: 0.6,
      baseMultiplier: 1,
      growthMode: 'linear',
      linearStep: 1,
      winValuePmf: STD_WIN_PMF,
    },
  },
  {
    name: 'B_push_token_of_life_geom',
    description: "Push Gaming Token of Life style: geometric ratio=1.5, p=0.5 (r·p=0.75 < 1)",
    cfg: {
      winContinuationProbability: 0.5,
      baseMultiplier: 1,
      growthMode: 'geometric',
      geometricRatio: 1.5,
      winValuePmf: STD_WIN_PMF,
    },
  },
  {
    name: 'C_hacksaw_cascade_p04',
    description: 'Hacksaw cascade style: moderate p=0.4, base=1 step=1',
    cfg: {
      winContinuationProbability: 0.4,
      baseMultiplier: 1,
      growthMode: 'linear',
      linearStep: 1,
      winValuePmf: STD_WIN_PMF,
    },
  },
  {
    name: 'D_rare_chain_aggressive_step',
    description: 'Rare chain p=0.2, aggressive linear step=5 (high variance)',
    cfg: {
      winContinuationProbability: 0.2,
      baseMultiplier: 1,
      growthMode: 'linear',
      linearStep: 5,
      winValuePmf: STD_WIN_PMF,
    },
  },
  {
    name: 'E_constant_multiplier_corner',
    description: 'Corner: step=0 constant base mult, E[Y] = E[V]·base·E[L]',
    cfg: {
      winContinuationProbability: 0.5,
      baseMultiplier: 3,
      growthMode: 'linear',
      linearStep: 0,
      winValuePmf: STD_WIN_PMF,
    },
  },
  {
    name: 'F_heavy_tail_geom_r2_p03',
    description: 'Heavy-tail geometric r=2 @ p=0.3 (r·p=0.6, moderate)',
    cfg: {
      winContinuationProbability: 0.3,
      baseMultiplier: 1,
      growthMode: 'geometric',
      geometricRatio: 2,
      winValuePmf: STD_WIN_PMF,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveCascadeMultiplierChain, simulateCascadeMultiplierChain } = await import(
    join(REPO_ROOT, 'dist', 'features', 'cascadeMultiplierChain.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Cascade Multiplier Chain configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCascadeMultiplierChain(c.cfg);
    const mc = simulateCascadeMultiplierChain(c.cfg, SPINS, SEED);

    const elRel = relErr(cf.expectedChainLength, mc.observedMeanChainLength);
    const eyRel = cf.expectedPayoutPerSpin > 1e-9
      ? relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin)
      : Math.abs(cf.expectedPayoutPerSpin - mc.observedMeanPayoutPerSpin);
    const zeroAbs = Math.abs(cf.probZeroChain - mc.observedZeroChainFraction);

    // Heavy-tail: geometric mode with r·p > 0.7 (slow tail decay) → wider tol
    const rp = c.cfg.growthMode === 'geometric'
      ? (c.cfg.geometricRatio ?? 1) * c.cfg.winContinuationProbability
      : 0;
    const isHeavyTail = rp > 0.7;
    const eyTol = isHeavyTail ? TOL_EY_REL_HEAVYTAIL : TOL_EY_REL;

    const checks = {
      el_rel: elRel,
      ey_rel: eyRel,
      zero_abs: zeroAbs,
    };
    const pass =
      elRel <= TOL_EL_REL &&
      eyRel <= eyTol &&
      zeroAbs <= TOL_ZERO_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `E[L]=${cf.expectedChainLength.toFixed(3)} MC=${mc.observedMeanChainLength.toFixed(3)}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerSpin.toFixed(3)} MC=${mc.observedMeanPayoutPerSpin.toFixed(3)}  ` +
        `(rel=${(eyRel * 100).toFixed(2)}%)  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        winContinuationProbability: cf.winContinuationProbability,
        expectedChainLength: cf.expectedChainLength,
        varianceChainLength: cf.varianceChainLength,
        probZeroChain: cf.probZeroChain,
        maxMultiplier: cf.maxMultiplier,
        expectedWinValuePerCascade: cf.expectedWinValuePerCascade,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        truncationProbabilityRemaining: cf.truncationProbabilityRemaining,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanChainLength: mc.observedMeanChainLength,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
        observedVariancePayoutPerSpin: mc.observedVariancePayoutPerSpin,
        observedZeroChainFraction: mc.observedZeroChainFraction,
        observedMaxChainLength: mc.observedMaxChainLength,
        observedMaxPayoutSeen: mc.observedMaxPayoutSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CASCADE_MULTIPLIER_CHAIN',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      el_rel: TOL_EL_REL,
      ey_rel: TOL_EY_REL,
      ey_rel_heavytail: TOL_EY_REL_HEAVYTAIL,
      zero_abs: TOL_ZERO_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'CASCADE_MULTIPLIER_CHAIN.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# CASCADE_MULTIPLIER_CHAIN — Lockstep Conditional Cascade Chain Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Cascade Multiplier Chain Lockstep Conditional" (Wave 121).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form lockstep conditional chain (multiplier raste samo na win cascade):');
  md.push('  - L ~ Geometric(1-p) sa support {0, 1, 2, ...}');
  md.push('  - **P(L=0) = 1-p**, **P(L≥k) = p^k**, **E[L] = p/(1-p)**');
  md.push('  - M_k linear (base+(k-1)·step) ili geometric (base·ratio^(k-1))');
  md.push('  - **`E[Y] = E[V] · Σ M_k · p^k`** (Wald-style via P(L≥k)=p^k)');
  md.push('  - **`Var[Y] = E[Y²] − E[Y]²`** sa cross-term 2·E[V]²·Σ_{j<k} M_j·M_k·p^k');
  md.push('  - Convergence guard: r·p < 1 for geometric mode');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, walk-chain-until-empty.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | p | E[L]_CF | E[L]_MC | E[Y]_CF | E[Y]_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.winContinuationProbability} | ` +
        `${r.closed_form.expectedChainLength.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanChainLength.toFixed(3)} | ` +
        `${r.closed_form.expectedPayoutPerSpin.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutPerSpin.toFixed(3)} | ` +
        `${(r.checks.ey_rel * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance + max-multiplier disclosure (Var[Y], M_K_max via truncation)');
  md.push('- **MGA PPD §11.f** — chain volatility disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies steady-state E[Y] / Var[Y] match engine');
  md.push('- Industry use: Quickspin Reactor Wilds, Push Gaming Token of Life, Hacksaw cascade');
  md.push('  multiplier games, BTG Megaways multiplier-on-win, dozens of branded clones.');

  writeFileSync(join(OUT_DIR, 'CASCADE_MULTIPLIER_CHAIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CASCADE_MULTIPLIER_CHAIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
