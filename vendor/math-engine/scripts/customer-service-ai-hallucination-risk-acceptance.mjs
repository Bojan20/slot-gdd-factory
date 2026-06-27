#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_uk_chatbot_compliant', regime: 'UK_COMPLIANT', cfg: { perQueryHallucinationProb: 0.02, annualQueries: 1_000_000, humanSamplingRate: 0.10, humanDetectionRate: 0.95, costPerUncorrectedHallucination: 500, costPerHumanReview: 5, operatorAnnualRevenue: 50_000_000 } },
  { name: 'B_eu_strict_high_sampling', regime: 'EU_STRICT', cfg: { perQueryHallucinationProb: 0.015, annualQueries: 2_000_000, humanSamplingRate: 0.20, humanDetectionRate: 0.98, costPerUncorrectedHallucination: 1000, costPerHumanReview: 8, operatorAnnualRevenue: 100_000_000 } },
  { name: 'C_low_sampling_corner', regime: 'CORNER_LOW_OVERSIGHT', cfg: { perQueryHallucinationProb: 0.05, annualQueries: 1_000_000, humanSamplingRate: 0.02, humanDetectionRate: 0.8, costPerUncorrectedHallucination: 500, costPerHumanReview: 5, operatorAnnualRevenue: 50_000_000 } },
  { name: 'D_high_hallucination_unsafe', regime: 'CORNER_UNSAFE', cfg: { perQueryHallucinationProb: 0.20, annualQueries: 500_000, humanSamplingRate: 0.05, humanDetectionRate: 0.9, costPerUncorrectedHallucination: 1000, costPerHumanReview: 10, operatorAnnualRevenue: 25_000_000 } },
  { name: 'E_au_mature_ai_safety', regime: 'AU_MATURE', cfg: { perQueryHallucinationProb: 0.01, annualQueries: 1_500_000, humanSamplingRate: 0.15, humanDetectionRate: 0.97, costPerUncorrectedHallucination: 800, costPerHumanReview: 6, operatorAnnualRevenue: 75_000_000 } },
  { name: 'F_full_human_review_costly', regime: 'CORNER_FULL_REVIEW', cfg: { perQueryHallucinationProb: 0.02, annualQueries: 1_000_000, humanSamplingRate: 1.0, humanDetectionRate: 0.99, costPerUncorrectedHallucination: 500, costPerHumanReview: 5, operatorAnnualRevenue: 50_000_000 } },
];
async function main() {
  const { solveAiHallucination, simulateAiHallucination } = await import(join(REPO_ROOT, 'dist/features/customerServiceAiHallucinationRisk.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} AI hallucination configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveAiHallucination(c.cfg);
    const mc = simulateAiHallucination(c.cfg, 0xCAFE0243, 100);
    const rel = Math.abs(cf.expectedHallucinationsPerYear - mc.observedHallucinationsMean) / Math.max(cf.expectedHallucinationsPerYear, 1);
    const pass = rel <= 0.15;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} halluc=${cf.expectedHallucinationsPerYear.toFixed(0)} detected=${cf.detectedHallucinations.toFixed(0)} cost=£${cf.totalAnnualAiOversightCost.toFixed(0)} safety=${cf.aiSafetyScore.toFixed(2)} EU=${cf.isCompliantEuAiActArt14}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'CUSTOMER_SERVICE_AI_HALLUCINATION.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# CUSTOMER_SERVICE_AI_HALLUCINATION\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | halluc | detected | cost | safety | EU AI Act | pass |\n|---|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.expectedHallucinationsPerYear.toFixed(0)} | ${r.closed_form.detectedHallucinations.toFixed(0)} | £${r.closed_form.totalAnnualAiOversightCost.toFixed(0)} | ${r.closed_form.aiSafetyScore.toFixed(2)} | ${r.closed_form.isCompliantEuAiActArt14 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'CUSTOMER_SERVICE_AI_HALLUCINATION.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
