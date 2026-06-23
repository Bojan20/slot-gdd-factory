#!/usr/bin/env node
/**
 * tools/perf-benchmark.mjs
 *
 * N5 (2026-06-23) — Performance benchmark suite za operator tools.
 *
 * Meri wallclock + memory delta za reproducibilne, side-effect-free
 * operations: audit-summary build, portfolio rollup, per-game kernel
 * coverage walk, one-pager build, compare-games, web-dashboard render.
 * Output: ASCII tabela (box-drawing) + JSON trend file za regression
 * tracking kroz commit-e.
 *
 * ## Why
 * Bridge cache means single kernel calls are sub-ms, but the operator
 * tooling stack (audit-summary, dashboard render) is the real hot
 * path: regulator visits + CI runs. Knowing p50/p95 + memory budget
 * lets us catch regression early.
 *
 * ## Design
 *   - Each bench is a pure async fn — runs N iterations.
 *   - Warmup: 1 untimed run to populate caches / JIT.
 *   - Timed: 5 runs (configurable via --iterations N).
 *   - Captures: wallclock min/p50/p95/max + RSS delta + heapUsed delta.
 *   - Output: ASCII summary + reports/perf-benchmark/latest.json.
 *
 * ## USAGE
 *   node tools/perf-benchmark.mjs                # default 5 iterations
 *   node tools/perf-benchmark.mjs --iterations 10
 *   node tools/perf-benchmark.mjs --json
 *
 * ## EXIT
 *   0 — bench completed
 *   2 — required dependency (audit-summary.json etc) missing
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOnePager } from './gdd-one-pager.mjs';
import { buildComparison } from './compare-games.mjs';
import { loadDashboardData, renderHtml } from './web-dashboard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = join(REPO, 'reports/perf-benchmark');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

/* ── Stats (pure) ─────────────────────────────────────────────────────── */

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return +sorted[idx].toFixed(2);
}

export function summarise(samplesMs, rssDeltaMb, heapDeltaMb) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    n: samplesMs.length,
    minMs:   sorted.length === 0 ? null : +sorted[0].toFixed(2),
    p50Ms:   percentile(sorted, 50),
    p95Ms:   percentile(sorted, 95),
    maxMs:   sorted.length === 0 ? null : +sorted[sorted.length - 1].toFixed(2),
    meanMs:  sorted.length === 0 ? null : +(sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(2),
    rssDeltaMb:  rssDeltaMb != null ? +rssDeltaMb.toFixed(2) : null,
    heapDeltaMb: heapDeltaMb != null ? +heapDeltaMb.toFixed(2) : null,
  };
}

/* ── Runner ───────────────────────────────────────────────────────────── */

async function runBench(name, fn, iterations) {
  /* Warmup. */
  try { await fn(); } catch { /* swallow — counted in timed runs if persistent */ }
  /* Allow GC before measuring (best-effort — Node honours global.gc only with --expose-gc). */
  if (typeof global.gc === 'function') global.gc();
  const memBefore = process.memoryUsage();
  const samples = [];
  let lastErr = null;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try { await fn(); }
    catch (e) { lastErr = e; }
    samples.push(performance.now() - t0);
  }
  const memAfter = process.memoryUsage();
  const rssDeltaMb  = (memAfter.rss      - memBefore.rss)      / (1024 * 1024);
  const heapDeltaMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
  return {
    name,
    error: lastErr ? String(lastErr.message || lastErr).slice(0, 200) : null,
    ...summarise(samples, rssDeltaMb, heapDeltaMb),
  };
}

/* ── Bench cases (pure async closures) ────────────────────────────────── */

export function buildBenchCases() {
  return [
    { name: 'buildOnePager (single)',
      fn: () => buildOnePager('starlight-travellers-gdd') },
    { name: 'buildOnePager (5 baselines parallel)',
      fn: () => Promise.all(BASELINE_SLUGS.map(s => buildOnePager(s))) },
    { name: 'buildComparison (cluster vs lines)',
      fn: () => buildComparison('starlight-travellers-gdd', 'cash-eruption-foundry-gdd') },
    { name: 'loadDashboardData',
      fn: () => loadDashboardData() },
    { name: 'renderHtml (full dashboard)',
      fn: async () => { const d = await loadDashboardData(); renderHtml(d); } },
  ];
}

/* ── ASCII renderer (box-drawing per HARD RULE #3) ────────────────────── */

function pad(s, w) {
  const str = String(s ?? '—');
  if (str.length >= w) return str.slice(0, w);
  return str + ' '.repeat(w - str.length);
}

export function renderBenchTable(results) {
  const out = [];
  out.push('perf-benchmark · operator tool stack');
  out.push('');
  out.push('┌────────────────────────────────────────────┬─────┬─────────┬─────────┬─────────┬─────────┬─────────┐');
  out.push('│ Bench                                       │ N   │ min ms  │ p50 ms  │ p95 ms  │ max ms  │ heap+MB │');
  out.push('├────────────────────────────────────────────┼─────┼─────────┼─────────┼─────────┼─────────┼─────────┤');
  for (const r of results) {
    out.push('│ ' + pad(r.name, 42) + ' │ ' + pad(r.n, 3) + ' │ ' +
      pad(r.minMs, 7) + ' │ ' + pad(r.p50Ms, 7) + ' │ ' +
      pad(r.p95Ms, 7) + ' │ ' + pad(r.maxMs, 7) + ' │ ' +
      pad(r.heapDeltaMb, 7) + ' │');
  }
  out.push('└────────────────────────────────────────────┴─────┴─────────┴─────────┴─────────┴─────────┴─────────┘');
  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('perf-benchmark.mjs')) {
  const args = process.argv.slice(2);
  const itIdx = args.indexOf('--iterations');
  const iterations = itIdx >= 0 ? Math.max(1, parseInt(args[itIdx + 1] || '5', 10)) : 5;
  const jsonOnly = args.includes('--json');

  const auditPath = join(REPO, 'reports/audit-summary.json');
  if (!existsSync(auditPath)) {
    console.error(`▸ ${auditPath} missing — run tools/audit-summary.mjs first`);
    process.exit(2);
  }

  const cases = buildBenchCases();
  const results = [];
  for (const c of cases) {
    if (!jsonOnly) process.stdout.write(`  · ${c.name} ... `);
    const r = await runBench(c.name, c.fn, iterations);
    results.push(r);
    if (!jsonOnly) console.log(`p50=${r.p50Ms}ms p95=${r.p95Ms}ms`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/perf-benchmark.mjs',
    iterations,
    nodeVersion: process.version,
    platform: process.platform,
    results,
  };
  writeFileSync(join(OUT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('');
    console.log(renderBenchTable(results));
    console.log('');
    console.log(`✓ perf  →  ${join(OUT_DIR, 'latest.json')}`);
  }
  process.exit(0);
}

export default { summarise, buildBenchCases, renderBenchTable };
