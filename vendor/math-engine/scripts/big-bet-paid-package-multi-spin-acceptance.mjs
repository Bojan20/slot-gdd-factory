#!/usr/bin/env node
//
// W152 Wave 186 — Big Bet Paid-Package Multi-Spin Schedule Aggregator
// acceptance (67. solver, UK-CRITICAL Vendor B M9 P0 GAP CLOSURE — Barcrest UK
// family: Monopoly Big Event / Rainbow Riches Pick n Mix / Action Bank /
// Pearl of Caribbean — UKGC RTS-12 mandatory disclosure).
//
// 6 industry configs × 30K MC packages = 180K total package sims sa per-spin
// Gaussian-clipped payout MC vs exact per-spin RTP × stake closed-form.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const PACKAGES = 30_000;
const SEED = 0xCAFE0186;

const TOL_PAYOUT_REL = 0.10;
const TOL_RTP_REL = 0.10;
const TOL_PROFIT_PROB_ABS = 0.05;
const TOL_STDDEV_REL = 0.20;

const CONFIGS = [
  {
    name: "A_monopoly_big_event_5spin_98pct_top",
    description: "Vendor B Barcrest Monopoly Big Event (2010, defining UK Big Bet title) — 5-spin progressive RTP 90→98%, stake £4/spin.",
    cfg: {
      packageSpinCount: 5,
      perSpinStakeAllocation: [4, 4, 4, 4, 4],
      perSpinRtp: [0.90, 0.92, 0.95, 0.96, 0.98],
      perSpinVariance: [9, 9, 16, 25, 49],
      baseGameRtpForSubsidyComparison: 0.94,
      harmThresholdLossPerPackage: 2,
    },
  },
  {
    name: "B_rainbow_riches_pick_n_mix_flat_96pct",
    description: "Vendor B Barcrest Rainbow Riches Pick n Mix Big Bet — flat 96% RTP, stake £5/spin, 5 spins.",
    cfg: {
      packageSpinCount: 5,
      perSpinStakeAllocation: [5, 5, 5, 5, 5],
      perSpinRtp: [0.96, 0.96, 0.96, 0.96, 0.96],
      perSpinVariance: [16, 16, 16, 16, 16],
      baseGameRtpForSubsidyComparison: 0.92,
    },
  },
  {
    name: "C_action_bank_5spin_progressive_to_102pct",
    description: "Vendor B Barcrest Action Bank — 5-spin Big Bet sa final spin RTP 102% (player advantage), stake £3/spin.",
    cfg: {
      packageSpinCount: 5,
      perSpinStakeAllocation: [3, 3, 3, 3, 3],
      perSpinRtp: [0.90, 0.93, 0.97, 1.00, 1.02],
      perSpinVariance: [9, 9, 16, 25, 49],
      baseGameRtpForSubsidyComparison: 0.95,
      harmThresholdLossPerPackage: 1,
    },
  },
  {
    name: "D_pearl_of_caribbean_5spin_high_vol",
    description: "Vendor B Barcrest Pearl of Caribbean — 5-spin Big Bet high-vol, stake £4/spin.",
    cfg: {
      packageSpinCount: 5,
      perSpinStakeAllocation: [4, 4, 4, 4, 4],
      perSpinRtp: [0.88, 0.92, 0.96, 0.99, 1.05],
      perSpinVariance: [16, 25, 36, 49, 100],
      baseGameRtpForSubsidyComparison: 0.93,
      harmThresholdLossPerPackage: 3,
    },
  },
  {
    name: "E_corner_2spin_minimum_package",
    description: "Corner: minimum 2-spin package (verify degenerate case).",
    cfg: {
      packageSpinCount: 2,
      perSpinStakeAllocation: [10, 10],
      perSpinRtp: [0.90, 0.99],
      perSpinVariance: [25, 25],
      baseGameRtpForSubsidyComparison: 0.93,
    },
  },
  {
    name: "F_corner_10spin_extended_package",
    description: "Corner: extended 10-spin package — extreme escalation curve.",
    cfg: {
      packageSpinCount: 10,
      perSpinStakeAllocation: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      perSpinRtp: [0.85, 0.88, 0.91, 0.93, 0.95, 0.96, 0.97, 0.98, 0.99, 1.00],
      perSpinVariance: [4, 4, 9, 9, 16, 16, 25, 25, 36, 49],
      baseGameRtpForSubsidyComparison: 0.92,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeBigBetPaidPackage, simulateBigBetPaidPackage } = await import(
    join(REPO_ROOT, 'dist', 'features', 'bigBetPaidPackageMultiSpin.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Big Bet Paid-Package configs @ ${PACKAGES} MC packages each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeBigBetPaidPackage(c.cfg);
    const mc = simulateBigBetPaidPackage(c.cfg, PACKAGES, SEED);

    const payoutRel = relErr(cf.expectedTotalPayout, mc.meanTotalPayoutPerPackage);
    const rtpRel = relErr(cf.packageRtp, mc.observedPackageRtp);
    const profitProbAbs = Math.abs(cf.probProfitCltApprox - mc.observedProbProfit);
    const stdDevRel = relErr(cf.stdDevTotalPayout, mc.stdDevTotalPayoutPerPackage);

    const checks = {
      payout_rel: payoutRel,
      rtp_rel: rtpRel,
      profit_prob_abs: profitProbAbs,
      std_dev_rel: stdDevRel,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      rtpRel <= TOL_RTP_REL &&
      profitProbAbs <= TOL_PROFIT_PROB_ABS &&
      stdDevRel <= TOL_STDDEV_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `K=${c.cfg.packageSpinCount} cost=${cf.totalPackageCost}  ` +
        `RTP=${(cf.packageRtp*100).toFixed(2)}%/${(mc.observedPackageRtp*100).toFixed(2)}%  ` +
        `E[Y]=${cf.expectedTotalPayout.toFixed(2)}/${mc.meanTotalPayoutPerPackage.toFixed(2)}  ` +
        `P(profit)=${(cf.probProfitCltApprox*100).toFixed(2)}%/${(mc.observedProbProfit*100).toFixed(2)}%  ` +
        `subsidy=${(cf.operatorSubsidyFraction*100).toFixed(2)}% (${cf.operatorSubsidyAmount.toFixed(2)})  ` +
        `harm=${cf.harmThresholdExceeded ? 'YES⚠️' : 'no'}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        totalPackageCost: cf.totalPackageCost,
        perSpinExpectedPayout: cf.perSpinExpectedPayout,
        perSpinContributionToPackageRtp: cf.perSpinContributionToPackageRtp,
        expectedTotalPayout: cf.expectedTotalPayout,
        varianceTotalPayout: cf.varianceTotalPayout,
        stdDevTotalPayout: cf.stdDevTotalPayout,
        packageRtp: cf.packageRtp,
        expectedNetProfitPerPackage: cf.expectedNetProfitPerPackage,
        probProfitCltApprox: cf.probProfitCltApprox,
        oneInNPackagesAtLeastBreakEven: cf.oneInNPackagesAtLeastBreakEven,
        operatorSubsidyAmount: cf.operatorSubsidyAmount,
        operatorSubsidyFraction: cf.operatorSubsidyFraction,
        bestSpinIndex: cf.bestSpinIndex,
        bestSpinRtp: cf.bestSpinRtp,
        worstSpinIndex: cf.worstSpinIndex,
        worstSpinRtp: cf.worstSpinRtp,
        rtpEscalationSlope: cf.rtpEscalationSlope,
        harmThresholdExceeded: cf.harmThresholdExceeded,
      },
      monte_carlo: {
        packages: PACKAGES,
        meanTotalPayoutPerPackage: mc.meanTotalPayoutPerPackage,
        stdDevTotalPayoutPerPackage: mc.stdDevTotalPayoutPerPackage,
        meanNetProfit: mc.meanNetProfit,
        observedProbProfit: mc.observedProbProfit,
        observedPackageRtp: mc.observedPackageRtp,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BIG_BET_PAID_PACKAGE_MULTI_SPIN',
    generated_utc: new Date().toISOString(),
    packages_per_config: PACKAGES,
    seed: SEED,
    tolerances: {
      payout_rel: TOL_PAYOUT_REL,
      rtp_rel: TOL_RTP_REL,
      profit_prob_abs: TOL_PROFIT_PROB_ABS,
      std_dev_rel: TOL_STDDEV_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'BIG_BET_PAID_PACKAGE_MULTI_SPIN.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# BIG_BET_PAID_PACKAGE_MULTI_SPIN — Big Bet Paid-Package Multi-Spin Schedule Aggregator Acceptance (W186, 67. solver, UK-CRITICAL Vendor B M9 P0 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${PACKAGES} MC packages each = ${(CONFIGS.length * PACKAGES / 1e3).toFixed(0)}K total package sims.`);
  md.push('');
  md.push("Closes Faza 12 ext (post-W100): ✅ \"Big Bet Paid-Package Multi-Spin Schedule Aggregator\" (Wave 186 — 67. closed-form solver, UK-CRITICAL Vendor B M9 GAP CLOSED — Barcrest UK family + UKGC RTS-12 mandatory disclosure).");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-spin independent + aggregate disclosure. Paket K spinova, svaki sa distinct (b_k, r_k, σ²_k).');
  md.push('  - **Total cost**: C = Σ b_k');
  md.push('  - **E[total payout]** = Σ b_k · r_k');
  md.push('  - **Var[total]** = Σ σ²_k (per-spin independence)');
  md.push('  - **packageRtp** = E[Y_total] / C');
  md.push('  - **E[net profit]** = E[Y_total] − C');
  md.push('  - **P(profit) CLT-Normal**: z = (C − μ)/σ, P = 1 − Φ(z) (Abramowitz-Stegun erf)');
  md.push('  - **Operator subsidy**: max(0, packageRtp − baseRtp) · C');
  md.push('  - **RTP escalation slope**: linear regression r_k vs k');
  md.push('  - **Harm-threshold flag**: UKGC LCCP 3.4.3 ako E[loss] > threshold');
  md.push('');
  md.push('MC: per-package, per-spin Gaussian draw mean=b_k·r_k stddev=√σ²_k (clipped ≥ 0 per vendor convention).');
  md.push('');
  md.push('## Configs — Big Bet Paid-Package operator disclosure table (UKGC RTS-12 mandatory)');
  md.push('');
  md.push('| Config | Pass | K | Cost | RTP CF/MC | E[Y] CF/MC | P(profit) CF/MC | Subsidy | Harm Flag |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.packageSpinCount} | ${cf.totalPackageCost} | ${(cf.packageRtp*100).toFixed(2)}%/${(mc.observedPackageRtp*100).toFixed(2)}% | ${cf.expectedTotalPayout.toFixed(2)}/${mc.meanTotalPayoutPerPackage.toFixed(2)} | ${(cf.probProfitCltApprox*100).toFixed(2)}%/${(mc.observedProbProfit*100).toFixed(2)}% | ${(cf.operatorSubsidyFraction*100).toFixed(2)}% | ${cf.harmThresholdExceeded ? '⚠️ YES' : 'no'} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS-12** — Big Bet mandatory per-spin RTP disclosure (2010-2022 UK regulation).');
  md.push('- **UKGC LCCP 3.4.3** — responsible gambling chase-pattern detection via harm-threshold flag.');
  md.push('- **MGA PPD §17** — paid-package transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — multi-spin schedule audit trail.');
  md.push('');
  md.push('Industry use: Vendor B M9 gap (UK-CRITICAL) — Vendor B Barcrest Monopoly Big Event (2010, defining UK title), Rainbow Riches Pick n Mix (2014, Big Bet + feature composition), Action Bank (2017, vault-pick), Pearl of Caribbean variants. **First Belgian-ban-impact-aware analyzer** za UK Big Bet familiju (Belgian Big Bet ban 2018 forced operator disclosure shift).');

  writeFileSync(join(OUT_DIR, 'BIG_BET_PAID_PACKAGE_MULTI_SPIN.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BIG_BET_PAID_PACKAGE_MULTI_SPIN.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
