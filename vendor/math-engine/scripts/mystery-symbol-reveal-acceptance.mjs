#!/usr/bin/env node
//
// W152 Wave 117 — Mystery Symbol Reveal Aggregator acceptance (Wave 116).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/MYSTERY_SYMBOL_REVEAL.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: reveal-rate + tail disclosure
// for pre-spin mystery → in-spin uniform reveal mechanic.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE9876;
const TOL_EY_REL          = 0.05;   // expected payout per spin (normal-vol)
const TOL_EY_REL_HEAVYTAIL = 0.20;  // heavy-tail jackpot configs (rare events)
const TOL_EK_REL          = 0.03;   // expected count
const TOL_ZERO_ABS        = 0.01;   // P(K=0) absolute

const CONFIGS = [
  {
    name: 'A_pragmatic_big_bass_classic',
    description: 'Pragmatic Big Bass Bonanza style: 0..10 fish + 6-tier payouts',
    cfg: {
      countPmf: [
        { count: 0,  probability: 0.40 },
        { count: 1,  probability: 0.25 },
        { count: 2,  probability: 0.15 },
        { count: 3,  probability: 0.10 },
        { count: 4,  probability: 0.05 },
        { count: 5,  probability: 0.03 },
        { count: 8,  probability: 0.015 },
        { count: 10, probability: 0.005 },
      ],
      symbolPmf: [
        { label: '2x',    payoutX: 2,    probability: 0.50 },
        { label: '5x',    payoutX: 5,    probability: 0.25 },
        { label: '10x',   payoutX: 10,   probability: 0.15 },
        { label: '25x',   payoutX: 25,   probability: 0.07 },
        { label: '100x',  payoutX: 100,  probability: 0.025 },
        { label: '2000x', payoutX: 2000, probability: 0.005 },
      ],
    },
  },
  {
    name: 'B_wolf_gold_3tier_jackpot',
    description: 'Wolf Gold style: 3-tier Mini/Major/Mega jackpot, 5-position max',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.7 },
        { count: 3, probability: 0.2 },
        { count: 5, probability: 0.1 },
      ],
      symbolPmf: [
        { label: 'mini',  payoutX: 50,   probability: 0.85 },
        { label: 'major', payoutX: 200,  probability: 0.12 },
        { label: 'mega',  payoutX: 1000, probability: 0.03 },
      ],
    },
  },
  {
    name: 'C_high_freq_low_value',
    description: 'High-frequency mystery (E[K]≈3), low-value paytable',
    cfg: {
      countPmf: [
        { count: 1, probability: 0.30 },
        { count: 2, probability: 0.30 },
        { count: 3, probability: 0.20 },
        { count: 4, probability: 0.15 },
        { count: 5, probability: 0.05 },
      ],
      symbolPmf: [
        { label: 'low_a', payoutX: 1, probability: 0.60 },
        { label: 'low_b', payoutX: 2, probability: 0.30 },
        { label: 'med',   payoutX: 5, probability: 0.10 },
      ],
    },
  },
  {
    name: 'D_rare_jackpot_heavy_tail',
    description: 'Rare jackpot heavy-tail: low-freq mystery + Mega payout (5000x)',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.90 },
        { count: 1, probability: 0.06 },
        { count: 5, probability: 0.03 },
        { count: 12, probability: 0.01 },
      ],
      symbolPmf: [
        { label: 'small', payoutX: 5,    probability: 0.85 },
        { label: 'med',   payoutX: 50,   probability: 0.12 },
        { label: 'big',   payoutX: 500,  probability: 0.025 },
        { label: 'mega',  payoutX: 5000, probability: 0.005 },
      ],
    },
  },
  {
    name: 'E_single_symbol_deterministic',
    description: 'Single symbol pmf (no symbol variance, only K varies)',
    cfg: {
      countPmf: [
        { count: 0, probability: 0.5 },
        { count: 2, probability: 0.3 },
        { count: 5, probability: 0.2 },
      ],
      symbolPmf: [
        { label: 'only', payoutX: 10, probability: 1 },
      ],
    },
  },
  {
    name: 'F_zero_count_corner',
    description: 'Corner: K=0 always → E[Y]=0',
    cfg: {
      countPmf: [
        { count: 0, probability: 1 },
      ],
      symbolPmf: [
        { label: 'unused_low', payoutX: 5,    probability: 0.95 },
        { label: 'unused_jp',  payoutX: 1000, probability: 0.05 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMysterySymbolReveal, simulateMysterySymbolReveal } = await import(
    join(REPO_ROOT, 'dist', 'features', 'mysterySymbolReveal.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Mystery Symbol Reveal configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMysterySymbolReveal(c.cfg);
    const mc = simulateMysterySymbolReveal(c.cfg, SPINS, SEED);

    const ekRel = cf.expectedCount > 1e-9
      ? relErr(cf.expectedCount, mc.observedMeanCount)
      : Math.abs(cf.expectedCount - mc.observedMeanCount);
    const eyRel = cf.expectedPayoutPerSpin > 1e-9
      ? relErr(cf.expectedPayoutPerSpin, mc.observedMeanPayoutPerSpin)
      : Math.abs(cf.expectedPayoutPerSpin - mc.observedMeanPayoutPerSpin);
    const zeroAbs = Math.abs(cf.probZeroCount - mc.observedZeroCountFraction);

    // Heavy-tail config detection: max symbol payoutX ≥ 1000 AND P(max) ≤ 0.01
    const isHeavyTail = cf.maxSymbolPayout >= 1000 && cf.probHitMaxSymbol <= 0.01;
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
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `E[K]=${cf.expectedCount.toFixed(3)} MC=${mc.observedMeanCount.toFixed(3)}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerSpin.toFixed(3)} MC=${mc.observedMeanPayoutPerSpin.toFixed(3)}  ` +
        `(rel=${(eyRel * 100).toFixed(2)}%)  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedCount: cf.expectedCount,
        varianceCount: cf.varianceCount,
        maxCount: cf.maxCount,
        probZeroCount: cf.probZeroCount,
        probMaxCount: cf.probMaxCount,
        expectedPayoutPerPosition: cf.expectedPayoutPerPosition,
        maxSymbolPayout: cf.maxSymbolPayout,
        probHitMaxSymbol: cf.probHitMaxSymbol,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        probFullGridMaxSymbol: cf.probFullGridMaxSymbol,
        conditionalExpectedPayoutBySymbol: cf.conditionalExpectedPayoutBySymbol,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanCount: mc.observedMeanCount,
        observedMeanPayoutPerSpin: mc.observedMeanPayoutPerSpin,
        observedVariancePayoutPerSpin: mc.observedVariancePayoutPerSpin,
        observedZeroCountFraction: mc.observedZeroCountFraction,
        observedMaxCountFraction: mc.observedMaxCountFraction,
        observedMaxPayoutSeen: mc.observedMaxPayoutSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MYSTERY_SYMBOL_REVEAL',
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
  writeFileSync(join(OUT_DIR, 'MYSTERY_SYMBOL_REVEAL.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MYSTERY_SYMBOL_REVEAL — Mystery Symbol Reveal Aggregator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Mystery Symbol Reveal Aggregator" (Wave 116).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Wald-style decomposition under K ⊥ S independence:');
  md.push('  - Y = K · paytable[S]');
  md.push('  - **E[Y] = E[K] · E[paytable[S]]**');
  md.push('  - **Var[Y] = E[K²]·E[paytable²] − E[K]²·E[paytable]²**');
  md.push('  - P(full grid + max symbol) = P(K=K_max) · P(S=max) joint');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, per-spin K/S sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[K] | E[Y]_CF | E[Y]_MC | rel | maxSym | P(jointMax) |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedCount.toFixed(3)} | ` +
        `${r.closed_form.expectedPayoutPerSpin.toFixed(3)} | ` +
        `${r.monte_carlo.observedMeanPayoutPerSpin.toFixed(3)} | ` +
        `${(r.checks.ey_rel * 100).toFixed(2)}% | ` +
        `${r.closed_form.maxSymbolPayout} | ` +
        `${(r.closed_form.probFullGridMaxSymbol * 1e6).toFixed(2)}ppm |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance + tail-probability disclosure (P(K=0), P(K=max), P(jointMax))');
  md.push('- **MGA PPD §11.f** — operator-facing reveal-rate disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies steady-state E[Y] / Var[Y]');
  md.push('- Industry use: Pragmatic Big Bass Bonanza family (Big Bass / Bigger Bass / Bass');
  md.push('  Boss), Wolf Gold (3-tier MMM jackpot), Vendor D Wild-O-Tron 3000, Yggdrasil Vault');
  md.push("  of Anubis, plus dozens of Pragmatic-licensed branded clones.");

  writeFileSync(join(OUT_DIR, 'MYSTERY_SYMBOL_REVEAL.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MYSTERY_SYMBOL_REVEAL.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
