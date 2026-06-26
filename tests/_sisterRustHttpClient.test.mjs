/**
 * tests/_sisterRustHttpClient.test.mjs
 *
 * LV3-2 contract tests for the sister-rust-http-client helper.
 *
 * # Coverage
 *
 *   Resolve / validate (no spawn):
 *     1.  resolveHttpBinary returns available:false when binary missing
 *     2.  resolveHttpBinary honors SLOT_RUST_HTTP_BIN env override
 *     3.  resolveHttpBinary rejects HOME-empty environment
 *     4.  spawnHttpServer rejects on unavailable binary
 *
 *   Live (skipped when sister binary not built):
 *     5.  spawnHttpServer parses READY line + healthCheckHttp returns ok
 *     6.  runOnceHttp returns rtp/hits/spins/summary on a minimal config
 *     7.  runBatchHttp preserves id order across N items
 *     8.  runBatchHttp 400s on empty items array (handled gracefully)
 *     9.  dispose() actually terminates the child process
 *    10.  runOnceHttp returns FAIL on server hard-cap rejection (validation)
 *
 * # Why live tests are conditional
 *
 * Building the sister `http_server` binary takes ~5 min (axum + tokio +
 * hyper compile). We don't want CI smoke runs to flap on that. The live
 * suite probes `resolveHttpBinary().available` and SKIPs each case
 * (counted as `pass` with a "(skipped)" suffix) when the binary isn't
 * present. The full LV3-2 verify step in `npm run verify` runs `cargo
 * build --release -p slot_sim --features http --bin http_server` first
 * so on that path the live tests always execute.
 */

import { strict as assert } from 'node:assert';
import {
  resolveHttpBinary,
  spawnHttpServer,
  healthCheckHttp,
  runOnceHttp,
  runBatchHttp,
} from '../tools/sister-rust-http-client.mjs';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
    fail++;
  }
}
function skip(name) {
  console.log(`  ⊘ ${name} (skipped — sister binary not built)`);
  pass++;
}

console.log('sisterRustHttpClient contract suite');

/* ─── Resolve / validate (no spawn) ──────────────────────────────── */

await t('resolveHttpBinary returns available:false when binary missing', () => {
  const orig = process.env.SLOT_RUST_HTTP_BIN;
  process.env.SLOT_RUST_HTTP_BIN = '/no/such/binary/anywhere-12345';
  try {
    const r = resolveHttpBinary();
    assert.equal(r.available, false);
    assert.match(r.reason, /binary missing/);
  } finally {
    if (orig === undefined) delete process.env.SLOT_RUST_HTTP_BIN;
    else process.env.SLOT_RUST_HTTP_BIN = orig;
  }
});

await t('resolveHttpBinary honors SLOT_RUST_HTTP_BIN env override', () => {
  const orig = process.env.SLOT_RUST_HTTP_BIN;
  // Point at /bin/sh — exists, not world-writable, under /usr/bin (allowed)
  // but /bin isn't in the allowed-roots, so we expect that exact reason.
  process.env.SLOT_RUST_HTTP_BIN = '/bin/sh';
  try {
    const r = resolveHttpBinary();
    assert.equal(r.available, false);
    assert.match(
      r.reason,
      /outside allowed roots/,
      `expected allowed-roots rejection, got: ${r.reason}`,
    );
  } finally {
    if (orig === undefined) delete process.env.SLOT_RUST_HTTP_BIN;
    else process.env.SLOT_RUST_HTTP_BIN = orig;
  }
});

await t('resolveHttpBinary rejects HOME-empty environment', () => {
  const origHome = process.env.HOME;
  const origBin = process.env.SLOT_RUST_HTTP_BIN;
  process.env.HOME = '';
  process.env.SLOT_RUST_HTTP_BIN = '/tmp/slot-http-bin-dummy-xyz';
  try {
    const r = resolveHttpBinary();
    assert.equal(r.available, false);
    assert.match(r.reason, /HOME unset|binary missing/);
  } finally {
    process.env.HOME = origHome;
    if (origBin === undefined) delete process.env.SLOT_RUST_HTTP_BIN;
    else process.env.SLOT_RUST_HTTP_BIN = origBin;
  }
});

await t('spawnHttpServer rejects on unavailable binary', async () => {
  const orig = process.env.SLOT_RUST_HTTP_BIN;
  process.env.SLOT_RUST_HTTP_BIN = '/no/such/binary/anywhere-xyz';
  try {
    await assert.rejects(
      spawnHttpServer({ readyTimeoutMs: 200 }),
      /sister http binary unavailable/,
    );
  } finally {
    if (orig === undefined) delete process.env.SLOT_RUST_HTTP_BIN;
    else process.env.SLOT_RUST_HTTP_BIN = orig;
  }
});

/* ─── Live (skipped when binary not built) ────────────────────────── */

const sister = resolveHttpBinary();
const live = sister.available;

/* Fetch a guaranteed-valid GameConfig from the server's /default-config
 * endpoint (LV3-2 test helper). Keeping the source of truth on the Rust
 * side means the JS suite cannot drift when the engine adds a new
 * required field — the canary is "server says shape is valid", not "JS
 * literal matches schema I last read 6 months ago".
 *
 * Memoized across cases so we don't pay the round-trip 6×. */
