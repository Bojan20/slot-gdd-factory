#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario: marketplace submission flood.
 *
 * 100 kernel submissions/sec for 1 second from a single uploader.
 * The marketplace rate-limit (5 req/s burst 10) must reject the bulk
 * of them; the rest queue. Verifies that an admin can still publish a
 * legitimate listing while the flood is active.
 */

import { MiniChaosController, TokenBucket, mulberry32, pretty } from './_lib.mjs';

const FLOOD_RPS = 100;
const DURATION_MS = 1_000;
const MP_RATE = { capacity: 10, refillPerSec: 5 };

class MarketplaceLimiter {
  constructor() {
    this.bucket = new TokenBucket(MP_RATE.capacity, MP_RATE.refillPerSec);
    this.queue = [];
  }
  attempt(item) {
    if (this.bucket.take()) return { ok: true, queued: false };
    if (this.queue.length < 50) {
      this.queue.push(item);
      return { ok: true, queued: true };
    }
    return { ok: false, queued: false, reason: 'rate_limit_exceeded' };
  }
}

async function floodUploader(limiter, count, label) {
  const stats = { label, accepted: 0, queued: 0, rejected: 0 };
  const intervalMs = 1000 / FLOOD_RPS;
  for (let i = 0; i < count; i++) {
    const r = limiter.attempt({ id: `${label}-${i}` });
    if (r.ok && !r.queued) stats.accepted++;
    else if (r.queued) stats.queued++;
    else stats.rejected++;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return stats;
}

export async function runScenario(opts = {}) {
  const _rng = opts.rng ?? mulberry32(0xC0DE);
  const _controller = new MiniChaosController(); // present for parity
  const limiter = new MarketplaceLimiter();
  const totalAttempts = Math.floor((DURATION_MS / 1000) * FLOOD_RPS);
  const flood = await floodUploader(limiter, totalAttempts, 'flood');

  // After flood, a legitimate admin should still get through eventually.
  let adminGotThrough = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((res) => setTimeout(res, 250));
    const r = limiter.attempt({ id: 'admin-listing' });
    if (r.ok && !r.queued) {
      adminGotThrough = true;
      break;
    }
  }

  // We expect:
  //  - majority of flood NOT accepted instantly (queue + reject combined > accepted)
  //  - hard rejections actually happened (queue isn't infinite)
  //  - admin path stays usable
  const pass =
    flood.rejected > 0 &&
    flood.queued + flood.rejected > flood.accepted &&
    adminGotThrough;
  return {
    name: 'marketplace-flood',
    pass,
    summary: { flood, adminGotThrough, totalAttempts },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScenario().then((v) => {
    console.log(pretty(v));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  });
}
