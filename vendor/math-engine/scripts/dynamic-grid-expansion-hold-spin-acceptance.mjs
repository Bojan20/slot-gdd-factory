#!/usr/bin/env node
//
// W152 Wave 182 — Dynamic Grid-Expansion Hold-and-Spin Aggregator
// acceptance (63. solver, Vendor B M3 GAP CLOSURE — Ultimate Fire Link + Lock It
// Link Eureka families, 8+ titles).
//
// 6 industry-representative configs × 30K MC features each = 180K total feature
// sims. Markov-DP exact closed-form cross-validated against per-spin
// Binomial(empty, q) MC with full grid-expansion + 3-stale termination logic.
//
// Operator deliverable: `reports/acceptance/DYNAMIC_GRID_EXPANSION_HOLD_SPIN.{json,md}`.
//
// Compliance: UKGC RTS 14 (grid-expansion feature mechanic disclosure), MGA PPD
// §11 (H&S trigger + dynamic-state transparency), eCOGRA Generic Slots Audit
// (grid evolution audit trail), EU GA 2024.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const FEATURES = 30_000;
const SEED = 0xCAFE0182;

// DP-exact vs MC tolerances — DP is exact so tolerances can be tight:
const TOL_BAGS_REL = 0.05;        // E[bags] rel ≤ 5%
const TOL_ROWEXT_ABS = 0.10;      // E[# row extensions] abs ≤ 0.10
const TOL_SPINS_REL = 0.08;       // E[spins to terminate] rel ≤ 8%
const TOL_PAYOUT_REL = 0.08;      // E[payout] rel ≤ 8%
const TOL_FULLGRID_ABS = 0.05;    // P(full max grid) abs ≤ 5pp

