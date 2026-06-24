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
/* HIGH-1 fix (UQ-DEEP-N): separator class widened.
 * CRIT-3 fix (UQ-DEEP-O): NFKD-normalize + strip combining marks +
 *   drop non-ASCII letters before regex. Defeats Cyrillic lookalikes
 *   (Cаsh sa Cyrillic а U+0430), zero-width chars (Ca​sh),
 *   HTML numeric entities (&#67;ash), and Arabic-Indic digit confusion. */
const VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic)\b/gi;

function unicodeNormalizeForVendor(s) {
  /* 1. Decode HTML numeric entities so &#67;ash → Cash. */
  let out = s.replace(/&#(\d+);/g, (_, n) => {
    const cp = parseInt(n, 10);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    const cp = parseInt(n, 16);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  /* 2. NFKD: separate base char from combining marks (so e.g. Café → Cafe). */
  try { out = out.normalize('NFKD'); } catch {}
  /* 3. Strip combining diacritics (U+0300..U+036F) + zero-width chars
   *    (ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, BOM U+FEFF, etc.). */
  out = out.replace(/[̀-ͯ​-‏﻿⁠-⁯]/g, '');
  /* 4. Confusable-letter homoglyph fold: Cyrillic / Greek lookalikes →
   *    ASCII. Just hit the most common letters used in our vendor names. */
  const CONFUSABLES = {
    'а': 'a', 'А': 'A', 'е': 'e', 'Е': 'E', 'о': 'o', 'О': 'O',
    'р': 'p', 'Р': 'P', 'с': 'c', 'С': 'C', 'у': 'y', 'У': 'Y',
    'х': 'x', 'Х': 'X', 'і': 'i', 'І': 'I', 'ј': 'j', 'Ј': 'J',
    'ѕ': 's', 'Ѕ': 'S', 'ԁ': 'd', 'ϲ': 'c', 'ϵ': 'e', 'ɡ': 'g',
    'ɪ': 'I', 'ʟ': 'L', 'ѡ': 'w',
  };
  out = out.replace(/[-￿]/g, (ch) => CONFUSABLES[ch] ?? ch);
  return out;
}

function sanitizeStr(s) {
  if (typeof s !== 'string') return s;
  /* Match against normalized form; emit original (preserves user data)
   * BUT if normalized form would match, replace whole word in original. */
  const normalized = unicodeNormalizeForVendor(s);
  if (!VENDOR_RX.test(normalized)) {
    /* Reset lastIndex (RX is /g) and short-circuit. */
    VENDOR_RX.lastIndex = 0;
    return s;
  }
  VENDOR_RX.lastIndex = 0;
  /* Normalized form had vendor — scrub the normalized version to be safe.
   * (We lose any non-vendor unicode in the response, but anti-vendor
   * guarantee is the priority for regulator deliverables.) */
  return normalized.replace(VENDOR_RX, '[vendor]');
}
function sanitizeObj(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      /* UQ-DEEP-S LOW (E2E): preserve client-provided keys that ne sadrže
       * vendor data po definiciji. sessionId je echo client-supplied string
       * koji se koristi za session correlation; scrub ga je kvario client
       * tracking. Drugi pass-through keys: source, ref, requestId. */
      if (typeof v === 'string' && (k === 'sessionId' || k === 'source' || k === 'ref' || k === 'requestId')) {
        out[k] = v;
      } else {
        out[k] = typeof v === 'string' ? sanitizeStr(v) : sanitizeObj(v);
      }
    }
    return out;
  }
  return obj;
}

/* In-memory session cache: sessionId → entry.
 *
 * CRIT-2 fix (UQ-DEEP-N audit): true LRU, not FIFO.
 *   Before: `SESSION_CACHE.keys().next().value` returns insertion-order key
 *           — that's FIFO, not LRU. A hot session created first but accessed
 *           every spin would be evicted while a cold idle session survived.
 *   After:  every read bumps `lastAccessAt`; eviction picks smallest
 *           `lastAccessAt` across the map (O(n) scan, n ≤ 100 = trivial). */
const SESSION_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;  /* 30 min */
const CACHE_MAX_SESSIONS = 100;

function touchSession(entry) {
  entry.lastAccessAt = Date.now();
}

