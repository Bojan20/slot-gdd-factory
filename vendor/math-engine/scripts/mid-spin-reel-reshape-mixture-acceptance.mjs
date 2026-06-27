#!/usr/bin/env node
// W152 Wave 195 — Mid-Spin Reel-Reshape Mixture acceptance (76. solver, Vendor B M13 P1).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0195;

const TOL_PAYOUT_REL = 0.05;
const TOL_RESHAPE_ABS = 0.01;
const TOL_SET_PROB_ABS = 0.01;

const CONFIGS = [
  {
    name: "A_wizard_of_oz_ybr_glinda_3_set",
    description: "Vendor B WMS Wizard of Oz Follow the Yellow Brick Road (2017, defining title) — Glinda waves wand mid-spin, 3 reel-set mixture (base + Glinda bonus + Emerald jackpot).",
    cfg: {
      reelSets: [
        { label: 'base_oz',                selectionProbability: 0.88, meanPayout: 0.92, variancePayout: 20 },
        { label: 'glinda_bonus_reels',     selectionProbability: 0.08, meanPayout: 4.00, variancePayout: 120 },
        { label: 'glinda_emerald_jackpot', selectionProbability: 0.04, meanPayout: 12.0, variancePayout: 500 },
      ],
    },
  },
  {
    name: "B_wizard_of_oz_munchkinland_reshape_2_set",
    description: "Vendor B WMS Wizard of Oz Munchkinland reshape — 2-state base/Munchkin reel-set mixture.",
    cfg: {
      reelSets: [
        { label: 'base_oz',         selectionProbability: 0.92, meanPayout: 0.95, variancePayout: 18 },
        { label: 'munchkin_bonus',  selectionProbability: 0.08, meanPayout: 6.0,  variancePayout: 200 },
      ],
    },
  },
  {
    name: "C_lw_diverse_5_set_reshape_menu",
    description: "Vendor B diverse 5-reel-set reshape menu — base + 4 alternative paytables sa geometric prize escalation.",
    cfg: {
      reelSets: [
        { label: 'base',     selectionProbability: 0.70, meanPayout: 1.00, variancePayout: 10 },
        { label: 'tier_1',   selectionProbability: 0.15, meanPayout: 2.50, variancePayout: 40 },
        { label: 'tier_2',   selectionProbability: 0.08, meanPayout: 5.00, variancePayout: 150 },
        { label: 'tier_3',   selectionProbability: 0.05, meanPayout: 10.0, variancePayout: 500 },
        { label: 'tier_jackpot', selectionProbability: 0.02, meanPayout: 30.0, variancePayout: 5000 },
      ],
    },
  },
  {
    name: "D_high_freq_reshape_low_jackpot",
    description: "High-frequency reshape (30%) sa modest reshape uplift — bonus-heavy gameplay.",
    cfg: {
      reelSets: [
        { label: 'base',         selectionProbability: 0.70, meanPayout: 0.85, variancePayout: 15 },
        { label: 'reshape_med',  selectionProbability: 0.30, meanPayout: 1.80, variancePayout: 30 },
      ],
    },
  },
  {
    name: "E_corner_p_reshape_zero_only_base",
    description: "Corner: p_reshape = 0 (only base, p_0 = 1) — degenerate single-set baseline.",
    cfg: {
      reelSets: [
        { selectionProbability: 1.0, meanPayout: 1.0, variancePayout: 8 },
        { selectionProbability: 0.0, meanPayout: 10,  variancePayout: 100 },
      ],
    },
  },
  {
    name: "F_corner_rare_jackpot_reshape_1_in_500",
    description: "Corner: rare jackpot reshape (1 in 500 spins) — heavy-tail audit boundary.",
    cfg: {
      reelSets: [
        { label: 'base',    selectionProbability: 0.998, meanPayout: 0.95, variancePayout: 12 },
        { label: 'jackpot', selectionProbability: 0.002, meanPayout: 100,  variancePayout: 5000 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeMidSpinReelReshapeMixture, simulateMidSpinReelReshapeMixture } =
    await import(join(REPO_ROOT, 'dist', 'features', 'midSpinReelReshapeMixture.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Mid-Spin Reel-Reshape configs @ ${SPINS} MC spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeMidSpinReelReshapeMixture(c.cfg);
    const mc = simulateMidSpinReelReshapeMixture(c.cfg, SPINS, SEED);

    const payoutRel = relErr(cf.expectedPayoutPerSpin, mc.meanPayoutPerSpin);
    const reshapeAbs = Math.abs(cf.reshapeProbability - mc.observedReshapeRate);
    let maxSetAbs = 0;
    for (let k = 0; k < cf.numReelSets; k++) {
      maxSetAbs = Math.max(maxSetAbs, Math.abs(cf.perReelSet[k].selectionProbability - mc.observedReelSetFreqs[k]));
    }

    const checks = {
      payout_rel: payoutRel,
      reshape_abs: reshapeAbs,
      max_set_prob_abs: maxSetAbs,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      reshapeAbs <= TOL_RESHAPE_ABS &&
      maxSetAbs <= TOL_SET_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    const bestLabel = cf.perReelSet[cf.bestReelSetIndex].label;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `K=${cf.numReelSets}  ` +
        `E[Y]=${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.meanPayoutPerSpin.toFixed(3)}  ` +
        `reshape=${(cf.reshapeProbability*100).toFixed(1)}%/${(mc.observedReshapeRate*100).toFixed(1)}%  ` +
        `best=${bestLabel} uplift=${cf.commercialUpliftVsBaseOnly.toFixed(2)}× withinShare=${(cf.withinSetVarianceShare*100).toFixed(1)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name, description: c.description, cfg: c.cfg, closed_form: cf,
      monte_carlo: { ...mc, spins: SPINS }, checks, pass, elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'MID_SPIN_REEL_RESHAPE_MIXTURE',
    generated_utc: new Date().toISOString(), spins_per_config: SPINS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, reshape_abs: TOL_RESHAPE_ABS, set_prob_abs: TOL_SET_PROB_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MID_SPIN_REEL_RESHAPE_MIXTURE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MID_SPIN_REEL_RESHAPE_MIXTURE — Mid-Spin Random Reel-Reshape Mixture Aggregator Acceptance (W195, 76. solver, Vendor B M13 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${SPINS} MC spins each.`);
  md.push('');
  md.push("Closes Vendor B M13 P1 GAP — WMS Wizard of Oz Follow the Yellow Brick Road (Glinda reshape, 2017 defining title) + Munchkinland reshape variants + future Vendor B reshape-mechanic flagships.");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('K-component reel-set mixture distribution:');
  md.push('  - K ~ Categorical(p_0..p_{K-1}), Σ p_k = 1');
  md.push('  - Per-set X_k ~ iid sa distinct (μ_k, σ²_k) paytable');
  md.push('  - **E[Y] = Σ p_k · μ_k** mixture mean');
  md.push('  - **E[Y²] = Σ p_k · (σ²_k + μ²_k)**');
  md.push('  - **Var[Y] = E[Y²] − E[Y]²** mixture variance');
  md.push('  - **Var[Y] = E[Var[Y|K]] + Var[E[Y|K]]** (within + between decomposition)');
  md.push('  - reshapeProbability = 1 − p_0');
  md.push('  - commercialUpliftVsBaseOnly = E[Y] / μ_base');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | K | E[Y] CF/MC | reshape CF/MC | best (uplift×) | within share |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const bestLabel = r.closed_form.perReelSet[r.closed_form.bestReelSetIndex].label;
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.numReelSets} | ${r.closed_form.expectedPayoutPerSpin.toFixed(3)}/${r.monte_carlo.meanPayoutPerSpin.toFixed(3)} | ${(r.closed_form.reshapeProbability*100).toFixed(1)}%/${(r.monte_carlo.observedReshapeRate*100).toFixed(1)}% | ${bestLabel} (${r.closed_form.commercialUpliftVsBaseOnly.toFixed(2)}×) | ${(r.closed_form.withinSetVarianceShare*100).toFixed(1)}% |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-14 mandatory per-reel-set RTP disclosure / MGA PPD §11 stochastic reshape transparency / eCOGRA per-reel-set paytable audit / EU GA 2024.');
  md.push('');
  md.push("Industry: Vendor B WMS Wizard of Oz Follow the Yellow Brick Road + Munchkinland reshape + future Vendor B reshape-mechanic flagships.");
  writeFileSync(join(OUT_DIR, 'MID_SPIN_REEL_RESHAPE_MIXTURE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
