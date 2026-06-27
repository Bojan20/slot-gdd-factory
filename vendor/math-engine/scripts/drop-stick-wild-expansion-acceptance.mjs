#!/usr/bin/env node
//
// W152 Wave 170 — Drop-and-Stick Wild Expansion Analyzer acceptance (Wave 169).
//
// 6 industry-iconic sticky-wild configs × 2K MC episodes each
// = 12K total grid-walk simulations. Closed-form per-cell geometric saturation
// cross-validated against discrete-event MC.
//
// Operator deliverable: `reports/acceptance/DROP_STICK_WILD_EXPANSION.{json,md}`.
//
// Compliance: UKGC RTS 14 (wild mechanic disclosure), MGA PPD §11 (sticky
// feature transparency), eCOGRA sticky-wild audit.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 2_000;
const SEED = 0xCAFE0169;

const TOL_EXPECTED_REL = 0.05;     // E[wilds] rel ≤ 5%
const TOL_STD_REL = 0.20;          // stdDev rel ≤ 20%
const TOL_TIMEAVG_REL = 0.05;      // time-avg rel ≤ 5%

const CONFIGS = [
  {
    name: 'A_netent_witchcraft_3x5_S5',
    description: 'Vendor D Witchcraft Academy-class: 3×5 grid, q=0.08 per-cell, sticky=5 spins (full FS)',
    cfg: { gridRows: 3, gridCols: 5, probWildLandPerCellPerSpin: 0.08, stickyDurationSpins: 5 },
  },
  {
    name: 'B_pragmatic_wild_west_gold_6x5_S10',
    description: 'Pragmatic Wild West Gold-class: 6×5 money wild grid, q=0.05, sticky=10 (long FS)',
    cfg: { gridRows: 5, gridCols: 6, probWildLandPerCellPerSpin: 0.05, stickyDurationSpins: 10 },
  },
  {
    name: 'C_hacksaw_tombstone_5x5_S3_high_q',
    description: 'Hacksaw Tombstone-class: 5×5 skull wilds, q=0.15 high-freq, sticky=3 (short FS)',
    cfg: { gridRows: 5, gridCols: 5, probWildLandPerCellPerSpin: 0.15, stickyDurationSpins: 3 },
  },
  {
    name: 'D_push_mount_magmas_4x5_S8',
    description: 'Push Mount Magmas-class: 4×5 lava wild stays through FS, q=0.06, sticky=8',
    cfg: { gridRows: 4, gridCols: 5, probWildLandPerCellPerSpin: 0.06, stickyDurationSpins: 8 },
  },
  {
    name: 'E_corner_small_grid_high_fill',
    description: 'Corner: 2×2 small grid, q=0.30, sticky=5 → high fill prob (saturated)',
    cfg: { gridRows: 2, gridCols: 2, probWildLandPerCellPerSpin: 0.30, stickyDurationSpins: 5 },
  },
  {
    name: 'F_corner_large_grid_low_freq',
    description: 'Corner: 7×7 large grid (Megaways-class), q=0.02 low-freq, sticky=4',
    cfg: { gridRows: 7, gridCols: 7, probWildLandPerCellPerSpin: 0.02, stickyDurationSpins: 4 },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveDropStickWildExpansion, simulateDropStickWildExpansion } =
    await import(join(REPO_ROOT, 'dist', 'features', 'dropStickWildExpansion.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Drop-and-Stick Wild Expansion configs @ ${EPISODES} MC episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveDropStickWildExpansion(c.cfg);
    const mc = simulateDropStickWildExpansion(c.cfg, EPISODES, SEED);

    const expectedRel = relErr(cf.expectedActiveWildsSteadyState, mc.observedActiveWildsAtSteadyState);
    const stdRel = cf.stdDevActiveWildsSteadyState > 1e-6
      ? relErr(cf.stdDevActiveWildsSteadyState, mc.observedStdDevActiveWildsAtSteadyState)
      : 0;
    const timeAvgRel = relErr(cf.timeAveragedActiveWildsOverHorizon, mc.observedTimeAveragedActiveWildsOverHorizon);

    const checks = { expected_rel: expectedRel, std_rel: stdRel, time_avg_rel: timeAvgRel };
    const pass = expectedRel <= TOL_EXPECTED_REL && stdRel <= TOL_STD_REL && timeAvgRel <= TOL_TIMEAVG_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.cfg.gridRows}×${c.cfg.gridCols} q=${c.cfg.probWildLandPerCellPerSpin.toFixed(2)} S=${c.cfg.stickyDurationSpins}  ` +
        `E[W]=${cf.expectedActiveWildsSteadyState.toFixed(2)}/${mc.observedActiveWildsAtSteadyState.toFixed(2)}  ` +
        `stdDev=${cf.stdDevActiveWildsSteadyState.toFixed(2)}/${mc.observedStdDevActiveWildsAtSteadyState.toFixed(2)}  ` +
        `fill=${(cf.fillFraction*100).toFixed(1)}%  ` +
        `gridFillP=${(cf.gridFillProbSteadyState*100).toFixed(3)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        gridCellCount: cf.gridCellCount,
        perCellActiveProbSteadyState: cf.perCellActiveProbSteadyState,
        expectedActiveWildsSteadyState: cf.expectedActiveWildsSteadyState,
        stdDevActiveWildsSteadyState: cf.stdDevActiveWildsSteadyState,
        fillFraction: cf.fillFraction,
        timeToSteadyState: cf.timeToSteadyState,
        timeAveragedActiveWildsOverHorizon: cf.timeAveragedActiveWildsOverHorizon,
        gridFillProbSteadyState: cf.gridFillProbSteadyState,
        expectedSpinsToFullGridFill: Number.isFinite(cf.expectedSpinsToFullGridFill) ? cf.expectedSpinsToFullGridFill : 'Infinity',
      },
      monte_carlo: {
        episodes: EPISODES,
        observedActiveWildsAtSteadyState: mc.observedActiveWildsAtSteadyState,
        observedStdDevActiveWildsAtSteadyState: mc.observedStdDevActiveWildsAtSteadyState,
        observedTimeAveragedActiveWildsOverHorizon: mc.observedTimeAveragedActiveWildsOverHorizon,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'DROP_STICK_WILD_EXPANSION',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { expected_rel: TOL_EXPECTED_REL, std_rel: TOL_STD_REL, time_avg_rel: TOL_TIMEAVG_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'DROP_STICK_WILD_EXPANSION.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# DROP_STICK_WILD_EXPANSION — Drop-and-Stick Wild Expansion Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(1)}K total grid-walk simulations.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Drop-and-Stick Wild Expansion Analyzer" (Wave 169 — 56th solver, per-cell sticky accumulation).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form per-cell geometric saturation:');
  md.push('  - perCellActiveSteady = 1 − (1−q)^S');
  md.push('  - E[W_∞] = N·M · perCellSteady');
  md.push('  - Var = N·M · p · (1−p)');
  md.push('  - gridFillProb = perCellSteady^(N·M)');
  md.push('');
  md.push('MC: 2K episodes per config, per-cell remaining-stick counter, mulberry32 RNG.');
  md.push('');
  md.push('## Configs — operator wild-mechanic disclosure table');
  md.push('');
  md.push('| Config | Pass | Grid | q | S | E[W_∞] CF/MC | stdDev CF/MC | fill % | gridFill P |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.gridRows}×${r.cfg.gridCols} | ${r.cfg.probWildLandPerCellPerSpin} | ${r.cfg.stickyDurationSpins} | ${cf.expectedActiveWildsSteadyState.toFixed(2)}/${mc.observedActiveWildsAtSteadyState.toFixed(2)} | ${cf.stdDevActiveWildsSteadyState.toFixed(2)}/${mc.observedStdDevActiveWildsAtSteadyState.toFixed(2)} | ${(cf.fillFraction*100).toFixed(1)}% | ${(cf.gridFillProbSteadyState*100).toFixed(3)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — wild mechanic disclosure (operator must display sticky-wild rate)');
  md.push('- **MGA PPD §11** — sticky feature transparency (per-cell active prob disclosed)');
  md.push('- **eCOGRA Generic Slots Audit** — sticky-wild auditor verification');
  md.push('');
  md.push('Industry use: Vendor D Witchcraft Academy spreading sticky wilds, Pragmatic Wild West Gold');
  md.push('money wilds, Hacksaw Tombstone skull wilds, Pragmatic Gates of Olympus 1000 multiplier wilds.');

  writeFileSync(join(OUT_DIR, 'DROP_STICK_WILD_EXPANSION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/DROP_STICK_WILD_EXPANSION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
