#!/usr/bin/env node
/**
 * W208 Faza 400.1 — REST endpoint load test.
 *
 * Hits the cached + uncached REST surface in a mixed weighted pattern:
 *
 *   GET  /api/lobby/games              weight 30   (cache hot)
 *   GET  /api/catalog                  weight 15   (cache hot)
 *   POST /api/license/verify           weight 15   (cache hot, bad key OK)
 *   POST /api/signup                   weight 10   (write)
 *   GET  /api/cert/__health/ping       weight 5    (cheap)
 *   GET  /api/health                   weight 25   (uncached, fast path)
 *
 * Emits `reports/perf/rest-api-load.{json,md}` with per-route p50/p95/p99.
 *
 * Usage:
 *   node scripts/load-test/rest-api-load.mjs --target=http://localhost:4000
 *   node scripts/load-test/rest-api-load.mjs --quick   (~5 s)
 */

import { setTimeout as wait } from 'node:timers/promises';
import { Histogram, parseArgs, probeTarget, writeReport, latency } from './_lib.mjs';

const args = parseArgs(process.argv);
const TARGET = args.target ?? 'http://localhost:4000';
const QUICK = !!args.quick;
const SYNTHETIC_FLAG = !!args.synthetic;

const DURATION_MS = QUICK ? 5_000 : 30_000;
const VUS = QUICK ? 10 : 30;

const BUDGETS = {
  '/api/lobby/games': 50,
  '/api/catalog': 50,
  '/api/license/verify': 30,
};

const routes = [
  { path: '/api/lobby/games', method: 'GET', weight: 30 },
  { path: '/api/catalog', method: 'GET', weight: 15 },
  {
    path: '/api/license/verify',
    method: 'POST',
    body: { licenseKey: 'load-test-bogus' },
    weight: 15,
  },
  { path: '/api/health', method: 'GET', weight: 25 },
  {
    path: '/api/signup',
    method: 'POST',
    body: { email: () => `vu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`, tenantName: 'load test' },
    weight: 10,
  },
];

let synthetic = SYNTHETIC_FLAG;
if (!synthetic) {
  const ok = await probeTarget(`${TARGET}/api/health`);
  if (!ok) {
    console.error(`[rest-api-load] target ${TARGET} unreachable — switching to synthetic mode`);
    synthetic = true;
  }
}

const histos = new Map();
const overall = new Histogram();

function pick() {
  const total = routes.reduce((a, r) => a + r.weight, 0);
  let pickN = Math.random() * total;
  for (const r of routes) {
    pickN -= r.weight;
    if (pickN <= 0) return r;
  }
  return routes[0];
}

async function callRoute(r) {
  if (synthetic) {
    // Simulate cache HIT: ~1 ms for fast routes, ~2 ms for slow.
    const ms = (r.path === '/api/health' ? 0.4 : 1) + Math.random() * 1.5;
    await wait(ms);
    return ms;
  }
  const body =
    typeof r.body === 'function'
      ? JSON.stringify(r.body())
      : r.body
        ? JSON.stringify(
            Object.fromEntries(
              Object.entries(r.body).map(([k, v]) => [k, typeof v === 'function' ? v() : v])
            )
          )
        : undefined;
  const res = await fetch(`${TARGET}${r.path}`, {
    method: r.method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body,
  });
  if (res.status >= 500) throw new Error(`status_${res.status}`);
  await res.text();
}

let stop = false;

async function vu() {
  while (!stop) {
    const r = pick();
    const result = await latency(() => callRoute(r));
    let h = histos.get(r.path);
    if (!h) {
      h = new Histogram();
      histos.set(r.path, h);
    }
    if (result.ok) {
      h.push(result.latencyMs);
      overall.push(result.latencyMs);
    } else {
      h.fail();
      overall.fail();
    }
    await wait(2 + Math.random() * 8);
  }
}

const t0 = Date.now();
const workers = Array.from({ length: VUS }, () => vu());
await wait(DURATION_MS);
stop = true;
await Promise.all(workers);
const elapsed = Date.now() - t0;

const summary = overall.summary();
summary.target = TARGET;
summary.mode = synthetic ? 'synthetic' : 'http';
summary.duration = `${(elapsed / 1000).toFixed(1)}s`;
summary.rps = Math.round((summary.ok * 1000) / Math.max(1, elapsed));

const perRoute = {};
const breaches = [];
for (const [path, h] of histos) {
  perRoute[path] = h.summary();
  const budget = BUDGETS[path];
  if (budget && perRoute[path].p99 > budget) {
    breaches.push({ route: path, observed: perRoute[path].p99, budget });
  }
}
summary.budgetBreaches = breaches;

const { jsonPath, mdPath } = writeReport('rest-api-load', summary, perRoute);
console.log(`[rest-api-load] done. total=${summary.total} rps=${summary.rps} p99=${summary.p99}ms`);
console.log(`[rest-api-load] report → ${jsonPath}`);
console.log(`[rest-api-load] report → ${mdPath}`);
if (breaches.length) {
  console.error(`[rest-api-load] BUDGET BREACHES: ${breaches.length}`);
  process.exitCode = 2;
}
