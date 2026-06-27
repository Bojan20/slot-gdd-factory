#!/usr/bin/env node
//
// W152 Wave 126 — Bi-Directional Line Pay Aggregator acceptance (Wave 125).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/BIDIRECTIONAL_LINE_PAY.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: bi-directional pay-frequency
// + uplift disclosure for both-ways line evaluation mehanika.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0125;
const TOL_PAY_REL    = 0.05;   // expected pay relative
const TOL_HIT_ABS    = 0.01;   // hit frequency absolute
const TOL_UPLIFT_REL = 0.05;   // uplift ratio relative

const CONFIGS = [
  {
    name: 'A_microgaming_avalon_5reel_k3',
    description: 'Vendor G Avalon style: 5-reel both-ways, kMin=3, mid-density paytable',
    cfg: {
      reelCount: 5,
      minMatchLength: 3,
      symbols: [
        { label: 'low',  density: 0.20, paytable: [0, 0, 5,  20,  50] },
        { label: 'mid',  density: 0.15, paytable: [0, 0, 10, 50,  200] },
        { label: 'high', density: 0.10, paytable: [0, 0, 25, 100, 500] },
      ],
    },
  },
  {
    name: 'B_netent_lights_5reel_k2',
    description: 'Vendor D Lights style: 5-reel both-ways, kMin=2 (scatter-like)',
    cfg: {
      reelCount: 5,
      minMatchLength: 2,
      symbols: [
        { label: 'lights', density: 0.20, paytable: [0, 3, 10, 50, 200] },
      ],
    },
  },
  {
    name: 'C_4reel_both_ways',
    description: '4-reel game, both-ways, mid-density',
    cfg: {
      reelCount: 4,
      minMatchLength: 3,
      symbols: [
        { label: 'a', density: 0.25, paytable: [0, 0, 8, 40] },
        { label: 'b', density: 0.20, paytable: [0, 0, 12, 60] },
      ],
    },
  },
  {
    name: 'D_high_density_low_uplift',
    description: 'High-density symbol (q=0.5) → uplift drops jer N-match dominates',
    cfg: {
      reelCount: 5,
      minMatchLength: 3,
      symbols: [
        { label: 'hd', density: 0.50, paytable: [0, 0, 2, 10, 100] },
      ],
    },
  },
  {
    name: 'E_2reel_all_or_nothing',
    description: 'Edge: 2-reel game kMin=2 → all-or-nothing, P(L_2)=q^2',
    cfg: {
      reelCount: 2,
      minMatchLength: 2,
      symbols: [
        { label: 'two', density: 0.5, paytable: [0, 10] },
      ],
    },
  },
  {
    name: 'F_3reel_classic_slot',
    description: 'Classic 3-reel both-ways, kMin=3 → only full-match pays (P(L_3)=q^3)',
    cfg: {
      reelCount: 3,
      minMatchLength: 3,
      symbols: [
        { label: 'cherry',    density: 0.30, paytable: [0, 0, 5] },
        { label: 'bar',       density: 0.20, paytable: [0, 0, 20] },
        { label: 'seven',     density: 0.05, paytable: [0, 0, 500] },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveBiDirectionalLinePay, simulateBiDirectionalLinePay } = await import(
    join(REPO_ROOT, 'dist', 'features', 'biDirectionalLinePay.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bi-Directional Line Pay configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveBiDirectionalLinePay(c.cfg);
    const mc = simulateBiDirectionalLinePay(c.cfg, SPINS, SEED);

    const payRel = cf.totalExpectedPayBidirectional > 1e-9
      ? relErr(cf.totalExpectedPayBidirectional, mc.observedTotalPayBidirectional)
      : Math.abs(cf.totalExpectedPayBidirectional - mc.observedTotalPayBidirectional);
    const hitAbs = Math.abs(cf.totalHitFrequencyBidirectional - mc.observedHitsBidirectional);
    const mcUplift = mc.observedTotalPayLeft > 1e-9
      ? mc.observedTotalPayBidirectional / mc.observedTotalPayLeft
      : 1;
    const upliftRel = relErr(cf.bidirectionalUpliftRatio, mcUplift);

    const checks = {
      pay_rel: payRel,
      hit_abs: hitAbs,
      uplift_rel: upliftRel,
    };
    const pass =
      payRel <= TOL_PAY_REL &&
      hitAbs <= TOL_HIT_ABS &&
      upliftRel <= TOL_UPLIFT_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(36)} ${pass ? '✅' : '❌'}  ` +
        `E[pay_BD]_CF=${cf.totalExpectedPayBidirectional.toFixed(4)} MC=${mc.observedTotalPayBidirectional.toFixed(4)}  ` +
        `uplift=${cf.bidirectionalUpliftRatio.toFixed(3)}/${mcUplift.toFixed(3)}  ` +
        `(rel=${(payRel * 100).toFixed(2)}%)  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        reelCount: cf.reelCount,
        minMatchLength: cf.minMatchLength,
        totalExpectedPayLeft: cf.totalExpectedPayLeft,
        totalExpectedPayRight: cf.totalExpectedPayRight,
        totalExpectedPayBidirectional: cf.totalExpectedPayBidirectional,
        totalHitFrequencyLeft: cf.totalHitFrequencyLeft,
        totalHitFrequencyRight: cf.totalHitFrequencyRight,
        totalHitFrequencyBidirectional: cf.totalHitFrequencyBidirectional,
        varianceBidirectional: cf.varianceBidirectional,
        bidirectionalUpliftRatio: cf.bidirectionalUpliftRatio,
      },
      monte_carlo: {
        spins: SPINS,
        observedTotalPayLeft: mc.observedTotalPayLeft,
        observedTotalPayBidirectional: mc.observedTotalPayBidirectional,
        observedHitsLeft: mc.observedHitsLeft,
        observedHitsBidirectional: mc.observedHitsBidirectional,
        observedUpliftRatio: mcUplift,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BIDIRECTIONAL_LINE_PAY',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      pay_rel: TOL_PAY_REL,
      hit_abs: TOL_HIT_ABS,
      uplift_rel: TOL_UPLIFT_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BIDIRECTIONAL_LINE_PAY.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BIDIRECTIONAL_LINE_PAY — Bi-Directional Line Pay Aggregator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Bi-Directional Line Pay Aggregator" (Wave 125).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form bi-directional line evaluation:');
  md.push('  - N reels independent, per-symbol density q');
  md.push('  - **P(L_k) = q^k·(1−q)** za k<N, **P(L_N) = q^N**');
  md.push('  - P(R_k) symetrično (start from reel N)');
  md.push('  - **E[pay_BD] = E[L] + E[R] − paytable[N]·q^N** (deduct N-match overlap)');
  md.push('  - hit_freq_BD = hf_L + hf_R − P(L_N)');
  md.push('  - **bidirectionalUpliftRatio = E[pay_BD] / E[pay_L]** (operator disclosure)');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, per-reel Bernoulli + chain count.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | N | kMin | E[pay_BD] CF | MC | rel | Uplift |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.reelCount} | ` +
        `${r.closed_form.minMatchLength} | ` +
        `${r.closed_form.totalExpectedPayBidirectional.toFixed(4)} | ` +
        `${r.monte_carlo.observedTotalPayBidirectional.toFixed(4)} | ` +
        `${(r.checks.pay_rel * 100).toFixed(2)}% | ` +
        `${r.closed_form.bidirectionalUpliftRatio.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — pay-frequency disclosure both-directions');
  md.push('- **MGA PPD §11.f** — operator-facing line-evaluation rule');
  md.push('- **eCOGRA Generic Slots Audit** — verifies bi-directional pay match engine');
  md.push('- Industry use: Vendor G Avalon, Vendor D Lights / Witches Wheel, Vendor A Pattern-CL');
  md.push('  Bi-Way variants, Stakelogic Witchcraft Academy.');

  writeFileSync(join(OUT_DIR, 'BIDIRECTIONAL_LINE_PAY.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BIDIRECTIONAL_LINE_PAY.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
