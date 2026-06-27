#!/usr/bin/env node
//
// W152 Wave 153 — Bonus Trigger Award Tier Stratification acceptance (Wave 152).
//
// 6 PAR-style configs × 300K spins each = 1.8M total MC spins.
//
// Operator deliverable: `reports/acceptance/BONUS_TRIGGER_AWARD_STRATIFICATION.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: bonus trigger frequency disclosure
// + per-tier award stratification (regulator-mandated for FS-based slots).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 300_000;
const SEED = 0xCAFE0152;
const TOL_TRIGGER_ABS = 0.01;        // P(trigger) abs (1pp; covers rare events)
const TOL_AWARD_REL = 0.10;          // E[FS/spin] rel (10% za rare-trigger configs)
const TOL_TIER_ABS = 0.05;           // per-tier abs (5pp for rare/sparse tiers)

const CONFIGS = [
  {
    name: 'A_pragmatic_sweet_bonanza_3_4_5',
    description: 'Pragmatic Sweet Bonanza family: 3/4/5 = 10/15/20 FS, q=0.13',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.13,
      minScattersForTrigger: 3,
      awardTiers: [
        { scatterCount: 3, freeSpinsAward: 10 },
        { scatterCount: 4, freeSpinsAward: 15 },
        { scatterCount: 5, freeSpinsAward: 20 },
      ],
    },
  },
  {
    name: 'B_netent_vikings_3_4_5_high_top',
    description: 'Vendor D Vikings 3/4/5 sa premium 5-scatter (21 FS), q=0.10',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.10,
      minScattersForTrigger: 3,
      awardTiers: [
        { scatterCount: 3, freeSpinsAward: 7 },
        { scatterCount: 4, freeSpinsAward: 11 },
        { scatterCount: 5, freeSpinsAward: 21 },
      ],
    },
  },
  {
    name: 'C_microgaming_mega_moolah_4_scatter_only',
    description: 'Vendor G Mega Moolah-style: 4-scatter trigger only, q=0.12',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.12,
      minScattersForTrigger: 4,
      awardTiers: [
        { scatterCount: 4, freeSpinsAward: 25 },
        { scatterCount: 5, freeSpinsAward: 50 },
      ],
    },
  },
  {
    name: 'D_btg_megaways_6reel_3_4_5_6',
    description: 'BTG Megaways 6-reel: 3/4/5/6 → 10/15/20/30 FS, q=0.10',
    cfg: {
      reelCount: 6,
      scatterProbabilityPerReel: 0.10,
      minScattersForTrigger: 3,
      awardTiers: [
        { scatterCount: 3, freeSpinsAward: 10 },
        { scatterCount: 4, freeSpinsAward: 15 },
        { scatterCount: 5, freeSpinsAward: 20 },
        { scatterCount: 6, freeSpinsAward: 30 },
      ],
    },
  },
  {
    name: 'E_corner_5_scatter_only_rare',
    description: 'Corner: only 5-scatter triggers (rarest), max FS=100',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.15,
      minScattersForTrigger: 5,
      awardTiers: [
        { scatterCount: 5, freeSpinsAward: 100 },
      ],
    },
  },
  {
    name: 'F_corner_1_scatter_almost_always_triggers',
    description: 'Corner: 1-scatter triggers (high-frequency low award)',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.20,
      minScattersForTrigger: 1,
      awardTiers: [
        { scatterCount: 1, freeSpinsAward: 1 },
        { scatterCount: 2, freeSpinsAward: 2 },
        { scatterCount: 3, freeSpinsAward: 5 },
        { scatterCount: 4, freeSpinsAward: 10 },
        { scatterCount: 5, freeSpinsAward: 30 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveBonusTriggerAwardStratification, simulateBonusTriggerAwardStratification } = await import(
    join(REPO_ROOT, 'dist', 'features', 'bonusTriggerAwardStratification.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bonus Trigger Award Stratification configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveBonusTriggerAwardStratification(c.cfg);
    const mc = simulateBonusTriggerAwardStratification(c.cfg, SPINS, SEED);

    const triggerAbs = Math.abs(cf.probTriggerPerSpin - mc.observedTriggerFraction);
    const awardRel = cf.expectedFreeSpinsAwardedPerSpin > 1e-9
      ? relErr(cf.expectedFreeSpinsAwardedPerSpin, mc.observedMeanFreeSpinsAwardedPerSpin)
      : Math.abs(cf.expectedFreeSpinsAwardedPerSpin - mc.observedMeanFreeSpinsAwardedPerSpin);
    let maxTierAbs = 0;
    for (let k = 0; k < cf.probTierBreakdownConditional.length; k++) {
      const a = Math.abs(cf.probTierBreakdownConditional[k] - mc.observedTierFractions[k]);
      if (a > maxTierAbs) maxTierAbs = a;
    }

    const checks = {
      trigger_abs: triggerAbs,
      award_rel: awardRel,
      max_tier_abs: maxTierAbs,
    };
    const pass =
      triggerAbs <= TOL_TRIGGER_ABS &&
      awardRel <= TOL_AWARD_REL &&
      maxTierAbs <= TOL_TIER_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(44)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.reelCount} q=${c.cfg.scatterProbabilityPerReel.toFixed(2)} S_min=${c.cfg.minScattersForTrigger}  ` +
        `P(trig)=${(cf.probTriggerPerSpin * 100).toFixed(3)}%/${(mc.observedTriggerFraction * 100).toFixed(3)}%  ` +
        `E[FS]=${cf.expectedFreeSpinsAwardedPerSpin.toFixed(4)} 1in${cf.oneInNTriggerFrequency.toFixed(0)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        reelCount: cf.reelCount,
        scatterProbabilityPerReel: cf.scatterProbabilityPerReel,
        minScattersForTrigger: cf.minScattersForTrigger,
        probTriggerPerSpin: cf.probTriggerPerSpin,
        oneInNTriggerFrequency: cf.oneInNTriggerFrequency,
        expectedAwardGivenTrigger: cf.expectedAwardGivenTrigger,
        varianceAwardGivenTrigger: cf.varianceAwardGivenTrigger,
        expectedFreeSpinsAwardedPerSpin: cf.expectedFreeSpinsAwardedPerSpin,
        probTierBreakdownConditional: cf.probTierBreakdownConditional,
        probMaxScatterTier: cf.probMaxScatterTier,
      },
      monte_carlo: {
        spins: SPINS,
        observedTriggerFraction: mc.observedTriggerFraction,
        observedMeanScattersPerSpin: mc.observedMeanScattersPerSpin,
        observedMeanAwardGivenTrigger: mc.observedMeanAwardGivenTrigger,
        observedMeanFreeSpinsAwardedPerSpin: mc.observedMeanFreeSpinsAwardedPerSpin,
        observedTierFractions: mc.observedTierFractions,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BONUS_TRIGGER_AWARD_STRATIFICATION',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      trigger_abs: TOL_TRIGGER_ABS,
      award_rel: TOL_AWARD_REL,
      tier_abs: TOL_TIER_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BONUS_TRIGGER_AWARD_STRATIFICATION.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BONUS_TRIGGER_AWARD_STRATIFICATION — Bonus Trigger Award Tier Stratification Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Bonus Trigger Award Tier Stratification" (Wave 152).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form scatter-Binomial analyzer:');
  md.push('  - S ~ Binomial(N, q) total scatter count per spin');
  md.push('  - **P(trigger) = Σ_{s≥S_min} C(N,s)·q^s·(1−q)^(N−s)**');
  md.push('  - **P(S=s | trigger) = P(S=s) / P(trigger)** — tier stratification');
  md.push('  - **E[K | trigger] = Σ_{s≥S_min} K(s)·P(S=s | trigger)**');
  md.push('  - **E[FS per spin] = P(trig)·E[K | trig] = Σ K(s)·P(S=s)**');
  md.push('  - **oneInNTriggerFrequency = 1 / P(trigger)** (regulator "1 in X")');
  md.push('');
  md.push('MC: 300K spins per config, mulberry32 RNG, per-spin Binomial sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | N | q | S_min | P(trig) | 1-in-N | E[FS/spin] |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.reelCount} | ` +
        `${r.closed_form.scatterProbabilityPerReel.toFixed(2)} | ` +
        `${r.closed_form.minScattersForTrigger} | ` +
        `${(r.closed_form.probTriggerPerSpin * 100).toFixed(3)}% | ` +
        `${r.closed_form.oneInNTriggerFrequency.toFixed(0)} | ` +
        `${r.closed_form.expectedFreeSpinsAwardedPerSpin.toFixed(4)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — bonus trigger frequency + award tier disclosure');
  md.push('- **MGA PPD §11.f** — scatter mechanic + award schedule transparency');
  md.push('- **eCOGRA Generic Slots Audit** — verifies per-tier trigger rate matches engine');
  md.push("- Industry use: Pragmatic Sweet Bonanza family (3/4/5 = 10/15/20 FS),");
  md.push('  Vendor D Vikings tier awards, Hacksaw RIP City, Vendor A Pattern-CL,');
  md.push('  Vendor G Mega Moolah (4-scatter only), BTG Megaways 6-reel.');

  writeFileSync(join(OUT_DIR, 'BONUS_TRIGGER_AWARD_STRATIFICATION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BONUS_TRIGGER_AWARD_STRATIFICATION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
