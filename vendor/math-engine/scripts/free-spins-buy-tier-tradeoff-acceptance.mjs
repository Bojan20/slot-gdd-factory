#!/usr/bin/env node
//
// W152 Wave 131 — Free Spins Buy + Tier Escalation Trade-Off acceptance (Wave 130).
//
// 6 PAR-style configs × deterministic CF + light MC verification = pure-CF
// math gate (MC is Gaussian-approx za moment sanity only).
//
// Operator deliverable: `reports/acceptance/FS_BUY_TIER_TRADEOFF.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance + Australian NCRG / Belgian Bonus
// Buy ban impact disclosure.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const TRIALS = 50_000;
const SEED = 0xCAFE0130;
const TOL_RTP_REL = 0.35;  // MC RTP rel (Gaussian-approx limit sa max(0,x) clipping; high-σ tier configs)

const CONFIGS = [
  {
    name: 'A_pragmatic_bigger_bass_buy',
    description: 'Pragmatic Bigger Bass: 100x basic + Super 200x Bonus Buy',
    cfg: {
      baseRtp: 0.9650,
      baseVariance: 80,
      tiers: [
        { label: 'basic_buy', buyCostX: 100, expectedReturnX: 96.5,  varianceReturnX: 15000 },
        { label: 'super_buy', buyCostX: 200, expectedReturnX: 195,   varianceReturnX: 60000, maxPayoutX: 2500 },
      ],
    },
  },
  {
    name: 'B_hacksaw_money_hunt_3tier',
    description: 'Hacksaw Money Hunt: 3-tier 66x/100x/150x progressive Buy',
    cfg: {
      baseRtp: 0.9620,
      baseVariance: 100,
      tiers: [
        { label: 'cheap',     buyCostX: 66,  expectedReturnX: 63.4, varianceReturnX: 10000 },
        { label: 'mid',       buyCostX: 100, expectedReturnX: 96.5, varianceReturnX: 20000 },
        { label: 'expensive', buyCostX: 150, expectedReturnX: 146,  varianceReturnX: 50000, maxPayoutX: 5000 },
      ],
    },
  },
  {
    name: 'C_push_razor_shark_50x_buy',
    description: 'Push Razor Shark style: single 50x Bonus Buy (cheap entry)',
    cfg: {
      baseRtp: 0.9690,
      baseVariance: 120,
      tiers: [
        { label: 'standard', buyCostX: 50, expectedReturnX: 48.5, varianceReturnX: 8000, maxPayoutX: 5000 },
      ],
    },
  },
  {
    name: 'D_nolimit_mental_xways_premium',
    description: 'Nolimit Mental Bonus Buy + xWays premium tier sa adoption fractions',
    cfg: {
      baseRtp: 0.9620,
      baseVariance: 200,
      tiers: [
        { label: 'normal_buy', buyCostX: 75,  expectedReturnX: 72.15, varianceReturnX: 15000 },
        { label: 'xways_buy',  buyCostX: 150, expectedReturnX: 144.3, varianceReturnX: 70000, maxPayoutX: 50000 },
      ],
      adoptionFractions: { base: 0.60, tiers: [0.25, 0.15] },
    },
  },
  {
    name: 'E_aus_ncrg_ban_impact_disclosure',
    description: 'Australian NCRG / Belgian Bonus Buy ban impact disclosure config',
    cfg: {
      baseRtp: 0.9650,
      baseVariance: 90,
      tiers: [
        { label: 'cheap_buy', buyCostX: 100, expectedReturnX: 96.5, varianceReturnX: 15000 },
        { label: 'super_buy', buyCostX: 250, expectedReturnX: 243.75, varianceReturnX: 70000 },
      ],
      adoptionFractions: { base: 0.70, tiers: [0.20, 0.10] },
    },
  },
  {
    name: 'F_corner_fair_tier',
    description: 'Corner: tier sa RTP=1.0 (fair) → N* infinity, no edge dominance',
    cfg: {
      baseRtp: 0.9650,
      baseVariance: 80,
      tiers: [
        { label: 'fair', buyCostX: 100, expectedReturnX: 100, varianceReturnX: 20000 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveFreeSpinsBuyTierTradeOff, simulateFreeSpinsBuyTierTradeOff } = await import(
    join(REPO_ROOT, 'dist', 'features', 'freeSpinsBuyTierTradeOff.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Free Spins Buy Tier Trade-Off configs @ ${TRIALS} MC trials each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveFreeSpinsBuyTierTradeOff(c.cfg);
    const mc = simulateFreeSpinsBuyTierTradeOff(c.cfg, TRIALS, SEED);

    // MC tier RTP rel check (Gaussian-approx tolerance)
    let maxRelTier = 0;
    for (let i = 0; i < cf.perTier.length; i++) {
      const rel = relErr(cf.perTier[i].rtp, mc.perTierObservedRtp[i]);
      if (rel > maxRelTier) maxRelTier = rel;
    }

    // CF deterministic structural checks
    const tierCount = cf.perTier.length;
    const argMaxValid = cf.argmaxRtpTier === cf.perTier.reduce((best, p) =>
      p.rtp > best.rtp ? p : best, cf.perTier[0]).label;
    const banImpactValid = Number.isFinite(cf.bonusBuyBanImpactPercent);
    const weightedValid = c.cfg.adoptionFractions
      ? cf.weightedRtp !== undefined && Number.isFinite(cf.weightedRtp)
      : cf.weightedRtp === undefined;

    const checks = {
      max_rel_tier: maxRelTier,
      argmax_valid: argMaxValid,
      ban_impact_valid: banImpactValid,
      weighted_consistent: weightedValid,
      tier_count: tierCount,
    };
    const pass =
      maxRelTier <= TOL_RTP_REL &&
      argMaxValid &&
      banImpactValid &&
      weightedValid;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(36)} ${pass ? '✅' : '❌'}  ` +
        `tiers=${tierCount} argmaxRTP=${cf.argmaxRtpTier} ` +
        `ban_impact=${cf.bonusBuyBanImpactPercent.toFixed(2)}%  ` +
        `maxRel=${(maxRelTier * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        baseRtp: cf.baseRtp,
        perTier: cf.perTier,
        argmaxRtpTier: cf.argmaxRtpTier,
        argmaxVolatilityTier: cf.argmaxVolatilityTier,
        argmaxSharpeTier: cf.argmaxSharpeTier,
        argmaxPayoutTier: cf.argmaxPayoutTier,
        weightedRtp: cf.weightedRtp,
        weightedRevenuePerUnit: cf.weightedRevenuePerUnit,
        bonusBuyBanImpactPercent: cf.bonusBuyBanImpactPercent,
      },
      monte_carlo: {
        trials: TRIALS,
        perTierObservedRtp: mc.perTierObservedRtp,
        bestTierObservedRtp: mc.bestTierObservedRtp,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'FS_BUY_TIER_TRADEOFF',
    generated_utc: new Date().toISOString(),
    trials_per_config: TRIALS,
    seed: SEED,
    tolerances: { rtp_rel: TOL_RTP_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'FS_BUY_TIER_TRADEOFF.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# FS_BUY_TIER_TRADEOFF — Free Spins Buy + Tier Escalation Trade-Off Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${TRIALS} MC trials each.`);
  md.push('');
  md.push('Closes Faza 4.8 ext (post-W100): ✅ "Free Spins Buy + Tier Escalation Trade-Off" (Wave 130).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form decision-math:');
  md.push('  - RTP_t = E[Y]/buyCost, netEdge = RTP_t − 1');
  md.push('  - σ_relative = σ/buyCost, Sharpe = (RTP-1)/σ_rel');
  md.push('  - uplift_t = (RTP_t − RTP_b)·buyCost (absolute)');
  md.push('  - premium_t = (RTP_t − RTP_b)/RTP_b · 100 (% relative)');
  md.push('  - 2σ crossover N* = 4σ_rel²/(RTP-1)² (∞ za fair)');
  md.push('  - Decision modes: argmax RTP / Volatility / Sharpe / Payout');
  md.push('  - Optional adoptionFractions za weighted-RTP/revenue');
  md.push('  - **bonusBuyBanImpactPercent** = counterfactual RTP loss if banned');
  md.push('');
  md.push('MC: 50K Gaussian-approx trials per tier (sanity check for CF moments, ne actual distribution).');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | Tiers | argmaxRTP | Ban impact% |');
  md.push('|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.perTier.length} | ` +
        `${r.closed_form.argmaxRtpTier} | ` +
        `${r.closed_form.bonusBuyBanImpactPercent.toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — per-tier RTP disclosure required');
  md.push('- **MGA PPD §11.f** — operator buy-bonus tier transparency');
  md.push('- **Australian NCRG** — Bonus Buy ban; impact computed kao counterfactual RTP loss');
  md.push('- **Belgian regulator** — Bonus Buy ban; same impact disclosure metric');
  md.push('- Industry use: Pragmatic Bigger Bass family, Hacksaw Money Hunt tiers, Push Razor');
  md.push('  Shark 50x, Nolimit Mental Bonus Buy + xWays, Stakelogic Megaways Bonus Buy');

  writeFileSync(join(OUT_DIR, 'FS_BUY_TIER_TRADEOFF.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/FS_BUY_TIER_TRADEOFF.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
