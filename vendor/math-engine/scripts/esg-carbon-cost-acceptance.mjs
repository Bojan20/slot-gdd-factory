#!/usr/bin/env node
//
// W235 — ESG Compliance & Carbon-Cost Optimizer acceptance.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 1000;
const SEED = 0xCAFE0235;
const TOL_MEAN_REL = 0.15;

const CONFIGS = [
  {
    name: 'A_uk_csrd_compliant_baseline',
    description: 'UK mid-tier CSRD-compliant: 5 GWh, 50% PPA, Paris-aligned',
    cfg: {
      annualElectricityKwh: 5_000_000, gridCarbonIntensity: 0.25,
      scope1Emissions: 50, scope3Emissions: 200, renewableShare: 0.50,
      ppaPremiumPerKwh: 0.005, carbonPricePerTonne: 75,
      operatorAnnualRevenue: 100_000_000, taxonomyAlignedRevenueShare: 0.45,
      socialScore: 0.70, governanceScore: 0.75,
      scope12ReductionTarget2030: 0.50, sbtiAligned: true, transitionPlanPublished: true,
    },
    tier: 'UK_COMPLIANT',
  },
  {
    name: 'B_eu_large_high_emissions',
    description: 'EU large operator: 50 GWh, only 20% PPA, EU ETS exposure',
    cfg: {
      annualElectricityKwh: 50_000_000, gridCarbonIntensity: 0.30,
      scope1Emissions: 500, scope3Emissions: 3000, renewableShare: 0.20,
      ppaPremiumPerKwh: 0.008, carbonPricePerTonne: 90,
      operatorAnnualRevenue: 800_000_000, taxonomyAlignedRevenueShare: 0.30,
      socialScore: 0.60, governanceScore: 0.65,
      scope12ReductionTarget2030: 0.42, sbtiAligned: true, transitionPlanPublished: true,
    },
    tier: 'EU_LARGE',
  },
  {
    name: 'C_au_renewable_powered_leader',
    description: 'AU ESG leader: 100% PPA renewable, top-quartile CDP',
    cfg: {
      annualElectricityKwh: 8_000_000, gridCarbonIntensity: 0.50, // AU grid coal-heavy
      scope1Emissions: 30, scope3Emissions: 150, renewableShare: 1.0,
      ppaPremiumPerKwh: 0.003, carbonPricePerTonne: 50,
      operatorAnnualRevenue: 150_000_000, taxonomyAlignedRevenueShare: 0.70,
      socialScore: 0.85, governanceScore: 0.80,
      scope12ReductionTarget2030: 0.60, sbtiAligned: true, transitionPlanPublished: true,
    },
    tier: 'AU_LEADER',
  },
  {
    name: 'D_non_compliant_no_target',
    description: 'Corner: no Paris alignment, no SBTi, no transition plan',
    cfg: {
      annualElectricityKwh: 10_000_000, gridCarbonIntensity: 0.35,
      scope1Emissions: 100, scope3Emissions: 800, renewableShare: 0.10,
      ppaPremiumPerKwh: 0.010, carbonPricePerTonne: 75,
      operatorAnnualRevenue: 200_000_000, taxonomyAlignedRevenueShare: 0.10,
      socialScore: 0.40, governanceScore: 0.45,
      scope12ReductionTarget2030: 0.20, sbtiAligned: false, transitionPlanPublished: false,
    },
    tier: 'NON_COMPLIANT',
  },
  {
    name: 'E_high_carbon_price_eu_ets_shock',
    description: 'Corner: EU ETS €120/tCO₂ stress scenario (2030 projection)',
    cfg: {
      annualElectricityKwh: 20_000_000, gridCarbonIntensity: 0.20,
      scope1Emissions: 200, scope3Emissions: 1000, renewableShare: 0.40,
      ppaPremiumPerKwh: 0.006, carbonPricePerTonne: 120,
      operatorAnnualRevenue: 500_000_000, taxonomyAlignedRevenueShare: 0.50,
      socialScore: 0.65, governanceScore: 0.70,
      scope12ReductionTarget2030: 0.50, sbtiAligned: true, transitionPlanPublished: true,
    },
    tier: 'CARBON_SHOCK',
  },
  {
    name: 'F_micro_operator_low_intensity',
    description: 'Corner: micro operator, very low absolute footprint',
    cfg: {
      annualElectricityKwh: 200_000, gridCarbonIntensity: 0.18,
      scope1Emissions: 5, scope3Emissions: 20, renewableShare: 0.80,
      ppaPremiumPerKwh: 0.004, carbonPricePerTonne: 75,
      operatorAnnualRevenue: 5_000_000, taxonomyAlignedRevenueShare: 0.55,
      socialScore: 0.75, governanceScore: 0.80,
      scope12ReductionTarget2030: 0.60, sbtiAligned: true, transitionPlanPublished: true,
    },
    tier: 'MICRO_GREEN',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

async function main() {
  const { solveEsgCarbon, simulateEsgCarbon } = await import(
    join(REPO_ROOT, 'dist', 'features', 'esgCarbonCostOptimizer.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} ESG configs @ ${EPISODES} MC sensitivity runs each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveEsgCarbon(c.cfg);
    const mc = simulateEsgCarbon(c.cfg, SEED, EPISODES);
    const meanRel = relErr(cf.annualCarbonCost, mc.observedAnnualCarbonCostMean);
    const pass = meanRel <= TOL_MEAN_REL;
    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.tier.padEnd(15)} kWh=${(c.cfg.annualElectricityKwh / 1e6).toFixed(1)}GWh r=${c.cfg.renewableShare}  ` +
        `total=${cf.totalEmissionsTonnes.toFixed(0)}tCO₂ cost=£${(cf.annualCarbonCost / 1000).toFixed(0)}K  ` +
        `E=${cf.environmentalScore.toFixed(2)} ESG=${cf.esgCompositeScore.toFixed(2)}  ` +
        `csrd=${cf.isCompliantEuCsrd} tcfd=${cf.isCompliantUkFcaTcfd}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      tier: c.tier,
      cfg: c.cfg,
      closed_form: cf,
      monte_carlo: mc,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'ESG_CARBON_COST',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'ESG_CARBON_COST.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# ESG_CARBON_COST — ESG Compliance Score & Carbon-Cost Optimizer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${EPISODES} MC sensitivity runs each.`);
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | tier | kWh | r | total tCO₂ | carbonCost | E | ESG | CSRD | TCFD | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.tier} | ${(r.cfg.annualElectricityKwh / 1e6).toFixed(1)}GWh | ${r.cfg.renewableShare} | ${r.closed_form.totalEmissionsTonnes.toFixed(0)} | £${(r.closed_form.annualCarbonCost / 1000).toFixed(0)}K | ${r.closed_form.environmentalScore.toFixed(2)} | ${r.closed_form.esgCompositeScore.toFixed(2)} | ${r.closed_form.isCompliantEuCsrd ? '✅' : '❌'} | ${r.closed_form.isCompliantUkFcaTcfd ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);

  writeFileSync(join(OUT_DIR, 'ESG_CARBON_COST.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/ESG_CARBON_COST.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
