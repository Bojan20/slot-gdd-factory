#!/usr/bin/env node
//
// W152 Wave 185 — Per-Reel Cash-Bag × Per-Row-Multiplier Coupled Accumulator
// acceptance (66. solver, Vendor B M1 P0 GAP CLOSURE — Dragon Spin CrossLink Water
// + future Vendor B flagship).
//
// 6 industry configs × 20K MC spins each = 120K total spin sims sa per-cell
// Bernoulli + Gaussian coin value MC vs exact 2D Binomial closed-form.
//
// Operator deliverable: `reports/acceptance/PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.{json,md}`.
//
// Compliance: UKGC RTS 14 (multi-dim feature aggregator disclosure), MGA PPD §11
// (per-reel + per-row reward transparency), eCOGRA Generic Slots Audit
// (dual-dimension accumulator audit), EU GA 2024.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 20_000;
const SEED = 0xCAFE0185;

const TOL_PAYOUT_REL = 0.25;       // top-tier-only jackpot configs (P(jackpot)~q^N) create heavy-tail variance @ 20K spins
const TOL_REEL_BAG_REL = 0.05;
const TOL_ROW_MULT_REL = 0.04;
const TOL_PROB_ROW_FULL_ABS = 0.03;
const TOL_HIGHEST_MULT_REL = 0.20; // rare-only-top-tier configs (m_c=0 except c=N) inflate rel error

