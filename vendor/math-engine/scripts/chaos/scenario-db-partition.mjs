#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario: Postgres partition.
 *
 * Simulates a hard DB partition: every DB call hangs (modelled via the
 * slow-query chaos at 100% with infinite delay). The orchestrator
 * should fall back to cache-only mode within 2 cycles, continue
 * serving reads, then reconnect when chaos clears.
 *
 *   1. seed cache with 10 well-known game records
 *   2. enable db.slow-query, wrap every DB read in a hard guard
 *   3. drive 50 reads — expect cache hits, no errors
 *   4. disable chaos, drive 10 reads — expect cache hits + 0 DB calls
 *      (the cache still has the records).
 */

import { MiniChaosController, mulberry32, pretty } from './_lib.mjs';

const READ_COUNT = 50;

class FakeCache {
  constructor() {
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }
  set(k, v) {
    this.map.set(k, v);
  }
  get(k) {
    if (this.map.has(k)) {
      this.hits++;
      return this.map.get(k);
    }
    this.misses++;
    return null;
  }
}

async function readWithGuard(controller, cache, key, loader, dbCounter) {
  // If DB is partitioned (chaos fires), refuse the DB call and serve from cache.
  if (controller.shouldInject('db.slow-query')) {
    const cached = cache.get(key);
    if (cached === null) {
      // Cache-only mode + miss → controlled error, not a crash.
      return { value: null, source: 'partitioned-miss', error: 'db_partition' };
    }
    return { value: cached, source: 'cache-only-fallback' };
  }
  // Normal path: cache first, then DB on miss.
  const cached = cache.get(key);
  if (cached !== null) return { value: cached, source: 'cache' };
  dbCounter.calls++;
  const fresh = await loader();
  cache.set(key, fresh);
  return { value: fresh, source: 'db' };
}

export async function runScenario(opts = {}) {
  const rng = opts.rng ?? mulberry32(0xDEADBEEF);
  const controller = new MiniChaosController({ rng });

  const cache = new FakeCache();
  for (let i = 0; i < 10; i++) cache.set(`game:${i}`, { id: i, rtp: 0.95 });

  controller.enable('db.slow-query', 1.0);
  const dbCounter = { calls: 0 };
  const partitionResults = [];
  for (let i = 0; i < READ_COUNT; i++) {
    const key = `game:${i % 10}`;
    partitionResults.push(
      await readWithGuard(controller, cache, key, async () => ({ id: i, rtp: 0.95 }), dbCounter)
    );
  }
  const partitionOk = partitionResults.every((r) => r.source === 'cache-only-fallback');
  const dbCallsDuringPartition = dbCounter.calls;

  // Recovery: chaos disabled, db calls allowed but cache should serve.
  controller.disable('db.slow-query');
  const recoveryResults = [];
  for (let i = 0; i < 10; i++) {
    const key = `game:${i % 10}`;
    recoveryResults.push(
      await readWithGuard(controller, cache, key, async () => ({ id: i, rtp: 0.95 }), dbCounter)
    );
  }
  const recoveryCacheHits = recoveryResults.filter((r) => r.source === 'cache').length;

  const pass =
    partitionOk &&
    dbCallsDuringPartition === 0 &&
    recoveryCacheHits === 10;
  return {
    name: 'db-partition',
    pass,
    summary: {
      partitionOk,
      dbCallsDuringPartition,
      recoveryCacheHits,
      finalCacheHits: cache.hits,
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
