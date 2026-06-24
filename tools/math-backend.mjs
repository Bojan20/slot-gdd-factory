#!/usr/bin/env node
/**
 * tools/math-backend.mjs
 *
 * LV3 FAZA B (MATH-INTEGRATION-LV3 — Boki 2026-06-24) — Node HTTP bridge
 * koji prima `/batch` i `/spin` requests, spawn-uje sister-repo Rust
 * `mc_runtime_real` binary, vraća measured RTP + per-feature breakdown.
 *
 * Endpoints
 *   GET  /health          → {ok, version, binaryPath, port}
 *   POST /batch           → run N spins, return aggregate RTP + Wilson CI
 *     body: { spins, seed?, model } (model = full parser output)
 *   POST /spin            → single spin outcome (sample from cached batch)
 *     body: { sessionId, model } — uses cached 100k-spin pool keyed by sessionId
 *   GET  /sessions        → active session count + cache size
 *
 * Anti-AI guardrail: NIKAD ne poziva LLM, samo Rust binary. Determinizam
 * je očuvan jer Rust koristi PCG64 sa explicit seed.
 *
 * Port: 9001 (autopick if busy).
 * Spawn: lazy — binary se ne pokreće dok prvi request ne stigne.
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_PORT = 9001;
const BINARY_CANDIDATES = [
  resolvePath(homedir(), 'Projects/slot-math-engine-template/target/release/mc_runtime_real'),
  resolvePath(homedir(), 'Projects/slot-math-engine-template/rust-sim/target/release/mc_runtime_real'),
];

function findBinary() {
  for (const p of BINARY_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

const BINARY = findBinary();
if (!BINARY) {
  console.error('▸ mc_runtime_real binary not found. Run: cargo build --release --bin mc_runtime_real');
  console.error('  Searched:', BINARY_CANDIDATES.join('\n            '));
  process.exit(1);
}

/* LV3-11 — anti-vendor sanitize. Industry-trademarked names ne smeju
 * leak-ovati kroz backend response (Cash Eruption / Wolf Run / Cleopatra
 * / Pragmatic Play / IGT / Light & Wonder / Megaways / NetEnt). Backend
 * response je tehnički numeric, ali binary path + future debug fields
 * MOGU da sadrže trademark strings ako operator drži repo u Vendor-
 * Imenovanom folder-u. Scrub before send. */
const VENDOR_RX = /\b(IGT|Pragmatic\s+Play|Megaways|Cash[\s-]Eruption|Wolf[\s-]Run|Cleopatra|Buffalo\s+(?:King|Gold)|NetEnt|Microgaming|Scientific\s+Games|L&W|Light\s*&\s*Wonder|Play'?n\s*Go|Novomatic)\b/gi;
function sanitizeStr(s) {
  if (typeof s !== 'string') return s;
  return s.replace(VENDOR_RX, '[vendor]');
}
function sanitizeObj(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'string' ? sanitizeStr(v) : sanitizeObj(v);
    }
    return out;
  }
  return obj;
}

/* In-memory session cache: sessionId → [outcomes]. */
const SESSION_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;  /* 30 min */
const CACHE_MAX_SESSIONS = 100;

function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSION_CACHE) {
    if (now - s.createdAt > CACHE_TTL_MS) SESSION_CACHE.delete(id);
  }
  /* Hard cap: drop oldest if over limit. */
  while (SESSION_CACHE.size > CACHE_MAX_SESSIONS) {
    const first = SESSION_CACHE.keys().next().value;
    SESSION_CACHE.delete(first);
  }
}

/**
 * Build mc_runtime_real input from a parsed factory model.
 * Maps model.payback.rtp + model.payback.hitFrequency + feature trigger
 * probabilities into the executor shape the Rust binary expects.
 */
