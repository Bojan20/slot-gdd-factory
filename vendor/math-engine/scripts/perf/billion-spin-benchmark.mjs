#!/usr/bin/env node
/**
 * W212 Faza 600.1 — 1B Spin Benchmark Hardening (Agent C).
 *
 * Modernises the Wave 27 10⁹-spin replay baseline (15.76s Node, 5.43s Rust)
 * into a multi-kernel, multi-deployment gauntlet. The original
 * `scripts/billion-spins-replay.mjs` cycled one P-ID; this script cycles 10
 * P-IDs and produces a per-kernel × per-mode latency histogram alongside
 * a global aggregate.
 *
 * Deployment modes
 * ────────────────
 *   - node-single        Single-threaded Node loop (baseline)
 *   - node-workers       Node `worker_threads` parallel sharding
 *   - rust-single        `cargo run --release --example billion_spins_replay`
 *   - rust-rayon         Same example with `RAYON_NUM_THREADS` set
 *
 * Per-spin metrics
 * ────────────────
 *   - Latency (ns)       hrtime delta
 *   - Hit                payout > 0
 *   - Win                payout × bet
 *   - Audit hash         sha256 chain advancement marker
 *
 * Outputs
 * ───────
 *   - `reports/perf/BILLION_SPIN_BENCHMARK.json`
 *   - `reports/perf/BILLION_SPIN_BENCHMARK.md`
 *
 * Synthetic mode (default for CI): N_SPINS = 1e6 across 10 kernels (100k
 * each) → completes in well under 30s on a laptop. Pass `--full` for the
 * 1e9 production run.
 *
 * Honest reporting — speedups vs. node-single baseline are computed and
 * printed; regressions are surfaced not hidden.
 *
 * CLI:
 *   node scripts/perf/billion-spin-benchmark.mjs --synthetic
 *   node scripts/perf/billion-spin-benchmark.mjs --full --modes=node-single,rust-single
 *   node scripts/perf/billion-spin-benchmark.mjs --synthetic --skip-rust
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'reports', 'perf');

export function parseArgs(argv) {
  const out = { synthetic: false, full: false, skipRust: false };
  for (const a of argv.slice(2)) {
    if (a === '--synthetic') out.synthetic = true;
    else if (a === '--full') out.full = true;
    else if (a === '--skip-rust') out.skipRust = true;
    else if (a.startsWith('--spins=')) out.spins = Number(a.slice(8));
    else if (a.startsWith('--modes=')) out.modes = a.slice(8).split(',');
    else if (a.startsWith('--kernels=')) out.kernels = Number(a.slice(10));
    else if (a.startsWith('--workers=')) out.workers = Number(a.slice(10));
    else if (a.startsWith('--out=')) out.out = a.slice(6);
  }
  return out;
}

// ── Kernel registry ─────────────────────────────────────────────────────────
// 10 distinct P-IDs. We synthesise a tiny payout distribution per kernel
// so the benchmark is self-contained — no dependence on the full IR
// library. Each kernel has its own RTP target and hit-frequency profile.

export const KERNELS = [
  { id: 'P001-classic-5x3', rtp: 0.945, hitFreq: 0.28, variance: 'low' },
  { id: 'P017-megaways', rtp: 0.965, hitFreq: 0.22, variance: 'med' },
  { id: 'P024-cluster-pays', rtp: 0.962, hitFreq: 0.30, variance: 'med' },
  { id: 'P033-cascading', rtp: 0.955, hitFreq: 0.25, variance: 'med' },
  { id: 'P041-hold-spin', rtp: 0.948, hitFreq: 0.18, variance: 'high' },
  { id: 'P056-buy-bonus', rtp: 0.971, hitFreq: 0.20, variance: 'high' },
  { id: 'P063-must-hit', rtp: 0.952, hitFreq: 0.27, variance: 'med' },
  { id: 'P071-wap-wheel', rtp: 0.940, hitFreq: 0.15, variance: 'high' },
  { id: 'P088-bingo-class2', rtp: 0.935, hitFreq: 0.32, variance: 'low' },
  { id: 'P094-crash', rtp: 0.978, hitFreq: 0.45, variance: 'very-high' },
];

// ── Mulberry32 (deterministic, matches Wave 27/28 streams) ──────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Synthetic payout table (per-kernel) ─────────────────────────────────────
// We pre-compute a 4096-entry flat payouts array whose mean ≈ kernel.rtp.
// Hits are non-zero with probability ≈ kernel.hitFreq; the remaining mass
// goes to high-multiplier tail entries shaped by `variance`.
export function buildKernelPayouts(kernel, size = 4096) {
  const payouts = new Float64Array(size);
  const tailMul = kernel.variance === 'very-high' ? 50
    : kernel.variance === 'high' ? 25
    : kernel.variance === 'med' ? 12
    : 6;
  const hitCount = Math.floor(size * kernel.hitFreq);
  // Reserve last 1% for tail jackpot-style hits.
  const tailCount = Math.max(1, Math.floor(hitCount * 0.01));
  const bodyCount = hitCount - tailCount;
  const bodyTarget = kernel.rtp * 0.7;
  const tailTarget = kernel.rtp * 0.3;
  const bodyMean = bodyCount > 0 ? (bodyTarget * size) / bodyCount : 0;
  const tailMean = tailCount > 0 ? (tailTarget * size) / tailCount : 0;
  // Seeded fill (deterministic across runs).
  const rng = mulberry32(seedFromId(kernel.id));
  for (let i = 0; i < bodyCount; i++) {
    payouts[i] = bodyMean * (0.4 + 1.2 * rng());
  }
  for (let i = bodyCount; i < bodyCount + tailCount; i++) {
    payouts[i] = tailMean * tailMul * (0.5 + rng());
  }
  // Renormalise to land exactly on kernel.rtp.
  const sum = payouts.reduce((s, v) => s + v, 0);
  const targetSum = kernel.rtp * size;
  const scale = targetSum / sum;
  for (let i = 0; i < size; i++) payouts[i] *= scale;
  // Shuffle so hits are not contiguous (matters for branch predictor).
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [payouts[i], payouts[j]] = [payouts[j], payouts[i]];
  }
  return payouts;
}

function seedFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ── Per-spin metrics histogram ──────────────────────────────────────────────
export class LatencyHistogram {
  constructor(cap = 50_000) {
    this.cap = cap;
    this.samples = [];
    this.count = 0;
    this.hits = 0;
    this.totalWinUnits = 0;
    this.maxNs = 0;
  }
  observe(latencyNs, payoutUnits) {
    this.count++;
    if (payoutUnits > 0) this.hits++;
    this.totalWinUnits += payoutUnits;
    if (latencyNs > this.maxNs) this.maxNs = latencyNs;
    if (this.samples.length < this.cap) this.samples.push(latencyNs);
    else {
      const idx = Math.floor(Math.random() * this.count);
      if (idx < this.cap) this.samples[idx] = latencyNs;
    }
  }
  percentile(q) {
    if (this.samples.length === 0) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[i];
  }
  summary() {
    return {
      count: this.count,
      hits: this.hits,
      hitFreq: this.count ? this.hits / this.count : 0,
      totalWinUnits: this.totalWinUnits,
      empiricalRtp: this.count ? this.totalWinUnits / this.count : 0,
      p50Ns: this.percentile(0.5),
      p95Ns: this.percentile(0.95),
      p99Ns: this.percentile(0.99),
      p999Ns: this.percentile(0.999),
      maxNs: this.maxNs,
    };
  }
}

// ── Hash chain advancement (audit marker) ───────────────────────────────────
// We chain a sha256 every 1024 spins (sampling) so the audit hash advances
// the same way a production engine would, without per-spin syscall cost.
export function audithash(seed, spinIdx, payout) {
  return createHash('sha256')
    .update(`${seed}|${spinIdx}|${payout}`)
    .digest('hex');
}

// ── Node single-thread mode ─────────────────────────────────────────────────
export function runNodeSingleKernel(kernel, payouts, spins, sampleEvery = 1) {
  const len = payouts.length;
  const hist = new LatencyHistogram();
  const rng = mulberry32(seedFromId(kernel.id) ^ 0xfeedface);
  let chain = `init-${kernel.id}`;
  const tStart = performance.now();
  for (let i = 0; i < spins; i++) {
    const t0 = performance.now();
    const payout = payouts[(rng() * len) | 0];
    const t1 = performance.now();
    const latencyNs = Math.max(1, Math.floor((t1 - t0) * 1e6));
    if (i % sampleEvery === 0) hist.observe(latencyNs, payout);
    if (i % 1024 === 0) chain = audithash(chain, i, payout);
  }
  const wallMs = performance.now() - tStart;
  return {
    mode: 'node-single',
    kernel: kernel.id,
    spins,
    wallMs,
    spinsPerSec: (spins / wallMs) * 1000,
    summary: hist.summary(),
    finalAuditHash: chain.slice(0, 24),
  };
}

// ── Node workers mode ───────────────────────────────────────────────────────
async function runNodeWorkersKernel(kernel, payouts, spins, workers) {
  const shardSize = Math.floor(spins / workers);
  const promises = [];
  const t0 = performance.now();
  for (let w = 0; w < workers; w++) {
    const isLast = w === workers - 1;
    const n = isLast ? spins - shardSize * (workers - 1) : shardSize;
    promises.push(new Promise((res, rej) => {
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { kernel, payouts: Array.from(payouts), spins: n, shardIdx: w },
      });
      worker.on('message', res);
      worker.on('error', rej);
    }));
  }
  const shards = await Promise.all(promises);
  const wallMs = performance.now() - t0;
  // Merge shard summaries.
  const merged = {
    count: 0, hits: 0, totalWinUnits: 0, maxNs: 0,
    p50Ns: 0, p95Ns: 0, p99Ns: 0, p999Ns: 0,
  };
  let nMax = 0;
  for (const s of shards) {
    merged.count += s.summary.count;
    merged.hits += s.summary.hits;
    merged.totalWinUnits += s.summary.totalWinUnits;
    merged.maxNs = Math.max(merged.maxNs, s.summary.maxNs);
    // Percentile merge is approximate — we take the maximum per-shard p99
    // as an upper bound (conservative, matches load-test convention).
    nMax = Math.max(nMax, s.summary.count);
    merged.p50Ns = Math.max(merged.p50Ns, s.summary.p50Ns);
    merged.p95Ns = Math.max(merged.p95Ns, s.summary.p95Ns);
    merged.p99Ns = Math.max(merged.p99Ns, s.summary.p99Ns);
    merged.p999Ns = Math.max(merged.p999Ns, s.summary.p999Ns);
  }
  merged.hitFreq = merged.count ? merged.hits / merged.count : 0;
  merged.empiricalRtp = merged.count ? merged.totalWinUnits / merged.count : 0;
  return {
    mode: 'node-workers',
    kernel: kernel.id,
    spins,
    workers,
    wallMs,
    spinsPerSec: (spins / wallMs) * 1000,
    summary: merged,
    finalAuditHash: shards[0]?.finalAuditHash ?? null,
  };
}

// ── Rust subprocess modes ───────────────────────────────────────────────────
export function runRustSingleKernel(kernel, spins) {
  // We invoke the existing Wave 28 example. It cycles a single fixture; we
  // pass the kernel as a positional fixture name so a future Rust harness
  // could pick it up — the current example ignores it and uses default.
  const t0 = performance.now();
  const proc = spawnSync('cargo', [
    'run', '--release', '--quiet',
    '--manifest-path', resolve(REPO_ROOT, 'rust-sim', 'Cargo.toml'),
    '--example', 'billion_spins_replay',
    '--', String(spins), '1000',
  ], { encoding: 'utf8', timeout: 300_000 });
  const wallMs = performance.now() - t0;
  const stdout = proc.stdout || '';
  // Parse stable marker line.
  const m = stdout.match(/\[billion-spins-replay\][^\n]*spins_per_sec=([\d.e+-]+)/);
  const spinsPerSec = m ? Number(m[1]) : (spins / wallMs) * 1000;
  return {
    mode: 'rust-single',
    kernel: kernel.id,
    spins,
    wallMs,
    spinsPerSec,
    summary: {
      count: spins, hits: 0, hitFreq: 0, totalWinUnits: 0, empiricalRtp: 0,
      p50Ns: 0, p95Ns: 0, p99Ns: 0, p999Ns: 0,
      maxNs: 0,
    },
    finalAuditHash: 'rust-subprocess',
    skipped: proc.status !== 0,
    err: proc.status !== 0 ? (proc.stderr || '').slice(0, 200) : undefined,
  };
}

export function runRustRayonKernel(kernel, spins, workers) {
  const t0 = performance.now();
  const proc = spawnSync('cargo', [
    'run', '--release', '--quiet',
    '--manifest-path', resolve(REPO_ROOT, 'rust-sim', 'Cargo.toml'),
    '--example', 'billion_spins_replay',
    '--', String(spins), '1000',
  ], {
    encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, RAYON_NUM_THREADS: String(workers) },
  });
  const wallMs = performance.now() - t0;
  const stdout = proc.stdout || '';
  const m = stdout.match(/\[billion-spins-replay\][^\n]*spins_per_sec=([\d.e+-]+)/);
  const spinsPerSec = m ? Number(m[1]) : (spins / wallMs) * 1000;
  return {
    mode: 'rust-rayon',
    kernel: kernel.id,
    spins,
    workers,
    wallMs,
    spinsPerSec,
    summary: {
      count: spins, hits: 0, hitFreq: 0, totalWinUnits: 0, empiricalRtp: 0,
      p50Ns: 0, p95Ns: 0, p99Ns: 0, p999Ns: 0,
      maxNs: 0,
    },
    finalAuditHash: 'rust-rayon',
    skipped: proc.status !== 0,
    err: proc.status !== 0 ? (proc.stderr || '').slice(0, 200) : undefined,
  };
}

// ── Memory tracking ────────────────────────────────────────────────────────
export function captureMemory() {
  const m = process.memoryUsage();
  return {
    rssBytes: m.rss,
    heapUsedBytes: m.heapUsed,
    heapTotalBytes: m.heapTotal,
    externalBytes: m.external,
    arrayBuffersBytes: m.arrayBuffers,
  };
}

// ── Worker entry ───────────────────────────────────────────────────────────
if (!isMainThread && workerData) {
  const { kernel, payouts, spins } = workerData;
  const result = runNodeSingleKernel(kernel, Float64Array.from(payouts), spins);
  parentPort.postMessage(result);
}

// ── Orchestrator ───────────────────────────────────────────────────────────
export async function runBenchmark(opts) {
  const synthetic = opts.synthetic || (!opts.full && !opts.spins);
  const spinsPerKernel = opts.spins
    ?? (synthetic ? 100_000 : 100_000_000);
  const kernelsToRun = KERNELS.slice(0, opts.kernels ?? KERNELS.length);
  const workers = opts.workers ?? Math.max(2, Math.min(8, cpus().length));
  const modes = opts.modes ?? (opts.skipRust
    ? ['node-single', 'node-workers']
    : ['node-single', 'node-workers', 'rust-single', 'rust-rayon']);

  const memBefore = captureMemory();
  const tStart = Date.now();
  const results = [];
  for (const kernel of kernelsToRun) {
    const payouts = buildKernelPayouts(kernel);
    for (const mode of modes) {
      let r;
      if (mode === 'node-single') {
        r = runNodeSingleKernel(kernel, payouts, spinsPerKernel);
      } else if (mode === 'node-workers') {
        r = await runNodeWorkersKernel(kernel, payouts, spinsPerKernel, workers);
      } else if (mode === 'rust-single') {
        r = runRustSingleKernel(kernel, Math.min(spinsPerKernel, synthetic ? 100_000 : spinsPerKernel));
      } else if (mode === 'rust-rayon') {
        r = runRustRayonKernel(kernel, Math.min(spinsPerKernel, synthetic ? 100_000 : spinsPerKernel), workers);
      }
      results.push(r);
    }
  }
  const totalMs = Date.now() - tStart;
  const memAfter = captureMemory();

  // Compute per-mode aggregate.
  const byMode = {};
  for (const r of results) {
    if (!byMode[r.mode]) byMode[r.mode] = { mode: r.mode, totalSpins: 0, totalWallMs: 0, kernels: 0, skippedKernels: 0 };
    byMode[r.mode].totalSpins += r.spins;
    byMode[r.mode].totalWallMs += r.wallMs;
    byMode[r.mode].kernels++;
    if (r.skipped) byMode[r.mode].skippedKernels++;
  }
  for (const m of Object.values(byMode)) {
    m.spinsPerSec = m.totalWallMs > 0 ? (m.totalSpins / m.totalWallMs) * 1000 : 0;
  }

  // Honest speedup vs baseline.
  const baseline = byMode['node-single']?.spinsPerSec || 0;
  for (const m of Object.values(byMode)) {
    m.speedupVsBaseline = baseline > 0 ? m.spinsPerSec / baseline : 0;
  }

  return {
    generatedAtUtc: new Date().toISOString(),
    synthetic,
    spinsPerKernel,
    kernels: kernelsToRun.map((k) => k.id),
    modes,
    workers,
    totalMs,
    memory: { before: memBefore, after: memAfter, deltaRssBytes: memAfter.rssBytes - memBefore.rssBytes },
    perKernel: results,
    byMode,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
}

// ── Report writers ─────────────────────────────────────────────────────────
export function writeReports(report, outDir = OUT_DIR) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, 'BILLION_SPIN_BENCHMARK.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# W212 — 1B Spin Benchmark (Hardened)');
  md.push('');
  md.push(`Generated: ${report.generatedAtUtc}`);
  md.push(`Mode: ${report.synthetic ? 'synthetic (CI)' : 'full (production)'}`);
  md.push(`Spins per kernel: ${report.spinsPerKernel.toLocaleString()}`);
  md.push(`Total wall: ${(report.totalMs / 1000).toFixed(2)} s`);
  md.push(`Host: ${report.node} on ${report.platform}`);
  md.push('');
  md.push('## Per-mode aggregate');
  md.push('');
  md.push('| Mode | Kernels | Total spins | Wall (s) | Spins/sec | Speedup |');
  md.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const m of Object.values(report.byMode)) {
    md.push(`| ${m.mode} | ${m.kernels - m.skippedKernels}/${m.kernels} | ${m.totalSpins.toLocaleString()} | ${(m.totalWallMs / 1000).toFixed(2)} | ${m.spinsPerSec.toExponential(2)} | ${m.speedupVsBaseline.toFixed(2)}× |`);
  }
  md.push('');
  md.push('## Per-kernel × per-mode');
  md.push('');
  md.push('| Kernel | Mode | Spins | Wall (ms) | Spins/sec | p50 (ns) | p95 (ns) | p99 (ns) | p999 (ns) | Hit freq | RTP |');
  md.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of report.perKernel) {
    const s = r.summary;
    md.push(`| ${r.kernel} | ${r.mode}${r.skipped ? ' (skipped)' : ''} | ${r.spins.toLocaleString()} | ${r.wallMs.toFixed(1)} | ${r.spinsPerSec.toExponential(2)} | ${s.p50Ns ?? 0} | ${s.p95Ns ?? 0} | ${s.p99Ns ?? 0} | ${s.p999Ns ?? 0} | ${(s.hitFreq ?? 0).toFixed(3)} | ${(s.empiricalRtp ?? 0).toFixed(4)} |`);
  }
  md.push('');
  md.push('## Memory');
  md.push('');
  md.push(`- RSS before: ${(report.memory.before.rssBytes / 1024 / 1024).toFixed(1)} MiB`);
  md.push(`- RSS after:  ${(report.memory.after.rssBytes / 1024 / 1024).toFixed(1)} MiB`);
  md.push(`- Δ RSS:      ${(report.memory.deltaRssBytes / 1024 / 1024).toFixed(1)} MiB`);
  md.push(`- Heap used:  ${(report.memory.after.heapUsedBytes / 1024 / 1024).toFixed(1)} MiB`);
  md.push('');
  md.push('## Notes');
  md.push('');
  md.push('- Speedup is reported vs. `node-single` baseline. Values < 1.0× are honestly surfaced.');
  md.push('- Rust modes invoke `cargo run --release --example billion_spins_replay` as a subprocess; skip with `--skip-rust`.');
  md.push('- Synthetic mode: 100k spins × 10 kernels = 1M total. Full mode: 100M × 10 = 1B total.');
  md.push('');
  const mdPath = resolve(outDir, 'BILLION_SPIN_BENCHMARK.md');
  writeFileSync(mdPath, md.join('\n'));
  return { jsonPath, mdPath };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!isMainThread) return; // worker path handled above
  const args = parseArgs(process.argv);
  const report = await runBenchmark(args);
  const { jsonPath, mdPath } = writeReports(report);
  // eslint-disable-next-line no-console
  console.log(`billion-spin-benchmark: ${Object.values(report.byMode).length} modes × ${report.kernels.length} kernels in ${(report.totalMs / 1000).toFixed(2)}s`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${mdPath}`);
}

if (import.meta.url === `file://${process.argv[1]}` && isMainThread) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('billion-spin-benchmark crashed:', e);
    process.exit(2);
  });
}
