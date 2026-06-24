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
  } catch (e) {
    return { spawned: false, port, pid: null, healthOk: false, reason: `spawn failed: ${e.message}` };
  }

  /* Wait for health (poll every 200ms up to 3s). */
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const h = await probeHealth(port);
    if (h) {
      return {
        spawned: true,
        port,
        pid: _childProc.pid,
        healthOk: true,
        binaryPath: h.binaryPath,
        reason: 'fresh spawn',
      };
    }
  }

  /* Spawn ran but never healthy — bail. */
  return {
    spawned: true, port, pid: _childProc.pid, healthOk: false,
    reason: 'health check timeout after 3s',
  };
}

/** Idempotent shutdown. */
export function stopBackend() {
  if (_childProc) {
    try { _childProc.kill('SIGTERM'); } catch { /* already dead */ }
    _childProc = null;
    _spawnedPort = null;
  }
}

/* CLI: ako se pokrene direktno, ensure + log + keep parent alive da child
 * ostane vezan za parent terminal. */
if (process.argv[1] === __filename) {
  const port = Number(process.argv[2]) || 9001;
  ensureBackendRunning({ port }).then((r) => {
    console.log('math-backend ensure result:', JSON.stringify(r, null, 2));
    if (!r.healthOk) process.exit(1);
    /* Keep parent alive so child stays bound. */
    process.on('SIGINT', () => { stopBackend(); process.exit(0); });
    process.on('SIGTERM', () => { stopBackend(); process.exit(0); });
  });
}
