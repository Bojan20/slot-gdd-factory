#!/usr/bin/env node
//
// W152 Wave 184 — Colossal Reels Wild-Transfer Two-Grid Aggregator acceptance
// (65. solver, Vendor B M7 P0 GAP CLOSURE — Spartacus family + 50+ WMS land-based titles).
//
// 6 industry configs × 30K MC spins each = 180K total spin sims sa per-reel
// Bernoulli main + Bernoulli transfer MC vs exact 2-stage Binomial closed-form.
//
// Operator deliverable: `reports/acceptance/COLOSSAL_REELS_WILD_TRANSFER.{json,md}`.
//
// Compliance: UKGC RTS 14 (multi-grid feature disclosure), MGA PPD §11
// (coupled-grid mechanic transparency), eCOGRA Generic Slots Audit (joint-grid
// evaluation audit), EU GA 2024.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 30_000;
const SEED = 0xCAFE0184;

const TOL_K_MAIN_REL = 0.03;
const TOL_K_COL_REL = 0.10;       // rare-K_col cases (q_t < 0.1) inflate rel error
const TOL_PMF_ABS = 0.025;
const TOL_BOTH_PROB_ABS = 0.03;
const TOL_PAYOUT_REL = 0.30;      // heavy-tail joint-bonus jackpot dominates @ 30K spins

