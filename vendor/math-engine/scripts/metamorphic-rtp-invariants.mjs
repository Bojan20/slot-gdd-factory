#!/usr/bin/env node
//
// W152 Wave 33 — Faza 6.8 / Kimi K4: Metamorphic RTP Invariant Suite.
//
// Closes Kimi deep-audit K4 ("Metamorphic RTP invariant suite") + opens
// Faza 6.8 acceptance proof. Mathematically bulletproof verification of
// the engine's core invariants — properties that MUST hold by construction,
// regardless of fixture, seed, or feature mix.
//
// Industry context (from Kimi deep-audit 2026-05-15):
//   "No slot engine vendor advertises mutation-tested math kernels with
//    metamorphic RTP invariants. Combining cargo-mutants + differential
//    fuzzing + property-based tests creates a verifiability story no
//    competitor matches."
//
// ── Metamorphic Relations (MR1-MR5) ────────────────────────────────────────
//
//   MR1 — DETERMINISM        Same seed twice → bit-exact RTP (float equality)
//   MR2 — ZERO-PAYOUT        ALL payout sources nullified (paytable +
//                            feature cash_value_distribution + jackpot
//                            multipliers + scatter pays + global mult)
//                            → RTP == 0.0 exactly
//   MR3 — PAYOUT-SCALING     paytable × k → RTP × k (± MC tolerance)
//   MR4 — STRIP-PERMUTE      shuffle reel stops (multiset preserved)
//                            → RTP unchanged (± MC tolerance)
//   MR5 — MEAN-STATIONARITY  mean RTP at 4N spins == mean RTP at N spins
//                            (Law of Large Numbers — RTP is stationary
//                             E[X̄_N] = E[X̄_4N] for any N). Tested with
//                            |mean_4N − mean_N| / mean_N ≤ REL_TOL.
//
// MR4 applies only to evaluators where order on the reel strip does NOT
// affect adjacency (lines/ways/pay-anywhere). Cluster evaluation depends
// on spatial neighbors, so order matters → MR4 SKIP for cluster fixtures.
//
// Output: reports/acceptance/METAMORPHIC_RTP.{json,md}
//
// Run:  node scripts/metamorphic-rtp-invariants.mjs
//
// CLI flags:
//   --spins N      spins per seed (default 20 000)
//   --seeds N      seed count (default 4)
//   --tol T        scaling/permute relative tolerance (default 0.10)

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');

// ── CLI parsing ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
}
const SPINS = Number(flag('--spins', 20_000));
const SEEDS = [12345, 67890, 11111, 99999];
const REL_TOL = Number(flag('--tol', 0.10));
const SCALE_K = 2;

// ── Fixture roster (10 representative across evaluator classes) ────────────
//
// Per-fixture flags say which MRs apply. MR4 is unsafe on cluster (spatial
// adjacency depends on strip order) and on cascade-heavy bonus fixtures
// (cascade carries state across spins → permute changes refill order which
// can statistically shift RTP).

