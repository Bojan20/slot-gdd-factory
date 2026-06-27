#!/usr/bin/env node
// W152 Wave 190 — Nested Mini-Slot Inside Bonus acceptance (71. solver, Vendor B M14 P1).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 50_000;
const SEED = 0xCAFE0190;

const TOL_PAYOUT_REL = 0.10;
const TOL_TRIGGER_ABS = 0.01;
const TOL_BONUS_REL = 0.10;
const TOL_NESTED_ABS = 0.04;

const CONFIGS = [
  {
    name: "A_lotr_two_towers_tower_spin_nested",
    description: "Vendor B WMS Lord of the Rings Two Towers (2013, defining title) — Tower Spin nested mini-slot inside main bonus.",
    cfg: { probBonusTriggerPerParentSpin: 0.02, numOuterBonusSpins: 10, outerBaseMean: 2.0, outerBaseVar: 1, probNestedTriggerPerOuterSpin: 0.15, numNestedInnerSpins: 5, nestedInnerMean: 8, nestedInnerVar: 4 },
  },
  {
    name: "B_lotr_return_of_the_king_extended",
    description: "Vendor B WMS Lord of the Rings Return of the King (2013) — extended nested-slot variant.",
    cfg: { probBonusTriggerPerParentSpin: 0.015, numOuterBonusSpins: 12, outerBaseMean: 2.5, outerBaseVar: 2, probNestedTriggerPerOuterSpin: 0.20, numNestedInnerSpins: 4, nestedInnerMean: 10, nestedInnerVar: 6 },
  },
  {
    name: "C_star_trek_trek_through_stars",
    description: "Vendor B WMS Star Trek Trek Through the Stars — nested-slot sub-game variant.",
    cfg: { probBonusTriggerPerParentSpin: 0.03, numOuterBonusSpins: 6, outerBaseMean: 1.8, outerBaseVar: 1, probNestedTriggerPerOuterSpin: 0.25, numNestedInnerSpins: 3, nestedInnerMean: 7, nestedInnerVar: 3 },
  },
  {
    name: "D_high_freq_low_payout_nested",
    description: "High-frequency bonus (10%) sa modest nested contribution.",
    cfg: { probBonusTriggerPerParentSpin: 0.10, numOuterBonusSpins: 5, outerBaseMean: 1.5, outerBaseVar: 0.5, probNestedTriggerPerOuterSpin: 0.30, numNestedInnerSpins: 2, nestedInnerMean: 3, nestedInnerVar: 1 },
  },
  {
    name: "E_corner_p_nested_1_always_triggers",
    description: "Corner: p_nested=1.0 — every outer-spin triggers nested.",
    cfg: { probBonusTriggerPerParentSpin: 0.05, numOuterBonusSpins: 4, outerBaseMean: 2, outerBaseVar: 0.5, probNestedTriggerPerOuterSpin: 1.0, numNestedInnerSpins: 2, nestedInnerMean: 5, nestedInnerVar: 1 },
  },
  {
    name: "F_corner_K_outer_1_single_outer_spin",
    description: "Corner: K_outer=1 (single outer-spin per bonus, degenerate).",
    cfg: { probBonusTriggerPerParentSpin: 0.08, numOuterBonusSpins: 1, outerBaseMean: 10, outerBaseVar: 4, probNestedTriggerPerOuterSpin: 0.30, numNestedInnerSpins: 3, nestedInnerMean: 8, nestedInnerVar: 2 },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeNestedMiniSlotInsideBonus, simulateNestedMiniSlotInsideBonus } =
    await import(join(REPO_ROOT, 'dist', 'features', 'nestedMiniSlotInsideBonus.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Nested Mini-Slot configs @ ${SPINS} MC parent-spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeNestedMiniSlotInsideBonus(c.cfg);
    const mc = simulateNestedMiniSlotInsideBonus(c.cfg, SPINS, SEED);

    const payoutRel = relErr(cf.expectedPayoutPerParentSpin, mc.meanPayoutPerParentSpin);
    const triggerAbs = Math.abs(c.cfg.probBonusTriggerPerParentSpin - mc.observedBonusTriggerRate);
    const bonusRel = relErr(cf.expectedBonusPayoutGivenTrigger, mc.meanBonusPayoutGivenTrigger);
    const nestedAbs = Math.abs(cf.probAtLeastOneNestedGivenBonus - mc.observedProbAtLeastOneNestedGivenBonus);

    const checks = { payout_rel: payoutRel, trigger_abs: triggerAbs, bonus_rel: bonusRel, nested_abs: nestedAbs };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      triggerAbs <= TOL_TRIGGER_ABS &&
      bonusRel <= TOL_BONUS_REL &&
      nestedAbs <= TOL_NESTED_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `p_B=${c.cfg.probBonusTriggerPerParentSpin} K_O=${c.cfg.numOuterBonusSpins} p_N=${c.cfg.probNestedTriggerPerOuterSpin} N_I=${c.cfg.numNestedInnerSpins}  ` +
        `E[Y]=${cf.expectedPayoutPerParentSpin.toFixed(3)}/${mc.meanPayoutPerParentSpin.toFixed(3)}  ` +
        `E[B|trig]=${cf.expectedBonusPayoutGivenTrigger.toFixed(1)}/${mc.meanBonusPayoutGivenTrigger.toFixed(1)}  ` +
        `share=${(cf.nestedSlotContributionShare*100).toFixed(1)}%  uplift=${cf.commercialUpliftVsNoNestedSlot.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({ name: c.name, description: c.description, cfg: c.cfg, closed_form: cf, monte_carlo: { ...mc, spins: SPINS }, checks, pass, elapsed_ms: elapsedMs });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'NESTED_MINI_SLOT_INSIDE_BONUS',
    generated_utc: new Date().toISOString(), spins_per_config: SPINS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, trigger_abs: TOL_TRIGGER_ABS, bonus_rel: TOL_BONUS_REL, nested_abs: TOL_NESTED_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length, configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'NESTED_MINI_SLOT_INSIDE_BONUS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# NESTED_MINI_SLOT_INSIDE_BONUS — Nested Mini-Slot Inside Bonus Compositional Aggregator Acceptance (W190, 71. solver, Vendor B M14 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${SPINS} MC parent-spins each.`);
  md.push('');
  md.push('Closes Vendor B M14 GAP — LOTR Two Towers + Return of the King + Star Trek.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Hierarchical composition sa law of total variance:');
  md.push('  - **E[Z per outer] = μ_O + p_N · N_I · μ_I**');
  md.push('  - **Var[Z]** = σ²_O + p_N·N_I·σ²_I + p_N(1-p_N)·(N_I·μ_I)²');
  md.push('  - **E[B | bonus] = K_O · E[Z]**');
  md.push('  - **E[Y/parent spin] = p_B · E[B]**');
  md.push('  - **Var[Y]** = p_B·Var[B] + p_B(1-p_B)·E[B]²');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | p_B/K_O/p_N/N_I | E[Y] CF/MC | E[B|trig] CF/MC | nested share | uplift× |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.probBonusTriggerPerParentSpin}/${r.cfg.numOuterBonusSpins}/${r.cfg.probNestedTriggerPerOuterSpin}/${r.cfg.numNestedInnerSpins} | ${r.closed_form.expectedPayoutPerParentSpin.toFixed(3)}/${r.monte_carlo.meanPayoutPerParentSpin.toFixed(3)} | ${r.closed_form.expectedBonusPayoutGivenTrigger.toFixed(1)}/${r.monte_carlo.meanBonusPayoutGivenTrigger.toFixed(1)} | ${(r.closed_form.nestedSlotContributionShare*100).toFixed(1)}% | ${r.closed_form.commercialUpliftVsNoNestedSlot.toFixed(2)} |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-14 nested-feature compositional / MGA PPD §11 / eCOGRA / EU GA 2024.');
  md.push('');
  md.push("Industry: LOTR Two Towers + Return of the King + Star Trek variants.");
  writeFileSync(join(OUT_DIR, 'NESTED_MINI_SLOT_INSIDE_BONUS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
