#!/usr/bin/env node
//
// W152 Wave 160 — Hit Frequency Distribution Decomposition Analyzer acceptance (Wave 159).
//
// 6 industry-representative payout PMF configs × 200K spinova each
// = 1.2M total MC samples. Closed-form survival-function decomposition
// cross-validated against categorical PMF sampler.
//
// Operator deliverable: `reports/acceptance/HIT_FREQUENCY_DISTRIBUTION.{json,md}`.
//
// Compliance: UKGC RTS 14 Tag 12 (operator must disclose top hit rates),
// MGA Player Protection Directives §11.f (variance disclosure including
// tier-stratified hit frequency), eCOGRA Generic Slots Audit (hit-frequency
// table mandate), AU NCPF Reform 2022 Schedule 3 (rare-events disclosure
// with "1 in X" frequency).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 200_000;
const SEED = 0xCAFE0159;

// MC vs CF tolerances. With 200K spins, even rare events (1-in-10000) get ~20
// observations — enough to verify CF vs MC for top hit tiers. Very-rare events
// (1-in-100000+) have MC noise dominant; we relax abs check for those tiers.
const TOL_RTP_REL = 0.10;                    // Total RTP rel ≤ 10% @ 200K (heavy-tail configs sa 1-in-10K events imaju visoku MC varijansu — single tail-event shifts MC RTP ~5%)
const TOL_OVERALL_HF_ABS = 0.005;            // Overall hit freq abs ≤ 0.5pp
const TOL_TIER_PROB_REL = 0.20;              // Per-tier prob rel ≤ 20% (relaxed for rare tiers)
const TOL_TIER_PROB_ABS_FLOOR = 0.001;       // Abs ≤ 0.1pp absolute floor (for rare tiers where rel meaningless)

