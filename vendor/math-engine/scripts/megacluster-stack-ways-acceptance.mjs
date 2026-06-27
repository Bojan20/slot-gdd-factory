#!/usr/bin/env node
//
// W152 Wave 54 — Megacluster Stack-Reveal Ways acceptance.
//
// 6 synthetic configs × 1M MC spins each = 6M total. High variance regime
// (P(full match) is tiny but tail multipliers huge), so we use larger sample
// + relaxed tolerances.
//
// Tolerances:
//   E[Y]    rel ≤ 5.0% (high σ/μ ratio)
//   hitRate abs ≤ 0.005
//   E[K]    rel ≤ 1.0%

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 1_000_000;
const SEED = 12345;
const TOL_EY_REL = 0.05;
const TOL_HIT_ABS = 0.005;
const TOL_EK_REL = 0.01;

const baseStack = [
  { stackSize: 1, weight: 60 },
  { stackSize: 2, weight: 25 },
  { stackSize: 3, weight: 10 },
  { stackSize: 4, weight: 4 },
  { stackSize: 6, weight: 1 },
];

const heavyStack = [
  { stackSize: 1, weight: 30 },
  { stackSize: 2, weight: 30 },
  { stackSize: 3, weight: 20 },
  { stackSize: 4, weight: 12 },
  { stackSize: 6, weight: 6 },
  { stackSize: 8, weight: 2 },
];

