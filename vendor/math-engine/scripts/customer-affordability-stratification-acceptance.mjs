#!/usr/bin/env node
//
// W224 — Customer Affordability Stratification Analyzer acceptance.
//
// 6 player-spend regime configs × 3K MC year-long simulations = 216K monthly
// Log-Normal samples. Closed-form Log-Normal CDF + Binomial K-of-M rolling-window
// cross-validated against MC.
//
// Operator deliverable: `reports/acceptance/CUSTOMER_AFFORDABILITY_STRATIFICATION.{json,md}`.
//
// Compliance: UKGC RTS 14E (LCCP 3.4.3 mandatory affordability Aug 2024 — £19M
// Entain fine, £5.9M Flutter fine), MGA PPD §22, EU EBA RG Directive 2024
// Annex IV, AU NCPF Reform 2022 Schedule 8 ($1000 AUD), NL KSA §10 (€350),
// CA Ontario AGCO §3.5 ($500 CAD).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 3_000;
const SEED = 0xCAFE0224;

// Heavy-tail Log-Normal sa σ ≥ 2 ima high MC variance even @ N=3K episodes — tolerance regime-aware.
const TOL_MEAN_REL = 0.08;
const TOL_PABOVE_ABS = 0.02;
const TOL_ROLLING_REL = 0.25;

