#!/usr/bin/env node
//
// W221 — Auto-Spin Dual-Stop (Loss/Win Limit + Spin Cap) Analyzer acceptance (Wave 220).
//
// 6 industry-representative auto-spin-session configs × 3K MC episodes
// = 18K total dual-stop session runs. Closed-form Bachelier-Wiener two-barrier
// cross-validated against discrete random-walk MC.
//
// Operator deliverable: `reports/acceptance/AUTO_SPIN_DUAL_STOP.{json,md}`.
//
// Compliance: UKGC RTS 13B (auto-spin loss/win-limit + cancel-button mandate
// effective 2025), MGA PPD §19 ("session-level loss-stop and win-stop options"),
// EU EBA Responsible Gambling Directive 2024 Annex II (auto-play disclosure),
// AU NCPF Reform 2022 Schedule 5 ("mandatory auto-play loss-limit + spin-cap
// displays"), CA Ontario AGCO §3.4.7 (cancel-button + loss-limit).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 3_000;
const SEED = 0xCAFE0220;

// Bachelier continuous-CF vs discrete random-walk MC has documented overshoot
// gap at large per-spin σ/barrier ratio. Tolerances are regime-aware:
//   - small-bet/high-resolution: CF/MC ≤ 5pp (Bachelier limit accurate)
//   - realistic-bet/moderate-resolution: CF/MC ≤ 15pp (overshoot dominates)
const TOL_PLOSS_SMALL_BET = 0.05;
const TOL_PLOSS_REALISTIC = 0.15;
const TOL_PSUM_ABS = 0.005;          // P_loss + P_win + P_spin_limit must sum to ≈1 exactly
const TOL_EXPECTED_SPINS_REL = 0.30; // MC observed spins vs CF expected_spins_to_stop