const CONFIGS = [
  {
    name: 'A_6reel_classic',
    description: '6 reels, baseline stack, p=0.30, k_min=3',
    cfg: {
      numReels: 6,
      stackSizePmf: baseStack,
      pTargetPerReel: 0.30,
      paytableByMatches: [0, 0, 0, 1, 5, 25, 100],
    },
  },
  {
    name: 'B_6reel_heavy_stacks',
    description: '6 reels, heavy stacks (max=8), p=0.25, k_min=3',
    cfg: {
      numReels: 6,
      stackSizePmf: heavyStack,
      pTargetPerReel: 0.25,
      paytableByMatches: [0, 0, 0, 1, 5, 25, 100],
    },
  },
  {
    name: 'C_8reel_low_p',
    description: '8 reels, baseline stack, p=0.20 (rare full-match)',
    cfg: {
      numReels: 8,
      stackSizePmf: baseStack,
      pTargetPerReel: 0.20,
      paytableByMatches: [0, 0, 0, 1, 3, 10, 50, 200, 1000],
    },
  },
  {
    name: 'D_4reel_high_p',
    description: '4 reels, baseline stack, p=0.40 (frequent matches)',
    cfg: {
      numReels: 4,
      stackSizePmf: baseStack,
      pTargetPerReel: 0.40,
      paytableByMatches: [0, 0, 1, 5, 25],
    },
  },
  {
    name: 'E_capped_ways',
    description: '6 reels, baseline stack, p=0.30, maxWaysCap=20',
    cfg: {
      numReels: 6,
      stackSizePmf: baseStack,
      pTargetPerReel: 0.30,
      paytableByMatches: [0, 0, 0, 1, 5, 25, 100],
      maxWaysCap: 20,
    },
  },
  {
    name: 'F_full_match_bonus',
    description: '6 reels, baseline stack, p=0.30, bonusOnFullMatchX=5000',
    cfg: {
      numReels: 6,
      stackSizePmf: baseStack,
      pTargetPerReel: 0.30,
      paytableByMatches: [0, 0, 0, 1, 5, 25, 100],
      bonusOnFullMatchX: 5000,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMegaclusterStackWays, simulateMegaclusterStackWays } = await import(
    join(REPO_ROOT, 'dist', 'features', 'megaclusterStackWays.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} megacluster configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMegaclusterStackWays(c.cfg);
    const mc = simulateMegaclusterStackWays(c.cfg, SPINS, SEED);

    // CF E[K] is implicit: Σ k × P(K=k) = N × p
    const cfEK = c.cfg.numReels * c.cfg.pTargetPerReel;
    const checks = {
      ey_rel: relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayout),
      hit_abs: Math.abs(cf.hitRate - mc.observedHitRate),
      ek_rel: relErr(cfEK, mc.observedMeanK),
    };
    const pass =
      checks.ey_rel <= TOL_EY_REL &&
      checks.hit_abs <= TOL_HIT_ABS &&
      checks.ek_rel <= TOL_EK_REL;

    if (!pass) allOK = false;

    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]=${cf.expectedPayoutPerSpin.toFixed(4)} (MC=${mc.observedMeanPayout.toFixed(4)}, rel=${(checks.ey_rel*100).toFixed(2)}%)  ` +
        `hit=${cf.hitRate.toFixed(4)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedStackSize: cf.expectedStackSize,
        expectedStackSizeSquared: cf.expectedStackSizeSquared,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        stdDevPayoutPerSpin: cf.stdDevPayoutPerSpin,
        hitRate: cf.hitRate,
        probAnyPayout: cf.probAnyPayout,
        expectedMeanK: cfEK,
        matchCountPmf: cf.matchCountPmf,
        expectedWaysByK: cf.expectedWaysByK,
        expectedPayoutByK: cf.expectedPayoutByK,
      },
      monte_carlo: {
        observedMeanPayout: mc.observedMeanPayout,
        observedVariancePayout: mc.observedVariancePayout,
        observedStdDevPayout: mc.observedStdDevPayout,
        observedHitRate: mc.observedHitRate,
        observedMeanWays: mc.observedMeanWays,
        observedMeanK: mc.observedMeanK,
        spins: SPINS,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MEGACLUSTER_STACK_WAYS',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      ey_rel: TOL_EY_REL,
      hit_abs: TOL_HIT_ABS,
      ek_rel: TOL_EK_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'MEGACLUSTER_STACK_WAYS.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const md = [];
  md.push('# MEGACLUSTER_STACK_WAYS — Megacluster Stack-Reveal Ways Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Megacluster + reveal-stack-ways hybrid".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('N independent reels; per reel, stack size S_c ~ stackPmf (iid), lead symbol = TARGET wp p.');
  md.push('K = #target-matched reels ~ Binomial(N, p). Ways product W_k = Π_{c: matched} S_c, conditional on');
  md.push('k matches → E[W_k] = E[S]^k, E[W_k²] = E[S²]^k (independence). Payout Y = paytable(k) × W_k +');
  md.push('bonus×1[k=N]. E[Y] = Σ_k P(K=k)·(paytable(k)·E[S]^k + bonus·1[k=N]).');
  md.push('Var via E[Y²]−E[Y]² with similar k-sum decomposition. Optional ways-cap enumeration via DP over');
  md.push('joint stack products.');
  md.push('');
  md.push('## Tolerances');
  md.push('');
  md.push('| Metric | Tolerance |');
  md.push('|---|---|');
  md.push(`| E[Y] | rel ≤ ${(TOL_EY_REL * 100).toFixed(1)}% |`);
  md.push(`| hit rate | abs ≤ ${TOL_HIT_ABS} |`);
  md.push(`| E[K] | rel ≤ ${(TOL_EK_REL * 100).toFixed(1)}% |`);
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF E[Y] | MC E[Y] | rel | CF σ[Y] | hit rate | E[K] CF |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedPayoutPerSpin.toFixed(4)} | ` +
        `${r.monte_carlo.observedMeanPayout.toFixed(4)} | ${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.stdDevPayoutPerSpin.toFixed(2)} | ` +
        `${r.closed_form.hitRate.toFixed(5)} | ${r.closed_form.expectedMeanK.toFixed(2)} |`,
    );
  }
  md.push('');

  writeFileSync(join(OUT_DIR, 'MEGACLUSTER_STACK_WAYS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MEGACLUSTER_STACK_WAYS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
