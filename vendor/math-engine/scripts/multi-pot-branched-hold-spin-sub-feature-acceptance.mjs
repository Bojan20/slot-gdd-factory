#!/usr/bin/env node
// W152 Wave 193 — Multi-Pot Branched H&S Sub-Feature acceptance (74. solver, Vendor B M15 P1).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0193;

const TOL_PAYOUT_REL = 0.07;
const TOL_TRIGGER_ABS = 0.01;
const TOL_BONUS_REL = 0.08;
const TOL_POT_PROB_ABS = 0.03;

const CONFIGS = [
  {
    name: "A_piggy_bankin_break_in_3_pot",
    description: "Vendor B Vendor H Rich Little Piggies Piggy Bankin' Break In (2024 defining title) — 3-pot branched H&S (Instant Win / Double Play / Repeat Win).",
    cfg: {
      probTrigger: 0.04,
      pots: [
        { label: 'instant_win', selectionWeight: 5, meanPayout: 25,  variancePayout: 16 },
        { label: 'double_play', selectionWeight: 3, meanPayout: 60,  variancePayout: 100 },
        { label: 'repeat_win',  selectionWeight: 2, meanPayout: 180, variancePayout: 900 },
      ],
    },
  },
  {
    name: "B_rich_piggies_world_class_4_tier_jackpot",
    description: "Vendor B Vendor H Rich Little Piggies World Class (2025) — class-tier escalation Mini/Minor/Major/Grand.",
    cfg: {
      probTrigger: 0.03,
      pots: [
        { label: 'mini',  selectionWeight: 50, meanPayout: 20,   variancePayout: 9 },
        { label: 'minor', selectionWeight: 30, meanPayout: 100,  variancePayout: 100 },
        { label: 'major', selectionWeight: 15, meanPayout: 500,  variancePayout: 2500 },
        { label: 'grand', selectionWeight: 5,  meanPayout: 5000, variancePayout: 250000 },
      ],
    },
  },
  {
    name: "C_rich_hens_world_class_hen_variant",
    description: "Vendor B Vendor H Rich Little Hens World Class (2025) — hen variant sa modified prize ladder.",
    cfg: {
      probTrigger: 0.035,
      pots: [
        { label: 'hen_basket', selectionWeight: 6, meanPayout: 30, variancePayout: 20 },
        { label: 'hen_coop',   selectionWeight: 3, meanPayout: 120, variancePayout: 200 },
        { label: 'hen_grand',  selectionWeight: 1, meanPayout: 1000, variancePayout: 40000 },
      ],
    },
  },
  {
    name: "D_high_freq_low_jackpot_3_pot",
    description: "High-frequency trigger (10%) sa modest-payout 3-pot mix.",
    cfg: {
      probTrigger: 0.10,
      pots: [
        { label: 'small',  selectionWeight: 7, meanPayout: 8,  variancePayout: 4 },
        { label: 'medium', selectionWeight: 2, meanPayout: 30, variancePayout: 25 },
        { label: 'large',  selectionWeight: 1, meanPayout: 80, variancePayout: 200 },
      ],
    },
  },
  {
    name: "E_corner_2_pot_binary_branch",
    description: "Corner: 2-pot binary branch (minimum M=2).",
    cfg: {
      probTrigger: 0.06,
      pots: [
        { selectionWeight: 7, meanPayout: 15, variancePayout: 6 },
        { selectionWeight: 3, meanPayout: 75, variancePayout: 150 },
      ],
    },
  },
  {
    name: "F_corner_5_pot_uniform_progression",
    description: "Corner: 5-pot uniform-selection sa geometric prize progression (audit corner).",
    cfg: {
      probTrigger: 0.05,
      pots: [
        { label: 'p1', selectionWeight: 1, meanPayout: 10,   variancePayout: 4 },
        { label: 'p2', selectionWeight: 1, meanPayout: 25,   variancePayout: 16 },
        { label: 'p3', selectionWeight: 1, meanPayout: 60,   variancePayout: 100 },
        { label: 'p4', selectionWeight: 1, meanPayout: 150,  variancePayout: 500 },
        { label: 'p5', selectionWeight: 1, meanPayout: 400,  variancePayout: 4000 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeMultiPotBranchedHoldSpinSubFeature, simulateMultiPotBranchedHoldSpinSubFeature } =
    await import(join(REPO_ROOT, 'dist', 'features', 'multiPotBranchedHoldSpinSubFeature.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Multi-Pot Branched H&S configs @ ${SPINS} MC spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeMultiPotBranchedHoldSpinSubFeature(c.cfg);
    const mc = simulateMultiPotBranchedHoldSpinSubFeature(c.cfg, SPINS, SEED);

    const payoutRel = relErr(cf.expectedPayoutPerSpin, mc.meanPayoutPerSpin);
    const triggerAbs = Math.abs(c.cfg.probTrigger - mc.observedTriggerRate);
    const bonusRel = relErr(cf.expectedPayoutGivenTrigger, mc.meanPayoutGivenTrigger);
    let maxPotAbs = 0;
    for (let k = 0; k < cf.numPots; k++) {
      maxPotAbs = Math.max(maxPotAbs, Math.abs(cf.perPot[k].selectionProb - mc.observedPotSelectionRates[k]));
    }

    const checks = {
      payout_rel: payoutRel, trigger_abs: triggerAbs, bonus_rel: bonusRel, max_pot_prob_abs: maxPotAbs,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      triggerAbs <= TOL_TRIGGER_ABS &&
      bonusRel <= TOL_BONUS_REL &&
      maxPotAbs <= TOL_POT_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    const bestLabel = cf.perPot[cf.bestPotIndex].label;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `p_T=${c.cfg.probTrigger} M=${cf.numPots}  ` +
        `E[Y]=${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.meanPayoutPerSpin.toFixed(3)}  ` +
        `E[V|trig]=${cf.expectedPayoutGivenTrigger.toFixed(1)}/${mc.meanPayoutGivenTrigger.toFixed(1)}  ` +
        `best=${bestLabel}(share=${(cf.jackpotPotShare*100).toFixed(1)}%)  ` +
        `mixVarLift=${cf.mixtureVarianceLift.toFixed(2)} CoV=${cf.bonusVariabilityIndex.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name, description: c.description, cfg: c.cfg, closed_form: cf,
      monte_carlo: { ...mc, spins: SPINS }, checks, pass, elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'MULTI_POT_BRANCHED_HOLD_SPIN_SUB_FEATURE',
    generated_utc: new Date().toISOString(), spins_per_config: SPINS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, trigger_abs: TOL_TRIGGER_ABS, bonus_rel: TOL_BONUS_REL, pot_prob_abs: TOL_POT_PROB_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MULTI_POT_BRANCHED_HOLD_SPIN_SUB_FEATURE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MULTI_POT_BRANCHED_HOLD_SPIN_SUB_FEATURE — Multi-Pot Branched H&S Sub-Feature Selection Aggregator Acceptance (W193, 74. solver, Vendor B M15 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Vendor B M15 P1 GAP — Vendor H Rich Little Piggies Piggy Bankin\' Break In + World Class + Hens.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Trigger-gated categorical sub-mode mixture:');
  md.push('  - **T ~ Bernoulli(p_trigger), K ~ Categorical(p_1..p_M) given T=1**');
  md.push('  - **E[V|trig] = Σ p_k · μ_k** (mixture mean)');
  md.push('  - **Var[V|trig] = Σ p_k·(σ²_k+μ²_k) − (E[V|trig])²** (mixture variance)');
  md.push('  - **E[Y/spin] = p_trigger · E[V|trig]**');
  md.push('  - **Var[Y/spin]** via law of total variance on trigger');
  md.push('  - perPot.contributionShareOfBonus = p_k·μ_k / E[V|trig]');
  md.push('  - mixtureVarianceLift = Var[V|trig] / Σ p_k·σ²_k (cross-pot diversity)');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | p_T / M | E[Y] CF/MC | E[V|trig] CF/MC | best pot (share) | mixVarLift | CoV |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const bestLabel = r.closed_form.perPot[r.closed_form.bestPotIndex].label;
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.probTrigger}/${r.closed_form.numPots} | ${r.closed_form.expectedPayoutPerSpin.toFixed(3)}/${r.monte_carlo.meanPayoutPerSpin.toFixed(3)} | ${r.closed_form.expectedPayoutGivenTrigger.toFixed(1)}/${r.monte_carlo.meanPayoutGivenTrigger.toFixed(1)} | ${bestLabel}(${(r.closed_form.jackpotPotShare*100).toFixed(1)}%) | ${r.closed_form.mixtureVarianceLift.toFixed(2)} | ${r.closed_form.bonusVariabilityIndex.toFixed(2)} |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-14 mandatory per-pot RTP contribution / MGA PPD §11 branched-mode / eCOGRA per-mode audit / EU GA 2024.');
  md.push('');
  md.push("Industry: Vendor B Vendor H Rich Little Piggies Piggy Bankin' Break In (2024 defining title) + World Class (2025) + Rich Little Hens World Class (2025).");
  writeFileSync(join(OUT_DIR, 'MULTI_POT_BRANCHED_HOLD_SPIN_SUB_FEATURE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
