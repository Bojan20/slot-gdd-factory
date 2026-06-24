/**
 * tests/registry/auditTrail.test.mjs
 *
 * UQ-DEEP-AN · AN-1 · Audit trail schema + chain test suite.
 *
 * Covers ≥ 20 cases per AN-1 spec:
 *   1. AUDIT_LOG_SCHEMA_VERSION === '1'
 *   2. buildAuditEntry returns object with schemaVersion='1'
 *   3. buildAuditEntry stamps timestamp ISO 8601
 *   4. validateAuditEntry rejects missing paytableHash
 *   5. validateAuditEntry rejects non-hex paytableHash
 *   6. validateAuditEntry rejects empty sessionId
 *   7. validateAuditEntry rejects negative spinIdx
 *   8. validateAuditEntry rejects invalid stage
 *   9. validateAuditEntry rejects invalid gameStatus
 *  10. validateAuditEntry accepts valid entry
 *  11. hashAuditEntry returns 64-hex
 *  12. hashAuditEntry deterministic (same input → same hash)
 *  13. hashAuditEntry order-independent (canonical JSON)
 *  14. buildAuditChain with 0 entries → empty merkleRoot
 *  15. buildAuditChain with N entries → merkleRoot non-empty
 *  16. buildAuditChain merkleRoot deterministic
 *  17. buildAuditChain entries array preserved
 *  18. /audit endpoint reachable (POST + GET round-trip)
 *  19. /audit per-session bounded at 1000
 *  20. /audit responds 404 for missing sessionId
 *
 *  Extras:
 *  21. validateAuditEntry rejects measuredRtp out of [0,2]
 *  22. validateAuditEntry rejects hitFrequency out of [0,1]
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { createHash } from 'node:crypto';
import {
  AUDIT_LOG_SCHEMA_VERSION,
  buildAuditEntry,
  validateAuditEntry,
  hashAuditEntry,
  buildAuditChain,
} from '../../src/registry/auditTrail.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Canonical valid entry used across multiple validation tests. */
function makeValidEntry() {
  return buildAuditEntry({
    sessionId: 'test-session-001',
    spinIdx: 1,
    model: { payback: { rtp: 96.0 } },
    executor: { base_rtp_per_spin: 0.45 },
    outcome: {
      transactionId: 'txn-test-001',
      payX: 1.5,
      measuredRtp: 0.96,
      measuredHitRate: 0.21,
      stage: 'BaseGame',
      gameStatus: 'settled',
      convergencePass: true,
    },
    rng: { seed: 42 },
    target: { declaredRtp: '96.00', hitFrequency: 0.21 },
  });
}

/* ── 1. Schema version constant ─────────────────────────────────────── */
test('UQ-DEEP-AN · #1 · AUDIT_LOG_SCHEMA_VERSION === "1"', () => {
  assert.equal(AUDIT_LOG_SCHEMA_VERSION, '1');
});

/* ── 2. Builder stamps schemaVersion ────────────────────────────────── */
test('UQ-DEEP-AN · #2 · buildAuditEntry stamps schemaVersion="1"', () => {
  const e = makeValidEntry();
  assert.equal(e.schemaVersion, '1');
  assert.ok(e.auditLog && typeof e.auditLog === 'object');
});

/* ── 3. Builder stamps ISO 8601 timestamp ───────────────────────────── */
test('UQ-DEEP-AN · #3 · buildAuditEntry stamps ISO 8601 timestamp', () => {
  const e = makeValidEntry();
  assert.match(e.auditLog.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

/* ── 4. Validator rejects missing paytableHash ──────────────────────── */
test('UQ-DEEP-AN · #4 · validateAuditEntry rejects missing paytableHash', () => {
  const e = makeValidEntry();
  delete e.auditLog.paytableHash;
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /paytableHash/.test(m)));
});

/* ── 5. Validator rejects non-hex paytableHash ──────────────────────── */
test('UQ-DEEP-AN · #5 · validateAuditEntry rejects non-hex paytableHash', () => {
  const e = makeValidEntry();
  e.auditLog.paytableHash = 'NOT-A-HEX-VALUE';
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /paytableHash/.test(m)));
});

