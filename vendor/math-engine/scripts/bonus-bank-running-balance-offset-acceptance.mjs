#!/usr/bin/env node
// W152 Wave 191 — Bonus Bank Running-Balance Offset acceptance (72. solver, Vendor B M10 P0).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SESSIONS = 30_000;
const SEED = 0xCAFE0191;

const TOL_PAYOUT_REL = 0.06;
const TOL_PERSPIN_REL = 0.05;
const TOL_BUCKET_ABS = 0.02;

// Two-bucket consistent overall variance.
function consistentOverallVar(c) {
  const muW = c.probSmallBucket * c.smallBucketMean + (1 - c.probSmallBucket) * c.highBucketMean;
  const eW2 =
    c.probSmallBucket * (c.smallBucketVariance + c.smallBucketMean ** 2) +
    (1 - c.probSmallBucket) * (c.highBucketVariance + c.highBucketMean ** 2);
  return Math.max(0, eW2 - muW * muW);
}
function withVar(core) { return { ...core, perSpinVariance: consistentOverallVar(core) }; }

const CONFIGS = [
  {
    name: "A_rainbow_riches_megaways_bank_all_wins",
    description: "Vendor B Barcrest Rainbow Riches Megaways (2020, defining title) — 'Bank All Wins' mode boosts entire FS pool by 1.25×.",
    cfg: withVar({
      numFreeSpins: 15, probSmallBucket: 0.65, smallBucketMean: 0.6, smallBucketVariance: 0.2,
      highBucketMean: 5.0, highBucketVariance: 8.0, bankAllMultiplier: 1.25, bankSmallMultiplier: 2.0,
    }),
  },
  {
    name: "B_rainbow_riches_bank_small_wins_high_freq",
    description: "Bank Small Wins variant — high small-bucket density (80%) sa aggressive small boost 3.0×.",
    cfg: withVar({
      numFreeSpins: 20, probSmallBucket: 0.80, smallBucketMean: 0.4, smallBucketVariance: 0.1,
      highBucketMean: 6.0, highBucketVariance: 12.0, bankAllMultiplier: 1.10, bankSmallMultiplier: 3.0,
    }),
  },
  {
    name: "C_barcrest_balanced_three_mode",
    description: "Barcrest balanced 3-mode FS sa moderate banking — all 3 modes within 15% RTP spread.",
    cfg: withVar({
      numFreeSpins: 12, probSmallBucket: 0.55, smallBucketMean: 0.8, smallBucketVariance: 0.3,
      highBucketMean: 3.5, highBucketVariance: 5.0, bankAllMultiplier: 1.15, bankSmallMultiplier: 2.0,
    }),
  },
  {
    name: "D_long_fs_low_freq_small_bucket",
    description: "Long FS (30 spinova) + low small-bucket freq (35%) + high m_B = 1.50.",
    cfg: withVar({
      numFreeSpins: 30, probSmallBucket: 0.35, smallBucketMean: 1.0, smallBucketVariance: 0.4,
      highBucketMean: 8.0, highBucketVariance: 18.0, bankAllMultiplier: 1.50, bankSmallMultiplier: 2.5,
    }),
  },
  {
    name: "E_corner_p_low_1_all_small_bucket",
    description: "Corner: p_low=1.0 (svi spinovi small) — Mode C = m_S · Mode A.",
    cfg: withVar({
      numFreeSpins: 10, probSmallBucket: 1.0, smallBucketMean: 1.5, smallBucketVariance: 0.5,
      highBucketMean: 5.0, highBucketVariance: 8.0, bankAllMultiplier: 1.2, bankSmallMultiplier: 2.5,
    }),
  },
  {
    name: "F_corner_p_low_0_all_high_bucket",
    description: "Corner: p_low=0 (sve high) — Mode C = Mode A (no small-bucket boost engaged).",
    cfg: withVar({
      numFreeSpins: 10, probSmallBucket: 0.0, smallBucketMean: 0.5, smallBucketVariance: 0.1,
      highBucketMean: 4.0, highBucketVariance: 6.0, bankAllMultiplier: 1.3, bankSmallMultiplier: 5.0,
    }),
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeBonusBankRunningBalanceOffset, simulateBonusBankRunningBalanceOffset } =
    await import(join(REPO_ROOT, 'dist', 'features', 'bonusBankRunningBalanceOffset.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bonus Bank configs @ ${SESSIONS} MC bonus-sessions each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeBonusBankRunningBalanceOffset(c.cfg);
    const mc = simulateBonusBankRunningBalanceOffset(c.cfg, SESSIONS, SEED);

    const payoutARel = relErr(cf.expectedPayoutModeA, mc.meanPayoutModeA);
    const payoutBRel = relErr(cf.expectedPayoutModeB, mc.meanPayoutModeB);
    const payoutCRel = relErr(cf.expectedPayoutModeC, mc.meanPayoutModeC);
    const perSpinRel = relErr(cf.perSpinMean, mc.observedPerSpinMean);
    const bucketAbs = Math.abs(c.cfg.probSmallBucket - mc.observedSmallBucketRate);

    const checks = {
      payout_A_rel: payoutARel, payout_B_rel: payoutBRel, payout_C_rel: payoutCRel,
      perspin_rel: perSpinRel, bucket_abs: bucketAbs,
    };
    const pass =
      payoutARel <= TOL_PAYOUT_REL &&
      payoutBRel <= TOL_PAYOUT_REL &&
      payoutCRel <= TOL_PAYOUT_REL &&
      perSpinRel <= TOL_PERSPIN_REL &&
      bucketAbs <= TOL_BUCKET_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    const bestModeName = ['A_off','B_all','C_small'][cf.bestModeIndex];
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.numFreeSpins} p_L=${c.cfg.probSmallBucket} m_B=${c.cfg.bankAllMultiplier} m_S=${c.cfg.bankSmallMultiplier}  ` +
        `E[T_A]=${cf.expectedPayoutModeA.toFixed(2)}/${mc.meanPayoutModeA.toFixed(2)}  ` +
        `E[T_B]=${cf.expectedPayoutModeB.toFixed(2)}/${mc.meanPayoutModeB.toFixed(2)}  ` +
        `E[T_C]=${cf.expectedPayoutModeC.toFixed(2)}/${mc.meanPayoutModeC.toFixed(2)}  ` +
        `best=${bestModeName} skill+=${cf.skillPremiumVsUniform.toFixed(2)}  uplift_B=${cf.commercialUpliftBVsBaselineA.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({ name: c.name, description: c.description, cfg: c.cfg, closed_form: cf, monte_carlo: { ...mc, sessions: SESSIONS }, checks, pass, elapsed_ms: elapsedMs });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'BONUS_BANK_RUNNING_BALANCE_OFFSET',
    generated_utc: new Date().toISOString(), sessions_per_config: SESSIONS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, perspin_rel: TOL_PERSPIN_REL, bucket_abs: TOL_BUCKET_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BONUS_BANK_RUNNING_BALANCE_OFFSET.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BONUS_BANK_RUNNING_BALANCE_OFFSET — Bonus Bank Running-Balance Offset Aggregator Acceptance (W191, 72. solver, Vendor B M10 P0 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${SESSIONS} MC bonus-sessions each.`);
  md.push('');
  md.push('Closes Vendor B M10 P0 GAP — Barcrest Rainbow Riches Megaways Bonus Bank + future banking-mode flagships.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-spin bucketed aggregation sa player-elected banking mode:');
  md.push('  - **Mode A "bank_off_wins"**: T_A = Σ W_k, E[T_A] = N·μ_W');
  md.push('  - **Mode B "bank_all_wins"**: T_B = m_B·Σ W_k, E[T_B] = m_B·N·μ_W');
  md.push('  - **Mode C "bank_small_wins"**: T_C = Σ Z_k where Z = W·(1+(m_S−1)·𝟙{W≤τ})');
  md.push('  - **E[Z]** = p·m_S·μ_low + (1−p)·μ_high');
  md.push('  - **Var[Z]** = E[Z²] − E[Z]², via per-bucket conditional moments');
  md.push('  - **bonusBankAdditiveOffsetB** = (m_B−1)·N·μ_W');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | N / p_L / m_B / m_S | E[T_A] CF/MC | E[T_B] CF/MC | E[T_C] CF/MC | best | skill+ | uplift_B× |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const bestModeName = ['A_off','B_all','C_small'][r.closed_form.bestModeIndex];
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numFreeSpins}/${r.cfg.probSmallBucket}/${r.cfg.bankAllMultiplier}/${r.cfg.bankSmallMultiplier} | ${r.closed_form.expectedPayoutModeA.toFixed(2)}/${r.monte_carlo.meanPayoutModeA.toFixed(2)} | ${r.closed_form.expectedPayoutModeB.toFixed(2)}/${r.monte_carlo.meanPayoutModeB.toFixed(2)} | ${r.closed_form.expectedPayoutModeC.toFixed(2)}/${r.monte_carlo.meanPayoutModeC.toFixed(2)} | ${bestModeName} | ${r.closed_form.skillPremiumVsUniform.toFixed(2)} | ${r.closed_form.commercialUpliftBVsBaselineA.toFixed(2)} |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-12 player-elected mode RTP / UKGC RTS-14 Bonus Bank transparency / MGA PPD §11 / eCOGRA / EU GA 2024.');
  md.push('');
  md.push("Industry: Vendor B Barcrest Rainbow Riches Megaways Bonus Bank + Barcrest banking-mode variants + future Vendor B flagship.");
  writeFileSync(join(OUT_DIR, 'BONUS_BANK_RUNNING_BALANCE_OFFSET.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
