#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_uk_500ms_compliant', regime: 'UK_COMPLIANT', cfg: { medianLatencyMs: 200, latencyLogStd: 0.4, slaThresholdMs: 500, spinsPerDay: 1_000_000, refundPerBreach: 1, operatorAnnualRevenue: 100_000_000 } },
  { name: 'B_eu_strict_300ms', regime: 'EU_STRICT', cfg: { medianLatencyMs: 150, latencyLogStd: 0.35, slaThresholdMs: 300, spinsPerDay: 2_000_000, refundPerBreach: 2, operatorAnnualRevenue: 200_000_000 } },
  { name: 'C_high_latency_corner', regime: 'CORNER_HIGH', cfg: { medianLatencyMs: 350, latencyLogStd: 0.5, slaThresholdMs: 500, spinsPerDay: 500_000, refundPerBreach: 1, operatorAnnualRevenue: 50_000_000 } },
  { name: 'D_us_loose_1000ms', regime: 'US_LOOSE', cfg: { medianLatencyMs: 400, latencyLogStd: 0.4, slaThresholdMs: 1000, spinsPerDay: 500_000, refundPerBreach: 0.5, operatorAnnualRevenue: 30_000_000 } },
  { name: 'E_au_excellent', regime: 'AU_EXCELLENT', cfg: { medianLatencyMs: 100, latencyLogStd: 0.3, slaThresholdMs: 500, spinsPerDay: 1_000_000, refundPerBreach: 1, operatorAnnualRevenue: 80_000_000 } },
  { name: 'F_corner_high_variance', regime: 'CORNER_VAR', cfg: { medianLatencyMs: 200, latencyLogStd: 1.0, slaThresholdMs: 500, spinsPerDay: 1_000_000, refundPerBreach: 2, operatorAnnualRevenue: 100_000_000 } },
];
async function main() {
  const { solveStreamLatency, simulateStreamLatency } = await import(join(REPO_ROOT, 'dist/features/streamLatencySla.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} latency configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveStreamLatency(c.cfg);
    const mc = simulateStreamLatency(c.cfg, 0xCAFE0241, 5000);
    const delta = Math.abs(cf.probSlaBreach - mc.observedProbSlaBreach);
    const pass = delta < 0.02;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} median=${cf.meanLatencyMs.toFixed(0)}ms p99=${cf.p99LatencyMs.toFixed(0)}ms breach=${(cf.probSlaBreach * 100).toFixed(2)}% refund=£${cf.expectedAnnualRefundCost.toFixed(0)} score=${cf.slaComplianceScore.toFixed(2)} UK=${cf.isCompliantUkgcRts14f}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'STREAM_LATENCY_SLA.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# STREAM_LATENCY_SLA\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | median ms | breach% | refund | UK RTS 14F | pass |\n|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.meanLatencyMs.toFixed(0)} | ${(r.closed_form.probSlaBreach * 100).toFixed(2)}% | £${r.closed_form.expectedAnnualRefundCost.toFixed(0)} | ${r.closed_form.isCompliantUkgcRts14f ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'STREAM_LATENCY_SLA.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
