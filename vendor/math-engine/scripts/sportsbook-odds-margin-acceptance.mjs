#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_3way_football_match', regime: 'FOOTBALL_3WAY', cfg: { trueProbabilities: [0.50, 0.30, 0.20], decimalOdds: [1.95, 3.20, 4.80], annualHandle: 100_000_000, customerWagerDistribution: [0.5, 0.3, 0.2] } },
  { name: 'B_2way_tennis', regime: 'TENNIS_2WAY', cfg: { trueProbabilities: [0.65, 0.35], decimalOdds: [1.50, 2.70], annualHandle: 50_000_000, customerWagerDistribution: [0.65, 0.35] } },
  { name: 'C_horse_racing_8_runners', regime: 'HORSE_8', cfg: { trueProbabilities: [0.30, 0.20, 0.15, 0.12, 0.10, 0.06, 0.04, 0.03], decimalOdds: [3.20, 4.80, 6.50, 8.00, 9.50, 16.0, 24.0, 32.0], annualHandle: 30_000_000, customerWagerDistribution: [0.30, 0.20, 0.15, 0.12, 0.10, 0.06, 0.04, 0.03] } },
  { name: 'D_excessive_overround', regime: 'CORNER_GOUGE', cfg: { trueProbabilities: [0.50, 0.30, 0.20], decimalOdds: [1.50, 2.40, 3.60], annualHandle: 100_000_000, customerWagerDistribution: [0.5, 0.3, 0.2] } },
  { name: 'E_tight_pricing_low_margin', regime: 'TIGHT_PRICING', cfg: { trueProbabilities: [0.50, 0.30, 0.20], decimalOdds: [1.98, 3.30, 4.95], annualHandle: 100_000_000, customerWagerDistribution: [0.5, 0.3, 0.2] } },
  { name: 'F_5way_special', regime: 'SPECIAL_5WAY', cfg: { trueProbabilities: [0.30, 0.25, 0.20, 0.15, 0.10], decimalOdds: [3.20, 3.80, 4.80, 6.50, 9.50], annualHandle: 20_000_000, customerWagerDistribution: [0.30, 0.25, 0.20, 0.15, 0.10] } },
];
async function main() {
  const { solveSportsbook, simulateSportsbook } = await import(join(REPO_ROOT, 'dist/features/sportsbookOddsMargin.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} sportsbook configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveSportsbook(c.cfg);
    const mc = simulateSportsbook(c.cfg, 0xCAFE0242, 50000);
    const pass = cf.overround >= 0;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(35)} ${pass ? '✅' : '❌'} ${c.regime} overround=${(cf.overround * 100).toFixed(2)}% margin=${(cf.weightedExpectedMargin * 100).toFixed(2)}% ggr=£${cf.expectedAnnualGgr.toFixed(0)} UK=${cf.isCompliantUkgcRts12}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'SPORTSBOOK_ODDS_MARGIN.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# SPORTSBOOK_ODDS_MARGIN\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | overround | margin | GGR | UK | pass |\n|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${(r.closed_form.overround * 100).toFixed(2)}% | ${(r.closed_form.weightedExpectedMargin * 100).toFixed(2)}% | £${r.closed_form.expectedAnnualGgr.toFixed(0)} | ${r.closed_form.isCompliantUkgcRts12 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'SPORTSBOOK_ODDS_MARGIN.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