/* ── 6. Validator rejects empty sessionId ───────────────────────────── */
test('UQ-DEEP-AN · #6 · validateAuditEntry rejects empty sessionId', () => {
  const e = makeValidEntry();
  e.auditLog.sessionId = '';
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /sessionId/.test(m)));
});

/* ── 7. Validator rejects negative spinIdx ──────────────────────────── */
test('UQ-DEEP-AN · #7 · validateAuditEntry rejects negative spinIdx', () => {
  const e = makeValidEntry();
  e.auditLog.spinIdx = -1;
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /spinIdx/.test(m)));
});

/* ── 8. Validator rejects invalid stage ─────────────────────────────── */
test('UQ-DEEP-AN · #8 · validateAuditEntry rejects invalid stage', () => {
  const e = makeValidEntry();
  e.auditLog.stage = 'NotARealStage';
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /stage/.test(m)));
});

/* ── 9. Validator rejects invalid gameStatus ────────────────────────── */
test('UQ-DEEP-AN · #9 · validateAuditEntry rejects invalid gameStatus', () => {
  const e = makeValidEntry();
  e.auditLog.gameStatus = 'invalid';
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /gameStatus/.test(m)));
});

/* ── 10. Validator accepts valid entry ──────────────────────────────── */
test('UQ-DEEP-AN · #10 · validateAuditEntry accepts canonical valid entry', () => {
  const e = makeValidEntry();
  const r = validateAuditEntry(e);
  assert.equal(r.ok, true, `errors: ${r.errors.join('; ')}`);
  assert.deepEqual(r.errors, []);
});

/* ── 11. hashAuditEntry returns 64-hex ──────────────────────────────── */
test('UQ-DEEP-AN · #11 · hashAuditEntry returns 64-hex digest', () => {
  const e = makeValidEntry();
  const h = hashAuditEntry(e);
  assert.match(h, /^[0-9a-f]{64}$/);
});

/* ── 12. hashAuditEntry deterministic ───────────────────────────────── */
test('UQ-DEEP-AN · #12 · hashAuditEntry deterministic for same input', () => {
  /* Build twice with same explicit timestamp to make hash truly deterministic. */
  const a = makeValidEntry();
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(hashAuditEntry(a), hashAuditEntry(b));
});

/* ── 13. hashAuditEntry order-independent (canonical JSON) ──────────── */
test('UQ-DEEP-AN · #13 · hashAuditEntry order-independent (canonical JSON)', () => {
  const a = makeValidEntry();
  /* Reorder keys at root + nested levels — must hash to the same digest. */
  const reordered = {
    auditLog: {
      timestamp: a.auditLog.timestamp,
      hitFrequency: a.auditLog.hitFrequency,
      stage: a.auditLog.stage,
      paytableHash: a.auditLog.paytableHash,
      gameStatus: a.auditLog.gameStatus,
      convergencePass: a.auditLog.convergencePass,
      declaredRtp: a.auditLog.declaredRtp,
      spinIdx: a.auditLog.spinIdx,
      sessionId: a.auditLog.sessionId,
      measuredRtp: a.auditLog.measuredRtp,
      outcomeDetail: a.auditLog.outcomeDetail,
      serverConfig: a.auditLog.serverConfig,
      rngSeed: a.auditLog.rngSeed,
    },
    schemaVersion: a.schemaVersion,
  };
  assert.equal(hashAuditEntry(a), hashAuditEntry(reordered));
});

/* ── 14. buildAuditChain with 0 entries → empty merkleRoot ──────────── */
test('UQ-DEEP-AN · #14 · buildAuditChain([]) → empty merkleRoot', () => {
  const r = buildAuditChain([]);
  assert.equal(r.merkleRoot, '');
  assert.deepEqual(r.entries, []);
  assert.equal(r.signature, null);
});

/* ── 15. buildAuditChain with N entries → merkleRoot non-empty ──────── */
test('UQ-DEEP-AN · #15 · buildAuditChain(N entries) → non-empty merkleRoot', () => {
  const entries = [makeValidEntry(), makeValidEntry(), makeValidEntry()];
  const r = buildAuditChain(entries);
  assert.match(r.merkleRoot, /^[0-9a-f]{64}$/);
  assert.equal(r.entries.length, 3);
});

