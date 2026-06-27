#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_uk_balanced_portfolio', regime: 'UK_BALANCED', cfg: { providers: [
    { providerName: 'Pragmatic', revenueSharePct: 0.20, engagementMultiplier: 1.4, annualGgrPotential: 5_000_000, minimumMonthlyFee: 10_000, annualContentRefreshRequired: 20, isTier1Premium: true },
    { providerName: 'Vendor D', revenueSharePct: 0.22, engagementMultiplier: 1.3, annualGgrPotential: 3_000_000, minimumMonthlyFee: 8_000, annualContentRefreshRequired: 15, isTier1Premium: true },
    { providerName: 'Hacksaw', revenueSharePct: 0.25, engagementMultiplier: 1.1, annualGgrPotential: 2_000_000, minimumMonthlyFee: 5_000, annualContentRefreshRequired: 10, isTier1Premium: false },
    { providerName: 'Smaller', revenueSharePct: 0.30, engagementMultiplier: 0.9, annualGgrPotential: 1_000_000, minimumMonthlyFee: 2_000, annualContentRefreshRequired: 5, isTier1Premium: false },
  ], operatorTotalGgrCapacity: 20_000_000, marketingBudgetPerProvider: 50_000, tier1MinimumSharePct: 0.30 } },
  { name: 'B_tier1_dominant', regime: 'TIER1_DOMINANT', cfg: { providers: [
    { providerName: 'Evolution', revenueSharePct: 0.30, engagementMultiplier: 1.6, annualGgrPotential: 8_000_000, minimumMonthlyFee: 30_000, annualContentRefreshRequired: 20, isTier1Premium: true },
    { providerName: 'Pragmatic', revenueSharePct: 0.20, engagementMultiplier: 1.4, annualGgrPotential: 5_000_000, minimumMonthlyFee: 10_000, annualContentRefreshRequired: 20, isTier1Premium: true },
    { providerName: 'Yggdrasil', revenueSharePct: 0.25, engagementMultiplier: 1.0, annualGgrPotential: 1_500_000, minimumMonthlyFee: 4_000, annualContentRefreshRequired: 8, isTier1Premium: false },
  ], operatorTotalGgrCapacity: 20_000_000, marketingBudgetPerProvider: 75_000, tier1MinimumSharePct: 0.30 } },
  { name: 'C_no_tier1_corner', regime: 'NO_TIER1', cfg: { providers: [
    { providerName: 'Hacksaw', revenueSharePct: 0.25, engagementMultiplier: 1.1, annualGgrPotential: 2_000_000, minimumMonthlyFee: 5_000, annualContentRefreshRequired: 10, isTier1Premium: false },
    { providerName: 'Smaller1', revenueSharePct: 0.30, engagementMultiplier: 0.9, annualGgrPotential: 1_000_000, minimumMonthlyFee: 2_000, annualContentRefreshRequired: 5, isTier1Premium: false },
    { providerName: 'Smaller2', revenueSharePct: 0.32, engagementMultiplier: 0.8, annualGgrPotential: 800_000, minimumMonthlyFee: 1_500, annualContentRefreshRequired: 4, isTier1Premium: false },
  ], operatorTotalGgrCapacity: 10_000_000, marketingBudgetPerProvider: 30_000, tier1MinimumSharePct: 0.30 } },
  { name: 'D_10_provider_mega_portfolio', regime: 'MEGA_10', cfg: { providers: Array.from({ length: 10 }, (_, i) => ({ providerName: `Provider${i}`, revenueSharePct: 0.20 + i * 0.01, engagementMultiplier: 1.0 + (i % 3) * 0.2, annualGgrPotential: 2_000_000 - i * 100_000, minimumMonthlyFee: 5_000, annualContentRefreshRequired: 10, isTier1Premium: i < 3 })), operatorTotalGgrCapacity: 30_000_000, marketingBudgetPerProvider: 50_000, tier1MinimumSharePct: 0.30 } },
  { name: 'E_low_capacity_constrained', regime: 'CONSTRAINED', cfg: { providers: [
    { providerName: 'Pragmatic', revenueSharePct: 0.20, engagementMultiplier: 1.4, annualGgrPotential: 8_000_000, minimumMonthlyFee: 10_000, annualContentRefreshRequired: 20, isTier1Premium: true },
    { providerName: 'Vendor D', revenueSharePct: 0.22, engagementMultiplier: 1.3, annualGgrPotential: 8_000_000, minimumMonthlyFee: 8_000, annualContentRefreshRequired: 15, isTier1Premium: true },
  ], operatorTotalGgrCapacity: 5_000_000, marketingBudgetPerProvider: 50_000, tier1MinimumSharePct: 0.30 } },
  { name: 'F_high_share_extreme_corner', regime: 'CORNER_HIGH_SHARE', cfg: { providers: [
    { providerName: 'PremiumProv', revenueSharePct: 0.40, engagementMultiplier: 1.8, annualGgrPotential: 6_000_000, minimumMonthlyFee: 50_000, annualContentRefreshRequired: 30, isTier1Premium: true },
    { providerName: 'Other', revenueSharePct: 0.25, engagementMultiplier: 1.0, annualGgrPotential: 2_000_000, minimumMonthlyFee: 5_000, annualContentRefreshRequired: 5, isTier1Premium: false },
  ], operatorTotalGgrCapacity: 10_000_000, marketingBudgetPerProvider: 50_000, tier1MinimumSharePct: 0.30 } },
];
async function main() {
  const { solveRevenueShare, simulateRevenueShare } = await import(join(REPO_ROOT, 'dist/features/gameProviderRevenueShareOptimizer.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} revenue-share configs… 🎯 100. SOLVER MILESTONE`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveRevenueShare(c.cfg);
    const mc = simulateRevenueShare(c.cfg, 0xCAFE0244, 200);
    const pass = cf.supplierPortfolioScore >= 0;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'} ${c.regime} netRev=£${(cf.totalOperatorNetRevenue / 1000).toFixed(0)}K supplierPay=£${(cf.totalSupplierPayments / 1000).toFixed(0)}K tier1=${(cf.tier1PortfolioShare * 100).toFixed(0)}% score=${cf.supplierPortfolioScore.toFixed(2)} UK=${cf.isCompliantUkgcSms52}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'GAME_PROVIDER_REVENUE_SHARE.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# 🎯 GAME_PROVIDER_REVENUE_SHARE — 100. SOLVER MILESTONE\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | netRev | supplierPay | tier1 % | score | UKGC SMS 5.2 | pass |\n|---|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | £${(r.closed_form.totalOperatorNetRevenue / 1000).toFixed(0)}K | £${(r.closed_form.totalSupplierPayments / 1000).toFixed(0)}K | ${(r.closed_form.tier1PortfolioShare * 100).toFixed(0)}% | ${r.closed_form.supplierPortfolioScore.toFixed(2)} | ${r.closed_form.isCompliantUkgcSms52 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'GAME_PROVIDER_REVENUE_SHARE.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
