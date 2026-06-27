#!/usr/bin/env node
//
// W152 Wave 174 — Pick-and-Click Pooper Bonus Analyzer acceptance (Wave 173).
//
// 6 industry pick-bonus configs × 20K MC rounds each = 120K total pick-round
// sims. Negative Hypergeometric closed-form cross-validated against
// sample-without-replacement MC.
//
// Operator deliverable: `reports/acceptance/PICK_CLICK_POOPER_BONUS.{json,md}`.
//
// Compliance: UKGC RTS 14 (bonus mechanic disclosure — pooper count + expected
// reveals), MGA PPD §11 (bonus game transparency), AU NCPF Class III (help
// screen — oneInNRoundsZeroPicks), eCOGRA (pick-bonus PMF audit trail).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const ROUNDS = 20_000;
const SEED = 0xCAFE0173;

const TOL_REVEALS_REL = 0.05;     // E[T] rel ≤ 5%
const TOL_PAYOUT_REL = 0.10;      // E[S] rel ≤ 10%
const TOL_ZERO_ABS = 0.01;        // P(T=0) abs ≤ 1pp
const TOL_SURVIVAL_ABS = 0.02;    // P(T≥k) abs ≤ 2pp

const CONFIGS = [
  {
    name: 'A_aristocrat_5dragons_n20_k5',
    description: 'Vendor C 5 Dragons pick-prize bonus: N=20 boxes, K=5 poopers, prize μ=10, σ²=9; E[T]=2.5, P(T=0)=0.25 (1-in-4 immediate bust).',
    cfg: {
      totalBoxes: 20,
      pooperBoxes: 5,
      prizeValueMean: 10,
      prizeValueVar: 9,
      disclosureRevealThresholds: [1, 3, 5],
    },
  },
  {
    name: 'B_bally_quick_hit_n12_k2',
    description: 'Vendor H Quick Hit pick-a-prize: N=12 K=2 (low pooper density, long picks). E[T]=10/3≈3.33, P(T=0)=1/6≈16.7%.',
    cfg: {
      totalBoxes: 12,
      pooperBoxes: 2,
      prizeValueMean: 8,
      prizeValueVar: 6,
      disclosureRevealThresholds: [1, 3, 5, 8],
    },
  },
  {
    name: 'C_netent_gonzo_n15_k3',
    description: 'Vendor D Gonzo\'s Quest Bonus hieroglyph reveal: N=15 K=3 (3 free-fall-pooper masks). E[T]=12/4=3.0, P(T=0)=0.20.',
    cfg: {
      totalBoxes: 15,
      pooperBoxes: 3,
      prizeValueMean: 6,
      prizeValueVar: 4,
      disclosureRevealThresholds: [1, 3, 5, 8],
    },
  },
  {
    name: 'D_igt_wof_pick_a_pack_n10_k1',
    description: 'Vendor A Wheel of Fortune Pick-a-Pack: N=10 K=1 (single pooper, all-can-be-revealed in expectation). E[T]=9/2=4.5, P(T=0)=0.10.',
    cfg: {
      totalBoxes: 10,
      pooperBoxes: 1,
      prizeValueMean: 15,
      prizeValueVar: 12,
      disclosureRevealThresholds: [1, 3, 5, 7],
    },
  },
  {
    name: 'E_konami_china_shores_n8_k4_high_pooper',
    description: 'Konami China Shores high-pooper density: N=8 K=4 (half poopers). E[T]=4/5=0.8, P(T=0)=0.50.',
    cfg: {
      totalBoxes: 8,
      pooperBoxes: 4,
      prizeValueMean: 5,
      prizeValueVar: 4,
      disclosureRevealThresholds: [1, 2, 3],
    },
  },
  {
    name: 'F_corner_buffalo_gold_n25_k2_capped_8',
    description: 'Vendor C Buffalo Gold pick-coin bonus capped at 8 UI reveals (N=25 K=2 prize-rich, cap=8). E[T] capped.',
    cfg: {
      totalBoxes: 25,
      pooperBoxes: 2,
      prizeValueMean: 12,
      prizeValueVar: 10,
      maxReveals: 8,
      disclosureRevealThresholds: [1, 3, 5, 8],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solvePickClickPooperBonus, simulatePickClickPooperBonus } =
    await import(join(REPO_ROOT, 'dist', 'features', 'pickClickPooperBonus.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Pick-and-Click Pooper configs @ ${ROUNDS} MC rounds each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solvePickClickPooperBonus(c.cfg);
    const mc = simulatePickClickPooperBonus(c.cfg, ROUNDS, SEED);

    const revealsRel = relErr(cf.expectedReveals, mc.meanReveals);
    const payoutRel = relErr(cf.expectedTotalPayout, mc.meanTotalPayout);
    const zeroAbs = Math.abs(cf.probZeroReveals - mc.probZeroReveals);

    // Survival check at threshold 3 if available
    const cfTier3 = cf.survivalAtThresholds.find((x) => x.k === 3)?.probAtLeastK ?? 0;
    const mcTier3 = mc.empiricalSurvival.find((x) => x.k === 3)?.probAtLeastK ?? 0;
    const survivalAbs = Math.abs(cfTier3 - mcTier3);

    const checks = {
      reveals_rel: revealsRel,
      payout_rel: payoutRel,
      zero_abs: zeroAbs,
      survival_abs: survivalAbs,
    };
    const pass =
      revealsRel <= TOL_REVEALS_REL &&
      payoutRel <= TOL_PAYOUT_REL &&
      zeroAbs <= TOL_ZERO_ABS &&
      survivalAbs <= TOL_SURVIVAL_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.totalBoxes} K=${c.cfg.pooperBoxes}  ` +
        `E[T]=${cf.expectedReveals.toFixed(3)}/${mc.meanReveals.toFixed(3)}  ` +
        `E[S]=${cf.expectedTotalPayout.toFixed(2)}/${mc.meanTotalPayout.toFixed(2)}  ` +
        `P(T=0)=${(cf.probZeroReveals*100).toFixed(1)}%/${(mc.probZeroReveals*100).toFixed(1)}%  ` +
        `P(T≥3)=${(cfTier3*100).toFixed(1)}%/${(mcTier3*100).toFixed(1)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        prizeBoxes: cf.prizeBoxes,
        effectiveCap: cf.effectiveCap,
        expectedReveals: cf.expectedReveals,
        varianceReveals: cf.varianceReveals,
        stdDevReveals: cf.stdDevReveals,
        expectedTotalPayout: cf.expectedTotalPayout,
        varianceTotalPayout: cf.varianceTotalPayout,
        stdDevTotalPayout: cf.stdDevTotalPayout,
        probZeroReveals: cf.probZeroReveals,
        oneInNRoundsZeroPicks: cf.oneInNRoundsZeroPicks,
        survivalAtThresholds: cf.survivalAtThresholds,
        probReachesCap: cf.probReachesCap,
      },
      monte_carlo: {
        rounds: ROUNDS,
        meanReveals: mc.meanReveals,
        stdDevReveals: mc.stdDevReveals,
        meanTotalPayout: mc.meanTotalPayout,
        stdDevTotalPayout: mc.stdDevTotalPayout,
        probZeroReveals: mc.probZeroReveals,
        empiricalSurvival: mc.empiricalSurvival,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PICK_CLICK_POOPER_BONUS',
    generated_utc: new Date().toISOString(),
    rounds_per_config: ROUNDS,
    seed: SEED,
    tolerances: {
      reveals_rel: TOL_REVEALS_REL,
      payout_rel: TOL_PAYOUT_REL,
      zero_abs: TOL_ZERO_ABS,
      survival_abs: TOL_SURVIVAL_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'PICK_CLICK_POOPER_BONUS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# PICK_CLICK_POOPER_BONUS — Pick-and-Click Pooper Bonus Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${ROUNDS} MC rounds each = ${(CONFIGS.length * ROUNDS / 1e3).toFixed(0)}K total pick-round sims.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Pick-and-Click Pooper Bonus Analyzer" (Wave 173 — 58th solver, Negative Hypergeometric).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Negative Hypergeometric (r=1 failure stop), Johnson-Kotz-Kemp §6.2.4:');
  md.push('  - **T ~ NHG(N, K, r=1)** number of prize reveals before first pooper');
  md.push('  - **E[T] = M/(K+1)** where M = N − K prize boxes');
  md.push('  - **Var[T] = M·(N+1)·K / ((K+1)²·(K+2))**');
  md.push('  - **P(T = 0) = K / N** (first pick is pooper)');
  md.push('  - PMF: P(T=t) = ∏_{j=0..t−1}(M−j)/(N−j) · K/(N−t)');
  md.push('  - **Wald** compound for total payout S = Σ V_i:');
  md.push('    - E[S] = E[T]·μ_V');
  md.push('    - Var[S] = E[T]·σ²_V + Var[T]·μ_V²');
  md.push('  - Cap truncation: residual mass into cap bucket (truncated PMF sums to 1).');
  md.push('');
  md.push('MC: 20K rounds per config, partial Fisher-Yates shuffle until pooper or cap; Gaussian prize draws (Box-Muller), mulberry32 RNG.');
  md.push('');
  md.push('## Configs — pick-bonus operator disclosure table');
  md.push('');
  md.push('| Config | Pass | N | K | E[T] CF/MC | E[S] CF/MC | P(T=0) CF/MC | P(T≥3) CF/MC |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    const cfT3 = cf.survivalAtThresholds.find((x) => x.k === 3)?.probAtLeastK ?? 0;
    const mcT3 = mc.empiricalSurvival.find((x) => x.k === 3)?.probAtLeastK ?? 0;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.totalBoxes} | ${r.cfg.pooperBoxes} | ${cf.expectedReveals.toFixed(3)}/${mc.meanReveals.toFixed(3)} | ${cf.expectedTotalPayout.toFixed(2)}/${mc.meanTotalPayout.toFixed(2)} | ${(cf.probZeroReveals*100).toFixed(1)}%/${(mc.probZeroReveals*100).toFixed(1)}% | ${(cfT3*100).toFixed(1)}%/${(mcT3*100).toFixed(1)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — bonus mechanic disclosure: operator must show pooper count + expected reveals on help screen.');
  md.push('- **MGA PPD §11** — bonus game transparency: PMF auditor-accessible.');
  md.push('- **AU NCPF Class III** — bonus help screen must include "1-in-X rounds first pick is pooper" disclosure.');
  md.push('- **eCOGRA Generic Slots Audit** — pick-bonus PMF audit trail across all reveal positions.');
  md.push('');
  md.push('Industry use: Vendor C 5 Dragons / Buffalo Gold pick-coin, Vendor H Quick Hit pick-a-prize, Vendor D Gonzo\'s');
  md.push('Quest hieroglyph reveal, Vendor A Wheel of Fortune Pick-a-Pack, Konami China Shores, Vendor B Wonder 4.');

  writeFileSync(join(OUT_DIR, 'PICK_CLICK_POOPER_BONUS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/PICK_CLICK_POOPER_BONUS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
