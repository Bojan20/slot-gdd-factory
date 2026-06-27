#!/usr/bin/env node
//
// W226 — Pre-Commitment Loss-Limit Effectiveness Analyzer acceptance.
//
// 6 player-commitment-regime configs × 20K MC session draws = 120K Normal random
// draws. Truncated-Normal expectation closed-form cross-validated against MC.
//
// Operator deliverable: `reports/acceptance/PRE_COMMITMENT_LOSS_LIMIT.{json,md}`.
//
// Compliance: AU NCPF Reform 2022 Schedule 5 §5.2 (mandatory player-set loss
// limits sa 24h cooling-off) + UKGC LCCP 3.4.5 (player-elected limits + delayed-
// increase mandate, Apr 2024 expansion) + EU EBA RG Directive 2024 Annex VI
// (pre-commitment default-on UI) + NL KSA RWA §11 (mandatory pre-deposit limit-
// setting) + DE GlüStV §6c (€1000/month default cap).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 20_000;
const SEED = 0xCAFE0226;

const TOL_EFFECTIVE_REL = 0.04;
const TOL_PHIT_ABS = 0.02;
const TOL_HARM_RED_ABS = 0.03;

const CONFIGS = [
  {
    name: 'A_au_ncpf_default_AUD50',
    description: 'AU NCPF §5.2 default A$50 daily limit, typical player (μ=£30, σ=£25, α=0.75)',
    cfg: {
      sessionLossMean: 30,
      sessionLossStd: 25,
      playerLossLimit: 50,
      adherenceRate: 0.75,
      limitEscalationFactor: 1.5,
      sessionsPerYear: 300,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'AU_NCPF',
  },
  {
    name: 'B_uk_lccp_tight_£25_limit',
    description: 'UKGC LCCP 3.4.5 tight £25 limit, high-discipline player (α=0.85)',
    cfg: {
      sessionLossMean: 30,
      sessionLossStd: 25,
      playerLossLimit: 25,
      adherenceRate: 0.85,
      limitEscalationFactor: 1.3,
      sessionsPerYear: 365,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'C_eu_eba_relaxed_high_roller',
    description: 'EU EBA high-roller £200 limit, moderate adherence (α=0.6, γ=2.0)',
    cfg: {
      sessionLossMean: 100,
      sessionLossStd: 80,
      playerLossLimit: 200,
      adherenceRate: 0.6,
      limitEscalationFactor: 2.0,
      sessionsPerYear: 200,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'EU_EBA',
  },
  {
    name: 'D_nl_ksa_mandatory_predeposit_€50',
    description: 'NL KSA RWA §11 mandatory pre-deposit limit €50, typical user',
    cfg: {
      sessionLossMean: 35,
      sessionLossStd: 30,
      playerLossLimit: 50,
      adherenceRate: 0.7,
      limitEscalationFactor: 1.5,
      sessionsPerYear: 250,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'NL_KSA',
  },
  {
    name: 'E_corner_low_adherence_player',
    description: 'Corner: low-adherence player (α=0.4) — limit largely ignored',
    cfg: {
      sessionLossMean: 50,
      sessionLossStd: 40,
      playerLossLimit: 50,
      adherenceRate: 0.4,
      limitEscalationFactor: 2.0,
      sessionsPerYear: 365,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'F_corner_perfect_adherence',
    description: 'Corner: perfect adherence (α=1.0) — maximum harm reduction',
    cfg: {
      sessionLossMean: 50,
      sessionLossStd: 40,
      playerLossLimit: 25,
      adherenceRate: 1.0,
      limitEscalationFactor: 1.5,
      sessionsPerYear: 365,
      defaultDailyLimit: 50,
      coolingPeriodHours: 24,
    },
    jurisdiction: 'UKGC',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.001);
}

async function main() {
  const { solvePreCommitmentLossLimit, simulatePreCommitmentLossLimit } = await import(
    join(REPO_ROOT, 'dist', 'features', 'preCommitmentLossLimit.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Pre-Commitment configs @ ${EPISODES} MC sessions each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solvePreCommitmentLossLimit(c.cfg);
    const mc = simulatePreCommitmentLossLimit(c.cfg, SEED, EPISODES);

    const effRel = relErr(cf.expectedLossEffective, mc.observedExpectedLossEffective);
    const pHitDelta = Math.abs(cf.probSessionHitsLimit - mc.observedProbSessionHitsLimit);
    const harmDelta = Math.abs(cf.harmReductionFromLimit - mc.observedHarmReductionFromLimit);

    const checks = {
      effective_rel: effRel,
      phit_delta: pHitDelta,
      harm_red_delta: harmDelta,
    };

    const pass =
      effRel <= TOL_EFFECTIVE_REL &&
      pHitDelta <= TOL_PHIT_ABS &&
      harmDelta <= TOL_HARM_RED_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.jurisdiction.padEnd(7)} μ=${c.cfg.sessionLossMean} L=${c.cfg.playerLossLimit} α=${c.cfg.adherenceRate.toFixed(2)}  ` +
        `effLoss=${cf.expectedLossEffective.toFixed(1)}/${mc.observedExpectedLossEffective.toFixed(1)}  ` +
        `P_hit=${cf.probSessionHitsLimit.toFixed(2)}  ` +
        `harmRed=${cf.harmReductionFromLimit.toFixed(2)}  ` +
        `annual_save=£${cf.absoluteAnnualHarmReduction.toFixed(0)}  ` +
        `comply=${cf.isCompliantAuNcpfSection5}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      jurisdiction: c.jurisdiction,
      cfg: c.cfg,
      closed_form: {
        expectedLossNoLimit: cf.expectedLossNoLimit,
        expectedLossWithLimit: cf.expectedLossWithLimit,
        expectedLossEscalatedLimit: cf.expectedLossEscalatedLimit,
        expectedLossEffective: cf.expectedLossEffective,
        probSessionHitsLimit: cf.probSessionHitsLimit,
        harmReductionFromLimit: cf.harmReductionFromLimit,
        expectedAnnualLossNoLimit: cf.expectedAnnualLossNoLimit,
        expectedAnnualLossWithLimit: cf.expectedAnnualLossWithLimit,
        absoluteAnnualHarmReduction: cf.absoluteAnnualHarmReduction,
        expectedAnnualSessionsAtLimit: cf.expectedAnnualSessionsAtLimit,
        expectedAnnualLimitBreachAttempts: cf.expectedAnnualLimitBreachAttempts,
        isCompliantAuNcpfSection5: cf.isCompliantAuNcpfSection5,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedExpectedLossEffective: mc.observedExpectedLossEffective,
        observedProbSessionHitsLimit: mc.observedProbSessionHitsLimit,
        observedHarmReductionFromLimit: mc.observedHarmReductionFromLimit,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PRE_COMMITMENT_LOSS_LIMIT',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      effective_rel: TOL_EFFECTIVE_REL,
      phit_abs: TOL_PHIT_ABS,
      harm_red_abs: TOL_HARM_RED_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'PRE_COMMITMENT_LOSS_LIMIT.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# PRE_COMMITMENT_LOSS_LIMIT — Pre-Commitment Loss-Limit Effectiveness Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC sessions each = ${((CONFIGS.length * EPISODES) / 1e3).toFixed(0)}K Normal random draws.`);
  md.push('');
  md.push('Closes W226 — **83. closed-form solver, first BEHAVIORAL-COMMITMENT kernel** u portfolio (AU NCPF §5.2 + UKGC LCCP 3.4.5 + EU EBA Annex VI + NL KSA §11 + DE GlüStV §6c).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Player session-loss X ~ Normal(μ, σ²) (Auer-Griffiths 2017, Wood-Williams 2011).');
  md.push('');
  md.push('Pre-commitment: player sets daily loss limit L_d. Hard-clip at L_d.');
  md.push('');
  md.push('Truncated-Normal expectation (Greene 2012 §22.4):');
  md.push('  - **E[min(X, L)] = μ·Φ(z) − σ·φ(z) + L·(1 − Φ(z))**, z = (L − μ)/σ');
  md.push('');
  md.push('Adherence behavior (Wood-Griffiths 2018, Auer-Hopfgartner 2022):');
  md.push('  - α ∈ [0.4, 0.85] = fraction of sessions respecting original L_d');
  md.push('  - γ ≥ 1 = limit-escalation factor when player overrides (typical 1.5)');
  md.push('');
  md.push('Effective loss:');
  md.push('  - **E[loss_effective] = α · E[min(X, L)] + (1 − α) · E[min(X, γ·L)]**');
  md.push('');
  md.push('Harm reduction:');
  md.push('  - **harmReductionFromLimit = (μ − E[loss_effective]) / μ**  ∈ [0, 1]');
  md.push('');
  md.push('AU NCPF §5.2 compliance: defaultDailyLimit ≤ A$50 ∧ α ≥ 0.5 ∧ cooling ≥ 24h.');
  md.push('');
  md.push('MC: 20K Normal session-loss draws + Bernoulli(α) adherence flag + clip → effective loss average.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | jurisd. | μ | σ | L | α | γ | CF effLoss | MC effLoss | rel | P_hit | harmRed | annual_save | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.jurisdiction} | ${r.cfg.sessionLossMean} | ${r.cfg.sessionLossStd} | ${r.cfg.playerLossLimit} | ${r.cfg.adherenceRate.toFixed(2)} | ${r.cfg.limitEscalationFactor} | ${r.closed_form.expectedLossEffective.toFixed(1)} | ${r.monte_carlo.observedExpectedLossEffective.toFixed(1)} | ${r.checks.effective_rel.toFixed(3)} | ${r.closed_form.probSessionHitsLimit.toFixed(2)} | ${r.closed_form.harmReductionFromLimit.toFixed(2)} | ${r.closed_form.absoluteAnnualHarmReduction.toFixed(0)} | ${r.closed_form.isCompliantAuNcpfSection5 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| E[loss_effective] rel | ≤ ${TOL_EFFECTIVE_REL} |`);
  md.push(`| P(hit limit) abs | ≤ ${TOL_PHIT_ABS} |`);
  md.push(`| harmReduction abs | ≤ ${TOL_HARM_RED_ABS} |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form player-set pre-commitment loss-limit kernel ready for AU NCPF §5.2 + UKGC LCCP 3.4.5 + EU EBA Annex VI + NL KSA §11 + DE GlüStV §6c audit submission. **83. solver — first BEHAVIORAL-COMMITMENT kernel** u portfolio. Distinct od W148/W154/W157-W167 (within-session no limit-setting) / W220 (SYSTEM-enforced session boundary, not player-set) / W222 (per-spin time) / W223-W225 (multi-day/month/lifetime). Ovo modeluje voluntary player-set daily limit sa empirically observed adherence/escalation behavior.');

  writeFileSync(join(OUT_DIR, 'PRE_COMMITMENT_LOSS_LIMIT.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/PRE_COMMITMENT_LOSS_LIMIT.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
