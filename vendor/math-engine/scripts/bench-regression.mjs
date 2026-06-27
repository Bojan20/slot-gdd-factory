#!/usr/bin/env node
// Faza 9.7 — Criterion bench regression detector.
//
// Compares the freshly-produced criterion `estimates.json` files (under
// `target/criterion/<group>/<bench>/new/estimates.json`) against the
// committed baseline at `reports/bench/<group>/<bench>.estimates.json` and
// fails when any bench is more than `--threshold` (default 5%) slower.
//
// The committed baselines were captured on Apple M3 Pro on 2026-05-12 (see
// `reports/bench/README.md`). When running on different hardware in CI you
// can either:
//
//   * Override the baseline directory with `--baseline-dir reports/bench`
//   * Pass `--write-baseline` to refresh the on-disk baseline (only landed
//     when running on the same hardware as the canonical M3 Pro values).
//
// Usage:
//   cd rust-sim && cargo bench --bench spin_throughput
//   node scripts/bench-regression.mjs                     # compare → exit 1 on regression
//   node scripts/bench-regression.mjs --threshold 0.05    # 5% slower fails (default)
//   node scripts/bench-regression.mjs --json out.json     # write machine-readable summary
//   node scripts/bench-regression.mjs --write-baseline    # refresh committed baseline
//
// Exit codes:
//   0 — every bench within threshold of its baseline (or no baseline yet)
//   1 — at least one bench regressed beyond threshold
//   2 — usage / IO / parse error
//
// File layout this script understands:
//
//   target/criterion/
//     full_spin/
//       scalar_Evaluator/new/estimates.json
//       packed_ZeroAllocEvaluator/new/estimates.json
//     ...
//
//   reports/bench/
//     full_spin/
//       scalar_Evaluator.estimates.json     ← baseline
//       packed_ZeroAllocEvaluator.estimates.json
//     ...

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── arg parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  threshold: 0.05,
  criterion: join(REPO_ROOT, 'target', 'criterion'),
  baselineDir: join(REPO_ROOT, 'reports', 'bench'),
  json: null,
  writeBaseline: false,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case '--threshold': opts.threshold = Number(args[++i]); break;
    case '--criterion-dir': opts.criterion = args[++i]; break;
    case '--baseline-dir': opts.baselineDir = args[++i]; break;
    case '--json': opts.json = args[++i]; break;
    case '--write-baseline': opts.writeBaseline = true; break;
    case '-h':
    case '--help': {
      const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
      const head = lines.slice(0, lines.findIndex((l) => l.trim().startsWith('import')));
      process.stdout.write(head.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
      break;
    }
    default:
      console.error(`ERROR: unknown flag: ${a}`);
      process.exit(2);
  }
}
if (!Number.isFinite(opts.threshold) || opts.threshold < 0) {
  console.error(`ERROR: --threshold must be a non-negative number, got: ${opts.threshold}`);
  process.exit(2);
}

// ─── discovery helpers ────────────────────────────────────────────────────────
function findCriterionEstimates(root) {
  // Walk `target/criterion/<group>/<bench>/new/estimates.json`.
  if (!existsSync(root)) return [];
  const out = [];
  for (const group of readdirSync(root)) {
    const gp = join(root, group);
    if (!safeIsDir(gp)) continue;
    if (group === 'report') continue; // criterion top-level summary
    for (const bench of readdirSync(gp)) {
      const bp = join(gp, bench);
      if (!safeIsDir(bp)) continue;
      const newEst = join(bp, 'new', 'estimates.json');
      const baseEst = join(bp, 'base', 'estimates.json');
      const path = existsSync(newEst) ? newEst : (existsSync(baseEst) ? baseEst : null);
      if (path) {
        out.push({ group, bench, kind: 'criterion', path });
      }
    }
  }
  return out;
}

function findBaselineEstimates(root) {
  if (!existsSync(root)) return new Map();
  const out = new Map();
  for (const group of readdirSync(root)) {
    const gp = join(root, group);
    if (!safeIsDir(gp)) continue;
    for (const file of readdirSync(gp)) {
      if (!file.endsWith('.estimates.json')) continue;
      const bench = file.slice(0, -'.estimates.json'.length);
      out.set(`${group}::${bench}`, join(gp, file));
    }
  }
  return out;
}

function safeIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function loadEstimate(path) {
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  const median = json?.median?.point_estimate;
  const mean = json?.mean?.point_estimate;
  if (typeof median !== 'number' && typeof mean !== 'number') {
    throw new Error(`No median or mean point_estimate in ${path}`);
  }
  return { median, mean, raw: json };
}

// Criterion bench-name → baseline filename mapping. Criterion uses the
// `cargo bench` bench-id verbatim, baseline files use a stripped form.
//
//   criterion bench-id              ↔ baseline file
//   scalar_Evaluator                ↔ scalar_Evaluator.estimates.json
//   packed_ZeroAllocEvaluator       ↔ packed_ZeroAllocEvaluator.estimates.json
//   packed_u128_alias               ↔ packed_u128_alias.estimates.json
//
// Some legacy fixtures use slightly different bench names than the file
// name (e.g. `packed_u128` in code → `packed_u128_alias.estimates.json` in
// committed baseline). We handle both directions of the alias map.
const ALIAS = new Map([
  ['grid_generation::packed_u128', 'grid_generation::packed_u128_alias'],
  ['grid_generation::scalar', 'grid_generation::scalar_DynGrid'],
  ['full_spin::scalar_Evaluator', 'full_spin::scalar_Evaluator'],
  ['full_spin::packed_ZeroAlloc', 'full_spin::packed_ZeroAllocEvaluator'],
  ['scatter_count::scalar_loop', 'scatter_count::scalar_loop'],
  ['scatter_count::simd_u8x16', 'scatter_count::simd_u8x16'],
  ['throughput_1M::scalar_1M_spins', 'throughput_1M::scalar_1M_spins'],
  ['throughput_1M::packed_1M_spins', 'throughput_1M::packed_1M_spins'],
]);

