#!/usr/bin/env node
//
// W152 Wave 145 — Trail/Board Bonus Progression Tracker acceptance (Wave 144).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC episodes.
//
// Operator deliverable: `reports/acceptance/TRAIL_BONUS_TRACKER.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: trail progression rule +
// step distribution + bust position disclosure za "trail/board bonus" mehaniku.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED = 0xCAFE0144;
const TOL_REWARD_REL = 0.04;   // E[reward] rel
const TOL_REACH_ABS  = 0.01;   // P_reach abs
const TOL_BUST_ABS   = 0.01;   // P_bust abs

const CONFIGS = [
  {
    name: 'A_konami_stairway_12_step',
    description: 'Konami Stairway to Heaven 12-step trail w/ 1 bust @ 6',
    cfg: {
      trailLength: 12,
      maxPicks: 8,
      stepPmf: [
        { step: 1, probability: 0.6 },
        { step: 2, probability: 0.3 },
        { step: 3, probability: 0.1 },
      ],
      positionRewardX: [0, 2, 5, 10, 20, 50, 0, 100, 250, 500, 1000, 2000, 0],
      endBonusX: 5000,
      bustPositions: [6],
    },
  },
  {
    name: 'B_igt_wof_multi_tier_trail_20step',
    description: 'Vendor A Wheel of Fortune Multi-Tier Trail 20-step no bust',
    cfg: {
      trailLength: 20,
      maxPicks: 12,
      stepPmf: [
        { step: 1, probability: 0.7 },
        { step: 3, probability: 0.2 },
        { step: 5, probability: 0.1 },
      ],
      positionRewardX: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 0],
      endBonusX: 10000,
      bustPositions: [],
    },
  },
  {
    name: 'C_microgaming_lotr_30step_deep',
    description: 'Vendor G Lord of the Rings 30-step deep w/ 2 bust positions',
    cfg: {
      trailLength: 30,
      maxPicks: 20,
      stepPmf: [
        { step: 1, probability: 0.4 },
        { step: 2, probability: 0.3 },
        { step: 3, probability: 0.2 },
        { step: 5, probability: 0.1 },
      ],
      positionRewardX: Array.from({ length: 31 }, (_, i) => i * 5),
      endBonusX: 50000,
      bustPositions: [10, 20],
    },
  },
  {
    name: 'D_inspired_ladder_climb_short',
    description: 'Inspired ladder climb 5-step compact, deterministic step=1',
    cfg: {
      trailLength: 5,
      maxPicks: 5,
      stepPmf: [
        { step: 1, probability: 1.0 },
      ],
      positionRewardX: [0, 10, 25, 50, 100, 0],
      endBonusX: 500,
      bustPositions: [],
    },
  },
  {
    name: 'E_corner_always_bust_at_first_advance',
    description: 'Corner: every advancing position is bust → P_bust=1',
    cfg: {
      trailLength: 10,
      maxPicks: 5,
      stepPmf: [
        { step: 1, probability: 1.0 },
      ],
      positionRewardX: [0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0],
      endBonusX: 100,
      bustPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
  },
  {
    name: 'F_corner_giant_step_reaches_end_p1',
    description: 'Corner: single step = trailLength → P_reach=1 in 1 pick',
    cfg: {
      trailLength: 8,
      maxPicks: 5,
      stepPmf: [
        { step: 8, probability: 1.0 },
      ],
      positionRewardX: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      endBonusX: 1000,
      bustPositions: [],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveTrailBonusTracker, simulateTrailBonusTracker } = await import(
    join(REPO_ROOT, 'dist', 'features', 'trailBonusTracker.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Trail Bonus Tracker configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveTrailBonusTracker(c.cfg);
    const mc = simulateTrailBonusTracker(c.cfg, EPISODES, SEED);

    const rewardRel = cf.expectedTotalRewardX > 1e-9
      ? relErr(cf.expectedTotalRewardX, mc.observedMeanTotalRewardX)
      : Math.abs(cf.expectedTotalRewardX - mc.observedMeanTotalRewardX);
    const reachAbs = Math.abs(cf.probReachEnd - mc.observedReachEndFraction);
    const bustAbs = Math.abs(cf.probBust - mc.observedBustFraction);

    const checks = {
      reward_rel: rewardRel,
      reach_abs: reachAbs,
      bust_abs: bustAbs,
    };
    const pass = rewardRel <= TOL_REWARD_REL && reachAbs <= TOL_REACH_ABS && bustAbs <= TOL_BUST_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `E[r]_CF=${cf.expectedTotalRewardX.toFixed(2)} MC=${mc.observedMeanTotalRewardX.toFixed(2)}  ` +
        `P_reach=${(cf.probReachEnd * 100).toFixed(2)}%/${(mc.observedReachEndFraction * 100).toFixed(2)}%  ` +
        `P_bust=${(cf.probBust * 100).toFixed(2)}%/${(mc.observedBustFraction * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        trailLength: cf.trailLength,
        maxPicks: cf.maxPicks,
        expectedTotalRewardX: cf.expectedTotalRewardX,
        varianceTotalRewardX: cf.varianceTotalRewardX,
        probReachEnd: cf.probReachEnd,
        probBust: cf.probBust,
        probTimeout: cf.probTimeout,
        expectedFinalPosition: cf.expectedFinalPosition,
        expectedPicksUsed: cf.expectedPicksUsed,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanTotalRewardX: mc.observedMeanTotalRewardX,
        observedReachEndFraction: mc.observedReachEndFraction,
        observedBustFraction: mc.observedBustFraction,
        observedTimeoutFraction: mc.observedTimeoutFraction,
        observedMeanFinalPosition: mc.observedMeanFinalPosition,
        observedMeanPicksUsed: mc.observedMeanPicksUsed,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'TRAIL_BONUS_TRACKER',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      reward_rel: TOL_REWARD_REL,
      reach_abs: TOL_REACH_ABS,
      bust_abs: TOL_BUST_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'TRAIL_BONUS_TRACKER.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# TRAIL_BONUS_TRACKER — Trail/Board Bonus Progression Tracker Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC episodes.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Trail/Board Bonus Progression Tracker" (Wave 144).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form DP over (position, picksRemaining) state-space:');
  md.push('  - V(p, r) = E[total reward | starting at p with r picks]');
  md.push('  - Per step Δ ~ stepPmf → newPos = min(p+Δ, N)');
  md.push('  - End → V = endBonusX; Bust → V = 0; Advance → V = stepReward + V(pNew, r-1)');
  md.push('  - Plus P_reach, P_bust, P_timeout (sum = 1 invariant)');
  md.push('');
  md.push('MC: 100K episodes per config, mulberry32 RNG, per-pick PMF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[reward] | P_reach | P_bust | P_timeout |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedTotalRewardX.toFixed(2)} | ` +
        `${(r.closed_form.probReachEnd * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probBust * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probTimeout * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — trail progression + bust position disclosure');
  md.push('- **MGA PPD §11.f** — bonus-game rule transparency (step + reward + bust)');
  md.push('- **eCOGRA Generic Bonus Audit** — verifies trail math matches engine');
  md.push("- Industry use: Konami Stairway to Heaven, Vendor A Wheel of Fortune Multi-Tier");
  md.push("  Trail, Vendor G Lord of the Rings, Inspired ladder climb, Vendor H");
  md.push('  Quick Hit Cash trail, Vendor A Mystical Mermaid.');

  writeFileSync(join(OUT_DIR, 'TRAIL_BONUS_TRACKER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/TRAIL_BONUS_TRACKER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
