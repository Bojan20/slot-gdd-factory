#!/usr/bin/env node
// W152 Wave 194 — Arcade-Shooter Survival Level Progression acceptance (75. solver, Vendor B M16 P1).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const RUNS = 100_000;
const SEED = 0xCAFE0194;

const TOL_PAYOUT_REL = 0.10;
const TOL_COMPLETE_ABS = 0.01;
const TOL_LEVEL_REACHED_REL = 0.03;
const TOL_TIER_PROB_ABS = 0.04;

const CONFIGS = [
  {
    name: "A_stellar_jackpots_6_level_4_tier",
    description: "Vendor B Lightning Box Stellar Jackpots wrapper (defining) — 6-level arcade-shooter sa 4-tier jackpot (mini/minor/major/grand).",
    cfg: {
      levels: [
        { label: 'l1', probPass: 0.80, reward: 2 },
        { label: 'l2', probPass: 0.70, reward: 4 },
        { label: 'l3', probPass: 0.60, reward: 8 },
        { label: 'l4', probPass: 0.50, reward: 16 },
        { label: 'l5', probPass: 0.40, reward: 32 },
        { label: 'l6', probPass: 0.30, reward: 64 },
      ],
      jackpotTiers: [
        { label: 'mini',  selectionWeight: 60, meanPayout: 50,    variancePayout: 100 },
        { label: 'minor', selectionWeight: 30, meanPayout: 200,   variancePayout: 400 },
        { label: 'major', selectionWeight: 9,  meanPayout: 1000,  variancePayout: 2500 },
        { label: 'grand', selectionWeight: 1,  meanPayout: 10000, variancePayout: 1000000 },
      ],
    },
  },
  {
    name: "B_thundering_bison_4_level_escalation",
    description: "Vendor B Lightning Box Thundering Bison sa Stellar Jackpots — 4-level shorter survival chain.",
    cfg: {
      levels: [
        { label: 'bison_l1', probPass: 0.85, reward: 1 },
        { label: 'bison_l2', probPass: 0.70, reward: 3 },
        { label: 'bison_l3', probPass: 0.50, reward: 10 },
        { label: 'bison_l4', probPass: 0.30, reward: 30 },
      ],
      jackpotTiers: [
        { label: 'major', selectionWeight: 95, meanPayout: 500,  variancePayout: 1000 },
        { label: 'grand', selectionWeight: 5,  meanPayout: 5000, variancePayout: 50000 },
      ],
    },
  },
  {
    name: "C_chicken_fox_high_freq_short_chain",
    description: "Vendor B Lightning Box Chicken Fox — 3-level high-frequency arcade-shooter.",
    cfg: {
      levels: [
        { label: 'fox_l1', probPass: 0.90, reward: 5 },
        { label: 'fox_l2', probPass: 0.75, reward: 15 },
        { label: 'fox_l3', probPass: 0.50, reward: 50 },
      ],
      jackpotTiers: [
        { label: 'mini',  selectionWeight: 80, meanPayout: 100,  variancePayout: 200 },
        { label: 'major', selectionWeight: 20, meanPayout: 2000, variancePayout: 10000 },
      ],
    },
  },
  {
    name: "D_lightning_horseman_8_level_long_chain",
    description: "Vendor B Lightning Box Lightning Horseman — 8-level extended survival sa flat decay.",
    cfg: {
      levels: [
        { probPass: 0.85, reward: 1 },
        { probPass: 0.80, reward: 2 },
        { probPass: 0.75, reward: 4 },
        { probPass: 0.70, reward: 8 },
        { probPass: 0.65, reward: 16 },
        { probPass: 0.55, reward: 32 },
        { probPass: 0.45, reward: 64 },
        { probPass: 0.30, reward: 128 },
      ],
      jackpotTiers: [
        { label: 'grand', selectionWeight: 1, meanPayout: 25000, variancePayout: 500000 },
      ],
    },
  },
  {
    name: "E_corner_single_level_binary",
    description: "Corner: single-level binary (minimum L=1).",
    cfg: {
      levels: [{ probPass: 0.4, reward: 10 }],
      jackpotTiers: [{ selectionWeight: 1, meanPayout: 100, variancePayout: 50 }],
    },
  },
  {
    name: "F_corner_all_pass_1_complete_certain",
    description: "Corner: all p=0.95 high-pass, complete near-certain (audit boundary).",
    cfg: {
      levels: [
        { probPass: 0.95, reward: 3 },
        { probPass: 0.95, reward: 6 },
        { probPass: 0.95, reward: 12 },
      ],
      jackpotTiers: [
        { label: 'fixed', selectionWeight: 1, meanPayout: 50, variancePayout: 25 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeArcadeShooterSurvivalLevels, simulateArcadeShooterSurvivalLevels } =
    await import(join(REPO_ROOT, 'dist', 'features', 'arcadeShooterSurvivalLevels.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Arcade-Shooter Survival configs @ ${RUNS} MC runs each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeArcadeShooterSurvivalLevels(c.cfg);
    const mc = simulateArcadeShooterSurvivalLevels(c.cfg, RUNS, SEED);

    const payoutRel = relErr(cf.expectedPayoutPerRun, mc.meanPayoutPerRun);
    const completeAbs = Math.abs(cf.probabilityCompleteRun - mc.observedCompleteRate);
    const levelReachedRel = relErr(cf.expectedLevelReached, mc.observedExpectedLevelReached);
    let maxTierAbs = 0;
    for (let k = 0; k < cf.numJackpotTiers; k++) {
      maxTierAbs = Math.max(maxTierAbs, Math.abs(cf.perJackpotTier[k].selectionProbWithinComplete - mc.observedJackpotTierFreqs[k]));
    }

    const checks = {
      payout_rel: payoutRel,
      complete_abs: completeAbs,
      level_reached_rel: levelReachedRel,
      max_tier_prob_abs: maxTierAbs,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      completeAbs <= TOL_COMPLETE_ABS &&
      levelReachedRel <= TOL_LEVEL_REACHED_REL &&
      maxTierAbs <= TOL_TIER_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `L=${cf.numLevels} K=${cf.numJackpotTiers}  ` +
        `E[Y]=${cf.expectedPayoutPerRun.toFixed(2)}/${mc.meanPayoutPerRun.toFixed(2)}  ` +
        `P(complete)=${(cf.probabilityCompleteRun*100).toFixed(2)}%/${(mc.observedCompleteRate*100).toFixed(2)}%  ` +
        `E[lv]=${cf.expectedLevelReached.toFixed(2)}/${mc.observedExpectedLevelReached.toFixed(2)}  ` +
        `JP_share=${(cf.jackpotShareOfRtp*100).toFixed(1)}% 1-in-N_complete=${cf.oneInNRunsToComplete.toFixed(1)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name, description: c.description, cfg: c.cfg, closed_form: cf,
      monte_carlo: { ...mc, runs: RUNS }, checks, pass, elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'ARCADE_SHOOTER_SURVIVAL_LEVELS',
    generated_utc: new Date().toISOString(), runs_per_config: RUNS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, complete_abs: TOL_COMPLETE_ABS, level_reached_rel: TOL_LEVEL_REACHED_REL, tier_prob_abs: TOL_TIER_PROB_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'ARCADE_SHOOTER_SURVIVAL_LEVELS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# ARCADE_SHOOTER_SURVIVAL_LEVELS — Arcade-Shooter Survival Level Progression Aggregator Acceptance (W194, 75. solver, Vendor B M16 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${RUNS} MC runs each.`);
  md.push('');
  md.push('Closes Vendor B M16 P1 GAP — Lightning Box Stellar Jackpots wrapper (Thundering Bison + Chicken Fox + Lightning Horseman + 4+ Astro family).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Sequential survival Markov chain sa absorbing failure state + per-level reward + terminal jackpot mixture:');
  md.push('  - **S_k = ∏_{i<k} p_i** survival probability (chain rule)');
  md.push('  - **P(exit at k) = S_k · (1−p_k)** early-exit Bernoulli');
  md.push('  - **P(complete) = S_{L+1} = ∏ p_i**');
  md.push('  - **E[Y per run] = Σ S_{k+1}·V_k + S_{L+1}·μ_J**');
  md.push('  - **Var[Y]** via correlated-Bernoulli E[Y²] + jackpot mixture variance');
  md.push('  - perLevel.expectedRewardContribution = S_{k+1}·V_k');
  md.push('  - perJackpotTier.probabilityHitThisTier = S_{L+1}·π_k');
  md.push('  - oneInNRunsToComplete = 1/S_{L+1}');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | L / K | E[Y] CF/MC | P(complete) CF/MC | E[lv] CF/MC | JP share | 1-in-N complete |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.numLevels}/${r.closed_form.numJackpotTiers} | ${r.closed_form.expectedPayoutPerRun.toFixed(2)}/${r.monte_carlo.meanPayoutPerRun.toFixed(2)} | ${(r.closed_form.probabilityCompleteRun*100).toFixed(2)}%/${(r.monte_carlo.observedCompleteRate*100).toFixed(2)}% | ${r.closed_form.expectedLevelReached.toFixed(2)}/${r.monte_carlo.observedExpectedLevelReached.toFixed(2)} | ${(r.closed_form.jackpotShareOfRtp*100).toFixed(1)}% | ${r.closed_form.oneInNRunsToComplete.toFixed(1)} |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-14 mandatory per-stage probability / MGA PPD §11 sequential-stage / eCOGRA per-stage audit / EU GA 2024.');
  md.push('');
  md.push("Industry: Vendor B Lightning Box Stellar Jackpots wrapper + Thundering Bison/Buffalo/Gorilla + Chicken Fox + Lightning Horseman + 4+ Astro family.");
  writeFileSync(join(OUT_DIR, 'ARCADE_SHOOTER_SURVIVAL_LEVELS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