function resolveBaseline(group, bench, baselineMap) {
  const direct = `${group}::${bench}`;
  if (baselineMap.has(direct)) return baselineMap.get(direct);
  const aliased = ALIAS.get(direct);
  if (aliased && baselineMap.has(aliased)) return baselineMap.get(aliased);
  return null;
}

// ─── main ─────────────────────────────────────────────────────────────────────
const fresh = findCriterionEstimates(opts.criterion);
const baselineMap = findBaselineEstimates(opts.baselineDir);

if (fresh.length === 0) {
  console.error(`WARN: no fresh criterion runs found under ${opts.criterion}`);
  console.error(`      did you run \`cd rust-sim && cargo bench\` first?`);
  // Non-fatal — CI may want to call us as a smoke test before the bench
  // is wired in. Exit zero.
  process.exit(0);
}

const rows = [];
let regressed = 0;
let improved = 0;
let unchanged = 0;
let unmapped = 0;

for (const f of fresh) {
  const cur = loadEstimate(f.path);
  const baselinePath = resolveBaseline(f.group, f.bench, baselineMap);
  let baseline = null;
  let baselineRelPath = null;
  if (baselinePath) {
    baseline = loadEstimate(baselinePath);
    baselineRelPath = relative(REPO_ROOT, baselinePath);
  }
  const row = {
    group: f.group,
    bench: f.bench,
    median_ns: cur.median,
    baseline_ns: baseline?.median ?? null,
    baseline_path: baselineRelPath,
    delta_pct: null,
    status: 'unmapped',
  };
  if (baseline?.median != null && baseline.median > 0 && cur.median != null) {
    // delta_pct = (current - baseline) / baseline   (positive = slower)
    const delta = (cur.median - baseline.median) / baseline.median;
    row.delta_pct = delta;
    if (delta > opts.threshold) { row.status = 'REGRESSED'; regressed++; }
    else if (delta < -opts.threshold) { row.status = 'IMPROVED'; improved++; }
    else { row.status = 'within-threshold'; unchanged++; }
  } else {
    unmapped++;
  }
  rows.push(row);
}

// ─── --write-baseline support ─────────────────────────────────────────────────
if (opts.writeBaseline) {
  let written = 0;
  for (const f of fresh) {
    const aliased = ALIAS.get(`${f.group}::${f.bench}`);
    const targetKey = aliased || `${f.group}::${f.bench}`;
    const [g, b] = targetKey.split('::');
    const outDir = join(opts.baselineDir, g);
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `${b}.estimates.json`);
    writeFileSync(outFile, readFileSync(f.path), 'utf8');
    written++;
  }
  console.log(`baseline refreshed: ${written} files under ${opts.baselineDir}`);
}

// ─── print summary ────────────────────────────────────────────────────────────
const fmt = (n) => (n == null ? 'n/a' : (n >= 1e3 ? n.toFixed(0) : n.toFixed(2)));
const fmtPct = (n) => (n == null ? '   n/a' : `${(n * 100).toFixed(2).padStart(6)}%`);

const stripeColor = (s) => {
  if (process.stdout.isTTY === false) return s;
  return s;
};

console.log('');
console.log(`Bench regression report (threshold = ${(opts.threshold * 100).toFixed(2)}%)`);
console.log('─'.repeat(96));
console.log(
  `${'group'.padEnd(20)} ${'bench'.padEnd(28)} ${'current ns'.padStart(12)} ${'baseline ns'.padStart(12)} ${'Δ vs base'.padStart(10)}  status`
);
console.log('─'.repeat(96));
for (const r of rows.sort((a, b) => `${a.group}::${a.bench}`.localeCompare(`${b.group}::${b.bench}`))) {
  console.log(
    `${r.group.padEnd(20)} ${r.bench.padEnd(28)} ${fmt(r.median_ns).padStart(12)} ${fmt(r.baseline_ns).padStart(12)} ${fmtPct(r.delta_pct).padStart(10)}  ${r.status}`
  );
}
console.log('─'.repeat(96));
console.log(`totals: ${rows.length} benches | regressed=${regressed} improved=${improved} within=${unchanged} unmapped=${unmapped}`);

const summary = {
  threshold: opts.threshold,
  rows,
  regressed,
  improved,
  unchanged,
  unmapped,
};

if (opts.json) {
  mkdirSync(dirname(opts.json), { recursive: true });
  writeFileSync(opts.json, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nJSON summary → ${opts.json}`);
}

if (regressed > 0) {
  console.error(stripeColor(`\nFAIL: ${regressed} bench(es) regressed > ${(opts.threshold * 100).toFixed(2)}% — CI gate failed`));
  process.exit(1);
}
process.exit(0);
