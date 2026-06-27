#!/usr/bin/env node
//
// W152 Wave 151 — Voltage/XP Meter Multi-Tier Reward Levels acceptance (Wave 150).
//
// 6 PAR-style configs × 300K spins each = 1.8M total MC spins.
//
// Operator deliverable: `reports/acceptance/VOLTAGE_METER_MULTI_TIER.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: per-tier hit rate disclosure
// + reward mode (highest-only vs cumulative) transparency.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 300_000;
const SEED = 0xCAFE0150;
const TOL_REWARD_REL = 0.06;     // E[R] rel
const TOL_NO_TIER_ABS = 0.01;    // P(no tier) abs
const TOL_HIT_ABS = 0.005;       // per-tier hit abs

const CONFIGS = [
  {
    name: 'A_hacksaw_stack_em_3tier_cumulative',
    description: "Hacksaw Stack 'Em: 3-tier cumulative, p=0.55",
    cfg: {
      cascadeContinuationProbability: 0.55,
      tiers: [
        { threshold: 3,  rewardX: 5 },
        { threshold: 6,  rewardX: 20 },
        { threshold: 10, rewardX: 100 },
      ],
      rewardMode: 'cumulative',
    },
  },
  {
    name: 'B_push_wild_swarm_4tier_highest_only',
    description: 'Push Wild Swarm: 4-tier highest-only, p=0.5',
    cfg: {
      cascadeContinuationProbability: 0.5,
      tiers: [
        { threshold: 2,  rewardX: 10 },
        { threshold: 5,  rewardX: 50 },
        { threshold: 10, rewardX: 250 },
        { threshold: 15, rewardX: 1000 },
      ],
      rewardMode: 'highest-only',
    },
  },
  {
    name: 'C_netent_charged_5tier_deep_cumulative',
    description: 'Vendor D Charged 5-tier deep cumulative, p=0.6',
    cfg: {
      cascadeContinuationProbability: 0.6,
      tiers: [
        { threshold: 2,  rewardX: 1 },
        { threshold: 5,  rewardX: 5 },
        { threshold: 10, rewardX: 25 },
        { threshold: 15, rewardX: 100 },
        { threshold: 25, rewardX: 1000 },
      ],
      rewardMode: 'cumulative',
    },
  },
  {
    name: 'D_yggdrasil_vault_anubis_3tier_balanced',
    description: 'Yggdrasil Vault of Anubis 3-tier balanced highest-only, p=0.45',
    cfg: {
      cascadeContinuationProbability: 0.45,
      tiers: [
        { threshold: 4,  rewardX: 5 },
        { threshold: 8,  rewardX: 25 },
        { threshold: 12, rewardX: 150 },
      ],
      rewardMode: 'highest-only',
    },
  },
  {
    name: 'E_corner_single_tier_T1',
    description: 'Corner: single tier T=1, reward=20 (every win triggers)',
    cfg: {
      cascadeContinuationProbability: 0.4,
      tiers: [
        { threshold: 1, rewardX: 20 },
      ],
      rewardMode: 'highest-only',
    },
  },
  {
    name: 'F_corner_rare_extreme_high_threshold',
    description: 'Corner: very high threshold T=20 sa p=0.3 → tier almost never hit',
    cfg: {
      cascadeContinuationProbability: 0.3,
      tiers: [
        { threshold: 20, rewardX: 100000 },
      ],
      rewardMode: 'highest-only',
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveVoltageMeterMultiTier, simulateVoltageMeterMultiTier } = await import(
    join(REPO_ROOT, 'dist', 'features', 'voltageMeterMultiTier.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Voltage Meter Multi-Tier configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveVoltageMeterMultiTier(c.cfg);
    const mc = simulateVoltageMeterMultiTier(c.cfg, SPINS, SEED);

    // Use abs when CF E[R] is too small (rel becomes meaningless for rare events)
    const absDiff = Math.abs(cf.expectedRewardPerSpin - mc.observedMeanRewardPerSpin);
    const rewardRel = cf.expectedRewardPerSpin > 0.01
      ? relErr(cf.expectedRewardPerSpin, mc.observedMeanRewardPerSpin)
      : (absDiff < 0.001 ? 0 : absDiff); // abs check for near-zero cases
    const noTierAbs = Math.abs(cf.probNoTierReached - mc.observedNoTierReachedFraction);
    let maxHitAbs = 0;
    for (let k = 0; k < cf.tierCount; k++) {
      const a = Math.abs(cf.perTierHitProbability[k] - mc.observedPerTierHitFraction[k]);
      if (a > maxHitAbs) maxHitAbs = a;
    }

    const checks = {
      reward_rel: rewardRel,
      no_tier_abs: noTierAbs,
      max_hit_abs: maxHitAbs,
    };
    const pass =
      rewardRel <= TOL_REWARD_REL &&
      noTierAbs <= TOL_NO_TIER_ABS &&
      maxHitAbs <= TOL_HIT_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `K=${cf.tierCount} mode=${cf.rewardMode.padEnd(13)}  ` +
        `E[R]_CF=${cf.expectedRewardPerSpin.toFixed(4)} MC=${mc.observedMeanRewardPerSpin.toFixed(4)}  ` +
        `P(no_tier)=${(cf.probNoTierReached * 100).toFixed(2)}%/${(mc.observedNoTierReachedFraction * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        cascadeContinuationProbability: cf.cascadeContinuationProbability,
        rewardMode: cf.rewardMode,
        tierCount: cf.tierCount,
        perTierHitProbability: cf.perTierHitProbability,
        perTierExactHighestProbability: cf.perTierExactHighestProbability,
        probNoTierReached: cf.probNoTierReached,
        expectedRewardPerSpin: cf.expectedRewardPerSpin,
        varianceRewardPerSpin: cf.varianceRewardPerSpin,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanRewardPerSpin: mc.observedMeanRewardPerSpin,
        observedPerTierHitFraction: mc.observedPerTierHitFraction,
        observedPerTierExactHighestFraction: mc.observedPerTierExactHighestFraction,
        observedNoTierReachedFraction: mc.observedNoTierReachedFraction,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'VOLTAGE_METER_MULTI_TIER',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      reward_rel: TOL_REWARD_REL,
      no_tier_abs: TOL_NO_TIER_ABS,
      hit_abs: TOL_HIT_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'VOLTAGE_METER_MULTI_TIER.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# VOLTAGE_METER_MULTI_TIER — Voltage/XP Meter Multi-Tier Reward Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Voltage/XP Meter Multi-Tier Reward Levels" (Wave 150).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form K-tier voltage meter analyzer:');
  md.push('  - Per spin chain L ~ Geometric(1-p)');
  md.push('  - K tier thresholds T_1 < T_2 < ... < T_K');
  md.push('  - **P(L ≥ T_k) = p^{T_k}** strictly decreasing');
  md.push('  - **P(H = k) = p^{T_k} − p^{T_{k+1}}** difference of geometric tails');
  md.push('  - MODE 1 highest-only: E[R] = Σ_k R_k·(p^{T_k}−p^{T_{k+1}})');
  md.push('  - MODE 2 cumulative: E[R] = Σ_k R_k·p^{T_k} (direct sum)');
  md.push('');
  md.push('MC: 300K spins per config, mulberry32 RNG, per-spin chain sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | K | Mode | E[R] | P(no_tier) |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.tierCount} | ` +
        `${r.closed_form.rewardMode} | ` +
        `${r.closed_form.expectedRewardPerSpin.toFixed(4)} | ` +
        `${(r.closed_form.probNoTierReached * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — multi-tier reward frequency disclosure (per tier hit rate)');
  md.push('- **MGA PPD §11.f** — tier mechanic + reward mode transparency');
  md.push('- **eCOGRA Generic Slots Audit** — verifies per-tier hit rates match engine');
  md.push("- Industry use: Hacksaw Stack 'Em multi-tier boost levels, Push Wild Swarm");
  md.push('  power-up tiers, Vendor D Charged XP bar 3-tier reward, Yggdrasil Vault of');
  md.push('  Anubis multi-step charge, Inspired XP bar, Push Aztec Bonanza multi-tier.');

  writeFileSync(join(OUT_DIR, 'VOLTAGE_METER_MULTI_TIER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/VOLTAGE_METER_MULTI_TIER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
