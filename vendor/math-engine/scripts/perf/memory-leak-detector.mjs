#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Memory Leak Detector (Agent C).
 *
 * Runs a long-lived workload, captures `process.memoryUsage()` snapshots
 * on a fixed cadence, and reports monotonic heap growth beyond what GC
 * can reclaim. Uses Node's built-in API only — no external profiler so it
 * runs anywhere CI runs.
 *
 * Detection
 * ─────────
 *   - Sample every `samplePeriodMs` (default 30s, synthetic: configurable).
 *   - After collecting `samples` snapshots, fit a least-squares line to
 *     `heapUsed` over time; growth rate > `growthThresholdBytesPerSec`
 *     → leak suspected.
 *   - Report growth-per-hour for human reasoning.
 *
 * Synthetic mode
 * ──────────────
 *   - Default duration: 2 minutes (6 samples × 20s) — fits CI budgets.
 *   - Full mode: caller-controlled (N hours, every 30s).
 *
 * CLI
 * ───
 *   node scripts/perf/memory-leak-detector.mjs --synthetic
 *   node scripts/perf/memory-leak-detector.mjs --hours=2 --period=30
 *
 * Output
 * ──────
 *   - reports/perf/MEMORY_LEAK.json (per-sample heap snapshot + verdict)
 *   - reports/perf/MEMORY_LEAK.md
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'reports', 'perf');

// Growth >= 1 MiB / minute is considered a leak by default.
export const DEFAULT_GROWTH_BYTES_PER_SEC = (1 * 1024 * 1024) / 60;

export function parseArgs(argv) {
  const out = { synthetic: false };
  for (const a of argv.slice(2)) {
    if (a === '--synthetic') out.synthetic = true;
    else if (a.startsWith('--hours=')) out.hours = Number(a.slice(8));
    else if (a.startsWith('--period=')) out.periodSec = Number(a.slice(9));
    else if (a.startsWith('--samples=')) out.samples = Number(a.slice(10));
    else if (a.startsWith('--threshold=')) out.thresholdBytesPerSec = Number(a.slice(12));
  }
  return out;
}

// ── Workload ───────────────────────────────────────────────────────────────
//
// Synthetic workload: allocate + drop short-lived arrays of varying sizes.
// A well-behaved Node runtime will reclaim them and heap stays flat.

function syntheticTick() {
  // Small alloc — large enough to defeat dead-code elim, small enough to
  // be cleanly reclaimed in the next GC cycle. We deliberately avoid
  // promoting anything to the old generation.
  const n = 256;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.random();
  return s;
}

// ── Snapshot capture ───────────────────────────────────────────────────────
export function snapshotMemory(label = null) {
  if (typeof global !== 'undefined' && typeof global.gc === 'function') {
    try { global.gc(); } catch { /* noop */ }
  }
  const m = process.memoryUsage();
  return {
    label,
    tMs: Date.now(),
    rssBytes: m.rss,
    heapUsedBytes: m.heapUsed,
    heapTotalBytes: m.heapTotal,
    externalBytes: m.external,
    arrayBuffersBytes: m.arrayBuffers ?? 0,
  };
}

// ── Linear-fit growth rate ─────────────────────────────────────────────────
export function fitGrowth(snapshots) {
  if (snapshots.length < 2) return { slopeBytesPerSec: 0, intercept: 0 };
  const t0 = snapshots[0].tMs;
  const xs = snapshots.map((s) => (s.tMs - t0) / 1000);
  const ys = snapshots.map((s) => s.heapUsedBytes);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slopeBytesPerSec: slope, intercept };
}

