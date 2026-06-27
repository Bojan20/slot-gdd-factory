#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario: noisy neighbour.
 *
 * One tenant (`tenant-loud`) drives 10× the normal traffic; nine other
 * tenants drive baseline traffic. The per-tenant rate limit should
 * throttle `tenant-loud` while the other nine remain unaffected.
 */

import { MiniChaosController, TokenBucket, mulberry32, pretty } from './_lib.mjs';

const TENANT_COUNT = 10;
const BASELINE_RPS = 20;
const LOUD_MULT = 10;
const RATE_CAPACITY = 50; // burst
const RATE_REFILL = 30;   // per second per tenant
const DURATION_MS = 1_000;

class TenantLimiter {
  constructor() {
    this.buckets = new Map();
  }
  allow(tenantId) {
    let b = this.buckets.get(tenantId);
    if (!b) {
      b = new TokenBucket(RATE_CAPACITY, RATE_REFILL);
      this.buckets.set(tenantId, b);
    }
    return b.take();
  }
}

async function driveTraffic(limiter, tenantId, rps, durationMs) {
  const stats = { tenantId, attempted: 0, allowed: 0, rejected: 0 };
  const start = Date.now();
  const intervalMs = 1000 / rps;
  while (Date.now() - start < durationMs) {
    stats.attempted++;
    if (limiter.allow(tenantId)) stats.allowed++;
    else stats.rejected++;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return stats;
}

export async function runScenario(opts = {}) {
  const _rng = opts.rng ?? mulberry32(0xFEED);
  const limiter = new TenantLimiter();
  const tasks = [];
  // 9 normal tenants
  for (let i = 0; i < TENANT_COUNT - 1; i++) {
    tasks.push(driveTraffic(limiter, `tenant-${i}`, BASELINE_RPS, DURATION_MS));
  }
  // 1 loud tenant
  tasks.push(driveTraffic(limiter, 'tenant-loud', BASELINE_RPS * LOUD_MULT, DURATION_MS));

  const all = await Promise.all(tasks);
  const loud = all.find((s) => s.tenantId === 'tenant-loud');
  const quiet = all.filter((s) => s.tenantId !== 'tenant-loud');
  const quietRejectRate =
    quiet.reduce((a, b) => a + b.rejected / Math.max(1, b.attempted), 0) / quiet.length;
  const loudRejectRate = loud.rejected / Math.max(1, loud.attempted);

  const pass =
    loudRejectRate > 0.3 &&        // loud tenant is throttled
    quietRejectRate < 0.05;        // quiet tenants are clear
  return {
    name: 'noisy-neighbor',
    pass,
    summary: {
      loud,
      quietAvgRejectRate: Number(quietRejectRate.toFixed(4)),
      loudRejectRate: Number(loudRejectRate.toFixed(4)),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScenario().then((v) => {
    console.log(pretty(v));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  });
}
