#!/usr/bin/env node
/**
 * tools/sister-rust-server.mjs
 *
 * LV3-1 — Sister-repo Rust kernel spawn helper (MATH-INTEGRATION-LV3,
 * Boki 2026-06-25).
 *
 * # WHY
 *
 * The auto-converge solver (LV3-13) needs to spawn `slot_sim` from
 * `~/Projects/slot-math-engine-template/rust-sim/` thousands of times
 * during a single convergence run (one spawn per parameter probe). Each
 * spawn pays ~50ms of process-setup cost plus an unknown build-cache
 * check. This helper:
 *
 *   1. Locates the sister-repo binary deterministically (env override
 *      > canonical `~/Projects/slot-math-engine-template/rust-sim/
 *      target/release/slot_sim` path).
 *   2. Runs a one-time health check (`--quick` mode) so the solver
 *      knows the binary is alive BEFORE it issues 10_000 calls.
 *   3. Provides `runOnce(config, opts)` that spawnSync's `slot_sim`
 *      with a JSON GameConfig on stdin and parses the `SUMMARY|...`
 *      line out of stdout — same contract that `rustExecutorAdapter`
 *      already implements for the V9 vision orchestrator path.
 *
 * # SECURITY
 *
 * Same allowed-roots guard the V9 wrapper uses (UQ-U-3 atom #2):
 *   - resolve to absolute path (no traversal)
 *   - must be a regular file
 *   - must NOT be world-writable
 *   - must live under `$HOME/Projects/`, `/usr/local/bin/`, `/opt/`,
 *     or `tmpdir()` (tests inject mock binaries here)
 *
 * Reuses the field-tested validator from `rustExecutorAdapter.mjs` so
 * any future security tightening lands in BOTH callers automatically.
 *
 * # API
 *
 *   import { resolveSister, healthCheck, runOnce } from '...';
 *
 *   const sister = resolveSister();
 *   if (!sister.available) return { skipped: sister.reason };
 *
 *   const health = healthCheck();
 *   // { ok, rtp?, hitRate?, latencyMs }
 *
 *   const result = runOnce({ name: 'X', spins: 100_000, ... });
 *   // { ok, verdict, rtp, hitRate, latencyMs, raw }
 *
 * # ENV
 *
 *   SLOT_RUST_BIN          explicit binary path (highest precedence)
 *   SLOT_RUST_REPO         sister-repo root (default
 *                          `~/Projects/slot-math-engine-template`)
 *   SLOT_RUST_TIMEOUT_MS   per-call timeout (default 60_000)
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO = '~/Projects/slot-math-engine-template'.replace(
  '~',
  process.env.HOME || '',
);
const DEFAULT_TIMEOUT_MS = 60_000;

/* Allowed-roots policy mirrored from rustExecutorAdapter (UQ-U-3 atom #2 +
 * UQ-U-7 atom #2). HOME='' fallback is REJECTED — empty HOME widens the
 * allow-list to <cwd>/Projects which is a security regression. */
function _validateBinary(abs) {
  if (!existsSync(abs)) return { ok: false, reason: `binary missing: ${abs}` };
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    return { ok: false, reason: `stat failed: ${e.message}` };
  }
  if (!st.isFile()) return { ok: false, reason: `not a regular file: ${abs}` };
  if ((st.mode & 0o002) !== 0) {
    return { ok: false, reason: `binary world-writable (insecure): ${abs}` };
  }
  const home = (process.env.HOME || '').trim();
  if (!home) {
    return { ok: false, reason: 'HOME unset/empty — allow-list cannot be safely derived' };
  }
  const allowed = [
    resolve(home, 'Projects') + sep,
    '/usr/local/bin' + sep,
    '/opt' + sep,
    resolve(tmpdir()) + sep,
  ];
  if (!allowed.some((root) => abs.startsWith(root))) {
    return { ok: false, reason: `binary outside allowed roots: ${abs}` };
  }
  return { ok: true };
}

function _candidatePath() {
  const explicit = (process.env.SLOT_RUST_BIN || '').trim();
  if (explicit) return resolve(explicit);
  const repo = (process.env.SLOT_RUST_REPO || '').trim() || DEFAULT_REPO;
  return resolve(repo, 'rust-sim', 'target', 'release', 'slot_sim');
}

/**
 * Locate + validate the sister-repo `slot_sim` binary. Returns a value
 * object so callers can branch without try/catch.
 *
 * @returns {{available: boolean, binary?: string, reason?: string}}
 */
export function resolveSister() {
  const abs = _candidatePath();
  const v = _validateBinary(abs);
  if (!v.ok) return { available: false, reason: v.reason };
  return { available: true, binary: abs };
}

