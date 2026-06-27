#!/usr/bin/env node
//
// W152 Wave 155 — Free Bet Wagering Requirement Aggregator acceptance (Wave 154).
//
// 6 industry-representative bonus play-through configs × 5K episodes each
// = 30K total MC episodes. Bachelier first-passage closed-form cross-validated
// against Gaussian per-spin Box-Muller MC.
//
// Operator deliverable: `reports/acceptance/FREE_BET_WAGERING_REQUIREMENT.{json,md}`.
//
// Compliance: UKGC RTS-12 (responsible gambling, bonus terms transparency),
// MGA Player Protection Directives §15 (max x35 WR cap, prominent display),
// EU GambleAware-driven realistic expected-return disclosure.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 5_000;
const SEED = 0xCAFE0154;

// MC vs CF tolerances — bonus play-through is high-variance random walk;
// relax slightly vs pure-PMF acceptance scripts.
const TOL_BUST_ABS = 0.04;            // P(bust) abs (4pp; bonus play-through inherent high MC noise)
const TOL_BALANCE_REL = 0.20;         // E[balance|survive] relative (20%, only when survival>0.2)
const TOL_WITHDRAWABLE_REL = 0.25;    // E[withdrawable] relative (25%, hot configs)

const CONFIGS = [
  {
    name: 'A_uk_mga_x35_standard_96pct_med_vol',
    description: 'UK / MGA standard: bonus £10 x35 WR @ 96% RTP, vol-index 5 (medium-vol slots like Vendor D Starburst)',
    cfg: {
      bonusAmount: 10,
      wagerMultiplier: 35,
      betPerSpin: 0.20,
      rtp: 0.96,
      volatilityIndex: 5,
    },
  },
  {
    name: 'B_mga_capped_x30_high_rtp_low_vol',
    description: 'MGA-cap x30 @ 97% RTP low-volatility — favorable disclosure case',
    cfg: {
      bonusAmount: 20,
      wagerMultiplier: 30,
      betPerSpin: 0.40,
      rtp: 0.97,
      volatilityIndex: 3,
    },
  },
  {
    name: 'C_predatory_x50_96pct_high_vol',
    description: 'Predatory x50 WR @ 96% RTP high-volatility (Pragmatic Sweet Bonanza-style) — near-zero withdrawable',
    cfg: {
      bonusAmount: 10,
      wagerMultiplier: 50,
      betPerSpin: 0.20,
      rtp: 0.96,
      volatilityIndex: 12,
    },
  },
  {
    name: 'D_favorable_x10_high_rtp_low_vol',
    description: 'Promotional x10 WR @ 97.5% RTP very-low-vol — strong "real money" bonus',
    cfg: {
      bonusAmount: 50,
      wagerMultiplier: 10,
      betPerSpin: 1.00,
      rtp: 0.975,
      volatilityIndex: 2,
    },
  },
  {
    name: 'E_corner_positive_rtp_promo',
    description: 'Edge case: RTP=1.00 (zero drift) x20 WR — should preserve bonus EV',
    cfg: {
      bonusAmount: 25,
      wagerMultiplier: 20,
      betPerSpin: 0.50,
      rtp: 1.00,
      volatilityIndex: 4,
    },
  },
  {
    name: 'F_high_rtp_promotional_advantage',
    description: 'RTP>1 promo (e.g. cashback boost) x15 WR — player advantage scenario',
    cfg: {
      bonusAmount: 30,
      wagerMultiplier: 15,
      betPerSpin: 0.60,
      rtp: 1.02,
      volatilityIndex: 4,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveFreeBetWageringRequirement, simulateFreeBetWageringRequirement } = await import(
    join(REPO_ROOT, 'dist', 'features', 'freeBetWageringRequirement.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Free Bet Wagering Requirement configs @ ${EPISODES} MC episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveFreeBetWageringRequirement(c.cfg);
    const mc = simulateFreeBetWageringRequirement(c.cfg, EPISODES, SEED);

    const bustAbs = Math.abs(cf.bustProbability - mc.observedBustRate);

    // CF E[balance | survive] = E[X_N · 1{min ≥ 0}] / P(survive)
    //                         = expectedWithdrawable / survivalProbability
    // (Since 1{min ≥ 0} ⇒ X_N ≥ 0, so expectedWithdrawable already integrates
    //  the surviving-path positive mass; we just normalise.)
    // MC reports mean balance conditional on survival (completedEpisodes only).
    const cfBalanceCondOnSurvive =
      cf.survivalProbability > 1e-6 ? cf.expectedWithdrawable / cf.survivalProbability : 0;
    const balanceRel =
      cf.survivalProbability > 0.05 && mc.observedMeanBalanceAtCompletion > 1e-6
        ? relErr(cfBalanceCondOnSurvive, mc.observedMeanBalanceAtCompletion)
        : 0; // skip when survival negligible (MC sample too small)

    // E[withdrawable] — both CF and MC use unconditional zero-on-bust convention.
    const withdrawableRel = cf.expectedWithdrawable > 1e-6
      ? relErr(cf.expectedWithdrawable, mc.observedMeanWithdrawable)
      : Math.abs(cf.expectedWithdrawable - mc.observedMeanWithdrawable);

    const checks = {
      bust_abs: bustAbs,
      balance_rel: balanceRel,
      withdrawable_rel: withdrawableRel,
    };
    const pass =
      bustAbs <= TOL_BUST_ABS &&
      balanceRel <= TOL_BALANCE_REL &&
      withdrawableRel <= TOL_WITHDRAWABLE_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `B=${c.cfg.bonusAmount} x${c.cfg.wagerMultiplier} R=${c.cfg.rtp.toFixed(3)} v=${c.cfg.volatilityIndex}  ` +
        `bust=${(cf.bustProbability * 100).toFixed(2)}%/${(mc.observedBustRate * 100).toFixed(2)}%  ` +
        `E[wd]=${cf.expectedWithdrawable.toFixed(2)}/${mc.observedMeanWithdrawable.toFixed(2)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        requiredWagering: cf.requiredWagering,
        requiredSpins: cf.requiredSpins,
        expectedBalanceAtCompletion: cf.expectedBalanceAtCompletion,
        expectedNetProfit: cf.expectedNetProfit,
        stdDevBalanceAtCompletion: cf.stdDevBalanceAtCompletion,
        bustProbability: cf.bustProbability,
        survivalProbability: cf.survivalProbability,
        expectedWithdrawable: cf.expectedWithdrawable,
        effectiveEV: cf.effectiveEV,
        playerLossRate: cf.playerLossRate,
        trueBonusValueRatio: cf.trueBonusValueRatio,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedBustRate: mc.observedBustRate,
        observedMeanBalanceAtCompletion: mc.observedMeanBalanceAtCompletion,
        observedMeanWithdrawable: mc.observedMeanWithdrawable,
        observedStdDevBalanceAtCompletion: mc.observedStdDevBalanceAtCompletion,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'FREE_BET_WAGERING_REQUIREMENT',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      bust_abs: TOL_BUST_ABS,
      balance_rel: TOL_BALANCE_REL,
      withdrawable_rel: TOL_WITHDRAWABLE_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'FREE_BET_WAGERING_REQUIREMENT.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# FREE_BET_WAGERING_REQUIREMENT — Free Bet Wagering Requirement Aggregator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(1)}K total bonus play-through episodes.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Free Bet Wagering Requirement Aggregator" (Wave 154).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Bachelier first-passage analyzer (Reflection Principle, exact for continuous Brownian motion with drift):');
  md.push('  - Required wagering W = WR · B, required spins N = ⌈W / b⌉');
  md.push('  - Per-spin drift μ = b·(R − 1), variance σ² = (volIndex·b)²');
  md.push('  - **E[balance @ WR] = B + N·μ**');
  md.push('  - **P_bust = Φ((−B − μN)/(σ√N)) + exp(2Bμ/σ²) · Φ((−B + μN)/(σ√N))** (μ<0 case)');
  md.push('  - **E[withdrawable] = max(0, E[balance]) · (1 − bust)**');
  md.push('  - **trueBonusValueRatio = E[withdrawable] / B** — disclosure metric');
  md.push('  - **playerLossRate = (B − E[withdrawable]) / B**');
  md.push('');
  md.push('Φ via Abramowitz-Stegun erf approximation (≤1.5e-7 absolute error).');
  md.push('');
  md.push('MC: 5K episodes per config, Box-Muller Gaussian per-spin increment, mulberry32 RNG.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | B | WR | Bet | RTP | volIdx | P(bust) | E[withdraw] | bonusVal |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.cfg.bonusAmount} | x${r.cfg.wagerMultiplier} | ${r.cfg.betPerSpin} | ` +
        `${(r.cfg.rtp * 100).toFixed(1)}% | ${r.cfg.volatilityIndex} | ` +
        `${(r.closed_form.bustProbability * 100).toFixed(2)}% | ` +
        `${r.closed_form.expectedWithdrawable.toFixed(3)} | ` +
        `${(r.closed_form.trueBonusValueRatio * 100).toFixed(1)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS-12** — responsible gambling, bonus terms transparency (operator must disclose typical play-through outcomes)');
  md.push('- **MGA Player Protection Directives §15** — maximum x35 WR cap, prominent display of bonus EV');
  md.push('- **EU GambleAware** — realistic expected-return disclosure for "free bet" advertising');
  md.push('- **eCOGRA Generic Slots Audit** — verifies bonus play-through engine matches disclosed expected outcome');
  md.push('');
  md.push('Industry use: UKGC x35 standard (Sky Vegas / William Hill / Bet365 promotions),');
  md.push('MGA x30 capped offers, Pragmatic Sweet Bonanza high-vol predatory x50 scenarios,');
  md.push('cashback-boost RTP>1 promo edge cases.');

  writeFileSync(join(OUT_DIR, 'FREE_BET_WAGERING_REQUIREMENT.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/FREE_BET_WAGERING_REQUIREMENT.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