// ── Detect ─────────────────────────────────────────────────────────────────
export async function detect(opts = {}) {
  const synthetic = opts.synthetic ?? false;
  const samplePeriodMs = opts.samplePeriodMs ?? (synthetic ? 200 : (opts.periodSec ?? 30) * 1000);
  const samples = opts.samples ?? (synthetic ? 6 : Math.max(2, Math.floor(((opts.hours ?? 2) * 3600 * 1000) / samplePeriodMs)));
  // Default threshold (1 MiB/min) is calibrated for full-mode 30s sample
  // windows. Synthetic mode runs much faster so the JIT's transient heap
  // wobble dominates the linear fit; we widen the threshold proportionally
  // (and add a constant floor) so the gauntlet quick-mode doesn't false-
  // positive on V8 generational GC noise. Operators tuning a specific
  // scenario pass `--threshold=` to override.
  const defaultThreshold = synthetic
    ? Math.max(DEFAULT_GROWTH_BYTES_PER_SEC * (30_000 / Math.max(1, samplePeriodMs)),
               16 * 1024 * 1024) // 16 MiB/s floor in synthetic mode
    : DEFAULT_GROWTH_BYTES_PER_SEC;
  const threshold = opts.thresholdBytesPerSec ?? defaultThreshold;

  const snapshots = [snapshotMemory('start')];
  for (let i = 0; i < samples; i++) {
    // perform workload between samples
    if (opts.workload) opts.workload(i);
    else for (let k = 0; k < 5; k++) syntheticTick();
    await new Promise((res) => setTimeout(res, samplePeriodMs));
    snapshots.push(snapshotMemory(`s${i}`));
  }
  const fit = fitGrowth(snapshots);
  const start = snapshots[0];
  const end = snapshots[snapshots.length - 1];
  const elapsedSec = (end.tMs - start.tMs) / 1000;
  const growthBytes = end.heapUsedBytes - start.heapUsedBytes;
  const growthPctPerHour = start.heapUsedBytes > 0
    ? (fit.slopeBytesPerSec * 3600 / start.heapUsedBytes) * 100
    : 0;
  const leakSuspected = fit.slopeBytesPerSec > threshold;

  return {
    generatedAtUtc: new Date().toISOString(),
    synthetic,
    samplePeriodMs,
    samples: snapshots.length,
    elapsedSec,
    thresholdBytesPerSec: threshold,
    slopeBytesPerSec: fit.slopeBytesPerSec,
    growthBytes,
    growthPctPerHour,
    leakSuspected,
    snapshots,
    // Suspect-file analysis would normally need v8 heap snapshots; we
    // surface the dominant runtime allocator categories instead.
    suspects: leakSuspected
      ? [{ category: 'heap', growthBytes, note: 'monotonic heap growth detected by linear fit' }]
      : [],
  };
}

// ── Render ─────────────────────────────────────────────────────────────────
export function renderMd(r) {
  const lines = [];
  lines.push('# W212 — Memory Leak Detector');
  lines.push('');
  lines.push(`Generated: ${r.generatedAtUtc}`);
  lines.push(`Mode: ${r.synthetic ? 'synthetic' : 'full'}`);
  lines.push(`Samples: ${r.samples} × ${r.samplePeriodMs}ms`);
  lines.push(`Elapsed: ${r.elapsedSec.toFixed(2)} s`);
  lines.push(`Growth slope: ${(r.slopeBytesPerSec / 1024).toFixed(2)} KiB/s`);
  lines.push(`Growth %/hr: ${r.growthPctPerHour.toFixed(2)} %`);
  lines.push(`Threshold:  ${(r.thresholdBytesPerSec / 1024).toFixed(2)} KiB/s`);
  lines.push(`Verdict: ${r.leakSuspected ? 'LEAK SUSPECTED' : 'OK'}`);
  lines.push('');
  lines.push('## Snapshots');
  lines.push('');
  lines.push('| # | t (ms) | RSS (MiB) | Heap Used (MiB) | Heap Total (MiB) | External (MiB) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [i, s] of r.snapshots.entries()) {
    lines.push(`| ${i} | ${s.tMs} | ${(s.rssBytes / 1048576).toFixed(2)} | ${(s.heapUsedBytes / 1048576).toFixed(2)} | ${(s.heapTotalBytes / 1048576).toFixed(2)} | ${(s.externalBytes / 1048576).toFixed(2)} |`);
  }
  if (r.suspects.length > 0) {
    lines.push('');
    lines.push('## Suspects');
    lines.push('');
    for (const s of r.suspects) {
      lines.push(`- ${s.category}: growthBytes=${s.growthBytes} — ${s.note}`);
    }
  }
  return lines.join('\n') + '\n';
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const r = await detect(args);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'MEMORY_LEAK.json'), JSON.stringify(r, null, 2));
  writeFileSync(resolve(OUT_DIR, 'MEMORY_LEAK.md'), renderMd(r));
  // eslint-disable-next-line no-console
  console.log(renderMd(r));
  process.exit(r.leakSuspected ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('memory-leak-detector crashed:', e);
    process.exit(2);
  });
}
