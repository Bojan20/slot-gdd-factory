#!/usr/bin/env node
//
// W234 — Cybersecurity Breach Cost Quantification Analyzer acceptance.
//
// 6 operator-tier configs × 3K MC compound-Poisson loss campaigns.
//
// Operator deliverable: `reports/acceptance/CYBERSECURITY_BREACH_COST.{json,md}`.
//
// Compliance: EU NIS2 Directive + UK Cyber Resilience Act 2025 + UKGC LCCP 4.1
// + ICO GDPR + AU Privacy Act 2024 + NIST SP 800-53.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 3_000;
const SEED = 0xCAFE0234;

const TOL_MEAN_REL = 0.20;

const CONFIGS = [
  {
    name: 'A_uk_mid_tier_compliant_baseline',
    description: 'UK mid-tier: λ=0.08 baseline, sens=£500K investment, 1% revenue, NIS2 compliant',
    cfg: {
      annualBreachRate: 0.08,
      paretoAlpha: 2.5,
      paretoScale: 1_000_000,
      annualSecurityInvestment: 500_000,
      investmentEffectivenessCoeff: 1e-7,
      operatorAnnualRevenue: 50_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.40,
      expectedFineWhenFined: 2_000_000,
      horizonYears: 3,
      varConfidenceLevel: 0.99,
      breachResponseTimeHours: 48,
    },
    tier: 'UK_MID',
  },
  {
    name: 'B_uk_large_high_value_target',
    description: 'UK large (Entain-class): high attack surface, £5M investment, low effective rate',
    cfg: {
      annualBreachRate: 0.30,
      paretoAlpha: 1.8,
      paretoScale: 3_000_000,
      annualSecurityInvestment: 5_000_000,
      investmentEffectivenessCoeff: 1e-7,
      operatorAnnualRevenue: 1_000_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.60,
      expectedFineWhenFined: 20_000_000,
      horizonYears: 3,
      varConfidenceLevel: 0.999,
      breachResponseTimeHours: 24,
    },
    tier: 'UK_LARGE',
  },
  {
    name: 'C_eu_nis2_essential_service',
    description: 'EU NIS2 essential service (gambling-class): strict 24h breach SLA',
    cfg: {
      annualBreachRate: 0.15,
      paretoAlpha: 2.0,
      paretoScale: 1_500_000,
      annualSecurityInvestment: 1_000_000,
      investmentEffectivenessCoeff: 2e-7,
      operatorAnnualRevenue: 100_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.50,
      expectedFineWhenFined: 5_000_000,
      horizonYears: 3,
      varConfidenceLevel: 0.99,
      breachResponseTimeHours: 24,
    },
    tier: 'EU_NIS2',
  },
  {
    name: 'D_au_small_under_investment',
    description: 'AU small operator: under-invested (0.3% revenue) → NIS2 fail',
    cfg: {
      annualBreachRate: 0.20,
      paretoAlpha: 2.2,
      paretoScale: 800_000,
      annualSecurityInvestment: 30_000,
      investmentEffectivenessCoeff: 1e-7,
      operatorAnnualRevenue: 10_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.50,
      expectedFineWhenFined: 500_000,
      horizonYears: 3,
      varConfidenceLevel: 0.99,
      breachResponseTimeHours: 72,
    },
    tier: 'AU_SMALL',
  },
  {
    name: 'E_corner_extreme_heavy_tail',
    description: 'Corner: α=1.3 very heavy tail (catastrophic single-breach scenarios)',
    cfg: {
      annualBreachRate: 0.10,
      paretoAlpha: 1.3,
      paretoScale: 2_000_000,
      annualSecurityInvestment: 1_500_000,
      investmentEffectivenessCoeff: 1e-7,
      operatorAnnualRevenue: 150_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.50,
      expectedFineWhenFined: 10_000_000,
      horizonYears: 5,
      varConfidenceLevel: 0.99,
      breachResponseTimeHours: 48,
    },
    tier: 'CORNER_HEAVY_TAIL',
  },
  {
    name: 'F_corner_best_in_class_low_breach',
    description: 'Corner: best-in-class λ=0.02, 3% revenue investment, instant breach response',
    cfg: {
      annualBreachRate: 0.02,
      paretoAlpha: 3.0,
      paretoScale: 500_000,
      annualSecurityInvestment: 3_000_000,
      investmentEffectivenessCoeff: 5e-7,
      operatorAnnualRevenue: 100_000_000,
      gdprFineCapFraction: 0.04,
      probFineGivenBreach: 0.30,
      expectedFineWhenFined: 1_000_000,
      horizonYears: 3,
      varConfidenceLevel: 0.99,
      breachResponseTimeHours: 12,
    },
    tier: 'CORNER_BEST',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

async function main() {
  const { solveCybersecurityBreach, simulateCybersecurityBreach } = await import(
    join(REPO_ROOT, 'dist', 'features', 'cybersecurityBreachCost.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} cybersecurity configs @ ${EPISODES} MC compound-Poisson campaigns each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCybersecurityBreach(c.cfg);
    const mc = simulateCybersecurityBreach(c.cfg, SEED, EPISODES);

    const meanRel = relErr(cf.expectedAnnualLoss, mc.observedAnnualLossMean);
    const checks = { mean_rel: meanRel };
    const pass = meanRel <= TOL_MEAN_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(42)} ${pass ? '✅' : '❌'}  ` +
        `${c.tier.padEnd(18)} λ=${c.cfg.annualBreachRate} α=${c.cfg.paretoAlpha} xm=£${(c.cfg.paretoScale / 1000).toFixed(0)}K  ` +
        `effRate=${cf.effectiveBreachRate.toFixed(3)} E[loss]=£${(cf.expectedAnnualLoss / 1000).toFixed(0)}K  ` +
        `VaR=£${(cf.varAlphaTHorizon / 1000).toFixed(0)}K ROI=${(cf.securityInvestmentROI * 100).toFixed(1)}%  ` +
        `fine=£${(cf.cappedAnnualFineExposure / 1000).toFixed(0)}K  ` +
        `score=${cf.cyberResilienceScore.toFixed(2)}  ` +
        `nis2=${cf.isCompliantNis2}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      tier: c.tier,
      cfg: c.cfg,
      closed_form: {
        baselineBreachRate: cf.baselineBreachRate,
        effectiveBreachRate: cf.effectiveBreachRate,
        expectedCostPerBreach: cf.expectedCostPerBreach,
        varianceCostPerBreach: cf.varianceCostPerBreach,
        expectedAnnualLoss: cf.expectedAnnualLoss,
        stdAnnualLoss: cf.stdAnnualLoss,
        varAlphaTHorizon: cf.varAlphaTHorizon,
        expectedLossReduction: cf.expectedLossReduction,
        securityInvestmentROI: cf.securityInvestmentROI,
        expectedAnnualFineExposure: cf.expectedAnnualFineExposure,
        cappedAnnualFineExposure: cf.cappedAnnualFineExposure,
        cyberResilienceScore: cf.cyberResilienceScore,
        isCompliantNis2: cf.isCompliantNis2,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedAnnualLossMean: mc.observedAnnualLossMean,
        observedAnnualLossStd: mc.observedAnnualLossStd,
        observedVarAlphaTHorizon: mc.observedVarAlphaTHorizon,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CYBERSECURITY_BREACH_COST',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { mean_rel: TOL_MEAN_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'CYBERSECURITY_BREACH_COST.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# CYBERSECURITY_BREACH_COST — Cybersecurity Breach Cost Quantification Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${EPISODES} MC compound-Poisson campaigns each.`);
  md.push('');
  md.push('Closes W234 — **91. closed-form solver, first CYBERSECURITY/RESILIENCE kernel** u portfolio.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Compound Poisson aggregate loss model:');
  md.push('  - N_breaches ~ Poisson(λ_effective · T), λ_eff = λ · exp(−k·Investment)');
  md.push('  - C_breach ~ Pareto(α, x_m), E[C] = α·x_m/(α−1), Var[C] = α·x_m²/((α−1)²·(α−2)) (α>2)');
  md.push('  - E[S_T] = λ·T·E[C], sd[S_T] = √(λ·T·E[C²])');
  md.push('  - VaR_α(T) = E[S_T] + z_α · sd[S_T] (CLT approximation)');
  md.push('');
  md.push('Investment ROI: ΔE[S]/I − 1.');
  md.push('');
  md.push('NIS2 compliance: λ_eff ≤ 0.10/yr ∧ I/revenue ≥ 1% ∧ responseHours ≤ 72.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | tier | λ | α | xm | effRate | E[loss] | VaR | ROI | fine cap | score | NIS2 | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.tier} | ${r.cfg.annualBreachRate} | ${r.cfg.paretoAlpha} | £${(r.cfg.paretoScale / 1000).toFixed(0)}K | ${r.closed_form.effectiveBreachRate.toFixed(3)} | £${(r.closed_form.expectedAnnualLoss / 1000).toFixed(0)}K | £${(r.closed_form.varAlphaTHorizon / 1000).toFixed(0)}K | ${(r.closed_form.securityInvestmentROI * 100).toFixed(1)}% | £${(r.closed_form.cappedAnnualFineExposure / 1000).toFixed(0)}K | ${r.closed_form.cyberResilienceScore.toFixed(2)} | ${r.closed_form.isCompliantNis2 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form cybersecurity breach-cost kernel ready for EU NIS2 + UK Cyber Resilience + UKGC LCCP 4.1 + ICO GDPR audit. **91. solver — first CYBERSECURITY kernel** u portfolio.');

  writeFileSync(join(OUT_DIR, 'CYBERSECURITY_BREACH_COST.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/CYBERSECURITY_BREACH_COST.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
