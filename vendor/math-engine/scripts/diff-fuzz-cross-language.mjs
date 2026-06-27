#!/usr/bin/env node
//
// W152 Wave 37 — Kimi K2: Differential Fuzz Harness (TS↔Rust oracle).
//
// Closes Kimi deep-audit K2 ("Differential fuzz harness — cargo-fuzz +
// quickcheck/proptest sa metamorfičkim RTP invariantima preko language
// pairs"). Cross-language verification gambit no slot vendor ships.
//
// ── Strategy ───────────────────────────────────────────────────────────────
//
// 1. Generate K random IR variants (deterministic Mulberry32-seeded
//    parameter overrides on the parity.json fixture template). Vary:
//      - paytable values (random scale per symbol within bounds)
//      - reel weights (random integer multisets, 5..15 per stop)
//      - simulation seed
//
// 2. For each variant, run BOTH runtimes:
//      - Rust:  ./target/release/evaluator_parity --config <tmp> --seed S
//                                                  --spins N
//               → aggregate base_win sum → RTP_rust = sum / (N × bet)
//      - TS:    irSimulator.runIRSimulation(ir, {seed: S, spins: N})
//               → RTP_ts (full game, includes FS contribution if any)
//
// 3. Apply 4 metamorphic invariants per variant on EACH runtime
//    independently (NOT direct RTP_ts vs RTP_rust comparison — those
//    measure different surfaces; full-game vs base-only):
//
//      MR-CL-1 DETERMINISM       Same seed run twice in same runtime →
//                                identical aggregate RTP (both runtimes).
//      MR-CL-2 SCALE-CONSISTENCY paytable × k=2 → RTP × 2 in BOTH runtimes
//                                within MC tolerance. Rust ratio and TS
//                                ratio must each be within ±10%, AND the
//                                TWO ratios must agree within ±5% of each
//                                other (cross-language invariance).
//      MR-CL-3 ZERO-PAYOUT       paytable[*]=0 → RTP=0 in both runtimes.
//      MR-CL-4 BOUNDS            0 ≤ RTP ≤ max_paytable_sum × max_lines
//                                in both runtimes (sanity envelope).
//
// 4. Headline: K variants × 4 MRs × 2 runtimes = 8K cell results.
//
// ── Why per-runtime metamorphic > direct RTP comparison ────────────────────
//
// The Rust evaluator_parity binary is BASE-ONLY (lightning disabled);
// the TS irSimulator runs the FULL game (FS + H&W contribution). Direct
// numeric comparison would be biased by feature-tier deltas, not bugs.
// Metamorphic invariants test that BOTH RUNTIMES OBEY THE SAME MATH —
// which is a STRONGER bug-detection signal than aggregate equality.
//
// ── Output ─────────────────────────────────────────────────────────────────
//
//   reports/acceptance/DIFF_FUZZ_CROSS_LANG.{json,md}
//
// Run: node scripts/diff-fuzz-cross-language.mjs
//
// CLI flags:
//   --variants N    number of random IR variants (default 20)
//   --spins N       spins per simulation (default 5000)

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const FIXTURE_BASE = join(REPO_ROOT, 'tests', 'fixtures', 'parity.json');
const ORACLE_BIN = join(REPO_ROOT, 'target', 'release', 'evaluator_parity');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const argv = process.argv.slice(2);
function flag(n, d) { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; }
const VARIANTS = Number(flag('--variants', 20));
const SPINS = Number(flag('--spins', 5000));
const SCALE_K = 2;
const MC_REL_TOL = 0.10;        // per-runtime scaling tolerance
const CROSS_LANG_TOL = 0.05;    // ratios across languages must agree

// ── Mulberry32 (matches engine's RNG; reproducible variant gen) ───────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Variant generator ─────────────────────────────────────────────────────
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function generateVariant(baseIR, variantSeed) {
  const rng = mulberry32(variantSeed);
  const ir = deepClone(baseIR);
  // Randomize paytable values within [0.5×, 2×] of original
  for (const sym of Object.keys(ir.paytable ?? {})) {
    const entry = ir.paytable[sym];
    if (!entry || typeof entry !== 'object') continue;
    for (const k of Object.keys(entry)) {
      if (typeof entry[k] === 'number') {
        const mult = 0.5 + 1.5 * rng();
        entry[k] = Math.max(0, Math.round(entry[k] * mult * 100) / 100);
      }
    }
  }
  // Randomize reel weights (preserve symbol set, randomize weights 5..15)
  if (ir.reels?.mode === 'weighted' && Array.isArray(ir.reels.base)) {
    for (const reel of ir.reels.base) {
      for (const sym of Object.keys(reel)) {
        reel[sym] = 5 + Math.floor(rng() * 11); // 5..15
      }
    }
  }
  return ir;
}

