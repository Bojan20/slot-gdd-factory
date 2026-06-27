#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const CONFIGS = [
  { name: 'A_nj_dge_compliant', cfg: { perSpinErrorProbability: 0.0005, spinsPerShift: 300, shiftsPerYear: 700, avgChipErrorValue: 100, chipTrackingDetectionRate: 0.98, reconciliationStd: 50, alertZThreshold: 3.0, auditCadenceDays: 30 }, regime: 'NJ_DGE' },
  { name: 'B_mga_premium_live', cfg: { perSpinErrorProbability: 0.0003, spinsPerShift: 250, shiftsPerYear: 800, avgChipErrorValue: 500, chipTrackingDetectionRate: 0.995, reconciliationStd: 100, alertZThreshold: 2.5, auditCadenceDays: 14 }, regime: 'MGA_PREMIUM' },
  { name: 'C_corner_no_chip_tracking', cfg: { perSpinErrorProbability: 0.001, spinsPerShift: 300, shiftsPerYear: 700, avgChipErrorValue: 100, chipTrackingDetectionRate: 0.7, reconciliationStd: 100, alertZThreshold: 3, auditCadenceDays: 90 }, regime: 'CORNER_LOW_TRACK' },
  { name: 'D_uk_rts7c_baseline', cfg: { perSpinErrorProbability: 0.0008, spinsPerShift: 280, shiftsPerYear: 720, avgChipErrorValue: 150, chipTrackingDetectionRate: 0.97, reconciliationStd: 60, alertZThreshold: 3.0, auditCadenceDays: 30 }, regime: 'UK_RTS7C' },
  { name: 'E_au_agco_strict', cfg: { perSpinErrorProbability: 0.0002, spinsPerShift: 200, shiftsPerYear: 600, avgChipErrorValue: 200, chipTrackingDetectionRate: 0.999, reconciliationStd: 75, alertZThreshold: 2.0, auditCadenceDays: 7 }, regime: 'AU_AGCO' },
  { name: 'F_corner_high_error_rate', cfg: { perSpinErrorProbability: 0.005, spinsPerShift: 300, shiftsPerYear: 700, avgChipErrorValue: 100, chipTrackingDetectionRate: 0.95, reconciliationStd: 50, alertZThreshold: 3.0, auditCadenceDays: 30 }, regime: 'CORNER_HIGH_ERR' },
];

async function main() {
  const { solveLiveDealer, simulateLiveDealer } = await import(join(REPO_ROOT, 'dist/features/liveCasinoDealerIntegrity.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} live-dealer configs…`);
  const results = [];
  let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveLiveDealer(c.cfg);
    const mc = simulateLiveDealer(c.cfg, 0xCAFE0237, 100);
    const rel = Math.abs(cf.expectedAnnualErrors - mc.observedExpectedAnnualErrors) / Math.max(cf.expectedAnnualErrors, 1);
    const pass = rel <= 0.15;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} errors=${cf.expectedAnnualErrors.toFixed(0)} cost=£${cf.expectedAnnualErrorCost.toFixed(0)} score=${cf.dealerIntegrityScore.toFixed(2)} NJ=${cf.isCompliantNjDge}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'LIVE_CASINO_DEALER_INTEGRITY.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# LIVE_CASINO_DEALER_INTEGRITY\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | errors | cost | score | NJ DGE | pass |\n|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.expectedAnnualErrors.toFixed(0)} | £${r.closed_form.expectedAnnualErrorCost.toFixed(0)} | ${r.closed_form.dealerIntegrityScore.toFixed(2)} | ${r.closed_form.isCompliantNjDge ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'LIVE_CASINO_DEALER_INTEGRITY.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
