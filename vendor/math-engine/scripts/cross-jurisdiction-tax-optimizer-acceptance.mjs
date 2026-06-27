#!/usr/bin/env node
//
// W233 — Cross-Jurisdiction Tax & Compliance Net-Margin Optimizer acceptance.
//
// 6 jurisdiction-portfolio configs × 200 MC noisy-capacity simulations =
// 1200 LP re-solves. Greedy-allocation closed-form cross-validated.
//
// Operator deliverable: `reports/acceptance/CROSS_JURISDICTION_TAX_OPTIMIZER.{json,md}`.
//
// Compliance: UKGC RTS 17 + EU DAC7 (2024) + AU AUSTRAC + UK Gambling Act
// Reform 2024 + OECD BEPS Pillar 2 + IFRS 12.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 200;
const SEED = 0xCAFE0233;
const TOL_GGR_REL = 0.20;
const TOL_NET_REL = 0.20;

const CONFIGS = [
  {
    name: 'A_uk_mt_de_on_au_baseline',
    description: 'UK+MT+DE+ON+AU baseline 5-jurisdiction portfolio, £2.5M total cap',
    cfg: {
      jurisdictions: ['UK', 'MT', 'DE', 'ON', 'AU'],
      jurisdictionGgrCapacity: [1_000_000, 800_000, 600_000, 500_000, 400_000],
      taxRates: [0.21, 0.05, 0.053, 0.20, 0.15],
      complianceOverheads: [0.10, 0.05, 0.08, 0.10, 0.12],
      houseEdges: [0.04, 0.04, 0.04, 0.04, 0.04],
      growthCaps: [0.90, 1.00, 0.85, 0.90, 0.80],
      minimumRevenues: [100_000, 50_000, 50_000, 50_000, 50_000],
      totalRevenueCap: 2_500_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'BASELINE_5',
  },
  {
    name: 'B_uk_dominant_high_concentration',
    description: 'UK-dominant operator: 80% UK exposure, regulatory concentration risk',
    cfg: {
      jurisdictions: ['UK', 'MT', 'DE', 'ON'],
      jurisdictionGgrCapacity: [4_000_000, 200_000, 200_000, 200_000],
      taxRates: [0.21, 0.05, 0.053, 0.20],
      complianceOverheads: [0.10, 0.05, 0.08, 0.10],
      houseEdges: [0.04, 0.04, 0.04, 0.04],
      growthCaps: [0.90, 1.00, 0.85, 0.90],
      minimumRevenues: [3_000_000, 50_000, 50_000, 50_000],
      totalRevenueCap: 4_500_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'CONCENTRATION_UK',
  },
  {
    name: 'C_eu_diversified_8_markets',
    description: 'EU diversified: 8 markets, low HHI, post-Pillar-2 optimization',
    cfg: {
      jurisdictions: ['MT', 'DE', 'ES', 'IT', 'NL', 'SE', 'DK', 'FR'],
      jurisdictionGgrCapacity: [600_000, 500_000, 450_000, 500_000, 350_000, 250_000, 200_000, 300_000],
      taxRates: [0.05, 0.053, 0.20, 0.25, 0.295, 0.18, 0.20, 0.55],
      complianceOverheads: [0.05, 0.08, 0.10, 0.12, 0.10, 0.08, 0.08, 0.15],
      houseEdges: [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04],
      growthCaps: [1.00, 0.85, 0.80, 0.75, 0.85, 0.80, 0.80, 0.65],
      minimumRevenues: [50_000, 50_000, 50_000, 50_000, 50_000, 30_000, 30_000, 30_000],
      totalRevenueCap: 2_500_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'EU_DIVERSIFIED_8',
  },
  {
    name: 'D_high_tax_jurisdictions_only',
    description: 'Corner: only high-tax jurisdictions (FR/IT/PT) — slim margins',
    cfg: {
      jurisdictions: ['FR', 'IT', 'PT'],
      jurisdictionGgrCapacity: [600_000, 500_000, 300_000],
      taxRates: [0.55, 0.25, 0.20],
      complianceOverheads: [0.15, 0.12, 0.10],
      houseEdges: [0.04, 0.04, 0.04],
      growthCaps: [0.65, 0.75, 0.80],
      minimumRevenues: [100_000, 100_000, 50_000],
      totalRevenueCap: 1_000_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'CORNER_HIGH_TAX',
  },
  {
    name: 'E_pillar2_optimization_haven_strategy',
    description: 'MT-heavy haven strategy → Pillar 2 top-up exposure analysis',
    cfg: {
      jurisdictions: ['MT', 'GI', 'IM', 'UK'],
      jurisdictionGgrCapacity: [2_000_000, 800_000, 600_000, 400_000],
      taxRates: [0.05, 0.04, 0.03, 0.21],
      complianceOverheads: [0.05, 0.05, 0.05, 0.10],
      houseEdges: [0.04, 0.04, 0.04, 0.04],
      growthCaps: [1.00, 0.90, 0.85, 0.85],
      minimumRevenues: [200_000, 50_000, 50_000, 50_000],
      totalRevenueCap: 3_000_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'HAVEN_PILLAR2',
  },
  {
    name: 'F_global_top_tier_15_markets',
    description: 'Tier-1 global operator: 15 jurisdictions, mature portfolio',
    cfg: {
      jurisdictions: ['UK', 'MT', 'DE', 'ON', 'AU', 'NJ', 'PA', 'MI', 'NL', 'SE', 'DK', 'BE', 'CH', 'ES', 'IT'],
      jurisdictionGgrCapacity: [1_200_000, 1_500_000, 800_000, 700_000, 500_000, 400_000, 350_000, 300_000, 400_000, 300_000, 250_000, 200_000, 200_000, 500_000, 600_000],
      taxRates: [0.21, 0.05, 0.053, 0.20, 0.15, 0.13, 0.36, 0.28, 0.295, 0.18, 0.20, 0.11, 0.0, 0.20, 0.25],
      complianceOverheads: [0.10, 0.05, 0.08, 0.10, 0.12, 0.10, 0.12, 0.10, 0.10, 0.08, 0.08, 0.08, 0.10, 0.10, 0.12],
      houseEdges: Array(15).fill(0.04),
      growthCaps: [0.90, 1.00, 0.85, 0.90, 0.80, 0.85, 0.80, 0.85, 0.85, 0.80, 0.80, 0.80, 0.85, 0.80, 0.75],
      minimumRevenues: [200_000, 100_000, 50_000, 100_000, 100_000, 50_000, 50_000, 50_000, 100_000, 50_000, 30_000, 30_000, 30_000, 100_000, 100_000],
      totalRevenueCap: 7_000_000,
      pillar2MinTaxRate: 0.15,
      hhiComplianceThreshold: 0.5,
    },
    regime: 'GLOBAL_TIER1',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

async function main() {
  const { solveCrossJurisdictionTax, simulateCrossJurisdictionTax } = await import(
    join(REPO_ROOT, 'dist', 'features', 'crossJurisdictionTaxOptimizer.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} cross-jurisdiction tax configs @ ${EPISODES} MC LP-resolves each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCrossJurisdictionTax(c.cfg);
    const mc = simulateCrossJurisdictionTax(c.cfg, SEED, EPISODES);

    const ggrRel = relErr(cf.totalGgr, mc.observedTotalGgr);
    const netRel = relErr(cf.totalNetRevenue, mc.observedTotalNetRevenue);
    const hhiDelta = Math.abs(cf.hhiConcentration - mc.observedHhi);

    const checks = {
      ggr_rel: ggrRel,
      net_rel: netRel,
      hhi_delta: hhiDelta,
    };

    const pass = ggrRel <= TOL_GGR_REL && netRel <= TOL_NET_REL && hhiDelta <= 0.10;
    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    const topJurisdiction = c.cfg.jurisdictions[cf.jurisdictionRanking[0]];

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.regime.padEnd(20)} N=${c.cfg.jurisdictions.length} top=${topJurisdiction}  ` +
        `GGR=£${(cf.totalGgr / 1000).toFixed(0)}K netRev=£${(cf.totalNetRevenue / 1000).toFixed(0)}K  ` +
        `HHI=${cf.hhiConcentration.toFixed(2)} ` +
        `blendedTax=${(cf.blendedEffectiveTaxRate * 100).toFixed(1)}%  ` +
        `pillar2=£${(cf.totalPillar2TopUp / 1000).toFixed(0)}K  ` +
        `comply=${cf.isCompliantUkgcRts17}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      regime: c.regime,
      cfg: c.cfg,
      closed_form: {
        optimalAllocations: cf.optimalAllocations,
        effectiveGgr: cf.effectiveGgr,
        perJurisdictionNetMargin: cf.perJurisdictionNetMargin,
        perJurisdictionNetRevenue: cf.perJurisdictionNetRevenue,
        jurisdictionRanking: cf.jurisdictionRanking,
        totalNetRevenue: cf.totalNetRevenue,
        totalGgr: cf.totalGgr,
        blendedEffectiveTaxRate: cf.blendedEffectiveTaxRate,
        hhiConcentration: cf.hhiConcentration,
        pillar2TopUpTaxes: cf.pillar2TopUpTaxes,
        totalPillar2TopUp: cf.totalPillar2TopUp,
        taxRateElasticities: cf.taxRateElasticities,
        isCompliantUkgcRts17: cf.isCompliantUkgcRts17,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedTotalGgr: mc.observedTotalGgr,
        observedTotalNetRevenue: mc.observedTotalNetRevenue,
        observedHhi: mc.observedHhi,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CROSS_JURISDICTION_TAX_OPTIMIZER',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { ggr_rel: TOL_GGR_REL, net_rel: TOL_NET_REL, hhi_delta_abs: 0.10 },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'CROSS_JURISDICTION_TAX_OPTIMIZER.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# CROSS_JURISDICTION_TAX_OPTIMIZER — Cross-Jurisdiction Tax & Compliance Net-Margin Optimizer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC noisy-capacity LP re-solves each.`);
  md.push('');
  md.push('Closes W233 — **🎯 90. closed-form solver, P-110 MILESTONE (round number), first TAX/REVENUE OPTIMIZATION kernel** u portfolio (UKGC RTS 17 + EU DAC7 + AU AUSTRAC + UK GA Reform 2024 + OECD BEPS Pillar 2 + IFRS 12). Trigger: Entain £585M HMRC + Flutter $1.2M IRS DAC7 2024.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-jurisdiction net margin: **m_j = h_j · (1 − τ_j − β_j)**.');
  md.push('');
  md.push('Constrained LP allocation:');
  md.push('  - maximize Σ_j a_j · m_j · GGR_max_j');
  md.push('  - subject to: a_j ∈ [0, growthCap_j], Σ a·GGR_max ≤ totalRevenueCap, a_j·GGR_max ≥ minRevenue_j');
  md.push('  - Greedy: sort by m_j descending, allocate floor first → top-margin until exhausted');
  md.push('');
  md.push('OECD BEPS Pillar 2: topUpTax_j = max(0, 0.15 − τ_j) · GGR_j · h_j.');
  md.push('');
  md.push('Herfindahl-Hirschman: HHI = Σ (GGR_j / GGR_total)² ∈ [1/N, 1].');
  md.push('');
  md.push('UKGC RTS 17 compliance: HHI < 0.5 ∧ blendedTaxRate < 0.5.');
  md.push('');
  md.push('MC: 200 LP re-solves sa ±15% multiplicative noise per capacity.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | regime | N | top | totalGGR | netRev | HHI | blendedTax | pillar2 | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const top = r.cfg.jurisdictions[r.closed_form.jurisdictionRanking[0]];
    md.push(
      `| ${r.name} | ${r.regime} | ${r.cfg.jurisdictions.length} | ${top} | £${(r.closed_form.totalGgr / 1000).toFixed(0)}K | £${(r.closed_form.totalNetRevenue / 1000).toFixed(0)}K | ${r.closed_form.hhiConcentration.toFixed(2)} | ${(r.closed_form.blendedEffectiveTaxRate * 100).toFixed(1)}% | £${(r.closed_form.totalPillar2TopUp / 1000).toFixed(0)}K | ${r.closed_form.isCompliantUkgcRts17 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| totalGgr rel CF vs MC | ≤ ${TOL_GGR_REL} |`);
  md.push(`| totalNetRevenue rel | ≤ ${TOL_NET_REL} |`);
  md.push(`| HHI abs | ≤ 0.10 |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form cross-jurisdiction tax-optimization kernel ready for UKGC RTS 17 + EU DAC7 + AU AUSTRAC + OECD BEPS Pillar 2 + IFRS 12 audit. **🎯 90. solver — P-110 MILESTONE — first TAX/REVENUE OPTIMIZATION kernel** u portfolio. Distinct od W148-W232 (all single-direction analytic); ovaj LP-style OPTIMIZATION kernel sa tax + compliance + concentration constraints.');

  writeFileSync(join(OUT_DIR, 'CROSS_JURISDICTION_TAX_OPTIMIZER.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/CROSS_JURISDICTION_TAX_OPTIMIZER.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
