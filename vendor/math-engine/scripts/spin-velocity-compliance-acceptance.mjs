#!/usr/bin/env node
//
// W222 — Spin Velocity / Auto-Play Time Compliance Analyzer acceptance.
//
// 6 jurisdiction configs × 20K MC interval samples = 120K Gamma random draws.
// Closed-form regularized incomplete gamma cross-validated against MC.
//
// Operator deliverable: `reports/acceptance/SPIN_VELOCITY_COMPLIANCE.{json,md}`.
//
// Compliance: UKGC SI 2025/215 Sch 3 §8.4 (min 2.5s spin time, mandatory Apr 2025),
// AU NCPF Reform 2022 Schedule 6 (min 3s + sound mute), DE GlüStV §6 Abs 4 (5s
// strictest EU), NL KSA RWA §7 (4s), MT MGA PPD §11 (effective spins/hour
// disclosure), CA Ontario AGCO §3.4.7 (auto-play velocity).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 20_000;
const SEED = 0xCAFE0222;

const TOL_EFFECTIVE_REL = 0.03;   // 3% rel error on E[Y]
const TOL_PBELOW_ABS = 0.02;      // 2pp abs error on P(X<T_min)
const TOL_SPINSMIN_REL = 0.04;    // 4% rel error on spins/min