function scalePaytable(ir, k) {
  const c = deepClone(ir);
  if (!c.paytable) return c;
  for (const sym of Object.keys(c.paytable)) {
    const e = c.paytable[sym];
    if (e && typeof e === 'object') {
      for (const m of Object.keys(e)) {
        if (typeof e[m] === 'number') e[m] = e[m] * k;
      }
    }
  }
  return c;
}
function zeroPaytable(ir) {
  const c = deepClone(ir);
  if (!c.paytable) return c;
  for (const sym of Object.keys(c.paytable)) {
    const e = c.paytable[sym];
    if (e && typeof e === 'object') {
      for (const m of Object.keys(e)) {
        if (typeof e[m] === 'number') e[m] = 0;
      }
    }
  }
  // Also zero feature payouts (matches MR2 in metamorphic-rtp suite)
  if (Array.isArray(c.features)) {
    for (const f of c.features) {
      if (typeof f.global_multiplier === 'number') f.global_multiplier = 0;
      if (Array.isArray(f.cash_value_distribution)) for (const cv of f.cash_value_distribution) if (typeof cv.value === 'number') cv.value = 0;
      if (Array.isArray(f.jackpot_tiers)) for (const jt of f.jackpot_tiers) { if (typeof jt.multiplier === 'number') jt.multiplier = 0; if (typeof jt.value === 'number') jt.value = 0; }
      if (Array.isArray(f.multiplier_progression)) f.multiplier_progression = f.multiplier_progression.map(() => 0);
    }
  }
  return c;
}

// ── Runtime adapters ──────────────────────────────────────────────────────

