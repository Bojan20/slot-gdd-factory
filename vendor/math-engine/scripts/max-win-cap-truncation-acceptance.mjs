#!/usr/bin/env node
//
// W152 Wave 149 — Max Win Cap Truncation Analyzer acceptance (Wave 148).
//
// 6 PAR-style configs × 200K spins each = 1.2M total MC spins.
//
// Operator deliverable: `reports/acceptance/MAX_WIN_CAP_TRUNCATION.{json,md}`.
//
// UKGC RTS 14 + UKGC §5.A.E + MGA PPD §11.f + AU NCRG compliance: max-win
// cap RTP loss + cap-hit frequency + overflow disclosure (B3-LCCP mandatory).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 200_000;
const SEED = 0xCAFE0148;
const TOL_CAPPED_REL = 0.05;        // E[Y_capped] rel
const TOL_CAP_HIT_ABS = 0.005;      // P(cap hit) abs (5pp for rare events)

const CONFIGS = [
  {
    name: 'A_pragmatic_5000x_sweet_bonanza_tail',
    description: 'Vendor E 5000x cap, Sweet Bonanza-like heavy tail',
    cfg: {
      payoutPmf: [
        { value: 0,    probability: 0.70 },
        { value: 1,    probability: 0.15 },
        { value: 5,    probability: 0.08 },
        { value: 20,   probability: 0.04 },
        { value: 100,  probability: 0.018 },
        { value: 500,  probability: 0.008 },
        { value: 2500, probability: 0.003 },
        { value: 5000, probability: 0.0008 },
        { value: 10000, probability: 0.0002 },
      ],
      maxWinCapX: 5000,
    },
  },
  {
    name: 'B_hacksaw_7500x_rare_extreme',
    description: 'Hacksaw Gaming 7500x cap, rare-extreme tail',
    cfg: {
      payoutPmf: [
        { value: 0,    probability: 0.80 },
        { value: 10,   probability: 0.10 },
        { value: 100,  probability: 0.07 },
        { value: 1000, probability: 0.025 },
        { value: 5000, probability: 0.0049 },
        { value: 7500, probability: 0.0001 },
      ],
      maxWinCapX: 7500,
    },
  },
  {
    name: 'C_nolimit_city_25000x_deep_tail',
    description: 'Nolimit City 25000x cap, deep tail (Mental, Tombstone RIP)',
    cfg: {
      payoutPmf: [
        { value: 0,     probability: 0.75 },
        { value: 50,    probability: 0.15 },
        { value: 1000,  probability: 0.07 },
        { value: 10000, probability: 0.028 },
        { value: 25000, probability: 0.002 },
      ],
      maxWinCapX: 25000,
    },
  },
  {
    name: 'D_netent_10000x_classic',
    description: 'Vendor D 10000x cap, classic distribution',
    cfg: {
      payoutPmf: [
        { value: 0,    probability: 0.78 },
        { value: 2,    probability: 0.12 },
        { value: 25,   probability: 0.06 },
        { value: 200,  probability: 0.025 },
        { value: 2000, probability: 0.012 },
        { value: 10000, probability: 0.002 },
        { value: 50000, probability: 0.001 },
      ],
      maxWinCapX: 10000,
    },
  },
  {
    name: 'E_corner_no_loss_cap_above_max',
    description: 'Corner: cap above max PMF value → zero RTP loss',
    cfg: {
      payoutPmf: [
        { value: 0,    probability: 0.9 },
        { value: 100,  probability: 0.08 },
        { value: 1000, probability: 0.02 },
      ],
      maxWinCapX: 100000,
    },
  },
  {
    name: 'F_corner_aggressive_low_cap_high_loss',
    description: 'Corner: aggressive low cap → catches many tail values',
    cfg: {
      payoutPmf: [
        { value: 0,    probability: 0.5 },
        { value: 100,  probability: 0.2 },
        { value: 1000, probability: 0.15 },
        { value: 5000, probability: 0.1 },
        { value: 50000, probability: 0.05 },
      ],
      maxWinCapX: 100,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMaxWinCapTruncation, simulateMaxWinCapTruncation } = await import(
    join(REPO_ROOT, 'dist', 'features', 'maxWinCapTruncation.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Max Win Cap Truncation configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMaxWinCapTruncation(c.cfg);
    const mc = simulateMaxWinCapTruncation(c.cfg, SPINS, SEED);

    const cappedRel = cf.expectedPayoutCapped > 1e-9
      ? relErr(cf.expectedPayoutCapped, mc.observedMeanPayoutCapped)
      : Math.abs(cf.expectedPayoutCapped - mc.observedMeanPayoutCapped);
    const capHitAbs = Math.abs(cf.probCapHit - mc.observedCapHitFraction);

    const checks = {
      capped_rel: cappedRel,
      cap_hit_abs: capHitAbs,
    };
    const pass = cappedRel <= TOL_CAPPED_REL && capHitAbs <= TOL_CAP_HIT_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(42)} ${pass ? '✅' : '❌'}  ` +
        `cap=${c.cfg.maxWinCapX.toString().padStart(6)}  ` +
        `E[Y]_uncap=${cf.expectedPayoutUncapped.toFixed(2)} E[Y]_cap=${cf.expectedPayoutCapped.toFixed(2)}  ` +
        `RTP_loss=${(cf.rtpLossRelative * 100).toFixed(2)}%  ` +
        `1in_N=${cf.oneInNCapHitFrequency === Infinity ? '∞' : cf.oneInNCapHitFrequency.toFixed(0)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        maxWinCapX: cf.maxWinCapX,
        expectedPayoutUncapped: cf.expectedPayoutUncapped,
        expectedPayoutCapped: cf.expectedPayoutCapped,
        variancePayoutCapped: cf.variancePayoutCapped,
        rtpLossAbsolute: cf.rtpLossAbsolute,
        rtpLossRelative: cf.rtpLossRelative,
        probCapHit: cf.probCapHit,
        oneInNCapHitFrequency: cf.oneInNCapHitFrequency,
        expectedConditionalOverflow: cf.expectedConditionalOverflow,
        capBucketRtpContributionFraction: cf.capBucketRtpContributionFraction,
      },
      monte_carlo: {
        spins: SPINS,
        observedMeanPayoutCapped: mc.observedMeanPayoutCapped,
        observedMeanPayoutUncapped: mc.observedMeanPayoutUncapped,
        observedCapHitFraction: mc.observedCapHitFraction,
        observedMaxPayoutUncappedSeen: mc.observedMaxPayoutUncappedSeen,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MAX_WIN_CAP_TRUNCATION',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      capped_rel: TOL_CAPPED_REL,
      cap_hit_abs: TOL_CAP_HIT_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MAX_WIN_CAP_TRUNCATION.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MAX_WIN_CAP_TRUNCATION — Max Win Cap Truncation Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e6).toFixed(2)}M total MC spins.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Max Win Cap Truncation Analyzer" (Wave 148).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form discrete payout PMF cap analyzer:');
  md.push('  - Y ~ payoutPmf, cap C → Y_capped = min(Y, C)');
  md.push('  - **E[Y_capped] = Σ_{y<C} y·π_y + C·P_cap**');
  md.push('  - **rtpLossRelative = (E[Y] − E[Y_capped]) / E[Y]**');
  md.push('  - **oneInNCapHitFrequency = 1 / P_cap** (regulator "1 in X")');
  md.push('  - **E[overflow | Y≥C] = (Σ_{y≥C}(y−C)·π_y) / P_cap**');
  md.push('');
  md.push('MC: 200K spins per config, mulberry32 RNG, discrete PMF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | Cap | E[Y_uncap] | E[Y_cap] | RTP_loss | 1-in-N |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.maxWinCapX} | ` +
        `${r.closed_form.expectedPayoutUncapped.toFixed(2)} | ` +
        `${r.closed_form.expectedPayoutCapped.toFixed(2)} | ` +
        `${(r.closed_form.rtpLossRelative * 100).toFixed(3)}% | ` +
        `${r.closed_form.oneInNCapHitFrequency === Infinity ? '∞' : r.closed_form.oneInNCapHitFrequency.toFixed(0)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — max-win disclosure mandatory (B3-LCCP)');
  md.push('- **UKGC §5.A.E** — operator must disclose cap impact to player');
  md.push('- **MGA PPD §11.f** — cap mechanic + RTP-loss transparency');
  md.push('- **AU NCRG** — post-2023 reform max-win disclosure');
  md.push('- **BE Belgian Gaming Commission** — max-win disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies cap matches engine');
  md.push('- Industry use: Vendor E 5000x (Sweet Bonanza family), Hacksaw');
  md.push('  Gaming 7500x, Nolimit City 25000x (Mental, Tombstone RIP), Vendor D');
  md.push('  10000x, Stake.com 5000x, Push Gaming 10000-15000x, Yggdrasil 7777x.');

  writeFileSync(join(OUT_DIR, 'MAX_WIN_CAP_TRUNCATION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MAX_WIN_CAP_TRUNCATION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
