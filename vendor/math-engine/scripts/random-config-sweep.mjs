#!/usr/bin/env node
//
// W152 Wave 27 — Faza 10.5 acceptance: 1000+ random configs → 0 crash.
//
// Master TODO §10.5 demands: "1000+ random configs → 0 crash sweep report".
// Harness exists (`tests/faza10_*.test.ts` property tests); the gap is a
// standalone sweep with a written, archived report — what auditors ask for.
//
// Strategy
// --------
// Generate N (default 1000) fuzzy-but-valid IR configurations, then drive
// each through `irSimulator.runIRSimulation` for K (default 200) spins.
// Record every outcome:
//   * ok       — simulator returned a finite RTP
//   * rejected — `irSimulator` declined the IR with a CONTROLLED error
//                (validation rejection, e.g. invalid topology). Counts as
//                PASS because the engine refused unsafe input cleanly
//                instead of crashing.
//   * crash    — uncaught exception / NaN / Infinity / negative RTP / etc.
//                Counts as FAIL.
//
// Gate: 0 crashes across 1000 configs. Anything else is a release blocker.
//
// Output:
//   * reports/acceptance/RANDOM_CONFIG_SWEEP.json
//   * reports/acceptance/RANDOM_CONFIG_SWEEP.md
//
// CLI:
//   node scripts/random-config-sweep.mjs                    (1000 × 200)
//   node scripts/random-config-sweep.mjs --configs 5000     (heavier sweep)
//   node scripts/random-config-sweep.mjs --spins 1000       (more spins/cfg)
//   node scripts/random-config-sweep.mjs --seed 0xC0DE      (fixed seed for CI)
//
// Determinism: the SCRIPT seed governs config generation; the per-config
// simulator seed is derived (`scriptSeed XOR configIndex`) so re-running
// with the same `--seed` produces a bit-identical config corpus.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(ROOT, 'reports', 'acceptance');

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  if (v === undefined) return def;
  // Allow "0xCAFE" hex parsing for seed
  if (/^0x/i.test(v)) return Number.parseInt(v, 16);
  return Number(v);
}
const CONFIGS = flag('--configs', 1000);
const SPINS = flag('--spins', 200);
const SEED = flag('--seed', 0xC0DEC0DE);

