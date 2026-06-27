#!/usr/bin/env node
/**
 * CORTI W206-PERSISTENCE — Postgres latency bench.
 *
 * Measures p50/p95/p99 latency for the five hot paths:
 *   - SessionStore.create()
 *   - WalletStore.wager() (1000 sequential transactions)
 *   - AuditStore.append() (hash-chain insert)
 *   - SessionStore.get() (indexed SELECT)
 *   - WalletStore.transactions() (indexed SELECT)
 *
 * Target: p99 < 10ms for SELECT-style queries.
 *
 * Usage:
 *   USE_POSTGRES=true DATABASE_URL=postgres://user:pass@host:5432/db \
 *   node scripts/db-bench.mjs
 */

import { PgConnection } from '../dist/server/server/db/connection.js';
import { runMigrations } from '../dist/server/server/db/migrate.js';
import { PostgresSessionStore } from '../dist/server/server/state/sessions-pg.js';
import { PostgresWalletStore } from '../dist/server/server/state/wallet-pg.js';
import { PostgresAuditStore } from '../dist/server/server/state/audit-pg.js';

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function fmt(arr) {
  return {
    n: arr.length,
    p50: pct(arr, 0.50).toFixed(3),
    p95: pct(arr, 0.95).toFixed(3),
    p99: pct(arr, 0.99).toFixed(3),
    avg: (arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length)).toFixed(3),
  };
}

async function main() {
  if (process.env.USE_POSTGRES !== 'true') {
    console.error('[db-bench] set USE_POSTGRES=true and DATABASE_URL to run');
    process.exit(2);
  }
  const conn = new PgConnection();
  await conn.connect();
  await runMigrations(conn);

  const sessions = new PostgresSessionStore(conn);
  const wallet = new PostgresWalletStore(conn);
  const audit = new PostgresAuditStore(conn);

  // 1) 100 parallel session creations.
  const sessionT = [];
  {
    const ops = Array.from({ length: 100 }, async (_, i) => {
      const t = process.hrtime.bigint();
      await sessions.create({ playerId: `bench-${i}`, jurisdiction: 'GENERIC' });
      sessionT.push(Number(process.hrtime.bigint() - t) / 1e6);
    });
    await Promise.all(ops);
  }

  // 2) 1000 sequential wallet wagers on one player.
  const walletT = [];
  {
    await wallet.getOrCreate('bench-walleter');
    // Top up so we don't underflow.
    await wallet.deposit('bench-walleter', { amountMinor: 100_000_000 / 100 });
    for (let i = 0; i < 1000; i++) {
      const t = process.hrtime.bigint();
      await wallet.wager('bench-walleter', 1);
      walletT.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }

  // 3) Audit append throughput (1000 chained entries one session).
  const auditT = [];
  {
    for (let i = 0; i < 1000; i++) {
      const t = process.hrtime.bigint();
      await audit.append({ sessionId: 'bench-aud', type: 'spin', payload: { i } });
      auditT.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }

  // 4) 1000 indexed session GETs.
  const getT = [];
  {
    const target = (await sessions.create({ playerId: 'bench-get' })).sessionId;
    for (let i = 0; i < 1000; i++) {
      const t = process.hrtime.bigint();
      await sessions.get(target);
      getT.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }

  // 5) 200 transactions() queries (player history).
  const txT = [];
  {
    for (let i = 0; i < 200; i++) {
      const t = process.hrtime.bigint();
      await wallet.transactions('bench-walleter');
      txT.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }

  console.log(JSON.stringify({
    session_create: fmt(sessionT),
    wallet_wager:   fmt(walletT),
    audit_append:   fmt(auditT),
    session_get:    fmt(getT),
    wallet_history: fmt(txT),
    target_p99_ms:  10,
  }, null, 2));

  await conn.shutdown();
}

main().catch((err) => {
  console.error('[db-bench] failed:', err);
  process.exit(1);
});