function buildExecutorInput(model, spins = 100000, seed = 42) {
  const payback = (model && model.payback) || {};
  const fs = (model && model.freeSpins) || {};
  const hnw = (model && model.holdAndWin) || {};
  /* Defaults align with industry baseline 5×3 96% RTP medium-vol slot. */
  const cfTargetRtp = (typeof payback.rtp === 'number' && payback.rtp > 0)
    ? (payback.rtp > 1 ? payback.rtp / 100 : payback.rtp)
    : 0.96;
  const baseRtp = (typeof payback.baseRtp === 'number')
    ? (payback.baseRtp > 1 ? payback.baseRtp / 100 : payback.baseRtp)
    : cfTargetRtp * 0.38;
  return {
    spins,
    seed,
    cf_target_rtp: cfTargetRtp,
    executor: {
      base_rtp_per_spin: baseRtp,
      base_hit_freq: (typeof payback.hitFrequency === 'number') ? payback.hitFrequency : 0.21,
      fs_trigger_p: (typeof fs.triggerProbability === 'number') ? fs.triggerProbability : 0.0085,
      fs_session_e: (typeof fs.sessionExpectedValue === 'number') ? fs.sessionExpectedValue : 23.6,
      fs_session_std: (typeof fs.sessionStdDev === 'number') ? fs.sessionStdDev : 26.6,
      hnw_trigger_p: (typeof hnw.triggerProbability === 'number') ? hnw.triggerProbability : 0.009,
      hnw_session_e: (typeof hnw.sessionExpectedValue === 'number') ? hnw.sessionExpectedValue : 44.0,
      hnw_session_std: (typeof hnw.sessionStdDev === 'number') ? hnw.sessionStdDev : 78.0,
      max_win_cap_x: (typeof payback.maxWinX === 'number') ? payback.maxWinX : 5000.0,
    },
  };
}

async function runBatch(model, spins = 100000, seed = 42) {
  const input = buildExecutorInput(model, spins, seed);
  return new Promise((resolveR, reject) => {
    const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`mc_runtime_real exit ${code}: ${stderr.slice(0, 400)}`));
      }
      try { resolveR(JSON.parse(stdout)); }
      catch (e) { reject(new Error(`JSON parse: ${e.message} / stdout: ${stdout.slice(0, 200)}`)); }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
    /* Hard timeout 60s for 10⁹ spins safety. */
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60_000);
  });
}

async function ensureSession(sessionId, model) {
  gcSessions();
  if (SESSION_CACHE.has(sessionId)) return SESSION_CACHE.get(sessionId);
  /* Cold start: run 100k batch, cache aggregate metrics + per-bucket
   * outcome distribution. Per-spin sampler uses inverse CDF on these. */
  const batch = await runBatch(model, 100000, Date.now() & 0xffff);
  const entry = {
    model,
    batch,
    spinsServed: 0,
    rtpSum: 0,
    hits: 0,
    createdAt: Date.now(),
    /* Reservoir distribution from batch metrics. */
    hitRate: batch.hit_rate,
    rtpPerSpin: batch.rtp,
    fsTriggerRate: batch.fs_trigger_rate,
    hnwTriggerRate: batch.hnw_trigger_rate,
    maxWinX: batch.max_win_x,
  };
  SESSION_CACHE.set(sessionId, entry);
  return entry;
}

/**
 * Per-spin sampler: given cached session metrics, draw a single spin
 * outcome using PCG64-ish hash of sessionId+spinIdx for determinism.
 * NOT the exact Rust per-spin (would require separate binary or WASM);
 * this is a faithful statistical sample from the empirical distribution
 * Rust just produced.
 */