const CONFIGS = [
  {
    name: "A_dragon_spin_crosslink_water_classic_5x4",
    description: "Vendor B Dragon Spin CrossLink Water (2024, defining title) — 5×4 grid, q=0.12, escalating row mult [1,1,2,5,10,25].",
    cfg: {
      numReels: 5,
      numRows: 4,
      probCoinLandPerCell: 0.12,
      expectedCoinValue: 3,
      varianceCoinValue: 2,
      multiplierByRowCoinCount: [1, 1, 2, 5, 10, 25],
    },
  },
  {
    name: "B_dragon_spin_crosslink_high_density",
    description: "Dragon Spin CrossLink variant — higher q=0.25 (more frequent low-tier hits, fewer rare full rows).",
    cfg: {
      numReels: 5,
      numRows: 4,
      probCoinLandPerCell: 0.25,
      expectedCoinValue: 2,
      varianceCoinValue: 1,
      multiplierByRowCoinCount: [1, 1, 2, 4, 10, 50],
    },
  },
  {
    name: "C_dragon_spin_crosslink_steep_ramp",
    description: "Dragon Spin CrossLink variant — steep multiplier ramp [1,1,3,10,50,500] for jackpot disclosure.",
    cfg: {
      numReels: 5,
      numRows: 4,
      probCoinLandPerCell: 0.15,
      expectedCoinValue: 2.5,
      varianceCoinValue: 1.5,
      multiplierByRowCoinCount: [1, 1, 3, 10, 50, 500],
    },
  },
  {
    name: "D_compact_grid_3x3_balanced",
    description: "Compact 3×3 grid balanced — q=0.20, [1,1,2,5] mid-tier rewards.",
    cfg: {
      numReels: 3,
      numRows: 3,
      probCoinLandPerCell: 0.20,
      expectedCoinValue: 2,
      varianceCoinValue: 0.5,
      multiplierByRowCoinCount: [1, 1, 2, 5],
    },
  },
  {
    name: "E_corner_flat_multiplier_pure_collector",
    description: "Corner: flat multiplier (m_c = 1 svuda) — degenerates to pure per-cell collector (no row coupling).",
    cfg: {
      numReels: 5,
      numRows: 4,
      probCoinLandPerCell: 0.15,
      expectedCoinValue: 2,
      varianceCoinValue: 0.5,
      multiplierByRowCoinCount: [1, 1, 1, 1, 1, 1],
    },
  },
  {
    name: "F_corner_threshold_only_top_tier_pays",
    description: "Corner: only top-tier pays (m_c=0 for c<N, m_N=100) — rare jackpot disclosure.",
    cfg: {
      numReels: 5,
      numRows: 4,
      probCoinLandPerCell: 0.20,
      expectedCoinValue: 2,
      varianceCoinValue: 0.5,
      multiplierByRowCoinCount: [0, 0, 0, 0, 0, 100],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzePerReelBagRowMultiplierCoupled, simulatePerReelBagRowMultiplierCoupled } =
    await import(
      join(REPO_ROOT, 'dist', 'features', 'perReelBagRowMultiplierCoupled.js')
    );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Per-Reel Bag × Row-Multiplier configs @ ${SPINS} MC spins each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzePerReelBagRowMultiplierCoupled(c.cfg);
    const mc = simulatePerReelBagRowMultiplierCoupled(c.cfg, SPINS, SEED);

    const payoutRel =
      cf.expectedTotalPayoutPerSpin > 0.001
        ? relErr(cf.expectedTotalPayoutPerSpin, mc.meanTotalPayoutPerSpin)
        : Math.abs(cf.expectedTotalPayoutPerSpin - mc.meanTotalPayoutPerSpin);
    const reelBagRel = relErr(cf.expectedReelBag, mc.meanReelBag);
    // Rel-or-abs: when E[mult] is tiny (e.g. top-tier-only configs sa m_c=0 osim c=N),
    // rel error inflates. Pass if EITHER rel ≤ tol OR abs ≤ 0.01.
    const rowMultRelRaw = relErr(cf.expectedRowMultiplier, mc.meanRowMultiplier);
    const rowMultAbs = Math.abs(cf.expectedRowMultiplier - mc.meanRowMultiplier);
    const rowMultRel = rowMultAbs < 0.01 ? 0 : rowMultRelRaw;
    const probRowFullAbs = Math.abs(cf.probAtLeastOneRowFull - mc.observedProbAtLeastOneRowFull);
    const highestMultRelRaw = relErr(cf.expectedHighestRowMultiplier, mc.meanHighestRowMultiplier);
    const highestMultAbs = Math.abs(cf.expectedHighestRowMultiplier - mc.meanHighestRowMultiplier);
    const highestMultRel = highestMultAbs < 0.01 ? 0 : highestMultRelRaw;

    const checks = {
      payout_rel: payoutRel,
      reel_bag_rel: reelBagRel,
      row_mult_rel: rowMultRel,
      prob_row_full_abs: probRowFullAbs,
      highest_mult_rel: highestMultRel,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      reelBagRel <= TOL_REEL_BAG_REL &&
      rowMultRel <= TOL_ROW_MULT_REL &&
      probRowFullAbs <= TOL_PROB_ROW_FULL_ABS &&
      highestMultRel <= TOL_HIGHEST_MULT_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(50)} ${pass ? '✅' : '❌'}  ` +
        `${c.cfg.numReels}×${c.cfg.numRows} q=${c.cfg.probCoinLandPerCell}  ` +
        `E[Y]=${cf.expectedTotalPayoutPerSpin.toFixed(3)}/${mc.meanTotalPayoutPerSpin.toFixed(3)}  ` +
        `E[bag]=${cf.expectedReelBag.toFixed(3)}/${mc.meanReelBag.toFixed(3)}  ` +
        `E[mult]=${cf.expectedRowMultiplier.toFixed(3)}/${mc.meanRowMultiplier.toFixed(3)}  ` +
        `P(≥1full)=${(cf.probAtLeastOneRowFull * 100).toFixed(2)}%/${(mc.observedProbAtLeastOneRowFull * 100).toFixed(2)}%  ` +
        `uplift=${cf.commercialUpliftVsFlatMultiplier.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedReelBag: cf.expectedReelBag,
        varianceReelBag: cf.varianceReelBag,
        expectedRowCoinCount: cf.expectedRowCoinCount,
        expectedRowMultiplier: cf.expectedRowMultiplier,
        rowCoinCountPmf: cf.rowCoinCountPmf,
        expectedRowContribution: cf.expectedRowContribution,
        varianceRowContribution: cf.varianceRowContribution,
        expectedTotalPayoutPerSpin: cf.expectedTotalPayoutPerSpin,
        varianceTotalPayoutPerSpin: cf.varianceTotalPayoutPerSpin,
        stdDevTotalPayoutPerSpin: cf.stdDevTotalPayoutPerSpin,
        probAtLeastOneRowFull: cf.probAtLeastOneRowFull,
        expectedRowsFull: cf.expectedRowsFull,
        probAllRowsFull: cf.probAllRowsFull,
        oneInNSpinsAtLeastOneRowFull: cf.oneInNSpinsAtLeastOneRowFull,
        expectedHighestRowMultiplier: cf.expectedHighestRowMultiplier,
        commercialUpliftVsFlatMultiplier: cf.commercialUpliftVsFlatMultiplier,
      },
      monte_carlo: {
        spins: SPINS,
        meanTotalPayoutPerSpin: mc.meanTotalPayoutPerSpin,
        stdDevTotalPayoutPerSpin: mc.stdDevTotalPayoutPerSpin,
        meanReelBag: mc.meanReelBag,
        meanRowMultiplier: mc.meanRowMultiplier,
        meanHighestRowMultiplier: mc.meanHighestRowMultiplier,
        observedProbAtLeastOneRowFull: mc.observedProbAtLeastOneRowFull,
        observedProbAllRowsFull: mc.observedProbAllRowsFull,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PER_REEL_BAG_ROW_MULTIPLIER_COUPLED',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      payout_rel: TOL_PAYOUT_REL,
      reel_bag_rel: TOL_REEL_BAG_REL,
      row_mult_rel: TOL_ROW_MULT_REL,
      prob_row_full_abs: TOL_PROB_ROW_FULL_ABS,
      highest_mult_rel: TOL_HIGHEST_MULT_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# PER_REEL_BAG_ROW_MULTIPLIER_COUPLED — Per-Reel Cash-Bag × Per-Row-Multiplier Coupled Accumulator Acceptance (W185, 66. solver, Vendor B M1 P0 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total spin sims.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Per-Reel Cash-Bag × Per-Row-Multiplier Coupled Accumulator" (Wave 185 — 66. closed-form solver, Vendor B M1 GAP CLOSED — Dragon Spin CrossLink Water + future Vendor B flagship).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-cell Bernoulli × coupled-dimension aggregation. Grid N×M cells, each cell independent Bernoulli(q) landing sa iid value V (μ_V, σ²_V).');
  md.push('  - **Per-reel bag**: B_i = Σ_j I_{ij}·V_{ij}, E[B] = M·q·μ_V (Wald)');
  md.push('  - **Per-row coin count**: C_j ~ Binomial(N, q)');
  md.push('  - **Per-row multiplier**: M_j = m_{C_j} (operator lookup)');
  md.push('  - **Total payout**: Y = Σ_j M_j · S_j, E[Y] = M · μ_V · Σ_c Bin(c;N,q)·m_c·c');
  md.push('  - **P(all rows full)** = q^(N·M); **P(at least one row full)** = 1 − (1−q^N)^M');
  md.push('  - **E[highest row multiplier]** via Σ v · (CDF_max(v) − CDF_max(prev)) sorted-values approach');
  md.push('');
  md.push('MC: per-spin per-cell Bernoulli(q) → Box-Muller Gaussian V (clip ≥ 0), accumulate per-reel bag i per-row sum/count, evaluate Σ M_j(C_j)·S_j.');
  md.push('');
  md.push('## Configs — Per-Reel Bag × Row-Multiplier operator disclosure table');
  md.push('');
  md.push('| Config | Pass | N×M | q | E[Y] CF/MC | E[bag] CF/MC | P(≥1 full) CF/MC | uplift× |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numReels}×${r.cfg.numRows} | ${r.cfg.probCoinLandPerCell} | ${cf.expectedTotalPayoutPerSpin.toFixed(3)}/${mc.meanTotalPayoutPerSpin.toFixed(3)} | ${cf.expectedReelBag.toFixed(3)}/${mc.meanReelBag.toFixed(3)} | ${(cf.probAtLeastOneRowFull * 100).toFixed(2)}%/${(mc.observedProbAtLeastOneRowFull * 100).toFixed(2)}% | ${cf.commercialUpliftVsFlatMultiplier.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — multi-dimensional feature aggregator disclosure.');
  md.push('- **MGA PPD §11** — per-reel + per-row reward transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — dual-dimension accumulator audit.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push('Industry use: Vendor B M1 gap — Dragon Spin CrossLink Water (2024, defining title) + future Vendor B flagship variants extending CrossLink pattern.');

  writeFileSync(join(OUT_DIR, 'PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