const CONFIGS = [
  {
    name: "A_spartacus_gladiator_of_rome_5reel_high_transfer",
    description: "WMS Spartacus Gladiator of Rome (2012, defining title) — 5×4 main + 5×12 colossal, q_t=0.85.",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.10, 0.10, 0.12, 0.10, 0.10],
      probTransferToColossal: 0.85,
      payoutMainGivenWildReels: [0, 0, 0.5, 5, 50, 500],
      payoutColossalGivenWildReels: [0, 0, 1, 10, 100, 1000],
    },
  },
  {
    name: "B_super_colossal_reels_full_transfer",
    description: "Spartacus Super Colossal Reels (2019) — full transfer (q_t=1.0), higher wild density.",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.15, 0.15, 0.18, 0.15, 0.15],
      probTransferToColossal: 1.0,
      payoutMainGivenWildReels: [0, 0, 1, 10, 100, 1000],
      payoutColossalGivenWildReels: [0, 0, 2, 20, 200, 2000],
    },
  },
  {
    name: "C_call_to_arms_50_payline_low_transfer",
    description: "Spartacus Call to Arms (2017) — 50 paylines, lower transfer q_t=0.70.",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.08, 0.08, 0.10, 0.08, 0.08],
      probTransferToColossal: 0.70,
      payoutMainGivenWildReels: [0, 0, 0.3, 3, 30, 300],
      payoutColossalGivenWildReels: [0, 0, 0.5, 5, 50, 1500],
    },
  },
  {
    name: "D_wms_landbase_caesar_empire_uniform_high_density",
    description: "WMS Caesar's Empire-class dependent — uniform 20% wild density, q_t=0.80.",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.20, 0.20, 0.20, 0.20, 0.20],
      probTransferToColossal: 0.80,
      payoutMainGivenWildReels: [0, 0, 0.5, 4, 40, 400],
      payoutColossalGivenWildReels: [0, 0, 1, 8, 80, 800],
    },
  },
  {
    name: "E_corner_low_transfer_independent_split",
    description: "Corner: q_t=0.05 near-independent grids (test independence-baseline degeneracy).",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.12, 0.12, 0.12, 0.12, 0.12],
      probTransferToColossal: 0.05,
      payoutMainGivenWildReels: [0, 0, 0.5, 5, 50, 500],
      payoutColossalGivenWildReels: [0, 0, 1, 10, 100, 1000],
    },
  },
  {
    name: "F_corner_joint_bonus_full_wild_jackpot",
    description: "Corner: joint-bonus matrix sa large bonus za full-wild both grids (regulator disclosure case).",
    cfg: {
      numReels: 5,
      perReelMainWildProb: [0.10, 0.10, 0.10, 0.10, 0.10],
      probTransferToColossal: 0.90,
      payoutMainGivenWildReels: [0, 0, 0.5, 5, 50, 500],
      payoutColossalGivenWildReels: [0, 0, 1, 10, 100, 1000],
      jointBonusPayoutMatrix: [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 10000],
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeColossalReelsWildTransfer, simulateColossalReelsWildTransfer } = await import(
    join(REPO_ROOT, 'dist', 'features', 'colossalReelsWildTransfer.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Colossal Reels Wild-Transfer configs @ ${SPINS} MC spins each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeColossalReelsWildTransfer(c.cfg);
    const mc = simulateColossalReelsWildTransfer(c.cfg, SPINS, SEED);

    const kMainRel = relErr(cf.expectedWildReelsMain, mc.meanWildReelsMain);
    const kColRel =
      mc.meanWildReelsColossal > 0.001
        ? relErr(cf.expectedWildReelsColossal, mc.meanWildReelsColossal)
        : Math.abs(cf.expectedWildReelsColossal - mc.meanWildReelsColossal);
    let maxPmfAbs = 0;
    for (let k = 0; k <= c.cfg.numReels; k++) {
      const a = Math.abs(cf.pmfWildReelsMain[k] - mc.observedPmfWildReelsMain[k]);
      if (a > maxPmfAbs) maxPmfAbs = a;
    }
    const bothAbs = Math.abs(cf.probBothGridsAtLeastOneWild - mc.observedProbBothGridsAtLeastOne);
    const payoutRel =
      cf.expectedTotalPayoutPerSpin > 0.001
        ? relErr(cf.expectedTotalPayoutPerSpin, mc.meanTotalPayoutPerSpin)
        : Math.abs(cf.expectedTotalPayoutPerSpin - mc.meanTotalPayoutPerSpin);

    const checks = {
      k_main_rel: kMainRel,
      k_col_rel: kColRel,
      max_pmf_abs: maxPmfAbs,
      both_prob_abs: bothAbs,
      payout_rel: payoutRel,
    };
    const pass =
      kMainRel <= TOL_K_MAIN_REL &&
      kColRel <= TOL_K_COL_REL &&
      maxPmfAbs <= TOL_PMF_ABS &&
      bothAbs <= TOL_BOTH_PROB_ABS &&
      payoutRel <= TOL_PAYOUT_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(56)} ${pass ? '✅' : '❌'}  ` +
        `q_t=${c.cfg.probTransferToColossal.toFixed(2)}  ` +
        `E[K_main]=${cf.expectedWildReelsMain.toFixed(3)}/${mc.meanWildReelsMain.toFixed(3)}  ` +
        `E[K_col]=${cf.expectedWildReelsColossal.toFixed(3)}/${mc.meanWildReelsColossal.toFixed(3)}  ` +
        `P(both≥1)=${(cf.probBothGridsAtLeastOneWild * 100).toFixed(2)}%/${(mc.observedProbBothGridsAtLeastOne * 100).toFixed(2)}%  ` +
        `E[Y]=${cf.expectedTotalPayoutPerSpin.toFixed(4)}/${mc.meanTotalPayoutPerSpin.toFixed(4)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        pmfWildReelsMain: cf.pmfWildReelsMain,
        pmfWildReelsColossal: cf.pmfWildReelsColossal,
        expectedWildReelsMain: cf.expectedWildReelsMain,
        varianceWildReelsMain: cf.varianceWildReelsMain,
        expectedWildReelsColossal: cf.expectedWildReelsColossal,
        varianceWildReelsColossal: cf.varianceWildReelsColossal,
        expectedTotalPayoutPerSpin: cf.expectedTotalPayoutPerSpin,
        probBothGridsAtLeastOneWild: cf.probBothGridsAtLeastOneWild,
        probFullWildBothGrids: cf.probFullWildBothGrids,
        oneInNSpinsFullWildBothGrids: cf.oneInNSpinsFullWildBothGrids,
        commercialUpliftVsIndependentSplit: cf.commercialUpliftVsIndependentSplit,
      },
      monte_carlo: {
        spins: SPINS,
        meanWildReelsMain: mc.meanWildReelsMain,
        meanWildReelsColossal: mc.meanWildReelsColossal,
        meanTotalPayoutPerSpin: mc.meanTotalPayoutPerSpin,
        observedPmfWildReelsMain: mc.observedPmfWildReelsMain,
        observedPmfWildReelsColossal: mc.observedPmfWildReelsColossal,
        observedProbBothGridsAtLeastOne: mc.observedProbBothGridsAtLeastOne,
        observedProbFullWildBothGrids: mc.observedProbFullWildBothGrids,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'COLOSSAL_REELS_WILD_TRANSFER',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      k_main_rel: TOL_K_MAIN_REL,
      k_col_rel: TOL_K_COL_REL,
      max_pmf_abs: TOL_PMF_ABS,
      both_prob_abs: TOL_BOTH_PROB_ABS,
      payout_rel: TOL_PAYOUT_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'COLOSSAL_REELS_WILD_TRANSFER.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# COLOSSAL_REELS_WILD_TRANSFER — Colossal Reels Wild-Transfer Two-Grid Aggregator Acceptance (W184, 65. solver, Vendor B M7 P0 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total spin sims.`);
  md.push('');
  md.push("Closes Faza 12 ext (post-W100): ✅ \"Colossal Reels Wild-Transfer Two-Grid Aggregator\" (Wave 184 — 65. closed-form solver, Vendor B M7 GAP CLOSED — Spartacus family + 50+ WMS land-based titles).");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('2-stage Binomial sa conditional coupling. Stage 1: K_main = # wild reels on main grid via per-reel-non-uniform DP O(N²). Stage 2: K_col | K_main ~ Binomial(K_main, q_t). Joint PMF eksplicitno enumerisana.');
  md.push('  - **E[K_col] = q_t · E[K_main]** (law of total expectation)');
  md.push('  - **Var[K_col] = q_t·(1−q_t)·E[K_main] + q_t²·Var[K_main]** (law of total variance)');
  md.push('  - **P(full wild both grids) = P(K_main=N) · q_t^N**');
  md.push('  - **E[Y] = Σ P(K_main=k) · [payoutMain[k] + Σ P(K_col=j|K_main=k) · (payoutCol[j] + jointBonus[k][j])]**');
  md.push('');
  md.push('MC: per-spin per-reel Bernoulli(p_w_i) main wild + conditional Bernoulli(q_t) transfer, accumulate payout, count P(both ≥ 1).');
  md.push('');
  md.push('## Configs — Colossal Reels Wild-Transfer operator disclosure table');
  md.push('');
  md.push('| Config | Pass | q_t | E[K_main] CF/MC | E[K_col] CF/MC | P(both≥1) CF/MC | E[Y] CF/MC |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.probTransferToColossal.toFixed(2)} | ${cf.expectedWildReelsMain.toFixed(3)}/${mc.meanWildReelsMain.toFixed(3)} | ${cf.expectedWildReelsColossal.toFixed(3)}/${mc.meanWildReelsColossal.toFixed(3)} | ${(cf.probBothGridsAtLeastOneWild * 100).toFixed(2)}%/${(mc.observedProbBothGridsAtLeastOne * 100).toFixed(2)}% | ${cf.expectedTotalPayoutPerSpin.toFixed(4)}/${mc.meanTotalPayoutPerSpin.toFixed(4)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — multi-grid feature disclosure.');
  md.push('- **MGA PPD §11** — coupled-grid mechanic transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — joint-grid evaluation audit.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push('Industry use: Vendor B M7 gap — WMS Spartacus Gladiator of Rome (2012, defining title 100 paylines 5×4+5×12), Super Colossal Reels (2019 full transfer), Call to Arms (2017 50 paylines variant), 50+ WMS land-based dependent titles (Caesar Empire, Forbidden Dragons, etc.).');

  writeFileSync(join(OUT_DIR, 'COLOSSAL_REELS_WILD_TRANSFER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/COLOSSAL_REELS_WILD_TRANSFER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