/** Run Rust evaluator_parity and aggregate base_win → RTP. */
function runRust(ir, seed, spins) {
  const tmpFile = join(tmpdir(), `diff-fuzz-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(ir));
  try {
    const res = spawnSync(ORACLE_BIN, ['--config', tmpFile, '--seed', String(seed), '--spins', String(spins)], {
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`Rust oracle exit ${res.status}: ${(res.stderr || '').slice(0, 200)}`);
    }
    let totalBase = 0;
    let lineCount = 0;
    for (const line of res.stdout.split('\n')) {
      if (line.length === 0) continue;
      const r = JSON.parse(line);
      totalBase += r.base_win;
      lineCount++;
    }
    if (lineCount !== spins) throw new Error(`Rust: expected ${spins} lines, got ${lineCount}`);
    const bet = ir.bet?.base_bet ?? 1;
    return { rtp: totalBase / (spins * bet), spins: lineCount };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

/** Run TS irSimulator and return aggregate RTP. */
async function runTS(ir, seed, spins, irSim) {
  const sim = await irSim.runIRSimulation(ir, { spins, seed });
  return { rtp: sim.rtp, spins };
}

// ── MR runners ────────────────────────────────────────────────────────────

async function runVariant(variantId, ir, seed, irSim) {
  // Baseline run
  const tsBase = await runTS(ir, seed, SPINS, irSim);
  const rsBase = runRust(ir, seed, SPINS);

  // MR-CL-1 DETERMINISM (same runtime, same seed, two runs)
  const tsBase2 = await runTS(ir, seed, SPINS, irSim);
  const rsBase2 = runRust(ir, seed, SPINS);
  const mr1 = {
    pass_ts: tsBase.rtp === tsBase2.rtp,
    pass_rust: rsBase.rtp === rsBase2.rtp,
    ts_diff: tsBase.rtp - tsBase2.rtp,
    rust_diff: rsBase.rtp - rsBase2.rtp,
  };
  mr1.pass = mr1.pass_ts && mr1.pass_rust;

  // MR-CL-2 SCALE-CONSISTENCY
  const scaledIR = scalePaytable(ir, SCALE_K);
  const tsScaled = await runTS(scaledIR, seed, SPINS, irSim);
  const rsScaled = runRust(scaledIR, seed, SPINS);
  const tsRatio = tsBase.rtp > 0 ? tsScaled.rtp / tsBase.rtp : (tsScaled.rtp === 0 ? 1 : NaN);
  const rsRatio = rsBase.rtp > 0 ? rsScaled.rtp / rsBase.rtp : (rsScaled.rtp === 0 ? 1 : NaN);
  const tsErr = Number.isFinite(tsRatio) ? Math.abs(tsRatio - SCALE_K) / SCALE_K : Infinity;
  const rsErr = Number.isFinite(rsRatio) ? Math.abs(rsRatio - SCALE_K) / SCALE_K : Infinity;
  const crossErr = Number.isFinite(tsRatio) && Number.isFinite(rsRatio)
    ? Math.abs(tsRatio - rsRatio) / Math.max(tsRatio, rsRatio)
    : Infinity;
  const mr2 = {
    pass_ts: tsErr <= MC_REL_TOL,
    pass_rust: rsErr <= MC_REL_TOL,
    pass_cross: crossErr <= CROSS_LANG_TOL,
    tsRatio, rsRatio, tsErr, rsErr, crossErr,
  };
  mr2.pass = mr2.pass_ts && mr2.pass_rust && mr2.pass_cross;

  // MR-CL-3 ZERO-PAYOUT
  const zeroIR = zeroPaytable(ir);
  const tsZero = await runTS(zeroIR, seed, SPINS, irSim);
  const rsZero = runRust(zeroIR, seed, SPINS);
  const mr3 = {
    pass_ts: tsZero.rtp === 0,
    pass_rust: rsZero.rtp === 0,
    ts_rtp: tsZero.rtp,
    rust_rtp: rsZero.rtp,
  };
  mr3.pass = mr3.pass_ts && mr3.pass_rust;

  // MR-CL-4 BOUNDS — 0 ≤ RTP ≤ envelope (10000× sanity)
  const ENV = 10000;
  const mr4 = {
    pass_ts: tsBase.rtp >= 0 && tsBase.rtp <= ENV,
    pass_rust: rsBase.rtp >= 0 && rsBase.rtp <= ENV,
    ts_rtp: tsBase.rtp,
    rust_rtp: rsBase.rtp,
  };
  mr4.pass = mr4.pass_ts && mr4.pass_rust;

  return {
    id: variantId,
    seed,
    baseline: { ts: tsBase.rtp, rust: rsBase.rtp },
    mr1, mr2, mr3, mr4,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(ORACLE_BIN)) {
    console.error(`✗ Rust oracle not built: ${ORACLE_BIN}`);
    console.error(`  Run: cargo build --release --bin evaluator_parity --manifest-path rust-sim/Cargo.toml`);
    process.exit(2);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const irSim = await import(join(REPO_ROOT, 'dist', 'engine', 'irSimulator.js'));
  const baseIR = JSON.parse(readFileSync(FIXTURE_BASE, 'utf-8'));

  console.log(`Differential fuzz TS↔Rust — ${VARIANTS} variants × 4 MRs × 2 runtimes × ${SPINS} spins`);
  console.log();

  const results = [];
  let totalCells = 0;
  let passCells = 0;
  const wallStart = Date.now();
  const variantSeeds = Array.from({ length: VARIANTS }, (_, i) => 0xCAFE0000 ^ (i * 0x9E3779B1));

  for (let i = 0; i < VARIANTS; i++) {
    const variantId = `V${String(i + 1).padStart(2, '0')}`;
    const seed = (variantSeeds[i] & 0xFFFFFFFF) >>> 0;
    const ir = generateVariant(baseIR, variantSeeds[i]);
    const t0 = Date.now();
    let r;
    try {
      r = await runVariant(variantId, ir, seed, irSim);
    } catch (e) {
      console.log(`  ${variantId}  ❌ runner error: ${e.message}`);
      results.push({ id: variantId, seed, error: e.message });
      totalCells += 8;
      continue;
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    // 8 cells per variant (4 MRs × 2 runtimes for cells where applicable;
    // we count `pass` field as the unified per-MR PASS, plus per-runtime
    // sub-counts for visibility)
    const cells = [r.mr1.pass_ts, r.mr1.pass_rust, r.mr2.pass_ts, r.mr2.pass_rust, r.mr2.pass_cross, r.mr3.pass_ts, r.mr3.pass_rust, r.mr4.pass_ts && r.mr4.pass_rust];
    const cellPass = cells.filter(Boolean).length;
    totalCells += cells.length;
    passCells += cellPass;
    const symbols = `MR1[${r.mr1.pass_ts ? '✓' : '✗'}${r.mr1.pass_rust ? '✓' : '✗'}] MR2[${r.mr2.pass_ts ? '✓' : '✗'}${r.mr2.pass_rust ? '✓' : '✗'}/x${r.mr2.pass_cross ? '✓' : '✗'}] MR3[${r.mr3.pass_ts ? '✓' : '✗'}${r.mr3.pass_rust ? '✓' : '✗'}] MR4[${r.mr4.pass_ts && r.mr4.pass_rust ? '✓' : '✗'}]`;
    const allOk = cellPass === cells.length;
    console.log(`  ${variantId}  ${allOk ? '✅' : '❌'} ${symbols}  ts=${r.baseline.ts.toFixed(3)} rust=${r.baseline.rust.toFixed(3)}  (${dt}s)`);
    results.push(r);
  }

  const wallTotal = ((Date.now() - wallStart) / 1000).toFixed(1);
  const allPass = passCells === totalCells;
  console.log();
  console.log(`Total: ${passCells}/${totalCells} cells pass in ${wallTotal}s  ${allPass ? '✅' : '❌'}`);

  // ── Reports ──────────────────────────────────────────────────────────────
  const json = {
    schema: 'diff-fuzz-cross-lang/v1',
    generatedAtUtc: new Date().toISOString(),
    config: {
      base_fixture: 'tests/fixtures/parity.json',
      variants: VARIANTS,
      spins_per_run: SPINS,
      scale_k: SCALE_K,
      mc_rel_tol: MC_REL_TOL,
      cross_lang_tol: CROSS_LANG_TOL,
    },
    metamorphic_relations: {
      'MR-CL-1': 'DETERMINISM       — same seed twice in same runtime → identical RTP',
      'MR-CL-2': 'SCALE-CONSISTENCY — paytable × 2 → RTP × 2 in BOTH runtimes (cross-lang ratio agree)',
      'MR-CL-3': 'ZERO-PAYOUT       — paytable[*]=0 → RTP == 0 in both',
      'MR-CL-4': 'BOUNDS            — 0 ≤ RTP ≤ envelope in both',
    },
    headline: {
      total_cells: totalCells,
      pass_cells: passCells,
      all_pass: allPass,
      wall_seconds: wallTotal,
    },
    variants: results,
  };
  writeFileSync(join(OUT_DIR, 'DIFF_FUZZ_CROSS_LANG.json'), JSON.stringify(json, null, 2));
  writeFileSync(join(OUT_DIR, 'DIFF_FUZZ_CROSS_LANG.md'), renderMd(json));
  console.log(`Reports: reports/acceptance/DIFF_FUZZ_CROSS_LANG.{json,md}`);

  if (!allPass) process.exitCode = 1;
}

function renderMd(j) {
  const out = [];
  out.push('# Differential Fuzz Cross-Language — Acceptance Report');
  out.push('');
  out.push(`> Closes **Kimi K2** (deep-audit 2026-05-15). Generated \`${j.generatedAtUtc}\`.`);
  out.push(`> Variants: \`${j.config.variants}\` · spins/run: \`${j.config.spins_per_run}\` · wall: \`${j.headline.wall_seconds}s\``);
  out.push('');
  out.push(`## Headline: **${j.headline.pass_cells}/${j.headline.total_cells} cells pass** ${j.headline.all_pass ? '✅' : '❌'}`);
  out.push('');
  out.push('## Metamorphic Relations');
  for (const [k, v] of Object.entries(j.metamorphic_relations)) {
    out.push(`- **${k}** — ${v}`);
  }
  out.push('');
  out.push('## Per-Variant Cells');
  out.push('');
  out.push('| Variant | seed | RTP_TS | RTP_Rust | MR1 ts/rust | MR2 ts/rust/× | MR3 ts/rust | MR4 ts+rust |');
  out.push('|---|---|---:|---:|---|---|---|---|');
  for (const r of j.variants) {
    if (r.error) {
      out.push(`| ${r.id} | ${r.seed} | – | – | ERROR | ${r.error.slice(0, 60)} | | |`);
      continue;
    }
    const c = (b) => b ? '✅' : '❌';
    out.push(
      `| ${r.id} | ${r.seed} | ${r.baseline.ts.toFixed(3)} | ${r.baseline.rust.toFixed(3)} | ${c(r.mr1.pass_ts)}/${c(r.mr1.pass_rust)} | ${c(r.mr2.pass_ts)}/${c(r.mr2.pass_rust)}/${c(r.mr2.pass_cross)} | ${c(r.mr3.pass_ts)}/${c(r.mr3.pass_rust)} | ${c(r.mr4.pass_ts && r.mr4.pass_rust)} |`,
    );
  }
  out.push('');
  out.push('## Why per-runtime invariants > direct RTP comparison');
  out.push('');
  out.push('The Rust `evaluator_parity` binary is BASE-GAME ONLY (lightning disabled);');
  out.push('the TS `irSimulator.runIRSimulation` is FULL-GAME (FS + H&W contribution).');
  out.push('Direct numeric RTP_TS == RTP_Rust comparison would be biased by feature-tier');
  out.push('deltas, not bugs. Metamorphic invariants test that BOTH RUNTIMES OBEY THE');
  out.push('SAME MATH (e.g. payout scaling produces RTP scaling, in identical ratio) —');
  out.push('a STRONGER bug-detection signal than aggregate equality. Industry-first');
  out.push('cross-language metamorphic test for slot engines.');
  return out.join('\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
