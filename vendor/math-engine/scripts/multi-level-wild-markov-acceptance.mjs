#!/usr/bin/env node
//
// W152 Wave 133 — Multi-Level Wild Tier Markov acceptance (Wave 132).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/MULTI_LEVEL_WILD_MARKOV.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: tier-upgrade rate + maxMult disclosure.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0132;
const TOL_PI_ABS  = 0.01;  // stationary distribution abs
const TOL_EM_REL  = 0.05;  // expected multiplier rel
const TOL_EY_REL  = 0.07;  // expected payout rel

const STD_PMF = [
  { value: 0, probability: 0.7 },
  { value: 1, probability: 0.2 },
  { value: 5, probability: 0.1 },
];

const CONFIGS = [
  {
    name: 'A_netent_vikings_2tier',
    description: 'Vendor D Vikings Berzerk: 2-tier basic + super (no mega)',
    cfg: {
      landProbability: 0.05,
      upgradeProbabilityBasicToSuper: 0.15,
      upgradeProbabilitySuperToMega: 0,
      expireProbability: 0.20,
      basicMultiplier: 2,
      superMultiplier: 5,
      megaMultiplier: 5,
      baseWinPmf: STD_PMF,
    },
  },
  {
    name: 'B_push_mount_magmas_3tier_aggressive',
    description: 'Push Mount Magmas: 3-tier aggressive mega 100x',
    cfg: {
      landProbability: 0.03,
      upgradeProbabilityBasicToSuper: 0.20,
      upgradeProbabilitySuperToMega: 0.10,
      expireProbability: 0.30,
      basicMultiplier: 2,
      superMultiplier: 10,
      megaMultiplier: 100,
      baseWinPmf: STD_PMF,
    },
  },
  {
    name: 'C_pragmatic_da_vinci_high_freq',
    description: 'Pragmatic Da Vinci: high-freq low-tier wilds',
    cfg: {
      landProbability: 0.20,
      upgradeProbabilityBasicToSuper: 0.05,
      upgradeProbabilitySuperToMega: 0.02,
      expireProbability: 0.40,
      basicMultiplier: 2,
      superMultiplier: 3,
      megaMultiplier: 5,
      baseWinPmf: STD_PMF,
    },
  },
  {
    name: 'D_balanced_5_15_5_25',
    description: 'Balanced default sa 25x mega multiplier',
    cfg: {
      landProbability: 0.05,
      upgradeProbabilityBasicToSuper: 0.10,
      upgradeProbabilitySuperToMega: 0.05,
      expireProbability: 0.20,
      basicMultiplier: 2,
      superMultiplier: 5,
      megaMultiplier: 25,
      baseWinPmf: STD_PMF,
    },
  },
  {
    name: 'E_corner_no_upgrades',
    description: 'Corner: p_up1 = p_up2 = 0 → only basic wilds reachable',
    cfg: {
      landProbability: 0.10,
      upgradeProbabilityBasicToSuper: 0,
      upgradeProbabilitySuperToMega: 0,
      expireProbability: 0.30,
      basicMultiplier: 3,
      superMultiplier: 3,
      megaMultiplier: 3,
      baseWinPmf: STD_PMF,
    },
  },
  {
    name: 'F_high_persistence_low_expire',
    description: 'Long-lived wilds: low p_expire=0.05 → mega persists',
    cfg: {
      landProbability: 0.04,
      upgradeProbabilityBasicToSuper: 0.15,
      upgradeProbabilitySuperToMega: 0.10,
      expireProbability: 0.05,
      basicMultiplier: 2,
      superMultiplier: 8,
      megaMultiplier: 50,
      baseWinPmf: STD_PMF,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMultiLevelWildMarkov, simulateMultiLevelWildMarkov } = await import(
    join(REPO_ROOT, 'dist', 'features', 'multiLevelWildMarkov.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Multi-Level Wild Markov configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMultiLevelWildMarkov(c.cfg);
    const mc = simulateMultiLevelWildMarkov(c.cfg, SPINS, SEED);

    const piIdleAbs = Math.abs(cf.probIdle - mc.observedFractionIdle);
    const piBasicAbs = Math.abs(cf.probBasic - mc.observedFractionBasic);
    const piSuperAbs = Math.abs(cf.probSuper - mc.observedFractionSuper);
    const piMegaAbs = Math.abs(cf.probMega - mc.observedFractionMega);
    const maxPiAbs = Math.max(piIdleAbs, piBasicAbs, piSuperAbs, piMegaAbs);
    const emRel = relErr(cf.expectedMultiplierPerSpin, mc.observedMeanMultiplierPerSpin);
    const eyRel = cf.expectedPayoutPerSpin > 1e-9
      ? relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin)
      : Math.abs(cf.expectedPayoutPerSpin - mc.observedMeanPayoutPerSpin);

    const checks = {
      max_pi_abs: maxPiAbs,
      em_rel: emRel,
      ey_rel: eyRel,
    };
    const pass =
      maxPiAbs <= TOL_PI_ABS &&
      emRel <= TOL_EM_REL &&
      eyRel <= TOL_EY_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `E[M]_CF=${cf.expectedMultiplierPerSpin.toFixed(4)} MC=${mc.observedMeanMultiplierPerSpin.toFixed(4)}  ` +
        `π_mega=${(cf.probMega * 100).toFixed(3)}%/${(mc.observedFractionMega * 100).toFixed(3)}%  ` +
        `maxπAbs=${(maxPiAbs * 100).toFixed(2)}pp  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        probIdle: cf.probIdle,
        probBasic: cf.probBasic,
        probSuper: cf.probSuper,
        probMega: cf.probMega,
        probAnyActive: cf.probAnyActive,
        expectedMultiplierPerSpin: cf.expectedMultiplierPerSpin,
        varianceMultiplierPerSpin: cf.varianceMultiplierPerSpin,
        maxMultiplier: cf.maxMultiplier,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        conditionalProbBasicGivenActive: cf.conditionalProbBasicGivenActive,
        conditionalProbSuperGivenActive: cf.conditionalProbSuperGivenActive,
        conditionalProbMegaGivenActive: cf.conditionalProbMegaGivenActive,
      },
      monte_carlo: {
        spins: SPINS,
        observedFractionIdle: mc.observedFractionIdle,
        observedFractionBasic: mc.observedFractionBasic,
        observedFractionSuper: mc.observedFractionSuper,
        observedFractionMega: mc.observedFractionMega,
        observedMeanMultiplierPerSpin: mc.observedMeanMultiplierPerSpin,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MULTI_LEVEL_WILD_MARKOV',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: { pi_abs: TOL_PI_ABS, em_rel: TOL_EM_REL, ey_rel: TOL_EY_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MULTI_LEVEL_WILD_MARKOV.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MULTI_LEVEL_WILD_MARKOV — Multi-Level Wild Tier Markov Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Multi-Level Wild Tier Markov" (Wave 132).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form 4-state Markov stationary:');
  md.push('  - States: {idle, basic, super, mega}');
  md.push('  - **π_basic = π_idle · p_land / (p_up1 + p_exp)**');
  md.push('  - **π_super = π_basic · p_up1 / (p_up2 + p_exp)**');
  md.push('  - **π_mega = π_super · p_up2 / p_exp**');
  md.push('  - Normalize: π_idle · (1 + r_basic + r_super + r_mega) = 1');
  md.push('  - **E[M per spin] = π_idle·1 + π_basic·M_b + π_super·M_s + π_mega·M_m**');
  md.push('  - **E[Y] = E[V]·E[M]** (cross-independence)');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, state-walking sa transition Markov.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[M]_CF | π_mega | maxπAbs |');
  md.push('|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedMultiplierPerSpin.toFixed(4)} | ` +
        `${(r.closed_form.probMega * 100).toFixed(3)}% | ` +
        `${(r.checks.max_pi_abs * 100).toFixed(2)}pp |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — wild-tier variance + max-multiplier disclosure');
  md.push('- **MGA PPD §11.f** — tier-upgrade rate disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies stationary E[M], E[Y] match engine');
  md.push('- Industry use: Vendor D Vikings Berzerk (basic→super), Push Mount Magmas (3-tier),');
  md.push("  Pragmatic Da Vinci's Mystery, Quickspin Sakura Fortune.");

  writeFileSync(join(OUT_DIR, 'MULTI_LEVEL_WILD_MARKOV.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MULTI_LEVEL_WILD_MARKOV.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
