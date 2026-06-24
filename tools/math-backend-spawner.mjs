#!/usr/bin/env node
/**
 * tools/math-backend-spawner.mjs
 *
 * LV3-1 — auto-spawn math-backend kao child process kad pozove se.
 * Wired iz web-uploader-server.mjs na boot (lazy: spawn-uje samo ako
 * port 9001 nije već zauzet — drugi instance respektovan).
 *
 * Anti-AI: ne poziva LLM. Anti-vendor: ne logguje vendor stringove.
 *
 * Public API
 *   ensureBackendRunning({ port?: 9001 }) → { spawned, pid, port, healthOk }
 *   stopBackend() → void (idempotent)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolvePath(__dirname, '..');
const BACKEND_SCRIPT = resolvePath(REPO, 'tools/math-backend.mjs');

let _childProc = null;
let _spawnedPort = null;
let _stderrTail = '';
let _stdoutTail = '';

/** Get last 4KB of child stdio for debug — does NOT log vendor paths. */
export function getDebugTails() {
  return { stderr: _stderrTail, stdout: _stdoutTail };
}

function probeHealth(port, timeoutMs = 800) {
  return new Promise((resolveR) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolveR(j && j.ok === true ? j : null);
        } catch { resolveR(null); }
      });
    });
    req.on('error', () => resolveR(null));
    req.on('timeout', () => { req.destroy(); resolveR(null); });
  });
}

/**
 * Idempotent: ako port 9001 već radi backend, vraća { spawned: false }.
 * Inače spawn-uje child process, čeka health-check do 3s, vraća status.
 */
export async function ensureBackendRunning(opts = {}) {
  const port = opts.port || 9001;

  /* Already running? */
  const existing = await probeHealth(port);
  if (existing) {
    return {
      spawned: false,
      port,
      pid: existing.pid,
      healthOk: true,
      binaryPath: existing.binaryPath,
      reason: 'already running',
    };
  }

  if (!existsSync(BACKEND_SCRIPT)) {
    return {
      spawned: false, port, pid: null, healthOk: false,
      reason: `backend script missing: ${BACKEND_SCRIPT}`,
    };
  }

  /* Spawn detached child. Inherit stderr za debug, ignore stdout (clean). */
  try {
    _childProc = spawn('node', [BACKEND_SCRIPT, '--port', String(port)], {
      cwd: REPO,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    _spawnedPort = port;
    /* CRIT-1 fix (UQ-DEEP-N): drain stdio pipes — bez ovoga child blockuje
     * čim OS pipe buffer popuni (~64KB na Linux, 16KB na macOS). Detected
     * 2026-06-24 audit agent A: "child writes block when stderr buffer fills"
     * (audit finding CRIT-1).
     *
     * Strategy: čitamo SVE iz oba pipe-a + drop-ujemo (anti-vendor: ne
     * logujemo binary path / vendor strings na console). Buffer-uje samo
     * poslednjih 4KB za debug ako pop-up Boki treba. */
    _stderrTail = '';
    _stdoutTail = '';
    if (_childProc.stdout) {
      _childProc.stdout.on('data', (buf) => {
        const s = buf.toString('utf8');
        _stdoutTail = (_stdoutTail + s).slice(-4096);
      });
      _childProc.stdout.on('error', () => {});
    }
    if (_childProc.stderr) {
      _childProc.stderr.on('data', (buf) => {
        const s = buf.toString('utf8');
        _stderrTail = (_stderrTail + s).slice(-4096);
      });
      _childProc.stderr.on('error', () => {});
    }
    _childProc.on('error', () => {});
    _childProc.on('exit', (code) => {
      _spawnedPort = null;
      /* Don't null _childProc — keep ref so getDebugTails works post-exit. */
      void code;
    });
  } catch (e) {
    return { spawned: false, port, pid: null, healthOk: false, reason: `spawn failed: ${e.message}` };
  }

  /* Wait for health (poll every 200ms up to 3s).
   * HIGH-3 fix (UQ-DEEP-N): backend autopicks port 9001..9010 if start port
   * is busy. Spawner must probe THE SAME range to discover where the child
   * actually landed. Otherwise we'd return healthOk=false even though
   * backend is running on (e.g.) 9002. */
  const portsToProbe = [];
  for (let p = port; p < port + 10; p++) portsToProbe.push(p);

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    for (const p of portsToProbe) {
      const h = await probeHealth(p);
      if (h) {
        _spawnedPort = p;
        return {
          spawned: true,
          port: p,
          pid: _childProc.pid,
          healthOk: true,
          binaryPath: h.binaryPath,
          reason: port === p ? 'fresh spawn' : `fresh spawn (autopicked ${p} from collision on ${port})`,
        };
      }
    }
  }

  /* Spawn ran but never healthy — bail. Include debug tails so caller can
   * log root cause (won't expose vendor paths — tails are already drained
   * and rotated through the same anti-vendor scrub upstream). */
  const tails = getDebugTails();
  const errSnippet = tails.stderr.slice(-200).replace(/\s+/g, ' ').trim();
  return {
    spawned: true, port, pid: _childProc.pid, healthOk: false,
    reason: 'health check timeout after 3s' + (errSnippet ? ` · child stderr: ${errSnippet}` : ''),
  };
}

/** Idempotent async shutdown.
 *
 * HIGH-6 fix (UQ-DEEP-N): wait for child exit instead of fire-and-forget.
 *   Before: sync `kill()` + immediate null-out. Caller could re-spawn on
 *           the same port while OS hadn't yet released the socket → bind
 *           EADDRINUSE race (visible in stress tests).
 *   After:  await child exit (up to 2s), fall back to SIGKILL, then null.
 *           Caller can `await stopBackend()` before re-spawning. */
export async function stopBackend(opts = {}) {
  const graceMs = opts.graceMs ?? 2000;
  const child = _childProc;
  if (!child) return;
  const exited = new Promise((r) => child.once('exit', () => r('exited')));
  try { child.kill('SIGTERM'); } catch { /* already dead */ }
  const winner = await Promise.race([
    exited,
    new Promise((r) => setTimeout(() => r('timeout'), graceMs)),
  ]);
  if (winner === 'timeout') {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    await Promise.race([
      exited,
      new Promise((r) => setTimeout(r, 500)),
    ]);
  }
  _childProc = null;
  _spawnedPort = null;
}

/* CLI: ako se pokrene direktno, ensure + log + keep parent alive da child
 * ostane vezan za parent terminal. */
if (process.argv[1] === __filename) {
  const port = Number(process.argv[2]) || 9001;
  ensureBackendRunning({ port }).then((r) => {
    console.log('math-backend ensure result:', JSON.stringify(r, null, 2));
    if (!r.healthOk) process.exit(1);
    /* Keep parent alive so child stays bound. */
    const shutdown = async () => {
      try { await stopBackend(); } catch { /* best effort */ }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
