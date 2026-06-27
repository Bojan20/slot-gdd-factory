#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 500;
const SEED = 0xCAFE0236;

const CONFIGS = [
  {
    name: 'A_uk_fair_baseline',
    description: 'UK fair baseline: small DP/EO/DI deviations',
    cfg: {
      positiveRateGroupA: 0.30, positiveRateGroupB: 0.35,
      truePositiveRateA: 0.85, truePositiveRateB: 0.87,
      falsePositiveRateA: 0.10, falsePositiveRateB: 0.09,
      ppvGroupA: 0.75, ppvGroupB: 0.78,
      demographicParityTolerance: 0.10, equalizedOddsTolerance: 0.05,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: true, humanOversightEnabled: true,
    },
    regime: 'FAIR_BASELINE',
  },
  {
    name: 'B_eu_perfect_fairness',
    description: 'EU AI Act gold standard: zero deviations, full compliance',
    cfg: {
      positiveRateGroupA: 0.30, positiveRateGroupB: 0.30,
      truePositiveRateA: 0.85, truePositiveRateB: 0.85,
      falsePositiveRateA: 0.10, falsePositiveRateB: 0.10,
      ppvGroupA: 0.78, ppvGroupB: 0.78,
      demographicParityTolerance: 0.10, equalizedOddsTolerance: 0.05,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: true, humanOversightEnabled: true,
    },
    regime: 'GOLD_STANDARD',
  },
  {
    name: 'C_us_disparate_impact_failure',
    description: 'US EEOC 4/5 rule failure: DI < 0.80',
    cfg: {
      positiveRateGroupA: 0.15, positiveRateGroupB: 0.40,
      truePositiveRateA: 0.70, truePositiveRateB: 0.85,
      falsePositiveRateA: 0.08, falsePositiveRateB: 0.10,
      ppvGroupA: 0.65, ppvGroupB: 0.80,
      demographicParityTolerance: 0.10, equalizedOddsTolerance: 0.05,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: true, humanOversightEnabled: true,
    },
    regime: 'DI_FAILURE',
  },
  {
    name: 'D_no_oversight_no_docs',
    description: 'Corner: no documentation, no human oversight → EU AI Act fail',
    cfg: {
      positiveRateGroupA: 0.30, positiveRateGroupB: 0.32,
      truePositiveRateA: 0.85, truePositiveRateB: 0.86,
      falsePositiveRateA: 0.10, falsePositiveRateB: 0.10,
      ppvGroupA: 0.78, ppvGroupB: 0.79,
      demographicParityTolerance: 0.10, equalizedOddsTolerance: 0.05,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: false, humanOversightEnabled: false,
    },
    regime: 'NO_OVERSIGHT',
  },
  {
    name: 'E_strict_thresholds_audit_grade',
    description: 'Strict audit-grade: DP=0.02, EO=0.01 thresholds',
    cfg: {
      positiveRateGroupA: 0.30, positiveRateGroupB: 0.31,
      truePositiveRateA: 0.85, truePositiveRateB: 0.85,
      falsePositiveRateA: 0.10, falsePositiveRateB: 0.10,
      ppvGroupA: 0.78, ppvGroupB: 0.78,
      demographicParityTolerance: 0.02, equalizedOddsTolerance: 0.01,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: true, humanOversightEnabled: true,
    },
    regime: 'STRICT_AUDIT',
  },
  {
    name: 'F_equalized_odds_failure',
    description: 'Corner: passes DP but fails equalized odds (different error rates)',
    cfg: {
      positiveRateGroupA: 0.30, positiveRateGroupB: 0.30,
      truePositiveRateA: 0.70, truePositiveRateB: 0.95,
      falsePositiveRateA: 0.20, falsePositiveRateB: 0.05,
      ppvGroupA: 0.70, ppvGroupB: 0.90,
      demographicParityTolerance: 0.10, equalizedOddsTolerance: 0.05,
      disparateImpactLower: 0.80, disparateImpactUpper: 1.25,
      documentationComplete: true, humanOversightEnabled: true,
    },
    regime: 'EO_FAILURE',
  },
];

async function main() {
  const { solveAiFairness, simulateAiFairness } = await import(
    join(REPO_ROOT, 'dist', 'features', 'aiFairnessAudit.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} AI fairness configs @ ${EPISODES} MC sampling runs each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveAiFairness(c.cfg);
    const mc = simulateAiFairness(c.cfg, SEED, EPISODES);
    const dpDelta = Math.abs(cf.demographicParityDifference - mc.observedDemographicParityMean);
    const pass = dpDelta <= 0.02;
    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(36)} ${pass ? '✅' : '❌'}  ` +
        `${c.regime.padEnd(15)} DP=${cf.demographicParityDifference.toFixed(3)} EO_TPR=${cf.equalizedOddsTprDiff.toFixed(3)} DI=${cf.disparateImpactRatio.toFixed(2)}  ` +
        `score=${cf.fairnessCompositeScore.toFixed(2)} eu=${cf.isCompliantEuAiAct} uk=${cf.isCompliantUkgcRts1211}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({ name: c.name, description: c.description, regime: c.regime, cfg: c.cfg, closed_form: cf, monte_carlo: mc, pass, elapsed_ms: elapsedMs });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'AI_FAIRNESS_AUDIT',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'AI_FAIRNESS_AUDIT.json'), JSON.stringify(summary, null, 2));

  const md = [
    '# AI_FAIRNESS_AUDIT — AI/ML Player Profiling Fairness Audit Analyzer Acceptance',
    '',
    `Generated: \`${summary.generated_utc}\``,
    '',
    `**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${EPISODES} MC sampling runs each.`,
    '',
    '## Results',
    '',
    '| config | regime | DP | EO_TPR | DI | score | EU AI Act | UKGC | pass |',
    '|---|---|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.name} | ${r.regime} | ${r.closed_form.demographicParityDifference.toFixed(3)} | ${r.closed_form.equalizedOddsTprDiff.toFixed(3)} | ${r.closed_form.disparateImpactRatio.toFixed(2)} | ${r.closed_form.fairnessCompositeScore.toFixed(2)} | ${r.closed_form.isCompliantEuAiAct ? '✅' : '❌'} | ${r.closed_form.isCompliantUkgcRts1211 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
    '',
    `**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`,
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'AI_FAIRNESS_AUDIT.md'), md);

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/AI_FAIRNESS_AUDIT.{json,md}`);
  process.exit(allOK ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