const CONFIGS = [
  {
    name: 'A_uk_si2025_2.5s_typical_user',
    description: 'UKGC SI 2025/215 §8.4 mandatory 2.5s minimum, typical user Gamma(k=2, θ=0.8) E[X]=1.6s — throttle binds',
    cfg: {
      naturalIntervalShape: 2.0,
      naturalIntervalScale: 0.8,
      regulatoryMinIntervalSec: 2.5,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 1,
    },
    jurisdiction: 'UKGC',
  },
  {
    name: 'B_au_ncpf_3.0s_fast_tapper',
    description: 'AU NCPF Schedule 6 3.0s minimum, fast tapper Gamma(k=1.5, θ=0.6) E[X]=0.9s — heavy throttle',
    cfg: {
      naturalIntervalShape: 1.5,
      naturalIntervalScale: 0.6,
      regulatoryMinIntervalSec: 3.0,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 2,
    },
    jurisdiction: 'AU_NCPF',
  },
  {
    name: 'C_de_glustv_5.0s_strictest',
    description: 'DE GlüStV §6 Abs 4 5.0s strictest-EU minimum, normal user Gamma(k=2, θ=1.5) E[X]=3.0s',
    cfg: {
      naturalIntervalShape: 2.0,
      naturalIntervalScale: 1.5,
      regulatoryMinIntervalSec: 5.0,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 1,
    },
    jurisdiction: 'DE_GLUSTV',
  },
  {
    name: 'D_nl_ksa_4.0s_medium',
    description: 'NL KSA RWA §7 4.0s minimum, medium user Gamma(k=3, θ=0.7) E[X]=2.1s',
    cfg: {
      naturalIntervalShape: 3.0,
      naturalIntervalScale: 0.7,
      regulatoryMinIntervalSec: 4.0,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 1,
    },
    jurisdiction: 'NL_KSA',
  },
  {
    name: 'E_mt_mga_no_throttle_slow_user',
    description: 'MT MGA PPD §11 disclosure only (no hard throttle), slow user Gamma(k=4, θ=2) E[X]=8.0s — no binding',
    cfg: {
      naturalIntervalShape: 4.0,
      naturalIntervalScale: 2.0,
      regulatoryMinIntervalSec: 0.001,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 4,
    },
    jurisdiction: 'MT_MGA',
  },
  {
    name: 'F_extreme_fast_tapper_uk_throttle',
    description: 'Corner: extreme fast tapper Gamma(k=1, θ=0.3) Exponential E[X]=0.3s vs UKGC 2.5s — almost full throttle',
    cfg: {
      naturalIntervalShape: 1.0,
      naturalIntervalScale: 0.3,
      regulatoryMinIntervalSec: 2.5,
      realityCheckIntervalMinutes: 60,
      sessionDurationHours: 1,
    },
    jurisdiction: 'UKGC',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveSpinVelocityCompliance, simulateSpinVelocityCompliance } =
    await import(join(REPO_ROOT, 'dist', 'features', 'spinVelocityCompliance.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Spin Velocity Compliance configs @ ${EPISODES} MC samples each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveSpinVelocityCompliance(c.cfg);
    const mc = simulateSpinVelocityCompliance(c.cfg, SEED, EPISODES);

    const effectiveRel = relErr(cf.effectiveMeanIntervalSec, mc.observedEffectiveMeanIntervalSec);
    const pBelowDelta = Math.abs(cf.probIntervalBelowRegulatory - mc.observedProbIntervalBelowRegulatory);
    const spinsMinRel = relErr(cf.effectiveSpinsPerMinute, mc.observedEffectiveSpinsPerMinute);

    const checks = {
      effective_rel: effectiveRel,
      pbelow_delta: pBelowDelta,
      spins_min_rel: spinsMinRel,
    };

    const pass =
      effectiveRel <= TOL_EFFECTIVE_REL &&
      pBelowDelta <= TOL_PBELOW_ABS &&
      spinsMinRel <= TOL_SPINSMIN_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(42)} ${pass ? '✅' : '❌'}  ` +
        `${c.jurisdiction.padEnd(10)} T_min=${c.cfg.regulatoryMinIntervalSec}s  ` +
        `nat=${cf.naturalSpinsPerMinute.toFixed(1)}spm eff=${cf.effectiveSpinsPerMinute.toFixed(1)}spm  ` +
        `P_below=${cf.probIntervalBelowRegulatory.toFixed(3)}/${mc.observedProbIntervalBelowRegulatory.toFixed(3)}  ` +
        `harm=${cf.velocityHarmScore.toFixed(3)}  ` +
        `compl=${cf.compliesWithRegulatoryMinimum}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      jurisdiction: c.jurisdiction,
      cfg: c.cfg,
      closed_form: {
        naturalMeanIntervalSec: cf.naturalMeanIntervalSec,
        effectiveMeanIntervalSec: cf.effectiveMeanIntervalSec,
        naturalSpinsPerMinute: cf.naturalSpinsPerMinute,
        effectiveSpinsPerMinute: cf.effectiveSpinsPerMinute,
        naturalSpinsPerHour: cf.naturalSpinsPerHour,
        effectiveSpinsPerHour: cf.effectiveSpinsPerHour,
        probIntervalBelowRegulatory: cf.probIntervalBelowRegulatory,
        spinRateThrottleImpact: cf.spinRateThrottleImpact,
        expectedSpinsPerSession: cf.expectedSpinsPerSession,
        expectedSpinsBeforeFirstRealityCheck: cf.expectedSpinsBeforeFirstRealityCheck,
        oneInNSpinsRealityCheckTriggered: cf.oneInNSpinsRealityCheckTriggered,
        velocityHarmScore: cf.velocityHarmScore,
        compliesWithRegulatoryMinimum: cf.compliesWithRegulatoryMinimum,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedNaturalMeanIntervalSec: mc.observedNaturalMeanIntervalSec,
        observedEffectiveMeanIntervalSec: mc.observedEffectiveMeanIntervalSec,
        observedProbIntervalBelowRegulatory: mc.observedProbIntervalBelowRegulatory,
        observedNaturalSpinsPerMinute: mc.observedNaturalSpinsPerMinute,
        observedEffectiveSpinsPerMinute: mc.observedEffectiveSpinsPerMinute,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SPIN_VELOCITY_COMPLIANCE',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      effective_rel: TOL_EFFECTIVE_REL,
      pbelow_abs: TOL_PBELOW_ABS,
      spins_min_rel: TOL_SPINSMIN_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'SPIN_VELOCITY_COMPLIANCE.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# SPIN_VELOCITY_COMPLIANCE — Spin Velocity / Auto-Play Time Compliance Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC interval samples each = ${((CONFIGS.length * EPISODES) / 1e3).toFixed(0)}K total Gamma random draws.`);
  md.push('');
  md.push('Closes W222 — **79. closed-form solver**, first **TIME-RATE kernel** u portfolio (UKGC SI 2025/215 §8.4 + AU NCPF Schedule 6 + DE GlüStV §6 Abs 4 + NL KSA RWA §7 + MT MGA PPD §11 + CA AGCO §3.4.7).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Natural player click rate fits Gamma distribution (Harrigan-Dixon 2009, Templeton 2015):');
  md.push('  - **X ~ Gamma(shape=k, scale=θ)**, E[X] = k·θ');
  md.push('  - CDF: **F(x) = γ(k, x/θ) / Γ(k)** (regularized lower incomplete gamma)');
  md.push('');
  md.push('Throttled interval **Y = max(X, T_min)**:');
  md.push('  - **E[Y] = T_min·F(T_min) + k·θ·(1 − F_{k+1}(T_min))**');
  md.push('  - Identity ∫x·f_k(x)dx = k·θ·P(Gamma(k+1) ≥ t) (NR 6.2 lemma)');
  md.push('');
  md.push('Numerical recipe for γ(k, x):');
  md.push('  - **Series** representation for x < k+1 (NR eq 6.2.5)');
  md.push('  - **Continued fraction** for x ≥ k+1 (NR eq 6.2.6)');
  md.push('  - Lanczos log-gamma sa coefficient set g=7, n=9 (1e-15 accuracy)');
  md.push('');
  md.push('MC: per config 20K Marsaglia-Tsang Gamma(k, θ) random draws + max-clip throttle, mulberry32 RNG seed.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | jurisd. | k | θ | T_min | nat spm | eff spm | P_below CF | P_below MC | Δ_P | rel_E[Y] | harm | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.jurisdiction} | ${r.cfg.naturalIntervalShape} | ${r.cfg.naturalIntervalScale} | ${r.cfg.regulatoryMinIntervalSec}s | ${r.closed_form.naturalSpinsPerMinute.toFixed(1)} | ${r.closed_form.effectiveSpinsPerMinute.toFixed(1)} | ${r.closed_form.probIntervalBelowRegulatory.toFixed(3)} | ${r.monte_carlo.observedProbIntervalBelowRegulatory.toFixed(3)} | ${r.checks.pbelow_delta.toFixed(3)} | ${r.checks.effective_rel.toFixed(3)} | ${r.closed_form.velocityHarmScore.toFixed(3)} | ${r.closed_form.compliesWithRegulatoryMinimum ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| E[Y] (effective mean) | ≤ ${TOL_EFFECTIVE_REL} rel |`);
  md.push(`| P(X < T_min) | ≤ ${TOL_PBELOW_ABS} abs |`);
  md.push(`| spins/min CF vs MC | ≤ ${TOL_SPINSMIN_REL} rel |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form spin-velocity compliance kernel ready for UKGC SI 2025/215 + AU NCPF + DE GlüStV + NL KSA + MT MGA + CA AGCO audit submission. First TIME-RATE kernel u portfoliju — distinct od W110 (Negative Binomial trigger TIME, not rate), W163 (bet-progression Markov), W167 (cycle compensation), W220 (cumulative-net session stop).');

  writeFileSync(join(OUT_DIR, 'SPIN_VELOCITY_COMPLIANCE.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/SPIN_VELOCITY_COMPLIANCE.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