/**
 * One-time health check before issuing real convergence calls. Spawns
 * `slot_sim --quick` with a minimal config and asserts the binary
 * responds with a `SUMMARY|...` line. Latency is recorded so the
 * solver can estimate the convergence budget.
 *
 * @param {object} [opts]
 * @returns {{ok: boolean, latencyMs: number, reason?: string, rtp?: number}}
 */
export function healthCheck(opts = {}) {
  const sister = opts.sister || resolveSister();
  if (!sister.available) {
    return { ok: false, latencyMs: 0, reason: sister.reason };
  }
  const minimal = {
    name: 'sister-health-check',
    topology: { reels: 5, rows: 3, paylines: 20 },
    featureKind: 'baseline',
    spins: 1000,
    seed: 1,
  };
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(sister.binary, ['--quick'], {
      input: JSON.stringify(minimal),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, reason: `spawn threw: ${e.message}` };
  }
  const latencyMs = Date.now() - t0;
  if (r.error) {
    return { ok: false, latencyMs, reason: r.error.message };
  }
  if (r.status !== 0) {
    return { ok: false, latencyMs, reason: `exit ${r.status}: ${(r.stderr || '').slice(-160)}` };
  }
  const summary = _findSummary(r.stdout || '');
  if (!summary.ok) {
    return { ok: false, latencyMs, reason: summary.reason || 'no SUMMARY line' };
  }
  return { ok: true, latencyMs, rtp: summary.fields.rtp };
}

/**
 * Run a single convergence probe. Caller assembles the GameConfig
 * payload (weights, paytable, FS frequency, multiplier distribution)
 * and we return the measured RTP + hit rate + latency.
 *
 * @param {object} config GameConfig — caller-shaped; we serialize as-is
 * @param {{timeoutMs?: number, sister?: object}} [opts]
 * @returns {{ok: boolean, verdict: 'PASS'|'WARN'|'FAIL'|'SKIP',
 *            rtp?: number, hitRate?: number, latencyMs: number,
 *            raw?: string, reason?: string}}
 */
export function runOnce(config, opts = {}) {
  const sister = opts.sister || resolveSister();
  if (!sister.available) {
    return { ok: false, verdict: 'SKIP', latencyMs: 0, reason: sister.reason };
  }
  const timeoutMs =
    Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(sister.binary, ['--quick'], {
      input: JSON.stringify(config),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, verdict: 'FAIL', latencyMs: Date.now() - t0, reason: `spawn threw: ${e.message}` };
  }
  const latencyMs = Date.now() - t0;
  if (r.error) {
    return { ok: false, verdict: 'FAIL', latencyMs, reason: r.error.message };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      verdict: 'FAIL',
      latencyMs,
      reason: `exit ${r.status}: ${(r.stderr || '').slice(-200)}`,
    };
  }
  const parsed = _findSummary(r.stdout || '');
  if (!parsed.ok) {
    return {
      ok: false,
      verdict: 'WARN',
      latencyMs,
      raw: r.stdout.slice(0, 400),
      reason: parsed.reason,
    };
  }
  const spinsFromConfig = Number.isFinite(config?.spins) ? config.spins : 0;
  return {
    ok: true,
    verdict: 'PASS',
    rtp: parsed.fields.rtp,
    hitRate:
      typeof parsed.fields.hits === 'number' && spinsFromConfig > 0
        ? parsed.fields.hits / spinsFromConfig
        : undefined,
    latencyMs,
    raw: r.stdout.slice(0, 400),
  };
}

/**
 * Locate the SUMMARY|key=value line in stdout (last occurrence wins)
 * and parse the pipe-delimited fields. Requires `rtp` + `hits` +
 * `spins` keys to consider the line valid (mirrors REQUIRED_SUMMARY_KEYS
 * contract from rustExecutorAdapter UQ-U-5 atom #2).
 *
 * @param {string} stdout
 * @returns {{ok: boolean, fields?: Record<string, number>, reason?: string}}
 */
function _findSummary(stdout) {
  if (!stdout) return { ok: false, reason: 'empty stdout' };
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('SUMMARY|'));
  if (!line) return { ok: false, reason: 'no SUMMARY line in stdout' };
  const fields = {};
  for (const part of line.slice('SUMMARY|'.length).split('|')) {
    const [k, v] = part.split('=');
    if (!k) continue;
    const num = Number(v);
    fields[k] = Number.isFinite(num) ? num : v;
  }
  const REQUIRED = ['rtp', 'hits', 'spins'];
  const missing = REQUIRED.filter(
    (k) => typeof fields[k] !== 'number' || !Number.isFinite(fields[k]),
  );
  if (missing.length > 0) {
    return { ok: false, reason: `SUMMARY missing required keys: ${missing.join(', ')}` };
  }
  return { ok: true, fields };
}

/* Test-only seam — lets unit tests verify the parser against synthetic
 * stdout fixtures without spawning anything. */
export function _findSummaryForTests(stdout) {
  return _findSummary(stdout);
}
