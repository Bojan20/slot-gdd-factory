#!/usr/bin/env node
//
// W152 Wave 183 — Multi-State Frame Upgrade Markov Aggregator acceptance
// (64. solver, Vendor B M2 P0 GAP CLOSURE — Huff N' Puff family 8 titles).
//
// 6 industry-representative configs × 5K MC features each = 30K total feature
// simulations sa per-cell K-state Markov chain MC vs exact π_0·P^T closed-form.
//
// Operator deliverable: `reports/acceptance/MULTI_STATE_FRAME_UPGRADE_MARKOV.{json,md}`.
//
// Compliance: UKGC RTS 14 (frame-state feature mechanic disclosure), MGA PPD
// §11 (per-cell evolution transparency), eCOGRA Generic Slots Audit (Markov
// audit trail per cell), EU GA 2024.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const FEATURES = 5_000;
const SEED = 0xCAFE0183;

const TOL_PAYOUT_REL = 0.05;       // E[payout] rel ≤ 5%
const TOL_STATEDIST_ABS = 0.03;    // per-state distribution abs ≤ 3pp
const TOL_PROB_AT_LEAST_ONE_ABS = 0.04; // P(≥1 cell reaches target) abs ≤ 4pp
const TOL_CELLS_AT_TARGET_REL = 0.10; // E[cells at target] rel ≤ 10%

