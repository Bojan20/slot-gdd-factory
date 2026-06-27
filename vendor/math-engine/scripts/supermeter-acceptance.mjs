#!/usr/bin/env node
//
// W152 Wave 51 — Supermeter state-switch acceptance.
//
// Closes Faza 12 scenario "⚠️ Supermeter state-switch" via closed-form
// vs MC validation across 6 synthetic configs covering parameter envelope.
//
// Configs:
//   A. 2-state classic (BASE/SUPER) — baseline
//   B. 3-state ladder (BASE/BOOST/SUPER) — multi-level escalation
//   C. 4-state cycle (4 modes with cyclic transitions) — periodicity stress
//   D. Asymmetric (BASE rarely visited from SUPER) — high-variance state
//   E. Near-absorbing supermeter (P[SUPER][SUPER] ≈ 0.999) — long sojourns
//   F. Symmetric uniform — sanity reference (analytical π = uniform)
//
// Procedure:
//   1. solveSupermeter for long-run π and RTP
//   2. simulateSupermeter at 500K spins, seed=12345
//   3. Verify within tolerances:
//        long-run RTP rel ≤ 1.5%
//        state proportions abs ≤ 0.01 each
//
// Plus finite-horizon at N=2000 (configs A, B): expectedRtpInN vs MC mean.
//
// Output: reports/acceptance/SUPERMETER.{json,md}

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 500_000;
const SEED = 12345;
const TOL_RTP_REL = 0.015;
const TOL_STATE_ABS = 0.01;
const FH_N = 2000;
const FH_EPISODES = 500;
const TOL_FH_REL = 0.05;

