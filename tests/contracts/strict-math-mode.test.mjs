#!/usr/bin/env node
/**
 * tests/contracts/strict-math-mode.test.mjs
 *
 * UQ-DEEP-AN · AN-2 — STRICT_MATH env var fail-fast gate.
 *
 * Verifies tools/math-backend.mjs refuses to run /converge /spin /batch
 * against synthetic-fallback (untrusted) RTP targets when env-var
 * STRICT_MATH=true is set at process boot. Default (STRICT_MATH unset
 * or 'false') keeps existing soft-warning behavior — no breakage.
 *
 * Exempt endpoints (always pass independent of RTP trust):
 *   /audit (when exists), /serverConfig (compilation-only), /health
 *
 * Expected HTTP 422 body shape on strict block:
 *   { error: 'STRICT_MATH_UNTRUSTED_RTP', reason, rtpSource, remediation }
 *
 * Run: node tests/contracts/strict-math-mode.test.mjs
 * Exit 0 PASS, 1 FAIL.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const BACKEND = resolve(REPO, 'tools/math-backend.mjs');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

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

/* Spawn helper — returns { child, base, stdout, stderr, kill } for a
 * backend started with the given env-var STRICT_MATH value. */
async function spawnBackend({ strict, portBase }) {
  const env = { ...process.env };
  if (strict === undefined) delete env.STRICT_MATH;
  else env.STRICT_MATH = strict;
  /* Randomize within a window so concurrent test reruns don't collide. */
  const port = portBase + Math.floor(Math.random() * 50);
  const child = spawn('node', [BACKEND, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (b) => { stdoutBuf += b.toString(); });
  child.stderr.on('data', (b) => { stderrBuf += b.toString(); });
  /* Wait for listen banner. */
  let actualPort = port;
  let found = false;
  for (let waitMs = 0; waitMs < 6000; waitMs += 100) {
    await new Promise((r) => setTimeout(r, 100));
    for (let p = port; p < port + 12; p++) {
      try {
        const r = await fetch(`http://127.0.0.1:${p}/health`);
        if (r.ok) { actualPort = p; found = true; break; }
      } catch { /* still booting */ }
    }
    if (found) break;
  }
  if (!found) {
    try { child.kill('SIGKILL'); } catch {}
    throw new Error(`backend (strict=${strict}) never came online. stderr: ${stderrBuf.slice(0, 400)}`);
  }
  return {
    child,
    port: actualPort,
    base: `http://127.0.0.1:${actualPort}`,
    getStdout: () => stdoutBuf,
    getStderr: () => stderrBuf,
    kill: () => { try { child.kill('SIGTERM'); } catch {} },
  };
}

console.log('═══ strict-math-mode.test.mjs (UQ-DEEP-AN · AN-2) ═══');

/* Three backends to exercise the matrix: unset, 'false', 'true'.
 * Each tests its branch and is shut down at the end. */
const backends = {};

try {
  backends.unset  = await spawnBackend({ strict: undefined, portBase: 9100 });
  backends.falsy  = await spawnBackend({ strict: 'false',   portBase: 9160 });
  backends.strict = await spawnBackend({ strict: 'true',    portBase: 9220 });

  /* Models for each rtpSource branch. */
  const modelSynthetic = {
    payback: { rtp: 0.96, rtpSource: 'synthetic-fallback-96', hitFrequency: 0.21, maxWinX: 5000 },
  };
  const modelGddProse = {
    payback: { rtp: 0.96, rtpSource: 'gdd-prose', hitFrequency: 0.21, maxWinX: 5000 },
  };
  const modelParSheet = {
    payback: { rtp: 0.965, rtpSource: 'par-sheet', hitFrequency: 0.20, maxWinX: 5000 },
  };

  /* 1 — STRICT_MATH not set → /converge sa synthetic RTP prolazi. */
  await test('1. STRICT_MATH unset → /converge synthetic passes (no 422)', async () => {
    const r = await fetch(`${backends.unset.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic, maxSpins: 10_000 }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const j = await r.json();
    assert(j.ok === true, 'ok should be true');
  });

  /* 2 — STRICT_MATH=false → /converge sa synthetic RTP prolazi. */
  await test("2. STRICT_MATH='false' → /converge synthetic passes (no 422)", async () => {
    const r = await fetch(`${backends.falsy.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic, maxSpins: 10_000 }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const j = await r.json();
    assert(j.ok === true, 'ok should be true');
  });

  /* 3 — STRICT_MATH=true → /converge sa synthetic RTP returns 422 sa STRICT_MATH_UNTRUSTED_RTP. */
  await test("3. STRICT_MATH='true' → /converge synthetic returns 422 STRICT_MATH_UNTRUSTED_RTP", async () => {
    const r = await fetch(`${backends.strict.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic, maxSpins: 10_000 }),
    });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    const j = await r.json();
    assert(j.error === 'STRICT_MATH_UNTRUSTED_RTP', `error code mismatch: ${j.error}`);
  });

  /* 4 — STRICT_MATH=true → /converge sa gdd-prose RTP prolazi normalno. */
  await test("4. STRICT_MATH='true' → /converge gdd-prose passes", async () => {
    const r = await fetch(`${backends.strict.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelGddProse, maxSpins: 10_000 }),
    });
    const status = r.status;
    const j = await r.json();
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(j).slice(0, 200)}`);
    assert(j.ok === true, 'ok should be true');
  });

  /* 5 — STRICT_MATH=true → /converge sa par-sheet RTP prolazi. */
  await test("5. STRICT_MATH='true' → /converge par-sheet passes", async () => {
    const r = await fetch(`${backends.strict.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelParSheet, maxSpins: 10_000 }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const j = await r.json();
    assert(j.ok === true, 'ok should be true');
  });

  /* 6 — STRICT_MATH=true → /spin sa synthetic RTP returns 422. */
  await test("6. STRICT_MATH='true' → /spin synthetic returns 422", async () => {
    const r = await fetch(`${backends.strict.base}/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sid-strict-1', model: modelSynthetic }),
    });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    const j = await r.json();
    assert(j.error === 'STRICT_MATH_UNTRUSTED_RTP', `error code mismatch: ${j.error}`);
  });

  /* 7 — STRICT_MATH=true → /batch sa synthetic RTP returns 422. */
  await test("7. STRICT_MATH='true' → /batch synthetic returns 422", async () => {
    const r = await fetch(`${backends.strict.base}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spins: 10_000, seed: 42, model: modelSynthetic }),
    });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    const j = await r.json();
    assert(j.error === 'STRICT_MATH_UNTRUSTED_RTP', `error code mismatch: ${j.error}`);
  });

  /* 8 — STRICT_MATH=true → /audit NE proverava (audit-only ops moraju da
   * prođu nezavisno od rtpSource trust-a). KLJUČNO: response NIJE 422 ni
   * sa synthetic RTP — strict guard ne sme da intercepuje. Body shape
   * može da bude bilo šta (200 success, 400 unknown sub-route, 404 route
   * not found, etc.) — jedino zabranjeno je 422 STRICT_MATH_UNTRUSTED_RTP. */
  await test("8. STRICT_MATH='true' → /audit not intercepted by strict guard", async () => {
    const r = await fetch(`${backends.strict.base}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic }),
    });
    assert(r.status !== 422, `audit must not be intercepted by strict gate, got 422`);
    /* Also try GET — common audit pattern. */
    const r2 = await fetch(`${backends.strict.base}/audit`);
    assert(r2.status !== 422, `audit GET must not be intercepted by strict gate, got 422`);
    /* Either 200/400/404 — what matters is strict gate didn't fire 422. */
    assert([200, 400, 404].includes(r.status),
      `unexpected /audit POST status: ${r.status} (must be 200/400/404)`);
  });

  /* 9 — STRICT_MATH=true → /serverConfig NE proverava. */
  await test("9. STRICT_MATH='true' → /serverConfig synthetic passes (compilation-only)", async () => {
    const r = await fetch(`${backends.strict.base}/serverConfig`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic }),
    });
    assert(r.status !== 422, `serverConfig must NOT be intercepted by strict gate`);
    /* serverConfig is compilation-only — should be 200 (success) or 500
     * (sgs-compiler may fail on minimal model — that's allowed; what matters
     * is the strict gate did not fire). */
    assert(r.status === 200 || r.status === 500, `expected 200 or 500, got ${r.status}`);
  });

  /* 10 — STRICT_MATH=true → /health NE proverava (no body needed). */
  await test("10. STRICT_MATH='true' → /health passes (no body, no strict check)", async () => {
    const r = await fetch(`${backends.strict.base}/health`);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const j = await r.json();
    assert(j.ok === true, 'health ok flag missing');
    assert(j.server === 'math-backend', 'server identity missing');
  });

  /* 11 — Response 422 sadrži error code STRICT_MATH_UNTRUSTED_RTP. */
  await test('11. 422 response contains error: STRICT_MATH_UNTRUSTED_RTP', async () => {
    const r = await fetch(`${backends.strict.base}/converge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSynthetic, maxSpins: 10_000 }),
    });
    const j = await r.json();
    assert(j.error === 'STRICT_MATH_UNTRUSTED_RTP', `error mismatch: ${JSON.stringify(j)}`);
  });

  /* 12 — Response 422 sadrži rtpSource field. */
  await test('12. 422 response contains rtpSource field', async () => {
    const r = await fetch(`${backends.strict.base}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spins: 10_000, model: modelSynthetic }),
    });
    const j = await r.json();
    assert(j.rtpSource === 'synthetic-fallback-96', `rtpSource missing or wrong: ${j.rtpSource}`);
  });

  /* 13 — Response 422 sadrži remediation string. */
  await test('13. 422 response contains remediation string', async () => {
    const r = await fetch(`${backends.strict.base}/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sid-strict-13', model: modelSynthetic }),
    });
    const j = await r.json();
    assert(typeof j.remediation === 'string' && j.remediation.length > 10,
      `remediation missing or too short: ${j.remediation}`);
    /* Remediation should mention GDD or PAR — actionable guidance. */
    assert(/GDD|PAR/i.test(j.remediation), `remediation must mention GDD or PAR: ${j.remediation}`);
  });

  /* 14 — Process boot message logs STRICT_MATH state.
   * Captured from stdout buffer during spawnBackend. */
  await test('14. Boot message logs STRICT_MATH state', async () => {
    const stdoutStrict = backends.strict.getStdout();
    const stdoutUnset = backends.unset.getStdout();
    assert(/STRICT_MATH=true/.test(stdoutStrict),
      `strict backend boot log missing STRICT_MATH=true: ${stdoutStrict.slice(0, 400)}`);
    assert(/STRICT_MATH=false/.test(stdoutUnset),
      `unset backend boot log missing STRICT_MATH=false: ${stdoutUnset.slice(0, 400)}`);
  });

  /* 15 — Restart sa STRICT_MATH=true after spin endpoint behavior changes.
   * Verifikuje: pre restart-a (STRICT_MATH=false backend), synthetic spin
   * radi. Posle restart-a (STRICT_MATH=true backend, drugi proces),
   * synthetic spin failuje. */
  await test('15. Behavior toggles between unset and strict instances', async () => {
    /* Synthetic spin against UNSET backend — passes. */
    const rPass = await fetch(`${backends.unset.base}/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sid-toggle-15', model: modelSynthetic }),
    });
    assert(rPass.status === 200, `unset backend should accept synthetic /spin, got ${rPass.status}`);
    /* Same synthetic spin against STRICT backend — fails 422. */
    const rFail = await fetch(`${backends.strict.base}/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sid-toggle-15b', model: modelSynthetic }),
    });
    assert(rFail.status === 422, `strict backend should reject synthetic /spin, got ${rFail.status}`);
    const jFail = await rFail.json();
    assert(jFail.error === 'STRICT_MATH_UNTRUSTED_RTP', `strict /spin error mismatch: ${jFail.error}`);
  });

} finally {
  for (const b of Object.values(backends)) {
    if (b && b.kill) b.kill();
  }
  await new Promise((r) => setTimeout(r, 400));
}

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