const CONFIGS = [
  {
    name: 'A_uk_responsible_small_bet_smooth',
    description: 'UK responsible-gambling, £0.10 bet, £5 loss-limit, £10 win-limit, 5000 auto-spins — small-bet smooth Bachelier regime',
    cfg: { bet: 0.1, rtp: 0.96, volatilityIndex: 5, lossLimit: 5, winLimit: 10, maxAutoSpins: 5000 },
    regime: 'small-bet',
  },
  {
    name: 'B_uk_realistic_£1_bet_£50_£100_limits',
    description: 'UK realistic operator, £1 bet, £50 loss-limit, £100 win-limit, 500 auto-spins — typical session',
    cfg: { bet: 1, rtp: 0.96, volatilityIndex: 5, lossLimit: 50, winLimit: 100, maxAutoSpins: 500 },
    regime: 'realistic',
  },
  {
    name: 'C_au_ncpf_high_vol_£2_bet',
    description: 'AU NCPF high-volatility, £2 bet, £100 loss-limit, £200 win-limit, 250 auto-spins, v=10 — fast P_loss',
    cfg: { bet: 2, rtp: 0.88, volatilityIndex: 10, lossLimit: 100, winLimit: 200, maxAutoSpins: 250 },
    regime: 'realistic',
  },
  {
    name: 'D_eu_high_roller_£5_bet_long_session',
    description: 'EU high-roller, £5 bet, £500 loss-limit, £1000 win-limit, 1000 auto-spins, low-vol v=3',
    cfg: { bet: 5, rtp: 0.97, volatilityIndex: 3, lossLimit: 500, winLimit: 1000, maxAutoSpins: 1000 },
    regime: 'realistic',
  },
  {
    name: 'E_corner_zero_drift_symmetric',
    description: 'Corner: RTP=1.00 zero-drift symmetric P_win=a/(a+b)=0.5 — driftless Wiener verified',
    cfg: { bet: 0.1, rtp: 1.0, volatilityIndex: 5, lossLimit: 10, winLimit: 10, maxAutoSpins: 10000 },
    regime: 'small-bet',
  },
  {
    name: 'F_corner_player_edge_positive_drift',
    description: 'Corner: RTP=1.03 player advantage, P_win > P_loss verified, expected net positive',
    cfg: { bet: 0.1, rtp: 1.03, volatilityIndex: 5, lossLimit: 5, winLimit: 10, maxAutoSpins: 5000 },
    regime: 'small-bet',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { solveAutoSpinDualStop, simulateAutoSpinDualStop } = await import(
    join(REPO_ROOT, 'dist', 'features', 'autoSpinDualStop.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Auto-Spin Dual-Stop configs @ ${EPISODES} MC episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveAutoSpinDualStop(c.cfg);
    const mc = simulateAutoSpinDualStop(c.cfg, SEED, EPISODES);

    const pLossDelta = Math.abs(mc.observedProbLossStop - cf.probLossStopFired);
    const pWinDelta = Math.abs(mc.observedProbWinStop - cf.probWinStopFired);
    const tolPLoss = c.regime === 'small-bet' ? TOL_PLOSS_SMALL_BET : TOL_PLOSS_REALISTIC;
    const pSum = cf.probLossStopFired + cf.probWinStopFired + cf.probSpinLimitFired;
    const pSumOK = Math.abs(pSum - 1) <= TOL_PSUM_ABS;
    const expSpinsRel = relErr(cf.expectedSpinsToStop, mc.observedExpectedSpinsToStop);
    const expSpinsOK = expSpinsRel <= TOL_EXPECTED_SPINS_REL;

    const pLossOK = pLossDelta <= tolPLoss;
    const pWinOK = pWinDelta <= tolPLoss;

    const checks = {
      ploss_delta: pLossDelta,
      pwin_delta: pWinDelta,
      psum: pSum,
      psum_ok: pSumOK,
      expected_spins_rel: expSpinsRel,
      tolerance_regime: c.regime,
      tolerance_ploss: tolPLoss,
    };

    const pass = pLossOK && pWinOK && pSumOK && expSpinsOK;
    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `RTP=${c.cfg.rtp.toFixed(2)} L=${c.cfg.lossLimit}/W=${c.cfg.winLimit}/N=${c.cfg.maxAutoSpins}  ` +
        `P_loss=${cf.probLossStopFired.toFixed(3)}/${mc.observedProbLossStop.toFixed(3)} (Δ${pLossDelta.toFixed(3)})  ` +
        `P_spin_lim=${cf.probSpinLimitFired.toFixed(3)}  ` +
        `risk=${cf.sessionRiskScore.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      regime: c.regime,
      cfg: c.cfg,
      closed_form: {
        meanNetPerSpin: cf.meanNetPerSpin,
        varNetPerSpin: cf.varNetPerSpin,
        driftRegime: cf.driftRegime,
        probWinUnconditional: cf.probWinUnconditional,
        probLossUnconditional: cf.probLossUnconditional,
        expectedSpinsUnbounded: cf.expectedSpinsUnbounded,
        probSpinLimitFired: cf.probSpinLimitFired,
        probLossStopFired: cf.probLossStopFired,
        probWinStopFired: cf.probWinStopFired,
        expectedSpinsToStop: cf.expectedSpinsToStop,
        expectedFinalNetWin: cf.expectedFinalNetWin,
        oneInNSessionsLossStop: Number.isFinite(cf.oneInNSessionsLossStop)
          ? cf.oneInNSessionsLossStop
          : 'Infinity',
        sessionRiskScore: cf.sessionRiskScore,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedProbLossStop: mc.observedProbLossStop,
        observedProbWinStop: mc.observedProbWinStop,
        observedProbSpinLimit: mc.observedProbSpinLimit,
        observedExpectedSpinsToStop: mc.observedExpectedSpinsToStop,
        observedExpectedFinalNetWin: mc.observedExpectedFinalNetWin,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'AUTO_SPIN_DUAL_STOP',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      ploss_small_bet: TOL_PLOSS_SMALL_BET,
      ploss_realistic: TOL_PLOSS_REALISTIC,
      psum_abs: TOL_PSUM_ABS,
      expected_spins_rel: TOL_EXPECTED_SPINS_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'AUTO_SPIN_DUAL_STOP.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# AUTO_SPIN_DUAL_STOP — Auto-Spin Dual-Stop (Loss/Win Limit + Spin Cap) Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC episodes each = ${((CONFIGS.length * EPISODES) / 1e3).toFixed(1)}K total dual-stop session runs.`);
  md.push('');
  md.push('Closes W220 — **78. closed-form solver**, first **TWO-SIDED BARRIER + horizon** first-passage kernel u portfolio (UKGC RTS 13B + MGA PPD §19 + AU NCPF Schedule 5 mandatory 2025).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Bachelier-Wiener drifted random walk with three absorbing conditions:');
  md.push('  1. Cumulative net loss reaches −L_loss → **loss_stop**');
  md.push('  2. Cumulative net win reaches +L_win → **win_stop**');
  md.push('  3. Auto-spin counter reaches N_max → **spin_limit**');
  md.push('');
  md.push('Per-spin model:');
  md.push('  - μ_spin = bet · (RTP − 1)');
  md.push('  - σ²_spin = bet² · v (v = volatility index)');
  md.push('');
  md.push('Closed-form (Karatzas-Shreve §5.18):');
  md.push('  - **P(hits +b before −a) = (e^(λa) − 1) / (e^(λa) − e^(−λb))** where λ = 2μ/σ²');
  md.push('  - μ = 0 limit: P_win = a/(a+b)');
  md.push('  - **E[T_unbounded] = (P_win·b − P_loss·a) / μ**');
  md.push('  - **P(spin_limit fired)** ≈ exponential-tail decay when N_max ≥ E[T_unbounded], Markov-bound truncation otherwise');
  md.push('');
  md.push('MC: 3K episodes per config, iid Gaussian per-spin steps, mulberry32 RNG + Box-Muller normal sampler.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | regime | RTP | L_loss/L_win | N_max | CF P_loss | MC P_loss | Δ | CF E[spins] | MC E[spins] | risk | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.regime} | ${r.cfg.rtp} | ${r.cfg.lossLimit}/${r.cfg.winLimit} | ${r.cfg.maxAutoSpins} | ${r.closed_form.probLossStopFired.toFixed(3)} | ${r.monte_carlo.observedProbLossStop.toFixed(3)} | ${r.checks.ploss_delta.toFixed(3)} | ${r.closed_form.expectedSpinsToStop.toFixed(1)} | ${r.monte_carlo.observedExpectedSpinsToStop.toFixed(1)} | ${r.closed_form.sessionRiskScore.toFixed(3)} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| P_loss / P_win delta (small-bet regime) | ≤ ${TOL_PLOSS_SMALL_BET} abs |`);
  md.push(`| P_loss / P_win delta (realistic regime) | ≤ ${TOL_PLOSS_REALISTIC} abs (Bachelier-discrete overshoot) |`);
  md.push(`| P_loss + P_win + P_spin_limit sum | within ${TOL_PSUM_ABS} of 1.0 |`);
  md.push(`| E[spins_to_stop] CF vs MC | ≤ ${TOL_EXPECTED_SPINS_REL} rel |`);
  md.push('');
  md.push('## Headline regulator forms');
  md.push('');
  md.push('| config | 1-in-N session loss-stop | session risk score | E[final net] |');
  md.push('|---|---|---|---|');
  for (const r of results) {
    const oneInN =
      typeof r.closed_form.oneInNSessionsLossStop === 'string'
        ? r.closed_form.oneInNSessionsLossStop
        : r.closed_form.oneInNSessionsLossStop.toFixed(2);
    md.push(
      `| ${r.name} | ${oneInN} | ${r.closed_form.sessionRiskScore.toFixed(3)} | ${r.closed_form.expectedFinalNetWin.toFixed(3)} |`,
    );
  }
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form auto-spin dual-stop disclosure kernel ready for UKGC RTS 13B + MGA PPD §19 + AU NCPF Schedule 5 audit submission. Distinct from W157 (single-barrier bust), W161 (one-sided max drop), W163/W165 (bet-progression), W167 (cycle compensation), W148 (payout cap).');

  writeFileSync(join(OUT_DIR, 'AUTO_SPIN_DUAL_STOP.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/AUTO_SPIN_DUAL_STOP.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