const CONFIGS = [
  {
    name: 'A_ultimate_fire_link_olvera_street',
    description:
      'Vendor B Ultimate Fire Link Olvera Street — 5 reels × 3 rows initial, +4 extension rows (max 5×7), q=0.10, thresholds [5,9,14,20], μ_V=2.5× bet.',
    cfg: {
      numReels: 5,
      initialRows: 3,
      maxExtraRows: 4,
      probLandingPerEmptyCell: 0.10,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [5, 9, 14, 20],
      expectedValuePerBag: 2.5,
      varianceValuePerBag: 2,
    },
  },
  {
    name: 'B_lock_it_link_eureka_reel_blast',
    description:
      'Vendor H Pattern-LIL Eureka Reel Blast — 5×4 initial, +3 rows (max 5×7), q=0.12 (dynamite scatters more frequent), thresholds [6,12,18], μ_V=3× bet high-vol.',
    cfg: {
      numReels: 5,
      initialRows: 4,
      maxExtraRows: 3,
      probLandingPerEmptyCell: 0.12,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [6, 12, 18],
      expectedValuePerBag: 3,
      varianceValuePerBag: 4,
    },
  },
  {
    name: 'C_ultimate_fire_link_power4_high_vol',
    description:
      'Ultimate Fire Link Power 4 — 4 reels × 4 rows, +2 extension rows, q=0.18 high-freq, thresholds [5,11], μ_V=4× bet high-vol.',
    cfg: {
      numReels: 4,
      initialRows: 4,
      maxExtraRows: 2,
      probLandingPerEmptyCell: 0.18,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [5, 11],
      expectedValuePerBag: 4,
      varianceValuePerBag: 8,
    },
  },
  {
    name: 'D_ultimate_fire_link_china_street_low_vol',
    description:
      'Ultimate Fire Link China Street — 5×3, +3 rows, q=0.08 low-vol, thresholds [4,9,16], μ_V=2× bet (frequent low-payout features).',
    cfg: {
      numReels: 5,
      initialRows: 3,
      maxExtraRows: 3,
      probLandingPerEmptyCell: 0.08,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [4, 9, 16],
      expectedValuePerBag: 2,
      varianceValuePerBag: 1,
    },
  },
  {
    name: 'E_corner_single_extension_aggressive_threshold',
    description:
      'Corner: 3×3 with only 1 extension at threshold 8 — sparse activation case (P(full max grid) small).',
    cfg: {
      numReels: 3,
      initialRows: 3,
      maxExtraRows: 1,
      probLandingPerEmptyCell: 0.10,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [8],
      expectedValuePerBag: 1.5,
      varianceValuePerBag: 1,
    },
  },
  {
    name: 'F_corner_fixed_grid_no_extension',
    description:
      'Corner: maxExtraRows=0, no expansion — pure baseline H&S (validates engine degenerates to fixed-grid).',
    cfg: {
      numReels: 5,
      initialRows: 3,
      maxExtraRows: 0,
      probLandingPerEmptyCell: 0.15,
      staleSpinsBeforeBust: 3,
      rowExtensionThresholds: [],
      expectedValuePerBag: 2,
      varianceValuePerBag: 1,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeDynamicGridExpansion, simulateDynamicGridExpansion } = await import(
    join(REPO_ROOT, 'dist', 'features', 'dynamicGridExpansionHoldSpin.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Dynamic Grid-Expansion H&S configs @ ${FEATURES} MC features each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeDynamicGridExpansion(c.cfg);
    const mc = simulateDynamicGridExpansion(c.cfg, FEATURES, SEED);

    const bagsRel = relErr(cf.expectedTotalBags, mc.meanTotalBags);
    const rowExtAbs = Math.abs(cf.expectedRowExtensions - mc.meanRowExtensions);
    const spinsRel = relErr(cf.expectedSpinsToTermination, mc.meanSpinsToTermination);
    const payoutRel = relErr(cf.expectedTotalPayout, mc.meanTotalPayout);
    const fullGridAbs = Math.abs(cf.probFullMaxGridAchieved - mc.probFullMaxGridAchieved);

    const checks = {
      bags_rel: bagsRel,
      row_ext_abs: rowExtAbs,
      spins_rel: spinsRel,
      payout_rel: payoutRel,
      full_grid_abs: fullGridAbs,
    };

    const pass =
      bagsRel <= TOL_BAGS_REL &&
      rowExtAbs <= TOL_ROWEXT_ABS &&
      spinsRel <= TOL_SPINS_REL &&
      payoutRel <= TOL_PAYOUT_REL &&
      fullGridAbs <= TOL_FULLGRID_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `N×m₀=${c.cfg.numReels}×${c.cfg.initialRows} +${c.cfg.maxExtraRows}rows q=${c.cfg.probLandingPerEmptyCell}  ` +
        `E[bags]=${cf.expectedTotalBags.toFixed(1)}/${mc.meanTotalBags.toFixed(1)}  ` +
        `E[#ext]=${cf.expectedRowExtensions.toFixed(2)}/${mc.meanRowExtensions.toFixed(2)}  ` +
        `E[spins]=${cf.expectedSpinsToTermination.toFixed(1)}/${mc.meanSpinsToTermination.toFixed(1)}  ` +
        `P(full)=${(cf.probFullMaxGridAchieved * 100).toFixed(1)}%/${(mc.probFullMaxGridAchieved * 100).toFixed(1)}%  ` +
        `uplift=${cf.commercialUpliftVsFixedGrid.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedTotalBags: cf.expectedTotalBags,
        varianceTotalBags: cf.varianceTotalBags,
        expectedFinalActiveCells: cf.expectedFinalActiveCells,
        rowExtensionProbabilities: cf.rowExtensionProbabilities,
        expectedRowExtensions: cf.expectedRowExtensions,
        expectedFinalRowCount: cf.expectedFinalRowCount,
        expectedSpinsToTermination: cf.expectedSpinsToTermination,
        varianceSpinsToTermination: cf.varianceSpinsToTermination,
        expectedTotalPayout: cf.expectedTotalPayout,
        stdDevTotalPayout: cf.stdDevTotalPayout,
        probFullMaxGridAchieved: cf.probFullMaxGridAchieved,
        oneInNFeaturesMaxGrid: cf.oneInNFeaturesMaxGrid,
        commercialUpliftVsFixedGrid: cf.commercialUpliftVsFixedGrid,
        effectiveSteadyStateLandingProb: cf.effectiveSteadyStateLandingProb,
      },
      monte_carlo: {
        features: FEATURES,
        meanTotalBags: mc.meanTotalBags,
        meanFinalActiveCells: mc.meanFinalActiveCells,
        meanRowExtensions: mc.meanRowExtensions,
        meanFinalRowCount: mc.meanFinalRowCount,
        meanSpinsToTermination: mc.meanSpinsToTermination,
        meanTotalPayout: mc.meanTotalPayout,
        stdDevTotalPayout: mc.stdDevTotalPayout,
        probFullMaxGridAchieved: mc.probFullMaxGridAchieved,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'DYNAMIC_GRID_EXPANSION_HOLD_SPIN',
    generated_utc: new Date().toISOString(),
    features_per_config: FEATURES,
    seed: SEED,
    tolerances: {
      bags_rel: TOL_BAGS_REL,
      row_ext_abs: TOL_ROWEXT_ABS,
      spins_rel: TOL_SPINS_REL,
      payout_rel: TOL_PAYOUT_REL,
      full_grid_abs: TOL_FULLGRID_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'DYNAMIC_GRID_EXPANSION_HOLD_SPIN.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# DYNAMIC_GRID_EXPANSION_HOLD_SPIN — Dynamic Grid-Expansion Hold-and-Spin Aggregator Acceptance (W179, 63. solver, Vendor B M3 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${FEATURES} MC features each = ${(CONFIGS.length * FEATURES / 1e3).toFixed(0)}K total feature simulations.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Dynamic Grid-Expansion Hold-and-Spin Aggregator" (Wave 182 — 63. closed-form solver, Vendor B M3 GAP CLOSED).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Exact Markov DP over state (active_cells, current_rows_idx, stale_streak) sa per-spin Binomial(empty, q) landing PMF.');
  md.push('  - **State space**: (a, m_idx, s) gde a ∈ [0, N·m_max], m_idx ∈ [0, R], s ∈ [0, k_stale)');
  md.push('  - **Transition**: per spin, B ~ Binomial(N·m_now − a, q); newA = a+B; row extensions triggered iff cumLandings ≥ T_k');
  md.push('  - **Termination**: stale == k_stale OR newA == N·m_max');
  md.push('  - **Aggregates**: E[bags], E[#extensions], E[spins], P(full max grid) iz terminal-state mass');
  md.push('');
  md.push('MC: per-feature exact Binomial(empty, q) landings sa cumulative-threshold extension triggering + 3-stale termination, mulberry32 RNG.');
  md.push('');
  md.push('## Configs — Dynamic Grid-Expansion H&S operator disclosure table');
  md.push('');
  md.push('| Config | Pass | N×m₀ | +rows | q | E[bags] CF/MC | E[#ext] CF/MC | E[spins] CF/MC | P(full grid) CF/MC | uplift× |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numReels}×${r.cfg.initialRows} | +${r.cfg.maxExtraRows} | ${r.cfg.probLandingPerEmptyCell} | ${cf.expectedTotalBags.toFixed(1)}/${mc.meanTotalBags.toFixed(1)} | ${cf.expectedRowExtensions.toFixed(2)}/${mc.meanRowExtensions.toFixed(2)} | ${cf.expectedSpinsToTermination.toFixed(1)}/${mc.meanSpinsToTermination.toFixed(1)} | ${(cf.probFullMaxGridAchieved * 100).toFixed(1)}%/${(mc.probFullMaxGridAchieved * 100).toFixed(1)}% | ${cf.commercialUpliftVsFixedGrid.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — grid-expansion feature mechanic disclosure (operator must show row-extension trigger thresholds + average grid-end state).');
  md.push('- **MGA PPD §11** — H&S trigger + dynamic-grid transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — grid evolution audit trail per feature.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push('Industry use: Vendor B M3 gap — Ultimate Fire Link family (Olvera Street, China Street, Riverwalk, Boardwalk, Route 66, Power 4, Cash Falls, Explosion — 7+ variants),');
  md.push('Pattern-LIL Eureka Reel Blast (Vendor H) sa dynamite-scatter row-add trigger.');

  writeFileSync(join(OUT_DIR, 'DYNAMIC_GRID_EXPANSION_HOLD_SPIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/DYNAMIC_GRID_EXPANSION_HOLD_SPIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
