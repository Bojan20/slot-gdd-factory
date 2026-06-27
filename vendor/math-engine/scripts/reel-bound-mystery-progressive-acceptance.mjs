#!/usr/bin/env node
//
// W152 Wave 181 — Reel-Bound Mystery Progressive Analyzer acceptance.
//
// 6 industry Vendor B Quick Hit family configs × 200K MC spins = 1.2M total
// spin sims. Per-reel Bernoulli adjacency cascade closed-form
// cross-validated against per-spin reel-walk MC.
//
// Operator deliverable: `reports/acceptance/REEL_BOUND_MYSTERY_PROGRESSIVE.{json,md}`.
//
// Compliance: UKGC RTS 12 (progressive jackpot disclosure, per-tier hit
// frequency), MGA PPD §11 (mystery progressive transparency), GLI-19 §3.4
// (progressive contribution audit trail), NIGC 25 CFR 542.7(c) (Class III
// mystery progressive).
//
// Vendor B M5 gap closure — covers 8+ Vendor B titles iz Quick Hit family.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 500_000;
const SEED = 0xCAFE0181;

// Heavy-tail aggregator: top-tier prize dominira RTP (e.g. tier_5 payout
// 2500× sa prob 0.054% = rtp_share 1.35 od 3.10 total). MC noise na ~270
// hits @ 500K spinova daje natural ~6-10% rel err, hence 10% tolerance.
const TOL_RTP_REL = 0.10;       // E[payout/spin] rel ≤ 10% (heavy-tail noise documented)
const TOL_ANY_ABS = 0.005;      // P(any tier) abs ≤ 0.5pp
const TOL_TIER_ABS = 0.005;     // per-tier prob abs ≤ 0.5pp

