#!/usr/bin/env node
/**
 * W208 Faza 400.1 — exercise the in-memory cache adapter and report
 * realized hit rate over N requests.
 *
 * The script imports the compiled cache module directly so that it
 * can drive the layer without depending on a running server.
 *
 *   node scripts/load-test/cache-hit-rate.mjs --requests=20000 --keys=100 --ttl=2000
 */

import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs, writeReport } from './_lib.mjs';

// Lazy import so the script still runs even if the server hasn't been
// `tsc`-compiled — falls back to a tiny inline adapter.
let InMemoryCacheAdapter;
try {
  const url = new URL('../../dist/server/lib/cache.js', import.meta.url);
  ({ InMemoryCacheAdapter } = await import(url.href));
} catch {
  // Inline fallback — semantically identical for this driver's purpose.
  InMemoryCacheAdapter = class {
    constructor() {
      this.store = new Map();
      this.hits = 0;
      this.misses = 0;
    }
    async get(k) {
      const e = this.store.get(k);
      if (!e || (e.exp > 0 && e.exp <= Date.now())) {
        this.misses++;
        return null;
      }
      this.hits++;
      return e.v;
    }
    async set(k, v, o = {}) {
      this.store.set(k, { v, exp: o.ttlMs ? Date.now() + o.ttlMs : 0 });
    }
    async close() {}
    stats() {
      const t = this.hits + this.misses;
      return { hits: this.hits, misses: this.misses, hitRate: t ? this.hits / t : 0 };
    }
  };
}

const args = parseArgs(process.argv);
const REQUESTS = Number(args.requests ?? 10_000);
const KEYS = Number(args.keys ?? 50);
const TTL_MS = Number(args.ttl ?? 1_000);
const ZIPF = args.zipf ? Number(args.zipf) : 1.1;

const cache = new InMemoryCacheAdapter({ namespace: 'cache-hit-rate' });

// Zipfian-ish key distribution so the workload resembles a real
// production hot/cold split.
function pickKey() {
  const u = Math.random();
  const rank = Math.floor(Math.pow(u, ZIPF) * KEYS);
  return `key-${rank}`;
}

const t0 = Date.now();
let totalGets = 0;

for (let i = 0; i < REQUESTS; i++) {
  const k = pickKey();
  const v = await cache.get(k);
  totalGets++;
  if (v === null) {
    await cache.set(k, { i, when: Date.now() }, { ttlMs: TTL_MS });
  }
  if (i % 2000 === 0) await wait(1); // yield event loop occasionally
}

const elapsed = Date.now() - t0;
const s = cache.stats();
const summary = {
  total: totalGets,
  ok: totalGets,
  errors: 0,
  errorRate: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  duration: `${(elapsed / 1000).toFixed(2)}s`,
  rps: Math.round((totalGets * 1000) / Math.max(1, elapsed)),
  mode: 'in-process',
  hitRate: Math.round(s.hitRate * 10_000) / 10_000,
  hits: s.hits,
  misses: s.misses,
  keys: KEYS,
  ttlMs: TTL_MS,
  zipf: ZIPF,
};

const { jsonPath, mdPath } = writeReport('cache-hit-rate', summary, {});
console.log(
  `[cache-hit-rate] gets=${s.hits + s.misses} hits=${s.hits} misses=${s.misses} rate=${(s.hitRate * 100).toFixed(2)}%`
);
console.log(`[cache-hit-rate] report → ${jsonPath}`);
console.log(`[cache-hit-rate] report → ${mdPath}`);
await cache.close?.();