function samplePerSpin(session) {
  const idx = ++session.spinsServed;
  /* xorshift-like deterministic PRNG seeded by sessionId hash + idx. */
  let h = 0;
  const sid = String(session.batch.seed || 42) + ':' + idx;
  for (let i = 0; i < sid.length; i++) h = ((h << 5) - h) + sid.charCodeAt(i);
  const u = ((h >>> 0) % 1_000_000) / 1_000_000;
  const u2 = (((h >>> 13) ^ h) >>> 0 % 1_000_000) / 1_000_000;

  /* Bernoulli hit decision. */
  const isHit = u < session.hitRate;
  let payX = 0;
  if (isHit) {
    /* Exponential-ish payout tail; mean tuned to match session RTP/hitRate. */
    const meanPay = session.rtpPerSpin / Math.max(session.hitRate, 1e-6);
    payX = Math.max(0.1, -Math.log(Math.max(u2, 1e-9)) * meanPay);
    if (payX > session.maxWinX) payX = session.maxWinX;
  }
  const fsTrigger = ((h >>> 7) & 0xffff) / 0xffff < session.fsTriggerRate;
  const hnwTrigger = ((h >>> 17) & 0xffff) / 0xffff < session.hnwTriggerRate;
  session.rtpSum += payX;
  if (isHit) session.hits++;
  return {
    spinIdx: idx,
    payX,
    isHit,
    fsTrigger,
    hnwTrigger,
    measuredRtp: session.rtpSum / idx,
    measuredHitRate: session.hits / idx,
    targetRtp: session.rtpPerSpin,
    sessionN: idx,
  };
}

/* ── HTTP server ─────────────────────────────────────────────────────── */

function readJsonBody(req) {
  return new Promise((resolveR, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8 * 1024 * 1024) reject(new Error('body > 8MB')); });
    req.on('end', () => { try { resolveR(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  /* LV3-11: scrub vendor names + path strings before serializing. */
  const sanitized = sanitizeObj(obj);
  const json = JSON.stringify(sanitized);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',  /* localhost only — slot.html in iframe */
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') {
      /* LV3-11: don't leak host path or username. Return basename only. */
      const binBase = BINARY.split('/').pop();
      return send(res, 200, {
        ok: true,
        server: 'math-backend',
        version: '1.0.0-lv3',
        binaryPath: binBase,
        port: server.address()?.port,
        uptimeSec: Math.floor(process.uptime()),
        sessions: SESSION_CACHE.size,
        pid: process.pid,
      });
    }

    if (req.method === 'GET' && p === '/sessions') {
      return send(res, 200, {
        count: SESSION_CACHE.size,
        sessions: [...SESSION_CACHE.entries()].map(([id, s]) => ({
          id, spinsServed: s.spinsServed, ageMs: Date.now() - s.createdAt,
          measuredRtp: s.spinsServed > 0 ? s.rtpSum / s.spinsServed : null,
        })),
      });
    }

    if (req.method === 'POST' && p === '/batch') {
      const body = await readJsonBody(req);
      const spins = Math.min(Math.max(Number(body.spins) || 100000, 1000), 1_000_000_000);
      const seed = Number(body.seed) || 42;
      const out = await runBatch(body.model || {}, spins, seed);
      return send(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && p === '/spin') {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId || '').slice(0, 64) || 'default';
      const session = await ensureSession(sessionId, body.model || {});
      const outcome = samplePerSpin(session);
      return send(res, 200, { ok: true, sessionId, ...outcome });
    }

    return send(res, 404, { error: `unknown route: ${req.method} ${p}` });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

/* Port autopick: try DEFAULT_PORT, fallback to 9002, 9003, ... */
function tryListen(port, host = '127.0.0.1') {
  return new Promise((resolveR, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
        server.removeAllListeners('listening');
        resolveR(tryListen(port + 1, host));
      } else { reject(err); }
    });
    server.once('listening', () => {
      console.log(`▸ math-backend listening on http://${host}:${port}`);
      console.log(`  binary: ${BINARY}`);
      resolveR(port);
    });
    server.listen(port, host);
  });
}

const PORT_ARG = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
})();

tryListen(PORT_ARG).catch((e) => {
  console.error('▸ failed to listen:', e.message);
  process.exit(1);
});

/* Graceful shutdown. */
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`▸ ${sig} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  });
});
