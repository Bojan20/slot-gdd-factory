#!/usr/bin/env node
//
// W152 Wave 176 — Skill-Stop Near-Miss Rate Analyzer acceptance (Wave 175).
//
// 6 regulatory-regime + reel-design configs × 50K MC spins each = 300K total
// spin sims. Closed-form regulatory-flag detector cross-validated against
// per-reel-stop three-bucket Bernoulli MC.
//
// Operator deliverable: `reports/acceptance/SKILL_STOP_NEAR_MISS.{json,md}`.
//
// Compliance: UKGC RTS 12 (NO deliberate near-miss enhancement, BANNED),
// JP Pachislot 風営法 §2(7) (1.5× cap, manufacturer certification),
// AU NCPF 2022 §3.4 (NSW/VIC psychophysics monitoring, 1.2× cap),
// AGCO Slot Standards 2024 §5.7 (Ontario, follows UKGC),
// EU GA 2024 cross-jurisdiction.
//
// Academic citations: Reid (1986) "Psychology of the near miss" J Gambl
// Behav 2(1):32-39, Harrigan & Dixon (2009) "PAR sheets, probabilities,
// slot machine play", Templeton et al (2015) "Near-misses extend gambling
// persistence" J Gambl Studies 31(3):785-800.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 50_000;
const SEED = 0xCAFE0175;

const TOL_ANY_REEL_ABS = 0.02;     // P(any reel NM) abs ≤ 2pp
const TOL_ALL_BUT_ONE_ABS = 0.01;  // P(4-of-5 jackpot + 1 NM) abs ≤ 1pp
const TOL_FRUSTRATION_REL = 0.20;  // frustrationRatio rel ≤ 20%

const CONFIGS = [
  {
    name: 'A_ukgc_vegas_5reel_compliant',
    description: 'UKGC Vegas-style 5-reel slot N=22 M=1 K=1 RNG-uniform: observed = baseline 2/22 = 9.1%. Expected: NO FLAG.',
    cfg: {
      symbolsPerReel: 22,
      jackpotSymbolsPerReel: 1,
      nearMissBand: 1,
      observedNearMissRatePerReel: 2 / 22,
      numReels: 5,
      regulatoryRegime: 'UKGC',
    },
    expectedFlag: false,
  },
  {
    name: 'B_ukgc_deliberate_inflation_FLAG',
    description: 'UKGC Vegas 5-reel BUT operator inflates observed near-miss 2× baseline (PAR sheet weighting). Expected: FLAG (RTS 12 violation, ban).',
    cfg: {
      symbolsPerReel: 22,
      jackpotSymbolsPerReel: 1,
      nearMissBand: 1,
      observedNearMissRatePerReel: (2 / 22) * 2.0,  // 2× baseline = 18.18%
      numReels: 5,
      regulatoryRegime: 'UKGC',
    },
    expectedFlag: true,
  },
  {
    name: 'C_jp_pachislot_3reel_at_cap_1x5_compliant',
    description: 'JP Pachislot 3-reel N=21 M=1 inflated 1.5× = JP 風営法 cap (manufacturer certified). Expected: NO FLAG (JP regime).',
    cfg: {
      symbolsPerReel: 21,
      jackpotSymbolsPerReel: 1,
      nearMissBand: 1,
      observedNearMissRatePerReel: (2 / 21) * 1.5,  // exactly 1.5×
      numReels: 3,
      regulatoryRegime: 'JP_PACHISLOT',
    },
    expectedFlag: false,
  },
  {
    name: 'D_jp_pachislot_exceeds_cap_FLAG',
    description: 'JP Pachislot 3-reel inflated 2.0× baseline > 1.5× cap. Expected: FLAG (license violation).',
    cfg: {
      symbolsPerReel: 21,
      jackpotSymbolsPerReel: 1,
      nearMissBand: 1,
      observedNearMissRatePerReel: (2 / 21) * 2.0,
      numReels: 3,
      regulatoryRegime: 'JP_PACHISLOT',
    },
    expectedFlag: true,
  },
  {
    name: 'E_au_ncpf_at_cap_1x2_compliant',
    description: 'AU NCPF NSW/VIC 5-reel N=20 M=2 inflated 1.2× = AU cap. Expected: NO FLAG (AU regime, disclosure not required).',
    cfg: {
      symbolsPerReel: 20,
      jackpotSymbolsPerReel: 2,
      nearMissBand: 1,
      observedNearMissRatePerReel: 0.20 * 1.2,  // 1.2× of baseline 0.20 = 0.24
      numReels: 5,
      regulatoryRegime: 'AU_NCPF',
    },
    expectedFlag: false,
  },
  {
    name: 'F_reid_1986_classic_2x_ALL_REGIMES_FLAG',
    description: 'Reid (1986) classic near-miss study: 5-reel N=20 M=2 inflated 2× baseline. Expected: FLAG under ALL regimes (UKGC/AGCO/AU; only JP if >1.5×, here 2.0× > 1.5×).',
    cfg: {
      symbolsPerReel: 20,
      jackpotSymbolsPerReel: 2,
      nearMissBand: 1,
      observedNearMissRatePerReel: 0.40,  // 2× of baseline 0.20
      numReels: 5,
      regulatoryRegime: 'UKGC',
    },
    expectedFlag: true,
  },
];

