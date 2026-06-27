#!/usr/bin/env node
//
// W152 Wave 188 — Player-Elects Feature Composition Aggregator acceptance
// (69. solver, Vendor B M11 P1 GAP CLOSURE — RR Pick n Mix + MJ KOP + KISS + 5 Treasures).
//
// 6 industry configs × 20K MC spins (per strategy) = 360K total spin sims sa
// player rational/uniform/worst strategy MC vs exact CF.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 20_000;
const SEED = 0xCAFE0188;

const TOL_PICK_REL = 0.08;       // high-vol single-mode FS configs: σ/√N ~ 6% @ 20K spins
const TOL_STDDEV_REL = 0.20;

const CONFIGS = [
  {
    name: "A_rainbow_riches_pick_n_mix_3of5",
    description: "Vendor B Barcrest Rainbow Riches Pick n Mix (2014) — pick 3 of 5 bonuses (Roads/Wishing/Pots/Magic/Cash).",
    cfg: {
      candidateModes: [
        { name: 'Roads_to_Riches', rtp: 0.32, variance: 8 },
        { name: 'Wishing_Well', rtp: 0.28, variance: 5 },
        { name: 'Pots_of_Gold', rtp: 0.35, variance: 12 },
        { name: 'Magic_Toadstool', rtp: 0.18, variance: 2 },
        { name: 'Cash_Crop', rtp: 0.22, variance: 4 },
      ],
      numModesToElect: 3,
    },
  },
  {
    name: "B_michael_jackson_kop_3fs_modes",
    description: "Vendor B Vendor H Michael Jackson King of Pop (2013) — 3 FS modes Smooth Criminal/Beat It/Billie Jean, pick 1.",
    cfg: {
      candidateModes: [
        { name: 'Smooth_Criminal', rtp: 0.95, variance: 50 },
        { name: 'Beat_It', rtp: 1.05, variance: 80 },
        { name: 'Billie_Jean', rtp: 1.00, variance: 65 },
      ],
      numModesToElect: 1,
    },
  },
  {
    name: "C_kiss_band_member_fs_variants",
    description: "Vendor B Vendor H KISS — 4 band-member FS variants, pick 1 (Paul/Gene/Ace/Peter).",
    cfg: {
      candidateModes: [
        { name: 'Paul_Stanley_FS', rtp: 0.98, variance: 55 },
        { name: 'Gene_Simmons_FS', rtp: 1.02, variance: 70 },
        { name: 'Ace_Frehley_FS', rtp: 1.00, variance: 60 },
        { name: 'Peter_Criss_FS', rtp: 0.96, variance: 45 },
      ],
      numModesToElect: 1,
    },
  },
  {
    name: "D_5_treasures_5fs_modes",
    description: "Vendor B Shuffle Master 5 Treasures (2017) — 5 FS modes (Dragon/Phoenix/Tiger/Lion/Elephant), pick 1.",
    cfg: {
      candidateModes: [
        { name: 'Dragon_Treasure', rtp: 1.10, variance: 90 },
        { name: 'Phoenix_Treasure', rtp: 1.05, variance: 75 },
        { name: 'Tiger_Treasure', rtp: 1.00, variance: 60 },
        { name: 'Lion_Treasure', rtp: 0.95, variance: 45 },
        { name: 'Elephant_Treasure', rtp: 0.90, variance: 35 },
      ],
      numModesToElect: 1,
    },
  },
  {
    name: "E_corner_pick_all_modes",
    description: "Corner: m = N (pick all modes) — degenerate single-composition case.",
    cfg: {
      candidateModes: [
        { name: 'A', rtp: 0.3, variance: 4 },
        { name: 'B', rtp: 0.4, variance: 5 },
        { name: 'C', rtp: 0.2, variance: 3 },
      ],
      numModesToElect: 3,
    },
  },
  {
    name: "F_corner_flat_rtp_zero_skill_premium",
    description: "Corner: flat RTP across all modes — skill premium = 0 (no player-rational advantage).",
    cfg: {
      candidateModes: [
        { name: 'A', rtp: 0.5, variance: 5 },
        { name: 'B', rtp: 0.5, variance: 5 },
        { name: 'C', rtp: 0.5, variance: 5 },
        { name: 'D', rtp: 0.5, variance: 5 },
      ],
      numModesToElect: 2,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzePlayerElectsFeatureComposition, simulatePlayerElectsFeatureComposition } =
    await import(join(REPO_ROOT, 'dist', 'features', 'playerElectsFeatureComposition.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Player-Elects Feature Composition configs @ ${SPINS} MC spins per strategy each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzePlayerElectsFeatureComposition(c.cfg);
    const mcRational = simulatePlayerElectsFeatureComposition(c.cfg, SPINS, 'rational', SEED);
    const mcWorst = simulatePlayerElectsFeatureComposition(c.cfg, SPINS, 'worst', SEED + 1);
    const mcUniform = simulatePlayerElectsFeatureComposition(c.cfg, SPINS, 'uniform', SEED + 2);

    const bestRel = relErr(cf.expectedPayoutBestPick, mcRational.meanPayoutPerSpin);
    const worstRel = relErr(cf.expectedPayoutWorstPick, mcWorst.meanPayoutPerSpin);
    const uniformRel = relErr(cf.expectedPayoutUniformPick, mcUniform.meanPayoutPerSpin);
    const stdDevRel = relErr(cf.stdDevBestPick, mcRational.stdDevPayoutPerSpin);

    const checks = {
      best_pick_rel: bestRel,
      worst_pick_rel: worstRel,
      uniform_pick_rel: uniformRel,
      std_dev_rel: stdDevRel,
    };
    const pass =
      bestRel <= TOL_PICK_REL &&
      worstRel <= TOL_PICK_REL &&
      uniformRel <= TOL_PICK_REL &&
      stdDevRel <= TOL_STDDEV_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.candidateModes.length} m=${c.cfg.numModesToElect}  ` +
        `best=${cf.expectedPayoutBestPick.toFixed(3)}/${mcRational.meanPayoutPerSpin.toFixed(3)}  ` +
        `worst=${cf.expectedPayoutWorstPick.toFixed(3)}/${mcWorst.meanPayoutPerSpin.toFixed(3)}  ` +
        `uniform=${cf.expectedPayoutUniformPick.toFixed(3)}/${mcUniform.meanPayoutPerSpin.toFixed(3)}  ` +
        `skill+=${cf.skillPremium.toFixed(3)}  ` +
        `C(N,m)=${cf.numDistinctCompositions}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        numDistinctCompositions: cf.numDistinctCompositions,
        expectedPayoutBestPick: cf.expectedPayoutBestPick,
        varianceBestPick: cf.varianceBestPick,
        stdDevBestPick: cf.stdDevBestPick,
        bestPickIndices: cf.bestPickIndices,
        bestPickNames: cf.bestPickNames,
        expectedPayoutWorstPick: cf.expectedPayoutWorstPick,
        worstPickIndices: cf.worstPickIndices,
        worstPickNames: cf.worstPickNames,
        expectedPayoutUniformPick: cf.expectedPayoutUniformPick,
        rtpSpread: cf.rtpSpread,
        skillPremium: cf.skillPremium,
        perModeDisclosure: cf.perModeDisclosure,
        fullPortfolioExpectedPayout: cf.fullPortfolioExpectedPayout,
        rationalityCoverageRatio: cf.rationalityCoverageRatio,
      },
      monte_carlo: {
        spins_per_strategy: SPINS,
        rational: { meanPayoutPerSpin: mcRational.meanPayoutPerSpin, stdDev: mcRational.stdDevPayoutPerSpin },
        worst: { meanPayoutPerSpin: mcWorst.meanPayoutPerSpin, stdDev: mcWorst.stdDevPayoutPerSpin },
        uniform: { meanPayoutPerSpin: mcUniform.meanPayoutPerSpin, stdDev: mcUniform.stdDevPayoutPerSpin },
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'PLAYER_ELECTS_FEATURE_COMPOSITION',
    generated_utc: new Date().toISOString(),
    spins_per_strategy: SPINS,
    seed: SEED,
    tolerances: {
      best_pick_rel: TOL_PICK_REL,
      worst_pick_rel: TOL_PICK_REL,
      uniform_pick_rel: TOL_PICK_REL,
      std_dev_rel: TOL_STDDEV_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'PLAYER_ELECTS_FEATURE_COMPOSITION.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# PLAYER_ELECTS_FEATURE_COMPOSITION — Player-Elects Feature Composition Aggregator Acceptance (W188, 69. solver, Vendor B M11 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins per strategy each = ${(CONFIGS.length * SPINS * 3 / 1e3).toFixed(0)}K total spin sims (rational + worst + uniform strategies).`);
  md.push('');
  md.push("Closes Faza 12 ext (post-W100): ✅ \"Player-Elects Feature Composition Aggregator\" (Wave 188 — 69. closed-form solver, Vendor B M11 P1 GAP CLOSED — Rainbow Riches Pick n Mix + Michael Jackson KOP + KISS + 5 Treasures).");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('m-of-N combinatorial composition selection:');
  md.push('  - N candidate modes sa distinct (r_i, σ²_i) per mode');
  md.push('  - Player elects subset S of size m');
  md.push('  - Contributions sum: E[Y | S] = Σ_{i ∈ S} r_i, Var = Σ σ²_i');
  md.push('  - **Best pick (rational)**: top m by RTP desc');
  md.push('  - **Worst pick**: bottom m by RTP');
  md.push('  - **Uniform pick**: (m/N) · Σ r_i (linearity of expectation)');
  md.push('  - **Skill premium**: bestPick − uniformPick');
  md.push('  - **RTP spread**: bestPick − worstPick (player-knowledge value)');
  md.push('');
  md.push('MC: 20K spins per strategy (rational/worst/uniform), per-spin sum across elected modes sa Gaussian noise.');
  md.push('');
  md.push('## Configs — Player-Elects Feature Composition operator disclosure table');
  md.push('');
  md.push('| Config | Pass | N/m | best CF/MC | worst CF/MC | uniform CF/MC | skill+ |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.candidateModes.length}/${r.cfg.numModesToElect} | ${cf.expectedPayoutBestPick.toFixed(3)}/${mc.rational.meanPayoutPerSpin.toFixed(3)} | ${cf.expectedPayoutWorstPick.toFixed(3)}/${mc.worst.meanPayoutPerSpin.toFixed(3)} | ${cf.expectedPayoutUniformPick.toFixed(3)}/${mc.uniform.meanPayoutPerSpin.toFixed(3)} | ${cf.skillPremium.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS-12** — player choice mechanic disclosure.');
  md.push('- **UKGC RTS-14** — per-mode contribution transparency.');
  md.push('- **MGA PPD §11** — composition transparency (must disclose RTP spread + skill premium).');
  md.push('- **eCOGRA Generic Slots Audit** — per-mode audit trail.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push('Industry use: Vendor B M11 gap — Rainbow Riches Pick n Mix (pick 3 of 5 bonuses), Michael Jackson King of Pop (3 FS modes Smooth Criminal/Beat It/Billie Jean), KISS (band-member FS variants), 5 Treasures (5 FS modes).');

  writeFileSync(join(OUT_DIR, 'PLAYER_ELECTS_FEATURE_COMPOSITION.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/PLAYER_ELECTS_FEATURE_COMPOSITION.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
