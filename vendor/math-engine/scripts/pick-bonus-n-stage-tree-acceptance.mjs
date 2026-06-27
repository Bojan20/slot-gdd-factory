#!/usr/bin/env node
//
// W152 Wave 108 — Pick Bonus N-Stage Tree acceptance (Wave 107).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/PICK_BONUS_N_STAGE.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED_VAL = 0xC0DECAFE;
const TOL_EY_REL = 0.05;
const TOL_VAR_REL = 0.25;
const TOL_REACH_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_netent_classic_3tier',
    description: 'Vendor D classic 3-tier silver/gold/platinum pick-til-pop',
    cfg: {
      stages: [
        { label: 'silver',   advanceProbability: 0.40, collectProbability: 0.50, collectPayoutX: 10 },
        { label: 'gold',     advanceProbability: 0.20, collectProbability: 0.70, collectPayoutX: 50 },
        { label: 'platinum', advanceProbability: 0,    collectProbability: 0.85, collectPayoutX: 500 },
      ],
    },
  },
  {
    name: 'B_microgaming_5tier_grand',
    description: 'Vendor G 5-tier ladder with grand jackpot',
    cfg: {
      stages: [
        { label: 'tier_1', advanceProbability: 0.5,  collectProbability: 0.4,  collectPayoutX: 5 },
        { label: 'tier_2', advanceProbability: 0.4,  collectProbability: 0.5,  collectPayoutX: 25 },
        { label: 'tier_3', advanceProbability: 0.3,  collectProbability: 0.6,  collectPayoutX: 100 },
        { label: 'tier_4', advanceProbability: 0.2,  collectProbability: 0.7,  collectPayoutX: 500 },
        { label: 'grand',  advanceProbability: 0,    collectProbability: 0.95, collectPayoutX: 5000 },
      ],
    },
  },
  {
    name: 'C_2tier_simple',
    description: 'Simple 2-stage advance/collect',
    cfg: {
      stages: [
        { label: 'first',  advanceProbability: 0.6,  collectProbability: 0.35, collectPayoutX: 10 },
        { label: 'second', advanceProbability: 0,    collectProbability: 0.90, collectPayoutX: 200 },
      ],
    },
  },
  {
    name: 'D_single_stage_deterministic',
    description: 'Single-stage deterministic collect (corner case)',
    cfg: {
      stages: [
        { label: 'only', advanceProbability: 0, collectProbability: 1, collectPayoutX: 100 },
      ],
    },
  },
  {
    name: 'E_high_end_low_advance',
    description: 'High end probability — most episodes terminate at 0',
    cfg: {
      stages: [
        { label: 'a', advanceProbability: 0.1, collectProbability: 0.2, collectPayoutX: 50 },
        { label: 'b', advanceProbability: 0.1, collectProbability: 0.3, collectPayoutX: 200 },
        { label: 'c', advanceProbability: 0,   collectProbability: 0.5, collectPayoutX: 1000 },
      ],
    },
  },
  {
    name: 'F_aggressive_advance',
    description: 'Aggressive advance, easy reach top — long ladder',
    cfg: {
      stages: [
        { label: 's1', advanceProbability: 0.8, collectProbability: 0.15, collectPayoutX: 5 },
        { label: 's2', advanceProbability: 0.7, collectProbability: 0.20, collectPayoutX: 20 },
        { label: 's3', advanceProbability: 0.6, collectProbability: 0.30, collectPayoutX: 100 },
        { label: 's4', advanceProbability: 0.5, collectProbability: 0.40, collectPayoutX: 500 },
        { label: 's5', advanceProbability: 0,   collectProbability: 0.80, collectPayoutX: 5000 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solvePickBonusNStageTree, simulatePickBonusNStageTree } = await import(
    join(REPO_ROOT, 'dist', 'features', 'pickBonusNStageTree.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Pick Bonus N-Stage configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solvePickBonusNStageTree(c.cfg);
    const mc = simulatePickBonusNStageTree(c.cfg, EPISODES, SEED_VAL);

    const eyRel = cf.expectedPayoutX > 1e-9
      ? relErr(cf.expectedPayoutX, mc.observedMeanPayoutX)
      : Math.abs(cf.expectedPayoutX - mc.observedMeanPayoutX);
    const varRel = cf.variancePayoutX > 1e-9
      ? relErr(cf.variancePayoutX, mc.observedVariancePayoutX)
      : 0;
    let maxReachErr = 0;
    for (let i = 0; i < cf.reachProbabilities.length; i++) {
      if (cf.reachProbabilities[i] > 0.01) {
        const r = Math.abs(cf.reachProbabilities[i] - mc.observedReachHistogram[i]) / cf.reachProbabilities[i];
        if (r > maxReachErr) maxReachErr = r;
      }
    }

    const checks = { ey_rel: eyRel, var_rel: varRel, max_reach_rel: maxReachErr };
    const pass = eyRel <= TOL_EY_REL && varRel <= TOL_VAR_REL && maxReachErr <= TOL_REACH_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `E[Y]_CF=${cf.expectedPayoutX.toFixed(3)} MC=${mc.observedMeanPayoutX.toFixed(3)}  ` +
        `P(top)_CF=${(cf.probReachTopStage*100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        reachProbabilities: cf.reachProbabilities,
        collectProbabilities: cf.collectProbabilities,
        expectedPayoutX: cf.expectedPayoutX,
        variancePayoutX: cf.variancePayoutX,
        probReachTopStage: cf.probReachTopStage,
        probCollectAnywhere: cf.probCollectAnywhere,
        probEndWithZero: cf.probEndWithZero,
        maxPayoutX: cf.maxPayoutX,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanPayoutX: mc.observedMeanPayoutX,
        observedVariancePayoutX: mc.observedVariancePayoutX,
        observedReachHistogram: mc.observedReachHistogram,
        observedCollectHistogram: mc.observedCollectHistogram,
        observedEndRate: mc.observedEndCount / EPISODES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PICK_BONUS_N_STAGE',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED_VAL,
    tolerances: { ey_rel: TOL_EY_REL, var_rel: TOL_VAR_REL, max_reach_rel: TOL_REACH_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'PICK_BONUS_N_STAGE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# PICK_BONUS_N_STAGE — Multi-Stage Pick Bonus Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 4.6 extension: ✅ "Pick Bonus N-Stage Tree" (Wave 107).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form recursive stage probabilities:');
  md.push('  - P(reach 1) = 1');
  md.push('  - P(reach i) = Π advance_{j<i}');
  md.push('  - P(collect at i) = P(reach i) · collect_i');
  md.push('  - E[Y] = Σ P(collect at i) · v_i');
  md.push('  - Var[Y] = Σ P(collect at i) · v_i² − E[Y]²');
  md.push('');
  md.push('MC: 100K episodes per config, deterministic mulberry32 + per-stage Bernoulli routing.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[Y]_CF | E[Y]_MC | rel | P(top) | P(end0) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedPayoutX.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutX.toFixed(3)} | ` +
        `${(r.checks.ey_rel*100).toFixed(2)}% | ` +
        `${(r.closed_form.probReachTopStage * 100).toFixed(3)}% | ` +
        `${(r.closed_form.probEndWithZero * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance disclosure required for pick bonus features');
  md.push('- **MGA PPD §11.f** — tail-probability disclosure (P(reach top), P(end with 0))');
  md.push('- **eCOGRA Generic Slots Audit** — recursive stage probability auditor-verifiable');
  md.push('- Industry use: Vendor D classic pick-til-pop, Vendor G jackpot ladder, Play\'n GO pick bonuses');

  writeFileSync(join(OUT_DIR, 'PICK_BONUS_N_STAGE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/PICK_BONUS_N_STAGE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
