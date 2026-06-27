#!/usr/bin/env node
//
// W152 Wave 49 — Hold & Win N-tier Ladder Jackpot Acceptance.
//
// Closes Faza 5 ⚠️ "Money-symbol H&W + multi-tier jackpot ladder — coins+tier
// kombinovan" (generic 2-tier ✅; full N-tier ladder coverage was ❌).
//
// Procedure:
//   1. Six synthetic ladder configs covering parameter envelope:
//      A. Classic 4-tier (reset on land, p=0.15, R0=3) — baseline
//      B. No-reset variant — sensitivity check
//      C. High-p variant (p=0.30) — frequent landings
//      D. Long-respin variant (R0=8) — endurance
//      E. Big grid (5×7=35) with 3 tiers
//      F. Hi-vol coin distribution (Pareto-like)
//
//   2. For each config: closed-form solve via `solveLadderJackpot` +
//      Monte Carlo via `simulateLadderJackpot` at 250K spins, seed=12345.
//
//   3. Verify MC vs closed-form within tolerances:
//      - expectedTotalX:        rel ≤ 2.0%
//      - expectedCashValueX:    rel ≤ 2.0%
//      - expectedTierPayoutX:   rel ≤ 5.0%  (tier payouts are higher-variance)
//      - per-tier probability:  abs ≤ 0.005 (0.5 percentage points)
//      - expectedFilled:        rel ≤ 1.0%
//
// Output: reports/acceptance/HNW_LADDER.{json,md}

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 250_000;
const SEED = 12345;
const TOL_TOTAL_REL = 0.02;
const TOL_CASH_REL = 0.02;
const TOL_TIER_REL = 0.05;
const TOL_TIER_PROB_ABS = 0.005;
const TOL_FILLED_REL = 0.01;

const baseCoinDist = [
  { valueX: 1, weight: 6 },
  { valueX: 2, weight: 4 },
  { valueX: 5, weight: 2 },
  { valueX: 10, weight: 1 },
];

const heavyTailCoinDist = [
  { valueX: 1, weight: 50 },
  { valueX: 2, weight: 20 },
  { valueX: 5, weight: 8 },
  { valueX: 10, weight: 3 },
  { valueX: 25, weight: 1 },
  { valueX: 100, weight: 0.2 },
];

const fourTier = [
  { id: 'MINI', threshold: 12, payoutX: 25 },
  { id: 'MINOR', threshold: 15, payoutX: 100 },
  { id: 'MAJOR', threshold: 18, payoutX: 500 },
  { id: 'GRAND', threshold: 20, payoutX: 2000 },
];

const CONFIGS = [
  {
    name: 'A_classic_reset_p015_r3',
    description: '5×4 grid, 4 tiers, reset on land, p=0.15, R0=3 (baseline)',
    config: {
      gridSize: 20,
      initialRespins: 3,
      pLand: 0.15,
      initialFilled: 6,
      cashValueDistribution: baseCoinDist,
      tiers: fourTier,
      resetOnLanding: true,
    },
  },
  {
    name: 'B_no_reset_p015_r5',
    description: '5×4 grid, 4 tiers, NO reset on land, p=0.15, R0=5',
    config: {
      gridSize: 20,
      initialRespins: 5,
      pLand: 0.15,
      initialFilled: 6,
      cashValueDistribution: baseCoinDist,
      tiers: fourTier,
      resetOnLanding: false,
    },
  },
  {
    name: 'C_high_p030',
    description: '5×4 grid, 4 tiers, reset, p=0.30, R0=3 (frequent landings)',
    config: {
      gridSize: 20,
      initialRespins: 3,
      pLand: 0.3,
      initialFilled: 6,
      cashValueDistribution: baseCoinDist,
      tiers: fourTier,
      resetOnLanding: true,
    },
  },
  {
    name: 'D_long_respin_r8',
    description: '5×4 grid, 4 tiers, reset, p=0.10, R0=8 (endurance)',
    config: {
      gridSize: 20,
      initialRespins: 8,
      pLand: 0.1,
      initialFilled: 6,
      cashValueDistribution: baseCoinDist,
      tiers: fourTier,
      resetOnLanding: true,
    },
  },
  {
    name: 'E_big_grid_5x7',
    description: '5×7=35 grid, 3 tiers, reset, p=0.10, R0=3',
    config: {
      gridSize: 35,
      initialRespins: 3,
      pLand: 0.1,
      initialFilled: 8,
      cashValueDistribution: baseCoinDist,
      tiers: [
        { id: 'A', threshold: 18, payoutX: 50 },
        { id: 'B', threshold: 26, payoutX: 250 },
        { id: 'C', threshold: 35, payoutX: 1500 },
      ],
      resetOnLanding: true,
    },
  },
  {
    name: 'F_heavy_tail_coin',
    description: '5×4 grid, 4 tiers, reset, p=0.15, R0=3, Pareto-like coin dist',
    config: {
      gridSize: 20,
      initialRespins: 3,
      pLand: 0.15,
      initialFilled: 6,
      cashValueDistribution: heavyTailCoinDist,
      tiers: fourTier,
      resetOnLanding: true,
    },
  },
];

function relErr(a, b) {
  const denom = Math.max(Math.abs(a), 1e-9);
  return Math.abs(a - b) / denom;
}