const CONFIGS = [
  {
    name: "A_huff_n_puff_original_3stage_straw_wood_brick",
    description: "SG/Vendor B Huff N' Puff (original, 2019) — 4-state Idle→Straw→Wood→Brick, 5×3 grid, 10 spins.",
    cfg: {
      numReels: 5,
      numRows: 3,
      numStates: 4,
      transitionMatrix: [
        [0.7, 0.3, 0, 0],
        [0, 0.6, 0.4, 0],
        [0, 0, 0.7, 0.3],
        [0, 0, 0, 1],
      ],
      initialDistribution: [1, 0, 0, 0],
      payoutMultiplierPerState: [0, 2, 8, 40],
      numSpins: 10,
      targetStateForReachabilityDisclosure: 3,
    },
  },
  {
    name: "B_huff_n_more_puff_5state_extended",
    description: "Huff N' More Puff (2020) — 5-tier extended ladder, 5×3 grid, 15 spins.",
    cfg: {
      numReels: 5,
      numRows: 3,
      numStates: 5,
      transitionMatrix: [
        [0.6, 0.4, 0, 0, 0],
        [0, 0.5, 0.5, 0, 0],
        [0, 0, 0.5, 0.5, 0],
        [0, 0, 0, 0.6, 0.4],
        [0, 0, 0, 0, 1],
      ],
      initialDistribution: [1, 0, 0, 0, 0],
      payoutMultiplierPerState: [0, 1, 4, 12, 60],
      numSpins: 15,
      targetStateForReachabilityDisclosure: 4,
    },
  },
  {
    name: "C_huff_n_even_more_puff_megahat_addon",
    description: "Huff N' Even More Puff (2022) — Mega Hat add-on, 4-state slow-advance, 5×4 grid.",
    cfg: {
      numReels: 5,
      numRows: 4,
      numStates: 4,
      transitionMatrix: [
        [0.85, 0.15, 0, 0],
        [0, 0.7, 0.3, 0],
        [0, 0, 0.75, 0.25],
        [0, 0, 0, 1],
      ],
      initialDistribution: [1, 0, 0, 0],
      payoutMultiplierPerState: [0, 1, 6, 50],
      numSpins: 20,
      targetStateForReachabilityDisclosure: 3,
    },
  },
  {
    name: "D_huff_n_money_mansion_fast_advance",
    description: "Huff N' Money Mansion (2024) — fast-advance variant, 4-state, 5×3 grid, 8 spins.",
    cfg: {
      numReels: 5,
      numRows: 3,
      numStates: 4,
      transitionMatrix: [
        [0.3, 0.7, 0, 0],
        [0, 0.3, 0.7, 0],
        [0, 0, 0.3, 0.7],
        [0, 0, 0, 1],
      ],
      initialDistribution: [1, 0, 0, 0],
      payoutMultiplierPerState: [0, 3, 12, 100],
      numSpins: 8,
      targetStateForReachabilityDisclosure: 3,
    },
  },
  {
    name: "E_corner_3state_balanced_with_reset",
    description: "Corner: 3-state sa reset cycle (terminal state has reset prob), 4×4 grid.",
    cfg: {
      numReels: 4,
      numRows: 4,
      numStates: 3,
      transitionMatrix: [
        [0.5, 0.5, 0],
        [0, 0.5, 0.5],
        [0.1, 0, 0.9], // 10% reset to Idle
      ],
      initialDistribution: [1, 0, 0],
      payoutMultiplierPerState: [0, 1, 10],
      numSpins: 12,
      targetStateForReachabilityDisclosure: 2,
    },
  },
  {
    name: "F_corner_huff_xtra_puff_persistent_meter_high_state_payout",
    description: "Huff N' Xtra Puff (2024) — 6-state persistent meter, 5×3 grid, 12 spins.",
    cfg: {
      numReels: 5,
      numRows: 3,
      numStates: 6,
      transitionMatrix: [
        [0.5, 0.5, 0, 0, 0, 0],
        [0, 0.5, 0.5, 0, 0, 0],
        [0, 0, 0.5, 0.5, 0, 0],
        [0, 0, 0, 0.5, 0.5, 0],
        [0, 0, 0, 0, 0.5, 0.5],
        [0, 0, 0, 0, 0, 1],
      ],
      initialDistribution: [1, 0, 0, 0, 0, 0],
      payoutMultiplierPerState: [0, 0.5, 2, 5, 15, 75],
      numSpins: 12,
      targetStateForReachabilityDisclosure: 5,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeMultiStateFrameUpgrade, simulateMultiStateFrameUpgrade } = await import(
    join(REPO_ROOT, 'dist', 'features', 'multiStateFrameUpgradeMarkov.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Multi-State Frame Upgrade Markov configs @ ${FEATURES} MC features each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeMultiStateFrameUpgrade(c.cfg);
    const mc = simulateMultiStateFrameUpgrade(c.cfg, FEATURES, SEED);

    const payoutRel = relErr(cf.expectedTotalPayoutPerFeature, mc.meanTotalPayoutPerFeature);
    let maxStateDistAbs = 0;
    for (let k = 0; k < c.cfg.numStates; k++) {
      const abs = Math.abs(cf.finalStateDistributionPerCell[k] - mc.meanFinalStateDistributionPerCell[k]);
      if (abs > maxStateDistAbs) maxStateDistAbs = abs;
    }
    const probAtLeastOneAbs = Math.abs(
      cf.probAtLeastOneCellReachesTargetAtT - mc.probAtLeastOneCellReachesTarget,
    );
    const cellsAtTargetRel =
      mc.meanCellsAtOrAboveTarget > 0.01
        ? relErr(cf.expectedCellsAtOrAboveTargetAtT, mc.meanCellsAtOrAboveTarget)
        : Math.abs(cf.expectedCellsAtOrAboveTargetAtT - mc.meanCellsAtOrAboveTarget);

    const checks = {
      payout_rel: payoutRel,
      max_state_dist_abs: maxStateDistAbs,
      prob_at_least_one_abs: probAtLeastOneAbs,
      cells_at_target_rel: cellsAtTargetRel,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      maxStateDistAbs <= TOL_STATEDIST_ABS &&
      probAtLeastOneAbs <= TOL_PROB_AT_LEAST_ONE_ABS &&
      cellsAtTargetRel <= TOL_CELLS_AT_TARGET_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(54)} ${pass ? '✅' : '❌'}  ` +
        `${c.cfg.numReels}×${c.cfg.numRows} K=${c.cfg.numStates} T=${c.cfg.numSpins}  ` +
        `E[payout]=${cf.expectedTotalPayoutPerFeature.toFixed(1)}/${mc.meanTotalPayoutPerFeature.toFixed(1)}  ` +
        `P(reach k_tgt)=${(cf.perCellProbReachTargetStateAtT * 100).toFixed(2)}%  ` +
        `P(≥1)=${(cf.probAtLeastOneCellReachesTargetAtT * 100).toFixed(1)}%/${(mc.probAtLeastOneCellReachesTarget * 100).toFixed(1)}%  ` +
        `E[#cells@tgt]=${cf.expectedCellsAtOrAboveTargetAtT.toFixed(2)}/${mc.meanCellsAtOrAboveTarget.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        finalStateDistributionPerCell: cf.finalStateDistributionPerCell,
        stationaryDistribution: cf.stationaryDistribution,
        expectedPayoutPerCellPerSpin: cf.expectedPayoutPerCellPerSpin,
        expectedTotalPayoutPerFeature: cf.expectedTotalPayoutPerFeature,
        varianceTotalPayoutPerFeature: cf.varianceTotalPayoutPerFeature,
        stdDevTotalPayoutPerFeature: cf.stdDevTotalPayoutPerFeature,
        perCellProbReachTargetStateAtT: cf.perCellProbReachTargetStateAtT,
        probAtLeastOneCellReachesTargetAtT: cf.probAtLeastOneCellReachesTargetAtT,
        oneInNCellsReachesTarget: cf.oneInNCellsReachesTarget,
        expectedCellsAtOrAboveTargetAtT: cf.expectedCellsAtOrAboveTargetAtT,
        commercialUpliftVsIdleBaseline: cf.commercialUpliftVsIdleBaseline,
        effectiveGridRtpPerSpin: cf.effectiveGridRtpPerSpin,
      },
      monte_carlo: {
        features: FEATURES,
        meanTotalPayoutPerFeature: mc.meanTotalPayoutPerFeature,
        stdDevTotalPayoutPerFeature: mc.stdDevTotalPayoutPerFeature,
        meanFinalStateDistributionPerCell: mc.meanFinalStateDistributionPerCell,
        meanCellsAtOrAboveTarget: mc.meanCellsAtOrAboveTarget,
        probAtLeastOneCellReachesTarget: mc.probAtLeastOneCellReachesTarget,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MULTI_STATE_FRAME_UPGRADE_MARKOV',
    generated_utc: new Date().toISOString(),
    features_per_config: FEATURES,
    seed: SEED,
    tolerances: {
      payout_rel: TOL_PAYOUT_REL,
      max_state_dist_abs: TOL_STATEDIST_ABS,
      prob_at_least_one_abs: TOL_PROB_AT_LEAST_ONE_ABS,
      cells_at_target_rel: TOL_CELLS_AT_TARGET_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'MULTI_STATE_FRAME_UPGRADE_MARKOV.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# MULTI_STATE_FRAME_UPGRADE_MARKOV — Multi-State Frame Upgrade Markov Aggregator Acceptance (W183, 64. solver, Vendor B M2 P0 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${FEATURES} MC features each = ${(CONFIGS.length * FEATURES / 1e3).toFixed(0)}K total feature sims.`);
  md.push('');
  md.push("Closes Faza 12 ext (post-W100): ✅ \"Multi-State Frame Upgrade Markov Aggregator\" (Wave 183 — 64. closed-form solver, Vendor B M2 GAP CLOSED).");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-cell K-state Markov chain on N×M grid sa explicit P^T computation. Aggregates:');
  md.push('  - **π_T = π_0 · P^T** per-cell state distribution after T spinova');
  md.push('  - **E[per-cell payout per spin] = dot(π_t, m)** time-averaged');
  md.push('  - **E[total payout] = N·M · Σ_{t=0..T-1} dot(π_t, m)**');
  md.push('  - **P(per-cell ≥ k_target) = Σ_{k ≥ k_target} π_T(k)**');
  md.push('  - **P(at least one cell reaches k_target) = 1 − (1−P_perCell)^(N·M)**');
  md.push('  - **Stationary π_∞**: left eigenvector via power iteration');
  md.push('');
  md.push('MC: per-feature, sample initial state from π_0, advance T spinova sa cumulative transition probability, accumulate payout per spin from current state, count cells at terminal/target state.');
  md.push('');
  md.push('## Configs — Multi-State Frame Upgrade Markov operator disclosure table');
  md.push('');
  md.push('| Config | Pass | N×M | K | T | E[payout] CF/MC | P(≥1@tgt) CF/MC | E[#cells@tgt] CF/MC |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numReels}×${r.cfg.numRows} | ${r.cfg.numStates} | ${r.cfg.numSpins} | ${cf.expectedTotalPayoutPerFeature.toFixed(1)}/${mc.meanTotalPayoutPerFeature.toFixed(1)} | ${(cf.probAtLeastOneCellReachesTargetAtT * 100).toFixed(1)}%/${(mc.probAtLeastOneCellReachesTarget * 100).toFixed(1)}% | ${cf.expectedCellsAtOrAboveTargetAtT.toFixed(2)}/${mc.meanCellsAtOrAboveTarget.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — frame-state mechanic disclosure (per-state hit frequency).');
  md.push('- **MGA PPD §11** — per-cell evolution transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — Markov audit trail per cell.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push("Industry use: Vendor B M2 gap — Huff N' Puff family (original, More, Even More, Lots of, Xtra, Hard Hat Edition, Grand, Money Mansion — 8 titles).");

  writeFileSync(join(OUT_DIR, 'MULTI_STATE_FRAME_UPGRADE_MARKOV.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MULTI_STATE_FRAME_UPGRADE_MARKOV.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
