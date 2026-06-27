#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const baseStates = [
  { state: 'NJ', minRtp: 0.85, maxRtp: 0.96, actualRtp: 0.93, auditCadenceDays: 30, actualAuditCadenceDays: 28, annualLicensingFee: 50_000, perViolationFine: 500_000, annualViolationProb: 0.05 },
  { state: 'PA', minRtp: 0.85, maxRtp: 0.96, actualRtp: 0.92, auditCadenceDays: 30, actualAuditCadenceDays: 30, annualLicensingFee: 75_000, perViolationFine: 750_000, annualViolationProb: 0.04 },
  { state: 'MI', minRtp: 0.87, maxRtp: 0.95, actualRtp: 0.91, auditCadenceDays: 45, actualAuditCadenceDays: 40, annualLicensingFee: 60_000, perViolationFine: 600_000, annualViolationProb: 0.06 },
  { state: 'NV', minRtp: 0.75, maxRtp: 0.96, actualRtp: 0.92, auditCadenceDays: 60, actualAuditCadenceDays: 60, annualLicensingFee: 80_000, perViolationFine: 1_000_000, annualViolationProb: 0.03 },
  { state: 'MA', minRtp: 0.87, maxRtp: 0.95, actualRtp: 0.93, auditCadenceDays: 30, actualAuditCadenceDays: 28, annualLicensingFee: 65_000, perViolationFine: 800_000, annualViolationProb: 0.04 },
  { state: 'CO', minRtp: 0.80, maxRtp: 0.96, actualRtp: 0.91, auditCadenceDays: 45, actualAuditCadenceDays: 45, annualLicensingFee: 40_000, perViolationFine: 400_000, annualViolationProb: 0.05 },
  { state: 'IL', minRtp: 0.85, maxRtp: 0.96, actualRtp: 0.92, auditCadenceDays: 30, actualAuditCadenceDays: 30, annualLicensingFee: 70_000, perViolationFine: 700_000, annualViolationProb: 0.04 },
  { state: 'CT', minRtp: 0.85, maxRtp: 0.95, actualRtp: 0.93, auditCadenceDays: 30, actualAuditCadenceDays: 28, annualLicensingFee: 55_000, perViolationFine: 550_000, annualViolationProb: 0.05 },
];

const CONFIGS = [
  { name: 'A_3_state_baseline', regime: 'BASELINE_3', cfg: { states: baseStates.slice(0, 3), totalRevenueCapacity: 5_000_000 } },
  { name: 'B_5_state_expanding', regime: 'EXPANDING_5', cfg: { states: baseStates.slice(0, 5), totalRevenueCapacity: 10_000_000 } },
  { name: 'C_8_state_mature', regime: 'MATURE_8', cfg: { states: baseStates, totalRevenueCapacity: 20_000_000 } },
  { name: 'D_rtp_violation', regime: 'VIOLATION_RTP', cfg: { states: [{ ...baseStates[0], actualRtp: 0.50 }, baseStates[1]], totalRevenueCapacity: 5_000_000 } },
  { name: 'E_audit_violation', regime: 'VIOLATION_AUDIT', cfg: { states: [{ ...baseStates[0], actualAuditCadenceDays: 60 }, baseStates[1]], totalRevenueCapacity: 5_000_000 } },
  { name: 'F_high_fine_exposure', regime: 'HIGH_FINES', cfg: { states: baseStates.map(s => ({ ...s, annualViolationProb: 0.20, perViolationFine: 2_000_000 })), totalRevenueCapacity: 30_000_000 } },
];

async function main() {
  const { solveUsStateCompliance, simulateUsStateCompliance } = await import(join(REPO_ROOT, 'dist/features/usStateRegulatorCompliance.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} multi-state compliance configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveUsStateCompliance(c.cfg);
    const mc = simulateUsStateCompliance(c.cfg, 0xCAFE0239, 500);
    const rel = Math.abs(cf.totalExpectedAnnualFines - mc.observedTotalFinesMean) / Math.max(cf.totalExpectedAnnualFines, 1);
    const pass = rel <= 0.20;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} N=${c.cfg.states.length} compliant=${cf.fractionStatesCompliant.toFixed(2)} fees=£${cf.totalAnnualLicensingFees} fines=£${cf.totalExpectedAnnualFines.toFixed(0)} all=${cf.isCompliantAllStates}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'US_STATE_REGULATOR_COMPLIANCE.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# US_STATE_REGULATOR_COMPLIANCE\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | N | compliant | fees | fines | all | pass |\n|---|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.cfg.states.length} | ${r.closed_form.fractionStatesCompliant.toFixed(2)} | £${r.closed_form.totalAnnualLicensingFees} | £${r.closed_form.totalExpectedAnnualFines.toFixed(0)} | ${r.closed_form.isCompliantAllStates ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'US_STATE_REGULATOR_COMPLIANCE.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