async function main() {
  const { solveLadderJackpot, simulateLadderJackpot } = await import(
    join(REPO_ROOT, 'dist', 'jackpot', 'ladderJackpot.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} ladder configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const cfg of CONFIGS) {
    const t0 = Date.now();
    const cf = solveLadderJackpot(cfg.config);
    const mc = simulateLadderJackpot(cfg.config, SPINS, SEED);
    const elapsedMs = Date.now() - t0;

    const checks = {
      total_ev_rel: relErr(cf.expectedTotalX, mc.expectedTotalX),
      cash_ev_rel: relErr(cf.expectedCashValueX, mc.expectedCashValueX),
      tier_ev_rel: relErr(cf.expectedTierPayoutX, mc.expectedTierPayoutX),
      filled_rel: relErr(cf.expectedFilled, mc.expectedFilled),
    };

    const tierChecks = [];
    let tierProbMaxAbs = 0;
    for (const t of cf.tierProbabilities) {
      const mcP = mc.tierProbabilities[t.id] ?? 0;
      const absErr = Math.abs(t.probability - mcP);
      if (absErr > tierProbMaxAbs) tierProbMaxAbs = absErr;
      tierChecks.push({
        id: t.id,
        threshold: t.threshold,
        cf_prob: t.probability,
        mc_prob: mcP,
        abs_err: absErr,
      });
    }
    checks.tier_prob_max_abs = tierProbMaxAbs;

    const pass =
      checks.total_ev_rel <= TOL_TOTAL_REL &&
      checks.cash_ev_rel <= TOL_CASH_REL &&
      checks.tier_ev_rel <= TOL_TIER_REL &&
      checks.filled_rel <= TOL_FILLED_REL &&
      checks.tier_prob_max_abs <= TOL_TIER_PROB_ABS;

    if (!pass) allOK = false;

    console.log(
      `  ${cfg.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `total=${cf.expectedTotalX.toFixed(3)} cash=${cf.expectedCashValueX.toFixed(3)} ` +
        `tier=${cf.expectedTierPayoutX.toFixed(3)} filled=${cf.expectedFilled.toFixed(2)} ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: cfg.name,
      description: cfg.description,
      config: cfg.config,
      closed_form: {
        expectedTotalX: cf.expectedTotalX,
        expectedCashValueX: cf.expectedCashValueX,
        expectedTierPayoutX: cf.expectedTierPayoutX,
        expectedFilled: cf.expectedFilled,
        expectedRespins: cf.expectedRespins,
        tierProbabilities: cf.tierProbabilities,
        filledTerminationPmf: cf.filledTerminationPmf,
      },
      monte_carlo: {
        expectedTotalX: mc.expectedTotalX,
        expectedCashValueX: mc.expectedCashValueX,
        expectedTierPayoutX: mc.expectedTierPayoutX,
        expectedFilled: mc.expectedFilled,
        expectedRespins: mc.expectedRespins,
        tierProbabilities: mc.tierProbabilities,
        spins: SPINS,
      },
      checks,
      tier_checks: tierChecks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'HNW_LADDER',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      total_ev_rel: TOL_TOTAL_REL,
      cash_ev_rel: TOL_CASH_REL,
      tier_ev_rel: TOL_TIER_REL,
      filled_rel: TOL_FILLED_REL,
      tier_prob_abs: TOL_TIER_PROB_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'HNW_LADDER.json'), JSON.stringify(summary, null, 2));

  // ── Markdown report ──────────────────────────────────────────────────────
  const md = [];
  md.push('# HNW_LADDER — N-tier Hold & Win Ladder Jackpot Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Faza 5 sales-blocker: ⚠️→✅ "Money-symbol H&W + multi-tier jackpot ladder".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form solver `solveLadderJackpot` propagates probability + expected cash through');
  md.push('state graph `(respins, filled)` in topological order. Each config is verified against a');
  md.push('Monte Carlo reference (`simulateLadderJackpot`) at 250K spins, seed=12345.');
  md.push('');
  md.push('## Tolerances');
  md.push('');
  md.push('| Metric | Tolerance |');
  md.push('|---|---|');
  md.push(`| expectedTotalX | rel ≤ ${(TOL_TOTAL_REL * 100).toFixed(1)}% |`);
  md.push(`| expectedCashValueX | rel ≤ ${(TOL_CASH_REL * 100).toFixed(1)}% |`);
  md.push(`| expectedTierPayoutX | rel ≤ ${(TOL_TIER_REL * 100).toFixed(1)}% |`);
  md.push(`| expectedFilled | rel ≤ ${(TOL_FILLED_REL * 100).toFixed(1)}% |`);
  md.push(`| per-tier probability | abs ≤ ${TOL_TIER_PROB_ABS} |`);
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF EV (X) | MC EV (X) | rel err | filled (CF) | tier-prob max abs |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedTotalX.toFixed(3)} | ` +
        `${r.monte_carlo.expectedTotalX.toFixed(3)} | ${(r.checks.total_ev_rel * 100).toFixed(2)}% | ` +
        `${r.closed_form.expectedFilled.toFixed(2)} | ${r.checks.tier_prob_max_abs.toFixed(4)} |`,
    );
  }
  md.push('');
  md.push('## Per-config tier probabilities (closed-form)');
  md.push('');
  for (const r of results) {
    md.push(`### ${r.name}`);
    md.push('');
    md.push(`_${r.description}_`);
    md.push('');
    md.push('| Tier | Threshold | P(final) | CF expectedTierPayoutX contribution |');
    md.push('|---|---|---|---|');
    for (const t of r.closed_form.tierProbabilities) {
      // Per-tier EV contribution requires knowing payoutX
      const tierCfg = r.config.tiers.find((x) => x.id === t.id);
      const ev = tierCfg ? tierCfg.payoutX * t.probability : 0;
      md.push(
        `| ${t.id} | ${t.threshold} | ${t.probability.toFixed(5)} | ${ev.toFixed(4)} |`,
      );
    }
    md.push('');
  }

  writeFileSync(join(OUT_DIR, 'HNW_LADDER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/HNW_LADDER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
