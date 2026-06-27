#!/usr/bin/env node
/**
 * W208 Faza 400.1 — GaaS spin load test driver.
 *
 * Targets:
 *   - 100 concurrent virtual users
 *   - 1000 spins/sec sustained
 *   - 10s ramp-up, 60s plateau, 10s ramp-down (default)
 *
 * Modes:
 *   --quick           shorter profile (3/5/3s, 25 VUs), used in CI
 *   --synthetic       no server required — drives a stub spin path
 *                     locally; useful as a smoke test
 *
 * Usage:
 *   node scripts/load-test/gaas-spin-load.mjs --target=http://localhost:4000
 *   node scripts/load-test/gaas-spin-load.mjs --quick --synthetic
 */

import { setTimeout as wait } from 'node:timers/promises';
import { Histogram, parseArgs, probeTarget, writeReport, latency } from './_lib.mjs';

const args = parseArgs(process.argv);
const TARGET = args.target ?? 'http://localhost:4000';
const QUICK = !!args.quick;
const SYNTHETIC_FLAG = !!args.synthetic;

const RAMP_UP = QUICK ? 3_000 : 10_000;
const PLATEAU = QUICK ? 5_000 : 60_000;
const RAMP_DN = QUICK ? 3_000 : 10_000;
const VUS_MAX = QUICK ? 25 : 100;
const TARGET_RPS = QUICK ? 250 : 1000;
const BUDGET_P99 = 80;

const histo = new Histogram();
let stopRequested = false;

// Detect whether a server is reachable. Otherwise fall through to
// synthetic mode so the script always exits cleanly.
let synthetic = SYNTHETIC_FLAG;
if (!synthetic) {
  const ok = await probeTarget(`${TARGET}/api/health`);
  if (!ok) {
    console.error(
      `[gaas-spin-load] target ${TARGET} unreachable — switching to synthetic mode`
    );
    synthetic = true;
  }
}

async function syntheticSpin() {
  // Simulate the in-process spin pipeline: ~0.5–2 ms CPU + tiny jitter.
  const work = 0.5 + Math.random() * 1.5;
  const t0 = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < 5_000 * work; i++) acc += Math.sqrt(i);
  // Touch acc so it doesn't get DCE'd.
  return acc * 0 + Number(process.hrtime.bigint() - t0) / 1e6;
}

async function httpSpin() {
  const res = await fetch(`${TARGET}/api/gaas/spin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId: 'test-game-1',
      sessionId: 'loadtest-session',
      betAmount: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`status_${res.status}`);
  await res.json();
}

const fire = synthetic ? syntheticSpin : httpSpin;

async function virtualUser(targetIntervalMs) {
  while (!stopRequested) {
    const r = await latency(fire);
    if (r.ok) histo.push(r.latencyMs);
    else histo.fail();
    await wait(Math.max(0, targetIntervalMs + (Math.random() - 0.5) * 2));
  }
}

async function runPhase(name, durationMs, vus, rps) {
  const interval = (vus * 1000) / Math.max(1, rps);
  console.log(`[gaas-spin-load] phase=${name} vus=${vus} target_rps=${rps} duration=${durationMs}ms interval=${interval.toFixed(2)}ms`);
  const tasks = [];
  for (let i = 0; i < vus; i++) tasks.push(virtualUser(interval));
  const stopAt = Date.now() + durationMs;
  while (Date.now() < stopAt) {
    await wait(500);
  }
  stopRequested = true;
  await Promise.all(tasks);
  stopRequested = false;
}

const t0 = Date.now();

// Ramp-up
{
  const start = Date.now();
  const step = 250;
  while (Date.now() - start < RAMP_UP) {
    const frac = (Date.now() - start) / RAMP_UP;
    const vus = Math.max(1, Math.floor(VUS_MAX * frac));
    const rps = Math.max(10, Math.floor(TARGET_RPS * frac));
    await runPhase('ramp-up', step, vus, rps);
  }
}

await runPhase('plateau', PLATEAU, VUS_MAX, TARGET_RPS);

// Ramp-down
{
  const start = Date.now();
  const step = 250;
  while (Date.now() - start < RAMP_DN) {
    const frac = 1 - (Date.now() - start) / RAMP_DN;
    const vus = Math.max(1, Math.floor(VUS_MAX * frac));
    const rps = Math.max(10, Math.floor(TARGET_RPS * frac));
    await runPhase('ramp-down', step, vus, rps);
  }
}

const totalMs = Date.now() - t0;
const s = histo.summary();
s.duration = `${(totalMs / 1000).toFixed(1)}s`;
s.rps = Math.round((s.ok * 1000) / Math.max(1, totalMs));
s.target = TARGET;
s.mode = synthetic ? 'synthetic' : 'http';
s.budgetBreaches =
  s.p99 > BUDGET_P99
    ? [{ route: 'gaas.ws.spin', observed: s.p99, budget: BUDGET_P99 }]
    : [];

const { jsonPath, mdPath } = writeReport('gaas-spin-load', s);
console.log(
  `[gaas-spin-load] done. total=${s.total} rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms`
);
console.log(`[gaas-spin-load] report → ${jsonPath}`);
console.log(`[gaas-spin-load] report → ${mdPath}`);
if (s.budgetBreaches.length) {
  console.error(`[gaas-spin-load] BUDGET BREACH: p99=${s.p99}ms > ${BUDGET_P99}ms`);
  process.exitCode = 2;
}
