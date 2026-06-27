#!/usr/bin/env node
//
// W152 Wave 139 — Tumble Multiplier with Cap acceptance (Wave 138).
//
// 6 PAR-style configs × 200K spins each = 1.2M total MC spins.
//
// Operator deliverable: `reports/acceptance/TUMBLE_MULTIPLIER_CAP.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: multiplier ceiling + cascade
// variance disclosure za "tumble/cascade multiplier ladder" mehaniku.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 200_000;
const SEED = 0xCAFE0138;
const TOL_PAYOUT_REL = 0.05;   // E[Y] rel
const TOL_CHAIN_REL  = 0.03;   // E[L] rel
const TOL_ZERO_ABS   = 0.01;   // P(L=0) abs

const CONFIGS = [
  {
    name: 'A_gonzos_quest_5x_cap',
    description: "Vendor D Gonzo's Quest style: 1×→2×→3×→4×→5× cap",
    cfg: {
      winContinuationProbability: 0.4,
      baseMultiplier: 1,
      multiplierStep: 1,
      maximumMultiplier: 5,
      winValuePmf: [
        { value: 1,  probability: 0.6 },
        { value: 5,  probability: 0.3 },
        { value: 25, probability: 0.1 },
      ],
    },
  },
  {
    name: 'B_btg_bonanza_fs_10x_cap',
    description: 'BTG Bonanza FS style: 1×..10× cap, sticky during FS',
    cfg: {
      winContinuationProbability: 0.45,
      baseMultiplier: 1,
      multiplierStep: 1,
      maximumMultiplier: 10,
      winValuePmf: [
        { value: 1,  probability: 0.55 },
        { value: 4,  probability: 0.3 },
        { value: 20, probability: 0.13 },
        { value: 100, probability: 0.02 },
      ],
    },
  },
  {
    name: 'C_sweet_bonanza_xmas_100x_cap',
    description: 'Pragmatic Sweet Bonanza Xmas: step=2, max=100, p=0.5',
    cfg: {
      winContinuationProbability: 0.5,
      baseMultiplier: 2,
      multiplierStep: 2,
      maximumMultiplier: 100,
      winValuePmf: [
        { value: 1,  probability: 0.5 },
        { value: 5,  probability: 0.35 },
        { value: 50, probability: 0.13 },
        { value: 500, probability: 0.02 },
      ],
    },
  },
  {
    name: 'D_money_cart_4_20x_cap',
    description: 'Push Money Cart 4: step=5, max=20, p=0.35 (rare-extreme)',
    cfg: {
      winContinuationProbability: 0.35,
      baseMultiplier: 1,
      multiplierStep: 5,
      maximumMultiplier: 20,
      winValuePmf: [
        { value: 1,  probability: 0.7 },
        { value: 10, probability: 0.25 },
        { value: 100, probability: 0.05 },
      ],
    },
  },
  {
    name: 'E_corner_no_cap_effect',
    description: 'Corner: M_max=1e6 (no practical cap, ramp dominates)',
    cfg: {
      winContinuationProbability: 0.3,
      baseMultiplier: 1,
      multiplierStep: 1,
      maximumMultiplier: 1_000_000,
      winValuePmf: [
        { value: 1, probability: 0.7 },
        { value: 5, probability: 0.3 },
      ],
    },
  },
  {
    name: 'F_corner_constant_multiplier',
    description: 'Corner: base=cap, step=0 → constant M (k*=1, tail only)',
    cfg: {
      winContinuationProbability: 0.4,
      baseMultiplier: 3,
      multiplierStep: 0,
      maximumMultiplier: 3,
      winValuePmf: [
        { value: 1,  probability: 0.6 },
        { value: 5,  probability: 0.3 },
        { value: 25, probability: 0.1 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveTumbleMultiplierWithCap, simulateTumbleMultiplierWithCap } = await import(
    join(REPO_ROOT, 'dist', 'features', 'tumbleMultiplierWithCap.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Tumble Multiplier with Cap configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveTumbleMultiplierWithCap(c.cfg);
    const mc = simulateTumbleMultiplierWithCap(c.cfg, SPINS, SEED);

    const payoutRel = relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin);
    const chainRel  = relErr(cf.expectedChainLength, mc.observedMeanChainLength);
    const zeroAbs   = Math.abs(cf.probZeroChain - mc.observedZeroChainFraction);
    const maxOk     = mc.observedMaxMultiplierSeen <= cf.maximumMultiplier + 1e-9;

    const checks = {
      payout_rel: payoutRel,
      chain_rel: chainRel,
      zero_abs: zeroAbs,
      max_mult_within_cap: maxOk,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      chainRel  <= TOL_CHAIN_REL &&
      zeroAbs   <= TOL_ZERO_ABS &&
      maxOk;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `k*=${cf.cascadesToCap}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerSpin.toFixed(4)} MC=${mc.observedMeanPayoutPerSpin.toFixed(4)}  ` +
        `E[L]=${cf.expectedChainLength.toFixed(4)}/${mc.observedMeanChainLength.toFixed(4)}  ` +
        `maxM=${mc.observedMaxMultiplierSeen}/${cf.maximumMultiplier}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        winContinuationProbability: cf.winContinuationProbability,
        baseMultiplier: cf.baseMultiplier,
        multiplierStep: cf.multiplierStep,
        maximumMultiplier: cf.maximumMultiplier,
        cascadesToCap: cf.cascadesToCap,
        expectedChainLength: cf.expectedChainLength,
        probZeroChain: cf.probZeroChain,
        expectedValuePerWin: cf.expectedValuePerWin,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        expectedRampPayoutContribution: cf.expectedRampPayoutContribution,
        expectedCappedTailContribution: cf.expectedCappedTailContribution,
        truncationProbabilityRemaining: cf.truncationProbabilityRemaining,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
        observedMeanChainLength: mc.observedMeanChainLength,
        observedZeroChainFraction: mc.observedZeroChainFraction,
        observedMaxMultiplierSeen: mc.observedMaxMultiplierSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'TUMBLE_MULTIPLIER_CAP',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      payout_rel: TOL_PAYOUT_REL,
      chain_rel: TOL_CHAIN_REL,
      zero_abs: TOL_ZERO_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'TUMBLE_MULTIPLIER_CAP.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# TUMBLE_MULTIPLIER_CAP — Tumble Multiplier with Cap Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Tumble Multiplier with Cap" (Wave 138).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form cascade multiplier ladder + explicit M_max cap analyzer:');
  md.push('  - Chain length L ~ Geometric(1−p): E[L]=p/(1−p)');
  md.push('  - Multiplier ladder sa cap: M_k = min(base + (k−1)·step, M_max)');
  md.push('  - **k\\* = ceil((M_max − base)/step) + 1** smallest k where ladder hits cap');
  md.push('  - **E[Y] = E[V] · (A + B)** decomposition:');
  md.push('    - A = Σ_{k=1..k\\*-1} M_k·p^k (ramp)');
  md.push('    - B = M_max · p^k\\* / (1−p) (saturated tail)');
  md.push('');
  md.push('MC: 200K spins per config, mulberry32 RNG, per-cascade Bernoulli + cap-bounded multiplier walk.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | k* | E[Y] | E[L] | maxM_obs | M_max |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.cascadesToCap} | ` +
        `${r.closed_form.expectedPayoutPerSpin.toFixed(4)} | ` +
        `${r.closed_form.expectedChainLength.toFixed(4)} | ` +
        `${r.monte_carlo.observedMaxMultiplierSeen} | ` +
        `${r.closed_form.maximumMultiplier} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — multiplier ceiling disclosure (max-win cap visibility)');
  md.push('- **MGA PPD §11.f** — operator-facing cascade multiplier variance');
  md.push('- **eCOGRA Generic Slots Audit** — verifies maxM never exceeds declared M_max');
  md.push("- Industry use: Vendor D Gonzo's Quest (5×), BTG Bonanza (10×), Pragmatic Sweet");
  md.push('  Bonanza Xmas (100×), Push Money Cart 4 (20×), Hacksaw Tombstone R.I.P,');
  md.push('  Yggdrasil Vault of Anubis (5×) — cascade-with-ceiling family.');

  writeFileSync(join(OUT_DIR, 'TUMBLE_MULTIPLIER_CAP.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/TUMBLE_MULTIPLIER_CAP.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