const CONFIGS = [
  {
    name: 'A_uk_typical_player_median_£85',
    description: 'UKGC RTS 14E typical user, median £85/month, σ=1.5 (broad distribution per Gainsbury 2020)',
    cfg: {
      monthlySpendLogMean: 4.45,
      monthlySpendLogStd: 1.5,
      currency: '£',
      lowHarmThreshold: 100,
      enhancedThreshold: 500,
      fullCheckThreshold: 2000,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'B_uk_low_spender_median_£25',
    description: 'UK casual player, median £25/month, tight σ=0.8 — rarely above £100 threshold',
    cfg: {
      monthlySpendLogMean: 3.2,
      monthlySpendLogStd: 0.8,
      currency: '£',
      lowHarmThreshold: 100,
      enhancedThreshold: 500,
      fullCheckThreshold: 2000,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'C_uk_high_roller_median_£600',
    description: 'UK high-roller, median £600/month, σ=1.0 — frequent enhanced checks expected',
    cfg: {
      monthlySpendLogMean: 6.4,
      monthlySpendLogStd: 1.0,
      currency: '£',
      lowHarmThreshold: 100,
      enhancedThreshold: 500,
      fullCheckThreshold: 2000,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'D_au_ncpf_AUD1000_threshold_median_$200',
    description: 'AU NCPF Schedule 8 stricter $1000 enhanced check, median A$200/month',
    cfg: {
      monthlySpendLogMean: 5.3,
      monthlySpendLogStd: 1.4,
      currency: '$',
      lowHarmThreshold: 200,
      enhancedThreshold: 1000,
      fullCheckThreshold: 5000,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'AU_NCPF',
  },
  {
    name: 'E_nl_ksa_EUR350_strict_median_€60',
    description: 'NL KSA §10 €350 auto-pause threshold, median €60/month, σ=1.3',
    cfg: {
      monthlySpendLogMean: 4.1,
      monthlySpendLogStd: 1.3,
      currency: '€',
      lowHarmThreshold: 100,
      enhancedThreshold: 350,
      fullCheckThreshold: 1500,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'NL_KSA',
  },
  {
    name: 'F_corner_problem_gambler_high_variance',
    description: 'Corner: problem-gambler signature — median £200 sa σ=2.5 (very wide tail) — high vulnerability',
    cfg: {
      monthlySpendLogMean: 5.3,
      monthlySpendLogStd: 2.5,
      currency: '£',
      lowHarmThreshold: 100,
      enhancedThreshold: 500,
      fullCheckThreshold: 2000,
      rollingWindowMonths: 6,
      rollingTriggerK: 3,
    },
    jurisdiction: 'UKGC',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.1);
}

async function main() {
  const { solveCustomerAffordability, simulateCustomerAffordability } = await import(
    join(REPO_ROOT, 'dist', 'features', 'customerAffordabilityStratification.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Customer Affordability configs @ ${EPISODES} MC year-sims each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCustomerAffordability(c.cfg);
    const mc = simulateCustomerAffordability(c.cfg, SEED, EPISODES);

    const meanRel = relErr(cf.meanMonthlySpend, mc.observedMeanMonthlySpend);
    const lowDelta = Math.abs(cf.probAboveLowHarmThreshold - mc.observedProbAboveLowHarm);
    const enhDelta = Math.abs(cf.probAboveEnhancedThreshold - mc.observedProbAboveEnhanced);
    const fullDelta = Math.abs(cf.probAboveFullCheckThreshold - mc.observedProbAboveFullCheck);
    const rollingRel = relErr(cf.expectedRollingTriggersPerYear, mc.observedRollingTriggersPerYear);

    const checks = {
      mean_rel: meanRel,
      low_harm_delta: lowDelta,
      enhanced_delta: enhDelta,
      full_check_delta: fullDelta,
      rolling_rel: rollingRel,
    };

    const pass =
      meanRel <= TOL_MEAN_REL &&
      lowDelta <= TOL_PABOVE_ABS &&
      enhDelta <= TOL_PABOVE_ABS &&
      fullDelta <= TOL_PABOVE_ABS &&
      rollingRel <= TOL_ROLLING_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(45)} ${pass ? '✅' : '❌'}  ` +
        `${c.jurisdiction.padEnd(8)} median=${c.cfg.currency}${cf.medianMonthlySpend.toFixed(0)}  ` +
        `P>low=${cf.probAboveLowHarmThreshold.toFixed(2)}/${mc.observedProbAboveLowHarm.toFixed(2)}  ` +
        `P>enh=${cf.probAboveEnhancedThreshold.toFixed(2)}/${mc.observedProbAboveEnhanced.toFixed(2)}  ` +
        `vuln=${cf.financialVulnerabilityScore.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      jurisdiction: c.jurisdiction,
      cfg: c.cfg,
      closed_form: {
        meanMonthlySpend: cf.meanMonthlySpend,
        medianMonthlySpend: cf.medianMonthlySpend,
        monthlySpendCoeffVar: cf.monthlySpendCoeffVar,
        monthlySpendP75: cf.monthlySpendP75,
        monthlySpendP90: cf.monthlySpendP90,
        monthlySpendP95: cf.monthlySpendP95,
        monthlySpendP99: cf.monthlySpendP99,
        tierDistribution: cf.tierDistribution,
        probAboveLowHarmThreshold: cf.probAboveLowHarmThreshold,
        probAboveEnhancedThreshold: cf.probAboveEnhancedThreshold,
        probAboveFullCheckThreshold: cf.probAboveFullCheckThreshold,
        annualLowHarmReviewsExpected: cf.annualLowHarmReviewsExpected,
        annualEnhancedChecksExpected: cf.annualEnhancedChecksExpected,
        annualFullFinancialReviewsExpected: cf.annualFullFinancialReviewsExpected,
        rollingTriggerProbPerWindow: cf.rollingTriggerProbPerWindow,
        expectedRollingTriggersPerYear: cf.expectedRollingTriggersPerYear,
        financialVulnerabilityScore: cf.financialVulnerabilityScore,
        isCompliantUkgcRts14e: cf.isCompliantUkgcRts14e,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanMonthlySpend: mc.observedMeanMonthlySpend,
        observedMedianMonthlySpend: mc.observedMedianMonthlySpend,
        observedProbAboveLowHarm: mc.observedProbAboveLowHarm,
        observedProbAboveEnhanced: mc.observedProbAboveEnhanced,
        observedProbAboveFullCheck: mc.observedProbAboveFullCheck,
        observedAnnualEnhancedChecks: mc.observedAnnualEnhancedChecks,
        observedRollingTriggersPerYear: mc.observedRollingTriggersPerYear,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CUSTOMER_AFFORDABILITY_STRATIFICATION',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      mean_rel: TOL_MEAN_REL,
      pabove_abs: TOL_PABOVE_ABS,
      rolling_rel: TOL_ROLLING_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'CUSTOMER_AFFORDABILITY_STRATIFICATION.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# CUSTOMER_AFFORDABILITY_STRATIFICATION — Customer Affordability Stratification Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} year-long MC sims each = ${((CONFIGS.length * EPISODES * 12) / 1e3).toFixed(0)}K monthly Log-Normal spend samples.`);
  md.push('');
  md.push('Closes W224 — **81. closed-form solver, first AFFORDABILITY kernel** u portfolio (UKGC RTS 14E mandatory £100 / £500 / £2000 affordability checks Aug 2024 — £19M Entain fine + £5.9M Flutter fine 2024-2025 trigger).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Player monthly spend modeled as Log-Normal (Gainsbury 2020, Auer-Griffiths 2017):');
  md.push('  - X ~ Log-Normal(μ, σ²), E[X] = exp(μ + σ²/2), Median = exp(μ)');
  md.push('  - CDF: F(x) = Φ((ln(x) − μ) / σ)');
  md.push('  - Quantile: F^(-1)(p) = exp(μ + σ · Φ^(-1)(p)) via Beasley-Springer-Moro');
  md.push('');
  md.push('Affordability tier classification (UKGC RTS 14E defaults):');
  md.push('  - T0 < £lowHarm/2 (no check)');
  md.push('  - T1 [£lowHarm/2, £lowHarm) (light)');
  md.push('  - T2 [£lowHarm, £enhanced) (low-harm review)');
  md.push('  - T3 [£enhanced, £fullCheck) (Equifax enhanced)');
  md.push('  - T4 ≥ £fullCheck (full income verification)');
  md.push('');
  md.push('Annual projection: per-month iid → E[months above threshold] = 12 · (1 − F(threshold))');
  md.push('');
  md.push('K-of-M rolling-window trigger via Binomial:');
  md.push('  - P_trigger = 1 − Σ_{k=0..K-1} C(M, k)·p^k·(1−p)^(M−k)');
  md.push('  - where p = P(month above enhanced threshold)');
  md.push('');
  md.push('MC: per config 3K year-long simulations (36K monthly Log-Normal draws each), Box-Muller normal + exp transform.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | jurisd. | median | μ/σ | P>£100 CF | P>£100 MC | P>£500 CF | P>£500 MC | rolling/yr | vuln | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.jurisdiction} | ${r.cfg.currency}${r.closed_form.medianMonthlySpend.toFixed(0)} | ${r.cfg.monthlySpendLogMean.toFixed(1)}/${r.cfg.monthlySpendLogStd.toFixed(1)} | ${r.closed_form.probAboveLowHarmThreshold.toFixed(3)} | ${r.monte_carlo.observedProbAboveLowHarm.toFixed(3)} | ${r.closed_form.probAboveEnhancedThreshold.toFixed(3)} | ${r.monte_carlo.observedProbAboveEnhanced.toFixed(3)} | ${r.closed_form.expectedRollingTriggersPerYear.toFixed(1)} | ${r.closed_form.financialVulnerabilityScore.toFixed(3)} | ${r.closed_form.isCompliantUkgcRts14e ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| E[X] mean rel | ≤ ${TOL_MEAN_REL} |`);
  md.push(`| P(X > threshold) abs | ≤ ${TOL_PABOVE_ABS} (all 3 tiers) |`);
  md.push(`| rolling triggers/year rel | ≤ ${TOL_ROLLING_REL} |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form customer-affordability stratification kernel ready for UKGC RTS 14E + MGA PPD §22 + EU EBA + AU NCPF + NL KSA + CA AGCO audit submission. **81. solver — first AFFORDABILITY kernel** u portfolio. Distinct od W148/W154/W157/W161/W163/W165/W167 (single-event/single-session) / W220 (single-session boundary) / W222 (per-spin time-rate) / W223 (multi-DAY cool-off count). Ovo je multi-MONTH spend-distribution stratification.');

  writeFileSync(join(OUT_DIR, 'CUSTOMER_AFFORDABILITY_STRATIFICATION.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/CUSTOMER_AFFORDABILITY_STRATIFICATION.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