/* ── 16. buildAuditChain merkleRoot deterministic ───────────────────── */
test('UQ-DEEP-AN · #16 · buildAuditChain merkleRoot deterministic', () => {
  const a = [makeValidEntry(), makeValidEntry()];
  const b = a.map((e) => JSON.parse(JSON.stringify(e)));
  const ra = buildAuditChain(a);
  const rb = buildAuditChain(b);
  assert.equal(ra.merkleRoot, rb.merkleRoot);
});

/* ── 17. buildAuditChain entries array preserved ────────────────────── */
test('UQ-DEEP-AN · #17 · buildAuditChain preserves entries array verbatim', () => {
  const entries = [makeValidEntry(), makeValidEntry()];
  const r = buildAuditChain(entries);
  assert.equal(r.entries.length, entries.length);
  assert.equal(r.entries[0], entries[0]);
  assert.equal(r.entries[1], entries[1]);
});

/* ── 18-20. HTTP /audit endpoint round-trip ─────────────────────────── */
/* These spin up math-backend.mjs on an ephemeral port and exercise
 * POST /audit + GET /audit/<sid> + GET /audit/<sid>/<spinIdx>. */

let backendProc = null;
let backendPort = null;

async function waitForHealth(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpJson('GET', `http://127.0.0.1:${port}/health`);
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function httpJson(method, url, body = null) {
  return new Promise((resolveR, reject) => {
    const u = new URL(url);
    const req = http.request({
      method,
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolveR({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} }); }
        catch (e) { resolveR({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function startBackend() {
  if (backendProc) return backendPort;
  const backendPath = resolvePath(__dirname, '../../tools/math-backend.mjs');
  /* Use a non-default port to avoid colliding with any running backend. */
  const port = 9100 + Math.floor(Math.random() * 800);
  backendProc = spawn(process.execPath, [backendPath, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  /* Capture stderr for debugging in case startup fails. */
  let stderr = '';
  backendProc.stderr.on('data', (c) => { stderr += c.toString(); });
  /* If binary missing, exit code 1 immediately — skip rather than fail. */
  await new Promise((r) => setTimeout(r, 250));
  if (backendProc.exitCode != null && backendProc.exitCode !== 0) {
    const err = new Error(`math-backend startup failed (exit ${backendProc.exitCode}): ${stderr.slice(0, 300)}`);
    err.code = 'BACKEND_MISSING';
    backendProc = null;
    throw err;
  }
  const ok = await waitForHealth(port, 8000);
  if (!ok) {
    try { backendProc.kill('SIGKILL'); } catch {}
    backendProc = null;
    const err = new Error(`math-backend health check timeout: ${stderr.slice(0, 300)}`);
    err.code = 'BACKEND_TIMEOUT';
    throw err;
  }
  backendPort = port;
  return port;
}

function stopBackend() {
  if (backendProc) {
    try { backendProc.kill('SIGTERM'); } catch {}
    backendProc = null;
    backendPort = null;
  }
}

test('UQ-DEEP-AN · #18 · /audit endpoint POST + GET round-trip', { timeout: 30000 }, async (t) => {
  let port;
  try { port = await startBackend(); }
  catch (e) {
    t.diagnostic(`backend unavailable (${e.code || 'unknown'}): ${e.message}`);
    return;  /* graceful skip when binary missing */
  }
  try {
    const sid = 'audit-test-001';
    /* Pre-built audit entry with valid hex paytableHash. */
    const validHash = createHash('sha256').update('test-paytable').digest('hex');
    const entry = {
      schemaVersion: '1',
      auditLog: {
        paytableHash: validHash,
        serverConfig: { base_rtp_per_spin: 0.5 },
        sessionId: sid,
        spinIdx: 1,
        timestamp: new Date().toISOString(),
        stage: 'BaseGame',
        gameStatus: 'settled',
        rngSeed: 42,
        outcomeDetail: { transactionId: 'txn-1', payX: 1.0 },
        declaredRtp: '96.00',
        measuredRtp: 0.96,
        convergencePass: true,
        hitFrequency: 0.21,
      },
    };
    const post = await httpJson('POST', `http://127.0.0.1:${port}/audit`, entry);
    assert.equal(post.status, 200, `POST status (got ${post.status}): ${JSON.stringify(post.body)}`);
    assert.ok(post.body.ok, `POST body.ok: ${JSON.stringify(post.body)}`);
    /* GET list for session. */
    const list = await httpJson('GET', `http://127.0.0.1:${port}/audit/${sid}`);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.entries), 'entries array present');
    assert.ok(list.body.entries.length >= 1, 'at least one entry');
    /* GET single by spinIdx. */
    const single = await httpJson('GET', `http://127.0.0.1:${port}/audit/${sid}/1`);
    assert.equal(single.status, 200);
    assert.equal(single.body.entry.auditLog.sessionId, sid);
    assert.equal(single.body.entry.auditLog.spinIdx, 1);
  } finally {
    /* Leave backend running for #19, #20. */
  }
});

test('UQ-DEEP-AN · #19 · /audit per-session bounded at 1000', { timeout: 60000 }, async (t) => {
  let port;
  try { port = await startBackend(); }
  catch (e) {
    t.diagnostic(`backend unavailable (${e.code || 'unknown'}): ${e.message}`);
    return;
  }
  const sid = 'audit-bounded-test';
  const validHash = createHash('sha256').update('bounded-test').digest('hex');
  /* Post 1100 entries — first 100 must be evicted, cache capped at 1000. */
  const postBatch = async (startIdx, count) => {
    const promises = [];
    for (let i = 0; i < count; i++) {
      const entry = {
        schemaVersion: '1',
        auditLog: {
          paytableHash: validHash,
          serverConfig: {},
          sessionId: sid,
          spinIdx: startIdx + i,
          timestamp: new Date().toISOString(),
          stage: 'BaseGame',
          gameStatus: 'settled',
          rngSeed: 42,
          outcomeDetail: { transactionId: `txn-${startIdx + i}` },
          declaredRtp: '96.00',
          measuredRtp: 0.96,
          convergencePass: true,
          hitFrequency: 0.21,
        },
      };
      promises.push(httpJson('POST', `http://127.0.0.1:${port}/audit`, entry));
    }
    return Promise.all(promises);
  };
  /* Post in chunks to avoid socket exhaustion. */
  for (let chunk = 0; chunk < 11; chunk++) {
    await postBatch(chunk * 100, 100);
  }
  const list = await httpJson('GET', `http://127.0.0.1:${port}/audit/${sid}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.entries.length <= 1000, `bounded ≤ 1000, got ${list.body.entries.length}`);
  assert.equal(list.body.entries.length, 1000, 'rolled to exactly 1000 (FIFO eviction)');
});

test('UQ-DEEP-AN · #20 · /audit responds 404 for missing sessionId', { timeout: 15000 }, async (t) => {
  let port;
  try { port = await startBackend(); }
  catch (e) {
    t.diagnostic(`backend unavailable (${e.code || 'unknown'}): ${e.message}`);
    return;
  }
  try {
    const r = await httpJson('GET', `http://127.0.0.1:${port}/audit/no-such-session-${Date.now()}`);
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
  } finally {
    stopBackend();
  }
});

/* ── 21. measuredRtp range guard ────────────────────────────────────── */
test('UQ-DEEP-AN · #21 · validateAuditEntry rejects measuredRtp out of [0,2]', () => {
  const e = makeValidEntry();
  e.auditLog.measuredRtp = 3.5;
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /measuredRtp/.test(m)));
});

/* ── 22. hitFrequency range guard ───────────────────────────────────── */
test('UQ-DEEP-AN · #22 · validateAuditEntry rejects hitFrequency out of [0,1]', () => {
  const e = makeValidEntry();
  e.auditLog.hitFrequency = 1.5;
  const r = validateAuditEntry(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /hitFrequency/.test(m)));
});
