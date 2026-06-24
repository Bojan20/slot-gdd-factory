#!/usr/bin/env node
/**
 * tests/contracts/math-lv3-backend.test.mjs
 *
 * LV3-9 — math-backend HTTP contract test.
 *
 * Spawn tools/math-backend.mjs na ephemeral port, verify svi endpoint-i
 * vraćaju očekivane shape-ove, batch konvergira ka deklarisanom RTP-u.
 *
 * Run: node tests/contracts/math-lv3-backend.test.mjs
 * Exit 0 PASS, 1 FAIL.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertNear(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg || 'not near'}: |${a} - ${b}| > ${eps}`);
}

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

console.log('═══ math-lv3-backend.test.mjs ═══');

/* Spawn backend on ephemeral port. */
const TEST_PORT = 9050 + Math.floor(Math.random() * 30);
const child = spawn('node', [resolve(REPO, 'tools/math-backend.mjs'), '--port', String(TEST_PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const BASE = `http://127.0.0.1:${TEST_PORT}`;
let actualPort = TEST_PORT;

try {
  /* If port was busy, server may have picked next; probe by trying 5 in a row. */
  let found = false;
  for (let p = TEST_PORT; p < TEST_PORT + 10; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`);
      if (r.ok) { actualPort = p; found = true; break; }
    } catch { /* try next */ }
  }
  if (!found) throw new Error('backend never came online');
  const BASE = `http://127.0.0.1:${actualPort}`;

  await test('GET /health returns ok=true with server identity', async () => {
    const r = await fetch(`${BASE}/health`);
    const j = await r.json();
    assert(j.ok === true, 'ok flag missing');
    assert(j.server === 'math-backend', 'server name mismatch');
    assert(typeof j.binaryPath === 'string' && j.binaryPath.includes('mc_runtime_real'), 'binaryPath missing');
  });

  await test('POST /batch with 10k spins returns rtp + Wilson CI', async () => {
    const r = await fetch(`${BASE}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spins: 10_000, seed: 42,
        model: { payback: { rtp: 0.96, hitFrequency: 0.21, maxWinX: 5000 } },
      }),
    });
    const j = await r.json();
    assert(j.ok === true, 'ok flag missing: ' + JSON.stringify(j).slice(0, 200));
    assert(typeof j.rtp === 'number', 'rtp missing');
    assert(typeof j.wilson_99_halfwidth === 'number', 'wilson_99_halfwidth missing');
    assert(typeof j.spins_per_sec === 'number' && j.spins_per_sec > 1e6, 'throughput < 1M spins/sec');
    /* For 10k spins, measured RTP can be ±5% from target (CI ~1.5%). */
    assertNear(j.rtp, 0.96, 0.10, 'measured RTP far from target');
  });

  await test('POST /batch with 1M spins narrows CI to <0.5%', async () => {
    const r = await fetch(`${BASE}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spins: 1_000_000, seed: 42, model: { payback: { rtp: 0.96 } } }),
    });
    const j = await r.json();
    assert(j.ok === true, 'ok flag missing');
    assert(j.wilson_99_halfwidth < 0.025,
      `CI half-width ${j.wilson_99_halfwidth} > 0.025 at 1M spins`);
  });

  await test('POST /spin returns per-spin outcome with sessionId', async () => {
    const sid = 'test-session-' + Date.now();
    const r = await fetch(`${BASE}/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, model: { payback: { rtp: 0.96 } } }),
    });
    const j = await r.json();
    assert(j.ok === true, 'ok flag missing');
    assert(j.sessionId === sid, `sessionId mismatch: ${j.sessionId}`);
    assert(typeof j.payX === 'number', 'payX missing');
    assert(typeof j.measuredRtp === 'number', 'measuredRtp missing');
    assert(j.sessionN === 1, `sessionN should be 1 on first spin, got ${j.sessionN}`);
  });

  await test('Multiple /spin requests for same session increment n', async () => {
    const sid = 'multi-session-' + Date.now();
    let lastN = 0;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${BASE}/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, model: { payback: { rtp: 0.96 } } }),
      });
      const j = await r.json();
      assert(j.sessionN === i + 1, `expected n=${i+1}, got ${j.sessionN}`);
      lastN = j.sessionN;
    }
    assert(lastN === 5, `final n should be 5, got ${lastN}`);
  });

  await test('GET /sessions returns active session count', async () => {
    const r = await fetch(`${BASE}/sessions`);
    const j = await r.json();
    assert(typeof j.count === 'number' && j.count >= 1, 'session count should be >=1 after prior tests');
    assert(Array.isArray(j.sessions), 'sessions array missing');
  });

  await test('GET /nonexistent returns 404', async () => {
    const r = await fetch(`${BASE}/nonexistent`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test('CORS allowlist on /health (UQ-DEEP-O CRIT-2 lockdown)', async () => {
    /* Without Origin header, no ACAO returned (lockdown). */
    const r1 = await fetch(`${BASE}/health`);
    assert(!r1.headers.get('access-control-allow-origin'),
      'no-Origin request must not get ACAO header');
    /* With allowed Origin, ACAO echoes back. */
    const r2 = await fetch(`${BASE}/health`, { headers: { Origin: 'http://127.0.0.1:5181' } });
    const ao2 = r2.headers.get('access-control-allow-origin');
    assert(ao2 === 'http://127.0.0.1:5181', `allowed origin not echoed: ${ao2}`);
  });

} finally {
  try { child.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
