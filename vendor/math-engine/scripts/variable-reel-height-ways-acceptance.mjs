#!/usr/bin/env node
//
// W152 Wave 113 — Variable Reel Height Ways acceptance (Wave 112).
//
// 6 PAR-style configs × 100K episodes each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/VARIABLE_REEL_HEIGHT_WAYS.{json,md}`.
//
// BTG Megaways patent EXPIRED 2023 — naming clean-room.
// UKGC RTS 14 + MGA PPD §11.f compliance: ways volatility disclosure.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 100_000;
const SEED_VAL = 0xBEEF77AA;
const TOL_EW_REL    = 0.02;  // expected ways
const TOL_VAR_REL   = 0.10;  // variance
const TOL_TAIL_ABS  = 0.02;  // tail prob absolute
const TOL_PMAX_REL  = 0.30;  // probMaxWays (rare event, wider rel)

// Helper: uniform reel pmf factory
function uniformReel(label, minH, maxH) {
  const n = maxH - minH + 1;
  const p = 1 / n;
  const pmf = [];
  for (let h = minH; h <= maxH; h++) pmf.push({ height: h, probability: p });
  return { label, pmf };
}

// Helper: weighted reel
function weightedReel(label, entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const pmf = entries.map((e) => ({ height: e.height, probability: e.weight / total }));
  return { label, pmf };
}

