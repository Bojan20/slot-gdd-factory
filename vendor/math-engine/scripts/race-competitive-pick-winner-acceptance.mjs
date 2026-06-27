#!/usr/bin/env node
// W152 Wave 192 — Race Competitive Pick Winner acceptance (73. solver, Vendor B M8 P1).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const RACES = 50_000;
const SEED = 0xCAFE0192;

const TOL_PAYOUT_REL = 0.08;
const TOL_PROB_ABS = 0.02;
const TOL_PICK_WIN_ABS = 0.015;

const CONFIGS = [
  {
    name: "A_goldfish_race_for_gold_4_fish",
    description: "Vendor B WMS Goldfish Race for the Gold (2017, defining title) — 4 fish race red/blue/yellow/gold sa pyramid prize structure.",
    cfg: {
      candidates: [
        { label: 'red',    weight: 4, basePrize: 5,   multiplierMean: 1, multiplierVariance: 0 },
        { label: 'blue',   weight: 3, basePrize: 10,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'yellow', weight: 2, basePrize: 25,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'gold',   weight: 1, basePrize: 100, multiplierMean: 1, multiplierVariance: 0 },
      ],
    },
  },
  {
    name: "B_big_bass_bucks_5_anglers_14_to_55",
    description: "Vendor B WMS Reel'em In Big Bass Bucks (2014) — 5-angler fishing contest sa 14×–55× per-angler multiplier.",
    cfg: {
      candidates: [
        { label: 'angler_1', weight: 5, basePrize: 1, multiplierMean: 14, multiplierVariance: 4 },
        { label: 'angler_2', weight: 4, basePrize: 1, multiplierMean: 20, multiplierVariance: 6 },
        { label: 'angler_3', weight: 3, basePrize: 1, multiplierMean: 30, multiplierVariance: 10 },
        { label: 'angler_4', weight: 2, basePrize: 1, multiplierMean: 40, multiplierVariance: 16 },
        { label: 'angler_5', weight: 1, basePrize: 1, multiplierMean: 55, multiplierVariance: 25 },
      ],
    },
  },
  {
    name: "C_competitive_pick_3_candidate_skewed",
    description: "3-candidate skewed race sa heavy-tail jackpot — gold dominantan EV za rational pick.",
    cfg: {
      candidates: [
        { label: 'common', weight: 10, basePrize: 2,   multiplierMean: 1, multiplierVariance: 0 },
        { label: 'rare',   weight: 3,  basePrize: 25,  multiplierMean: 1.5, multiplierVariance: 0.5 },
        { label: 'jackpot', weight: 1, basePrize: 200, multiplierMean: 2, multiplierVariance: 1 },
      ],
    },
  },
  {
    name: "D_symmetric_race_no_skill_premium",
    description: "Symmetric race sa equal weights+prizes — skill premium = 0 corner.",
    cfg: {
      candidates: [
        { label: 'c1', weight: 1, basePrize: 10, multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c2', weight: 1, basePrize: 10, multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c3', weight: 1, basePrize: 10, multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c4', weight: 1, basePrize: 10, multiplierMean: 1, multiplierVariance: 0 },
      ],
    },
  },
  {
    name: "E_corner_2_candidate_binary_race",
    description: "Corner: 2-candidate binary race — minimum N (degenerate).",
    cfg: {
      candidates: [
        { label: 'c0', weight: 7, basePrize: 1,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c1', weight: 3, basePrize: 5,  multiplierMean: 1, multiplierVariance: 0 },
      ],
    },
  },
  {
    name: "F_corner_8_candidate_long_field",
    description: "Corner: 8-candidate long field (broad portfolio) sa varied prize tiers.",
    cfg: {
      candidates: [
        { label: 'c1', weight: 8, basePrize: 1,   multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c2', weight: 6, basePrize: 3,   multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c3', weight: 5, basePrize: 6,   multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c4', weight: 4, basePrize: 12,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c5', weight: 3, basePrize: 25,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c6', weight: 2, basePrize: 50,  multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c7', weight: 1, basePrize: 150, multiplierMean: 1, multiplierVariance: 0 },
        { label: 'c8', weight: 1, basePrize: 400, multiplierMean: 1, multiplierVariance: 0 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeRaceCompetitivePickWinner, simulateRaceCompetitivePickWinner } =
    await import(join(REPO_ROOT, 'dist', 'features', 'raceCompetitivePickWinner.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Race-Competitive-Pick configs @ ${RACES} MC races each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeRaceCompetitivePickWinner(c.cfg);
    const mcRational = simulateRaceCompetitivePickWinner(c.cfg, RACES, 'rational_best', 0, SEED);
    const mcUniform = simulateRaceCompetitivePickWinner(c.cfg, RACES, 'uniform_random', 0, SEED ^ 0x1);

    const rationalPayoutRel = relErr(cf.bestPickExpectedReturn, mcRational.meanPayoutPerRace);
    const uniformPayoutRel = relErr(cf.uniformPickExpectedReturn, mcUniform.meanPayoutPerRace);
    const pickWinAbs = Math.abs(cf.probabilityBestPickWins - mcRational.observedPickWinRate);

    // Per-candidate prob disclosure check
    let maxProbAbs = 0;
    for (let i = 0; i < cf.numCandidates; i++) {
      maxProbAbs = Math.max(maxProbAbs, Math.abs(cf.perCandidate[i].probWin - mcRational.observedWinFrequencies[i]));
    }

    const checks = {
      rational_payout_rel: rationalPayoutRel,
      uniform_payout_rel: uniformPayoutRel,
      pick_win_abs: pickWinAbs,
      max_candidate_prob_abs: maxProbAbs,
    };
    const pass =
      rationalPayoutRel <= TOL_PAYOUT_REL &&
      uniformPayoutRel <= TOL_PAYOUT_REL &&
      pickWinAbs <= TOL_PICK_WIN_ABS &&
      maxProbAbs <= TOL_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    const bestLabel = cf.perCandidate[cf.bestPickIndex].label;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `N=${cf.numCandidates}  ` +
        `best=${bestLabel}(p=${(cf.probabilityBestPickWins*100).toFixed(1)}%) ER=${cf.bestPickExpectedReturn.toFixed(3)}/${mcRational.meanPayoutPerRace.toFixed(3)}  ` +
        `uniform=${cf.uniformPickExpectedReturn.toFixed(3)}/${mcUniform.meanPayoutPerRace.toFixed(3)}  ` +
        `skill+=${cf.skillPremiumVsUniform.toFixed(2)} uplift=${cf.commercialUpliftOverSymmetric.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name, description: c.description, cfg: c.cfg, closed_form: cf,
      monte_carlo: { rational: { ...mcRational, races: RACES }, uniform: { ...mcUniform, races: RACES } },
      checks, pass, elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'RACE_COMPETITIVE_PICK_WINNER',
    generated_utc: new Date().toISOString(), races_per_config: RACES, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, prob_abs: TOL_PROB_ABS, pick_win_abs: TOL_PICK_WIN_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'RACE_COMPETITIVE_PICK_WINNER.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# RACE_COMPETITIVE_PICK_WINNER — Race/Competitive Pick One-Winner-Among-N Aggregator Acceptance (W192, 73. solver, Vendor B M8 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${RACES} MC races each (2 strategies = ${(RACES * 2).toLocaleString()} sim spins per config).`);
  md.push('');
  md.push('Closes Vendor B M8 P1 GAP — WMS Goldfish Race for the Gold + Reel\'em In Big Bass Bucks fishing contest.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Categorical winner + player-pick gating × multiplier draw:');
  md.push('  - **K ~ Categorical(p_1..p_N)** sa p_i = w_i / Σ w_j');
  md.push('  - **Y(pick=s) = V_s · M_s · 𝟙{K=s}**');
  md.push('  - **E[Y | pick=s] = p_s · V_s · μ_M_s**');
  md.push('  - **Var[Y | pick=s] = p_s · V_s² · (σ²_M + μ_M²) − E[Y]²**');
  md.push('  - **bestPickIndex = argmax_s** E[Y | pick=s]');
  md.push('  - **skillPremiumVsUniform = best − (1/N)·Σ E[Y|s]**');
  md.push('  - **rtpSpread = best − worst**');
  md.push('  - **commercialUpliftOverSymmetric = bestRtp / uniformRtp**');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | N | best(p%) | best ER CF/MC | uniform CF/MC | skill+ | uplift× |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const bestLabel = r.closed_form.perCandidate[r.closed_form.bestPickIndex].label;
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.numCandidates} | ${bestLabel}(${(r.closed_form.probabilityBestPickWins*100).toFixed(1)}%) | ${r.closed_form.bestPickExpectedReturn.toFixed(3)}/${r.monte_carlo.rational.meanPayoutPerRace.toFixed(3)} | ${r.closed_form.uniformPickExpectedReturn.toFixed(3)}/${r.monte_carlo.uniform.meanPayoutPerRace.toFixed(3)} | ${r.closed_form.skillPremiumVsUniform.toFixed(2)} | ${r.closed_form.commercialUpliftOverSymmetric.toFixed(2)} |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-12 player-skill mechanic RTP / UKGC RTS-14 per-candidate transparency / MGA PPD §11 / eCOGRA / EU GA 2024.');
  md.push('');
  md.push("Industry: Vendor B WMS Goldfish Race for the Gold (2017) + Reel'em In Big Bass Bucks (2014) + competitive-pick variants.");
  writeFileSync(join(OUT_DIR, 'RACE_COMPETITIVE_PICK_WINNER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