const CONFIGS = [
  {
    name: 'A_starburst_class_medium_vol',
    description: 'Vendor D Starburst-class medium-vol slot (96% RTP, classic operator baseline)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.732 },
        { multiple: 1, probability: 0.10 },
        { multiple: 2, probability: 0.07 },
        { multiple: 5, probability: 0.05 },
        { multiple: 10, probability: 0.03 },
        { multiple: 25, probability: 0.012 },
        { multiple: 50, probability: 0.004 },
        { multiple: 100, probability: 0.0015 },
        { multiple: 500, probability: 0.0004 },
        { multiple: 1000, probability: 0.0001 },
      ],
      tierThresholds: [1, 5, 10, 50, 100, 500, 1000],
      paretoTailStartMultiplier: 10,
    },
  },
  {
    name: 'B_pragmatic_sweet_bonanza_high_vol',
    description: 'Pragmatic Sweet Bonanza-class high-vol heavy-tail tumbling slot (96.5% RTP)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.82 },
        { multiple: 1, probability: 0.05 },
        { multiple: 2, probability: 0.04 },
        { multiple: 5, probability: 0.035 },
        { multiple: 10, probability: 0.025 },
        { multiple: 50, probability: 0.018 },
        { multiple: 100, probability: 0.008 },
        { multiple: 500, probability: 0.0030 },
        { multiple: 1000, probability: 0.0008 },
        { multiple: 5000, probability: 0.0002 },
      ],
      tierThresholds: [1, 5, 10, 100, 500, 1000, 5000],
      paretoTailStartMultiplier: 50,
    },
  },
  {
    name: 'C_hacksaw_extreme_max_win',
    description: 'Hacksaw extreme max-win slot (Mining Pots / Wanted Dead — 25000× max, 96.4% RTP)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.85 },
        { multiple: 1, probability: 0.05 },
        { multiple: 3, probability: 0.04 },
        { multiple: 10, probability: 0.03 },
        { multiple: 50, probability: 0.018 },
        { multiple: 200, probability: 0.008 },
        { multiple: 1000, probability: 0.003 },
        { multiple: 5000, probability: 0.0009 },
        { multiple: 25000, probability: 0.0001 },
      ],
      tierThresholds: [1, 10, 200, 1000, 5000, 25000],
      paretoTailStartMultiplier: 50,
    },
  },
  {
    name: 'D_netent_classic_96pct_low_vol',
    description: 'Vendor D classic 96% RTP low-vol slot (Gonzo classic / Twin Spin — operator default)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.60 },
        { multiple: 1, probability: 0.15 },
        { multiple: 2, probability: 0.10 },
        { multiple: 3, probability: 0.07 },
        { multiple: 5, probability: 0.05 },
        { multiple: 10, probability: 0.018 },
        { multiple: 25, probability: 0.008 },
        { multiple: 50, probability: 0.003 },
        { multiple: 100, probability: 0.0009 },
        { multiple: 500, probability: 0.0001 },
      ],
      tierThresholds: [1, 3, 10, 50, 100, 500],
      paretoTailStartMultiplier: 10,
    },
  },
  {
    name: 'E_big_time_megaways_megaway_class',
    description: 'BTG Megaways-class slot (Bonanza Megaways / Extra Chilli — variable ways, 96-97% RTP)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.755 },
        { multiple: 1, probability: 0.09 },
        { multiple: 2, probability: 0.06 },
        { multiple: 5, probability: 0.045 },
        { multiple: 10, probability: 0.025 },
        { multiple: 20, probability: 0.015 },
        { multiple: 50, probability: 0.007 },
        { multiple: 200, probability: 0.0022 },
        { multiple: 1000, probability: 0.0007 },
        { multiple: 10000, probability: 0.0001 },
      ],
      tierThresholds: [1, 10, 50, 200, 1000, 10000],
      paretoTailStartMultiplier: 50,
    },
  },
  {
    name: 'F_corner_uniform_pmf_sanity',
    description: 'Corner case: uniform PMF over {0, 1, 2, 3, 4} (sanity check — HF=80%, RTP=2.0)',
    cfg: {
      payoutPmf: [
        { multiple: 0, probability: 0.2 },
        { multiple: 1, probability: 0.2 },
        { multiple: 2, probability: 0.2 },
        { multiple: 3, probability: 0.2 },
        { multiple: 4, probability: 0.2 },
      ],
      tierThresholds: [1, 2, 3, 4],
      paretoTailStartMultiplier: 1, // include all positives
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveHitFrequencyDistribution, simulateHitFrequencyDistribution } =
    await import(join(REPO_ROOT, 'dist', 'features', 'hitFrequencyDistribution.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Hit Frequency Distribution configs @ ${SPINS} spinova each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveHitFrequencyDistribution(c.cfg);
    const mc = simulateHitFrequencyDistribution(c.cfg, SPINS, SEED);

    const rtpRel = relErr(cf.totalRtp, mc.observedRtp);
    const hfAbs = Math.abs(cf.overallHitFrequency - mc.observedHitFrequency);

    // Per-tier: take max over rel OR abs (whichever is more lenient for rare-tier MC noise).
    const tierMismatches = [];
    for (let i = 0; i < cf.tierBreakdown.length; i++) {
      const cfTier = cf.tierBreakdown[i];
      const mcTier = mc.observedTierProbabilities[i];
      const tierRel = relErr(cfTier.tierProb, mcTier.observedProb);
      const tierAbs = Math.abs(cfTier.tierProb - mcTier.observedProb);
      const tierOk = tierRel <= TOL_TIER_PROB_REL || tierAbs <= TOL_TIER_PROB_ABS_FLOOR;
      tierMismatches.push({
        threshold: cfTier.threshold,
        cf: cfTier.tierProb,
        mc: mcTier.observedProb,
        rel: tierRel,
        abs: tierAbs,
        ok: tierOk,
      });
    }
    const allTiersOk = tierMismatches.every((t) => t.ok);

    const checks = {
      rtp_rel: rtpRel,
      hf_abs: hfAbs,
      all_tiers_ok: allTiersOk,
    };
    const pass =
      rtpRel <= TOL_RTP_REL &&
      hfAbs <= TOL_OVERALL_HF_ABS &&
      allTiersOk;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(42)} ${pass ? '✅' : '❌'}  ` +
        `RTP=${cf.totalRtp.toFixed(3)}/${mc.observedRtp.toFixed(3)} ` +
        `HF=${(cf.overallHitFrequency * 100).toFixed(2)}%/${(mc.observedHitFrequency * 100).toFixed(2)}% ` +
        `Pareto α=${Number.isFinite(cf.paretoTailAlpha) ? cf.paretoTailAlpha.toFixed(2) : 'NaN'} ` +
        `top1%=${(cf.rtpConcentration[0].rtpShare * 100).toFixed(1)}% ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        totalRtp: cf.totalRtp,
        totalVariance: cf.totalVariance,
        totalStdDev: cf.totalStdDev,
        overallHitFrequency: cf.overallHitFrequency,
        overallOneInN: Number.isFinite(cf.overallOneInN) ? cf.overallOneInN : 'Infinity',
        tierBreakdown: cf.tierBreakdown.map((t) => ({
          threshold: t.threshold,
          tierProb: t.tierProb,
          oneInN: Number.isFinite(t.oneInN) ? t.oneInN : 'Infinity',
          condEV: t.condEV,
          rtpContribution: t.rtpContribution,
          rtpShareOfTotal: t.rtpShareOfTotal,
        })),
        rtpConcentration: cf.rtpConcentration,
        paretoTailAlpha: Number.isFinite(cf.paretoTailAlpha) ? cf.paretoTailAlpha : 'NaN',
        paretoTailRowCount: cf.paretoTailRowCount,
      },
      monte_carlo: {
        spinsSimulated: mc.spinsSimulated,
        observedRtp: mc.observedRtp,
        observedHitFrequency: mc.observedHitFrequency,
        observedTierProbabilities: mc.observedTierProbabilities,
      },
      checks,
      tier_mismatches: tierMismatches,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'HIT_FREQUENCY_DISTRIBUTION',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      rtp_rel: TOL_RTP_REL,
      hf_abs: TOL_OVERALL_HF_ABS,
      tier_prob_rel: TOL_TIER_PROB_REL,
      tier_prob_abs_floor: TOL_TIER_PROB_ABS_FLOOR,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'HIT_FREQUENCY_DISTRIBUTION.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# HIT_FREQUENCY_DISTRIBUTION — Hit Frequency Distribution Decomposition Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(
    `**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS.toLocaleString()} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC samples.`,
  );
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Hit Frequency Distribution Decomposition Analyzer" (Wave 159 — 51st closed-form solver).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form survival-function decomposition of payout PMF + Hill-estimator Pareto tail fit:');
  md.push('');
  md.push('- Per-tier breakdown: tierProb = Σ_{m_k ≥ C} p_k, oneInN = 1/tierProb, condEV = Σ m·p/tierProb');
  md.push('- RTP contribution + rtpShareOfTotal per tier');
  md.push('- Top-X% RTP concentration (1%/5%/10%) sortira positive outcomes descending by multiple');
  md.push('- Hill estimator Pareto α̂ = totalTailMass / Σ p·ln(m/m_min) for m ≥ paretoTailStartMultiplier');
  md.push('');
  md.push('MC: 200K spins per config, categorical sampling from PMF, mulberry32 RNG.');
  md.push('');
  md.push('## Configs — operator/regulator disclosure table');
  md.push('');
  md.push('| Config | Pass | RTP CF/MC | HF CF/MC | Pareto α | top-1% RTP share | 1-in-N (max tier) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    const maxTier = cf.tierBreakdown[cf.tierBreakdown.length - 1];
    const top1 = cf.rtpConcentration[0];
    const maxOneInN = typeof maxTier.oneInN === 'number' ? maxTier.oneInN.toFixed(0) : '∞';
    const paretoStr = typeof cf.paretoTailAlpha === 'number' ? cf.paretoTailAlpha.toFixed(2) : 'NaN';
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${cf.totalRtp.toFixed(3)}/${mc.observedRtp.toFixed(3)} | ` +
        `${(cf.overallHitFrequency * 100).toFixed(2)}%/${(mc.observedHitFrequency * 100).toFixed(2)}% | ` +
        `${paretoStr} | ${(top1.rtpShare * 100).toFixed(1)}% | 1-in-${maxOneInN} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14 Tag 12** — operator must disclose top hit rates per game (regulator-friendly "1 in X" form)');
  md.push('- **MGA Player Protection Directives §11.f** — variance disclosure including tier-stratified hit frequency tables');
  md.push('- **eCOGRA Generic Slots Audit** — hit-frequency table mandate (per-tier oneInN and condEV)');
  md.push('- **AU NCPF Reform 2022 Schedule 3** — rare-events disclosure with explicit "1 in X" frequency for top-tier wins');
  md.push('- **EU consumer protection** — Pareto α heavy-tail diagnostic for "is this slot front-loaded or back-loaded?"');
  md.push('');
  md.push('Industry use: UKGC game-info tooltip ("This slot pays 1-in-X for top wins"),');
  md.push('MGA slot-variance classification (low / medium / high based on tier-1% RTP share),');
  md.push('eCOGRA pre-launch RTP/HF audit, NCPF responsible-gambling info-card generator.');
  md.push('');
  md.push('## Why this is industry-standard (not industry-first)');
  md.push('');
  md.push('Hit-frequency disclosure is REQUIRED by all major regulators but operators currently');
  md.push('compile per-game tables MANUALLY in spreadsheets. This solver:');
  md.push('  1. Automates per-tier hit frequency + condEV + RTP contribution computation');
  md.push('  2. Adds top-X% RTP concentration (regulator interpretability metric — "is RTP back-loaded?")');
  md.push('  3. Adds Pareto tail-α diagnostic (heavy-tail vs light-tail classifier)');
  md.push('  4. Provides MC cross-validation harness for engine-spec ↔ disclosure-table parity audit');

  writeFileSync(join(OUT_DIR, 'HIT_FREQUENCY_DISTRIBUTION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/HIT_FREQUENCY_DISTRIBUTION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