const CONFIGS = [
  {
    name: 'A_6reel_uniform_2_7_megaways_classic',
    description: 'Classic Megaways-style 6 reels, uniform heights {2..7}, max 117649 ways',
    cfg: {
      reels: [
        uniformReel('r1', 2, 7),
        uniformReel('r2', 2, 7),
        uniformReel('r3', 2, 7),
        uniformReel('r4', 2, 7),
        uniformReel('r5', 2, 7),
        uniformReel('r6', 2, 7),
      ],
      waysThresholds: [10_000, 50_000, 100_000],
    },
  },
  {
    name: 'B_6reel_weighted_skew_low',
    description: 'Same 6 reels but skewed toward low heights (commercial volatility tweak)',
    cfg: {
      reels: [
        weightedReel('r1', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
        weightedReel('r2', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
        weightedReel('r3', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
        weightedReel('r4', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
        weightedReel('r5', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
        weightedReel('r6', [{ height: 2, weight: 4 }, { height: 3, weight: 3 }, { height: 4, weight: 2 }, { height: 5, weight: 1 }, { height: 6, weight: 1 }, { height: 7, weight: 1 }]),
      ],
      waysThresholds: [5_000, 20_000, 50_000],
    },
  },
  {
    name: 'C_6reel_weighted_skew_high',
    description: '6 reels skewed toward HIGH heights (high-volatility marketing version)',
    cfg: {
      reels: [
        weightedReel('r1', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
        weightedReel('r2', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
        weightedReel('r3', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
        weightedReel('r4', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
        weightedReel('r5', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
        weightedReel('r6', [{ height: 2, weight: 1 }, { height: 3, weight: 1 }, { height: 4, weight: 1 }, { height: 5, weight: 2 }, { height: 6, weight: 3 }, { height: 7, weight: 4 }]),
      ],
      waysThresholds: [50_000, 100_000],
    },
  },
  {
    name: 'D_5reel_fixed_edge_variable_middle',
    description: 'Asymmetric: fixed outer reels (3 high), only middle reel varies — engineered edge case',
    cfg: {
      reels: [
        { label: 'r1', pmf: [{ height: 3, probability: 1 }] },
        { label: 'r2', pmf: [{ height: 3, probability: 1 }] },
        uniformReel('r3_mid', 2, 8),
        { label: 'r4', pmf: [{ height: 3, probability: 1 }] },
        { label: 'r5', pmf: [{ height: 3, probability: 1 }] },
      ],
      waysThresholds: [200, 400, 600],
    },
  },
  {
    name: 'E_4reel_dense_grid',
    description: '4 dense reels, {3..6} heavy weighting (smaller game variant)',
    cfg: {
      reels: [
        uniformReel('r1', 3, 6),
        uniformReel('r2', 3, 6),
        uniformReel('r3', 3, 6),
        uniformReel('r4', 3, 6),
      ],
      waysThresholds: [500, 1000, 1296],
    },
  },
  {
    name: 'F_deterministic_corner',
    description: 'Corner: every reel deterministic h=4 → W=1024 always',
    cfg: {
      reels: [
        { label: 'r1', pmf: [{ height: 4, probability: 1 }] },
        { label: 'r2', pmf: [{ height: 4, probability: 1 }] },
        { label: 'r3', pmf: [{ height: 4, probability: 1 }] },
        { label: 'r4', pmf: [{ height: 4, probability: 1 }] },
        { label: 'r5', pmf: [{ height: 4, probability: 1 }] },
      ],
      waysThresholds: [1024],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveVariableReelHeightWays, simulateVariableReelHeightWays } = await import(
    join(REPO_ROOT, 'dist', 'features', 'variableReelHeightWays.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Variable Reel Height Ways configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveVariableReelHeightWays(c.cfg);
    const mc = simulateVariableReelHeightWays(c.cfg, EPISODES, SEED_VAL);

    const ewRel = relErr(cf.expectedWays, mc.observedMeanWays);
    const varRel = cf.varianceWays > 0
      ? relErr(cf.varianceWays, mc.observedVarianceWays)
      : Math.abs(cf.varianceWays - mc.observedVarianceWays);

    // Tail probability absolute error (only thresholds defined in config)
    let maxTailAbs = 0;
    if (c.cfg.waysThresholds) {
      for (const t of c.cfg.waysThresholds) {
        const cfP = cf.tailProbabilities[String(t)];
        const mcP = (mc.observedTailHits[String(t)] ?? 0) / mc.episodes;
        const abs = Math.abs(cfP - mcP);
        if (abs > maxTailAbs) maxTailAbs = abs;
      }
    }

    // probMaxWays sanity (rare event — only check when cf > tiny)
    let pMaxRel = 0;
    if (cf.probMaxWays > 1e-6) {
      const mcMaxHits = mc.observedTailHits[String(cf.maxWays)] !== undefined
        ? (mc.observedTailHits[String(cf.maxWays)] / mc.episodes)
        : null;
      // If maxWays threshold is in config we can compare; otherwise skip
      if (mcMaxHits !== null) {
        pMaxRel = relErr(cf.probMaxWays, mcMaxHits);
      }
    }

    const checks = {
      ew_rel: ewRel,
      var_rel: varRel,
      max_tail_abs: maxTailAbs,
      p_max_rel: pMaxRel,
    };
    const pass =
      ewRel <= TOL_EW_REL &&
      varRel <= TOL_VAR_REL &&
      maxTailAbs <= TOL_TAIL_ABS &&
      (pMaxRel === 0 || pMaxRel <= TOL_PMAX_REL);

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `E[W]_CF=${cf.expectedWays.toFixed(1)} MC=${mc.observedMeanWays.toFixed(1)} (rel=${(ewRel * 100).toFixed(2)}%)  ` +
        `varRel=${(varRel * 100).toFixed(2)}%  tailAbs=${(maxTailAbs * 100).toFixed(2)}pp  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        reelStats: cf.reelStats,
        expectedWays: cf.expectedWays,
        varianceWays: cf.varianceWays,
        stdWays: cf.stdWays,
        minWays: cf.minWays,
        maxWays: cf.maxWays,
        probMinWays: cf.probMinWays,
        probMaxWays: cf.probMaxWays,
        tailProbabilities: cf.tailProbabilities,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanWays: mc.observedMeanWays,
        observedVarianceWays: mc.observedVarianceWays,
        observedMinObserved: mc.observedMinObserved,
        observedMaxObserved: mc.observedMaxObserved,
        observedTailHits: mc.observedTailHits,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'VARIABLE_REEL_HEIGHT_WAYS',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED_VAL,
    tolerances: {
      ew_rel: TOL_EW_REL,
      var_rel: TOL_VAR_REL,
      max_tail_abs: TOL_TAIL_ABS,
      p_max_rel: TOL_PMAX_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'VARIABLE_REEL_HEIGHT_WAYS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# VARIABLE_REEL_HEIGHT_WAYS — Megaways-Style Ways Volatility Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Variable Reel Height Ways" (Wave 112).');
  md.push('');
  md.push('## Naming policy (clean-room)');
  md.push('');
  md.push('BTG Megaways patent **EXPIRED 2023** — naming "variable reel height ways" /');
  md.push('"ways count" / "reel modifier" is generic industry terminology. No vendor TM.');
  md.push('Pragmatic, Blueprint, iSoftBet, Stakelogic ship this pattern under various brands.');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Per-reel H_i ~ discrete pmf, ways count W = Π_i H_i (cross-reel independence).');
  md.push('');
  md.push('Closed-form moments:');
  md.push('  - E[W] = Π_i E[H_i]');
  md.push('  - E[W²] = Π_i E[H_i²]');
  md.push('  - Var[W] = E[W²] − E[W]²');
  md.push('');
  md.push('Tail (operator "epic ways" marketing-claim disclosure):');
  md.push('  - maxWays = Π_i max(supp(H_i))');
  md.push('  - probMaxWays = Π_i P(H_i = max)');
  md.push('  - P(W ≥ threshold) via PMF aggregation');
  md.push('');
  md.push('MC: 100K episodes per config, mulberry32 RNG, per-reel inverse-CDF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[W]_CF | E[W]_MC | rel | maxWays | P(max) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedWays.toFixed(1)} | ` +
        `${r.monte_carlo.observedMeanWays.toFixed(1)} | ` +
        `${(r.checks.ew_rel * 100).toFixed(2)}% | ` +
        `${r.closed_form.maxWays} | ` +
        `${(r.closed_form.probMaxWays * 100).toFixed(4)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — variance + tail-probability disclosure (ways distribution must be auditable)');
  md.push('- **MGA PPD §11.f** — operator-facing ways volatility disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies E[W] / Var[W] match engine');
  md.push('- Industry use: Pragmatic Megaways slots, Blueprint Megaways, iSoftBet Megaways,');
  md.push('  Stakelogic Megaways, hundreds of licensed Big Time Gaming Megaways titles.');

  writeFileSync(join(OUT_DIR, 'VARIABLE_REEL_HEIGHT_WAYS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/VARIABLE_REEL_HEIGHT_WAYS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