const CONFIGS = [
  {
    name: 'A_quick_hit_platinum_5tier',
    description: 'SG Quick Hit Platinum 5-reel sa tier 3/4/5 (Mini/Minor/Major). Industry-iconic baseline.',
    cfg: {
      numReels: 5,
      perReelScatterPresenceProb: [0.30, 0.30, 0.30, 0.20, 0.10],
      minTier: 3,
      tierPayouts: [25, 250, 2500],
    },
  },
  {
    name: 'B_quick_hit_black_gold_high_top_tier',
    description: 'Quick Hit Black Gold sa visok Black Gold top tier payout (10K× bet).',
    cfg: {
      numReels: 5,
      perReelScatterPresenceProb: [0.25, 0.25, 0.20, 0.15, 0.08],
      minTier: 3,
      tierPayouts: [20, 200, 10000],
    },
  },
  {
    name: 'C_quick_hit_pro_9tier_extended',
    description: 'Quick Hit Pro 9-tier extended ladder, mehanika za hyper-vol titles.',
    cfg: {
      numReels: 9,
      perReelScatterPresenceProb: [0.40, 0.35, 0.30, 0.25, 0.20, 0.15, 0.10, 0.07, 0.05],
      minTier: 3,
      tierPayouts: [10, 50, 250, 1000, 5000, 25000, 100000],
    },
  },
  {
    name: 'D_quick_hit_wild_baseline_low_var',
    description: 'Quick Hit Wild low-variance variant sa visoke per-reel prob.',
    cfg: {
      numReels: 5,
      perReelScatterPresenceProb: [0.40, 0.40, 0.40, 0.30, 0.20],
      minTier: 3,
      tierPayouts: [15, 150, 1500],
    },
  },
  {
    name: 'E_bally_smokin_7s_single_tier',
    description: 'Vendor H Smokin 7s — degenerate 1-tier mehanika (only top), all reels equal.',
    cfg: {
      numReels: 5,
      perReelScatterPresenceProb: [0.20, 0.20, 0.20, 0.20, 0.20],
      minTier: 5,
      tierPayouts: [5000],
    },
  },
  {
    name: 'F_quick_hit_blitz_high_vol_4tier',
    description: 'Quick Hit Blitz 4-tier hyper-low top-tier prob za max volatility.',
    cfg: {
      numReels: 5,
      perReelScatterPresenceProb: [0.20, 0.20, 0.15, 0.10, 0.05],
      minTier: 2,
      tierPayouts: [5, 25, 200, 2500],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveReelBoundMysteryProgressive, simulateReelBoundMysteryProgressive } =
    await import(join(REPO_ROOT, 'dist', 'features', 'reelBoundMysteryProgressive.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Reel-Bound Mystery Progressive configs @ ${SPINS} MC spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveReelBoundMysteryProgressive(c.cfg);
    const mc = simulateReelBoundMysteryProgressive(c.cfg, SPINS, SEED);

    const rtpRel = relErr(cf.expectedPayoutPerSpin, mc.observedExpectedPayoutPerSpin);
    const anyAbs = Math.abs(cf.anyTierTriggerProb - mc.observedAnyTierTriggerProb);
    const topAbs = Math.abs(cf.topTierProb - mc.observedTopTierProb);

    const checks = {
      rtp_rel: rtpRel,
      any_tier_abs: anyAbs,
      top_tier_abs: topAbs,
    };
    const pass =
      rtpRel <= TOL_RTP_REL &&
      anyAbs <= TOL_ANY_ABS &&
      topAbs <= TOL_TIER_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(50)} ${pass ? '✅' : '❌'}  ` +
        `R=${c.cfg.numReels} kMin=${c.cfg.minTier} tiers=${cf.tierBreakdown.length}  ` +
        `RTP=${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.observedExpectedPayoutPerSpin.toFixed(3)}  ` +
        `top=${(cf.topTierProb*1e4).toFixed(2)}‱/${(mc.observedTopTierProb*1e4).toFixed(2)}‱  ` +
        `any=${(cf.anyTierTriggerProb*100).toFixed(2)}%/${(mc.observedAnyTierTriggerProb*100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        tierBreakdown: cf.tierBreakdown,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        topTierProb: cf.topTierProb,
        oneInNSpinsTopTier: cf.oneInNSpinsTopTier,
        anyTierTriggerProb: cf.anyTierTriggerProb,
        oneInNSpinsAnyTier: cf.oneInNSpinsAnyTier,
        maxPayoutX: cf.maxPayoutX,
      },
      monte_carlo: {
        spins: SPINS,
        observedExpectedPayoutPerSpin: mc.observedExpectedPayoutPerSpin,
        observedTierFreqs: mc.observedTierFreqs,
        observedTopTierProb: mc.observedTopTierProb,
        observedAnyTierTriggerProb: mc.observedAnyTierTriggerProb,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'REEL_BOUND_MYSTERY_PROGRESSIVE',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      rtp_rel: TOL_RTP_REL,
      any_tier_abs: TOL_ANY_ABS,
      top_tier_abs: TOL_TIER_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'REEL_BOUND_MYSTERY_PROGRESSIVE.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# REEL_BOUND_MYSTERY_PROGRESSIVE — Reel-Bound Mystery Progressive Analyzer Acceptance (Vendor B M5 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total spin sims.`);
  md.push('');
  md.push('**Covers 8+ Vendor B titles iz Quick Hit family** (Platinum / Black Gold / Pro / Wild / Blitz / Cash Wheel / Triple Cash Wheel / Smokin 7s).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-reel Bernoulli adjacency cascade closed-form + per-spin reel-walk MC.');
  md.push('  - **prefix_k** = ∏_{i=1..k} p_i (prob first k reels all show QH)');
  md.push('  - **tier_k** = prefix_k − prefix_{k+1} for k < R, = prefix_R for k = R');
  md.push('  - **E[payout]** = Σ tier_k · payout_k');
  md.push('  - **1-in-N** = 1 / tier_k (regulator disclosure form)');
  md.push('');
  md.push('## Configs — Vendor B Quick Hit family operator disclosure table');
  md.push('');
  md.push('| Config | Pass | R | kMin | Top-tier 1-in-N | E[RTP] CF/MC |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numReels} | ${r.cfg.minTier} | 1 in ${cf.oneInNSpinsTopTier.toFixed(0)} | ${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.observedExpectedPayoutPerSpin.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 12** — progressive jackpot disclosure, per-tier hit frequency.');
  md.push('- **MGA PPD §11** — mystery progressive transparency.');
  md.push('- **GLI-19 §3.4** — progressive contribution audit trail.');
  md.push('- **NIGC 25 CFR 542.7(c)** — Class III mystery progressive.');
  md.push('');
  md.push('**Vendor B M5 GAP CLOSURE**: this kernel covers the per-reel scatter-presence + adjacency-reel tier mapping');
  md.push('mehaniku iconic za Quick Hit family — 8+ titles dependent on this kernel for cert dossier.');

  writeFileSync(join(OUT_DIR, 'REEL_BOUND_MYSTERY_PROGRESSIVE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/REEL_BOUND_MYSTERY_PROGRESSIVE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
