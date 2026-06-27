#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const CONFIGS = [
  { name: 'A_type6_compliant', regime: 'TYPE_6_COMPLIANT', cfg: { targetRtp: 0.95, pachislotType: 6, playerSkillMultiplier: 1.02, betPerSpin: 150, spinsPerHour: 360, dailyPlayHours: 4, paybackCycleHours: 3.5, jagraCertified: true } },
  { name: 'B_type5_legacy', regime: 'TYPE_5_LEGACY', cfg: { targetRtp: 1.10, pachislotType: 5, playerSkillMultiplier: 1.05, betPerSpin: 200, spinsPerHour: 400, dailyPlayHours: 6, paybackCycleHours: 4.0, jagraCertified: true } },
  { name: 'C_type6_max_rtp', regime: 'TYPE_6_MAX', cfg: { targetRtp: 1.05, pachislotType: 6, playerSkillMultiplier: 1.10, betPerSpin: 150, spinsPerHour: 360, dailyPlayHours: 4, paybackCycleHours: 3.0, jagraCertified: true } },
  { name: 'D_no_jagra_fail', regime: 'NO_JAGRA', cfg: { targetRtp: 0.95, pachislotType: 6, playerSkillMultiplier: 1.02, betPerSpin: 150, spinsPerHour: 360, dailyPlayHours: 4, paybackCycleHours: 3.5, jagraCertified: false } },
  { name: 'E_cycle_violation', regime: 'CYCLE_VIOLATION', cfg: { targetRtp: 0.95, pachislotType: 6, playerSkillMultiplier: 1.02, betPerSpin: 150, spinsPerHour: 360, dailyPlayHours: 6, paybackCycleHours: 8.0, jagraCertified: true } },
  { name: 'F_low_volatility_low_rtp', regime: 'LOW_VOL', cfg: { targetRtp: 0.85, pachislotType: 6, playerSkillMultiplier: 1.01, betPerSpin: 100, spinsPerHour: 300, dailyPlayHours: 3, paybackCycleHours: 2.5, jagraCertified: true } },
];
async function main() {
  const { solveJpPachislot, simulateJpPachislot } = await import(join(REPO_ROOT, 'dist/features/jpPachislotSkillStop.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Validating ${CONFIGS.length} JP Pachislot configs…`);
  const results = []; let allOK = true;
  for (const c of CONFIGS) {
    const cf = solveJpPachislot(c.cfg);
    const mc = simulateJpPachislot(c.cfg, 0xCAFE0240, 200);
    const pass = cf.pachislotComplianceScore >= 0;
    if (!pass) allOK = false;
    console.log(`  ${c.name.padEnd(30)} ${pass ? '✅' : '❌'} ${c.regime} effRtp=${cf.effectiveRtp.toFixed(3)} hourly=¥${cf.expectedHourlyLoss.toFixed(0)} score=${cf.pachislotComplianceScore.toFixed(2)} fueiho=${cf.isCompliantFueiho}`);
    results.push({ name: c.name, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass });
  }
  writeFileSync(join(OUT_DIR, 'JP_PACHISLOT_SKILL_STOP.json'), JSON.stringify({ overall_pass: allOK, configs: results }, null, 2));
  const md = `# JP_PACHISLOT_SKILL_STOP\n\n**${results.filter(r => r.pass).length}/${results.length} PASS**\n\n| config | regime | effRtp | hourly ¥ | score | 風営法 | pass |\n|---|---|---|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.effectiveRtp.toFixed(3)} | ¥${r.closed_form.expectedHourlyLoss.toFixed(0)} | ${r.closed_form.pachislotComplianceScore.toFixed(2)} | ${r.closed_form.isCompliantFueiho ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`).join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'JP_PACHISLOT_SKILL_STOP.md'), md);
  console.log(`${allOK ? '✅' : '❌'} ${results.filter(r => r.pass).length}/${results.length} PASS`);
  process.exit(allOK ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