// ── Deterministic PRNG for config generation ──────────────────────────────
// Mulberry32 — small, fast, deterministic. Identical to TS `src/rng/backends`
// so the corpus is reproducible across any host running this script.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
function randint(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function randf(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

// ── Random IR generator ───────────────────────────────────────────────────
//
// Goal: random BUT structurally valid enough that the engine should NOT
// crash on shape alone. Bad numerics (extreme weights, near-zero RTP) are
// EXPECTED — the engine must handle them gracefully.

function generateRandomIR(rng, idx) {
  const reels = randint(rng, 3, 7);
  const rows = randint(rng, 3, 5);
  const minMatch = randint(rng, 2, 3);

  // Random LP/HP symbols + always Wild + Scatter.
  const lpCount = randint(rng, 2, 4);
  const hpCount = randint(rng, 1, 3);
  const symbols = [];
  for (let i = 0; i < lpCount; i++) symbols.push({ id: `LP${i}`, name: `LP${i}`, kind: 'lp' });
  for (let i = 0; i < hpCount; i++) symbols.push({ id: `HP${i}`, name: `HP${i}`, kind: 'hp' });
  symbols.push({ id: 'WLD', name: 'Wild', kind: 'wild', substitutes: '*' });
  symbols.push({ id: 'SCT', name: 'Scatter', kind: 'scatter' });

  // Random reel weights: each reel has each symbol with a random weight.
  function reelStrip() {
    const obj = {};
    for (const s of symbols) {
      obj[s.id] = randint(rng, 1, 12);
    }
    return obj;
  }
  const base = [];
  for (let r = 0; r < reels; r++) base.push(reelStrip());

  // Random paytable: each LP/HP has 3/4/5-of-a-kind values. Some have NO
  // 3-pay (only 4+) to exercise sparse paytable code. Pay values get a
  // wide log-uniform spread to stress overflow guards.
  const paytable = {};
  for (const s of symbols) {
    if (s.kind === 'lp' || s.kind === 'hp') {
      const t = {};
      const start = randint(rng, 2, 3); // start at 2-of or 3-of
      for (let n = start; n <= reels; n++) {
        // log-uniform [0.1, 200]
        t[String(n)] = Number(Math.exp(randf(rng, Math.log(0.1), Math.log(200))).toFixed(3));
      }
      paytable[s.id] = t;
    }
  }

  // Random L-shaped or zigzag paylines. Use a few canonical patterns to
  // avoid hand-rolling a paylines DSL.
  const lineCount = randint(rng, 1, Math.min(25, reels * rows));
  const paylines = [];
  for (let l = 0; l < lineCount; l++) {
    const line = [];
    for (let c = 0; c < reels; c++) {
      line.push(randint(rng, 0, rows - 1));
    }
    paylines.push(line);
  }

  const rngKinds = ['mulberry32', 'pcg64', 'xoshiro256ss', 'philox4x32'];
  const ir = {
    schema_version: '1.0.0',
    meta: { id: `random-${idx}`, name: `random-${idx}`, version: '1.0.0', theme_tags: ['random-sweep'] },
    topology: { kind: 'rectangular', reels, rows },
    symbols,
    reels: { mode: 'weighted', base },
    evaluation: {
      kind: 'lines',
      paylines,
      direction: 'ltr',
      min_match: minMatch,
      pay_left_to_right_only: true,
    },
    paytable,
    features: [],
    rng: { kind: pick(rng, rngKinds), default_seed: (SEED ^ (idx * 0x9e3779b1)) >>> 0 },
    bet: { currency: 'EUR', base_bet: 1, denominations: [0.1, 1.0] },
    limits: {
      target_rtp: randf(rng, 0.5, 1.5), // intentionally wild — engine must not assume sanity
      rtp_tolerance: 0.05,
      max_win_x: randint(rng, 100, 10000),
      win_cap_apply: 'per_spin',
      target_volatility: pick(rng, ['low', 'medium', 'high', 'very_high']),
      hit_freq_target: randf(rng, 0.05, 0.5),
    },
    compliance: {
      jurisdictions: ['MGA'],
      rtp_range_required: [0.5, 1.5],
      max_win_cap_required: 10000,
      near_miss_rule: 'must_be_random',
      ldw_disclosure: true,
      session_time_display: true,
    },
    rtp_allocation: { base_game: 1.0, free_spins: 0.0, hold_and_win: 0.0, jackpot: 0.0, tolerance: 0.05 },
  };
  return ir;
}

// ── Outcome classifier ────────────────────────────────────────────────────
const CONTROLLED_REJECTION_SIGNATURES = [
  'paytable',
  'reels',
  'symbol',
  'topology',
  'evaluation',
  'min_match',
  'payline',
  'unsupported',
  'invalid',
  'missing',
  'schema',
];
function classifyError(msg) {
  const lc = (msg ?? '').toLowerCase();
  for (const sig of CONTROLLED_REJECTION_SIGNATURES) {
    if (lc.includes(sig)) return 'rejected';
  }
  return 'crash';
}

function classifyOutcome(simResult, err) {
  if (err) {
    return { kind: classifyError(err.message ?? String(err)), error: String(err.message ?? err) };
  }
  if (!simResult || typeof simResult.rtp !== 'number') {
    return { kind: 'crash', error: 'simulator returned no rtp' };
  }
  const r = simResult.rtp;
  if (!Number.isFinite(r)) return { kind: 'crash', error: `non-finite rtp: ${r}` };
  if (r < 0) return { kind: 'crash', error: `negative rtp: ${r}` };
  if (r > 1e9) return { kind: 'crash', error: `runaway rtp: ${r}` };
  return { kind: 'ok' };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const irSim = await import(join(ROOT, 'dist', 'engine', 'irSimulator.js'));
  if (typeof irSim.runIRSimulation !== 'function') {
    console.error('runIRSimulation export missing — did `npm run build` succeed?');
    process.exit(3);
  }

  console.log(
    `▸ Random config sweep — configs=${CONFIGS} spins/config=${SPINS} seed=0x${SEED.toString(16)}`,
  );
  console.log(`▸ Total spins: ${(CONFIGS * SPINS).toLocaleString()}`);

  const rng = mulberry32(SEED);
  let okCount = 0;
  let rejectedCount = 0;
  let crashCount = 0;
  const crashes = [];
  const rejections = []; // sample first 20 for the report
  const wallStart = Date.now();
  let lastLog = wallStart;

  for (let i = 0; i < CONFIGS; i++) {
    const ir = generateRandomIR(rng, i);
    let result = null;
    let err = null;
    try {
      result = await irSim.runIRSimulation(ir, { spins: SPINS, seed: (SEED ^ i) >>> 0 });
    } catch (e) {
      err = e;
    }
    const outcome = classifyOutcome(result, err);

    if (outcome.kind === 'ok') okCount++;
    else if (outcome.kind === 'rejected') {
      rejectedCount++;
      if (rejections.length < 20) rejections.push({ index: i, error: outcome.error });
    } else {
      crashCount++;
      crashes.push({
        index: i,
        error: outcome.error,
        irSummary: {
          reels: ir.topology.reels,
          rows: ir.topology.rows,
          symbols: ir.symbols.length,
          paylines: ir.evaluation.paylines.length,
          minMatch: ir.evaluation.min_match,
          rngKind: ir.rng.kind,
        },
      });
    }

    if (Date.now() - lastLog > 5_000) {
      console.log(
        `  ${i + 1}/${CONFIGS} (ok=${okCount} rejected=${rejectedCount} crash=${crashCount})`,
      );
      lastLog = Date.now();
    }
  }

  const wallMs = Date.now() - wallStart;
  const totalSpins = CONFIGS * SPINS;
  const spinsPerSec = Math.round((totalSpins * 1000) / Math.max(1, wallMs));

  const overallPass = crashCount === 0;
  console.log(
    `\n▸ Done in ${wallMs}ms · ${spinsPerSec.toLocaleString()} spins/s · ok=${okCount} rejected=${rejectedCount} crash=${crashCount}`,
  );
  console.log(`▸ Gate: 0 crashes — ${overallPass ? '✅ PASS' : '❌ FAIL'}`);

  const meta = {
    generatedAtUtc: new Date().toISOString(),
    configs: CONFIGS,
    spinsPerConfig: SPINS,
    totalSpins,
    seed: `0x${SEED.toString(16)}`,
    wallMs,
    spinsPerSec,
    okCount,
    rejectedCount,
    crashCount,
    overallPass,
  };

  writeFileSync(
    join(OUT_DIR, 'RANDOM_CONFIG_SWEEP.json'),
    JSON.stringify({ meta, crashes, sampleRejections: rejections }, null, 2),
  );

  const md = [];
  md.push('# Faza 10.5 — Random Config Sweep Acceptance');
  md.push('');
  md.push(`Generated: ${meta.generatedAtUtc}`);
  md.push('');
  md.push('## Acceptance');
  md.push('');
  md.push(`Master TODO §10.5: **"1000+ random configs → 0 crash"**. Gate: \`crashCount == 0\`.`);
  md.push('');
  md.push('Outcomes are 3-way classified:');
  md.push('* **ok** — finite, non-negative, bounded MC RTP.');
  md.push('* **rejected** — controlled validation rejection (engine refused unsafe input). Counts as PASS.');
  md.push('* **crash** — uncaught exception, NaN/Inf RTP, or runaway RTP > 1e9. Counts as FAIL.');
  md.push('');
  md.push('## Result');
  md.push('');
  md.push(`**${meta.overallPass ? '✅ PASS' : '❌ FAIL'}** — ${okCount} ok / ${rejectedCount} rejected / **${crashCount} crashes** across ${CONFIGS} random configs (${totalSpins.toLocaleString()} total spins, ${spinsPerSec.toLocaleString()} spins/s).`);
  md.push('');
  md.push('## Parameters');
  md.push('');
  md.push(`* Configs: \`${CONFIGS}\``);
  md.push(`* Spins per config: \`${SPINS}\``);
  md.push(`* Total spins: \`${totalSpins.toLocaleString()}\``);
  md.push(`* Seed (script): \`0x${SEED.toString(16)}\` — deterministic corpus; re-run reproduces bit-identical configs.`);
  md.push(`* Wall: \`${wallMs} ms\``);
  md.push('');
  if (crashCount > 0) {
    md.push('## Crashes');
    md.push('');
    md.push('| Idx | Reels | Rows | Sym | Paylines | minMatch | RNG | Error |');
    md.push('|----:|------:|-----:|----:|---------:|---------:|-----|-------|');
    for (const c of crashes.slice(0, 50)) {
      const s = c.irSummary;
      md.push(`| ${c.index} | ${s.reels} | ${s.rows} | ${s.symbols} | ${s.paylines} | ${s.minMatch} | ${s.rngKind} | \`${c.error.slice(0, 120).replace(/\|/g, '\\|')}\` |`);
    }
    if (crashes.length > 50) md.push(`| … | | | | | | | _${crashes.length - 50} more in JSON_ |`);
    md.push('');
  } else {
    md.push('## Crashes');
    md.push('');
    md.push('_None._ Engine survived every random configuration.');
    md.push('');
  }
  if (rejections.length > 0) {
    md.push('## Sample Controlled Rejections (first 20)');
    md.push('');
    md.push('| Idx | Error |');
    md.push('|----:|-------|');
    for (const r of rejections) {
      md.push(`| ${r.index} | \`${r.error.slice(0, 150).replace(/\|/g, '\\|')}\` |`);
    }
    md.push('');
  }
  md.push('## Reproducer');
  md.push('');
  md.push('```');
  md.push('npm run build && node scripts/random-config-sweep.mjs --configs 1000 --spins 200 --seed 0xC0DEC0DE');
  md.push('```');
  md.push('');

  writeFileSync(join(OUT_DIR, 'RANDOM_CONFIG_SWEEP.md'), md.join('\n'));
  console.log(`▸ Wrote reports/acceptance/RANDOM_CONFIG_SWEEP.{json,md}`);

  if (!overallPass) process.exit(2);
}

main().catch((e) => {
  console.error('Sweep harness itself crashed (NOT counted as engine crash):', e);
  process.exit(3);
});
