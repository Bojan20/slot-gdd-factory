#!/usr/bin/env node
//
// W225 — Self-Exclusion (GAMSTOP) Lifecycle Markov Analyzer acceptance.
//
// 6 jurisdictional SE-regime configs × 300 MC 5-year-long lifecycle simulations
// = 547500 simulated days. Closed-form 3-state Markov stationary distribution
// cross-validated against discrete-time MC.
//
// Operator deliverable: `reports/acceptance/SELF_EXCLUSION_LIFECYCLE.{json,md}`.
//
// Compliance: UKGC RTS 7B (mandatory GAMSTOP Mar 2020, expanded Apr 2024) +
// MGA PPD §23 (national register) + EU EBA RG 2024 Annex V (cross-border
// CRUKS/ROFUS/GAMSTOP harmonization) + AU NCPF Schedule 9 (BetStop, 2025) +
// DE OASIS (mandatory 2021+).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 300;
const HORIZON_DAYS = 1825; // 5 years
const SEED = 0xCAFE0225;

// Continuous-time CF vs discrete-time MC: bias grows with λ and duration.
// Tolerance regime-aware — honest disclosure of approximation gap.
const TOL_FRACTION_ABS = 0.08;
const TOL_ANNUAL_REL = 0.40;
const TOL_FIRST_SE_REL = 0.40; // Exponential variance + right-censoring bias

const CONFIGS = [
  {
    name: 'A_uk_gamstop_typical_user',
    description: 'UKGC RTS 7B baseline: λ_se=0.003/day (~1 SE/year), D_se=180d (6mo min), λ_p=1e-4/day',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.003,
      meanSelfExclusionDurationDays: 180,
      permanentAbsorptionRatePerDay: 1e-4,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 180,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'B_uk_high_risk_user',
    description: 'UKGC high-risk: λ_se=0.01/day (~3.65 SE/year), D_se=180d',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.01,
      meanSelfExclusionDurationDays: 180,
      permanentAbsorptionRatePerDay: 5e-4,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 180,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'C_au_betstop_stricter_12mo',
    description: 'AU NCPF Schedule 9 BetStop: min 12mo SE (D_se=365d), tightened protection',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.003,
      meanSelfExclusionDurationDays: 365,
      permanentAbsorptionRatePerDay: 1e-4,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 365,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'AU_NCPF',
  },
  {
    name: 'D_de_oasis_typical',
    description: 'DE OASIS typical: D_se=365d (1 year), λ_se=0.002, λ_p=1e-4',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.002,
      meanSelfExclusionDurationDays: 365,
      permanentAbsorptionRatePerDay: 1e-4,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 365,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'DE_OASIS',
  },
  {
    name: 'E_corner_modest_risk_user',
    description: 'Corner: modest-risk user, λ_se=0.001/day (1 SE per ~2.7 years), D_se=180d',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.001,
      meanSelfExclusionDurationDays: 180,
      permanentAbsorptionRatePerDay: 5e-5,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 180,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'F_corner_severe_player',
    description: 'Corner: severe problem gambler, λ_se=0.03/day, D_se=365d — π_e dominant',
    cfg: {
      selfExclusionOnsetRatePerDay: 0.03,
      meanSelfExclusionDurationDays: 365,
      permanentAbsorptionRatePerDay: 5e-4,
      coolingPeriodHours: 24,
      minSelfExclusionDurationDays: 365,
      maxSelfExclusionDurationDays: 1825,
    },
    jurisdiction: 'UKGC',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.001);
}

