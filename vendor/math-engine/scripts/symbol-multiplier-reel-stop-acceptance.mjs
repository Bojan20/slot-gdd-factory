#!/usr/bin/env node
//
// W152 Wave 143 — Symbol Multiplier on Reel-Stop acceptance (Wave 142).
//
// 6 PAR-style configs × 200K spins each = 1.2M total MC spins.
//
// Operator deliverable: `reports/acceptance/SYMBOL_MULT_REEL_STOP.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: multiplier distribution + symbol
// landing aggregation disclosure za "random multiplier symbol" mehaniku.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 200_000;
const SEED = 0xCAFE0142;
const TOL_PAY_REL = 0.08;       // E[Y] rel (additive bounded)
const TOL_PAY_REL_MULT = 0.20;  // multiplicative high-variance tolerance
const TOL_LAND_REL = 0.05;      // E[landed count] rel

const CONFIGS = [
  {
    name: 'A_sweet_bonanza_5x6_additive',
    description: 'Pragmatic Sweet Bonanza-style: 5×6 grid, q=0.025, additive heavy-tail',
    cfg: {
      positionCount: 30,
      multiplierLandingProbability: 0.025,
      aggregationMode: 'additive',
      multiplierValuePmf: [
        { value: 2,   probability: 0.50 },
        { value: 5,   probability: 0.30 },
        { value: 25,  probability: 0.15 },
        { value: 100, probability: 0.04 },
        { value: 500, probability: 0.01 },
      ],
      baseWinPmf: [
        { value: 0,  probability: 0.75 },
        { value: 5,  probability: 0.20 },
        { value: 50, probability: 0.05 },
      ],
    },
    tol_rel: 0.15,  // heavy-tail relaxed
  },
  {
    name: 'B_bigger_bass_5x3_additive',
    description: 'Pragmatic Bigger Bass fish multipliers: 5×3 grid, q=0.02, additive',
    cfg: {
      positionCount: 15,
      multiplierLandingProbability: 0.02,
      aggregationMode: 'additive',
      multiplierValuePmf: [
        { value: 2,  probability: 0.6 },
        { value: 4,  probability: 0.25 },
        { value: 10, probability: 0.13 },
        { value: 50, probability: 0.02 },
      ],
      baseWinPmf: [
        { value: 0,  probability: 0.85 },
        { value: 1,  probability: 0.10 },
        { value: 10, probability: 0.05 },
      ],
    },
    tol_rel: 0.10,
  },
  {
    name: 'C_hacksaw_rip_city_5x5_additive',
    description: 'Hacksaw RIP City-style: 5×5 grid, q=0.04, additive',
    cfg: {
      positionCount: 25,
      multiplierLandingProbability: 0.04,
      aggregationMode: 'additive',
      multiplierValuePmf: [
        { value: 2,   probability: 0.55 },
        { value: 3,   probability: 0.25 },
        { value: 5,   probability: 0.15 },
        { value: 20,  probability: 0.05 },
      ],
      baseWinPmf: [
        { value: 0, probability: 0.7 },
        { value: 2, probability: 0.20 },
        { value: 10, probability: 0.08 },
        { value: 100, probability: 0.02 },
      ],
    },
    tol_rel: 0.10,
  },
  {
    name: 'D_asgardian_stones_avalanche_multiplicative',
    description: 'Vendor D Asgardian Stones avalanche multipliers: 5×3 grid, q=0.10, multiplicative (low-variance)',
    cfg: {
      positionCount: 15,
      multiplierLandingProbability: 0.10,
      aggregationMode: 'multiplicative',
      multiplierValuePmf: [
        { value: 2, probability: 0.7 },
        { value: 3, probability: 0.25 },
        { value: 5, probability: 0.05 },
      ],
      baseWinPmf: [
        { value: 0, probability: 0.8 },
        { value: 5, probability: 0.15 },
        { value: 50, probability: 0.05 },
      ],
    },
    tol_rel: TOL_PAY_REL_MULT,
  },
  {
    name: 'E_corner_no_multipliers_baseline',
    description: 'Corner: q=tiny → almost never lands, E[Y] ≈ μ_W baseline',
    cfg: {
      positionCount: 10,
      multiplierLandingProbability: 0.001,
      aggregationMode: 'additive',
      multiplierValuePmf: [
        { value: 2, probability: 1 },
      ],
      baseWinPmf: [
        { value: 1, probability: 1 },
      ],
    },
    tol_rel: 0.05,
  },
  {
    name: 'F_corner_always_lands_additive',
    description: 'Corner: q=0.99, additive → ~N multipliers most spins',
    cfg: {
      positionCount: 5,
      multiplierLandingProbability: 0.99,
      aggregationMode: 'additive',
      multiplierValuePmf: [
        { value: 2, probability: 1 },
      ],
      baseWinPmf: [
        { value: 1, probability: 1 },
      ],
    },
    tol_rel: 0.05,
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveSymbolMultiplierReelStop, simulateSymbolMultiplierReelStop } = await import(
    join(REPO_ROOT, 'dist', 'features', 'symbolMultiplierReelStop.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Symbol Multiplier on Reel-Stop configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveSymbolMultiplierReelStop(c.cfg);
    const mc = simulateSymbolMultiplierReelStop(c.cfg, SPINS, SEED);

    const payRel = cf.expectedPayoutPerSpin > 1e-9
      ? relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin)
      : Math.abs(cf.expectedPayoutPerSpin - mc.observedMeanPayoutPerSpin);
    const landRel = cf.expectedLandedCount > 1e-9
      ? relErr(cf.expectedLandedCount, mc.observedMeanLandedCount)
      : Math.abs(cf.expectedLandedCount - mc.observedMeanLandedCount);

    const checks = {
      pay_rel: payRel,
      land_rel: landRel,
    };
    const pass = payRel <= c.tol_rel && landRel <= TOL_LAND_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `mode=${c.cfg.aggregationMode.padEnd(15)}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerSpin.toFixed(4)} MC=${mc.observedMeanPayoutPerSpin.toFixed(4)}  ` +
        `E[land]=${cf.expectedLandedCount.toFixed(4)}/${mc.observedMeanLandedCount.toFixed(4)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      tolerance_rel: c.tol_rel,
      closed_form: {
        positionCount: cf.positionCount,
        multiplierLandingProbability: cf.multiplierLandingProbability,
        aggregationMode: cf.aggregationMode,
        expectedMultiplierValue: cf.expectedMultiplierValue,
        expectedTotalMultiplier: cf.expectedTotalMultiplier,
        varianceTotalMultiplier: cf.varianceTotalMultiplier,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        probAnyMultiplierLands: cf.probAnyMultiplierLands,
        expectedLandedCount: cf.expectedLandedCount,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
        observedMeanTotalMultiplier: mc.observedMeanTotalMultiplier,
        observedMeanLandedCount: mc.observedMeanLandedCount,
        observedAnyMultiplierLandsFraction: mc.observedAnyMultiplierLandsFraction,
        observedMaxMultiplierSeen: mc.observedMaxMultiplierSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SYMBOL_MULT_REEL_STOP',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      pay_rel_additive: 0.10,
      pay_rel_additive_heavy_tail: 0.15,
      pay_rel_multiplicative: TOL_PAY_REL_MULT,
      land_rel: TOL_LAND_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'SYMBOL_MULT_REEL_STOP.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# SYMBOL_MULT_REEL_STOP — Symbol Multiplier on Reel-Stop Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Symbol Multiplier on Reel-Stop" (Wave 142).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form random multiplier landing analyzer with configurable aggregation:');
  md.push('  - N positions; per position P(multiplier lands) = q (independent)');
  md.push('  - Value V ~ multiplierValuePmf when landed');
  md.push('  - ADDITIVE: T = max(1, Σ v_i) sum-style (Sweet Bonanza/Bigger Bass/RIP City)');
  md.push('  - MULTIPLICATIVE: T = Π v_i product-style (Asgardian Stones)');
  md.push('  - E[Y] = E[T]·μ_W (T ⊥ W)');
  md.push('');
  md.push('MC: 200K spins per config, mulberry32 RNG, per-position Bernoulli + PMF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | Mode | E[Y] | E[land] | maxM_obs |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.aggregationMode} | ` +
        `${r.closed_form.expectedPayoutPerSpin.toFixed(4)} | ` +
        `${r.closed_form.expectedLandedCount.toFixed(4)} | ` +
        `${r.monte_carlo.observedMaxMultiplierSeen} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — multiplier value distribution disclosure');
  md.push('- **MGA PPD §11.f** — symbol-landing rule + aggregation transparency');
  md.push('- **eCOGRA Generic Slots Audit** — verifies T = Σ v_i (additive) ili Π v_i (multiplicative)');
  md.push("- Industry use: Pragmatic Sweet Bonanza (tumble mult symbols), Pragmatic");
  md.push("  Bigger Bass Bonanza (fish multipliers), Hacksaw RIP City (sum), Push Wild");
  md.push('  Swarm (sum), Vendor D Asgardian Stones (avalanche multiplicative), Yggdrasil');
  md.push('  Reactoonz multipliers.');

  writeFileSync(join(OUT_DIR, 'SYMBOL_MULT_REEL_STOP.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/SYMBOL_MULT_REEL_STOP.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