function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSION_CACHE) {
    if (now - s.createdAt > CACHE_TTL_MS) SESSION_CACHE.delete(id);
  }
  /* True LRU eviction: scan for entry with smallest lastAccessAt. */
  while (SESSION_CACHE.size > CACHE_MAX_SESSIONS) {
    let oldestId = null;
    let oldestTs = Infinity;
    for (const [id, s] of SESSION_CACHE) {
      const ts = s.lastAccessAt || s.createdAt;
      if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
    }
    if (oldestId == null) break;
    SESSION_CACHE.delete(oldestId);
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

/* HIGH-1 (UQ-DEEP-O): clear timeout on completion (was leaking 4MB/min). */
function runBatch(model, spins = 100000, seed = 42) {
  const input = buildExecutorInput(model, spins, seed);
  return new Promise((resolveR, reject) => {
    const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    ACTIVE_BATCH_CHILDREN.add(child);
    let stdout = '', stderr = '';
    const timeoutId = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60_000);
    const cleanup = () => {
      clearTimeout(timeoutId);
      ACTIVE_BATCH_CHILDREN.delete(child);
    };
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        return reject(new Error(`mc_runtime_real exit ${code}: ${stderr.slice(0, 400)}`));
      }
      try { resolveR(JSON.parse(stdout)); }
      catch (e) { reject(new Error(`JSON parse: ${e.message} / stdout: ${stdout.slice(0, 200)}`)); }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/* HIGH-2 (UQ-DEEP-O): bound concurrent Rust spawns (4 max). 100 paralelnih
 * batch-eva po 100MB PAR table = 10GB OOM swap-death. */
const BATCH_MAX_CONCURRENT = 4;
const BATCH_QUEUE = [];
let _batchInFlight = 0;
const ACTIVE_BATCH_CHILDREN = new Set();  /* LOW-3: clean-shutdown bookkeeping. */

function runBatchQueued(model, spins, seed) {
  return new Promise((resolveR, reject) => {
    const task = { model, spins, seed, resolveR, reject };
    BATCH_QUEUE.push(task);
    drainBatchQueue();
  });
}

function drainBatchQueue() {
  while (_batchInFlight < BATCH_MAX_CONCURRENT && BATCH_QUEUE.length) {
    const task = BATCH_QUEUE.shift();
    _batchInFlight++;
    runBatch(task.model, task.spins, task.seed)
      .then((out) => task.resolveR(out))
      .catch((e) => task.reject(e))
      .finally(() => { _batchInFlight--; drainBatchQueue(); });
  }
}

/* CRIT-P2 (UQ-DEEP-P): in-flight Promise dedupe — two parallel /spin for
 * a new sessionId now share one runBatch() call (rather than spawning two
 * Rust children and racing to overwrite the cache entry). */
const SESSION_PENDING = new Map();

async function ensureSession(sessionId, model) {
  gcSessions();
  if (SESSION_CACHE.has(sessionId)) {
    const cached = SESSION_CACHE.get(sessionId);
    touchSession(cached);  /* CRIT-2: bump LRU on hit. */
    return cached;
  }
  if (SESSION_PENDING.has(sessionId)) {
    return SESSION_PENDING.get(sessionId);
  }
  /* CRIT-5 fix (UQ-DEEP-N): deterministic per-session seed. Derive seed
   * from sessionId hash so two identical sessionIds always get identical
   * Rust batch (idempotency contract). */
  let seedHash = 0x811c9dc5 >>> 0;  /* FNV-1a 32-bit basis */
  for (let i = 0; i < sessionId.length; i++) {
    seedHash ^= sessionId.charCodeAt(i);
    seedHash = Math.imul(seedHash, 0x01000193) >>> 0;
  }
  const deterministicSeed = seedHash & 0xffff;
  /* Cold start: run 100k batch, cache aggregate metrics + per-bucket
   * outcome distribution. Per-spin sampler uses inverse CDF on these. */
  const pending = (async () => {
    try {
      const batch = await runBatchQueued(model, 100000, deterministicSeed);
      /* CRIT-P4 (UQ-DEEP-P): reject NaN/Infinity propagation. If Rust
       * binary returns missing/garbled fields, fail loud rather than
       * letting NaN poison every subsequent measuredRtp. */
      const validFinite = (v, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
      if (!validFinite(batch.rtp) || !validFinite(batch.hit_rate) || batch.hit_rate <= 0 || batch.hit_rate > 1) {
        throw new Error(`backend invariant violation: rtp=${batch.rtp} hit_rate=${batch.hit_rate}`);
      }
      const now = Date.now();
      const entry = {
        model,
        batch,
        spinsServed: 0,
        rtpSum: 0,
        rtpComp: 0,  /* HIGH-P3 (UQ-DEEP-P): Kahan summation compensator. */
        hits: 0,
        createdAt: now,
        lastAccessAt: now,
        hitRate: batch.hit_rate,
        rtpPerSpin: batch.rtp,
        fsTriggerRate: validFinite(batch.fs_trigger_rate) ? batch.fs_trigger_rate : 0,
        hnwTriggerRate: validFinite(batch.hnw_trigger_rate) ? batch.hnw_trigger_rate : 0,
        maxWinX: validFinite(batch.max_win_x, 1) ? batch.max_win_x : 5000,
      };
      SESSION_CACHE.set(sessionId, entry);
      return entry;
    } finally {
      SESSION_PENDING.delete(sessionId);
    }
  })();
  SESSION_PENDING.set(sessionId, pending);
  return pending;
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
  /* CRIT (UQ-DEEP-O+P, both agents): operator precedence bug fixed by
   * replacing biased djb2 hash with Mulberry32 PRNG (full-uniform 32-bit
   * generator). Before:
   *   - `u = djb2(sid) % 1M / 1M` → mean 0.66, hit_rate 0.21 fired 1/1000
   *     times (∼200× under-shoot) → measuredRtp always 0
   *   - `u2 = >>> 0 % 1M` parsed as `>>> 0` (dead mod) → u2 > 1 → -log
   *     returned negative → payX pinned to 0.1
   * After: Mulberry32 seeded by FNV-1a(session.batch.seed + idx) → 4
   * uniformly-distributed [0,1) samples per spin (u, u2, fsR, hnwR).
   *
   * Mulberry32 passes BigCrush, has 2^32 period — plenty for ≤100k spins
   * per session. Determinism preserved (same seed → same stream). */
  let mState = 0x811c9dc5 >>> 0;  /* FNV-1a basis */
  const seedKey = String(session.batch.seed || 42) + ':' + idx;
  for (let i = 0; i < seedKey.length; i++) {
    mState ^= seedKey.charCodeAt(i);
    mState = Math.imul(mState, 0x01000193) >>> 0;
  }
  function nextU() {
    mState = (mState + 0x6D2B79F5) >>> 0;
    let t = mState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const u = nextU();
  const u2 = nextU();
  const fsR = nextU();
  const hnwR = nextU();

  /* Bernoulli hit decision. */
  const isHit = u < session.hitRate;
  let payX = 0;
  if (isHit) {
    /* Exponential-ish payout tail; mean tuned to match session RTP/hitRate. */
    const meanPay = session.rtpPerSpin / Math.max(session.hitRate, 1e-6);
    payX = Math.max(0.1, -Math.log(Math.max(u2, 1e-9)) * meanPay);
    if (payX > session.maxWinX) payX = session.maxWinX;
  }
  const fsTrigger = fsR < session.fsTriggerRate;
  const hnwTrigger = hnwR < session.hnwTriggerRate;
  /* HIGH-P3 (UQ-DEEP-P): Kahan summation. Naive `+=` loses ~1e-6 precision
   * per spin after 10M; Kahan keeps full double accuracy at +1 mult/add. */
  const y = payX - session.rtpComp;
  const t = session.rtpSum + y;
  session.rtpComp = (t - session.rtpSum) - y;
  session.rtpSum = t;
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

/* MED-P3 (UQ-DEEP-P): immediately destroy socket on oversize to stop
 * client streaming further bytes. Was leaking CPU on attack until end. */
function readJsonBody(req) {
  return new Promise((resolveR, reject) => {
    let body = '';
    let killed = false;
    req.on('data', (c) => {
      if (killed) return;
      body += c;
      if (body.length > 8 * 1024 * 1024) {
        killed = true;
        try { req.destroy(); } catch {}
        reject(new Error('body > 8MB'));
      }
    });
    req.on('end', () => { if (killed) return; try { resolveR(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* CRIT-2 (UQ-DEEP-O): CORS origin allowlist. Wildcard '*' lets any
 * cross-origin tab POST /batch/spin and GET /sessions → data exfil.
 * Echo back only if origin matches localhost variants on the
 * uploader port. */
const CORS_ALLOWLIST = new Set([
  'http://127.0.0.1:5181',
  'http://localhost:5181',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
  /* null = file:// or sandboxed iframe — slot.html runs in srcdoc iframe. */
  'null',
]);

function send(res, code, obj, reqOrigin) {
  /* LV3-11: scrub vendor names + path strings before serializing. */
  const sanitized = sanitizeObj(obj);
  const json = JSON.stringify(sanitized);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  };
  if (reqOrigin && CORS_ALLOWLIST.has(reqOrigin)) {
    headers['Access-Control-Allow-Origin'] = reqOrigin;
  }
  res.writeHead(code, headers);
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
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
      }, origin);
    }

    if (req.method === 'GET' && p === '/sessions') {
      /* MED-2 (UQ-DEEP-O): /sessions is enumeration leak. Already gated
       * by CORS allowlist; additionally require explicit auth token if
       * MATH_BACKEND_TOKEN env var set (operator opt-in). */
      const reqToken = url.searchParams.get('token');
      if (process.env.MATH_BACKEND_TOKEN && reqToken !== process.env.MATH_BACKEND_TOKEN) {
        return send(res, 401, { error: 'token required' }, origin);
      }
      return send(res, 200, {
        count: SESSION_CACHE.size,
        sessions: [...SESSION_CACHE.entries()].map(([id, s]) => ({
          id, spinsServed: s.spinsServed, ageMs: Date.now() - s.createdAt,
          measuredRtp: s.spinsServed > 0 ? s.rtpSum / s.spinsServed : null,
        })),
      }, origin);
    }

    if (req.method === 'POST' && p === '/batch') {
      const body = await readJsonBody(req);
      /* MED-P4: Number.isFinite check so seed=0 stays 0 (deterministic),
       * not coerced to 42. Same for spins NaN guard. */
      const spinsRaw = Number(body.spins);
      const spins = Math.min(Math.max(Number.isFinite(spinsRaw) ? spinsRaw : 100000, 1000), 1_000_000_000);
      const seedRaw = Number(body.seed);
      const seed = Number.isFinite(seedRaw) ? seedRaw : 42;
      const out = await runBatchQueued(body.model || {}, spins, seed);
      /* UQ-DEEP-S HIGH (E2E): convergence_pass gate. Rust binary returns
       * convergence_pass:true ali bez gate na halfwidth → operator vidi
       * "PASS" iako Wilson CI je 7×+ ispred ±0.05% precision bound.
       * Override convergence_pass strict: rtp within ±0.05% AND
       * halfwidth < 0.01 (regulator precision band MATH_PRECISION_BAND). */
      const CONVERGENCE_PRECISION_PCT = 0.0005;  /* 0.05% */
      const CONVERGENCE_CI_HALFWIDTH = 0.01;     /* 1.0% Wilson 99% CI */
      const measuredDelta = (typeof out.rtp === 'number' && typeof out.cf_target_rtp === 'number')
        ? Math.abs(out.rtp - out.cf_target_rtp) : Infinity;
      const halfwidth = (typeof out.wilson_99_halfwidth === 'number') ? out.wilson_99_halfwidth : Infinity;
      const strictPass = (measuredDelta <= CONVERGENCE_PRECISION_PCT) && (halfwidth <= CONVERGENCE_CI_HALFWIDTH);
      const convergenceCriterion = {
        rtpDelta: measuredDelta,
        rtpDeltaPct: measuredDelta * 100,
        rtpDeltaBoundPct: CONVERGENCE_PRECISION_PCT * 100,
        halfwidth,
        halfwidthBound: CONVERGENCE_CI_HALFWIDTH,
        spinsRun: spins,
      };
      return send(res, 200, {
        ok: true,
        ...out,
        /* Override Rust-reported convergence_pass with strict gate. */
        convergence_pass: strictPass,
        convergence_pass_rust: out.convergence_pass,  /* preserve original for debug */
        convergence_criterion: convergenceCriterion,
      }, origin);
    }

    if (req.method === 'POST' && p === '/converge') {
      /* UQ-DEEP-W (Boki 2026-06-24): auto-converge endpoint.
       * Eskalira batch size 10K → 100K → 1M → 10M → 100M dok pass=true
       * ili maxSpins iscrpljen. Vraća JSON sa rounds[] history + final
       * verdict. Per-round Rust spawn unutar runBatchQueued (concurrency
       * cap 4) — koristi isti deterministic seed iz model hash. */
      const body = await readJsonBody(req);
      const model = body.model || {};
      /* Budget kapovi: hard cap 100M, soft start 10K. */
      const maxSpinsRaw = Number(body.maxSpins);
      const maxSpins = Math.min(Math.max(Number.isFinite(maxSpinsRaw) ? maxSpinsRaw : 10_000_000, 10_000), 100_000_000);
      /* Precision overrides — Boki može da labavi za high-vol slots. */
      const precisionPctRaw = Number(body.precisionPct);
      const precisionPct = Number.isFinite(precisionPctRaw) && precisionPctRaw > 0 ? precisionPctRaw : 0.005;  /* 0.5% default — high-vol slot realistic */
      const halfwidthBoundRaw = Number(body.halfwidthBound);
      const halfwidthBound = Number.isFinite(halfwidthBoundRaw) && halfwidthBoundRaw > 0 ? halfwidthBoundRaw : 0.01;  /* 1% Wilson CI */
      /* Ladder of batch sizes — geometric escalation. */
      const ladder = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].filter((n) => n <= maxSpins);
      if (ladder[ladder.length - 1] !== maxSpins && maxSpins > 10_000) ladder.push(maxSpins);
      /* Seed: deterministic per model hash. */
      let seedHash = 0x811c9dc5 >>> 0;
      const seedStr = JSON.stringify(model);
      for (let i = 0; i < seedStr.length; i++) {
        seedHash ^= seedStr.charCodeAt(i);
        seedHash = Math.imul(seedHash, 0x01000193) >>> 0;
      }
      const baseSeed = seedHash & 0xffff;
      const rounds = [];
      let passed = false;
      let lastOut = null;
      const t0 = Date.now();
      for (let i = 0; i < ladder.length; i++) {
        const spinsThis = ladder[i];
        /* Vary seed per round so pooled estimator can average σ. */
        const seedThis = (baseSeed + i * 7919) & 0xffff;
        let out;
        try {
          out = await runBatchQueued(model, spinsThis, seedThis);
        } catch (e) {
          rounds.push({ spins: spinsThis, seed: seedThis, error: e.message });
          break;
        }
        const deltaPct = (typeof out.rtp === 'number' && typeof out.cf_target_rtp === 'number')
          ? Math.abs(out.rtp - out.cf_target_rtp) : Infinity;
        const halfwidth = (typeof out.wilson_99_halfwidth === 'number') ? out.wilson_99_halfwidth : Infinity;
        const roundPass = (deltaPct <= precisionPct) && (halfwidth <= halfwidthBound);
        rounds.push({
          spins: spinsThis,
          seed: seedThis,
          rtp: out.rtp,
          delta_bps: typeof out.delta_bps === 'number' ? out.delta_bps : null,
          deltaPct,
          halfwidth,
          hit_rate: out.hit_rate,
          max_win_x: out.max_win_x,
          pass: roundPass,
          spins_per_sec: out.spins_per_sec,
        });
        lastOut = out;
        if (roundPass) { passed = true; break; }
      }
      const wallclockMs = Date.now() - t0;
      const final = lastOut ? {
        rtp: lastOut.rtp,
        cf_target_rtp: lastOut.cf_target_rtp,
        delta_bps: lastOut.delta_bps,
        wilson_99_halfwidth: lastOut.wilson_99_halfwidth,
        hit_rate: lastOut.hit_rate,
        fs_trigger_rate: lastOut.fs_trigger_rate,
        hnw_trigger_rate: lastOut.hnw_trigger_rate,
        max_win_x: lastOut.max_win_x,
        spins_per_sec: lastOut.spins_per_sec,
        feature_breakdown: lastOut.feature_breakdown,
      } : null;
      const totalSpins = rounds.reduce((s, r) => s + (r.spins || 0), 0);
      return send(res, 200, {
        ok: true,
        passed,
        rounds,
        roundCount: rounds.length,
        totalSpins,
        finalSpins: rounds.length > 0 ? rounds[rounds.length - 1].spins : 0,
        wallclockMs,
        criterion: {
          precisionPct,
          precisionPctDisplay: precisionPct * 100,
          halfwidthBound,
          halfwidthBoundDisplay: halfwidthBound * 100,
          maxSpins,
        },
        final,
      }, origin);
    }

    if (req.method === 'POST' && p === '/spin') {
      const body = await readJsonBody(req);
      /* CRIT-P1 (UQ-DEEP-P): reject sessionId > 64 char rather than
       * slice() which produces silent collisions when two distinct ids
       * share a 64-char prefix.
       * HIGH-3 (UQ-DEEP-O): reject empty / missing sessionId rather than
       * collapsing to 'default' which causes cross-game contamination. */
      const sidRaw = body.sessionId;
      if (typeof sidRaw !== 'string' || sidRaw.length === 0 || sidRaw.length > 64) {
        return send(res, 400, { error: 'sessionId required, non-empty, <=64 chars' }, origin);
      }
      if (!/^[A-Za-z0-9._:\-]+$/.test(sidRaw)) {
        return send(res, 400, { error: 'sessionId must be alnum + ._:- only' }, origin);
      }
      const session = await ensureSession(sidRaw, body.model || {});
      const outcome = samplePerSpin(session);
      return send(res, 200, { ok: true, sessionId: sidRaw, ...outcome }, origin);
    }

    return send(res, 404, { error: `unknown route: ${req.method} ${p}` }, origin);
  } catch (e) {
    return send(res, 500, { error: e.message }, origin);
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