const CONFIGS = [
  {
    name: 'A_2state_classic',
    description: '2-state BASE↔SUPER, BASE=0.92 RTP, SUPER=1.10, p_up=0.02, p_down=0.10',
    cfg: {
      states: [
        { id: 'BASE', rtpPerSpin: 0.92 },
        { id: 'SUPER', rtpPerSpin: 1.10 },
      ],
      transitions: [
        { fromId: 'BASE', toId: 'BASE', probability: 0.98 },
        { fromId: 'BASE', toId: 'SUPER', probability: 0.02 },
        { fromId: 'SUPER', toId: 'BASE', probability: 0.10 },
        { fromId: 'SUPER', toId: 'SUPER', probability: 0.90 },
      ],
      initialStateId: 'BASE',
    },
    finiteHorizon: true,
  },
  {
    name: 'B_3state_ladder',
    description: '3-state ladder BASE/BOOST/SUPER (forward escalation, backward fallback)',
    cfg: {
      states: [
        { id: 'BASE', rtpPerSpin: 0.90 },
        { id: 'BOOST', rtpPerSpin: 1.00 },
        { id: 'SUPER', rtpPerSpin: 1.20 },
      ],
      transitions: [
        { fromId: 'BASE', toId: 'BASE', probability: 0.95 },
        { fromId: 'BASE', toId: 'BOOST', probability: 0.05 },
        { fromId: 'BOOST', toId: 'BASE', probability: 0.20 },
        { fromId: 'BOOST', toId: 'BOOST', probability: 0.70 },
        { fromId: 'BOOST', toId: 'SUPER', probability: 0.10 },
        { fromId: 'SUPER', toId: 'BOOST', probability: 0.30 },
        { fromId: 'SUPER', toId: 'SUPER', probability: 0.70 },
      ],
      initialStateId: 'BASE',
    },
    finiteHorizon: true,
  },
  {
    name: 'C_4state_cycle',
    description: '4-state with mixed cycles (LOW/MID/HIGH/MAX) - asymmetric transitions',
    cfg: {
      states: [
        { id: 'LOW', rtpPerSpin: 0.85 },
        { id: 'MID', rtpPerSpin: 0.95 },
        { id: 'HIGH', rtpPerSpin: 1.10 },
        { id: 'MAX', rtpPerSpin: 1.30 },
      ],
      transitions: [
        { fromId: 'LOW', toId: 'LOW', probability: 0.90 },
        { fromId: 'LOW', toId: 'MID', probability: 0.10 },
        { fromId: 'MID', toId: 'LOW', probability: 0.15 },
        { fromId: 'MID', toId: 'MID', probability: 0.75 },
        { fromId: 'MID', toId: 'HIGH', probability: 0.10 },
        { fromId: 'HIGH', toId: 'MID', probability: 0.30 },
        { fromId: 'HIGH', toId: 'HIGH', probability: 0.65 },
        { fromId: 'HIGH', toId: 'MAX', probability: 0.05 },
        { fromId: 'MAX', toId: 'HIGH', probability: 0.40 },
        { fromId: 'MAX', toId: 'MAX', probability: 0.60 },
      ],
      initialStateId: 'LOW',
    },
    finiteHorizon: false,
  },
  {
    name: 'D_asymmetric',
    description: 'Heavy SUPER bias once entered (p_down=0.005 vs p_up=0.05)',
    cfg: {
      states: [
        { id: 'BASE', rtpPerSpin: 0.85 },
        { id: 'SUPER', rtpPerSpin: 1.20 },
      ],
      transitions: [
        { fromId: 'BASE', toId: 'BASE', probability: 0.95 },
        { fromId: 'BASE', toId: 'SUPER', probability: 0.05 },
        { fromId: 'SUPER', toId: 'BASE', probability: 0.005 },
        { fromId: 'SUPER', toId: 'SUPER', probability: 0.995 },
      ],
      initialStateId: 'BASE',
    },
    finiteHorizon: false,
  },
  {
    name: 'E_near_absorbing_super',
    description: 'SUPER nearly absorbing (P[SUPER][SUPER]=0.999) — long sojourn',
    cfg: {
      states: [
        { id: 'BASE', rtpPerSpin: 0.80 },
        { id: 'SUPER', rtpPerSpin: 1.50 },
      ],
      transitions: [
        { fromId: 'BASE', toId: 'BASE', probability: 0.99 },
        { fromId: 'BASE', toId: 'SUPER', probability: 0.01 },
        { fromId: 'SUPER', toId: 'BASE', probability: 0.001 },
        { fromId: 'SUPER', toId: 'SUPER', probability: 0.999 },
      ],
      initialStateId: 'BASE',
    },
    finiteHorizon: false,
  },
  {
    name: 'F_symmetric_uniform',
    description: 'Symmetric 4-state uniform — π should be uniform 0.25 each',
    cfg: {
      states: [
        { id: 'A', rtpPerSpin: 0.92 },
        { id: 'B', rtpPerSpin: 0.96 },
        { id: 'C', rtpPerSpin: 1.00 },
        { id: 'D', rtpPerSpin: 1.04 },
      ],
      transitions: [
        { fromId: 'A', toId: 'A', probability: 0.25 },
        { fromId: 'A', toId: 'B', probability: 0.25 },
        { fromId: 'A', toId: 'C', probability: 0.25 },
        { fromId: 'A', toId: 'D', probability: 0.25 },
        { fromId: 'B', toId: 'A', probability: 0.25 },
        { fromId: 'B', toId: 'B', probability: 0.25 },
        { fromId: 'B', toId: 'C', probability: 0.25 },
        { fromId: 'B', toId: 'D', probability: 0.25 },
        { fromId: 'C', toId: 'A', probability: 0.25 },
        { fromId: 'C', toId: 'B', probability: 0.25 },
        { fromId: 'C', toId: 'C', probability: 0.25 },
        { fromId: 'C', toId: 'D', probability: 0.25 },
        { fromId: 'D', toId: 'A', probability: 0.25 },
        { fromId: 'D', toId: 'B', probability: 0.25 },
        { fromId: 'D', toId: 'C', probability: 0.25 },
        { fromId: 'D', toId: 'D', probability: 0.25 },
      ],
      initialStateId: 'A',
    },
    finiteHorizon: false,
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveSupermeter, solveSupermeterFiniteHorizon, simulateSupermeter } = await import(
    join(REPO_ROOT, 'dist', 'features', 'supermeter.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} supermeter configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const ss = solveSupermeter(c.cfg);
    const mc = simulateSupermeter(c.cfg, SPINS, SEED);

    const checks = {
      rtp_rel: relErr(ss.expectedRtpPerSpinLongRun, mc.observedRtpPerSpin),
      max_state_abs: 0,
    };
    for (const s of ss.stationaryDistribution) {
      const obs = mc.observedStateProportions[s.id] ?? 0;
      const absErr = Math.abs(obs - s.probability);
      if (absErr > checks.max_state_abs) checks.max_state_abs = absErr;
    }

    let fhBlock = null;
    if (c.finiteHorizon) {
      const fh = solveSupermeterFiniteHorizon(c.cfg, FH_N);
      let totalRtp = 0;
      for (let i = 0; i < FH_EPISODES; i++) {
        const epRes = simulateSupermeter(c.cfg, FH_N, i * 17 + 1);
        totalRtp += epRes.observedRtpPerSpin;
      }
      const mcMean = totalRtp / FH_EPISODES;
      const fhRel = relErr(fh.expectedRtpPerSpinInN, mcMean);
      fhBlock = {
        N: FH_N,
        episodes: FH_EPISODES,
        cf_expected_rtp_per_spin: fh.expectedRtpPerSpinInN,
        mc_expected_rtp_per_spin: mcMean,
        rel: fhRel,
        pass: fhRel <= TOL_FH_REL,
      };
      checks.fh_rel = fhRel;
    }

    const elapsedMs = Date.now() - t0;
    const pass =
      checks.rtp_rel <= TOL_RTP_REL &&
      checks.max_state_abs <= TOL_STATE_ABS &&
      (fhBlock ? fhBlock.pass : true);

    if (!pass) allOK = false;

    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `RTP=${ss.expectedRtpPerSpinLongRun.toFixed(4)} (MC=${mc.observedRtpPerSpin.toFixed(4)}, rel=${(checks.rtp_rel*100).toFixed(3)}%) ` +
        `state_abs=${checks.max_state_abs.toFixed(4)} ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      steady_state: {
        expectedRtpPerSpinLongRun: ss.expectedRtpPerSpinLongRun,
        stationaryDistribution: ss.stationaryDistribution,
        expectedSojournPerState: ss.expectedSojournPerState,
        expectedFirstPassageFromInitial: ss.expectedFirstPassageFromInitial,
        powerIterations: ss.powerIterations,
        residualInfNorm: ss.residualInfNorm,
        isIrreducible: ss.isIrreducible,
        isAperiodic: ss.isAperiodic,
      },
      monte_carlo: {
        observedRtpPerSpin: mc.observedRtpPerSpin,
        observedStateProportions: mc.observedStateProportions,
        observedSwitchCount: mc.observedSwitchCount,
        spins: SPINS,
      },
      finite_horizon: fhBlock,
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'SUPERMETER',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    fh_N: FH_N,
    fh_episodes: FH_EPISODES,
    tolerances: {
      rtp_rel: TOL_RTP_REL,
      state_abs: TOL_STATE_ABS,
      fh_rel: TOL_FH_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'SUPERMETER.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const md = [];
  md.push('# SUPERMETER — State-Switch Markov Chain Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Supermeter state-switch".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Power-iteration solver for stationary distribution π. Long-run RTP = Σ π_i × r_i.');
  md.push('Finite-horizon by forward propagation π_{n+1} = π_n × P.');
  md.push('First-passage expected times via standard absorbing-chain linear system.');
  md.push('Verified against Monte Carlo at 500K spins per config + finite-horizon MC averaging.');
  md.push('');
  md.push('## Tolerances');
  md.push('');
  md.push('| Metric | Tolerance |');
  md.push('|---|---|');
  md.push(`| long-run RTP | rel ≤ ${(TOL_RTP_REL * 100).toFixed(1)}% |`);
  md.push(`| state proportion | abs ≤ ${TOL_STATE_ABS} |`);
  md.push(`| finite-horizon RTP | rel ≤ ${(TOL_FH_REL * 100).toFixed(1)}% |`);
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF long-run RTP | MC RTP | rel err | max state abs |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.steady_state.expectedRtpPerSpinLongRun.toFixed(5)} | ` +
        `${r.monte_carlo.observedRtpPerSpin.toFixed(5)} | ${(r.checks.rtp_rel * 100).toFixed(3)}% | ` +
        `${r.checks.max_state_abs.toFixed(5)} |`,
    );
  }
  md.push('');
  md.push('## Stationary Distributions');
  md.push('');
  for (const r of results) {
    md.push(`### ${r.name}`);
    md.push('');
    md.push(`_${r.description}_`);
    md.push('');
    md.push('| State | π (CF) | π (MC) | rtp/spin | sojourn (spins) |');
    md.push('|---|---|---|---|---|');
    for (const s of r.steady_state.stationaryDistribution) {
      const mcProb = r.monte_carlo.observedStateProportions[s.id] ?? 0;
      const rtp = r.cfg.states.find((x) => x.id === s.id).rtpPerSpin;
      const sojourn = r.steady_state.expectedSojournPerState.find((x) => x.id === s.id).expectedSpins;
      md.push(
        `| ${s.id} | ${s.probability.toFixed(5)} | ${mcProb.toFixed(5)} | ${rtp.toFixed(3)} | ${sojourn === Infinity ? '∞' : sojourn.toFixed(1)} |`,
      );
    }
    md.push('');
  }

  writeFileSync(join(OUT_DIR, 'SUPERMETER.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/SUPERMETER.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
