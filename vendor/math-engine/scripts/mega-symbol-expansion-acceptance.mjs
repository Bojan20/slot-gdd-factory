#!/usr/bin/env node
//
// W152 Wave 124 — Mega Symbol Multi-Cell Expansion Aggregator acceptance (Wave 123).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/MEGA_SYMBOL_EXPANSION.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: variance + tail-coverage disclosure
// for super-symbol multi-cell area expansion mehanika.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0123;
const TOL_EY_REL          = 0.05;   // expected payout
const TOL_EY_REL_HEAVYTAIL = 0.20;  // heavy-tail (rare big jumbo + jackpot symbol)
const TOL_EK_REL          = 0.03;   // expected drop count
const TOL_ZERO_ABS        = 0.01;   // P(K=0) absolute

const CONFIGS = [
  {
    name: 'A_sweet_bonanza_super_symbols',
    description: 'Pragmatic Sweet Bonanza style: 1×1 + 2×2 + 3×3 + 4×4 super-symbols',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.50 },
        { count: 1, probability: 0.30 },
        { count: 2, probability: 0.15 },
        { count: 3, probability: 0.05 },
      ],
      sizePmf: [
        { size: 1, probability: 0.70 },
        { size: 2, probability: 0.20 },
        { size: 3, probability: 0.08 },
        { size: 4, probability: 0.02 },
      ],
      targetPmf: [
        { label: 'low',  payoutX: 5,   probability: 0.55 },
        { label: 'mid',  payoutX: 25,  probability: 0.30 },
        { label: 'high', payoutX: 100, probability: 0.15 },
      ],
    },
  },
  {
    name: 'B_razor_shark_jumbo_5x5_rare',
    description: 'Push Razor Shark jumbo: rare 5×5 giant, jackpot target',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.95 },
        { count: 1, probability: 0.05 },
      ],
      sizePmf: [
        { size: 1, probability: 0.70 },
        { size: 2, probability: 0.20 },
        { size: 3, probability: 0.07 },
        { size: 5, probability: 0.03 },
      ],
      targetPmf: [
        { label: 'wild',    payoutX: 10,   probability: 0.80 },
        { label: 'jackpot', payoutX: 1000, probability: 0.20 },
      ],
    },
  },
  {
    name: 'C_high_freq_small_supers',
    description: 'High-frequency 1×1 + 2×2, no big sizes',
    cfg: {
      countPmf: [
        { count: 1, probability: 0.40 },
        { count: 2, probability: 0.35 },
        { count: 3, probability: 0.20 },
        { count: 4, probability: 0.05 },
      ],
      sizePmf: [
        { size: 1, probability: 0.80 },
        { size: 2, probability: 0.20 },
      ],
      targetPmf: [
        { label: 'low_a', payoutX: 2, probability: 0.70 },
        { label: 'low_b', payoutX: 5, probability: 0.30 },
      ],
    },
  },
  {
    name: 'D_heavy_tail_jackpot_giant',
    description: 'Heavy-tail: rare 4×4 + Mega 5000x payout (super-rare)',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.85 },
        { count: 1, probability: 0.12 },
        { count: 2, probability: 0.03 },
      ],
      sizePmf: [
        { size: 1, probability: 0.85 },
        { size: 2, probability: 0.10 },
        { size: 4, probability: 0.05 },
      ],
      targetPmf: [
        { label: 'small', payoutX: 5,    probability: 0.85 },
        { label: 'med',   payoutX: 50,   probability: 0.10 },
        { label: 'mega',  payoutX: 5000, probability: 0.05 },
      ],
    },
  },
  {
    name: 'E_single_size_single_target_corner',
    description: 'Corner: fixed 2×2, single target (no variance from S or T)',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.5 },
        { count: 1, probability: 0.3 },
        { count: 2, probability: 0.2 },
      ],
      sizePmf: [
        { size: 2, probability: 1 },
      ],
      targetPmf: [
        { label: 'fixed', payoutX: 20, probability: 1 },
      ],
    },
  },
  {
    name: 'F_zero_drop_corner',
    description: 'Corner: K=0 always → E[Y]=0',
    cfg: {
      countPmf: [
        { count: 0, probability: 1 },
      ],
      sizePmf: [
        { size: 3, probability: 1 },
      ],
      targetPmf: [
        { label: 'unused', payoutX: 100, probability: 1 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMegaSymbolExpansion, simulateMegaSymbolExpansion } = await import(
    join(REPO_ROOT, 'dist', 'features', 'megaSymbolExpansion.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Mega Symbol Expansion configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMegaSymbolExpansion(c.cfg);
    const mc = simulateMegaSymbolExpansion(c.cfg, SPINS, SEED);

    const ekRel = cf.expectedDropCount > 1e-9
      ? relErr(cf.expectedDropCount, mc.observedMeanDropCount)
      : Math.abs(cf.expectedDropCount - mc.observedMeanDropCount);
    const eyRel = cf.expectedPayoutPerSpin > 1e-9
      ? relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin)
      : Math.abs(cf.expectedPayoutPerSpin - mc.observedMeanPayoutPerSpin);
    const zeroAbs = Math.abs(cf.probZeroDropCount - mc.observedZeroDropFraction);

    // Heavy-tail: max payoutX ≥ 1000 AND P(max target) ≤ 0.05 (rare jackpot)
    //           OR rare drop (E[K] ≤ 0.1) sa large area (maxArea ≥ 25) AND high payout (≥ 500)
    const isHeavyTail =
      (cf.maxSymbolPayout >= 1000 && cf.probHitMaxSymbol <= 0.05) ||
      (cf.expectedDropCount <= 0.1 && cf.maxArea >= 25 && cf.maxSymbolPayout >= 500);
    const eyTol = isHeavyTail ? TOL_EY_REL_HEAVYTAIL : TOL_EY_REL;

    const checks = {
      ek_rel: ekRel,
      ey_rel: eyRel,
      zero_abs: zeroAbs,
    };
    const pass =
      ekRel <= TOL_EK_REL &&
      eyRel <= eyTol &&
      zeroAbs <= TOL_ZERO_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `E[K]=${cf.expectedDropCount.toFixed(3)} MC=${mc.observedMeanDropCount.toFixed(3)}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerSpin.toFixed(3)} MC=${mc.observedMeanPayoutPerSpin.toFixed(3)}  ` +
        `(rel=${(eyRel * 100).toFixed(2)}%)  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedDropCount: cf.expectedDropCount,
        varianceDropCount: cf.varianceDropCount,
        probZeroDropCount: cf.probZeroDropCount,
        maxDropCount: cf.maxDropCount,
        expectedSize: cf.expectedSize,
        expectedSizeSquared: cf.expectedSizeSquared,
        expectedSizeFourth: cf.expectedSizeFourth,
        maxSize: cf.maxSize,
        maxArea: cf.maxArea,
        expectedPayoutPerCell: cf.expectedPayoutPerCell,
        maxSymbolPayout: cf.maxSymbolPayout,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        probMaxConfig: cf.probMaxConfig,
        maxPossibleCellsCovered: cf.maxPossibleCellsCovered,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanDropCount: mc.observedMeanDropCount,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
        observedVariancePayoutPerSpin: mc.observedVariancePayoutPerSpin,
        observedZeroDropFraction: mc.observedZeroDropFraction,
        observedMaxSizeSeen: mc.observedMaxSizeSeen,
        observedMaxPayoutSeen: mc.observedMaxPayoutSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MEGA_SYMBOL_EXPANSION',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      ek_rel: TOL_EK_REL,
      ey_rel: TOL_EY_REL,
      ey_rel_heavytail: TOL_EY_REL_HEAVYTAIL,
      zero_abs: TOL_ZERO_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MEGA_SYMBOL_EXPANSION.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MEGA_SYMBOL_EXPANSION — Multi-Cell Expansion Aggregator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Mega Symbol Multi-Cell Expansion Aggregator" (Wave 123).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Wald-style sa S² area coverage:');
  md.push('  - Y = Σ_{i=1..K} S_i² · paytable[T_i]');
  md.push('  - K ⊥ S ⊥ T cross-independence');
  md.push('  - **E[Y] = E[K] · E[S²] · E[paytable[T]]**');
  md.push('  - **E[Y²] = E[K]·E[S⁴]·E[paytable²] + (E[K²]−E[K])·(E[S²]·E[paytable])²**');
  md.push('  - **Var[Y] = E[Y²] − E[Y]²**');
  md.push('  - probMaxConfig = P(K=K_max)·(P(S=max)·P(T=max))^K_max joint extreme');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, per-drop K/S/T sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[K] | E[S²] | E[Y]_CF | E[Y]_MC | rel | maxArea |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedDropCount.toFixed(3)} | ` +
        `${r.closed_form.expectedSizeSquared.toFixed(3)} | ` +
        `${r.closed_form.expectedPayoutPerSpin.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutPerSpin.toFixed(3)} | ` +
        `${(r.checks.ey_rel * 100).toFixed(2)}% | ` +
        `${r.closed_form.maxArea} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance + tail-coverage disclosure (maxArea, probMaxConfig)');
  md.push('- **MGA PPD §11.f** — operator-facing super-symbol-rate disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies steady-state E[Y] / Var[Y]');
  md.push('- Industry use: Pragmatic Sweet Bonanza (super-symbols), Push Razor Shark (jumbo blocks),');
  md.push('  Vendor D Mega Joker, Slot Mountain Megaways, BTG Megaways multi-cell variants.');

  writeFileSync(join(OUT_DIR, 'MEGA_SYMBOL_EXPANSION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MEGA_SYMBOL_EXPANSION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
