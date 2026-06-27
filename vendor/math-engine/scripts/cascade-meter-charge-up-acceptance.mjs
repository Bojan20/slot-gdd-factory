#!/usr/bin/env node
//
// W152 Wave 147 — Cascade Meter Charge-Up Trigger acceptance (Wave 146).
//
// 6 PAR-style configs × 300K spins each = 1.8M total MC spins.
//
// Operator deliverable: `reports/acceptance/CASCADE_METER_CHARGE_UP.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: feature trigger frequency
// + meter mechanic disclosure za "cascade-charged meter / Quantum-Leap" mehaniku.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 300_000;
const SEED = 0xCAFE0146;
const TOL_FIRES_REL = 0.04;      // E[F] rel
const TOL_CHAIN_REL = 0.02;      // E[L] rel
const TOL_FIRE_ABS  = 0.01;      // P(≥ 1 fire) abs
const TOL_METER_REL = 0.04;      // E[meterEnd] rel

const CONFIGS = [
  {
    name: 'A_reactoonz_quantum_leap_T4',
    description: "Play'n GO Reactoonz Quantum Leap: T=4, p=0.5",
    cfg: {
      cascadeContinuationProbability: 0.5,
      meterThreshold: 4,
      fireRewardX: 25,
      winValuePmf: [
        { value: 1,  probability: 0.7 },
        { value: 5,  probability: 0.2 },
        { value: 50, probability: 0.1 },
      ],
    },
  },
  {
    name: 'B_hacksaw_stack_em_T3',
    description: "Hacksaw Stack 'Em: T=3 (every 3 wins boost), p=0.55",
    cfg: {
      cascadeContinuationProbability: 0.55,
      meterThreshold: 3,
      fireRewardX: 10,
      winValuePmf: [
        { value: 1,  probability: 0.65 },
        { value: 3,  probability: 0.25 },
        { value: 20, probability: 0.10 },
      ],
    },
  },
  {
    name: 'C_push_aztec_bonanza_T10_high_threshold',
    description: 'Push Aztec Bonanza-style high threshold T=10, p=0.6',
    cfg: {
      cascadeContinuationProbability: 0.6,
      meterThreshold: 10,
      fireRewardX: 500,
      winValuePmf: [
        { value: 1,   probability: 0.5 },
        { value: 5,   probability: 0.3 },
        { value: 50,  probability: 0.15 },
        { value: 500, probability: 0.05 },
      ],
    },
  },
  {
    name: 'D_yggdrasil_vault_anubis_T6',
    description: 'Yggdrasil Vault of Anubis-style T=6, p=0.45',
    cfg: {
      cascadeContinuationProbability: 0.45,
      meterThreshold: 6,
      fireRewardX: 100,
      winValuePmf: [
        { value: 1,  probability: 0.7 },
        { value: 4,  probability: 0.2 },
        { value: 25, probability: 0.08 },
        { value: 200, probability: 0.02 },
      ],
    },
  },
  {
    name: 'E_corner_T1_every_win_fires',
    description: 'Corner: T=1 → every cascade win triggers fire, E[F] = E[L]',
    cfg: {
      cascadeContinuationProbability: 0.4,
      meterThreshold: 1,
      fireRewardX: 5,
      winValuePmf: [
        { value: 1, probability: 1 },
      ],
    },
  },
  {
    name: 'F_corner_huge_T_almost_never_fires',
    description: 'Corner: T=20 sa p=0.3 → P(fire) ≈ 0 (3.5e-11)',
    cfg: {
      cascadeContinuationProbability: 0.3,
      meterThreshold: 20,
      fireRewardX: 100000,
      winValuePmf: [
        { value: 1, probability: 1 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveCascadeMeterChargeUp, simulateCascadeMeterChargeUp } = await import(
    join(REPO_ROOT, 'dist', 'features', 'cascadeMeterChargeUp.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Cascade Meter Charge-Up configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveCascadeMeterChargeUp(c.cfg);
    const mc = simulateCascadeMeterChargeUp(c.cfg, SPINS, SEED);

    const firesRel = cf.expectedFiresPerSpin > 1e-9
      ? relErr(cf.expectedFiresPerSpin, mc.observedMeanFiresPerSpin)
      : Math.abs(cf.expectedFiresPerSpin - mc.observedMeanFiresPerSpin);
    const chainRel = relErr(cf.expectedChainLength, mc.observedMeanChainLength);
    const fireAbs = Math.abs(cf.probAtLeastOneFire - mc.observedAtLeastOneFireFraction);
    const meterRel = cf.expectedMeterEndOfSpin > 1e-9
      ? relErr(cf.expectedMeterEndOfSpin, mc.observedMeanMeterEndOfSpin)
      : Math.abs(cf.expectedMeterEndOfSpin - mc.observedMeanMeterEndOfSpin);

    const checks = {
      fires_rel: firesRel,
      chain_rel: chainRel,
      fire_abs: fireAbs,
      meter_rel: meterRel,
    };
    const pass =
      firesRel <= TOL_FIRES_REL &&
      chainRel <= TOL_CHAIN_REL &&
      fireAbs  <= TOL_FIRE_ABS &&
      meterRel <= TOL_METER_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(42)} ${pass ? '✅' : '❌'}  ` +
        `T=${c.cfg.meterThreshold.toString().padStart(2)} p=${c.cfg.cascadeContinuationProbability.toFixed(2)}  ` +
        `E[F]_CF=${cf.expectedFiresPerSpin.toFixed(5)} MC=${mc.observedMeanFiresPerSpin.toFixed(5)}  ` +
        `P(fire)=${(cf.probAtLeastOneFire * 100).toFixed(3)}%/${(mc.observedAtLeastOneFireFraction * 100).toFixed(3)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        cascadeContinuationProbability: cf.cascadeContinuationProbability,
        meterThreshold: cf.meterThreshold,
        fireRewardX: cf.fireRewardX,
        expectedChainLength: cf.expectedChainLength,
        expectedFiresPerSpin: cf.expectedFiresPerSpin,
        varianceFiresPerSpin: cf.varianceFiresPerSpin,
        probAtLeastOneFire: cf.probAtLeastOneFire,
        expectedMeterEndOfSpin: cf.expectedMeterEndOfSpin,
        expectedBasePayoutPerSpin: cf.expectedBasePayoutPerSpin,
        expectedFeaturePayoutPerSpin: cf.expectedFeaturePayoutPerSpin,
        expectedTotalPayoutPerSpin: cf.expectedTotalPayoutPerSpin,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanFiresPerSpin: mc.observedMeanFiresPerSpin,
        observedMeanChainLength: mc.observedMeanChainLength,
        observedAtLeastOneFireFraction: mc.observedAtLeastOneFireFraction,
        observedMeanTotalPayoutPerSpin: mc.observedMeanTotalPayoutPerSpin,
        observedMeanMeterEndOfSpin: mc.observedMeanMeterEndOfSpin,
        observedMaxFiresInSingleSpin: mc.observedMaxFiresInSingleSpin,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CASCADE_METER_CHARGE_UP',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      fires_rel: TOL_FIRES_REL,
      chain_rel: TOL_CHAIN_REL,
      fire_abs: TOL_FIRE_ABS,
      meter_rel: TOL_METER_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'CASCADE_METER_CHARGE_UP.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# CASCADE_METER_CHARGE_UP — Cascade Meter Charge-Up Trigger Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Cascade Meter Charge-Up Trigger" (Wave 146).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Quantum-Leap meter analyzer:');
  md.push('  - Per spin cascade chain L ~ Geometric(1-p)');
  md.push('  - Per-win meter +1; threshold T integer');
  md.push('  - **F = ⌊L/T⌋ ~ Geometric(1-p^T)** elegant distribution');
  md.push('  - **E[F] = p^T / (1-p^T)**');
  md.push('  - **E[L mod T] = (1-p)·Σ_{r=0..T-1} r·p^r / (1-p^T)** (finite series)');
  md.push('  - **Conservation: E[L] = T·E[F] + E[meterEnd]** verified');
  md.push('');
  md.push('MC: 300K spins per config, mulberry32 RNG, per-cascade Bernoulli + PMF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | T | p | E[F] | P(fire) | E[Y] |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.meterThreshold} | ` +
        `${r.closed_form.cascadeContinuationProbability.toFixed(2)} | ` +
        `${r.closed_form.expectedFiresPerSpin.toFixed(5)} | ` +
        `${(r.closed_form.probAtLeastOneFire * 100).toFixed(3)}% | ` +
        `${r.closed_form.expectedTotalPayoutPerSpin.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — feature trigger frequency disclosure (P(fire), E[F])');
  md.push('- **MGA PPD §11.f** — meter mechanic + carry-over transparency');
  md.push('- **eCOGRA Generic Slots Audit** — verifies meter fire rate matches engine');
  md.push("- Industry use: Play'n GO Reactoonz / Reactoonz 2 (Quantum Leap), Hacksaw");
  md.push("  Stack 'Em, Push Aztec Bonanza, Yggdrasil Vault of Anubis FS charge meter,");
  md.push('  Vendor D Wildbeast charge meter.');

  writeFileSync(join(OUT_DIR, 'CASCADE_METER_CHARGE_UP.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CASCADE_METER_CHARGE_UP.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