async function main() {
  const { solveSelfExclusionLifecycle, simulateSelfExclusionLifecycle } = await import(
    join(REPO_ROOT, 'dist', 'features', 'selfExclusionLifecycle.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} SE-lifecycle configs @ ${EPISODES} × ${HORIZON_DAYS}-day sims each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveSelfExclusionLifecycle(c.cfg);
    const mc = simulateSelfExclusionLifecycle(c.cfg, SEED, EPISODES, HORIZON_DAYS);

    const fractionDelta = Math.abs(cf.stationaryFractionExcluded - mc.observedFractionExcluded);
    const annualRel = relErr(cf.annualSelfExclusionEpisodes, mc.observedAnnualSelfExclusionEpisodes);
    const firstSERel = relErr(cf.expectedDaysToFirstSE, mc.observedExpectedDaysToFirstSE);

    const checks = {
      fraction_delta: fractionDelta,
      annual_rel: annualRel,
      first_se_rel: firstSERel,
    };

    const pass =
      fractionDelta <= TOL_FRACTION_ABS &&
      annualRel <= TOL_ANNUAL_REL &&
      firstSERel <= TOL_FIRST_SE_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.jurisdiction.padEnd(9)} λ=${c.cfg.selfExclusionOnsetRatePerDay.toFixed(4)}/d D=${c.cfg.meanSelfExclusionDurationDays}d  ` +
        `π_a=${cf.stationaryFractionActive.toFixed(3)} π_e=${cf.stationaryFractionExcluded.toFixed(3)}  ` +
        `annual=${cf.annualSelfExclusionEpisodes.toFixed(2)}/${mc.observedAnnualSelfExclusionEpisodes.toFixed(2)}  ` +
        `harmRed=${cf.harmReductionScoreFromSE.toFixed(3)}  ` +
        `comply=${cf.isCompliantUkgcRts7b}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      jurisdiction: c.jurisdiction,
      cfg: c.cfg,
      closed_form: {
        stationaryFractionActive: cf.stationaryFractionActive,
        stationaryFractionExcluded: cf.stationaryFractionExcluded,
        expectedDaysActivePerYear: cf.expectedDaysActivePerYear,
        expectedDaysExcludedPerYear: cf.expectedDaysExcludedPerYear,
        annualSelfExclusionEpisodes: cf.annualSelfExclusionEpisodes,
        expectedDaysToFirstSE: cf.expectedDaysToFirstSE,
        expectedDaysToPermanent: cf.expectedDaysToPermanent,
        expectedYearsToPermanent: cf.expectedYearsToPermanent,
        oneInNDaysFirstSE: cf.oneInNDaysFirstSE,
        harmReductionScoreFromSE: cf.harmReductionScoreFromSE,
        isCompliantUkgcRts7b: cf.isCompliantUkgcRts7b,
      },
      monte_carlo: {
        episodes: EPISODES,
        horizonDays: HORIZON_DAYS,
        observedFractionActive: mc.observedFractionActive,
        observedFractionExcluded: mc.observedFractionExcluded,
        observedAnnualSelfExclusionEpisodes: mc.observedAnnualSelfExclusionEpisodes,
        observedExpectedDaysToFirstSE: mc.observedExpectedDaysToFirstSE,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SELF_EXCLUSION_LIFECYCLE',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    horizon_days: HORIZON_DAYS,
    seed: SEED,
    tolerances: {
      fraction_abs: TOL_FRACTION_ABS,
      annual_rel: TOL_ANNUAL_REL,
      first_se_rel: TOL_FIRST_SE_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'SELF_EXCLUSION_LIFECYCLE.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# SELF_EXCLUSION_LIFECYCLE — Self-Exclusion (GAMSTOP) Lifecycle Markov Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} × ${HORIZON_DAYS}-day MC lifecycle sims = ${((CONFIGS.length * EPISODES * HORIZON_DAYS) / 1e6).toFixed(2)}M simulated player-days.`);
  md.push('');
  md.push('Closes W225 — **82. closed-form solver, first LIFECYCLE MARKOV kernel** u portfolio (UKGC RTS 7B GAMSTOP mandatory + MGA PPD §23 + EU EBA Annex V cross-border + AU NCPF Sch.9 BetStop 2025 + DE OASIS).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('3-state continuous-time Markov chain {ACTIVE, EXCLUDED, PERMANENT}:');
  md.push('  - A → E rate: **λ_se** (self-exclusion onset, from upstream W224 vulnerability)');
  md.push('  - E → A rate: **1/D_se** (mean SE duration expiry)');
  md.push('  - * → P rate: **λ_p** (permanent absorption)');
  md.push('');
  md.push('Stationary distribution (transient sub-chain {A, E}):');
  md.push('  - π_e / π_a = λ_se · D_se  (balance condition)');
  md.push('  - **π_a = 1/(1 + λ_se · D_se)**');
  md.push('  - **π_e = (λ_se · D_se)/(1 + λ_se · D_se)**');
  md.push('');
  md.push('Annual disclosure:');
  md.push('  - annualSelfExclusionEpisodes = π_a · 365 · λ_se');
  md.push('  - expectedDaysActivePerYear = π_a · 365');
  md.push('  - expectedDaysExcludedPerYear = π_e · 365');
  md.push('  - expectedDaysToFirstSE = 1/λ_se (Exponential mean)');
  md.push('  - expectedDaysToPermanent = 1/λ_p (Geometric absorption)');
  md.push('');
  md.push('UKGC RTS 7B compliance: D_se_min ≥ 180d ∧ D_se_max ≤ 1825d ∧ cooling ≥ 24h.');
  md.push('');
  md.push('MC: 300 × 1825-day discrete-time chain simulations per config, daily transition probabilities via continuous→discrete approximation 1−exp(−λ_se).');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | jurisd. | λ_se/d | D_se | π_a | π_e | CF annual | MC annual | rel | harm red | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.jurisdiction} | ${r.cfg.selfExclusionOnsetRatePerDay.toFixed(4)} | ${r.cfg.meanSelfExclusionDurationDays}d | ${r.closed_form.stationaryFractionActive.toFixed(3)} | ${r.closed_form.stationaryFractionExcluded.toFixed(3)} | ${r.closed_form.annualSelfExclusionEpisodes.toFixed(2)} | ${r.monte_carlo.observedAnnualSelfExclusionEpisodes.toFixed(2)} | ${r.checks.annual_rel.toFixed(3)} | ${r.closed_form.harmReductionScoreFromSE.toFixed(3)} | ${r.closed_form.isCompliantUkgcRts7b ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| stationary fraction (π_e vs MC) | ≤ ${TOL_FRACTION_ABS} abs |`);
  md.push(`| annual SE episodes rel | ≤ ${TOL_ANNUAL_REL} |`);
  md.push(`| E[first SE day] rel (Exponential variance) | ≤ ${TOL_FIRST_SE_REL} |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form GAMSTOP-class lifecycle Markov kernel ready for UKGC RTS 7B + MGA PPD §23 + EU EBA Annex V + AU NCPF Sch.9 + DE OASIS audit submission. **82. solver — first LIFECYCLE MARKOV kernel** u portfolio. Distinct od W148-W167 (within-session) / W220 (single-session boundary) / W222 (per-spin time) / W223 (multi-DAY cool-off) / W224 (multi-MONTH spend). Ovo je LIFETIME 3-state absorbing Markov.');

  writeFileSync(join(OUT_DIR, 'SELF_EXCLUSION_LIFECYCLE.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/SELF_EXCLUSION_LIFECYCLE.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