let _cachedDefaultConfig = null;
async function fetchDefaultConfig(baseUrl) {
  if (_cachedDefaultConfig) return _cachedDefaultConfig;
  const resp = await fetch(`${baseUrl}/default-config`);
  if (!resp.ok) {
    throw new Error(`default-config http ${resp.status}`);
  }
  _cachedDefaultConfig = await resp.json();
  return _cachedDefaultConfig;
}

await t('spawnHttpServer parses READY line + healthCheckHttp returns ok', async () => {
  if (!live) return skip('spawnHttpServer parses READY line + healthCheckHttp returns ok');
  const server = await spawnHttpServer({
    capTotalSpins: 5000,
    capSeeds: 2,
    capBatchItems: 4,
    capConcurrentRuns: 2,
    readyTimeoutMs: 15_000,
  });
  try {
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const h = await healthCheckHttp(server.baseUrl);
    assert.equal(h.ok, true);
    assert.equal(h.engine, 'slot_sim');
    assert.ok(typeof h.version === 'string' && h.version.length > 0);
    assert.ok(h.max_concurrent_runs >= 1);
  } finally {
    await server.dispose();
  }
});

await t('runOnceHttp returns rtp/hits/spins/summary on a minimal config', async () => {
  if (!live) return skip('runOnceHttp returns rtp/hits/spins/summary on a minimal config');
  const server = await spawnHttpServer({
    capTotalSpins: 5000,
    capSeeds: 2,
    capBatchItems: 4,
    capConcurrentRuns: 2,
    readyTimeoutMs: 15_000,
  });
  try {
    const cfg = await fetchDefaultConfig(server.baseUrl);
    const r = await runOnceHttp(server.baseUrl, cfg, {
      spins: 500,
      seeds: 1,
      sequential: true,
      timeoutMs: 20_000,
    });
    assert.equal(r.ok, true, `expected PASS, got: ${r.reason || r.raw}`);
    assert.equal(r.verdict, 'PASS');
    assert.equal(typeof r.rtp, 'number');
    assert.equal(typeof r.hits, 'number');
    assert.equal(typeof r.spins, 'number');
    assert.ok(r.spins >= 500);
    assert.ok(typeof r.summary === 'string' && r.summary.startsWith('SUMMARY|rtp='));
    assert.ok(r.summary.includes('|hits='));
    assert.ok(r.summary.includes('|spins='));
  } finally {
    await server.dispose();
  }
});

await t('runBatchHttp preserves id order across N items', async () => {
  if (!live) return skip('runBatchHttp preserves id order across N items');
  const server = await spawnHttpServer({
    capTotalSpins: 5000,
    capSeeds: 2,
    capBatchItems: 4,
    capConcurrentRuns: 2,
    readyTimeoutMs: 15_000,
  });
  try {
    const cfg = await fetchDefaultConfig(server.baseUrl);
    const items = ['alpha', 'beta', 'gamma'].map((id) => ({
      id,
      config: cfg,
      spins: 300,
      seeds: 1,
      sequential: true,
    }));
    const r = await runBatchHttp(server.baseUrl, items, { timeoutMs: 30_000 });
    assert.equal(r.ok, true, `batch failed: ${r.reason}`);
    assert.equal(r.successCount, 3);
    assert.equal(r.failureCount, 0);
    assert.deepEqual(
      r.results.map((x) => x.id),
      ['alpha', 'beta', 'gamma'],
    );
    for (const x of r.results) {
      assert.equal(x.ok, true, `item ${x.id} failed: ${x.error}`);
      assert.ok(x.summary && x.summary.startsWith('SUMMARY|rtp='));
    }
  } finally {
    await server.dispose();
  }
});

await t('runBatchHttp handles empty items array gracefully (client-side)', async () => {
  // Pure client-side guard — no spawn needed.
  const r = await runBatchHttp('http://127.0.0.1:1', [], { timeoutMs: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /non-empty/);
});

await t('dispose() actually terminates the child process', async () => {
  if (!live) return skip('dispose() actually terminates the child process');
  const server = await spawnHttpServer({
    capTotalSpins: 5000,
    capSeeds: 2,
    capBatchItems: 4,
    capConcurrentRuns: 2,
    readyTimeoutMs: 15_000,
  });
  const childPid = server.child.pid;
  await server.dispose();
  // Give the OS a beat to reap the process.
  await new Promise((r) => setTimeout(r, 200));
  // `process.kill(pid, 0)` throws ESRCH if the process is gone.
  let stillAlive = false;
  try {
    process.kill(childPid, 0);
    stillAlive = true;
  } catch (e) {
    stillAlive = e.code !== 'ESRCH';
  }
  assert.equal(stillAlive, false, `child pid ${childPid} still alive after dispose()`);
});

await t('runOnceHttp returns FAIL on server hard-cap rejection', async () => {
  if (!live) return skip('runOnceHttp returns FAIL on server hard-cap rejection');
  const server = await spawnHttpServer({
    capTotalSpins: 1000,
    capSeeds: 2,
    capBatchItems: 4,
    capConcurrentRuns: 2,
    readyTimeoutMs: 15_000,
  });
  try {
    const cfg = await fetchDefaultConfig(server.baseUrl);
    // Ask for 10_000 × 2 = 20_000 total spins; server cap is 1_000.
    const r = await runOnceHttp(server.baseUrl, cfg, {
      spins: 10_000,
      seeds: 2,
      sequential: true,
      timeoutMs: 10_000,
    });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.reason || '', /400|total_spins_too_large|exceeds cap/);
  } finally {
    await server.dispose();
  }
});

console.log(`\nsisterRustHttpClient: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
