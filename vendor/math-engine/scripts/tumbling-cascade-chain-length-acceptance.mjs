#!/usr/bin/env node
//
// W152 Wave 172 — Tumbling Cascade Chain Length Analyzer acceptance (Wave 171).
//
// 6 industry tumbling-slot configs × 10K MC spins each = 60K total spin sims.
// Wald identity closed-form cross-validated against per-cascade MC.
//
// Operator deliverable: `reports/acceptance/TUMBLING_CASCADE_CHAIN_LENGTH.{json,md}`.
//
// Compliance: UKGC RTS 14 (cascade chain disclosure), MGA PPD §11 (tumbling
// mechanic transparency), eCOGRA cascade audit.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 10_000;
const SEED = 0xCAFE0171;

const TOL_CHAIN_REL = 0.05;       // E[C] rel ≤ 5%
const TOL_TOTAL_REL = 0.10;       // E[total] rel ≤ 10%
const TOL_SURVIVAL_ABS = 0.02;    // P(C≥3) abs ≤ 2pp

const CONFIGS = [
  {
    name: 'A_sweet_bonanza_p030',
    description: 'Pragmatic Sweet Bonanza-class p=0.30 (medium-vol tumble), E[Y]=2, Var[Y]=10',
    cfg: { probCascadeWin: 0.30, expectedPayoutPerCascade: 2, variancePayoutPerCascade: 10 },
  },
  {
    name: 'B_gonzo_quest_p020',
    description: 'Vendor D Gonzos Quest-class p=0.20 (low-vol tumble, classic mechanic)',
    cfg: { probCascadeWin: 0.20, expectedPayoutPerCascade: 1.5, variancePayoutPerCascade: 5 },
  },
  {
    name: 'C_reactoonz_p050',
    description: 'Play\'n GO Reactoonz-class p=0.50 (high-vol tumble, long chains possible)',
    cfg: { probCascadeWin: 0.50, expectedPayoutPerCascade: 3, variancePayoutPerCascade: 25 },
  },
  {
    name: 'D_big_bass_tumble_p035',
    description: 'Pragmatic Big Bass Bonanza tumble FS p=0.35, medium chains',
    cfg: { probCascadeWin: 0.35, expectedPayoutPerCascade: 2.5, variancePayoutPerCascade: 15 },
  },
  {
    name: 'E_hacksaw_tombstone_p040_high_vol',
    description: 'Hacksaw Tombstone tumble p=0.40 high-vol skull cascade',
    cfg: { probCascadeWin: 0.40, expectedPayoutPerCascade: 5, variancePayoutPerCascade: 50 },
  },
  {
    name: 'F_corner_low_p005_rare_chain',
    description: 'Corner low-p=0.05 rare chains (E[C]≈0.053, P(C≥3) very small)',
    cfg: { probCascadeWin: 0.05, expectedPayoutPerCascade: 1, variancePayoutPerCascade: 2 },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveTumblingCascadeChainLength, simulateTumblingCascadeChainLength } =
    await import(join(REPO_ROOT, 'dist', 'features', 'tumblingCascadeChainLength.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Tumbling Cascade configs @ ${SPINS} MC spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveTumblingCascadeChainLength(c.cfg);
    const mc = simulateTumblingCascadeChainLength(c.cfg, SPINS, SEED);

    const chainRel = relErr(cf.expectedChainLength, mc.observedExpectedChainLength);
    const totalRel = relErr(cf.expectedTotalPayoutPerSpin, mc.observedExpectedTotalPayoutPerSpin);
    // Survival check at threshold 3 (always present in default thresholds)
    const cfTier3 = cf.chainSurvivalProbabilities.find((x) => x.threshold === 3)?.survivalProb ?? 0;
    const mcTier3 = mc.observedChainSurvivalProbabilities.find((x) => x.threshold === 3)?.observedSurvivalProb ?? 0;
    const survivalAbs = Math.abs(cfTier3 - mcTier3);

    const checks = { chain_rel: chainRel, total_rel: totalRel, survival_abs: survivalAbs };
    const pass =
      chainRel <= TOL_CHAIN_REL &&
      totalRel <= TOL_TOTAL_REL &&
      survivalAbs <= TOL_SURVIVAL_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `p=${c.cfg.probCascadeWin.toFixed(2)} E[Y]=${c.cfg.expectedPayoutPerCascade} Var[Y]=${c.cfg.variancePayoutPerCascade}  ` +
        `E[C]=${cf.expectedChainLength.toFixed(3)}/${mc.observedExpectedChainLength.toFixed(3)}  ` +
        `E[total]=${cf.expectedTotalPayoutPerSpin.toFixed(3)}/${mc.observedExpectedTotalPayoutPerSpin.toFixed(3)}  ` +
        `P(C≥3)=${(cfTier3*100).toFixed(2)}%/${(mcTier3*100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedChainLength: cf.expectedChainLength,
        varianceChainLength: cf.varianceChainLength,
        stdDevChainLength: cf.stdDevChainLength,
        chainSurvivalProbabilities: cf.chainSurvivalProbabilities,
        expectedTotalPayoutPerSpin: cf.expectedTotalPayoutPerSpin,
        varianceTotalPayoutPerSpin: cf.varianceTotalPayoutPerSpin,
        stdDevTotalPayoutPerSpin: cf.stdDevTotalPayoutPerSpin,
        probAtLeastOneWinPerSpin: cf.probAtLeastOneWinPerSpin,
        oneInNSpinsAnyWin: cf.oneInNSpinsAnyWin,
      },
      monte_carlo: {
        spins: SPINS,
        observedExpectedChainLength: mc.observedExpectedChainLength,
        observedExpectedTotalPayoutPerSpin: mc.observedExpectedTotalPayoutPerSpin,
        observedStdDevTotalPayoutPerSpin: mc.observedStdDevTotalPayoutPerSpin,
        observedChainSurvivalProbabilities: mc.observedChainSurvivalProbabilities,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'TUMBLING_CASCADE_CHAIN_LENGTH',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: { chain_rel: TOL_CHAIN_REL, total_rel: TOL_TOTAL_REL, survival_abs: TOL_SURVIVAL_ABS },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'TUMBLING_CASCADE_CHAIN_LENGTH.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# TUMBLING_CASCADE_CHAIN_LENGTH — Tumbling Cascade Chain Length Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(1)}K total spin sims.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Tumbling Cascade Chain Length Analyzer" (Wave 171 — 57th solver, Wald identity).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Geometric chain length distribution + Wald identity:');
  md.push('  - **C ~ Geometric(p)**: P(C=k) = p^k·(1−p)');
  md.push('  - **E[C] = p/(1−p)**, Var[C] = p/(1−p)²');
  md.push('  - **P(C≥k) = p^k** survival');
  md.push('  - **Wald**: E[total] = E[C]·E[Y]');
  md.push('  - Var[total] = E[C]·Var[Y] + Var[C]·(E[Y])²');
  md.push('');
  md.push('MC: 10K spins per config, per-cascade Bernoulli(p) + Gaussian payout draws, mulberry32 RNG.');
  md.push('');
  md.push('## Configs — tumbling-mechanic operator disclosure table');
  md.push('');
  md.push('| Config | Pass | p | E[Y] | Var[Y] | E[C] CF/MC | E[total] CF/MC | P(C≥3) CF/MC |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    const cfT3 = cf.chainSurvivalProbabilities.find((x) => x.threshold === 3)?.survivalProb ?? 0;
    const mcT3 = mc.observedChainSurvivalProbabilities.find((x) => x.threshold === 3)?.observedSurvivalProb ?? 0;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.probCascadeWin} | ${r.cfg.expectedPayoutPerCascade} | ${r.cfg.variancePayoutPerCascade} | ${cf.expectedChainLength.toFixed(3)}/${mc.observedExpectedChainLength.toFixed(3)} | ${cf.expectedTotalPayoutPerSpin.toFixed(3)}/${mc.observedExpectedTotalPayoutPerSpin.toFixed(3)} | ${(cfT3*100).toFixed(2)}%/${(mcT3*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — cascade chain disclosure (operator must show typical chain length)');
  md.push('- **MGA PPD §11** — tumbling mechanic transparency');
  md.push('- **eCOGRA Generic Slots Audit** — cascade-mechanic auditor verification');
  md.push('');
  md.push('Industry use: Pragmatic Sweet Bonanza family, Vendor D Gonzo Quest, Reactoonz, Big Bass tumble FS,');
  md.push('Hacksaw Tombstone, Push Money Cart 4 cascade.');

  writeFileSync(join(OUT_DIR, 'TUMBLING_CASCADE_CHAIN_LENGTH.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/TUMBLING_CASCADE_CHAIN_LENGTH.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
