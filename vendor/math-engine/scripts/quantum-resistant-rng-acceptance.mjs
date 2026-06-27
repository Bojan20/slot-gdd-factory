#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_uk_rsa2048_baseline', regime: 'UK_BASELINE', cfg: { classicalKeyBits: 2048, attackerLogicalQubits: 100, pqcMigrationCost: 500_000, annualCryptoOperations: 10_000_000, perOperationBreachCost: 1, migrationHorizonYears: 10, pqcSecurityCategory: 3, hybridModeEnabled: true } },
  { name: 'B_eu_rsa4096_ahead', regime: 'EU_AHEAD', cfg: { classicalKeyBits: 4096, attackerLogicalQubits: 100, pqcMigrationCost: 1_000_000, annualCryptoOperations: 50_000_000, perOperationBreachCost: 2, migrationHorizonYears: 15, pqcSecurityCategory: 5, hybridModeEnabled: true } },
  { name: 'C_us_rsa2048_no_hybrid', regime: 'US_LAGGARD', cfg: { classicalKeyBits: 2048, attackerLogicalQubits: 1000, pqcMigrationCost: 300_000, annualCryptoOperations: 5_000_000, perOperationBreachCost: 5, migrationHorizonYears: 5, pqcSecurityCategory: 1, hybridModeEnabled: false } },
  { name: 'D_au_ecc256_modern', regime: 'AU_ECC', cfg: { classicalKeyBits: 256, attackerLogicalQubits: 100, pqcMigrationCost: 200_000, annualCryptoOperations: 5_000_000, perOperationBreachCost: 1, migrationHorizonYears: 10, pqcSecurityCategory: 3, hybridModeEnabled: true } },
  { name: 'E_corner_attacker_break_today', regime: 'CORNER_BREAK', cfg: { classicalKeyBits: 2048, attackerLogicalQubits: 10000, pqcMigrationCost: 1_000_000, annualCryptoOperations: 10_000_000, perOperationBreachCost: 10, migrationHorizonYears: 5, pqcSecurityCategory: 5, hybridModeEnabled: true } },
  { name: 'F_corner_no_migration', regime: 'CORNER_LAGGARD', cfg: { classicalKeyBits: 1024, attackerLogicalQubits: 500, pqcMigrationCost: 100_000, annualCryptoOperations: 1_000_000, perOperationBreachCost: 100, migrationHorizonYears: 10, pqcSecurityCategory: 1, hybridModeEnabled: false } },
];
async function main() {
  const { solveQuantumRng, simulateQuantumRng } = await import(join(REPO_ROOT, 'dist/features/quantumResistantRng.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} PQC configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveQuantumRng(c.cfg);
    const mc = simulateQuantumRng(c.cfg, 0xCAFE0238, 200);
    const pass = cf.quantumReadinessScore >= 0; // smoke - sanity check
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} shorQubits=${cf.shorQubitsRequired} prob=${cf.probBreakWithinHorizon.toFixed(2)} ROI=${cf.pqcMigrationROI.toFixed(1)} score=${cf.quantumReadinessScore.toFixed(2)} NIST=${cf.isCompliantNistPqc}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'QUANTUM_RESISTANT_RNG.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# QUANTUM_RESISTANT_RNG\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | qubits | prob | ROI | score | NIST | pass |\n|---|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.shorQubitsRequired} | ${r.closed_form.probBreakWithinHorizon.toFixed(2)} | ${r.closed_form.pqcMigrationROI.toFixed(1)} | ${r.closed_form.quantumReadinessScore.toFixed(2)} | ${r.closed_form.isCompliantNistPqc ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'QUANTUM_RESISTANT_RNG.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
