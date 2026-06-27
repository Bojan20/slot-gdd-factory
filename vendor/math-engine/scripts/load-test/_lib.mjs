/**
 * Shared helpers for W208 load-test scripts.
 *
 * Implements:
 *   - latency() — async wrapper that returns { ok, latencyMs, err? }
 *   - Histogram — fixed-size in-memory percentile tracker
 *   - writeReport() — emits both .json and .md to reports/perf/
 *   - parseArgs() — minimal CLI parser (no extra deps)
 *   - probeTarget() — checks whether the target URL is reachable
 *
 * Deliberately zero external deps so the scripts run on any node 18+.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

export class Histogram {
  constructor(cap = 100_000) {
    this.cap = cap;
    this.samples = [];
    this.errors = 0;
    this.total = 0;
  }
  push(ms) {
    this.total++;
    if (this.samples.length < this.cap) this.samples.push(ms);
    else {
      const i = Math.floor(Math.random() * this.total);
      if (i < this.cap) this.samples[i] = ms;
    }
  }
  fail() {
    this.errors++;
    this.total++;
  }
  percentile(q) {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(q * (sorted.length - 1)))
    );
    return sorted[idx];
  }
  summary() {
    const ok = this.total - this.errors;
    return {
      total: this.total,
      ok,
      errors: this.errors,
      errorRate: this.total === 0 ? 0 : this.errors / this.total,
      p50: round(this.percentile(0.5)),
      p95: round(this.percentile(0.95)),
      p99: round(this.percentile(0.99)),
      max: round(this.samples.length ? Math.max(...this.samples) : 0),
      mean: round(
        this.samples.length
          ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length
          : 0
      ),
    };
  }
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

export async function latency(fn) {
  const t0 = process.hrtime.bigint();
  try {
    const out = await fn();
    return { ok: true, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6, value: out };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Number(process.hrtime.bigint() - t0) / 1e6,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeTarget(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

export function writeReport(name, summary, perRoute = {}) {
  const dir = resolve(REPO_ROOT, 'reports', 'perf');
  mkdirSync(dir, { recursive: true });

  const jsonPath = resolve(dir, `${name}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, perRoute }, null, 2)
  );

  const md = renderMd(name, summary, perRoute);
  const mdPath = resolve(dir, `${name}.md`);
  writeFileSync(mdPath, md);

  return { jsonPath, mdPath };
}

function renderMd(name, summary, perRoute) {
  const lines = [];
  lines.push(`# Load-test report — ${name}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  if (summary.mode) lines.push(`Mode: \`${summary.mode}\``);
  if (summary.target) lines.push(`Target: \`${summary.target}\``);
  if (summary.duration) lines.push(`Duration: ${summary.duration}`);
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Total requests | ${summary.total ?? 0} |`);
  lines.push(`| OK | ${summary.ok ?? 0} |`);
  lines.push(`| Errors | ${summary.errors ?? 0} |`);
  lines.push(`| Error rate | ${pct(summary.errorRate ?? 0)} |`);
  lines.push(`| p50 latency (ms) | ${summary.p50 ?? 0} |`);
  lines.push(`| p95 latency (ms) | ${summary.p95 ?? 0} |`);
  lines.push(`| p99 latency (ms) | ${summary.p99 ?? 0} |`);
  lines.push(`| Throughput (rps) | ${summary.rps ?? 0} |`);
  lines.push('');
  const routes = Object.keys(perRoute);
  if (routes.length > 0) {
    lines.push('## Per-route');
    lines.push('');
    lines.push('| Route | Count | p50 | p95 | p99 | Errors |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const r of routes) {
      const s = perRoute[r];
      lines.push(`| ${r} | ${s.total} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.errors} |`);
    }
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('');
  lines.push('- Latency includes network + server + JSON parse.');
  lines.push('- p99 budgets come from `server/lib/latency-budget.ts`.');
  if (summary.budgetBreaches?.length) {
    lines.push('');
    lines.push('### Budget breaches');
    lines.push('');
    for (const b of summary.budgetBreaches) {
      lines.push(`- ${b.route}: observed p99=${b.observed}ms vs budget ${b.budget}ms`);
    }
  }
  return lines.join('\n') + '\n';
}

function pct(n) {
  return `${(n * 100).toFixed(2)}%`;
}