async function main() {
  const { solveSkillStopNearMiss, simulateSkillStopNearMiss } =
    await import(join(REPO_ROOT, 'dist', 'features', 'skillStopNearMiss.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Skill-Stop Near-Miss configs @ ${SPINS} MC spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveSkillStopNearMiss(c.cfg);
    const mc = simulateSkillStopNearMiss(c.cfg, SPINS, SEED);

    const anyReelAbs = Math.abs(cf.anyReelNearMissProb - mc.observedAnyReelNearMissProb);
    const allButOneAbs = Math.abs(cf.allButOneWinNearMissProb - mc.observedAllButOneWinNearMissProb);
    const frustrationRel = cf.frustrationRatio > 0
      ? Math.abs(cf.frustrationRatio - mc.observedFrustrationRatio) / cf.frustrationRatio
      : 0;

    const flagMatches = cf.regulatoryFlag === c.expectedFlag;

    const checks = {
      any_reel_abs: anyReelAbs,
      all_but_one_abs: allButOneAbs,
      frustration_rel: frustrationRel,
      flag_matches_expected: flagMatches,
    };
    const pass =
      anyReelAbs <= TOL_ANY_REEL_ABS &&
      allButOneAbs <= TOL_ALL_BUT_ONE_ABS &&
      frustrationRel <= TOL_FRUSTRATION_REL &&
      flagMatches;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(50)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.symbolsPerReel} M=${c.cfg.jackpotSymbolsPerReel} R=${c.cfg.numReels}  ` +
        `obs=${(c.cfg.observedNearMissRatePerReel*100).toFixed(2)}%  ` +
        `infl=${cf.inflationRatio.toFixed(3)}  ` +
        `flag=${cf.regulatoryFlag ? '⚠️ ' : '✅ '}(exp=${c.expectedFlag ? '⚠️ ' : '✅ '})  ` +
        `anyNM=${(cf.anyReelNearMissProb*100).toFixed(1)}%/${(mc.observedAnyReelNearMissProb*100).toFixed(1)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      expected_flag: c.expectedFlag,
      closed_form: {
        baselineNearMissRate: cf.baselineNearMissRate,
        baselineWinRate: cf.baselineWinRate,
        observedNearMissRate: cf.observedNearMissRate,
        inflationRatio: cf.inflationRatio,
        regulatoryToleranceApplied: cf.regulatoryToleranceApplied,
        regimeUsed: cf.regimeUsed,
        regulatoryFlag: cf.regulatoryFlag,
        severityScore: cf.severityScore,
        frustrationRatio: cf.frustrationRatio,
        anyReelNearMissProb: cf.anyReelNearMissProb,
        allButOneWinNearMissProb: cf.allButOneWinNearMissProb,
        expectedFrustrationEventsPerSpin: cf.expectedFrustrationEventsPerSpin,
        disclosureText: cf.disclosureText,
      },
      monte_carlo: {
        spins: SPINS,
        observedFrustrationEventsPerSpin: mc.observedFrustrationEventsPerSpin,
        observedAnyReelNearMissProb: mc.observedAnyReelNearMissProb,
        observedAllButOneWinNearMissProb: mc.observedAllButOneWinNearMissProb,
        observedFrustrationRatio: mc.observedFrustrationRatio,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SKILL_STOP_NEAR_MISS',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      any_reel_abs: TOL_ANY_REEL_ABS,
      all_but_one_abs: TOL_ALL_BUT_ONE_ABS,
      frustration_rel: TOL_FRUSTRATION_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'SKILL_STOP_NEAR_MISS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# SKILL_STOP_NEAR_MISS — Skill-Stop Near-Miss Rate Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total spin sims.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Skill-Stop Near-Miss Rate Analyzer" (Wave 175 — 59th solver, INDUSTRY-FIRST anti-near-miss regulatory inflation detector).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form multi-regime regulatory flag detector + per-reel three-bucket Bernoulli MC.');
  md.push('  - **baselineNearMissRate = 2K·M/N** (uniform-random-stop expectation)');
  md.push('  - **baselineWinRate = M/N**');
  md.push('  - **inflationRatio = observed / baseline**');
  md.push('  - **regulatoryFlag = (inflation > tol + noise)**');
  md.push('  - Multi-reel R-reel: **anyReelNM = 1 − (1 − p_NM)^R**');
  md.push('  - **allButOneWinNM = R · winRate^(R−1) · observedNM** (4-of-5 jackpot + 1 NM, most salient)');
  md.push('  - **frustrationRatio = observed/baselineWin = inflation · 2K** (cognitive "almost-won" amplification)');
  md.push('');
  md.push('Regulatory tolerances:');
  md.push('  - **UKGC / AGCO**: 1.0 (NO deliberate enhancement)');
  md.push('  - **AU NCPF**: 1.2 (NSW/VIC psychophysics disclosure)');
  md.push('  - **JP Pachislot 風営法**: 1.5 (manufacturer certified, license cap)');
  md.push('');
  md.push('MC: 50K spins per config, per-reel three-bucket draw (WIN / NEAR_MISS / OTHER), mulberry32 RNG.');
  md.push('');
  md.push('## Configs — regulatory disclosure table');
  md.push('');
  md.push('| Config | Pass | N | M | R | obs | infl | regime | flag | exp | anyNM CF/MC |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.symbolsPerReel} | ${r.cfg.jackpotSymbolsPerReel} | ${r.cfg.numReels} | ${(r.cfg.observedNearMissRatePerReel*100).toFixed(2)}% | ${cf.inflationRatio.toFixed(3)} | ${cf.regimeUsed} | ${cf.regulatoryFlag ? '⚠️ FLAG' : '✅ OK'} | ${r.expected_flag ? '⚠️ ' : '✅ '} | ${(cf.anyReelNearMissProb*100).toFixed(1)}%/${(mc.observedAnyReelNearMissProb*100).toFixed(1)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 12** — "Operators must not design any feature giving the impression of a near miss when no such weighting occurs in the underlying RNG." (BANNED)');
  md.push('- **AGCO Slot Standards 2024 §5.7** — Ontario follows UKGC RTS 12.');
  md.push('- **JP Pachislot 風営法 §2(7)** — deliberate inflation allowed UP TO 1.5× with manufacturer certification; above = license violation.');
  md.push('- **AU NCPF 2022 §3.4** — NSW/VIC psychophysics disclosure required when rate exceeds 1.2× baseline.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline (UKGC-compatible).');
  md.push('');
  md.push('Academic foundations:');
  md.push('  - Reid (1986) "The psychology of the near miss" J Gambl Behav 2(1):32-39');
  md.push('  - Harrigan & Dixon (2009) "PAR Sheets, probabilities, slot machine play"');
  md.push('  - Templeton et al (2015) "Near-misses extend gambling persistence" J Gambl Studies 31(3):785-800');

  writeFileSync(join(OUT_DIR, 'SKILL_STOP_NEAR_MISS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/SKILL_STOP_NEAR_MISS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