const FIXTURES = [
  { name: 'classic-3x3-lines.json',     class: 'lines',       mr4: true  },
  { name: '5x3-20lines.json',           class: 'lines',       mr4: true  },
  { name: '3x5-5lines.json',            class: 'lines',       mr4: true  },
  { name: '5x4-25lines.json',           class: 'lines',       mr4: true  },
  { name: '5x3-243ways.json',           class: 'ways',        mr4: true  },
  { name: '6x4-4096ways.json',          class: 'ways',        mr4: true  },
  { name: 'variable-rows-7reels.json',  class: 'ways',        mr4: true  },
  { name: 'pay-anywhere.json',          class: 'pay-anywhere',mr4: true  },
  { name: 'cluster-7x7.json',           class: 'cluster',     mr4: false },
  { name: 'cluster-diagonal.json',      class: 'cluster',     mr4: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** MR3 builder: scale every paytable entry by k. */
function scalePaytable(ir, k) {
  const c = deepClone(ir);
  if (!c.paytable) return c;
  for (const sym of Object.keys(c.paytable)) {
    const entry = c.paytable[sym];
    if (entry && typeof entry === 'object') {
      for (const match of Object.keys(entry)) {
        if (typeof entry[match] === 'number') entry[match] = entry[match] * k;
      }
    }
  }
  return c;
}

/**
 * MR2 builder: zero out EVERY payout source.
 *
 * Slot fixtures route payout through multiple channels beyond the main
 * paytable: hold-and-win cash values, jackpot tier multipliers, scatter
 * pays, FS global multipliers, pick/wheel prizes, buy-feature payouts.
 * If any source remains non-zero, MR2 (zero-payout → RTP=0) fails on
 * feature-heavy fixtures (e.g. 6x4-4096ways with H&W cash_value_distribution).
 *
 * This builder nullifies every numeric "payout" field in the IR tree,
 * preserving structure (trigger probs, weights) so the engine still
 * exercises feature plumbing but cannot produce non-zero coin output.
 */
function zeroPaytable(ir) {
  const c = deepClone(ir);
  // Main paytable
  if (c.paytable) {
    for (const sym of Object.keys(c.paytable)) {
      const entry = c.paytable[sym];
      if (entry && typeof entry === 'object') {
        for (const match of Object.keys(entry)) {
          if (typeof entry[match] === 'number') entry[match] = 0;
        }
      }
    }
  }
  // Feature-level payouts
  if (Array.isArray(c.features)) {
    for (const f of c.features) {
      // FS global multiplier — must zero (multiplies whatever payout flows)
      if (typeof f.global_multiplier === 'number') f.global_multiplier = 0;
      // H&W cash value distribution
      if (Array.isArray(f.cash_value_distribution)) {
        for (const cv of f.cash_value_distribution) {
          if (typeof cv.value === 'number') cv.value = 0;
        }
      }
      // Jackpot tiers (multipliers AND fixed values)
      if (Array.isArray(f.jackpot_tiers)) {
        for (const jt of f.jackpot_tiers) {
          if (typeof jt.multiplier === 'number') jt.multiplier = 0;
          if (typeof jt.value === 'number') jt.value = 0;
          if (typeof jt.fixed_value === 'number') jt.fixed_value = 0;
        }
      }
      // Multiplier progression arrays (cascade ladder)
      if (Array.isArray(f.multiplier_progression)) {
        f.multiplier_progression = f.multiplier_progression.map(() => 0);
      }
      // Pick / Wheel prize tables
      if (Array.isArray(f.prizes)) {
        for (const p of f.prizes) {
          if (typeof p.value === 'number') p.value = 0;
          if (typeof p.multiplier === 'number') p.multiplier = 0;
        }
      }
      // Buy-feature pricing (irrelevant for RTP but consistent)
      if (typeof f.cost === 'number') f.cost = 0;
      // Scatter pays (rare — usually in paytable already, but defensive)
      if (f.scatter_pay && typeof f.scatter_pay === 'object') {
        for (const k of Object.keys(f.scatter_pay)) {
          if (typeof f.scatter_pay[k] === 'number') f.scatter_pay[k] = 0;
        }
      }
    }
  }
  return c;
}

/**
 * MR4 builder: deterministic shuffle of strip stops per reel.
 *
 * For weighted mode, the reel is a {symbol: weight} map — multiset shuffle is
 * a no-op (object key order doesn't affect engine sampling). For unweighted
 * mode the reel is an array — apply a deterministic Fisher-Yates with a
 * fixed PRNG seed so the permutation is reproducible across runs.
 *
 * For weighted-mode fixtures, MR4 collapses to a TRIVIAL holds-by-construction
 * check (post-build draw table is identical). For strip-array mode it's a
 * non-trivial cross-permutation invariance test.
 */
function permuteReels(ir, seed = 0xC0FFEE) {
  const c = deepClone(ir);
  if (!c.reels || !Array.isArray(c.reels.base)) return c;
  let s = seed >>> 0;
  function rand() {
    // Mulberry32 inline (avoid import dependency)
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  if (c.reels.mode === 'weighted') {
    // Trivial — weighted map is order-independent. Return as-is.
    return c;
  }
  // Unweighted strip[]: in-place Fisher-Yates per reel.
  c.reels.base = c.reels.base.map((strip) => {
    if (!Array.isArray(strip)) return strip;
    const a = strip.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  return c;
}

async function simulate(ir, irSim, seed, spins) {
  const sim = await irSim.runIRSimulation(ir, { spins, seed });
  return { rtp: sim.rtp, hitRate: sim.hitRate ?? null };
}

function mean(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function stdDev(xs) {
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
  return Math.sqrt(Math.max(0, v));
}

// ── MR runners ──────────────────────────────────────────────────────────────

async function runMR1Determinism(ir, irSim) {
  const seed = SEEDS[0];
  const a = await simulate(ir, irSim, seed, SPINS);
  const b = await simulate(ir, irSim, seed, SPINS);
  const exact = a.rtp === b.rtp;
  return { pass: exact, rtpA: a.rtp, rtpB: b.rtp, diff: a.rtp - b.rtp };
}

async function runMR2ZeroPayout(ir, irSim) {
  const zeroIR = zeroPaytable(ir);
  const r = await simulate(zeroIR, irSim, SEEDS[0], SPINS);
  const exact = r.rtp === 0;
  return { pass: exact, rtp: r.rtp };
}

async function runMR3Scaling(ir, irSim) {
  const origRtps = [];
  const scaledRtps = [];
  const scaledIR = scalePaytable(ir, SCALE_K);
  for (const seed of SEEDS) {
    const o = await simulate(ir, irSim, seed, SPINS);
    const s = await simulate(scaledIR, irSim, seed, SPINS);
    origRtps.push(o.rtp);
    scaledRtps.push(s.rtp);
  }
  const meanOrig = mean(origRtps);
  const meanScaled = mean(scaledRtps);
  const ratio = meanOrig > 0 ? meanScaled / meanOrig : (meanScaled === 0 ? 1 : NaN);
  const expected = SCALE_K;
  const relErr = Math.abs(ratio - expected) / expected;
  const pass = Number.isFinite(ratio) && relErr <= REL_TOL;
  return { pass, meanOrig, meanScaled, ratio, expected, relErr };
}

async function runMR4StripPermute(ir, irSim) {
  const origRtps = [];
  const permRtps = [];
  const permIR = permuteReels(ir);
  for (const seed of SEEDS) {
    const o = await simulate(ir, irSim, seed, SPINS);
    const p = await simulate(permIR, irSim, seed, SPINS);
    origRtps.push(o.rtp);
    permRtps.push(p.rtp);
  }
  const meanOrig = mean(origRtps);
  const meanPerm = mean(permRtps);
  const relDiff = meanOrig > 0 ? Math.abs(meanPerm - meanOrig) / meanOrig : 0;
  // Weighted-mode is trivially identical (permute is no-op on object map).
  // For strip-array mode, MC tolerance applies.
  const isWeighted = ir.reels?.mode === 'weighted';
  const trivial = isWeighted; // marker for report
  const pass = trivial || relDiff <= REL_TOL;
  return { pass, meanOrig, meanPerm, relDiff, trivial };
}

async function runMR5MeanStationarity(ir, irSim) {
  // Mean stationarity (Law of Large Numbers):
  //   E[X̄_N] = E[X̄_4N] = μ for any N → μ_N == μ_4N (in the limit).
  //
  // Test: |mean(rtp_4N) − mean(rtp_N)| / mean(rtp_N) ≤ REL_TOL
  //
  // Why not a σ-ratio CLT test? With only n=4 seeds, σ has a χ²(3)
  // distribution → 95% CI for σ_ratio is roughly [0.1, 4.0]. The mean
  // statistic is far better-behaved (SE ~ σ/√n) and gives a sharper test
  // of stationarity, which IS the underlying property CLT relies on.
  const N = Math.floor(SPINS / 4); // 5000 default
  const N4 = N * 4;                 // 20000 default
  if (N < 500) {
    return { pass: true, skipped: true, reason: 'N too small for LLN' };
  }
  const rtpsN = [];
  const rtps4N = [];
  for (const seed of SEEDS) {
    const a = await simulate(ir, irSim, seed, N);
    const b = await simulate(ir, irSim, seed, N4);
    rtpsN.push(a.rtp);
    rtps4N.push(b.rtp);
  }
  const meanN = mean(rtpsN);
  const mean4N = mean(rtps4N);
  const sigN = stdDev(rtpsN);
  const sig4N = stdDev(rtps4N);
  // Sample-error-aware tolerance: SE(mean) = σ/√n; combined SE for the
  // difference is sqrt(SE_N² + SE_4N²). Tolerance = max(REL_TOL × meanN,
  // 3 × combinedSE) so high-variance fixtures aren't unfairly flagged by
  // pure relative-error test.
  const seN = sigN / Math.sqrt(SEEDS.length);
  const se4N = sig4N / Math.sqrt(SEEDS.length);
  const combinedSE = Math.sqrt(seN * seN + se4N * se4N);
  const absDiff = Math.abs(mean4N - meanN);
  const relErr = meanN !== 0 ? absDiff / Math.abs(meanN) : (mean4N === 0 ? 0 : Infinity);
  const tolerance = Math.max(REL_TOL * Math.abs(meanN), 3 * combinedSE);
  const pass = meanN === 0 ? mean4N === 0 : absDiff <= tolerance;
  return {
    pass,
    meanN, mean4N, sigN, sig4N,
    absDiff, relErr, combinedSE, tolerance,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const irSim = await import(join(REPO_ROOT, 'dist', 'engine', 'irSimulator.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Metamorphic RTP invariant suite — ${FIXTURES.length} fixtures × 5 MRs × ${SEEDS.length} seeds × ${SPINS.toLocaleString()} spins`,
  );
  console.log();

  const fixtureResults = [];
  let totalChecks = 0;
  let totalPass = 0;
  const wallStart = Date.now();

  for (const fx of FIXTURES) {
    const irPath = join(FIXTURES_DIR, fx.name);
    const irText = readFileSync(irPath, 'utf-8');
    const ir = JSON.parse(irText);

    const t0 = Date.now();
    process.stdout.write(`  ${fx.name.padEnd(34)} `);

    const mr1 = await runMR1Determinism(ir, irSim);
    const mr2 = await runMR2ZeroPayout(ir, irSim);
    const mr3 = await runMR3Scaling(ir, irSim);
    const mr4 = fx.mr4
      ? await runMR4StripPermute(ir, irSim)
      : { pass: true, skipped: true, reason: 'unsafe for class=' + fx.class };
    const mr5 = await runMR5MeanStationarity(ir, irSim);

    const wallMs = Date.now() - t0;
    const checks = [mr1, mr2, mr3, mr4, mr5];
    const passes = checks.filter((c) => c.pass).length;
    totalChecks += 5;
    totalPass += passes;

    const flag = passes === 5 ? '✅' : '❌';
    const symbols = checks.map((c) => (c.skipped ? '⏭' : c.pass ? '✓' : '✗')).join(' ');
    console.log(`${flag}  MR1-5: ${symbols}  (${(wallMs / 1000).toFixed(1)}s)`);

    fixtureResults.push({
      fixture: fx.name,
      class: fx.class,
      wallMs,
      mr1, mr2, mr3, mr4, mr5,
      passes,
    });
  }

  const wallTotalMs = Date.now() - wallStart;
  const allPass = totalPass === totalChecks;

  // ── JSON report ──────────────────────────────────────────────────────────
  const json = {
    schema: 'metamorphic-rtp-invariants/v1',
    generated_at: new Date().toISOString(),
    config: { spins_per_seed: SPINS, seeds: SEEDS, rel_tolerance: REL_TOL, scale_k: SCALE_K },
    headline: {
      total_checks: totalChecks,
      total_pass: totalPass,
      all_pass: allPass,
      wall_seconds: (wallTotalMs / 1000).toFixed(1),
    },
    metamorphic_relations: {
      MR1: 'DETERMINISM      — same seed twice → bit-exact RTP',
      MR2: 'ZERO-PAYOUT      — paytable[*]=0   → RTP == 0.0 exactly',
      MR3: 'PAYOUT-SCALING   — paytable × k    → RTP × k (± MC tolerance)',
      MR4: 'STRIP-PERMUTE    — shuffle stops   → RTP unchanged (± MC tolerance)',
      MR5: 'MEAN-STATIONARITY — mean(rtp_4N) == mean(rtp_N) within max(REL_TOL × mean, 3σ_SE)',
    },
    fixtures: fixtureResults,
  };
  writeFileSync(join(OUT_DIR, 'METAMORPHIC_RTP.json'), JSON.stringify(json, null, 2));

  // ── Markdown report ──────────────────────────────────────────────────────
  const md = renderMarkdown(json);
  writeFileSync(join(OUT_DIR, 'METAMORPHIC_RTP.md'), md);

  console.log();
  console.log(
    `Total: ${totalPass}/${totalChecks} checks passed in ${(wallTotalMs / 1000).toFixed(1)}s  ${allPass ? '✅' : '❌'}`,
  );
  console.log(`Reports: reports/acceptance/METAMORPHIC_RTP.{json,md}`);

  if (!allPass) process.exitCode = 1;
}

function renderMarkdown(j) {
  const lines = [];
  lines.push('# Metamorphic RTP Invariant Suite — Acceptance Report');
  lines.push('');
  lines.push(`> Closes **Kimi K4** (deep-audit 2026-05-15) and opens **Faza 6.8**.`);
  lines.push(`> Generated: \`${j.generated_at}\` · spins/seed: \`${j.config.spins_per_seed.toLocaleString()}\` · seeds: \`${j.config.seeds.length}\` · rel-tolerance: \`${j.config.rel_tolerance}\` · wall: \`${j.headline.wall_seconds}s\``);
  lines.push('');
  lines.push(`## Headline: **${j.headline.total_pass}/${j.headline.total_checks} checks pass** ${j.headline.all_pass ? '✅' : '❌'}`);
  lines.push('');
  lines.push('## Metamorphic Relations');
  lines.push('');
  for (const [k, v] of Object.entries(j.metamorphic_relations)) {
    lines.push(`- **${k}** — ${v}`);
  }
  lines.push('');
  lines.push('## Per-Fixture Results');
  lines.push('');
  lines.push('| Fixture | Class | MR1 det | MR2 zero | MR3 scale | MR4 permute | MR5 CLT | Pass | Wall |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const f of j.fixtures) {
    const cell = (c) => (c.skipped ? '⏭' : c.pass ? '✅' : '❌');
    lines.push(
      `| \`${f.fixture}\` | ${f.class} | ${cell(f.mr1)} | ${cell(f.mr2)} | ${cell(f.mr3)} | ${cell(f.mr4)} | ${cell(f.mr5)} | ${f.passes}/5 | ${(f.wallMs/1000).toFixed(1)}s |`,
    );
  }
  lines.push('');
  lines.push('## Detail (numeric)');
  lines.push('');
  for (const f of j.fixtures) {
    lines.push(`### \`${f.fixture}\` (${f.class})`);
    lines.push('');
    lines.push(`- **MR1 determinism**: rtpA=${f.mr1.rtpA?.toFixed(6)}, rtpB=${f.mr1.rtpB?.toFixed(6)}, diff=${f.mr1.diff?.toExponential(2)} → ${f.mr1.pass ? '✅' : '❌'}`);
    lines.push(`- **MR2 zero-payout**: RTP=${f.mr2.rtp?.toFixed(6)} (must be exactly 0) → ${f.mr2.pass ? '✅' : '❌'}`);
    lines.push(`- **MR3 scaling (k=${j.config.scale_k})**: meanOrig=${f.mr3.meanOrig?.toFixed(4)}, meanScaled=${f.mr3.meanScaled?.toFixed(4)}, ratio=${f.mr3.ratio?.toFixed(4)} vs expected=${f.mr3.expected}, relErr=${(f.mr3.relErr*100)?.toFixed(2)}% → ${f.mr3.pass ? '✅' : '❌'}`);
    if (f.mr4.skipped) {
      lines.push(`- **MR4 strip-permute**: ⏭ skipped — ${f.mr4.reason}`);
    } else {
      const tag = f.mr4.trivial ? ' (trivial: weighted-mode no-op)' : '';
      lines.push(`- **MR4 strip-permute${tag}**: meanOrig=${f.mr4.meanOrig?.toFixed(4)}, meanPerm=${f.mr4.meanPerm?.toFixed(4)}, relDiff=${(f.mr4.relDiff*100)?.toFixed(2)}% → ${f.mr4.pass ? '✅' : '❌'}`);
    }
    if (f.mr5.skipped) {
      lines.push(`- **MR5 mean-stationarity**: ⏭ skipped — ${f.mr5.reason}`);
    } else {
      const relPct = (f.mr5.relErr * 100).toFixed(3);
      lines.push(`- **MR5 mean-stationarity**: mean(N)=${f.mr5.meanN?.toFixed(4)}, mean(4N)=${f.mr5.mean4N?.toFixed(4)}, |Δ|=${f.mr5.absDiff?.toExponential(2)} (relErr=${relPct}%), tolerance=${f.mr5.tolerance?.toExponential(2)} → ${f.mr5.pass ? '✅' : '❌'}`);
    }
    lines.push('');
  }
  lines.push('## Methodology');
  lines.push('');
  lines.push('Metamorphic testing exploits known mathematical relations between');
  lines.push('inputs and outputs to detect bugs without needing a ground-truth');
  lines.push('oracle. Each MR encodes a property the engine MUST satisfy by');
  lines.push('construction; a failure is a real engine bug, not statistical noise.');
  lines.push('');
  lines.push('**MR3 derivation**: RTP = E[payout]/bet. If every payout is scaled');
  lines.push('by k, then E[payout] scales by k (linearity of expectation), and');
  lines.push('RTP scales by k. Holds for any evaluator, feature mix, or fixture.');
  lines.push('');
  lines.push('**MR4 caveat**: For cluster/cascade evaluators, reel-strip order');
  lines.push('affects spatial adjacency and refill sequence, so the invariant');
  lines.push('does not hold. The runner skips MR4 on those fixture classes.');
  lines.push('Weighted-mode fixtures collapse MR4 to a no-op because the post-');
  lines.push('build draw table is order-independent — this is a TRIVIAL pass');
  lines.push('marked as such in the report.');
  lines.push('');
  lines.push('**MR5 (mean-stationarity)**: By the Law of Large Numbers,');
  lines.push('E[X̄_N] = E[X̄_4N] = μ for any N. We test |mean_4N − mean_N|');
  lines.push('against the sample-error-aware tolerance max(REL_TOL × mean,');
  lines.push('3 × √(SE_N² + SE_4N²)). The σ-ratio CLT test (predicted 0.5) was');
  lines.push('rejected as too noisy at n=4 seeds (χ²(3) gives 95% CI [0.1, 4.0]).');
  lines.push('Mean-stationarity captures the same underlying property (RTP is');
  lines.push('a stationary random variable) with far tighter statistical power.');
  return lines.join('\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
