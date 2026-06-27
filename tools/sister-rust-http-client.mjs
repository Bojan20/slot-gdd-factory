#!/usr/bin/env node
/**
 * tools/sister-rust-http-client.mjs
 *
 * LV3-2 — Long-lived sister-repo Rust HTTP daemon client (MATH-INTEGRATION-LV3,
 * Boki 2026-06-26).
 *
 * # WHY
 *
 * The LV3-1 helper (`sister-rust-server.mjs`) spawns `slot_sim --quick`
 * **once per probe**. The auto-converge solver (LV3-13) needs thousands
 * of probes per run, and each spawn pays ~50 ms of process-setup cost.
 * 10 000 probes × 50 ms = **8 minutes wasted** before any real Monte
 * Carlo work happens.
 *
 * This module spawns the LV3-2 `http_server` binary **once** and reuses
 * the warm process across every subsequent probe. Per-probe overhead
 * drops from ~50 ms (process spawn) to ~1–3 ms (TCP round-trip on
 * loopback). The MC kernel itself dominates wall-time as it should.
 *
 * # CONTRACT
 *
 * The server emits exactly one line to stdout on successful bind:
 *
 *   READY|http://127.0.0.1:<port>
 *
 * followed by a flush, then keeps serving. We parse that line, store
 * the base URL, and route every `/spin`, `/batch`, and `/health` call
 * through `fetch()`.
 *
 * The `/spin` response carries the **same three keys** the LV3-1
 * `_findSummary` parser requires (`rtp`, `hits`, `spins`) so callers
 * that already speak SUMMARY pipes can either stay on the canonical
 * `summary` string field or take the numeric keys directly.
 *
 * # SECURITY
 *
 * Reuses the same allowed-roots validator the LV3-1 helper uses (UQ-U-3
 * atom #2 + UQ-U-7 atom #2). `HOME=''` fallback is REJECTED — empty
 * HOME widens the allow-list to `<cwd>/Projects` which is a security
 * regression we already burned ourselves on.
 *
 * The binary itself enforces **loopback-only** binds by default; we
 * never pass `--allow-public-bind` from this client.
 *
 * # API
 *
 *   import { resolveHttpBinary, spawnHttpServer, runOnceHttp,
 *            runBatchHttp, healthCheckHttp } from './sister-rust-http-client.mjs';
 *
 *   const sister = resolveHttpBinary();
 *   if (!sister.available) return { skipped: sister.reason };
 *
 *   const server = await spawnHttpServer({ sister, capSpins: 100_000 });
 *   try {
 *     const health = await healthCheckHttp(server.baseUrl);
 *     // { ok, version, uptimeSecs, spinRequests, ... }
 *
 *     const result = await runOnceHttp(server.baseUrl, gameConfig, {
 *       spins: 5000, seeds: 1, sequential: true,
 *     });
 *     // { ok, verdict, rtp, hits, spins, hitRate, latencyMs, summary }
 *   } finally {
 *     await server.dispose();
 *   }
 *
 * # ENV
 *
 *   SLOT_RUST_HTTP_BIN          explicit binary path override (highest)
 *   SLOT_RUST_HTTP_REPO         sister-repo root (default `~/Projects/slot-math-engine-template`)
 *   SLOT_RUST_HTTP_LISTEN       listen address (default `127.0.0.1:0`)
 *   SLOT_RUST_HTTP_TIMEOUT_MS   per-request timeout (default 60_000)
 *   SLOT_RUST_HTTP_READY_MS     READY-line wait timeout (default 10_000)
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/* PAR-14-D (Boki 2026-06-27): default undici headersTimeout / bodyTimeout
 * is 300_000 ms (5 min). At 100M × 4 = 400M spins per slug the sister
 * Rust kernel blocks the HTTP response for ~25–30 min while it crunches,
 * so a fresh dispatcher with much longer timeouts is required for any
 * tier above ~30M spins / request.
 *
 * Imported from the `undici` package directly. Node bundles it
 * internally but doesn't expose `Agent` via a stable global path, so
 * the npm dep is the simplest cross-version solution. If the import
 * fails (e.g. someone runs this tool outside the repo without devDeps
 * installed), we fall back to a null dispatcher — vanilla fetch still
 * works for sub-5-min requests, and the caller's AbortController +
 * setTimeout still bounds the operation app-side.
 *
 * Override via SLOT_RUST_HTTP_DISPATCHER_TIMEOUT_MS env (default 1 h). */
const DISPATCHER_TIMEOUT_MS =
  Number(process.env.SLOT_RUST_HTTP_DISPATCHER_TIMEOUT_MS) || 3_600_000;
try {
  /* Cross-version compatibility: Node ships its own undici internally;
   * `import { Agent }` from the devDep returns a separate copy that
   * passes the `dispatcher:` option but isn't recognised by Node's
   * internal fetch in 22+/25. setGlobalDispatcher() patches the live
   * Node dispatcher in place so every fetch() — internal or external —
   * picks up the extended timeouts uniformly. */
  const { Agent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new Agent({
    headersTimeout: DISPATCHER_TIMEOUT_MS,
    bodyTimeout: DISPATCHER_TIMEOUT_MS,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 60_000,
  }));
} catch {
  /* undici devDep not present — sub-5-min runs still work via the
   * default global dispatcher; large-tier callers should `npm i` to
   * pick up the long-running dispatcher path. */
}
const LONG_RUN_DISPATCHER = null;  /* setGlobalDispatcher path used above */

/* JEDAN PROJEKAT (Boki 2026-06-27): vendored u slot-gdd-factory. */
const HOME_DIR = process.env.HOME || '';
const VENDORED_MATH_REPO = resolve(HOME_DIR, 'Projects', 'slot-gdd-factory', 'vendor', 'math-engine');
const LEGACY_SISTER_REPO = resolve(HOME_DIR, 'Projects', 'slot-math-engine-template');
const DEFAULT_REPO = existsSync(VENDORED_MATH_REPO) ? VENDORED_MATH_REPO : LEGACY_SISTER_REPO;
const VENDOR_BIN_DIR = resolve(HOME_DIR, 'Projects', 'slot-gdd-factory', 'vendor', 'bin');
const DEFAULT_LISTEN = '127.0.0.1:0';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_READY_MS = 10_000;

/* Allowed-roots policy mirrored from sister-rust-server.mjs (UQ-U-3 atom #2
 * + UQ-U-7 atom #2). HOME='' fallback is REJECTED — empty HOME widens the
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
    return {
      ok: false,
      reason: 'HOME unset/empty — allow-list cannot be safely derived',
    };
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

function _candidateHttpPath() {
  const explicit = (process.env.SLOT_RUST_HTTP_BIN || '').trim();
  if (explicit) return resolve(explicit);
  /* JEDAN PROJEKAT: vendor/bin/http_server ima prioritet. */
  const vendorBin = resolve(VENDOR_BIN_DIR, 'http_server');
  if (existsSync(vendorBin)) return vendorBin;
  const repo = (process.env.SLOT_RUST_HTTP_REPO || '').trim() || DEFAULT_REPO;
  /* Vendored repo ima `rust-sim/target/release/http_server`, ali legacy
   * sister-repo build može imati i `target/release/http_server` (top-level).
   * Probaj rust-sim podput PRVI ako postoji. */
  const rustSimPath = resolve(repo, 'rust-sim', 'target', 'release', 'http_server');
  if (existsSync(rustSimPath)) return rustSimPath;
  return resolve(repo, 'target', 'release', 'http_server');
}

/**
 * Locate + validate the sister-repo `http_server` binary. Mirrors
 * `resolveSister()` from LV3-1 but with the LV3-2 binary path + env var
 * namespace. Returns a value object so callers can branch without
 * try/catch.
 *
 * @returns {{available: boolean, binary?: string, reason?: string}}
 */
export function resolveHttpBinary() {
  const abs = _candidateHttpPath();
  const v = _validateBinary(abs);
  if (!v.ok) return { available: false, reason: v.reason };
  return { available: true, binary: abs };
}

/**
 * Spawn the long-lived HTTP daemon and wait for its READY line. The
 * binary writes:
 *
 *   READY|http://127.0.0.1:<port>
 *
 * on successful bind. We parse that line, store the base URL, and
 * return a handle the caller uses for every subsequent /spin / /batch /
 * /health call.
 *
 * The returned `child` is **kept alive** until `dispose()` is awaited.
 * `dispose()` sends SIGTERM (graceful shutdown the binary handles
 * natively) and falls back to SIGKILL after `forceKillAfterMs`.
 *
 * @param {object} [opts]
 * @param {object} [opts.sister]              pre-resolved binary handle
 * @param {string} [opts.listen]              host:port (default 127.0.0.1:0)
 * @param {number} [opts.capTotalSpins]       --max-total-spins-per-request
 * @param {number} [opts.capSeeds]            --max-seeds-per-request
 * @param {number} [opts.capBatchItems]       --max-batch-items
 * @param {number} [opts.capConcurrentRuns]   --max-concurrent-runs
 * @param {number} [opts.readyTimeoutMs]      READY-line wait deadline
 * @param {number} [opts.forceKillAfterMs]    SIGKILL fallback delay
 * @returns {Promise<{baseUrl: string, child: import('node:child_process').ChildProcess,
 *                    dispose: () => Promise<void>}>}
 */
export async function spawnHttpServer(opts = {}) {
  const sister = opts.sister || resolveHttpBinary();
  if (!sister.available) {
    throw new Error(`sister http binary unavailable: ${sister.reason}`);
  }
  const listen = opts.listen || process.env.SLOT_RUST_HTTP_LISTEN || DEFAULT_LISTEN;
  const readyTimeoutMs = Number.isInteger(opts.readyTimeoutMs)
    ? opts.readyTimeoutMs
    : Number(process.env.SLOT_RUST_HTTP_READY_MS) || DEFAULT_READY_MS;
  const forceKillAfterMs = Number.isInteger(opts.forceKillAfterMs)
    ? opts.forceKillAfterMs
    : 5_000;

  const args = ['--listen', listen];
  if (Number.isInteger(opts.capTotalSpins) && opts.capTotalSpins > 0) {
    args.push('--max-total-spins-per-request', String(opts.capTotalSpins));
  }
  if (Number.isInteger(opts.capSeeds) && opts.capSeeds > 0) {
    args.push('--max-seeds-per-request', String(opts.capSeeds));
  }
  if (Number.isInteger(opts.capBatchItems) && opts.capBatchItems > 0) {
    args.push('--max-batch-items', String(opts.capBatchItems));
  }
  if (Number.isInteger(opts.capConcurrentRuns) && opts.capConcurrentRuns > 0) {
    args.push('--max-concurrent-runs', String(opts.capConcurrentRuns));
  }

  const child = spawn(sister.binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    /* Pass through HOME so the child's own allowed-roots policy
     * (if any) can derive the same allow-list. PATH is forwarded for
     * library lookups on macOS. Nothing else leaks. */
    env: {
      HOME: process.env.HOME || '',
      PATH: process.env.PATH || '',
      ...(process.env.RUST_LOG ? { RUST_LOG: process.env.RUST_LOG } : {}),
    },
  });

  let exited = false;
  let exitInfo = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  let baseUrl;
  let stdoutBuf = '';
  /* Hoisted so the timeout path + the catch block can always uninstall
   * the stdout listener, even if `readyPromise` lost the race. Without
   * this guard a late READY line (or any later stdout chunk) would still
   * trigger the now-stale `onData` and could leak across a re-spawn —
   * caught by the LV3-2 cross-paralel audit. */
  let onData = null;
  const detachOnData = () => {
    if (onData) {
      child.stdout.off('data', onData);
      onData = null;
    }
  };
  const readyPromise = new Promise((resolveReady, rejectReady) => {
    onData = (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      const nl = stdoutBuf.indexOf('\n');
      if (nl < 0) return;
      const line = stdoutBuf.slice(0, nl).trim();
      if (line.startsWith('READY|')) {
        baseUrl = line.slice('READY|'.length).trim();
        detachOnData();
        resolveReady(baseUrl);
      } else if (stdoutBuf.length > 4096) {
        /* Defensive cap — if the child writes 4 KiB without a newline
         * something is wrong (verbose log mode, corrupt binary). Reject
         * so the spawn doesn't hang forever. */
        detachOnData();
        rejectReady(new Error(`no READY line in first 4 KiB: ${stdoutBuf.slice(0, 200)}`));
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', () => {
      if (!baseUrl) {
        detachOnData();
        rejectReady(
          new Error(
            `http_server exited before READY (code=${exitInfo?.code}, signal=${exitInfo?.signal})`,
          ),
        );
      }
    });
  });

  const timeoutPromise = sleep(readyTimeoutMs).then(() => {
    if (!baseUrl) {
      throw new Error(`READY line not received within ${readyTimeoutMs} ms`);
    }
  });

  try {
    await Promise.race([readyPromise, timeoutPromise]);
  } catch (e) {
    /* Spawn failed — make sure the child is reaped AND the stdout
     * listener is uninstalled before we surface. The listener detach
     * matters even if the child is about to die: stdout can buffer one
     * more chunk between SIGTERM and SIGKILL, and a stale `onData` would
     * fire against a half-torn-down state. */
    detachOnData();
    if (!exited) {
      child.kill('SIGTERM');
      await sleep(Math.min(forceKillAfterMs, 1_000));
      if (!exited) child.kill('SIGKILL');
    }
    throw e;
  }

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (exited) return;
    child.kill('SIGTERM');
    /* Wait up to forceKillAfterMs for graceful shutdown, then SIGKILL.
     * The binary's tokio::select! between SIGINT/SIGTERM handles this
     * path natively and drains in-flight requests first. */
    const deadline = Date.now() + forceKillAfterMs;
    while (!exited && Date.now() < deadline) {
      await sleep(50);
    }
    if (!exited) child.kill('SIGKILL');
  };

  return { baseUrl, child, dispose };
}

/**
 * GET `${baseUrl}/health`. Returns the JSON body untouched on 2xx, or
 * an `{ok: false, reason}` envelope on any error.
 *
 * @param {string} baseUrl
 * @param {{timeoutMs?: number}} [opts]
 */
export async function healthCheckHttp(baseUrl, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs)
    ? opts.timeoutMs
    : Number(process.env.SLOT_RUST_HTTP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/health`, {
      signal: ctrl.signal,
      ...(LONG_RUN_DISPATCHER ? { dispatcher: LONG_RUN_DISPATCHER } : {}),
    });
    if (!resp.ok) {
      return { ok: false, reason: `health http ${resp.status}` };
    }
    const body = await resp.json();
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, reason: `health fetch failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST `${baseUrl}/spin`. Returns a shape identical to the LV3-1
 * `runOnce()` helper so callers can route either path without branching
 * on the return value:
 *
 *   { ok, verdict, rtp, hitRate, latencyMs, summary, raw, spins, hits }
 *
 * `verdict` is `'PASS'` on 2xx, `'WARN'` if the server returned 2xx but
 * the body is missing required keys, `'FAIL'` on any 4xx/5xx or network
 * error.
 *
 * @param {string} baseUrl
 * @param {object} config GameConfig (sister-repo-shaped — serialized as-is)
 * @param {{spins?: number, seeds?: number, seed?: number, sequential?: boolean,
 *          totalBetMc?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, verdict: 'PASS'|'WARN'|'FAIL',
 *                    rtp?: number, hitRate?: number, hits?: number,
 *                    spins?: number, latencyMs: number, summary?: string,
 *                    raw?: string, reason?: string}>}
 */
export async function runOnceHttp(baseUrl, config, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs)
    ? opts.timeoutMs
    : Number(process.env.SLOT_RUST_HTTP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const payload = { config };
  if (Number.isInteger(opts.spins)) payload.spins = opts.spins;
  if (Number.isInteger(opts.seeds)) payload.seeds = opts.seeds;
  if (Number.isInteger(opts.seed)) payload.seed = opts.seed;
  if (typeof opts.sequential === 'boolean') payload.sequential = opts.sequential;
  /* PAR-6 (sister 665f0c98): per-spin total bet in millicredits. The
   * sister kernel validates the range server-side; we forward only when
   * caller explicitly sets it so legacy callers stay byte-compatible. */
  if (Number.isInteger(opts.totalBetMc) && opts.totalBetMc > 0) {
    payload.total_bet_mc = opts.totalBetMc;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const resp = await fetch(`${baseUrl}/spin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      ...(LONG_RUN_DISPATCHER ? { dispatcher: LONG_RUN_DISPATCHER } : {}),
    });
    const latencyMs = Date.now() - t0;
    if (!resp.ok) {
      let reason = `http ${resp.status}`;
      try {
        const body = await resp.json();
        if (body?.error) reason = `${reason}: ${body.error}`;
      } catch {
        /* non-JSON error body — keep status-line reason */
      }
      return { ok: false, verdict: 'FAIL', latencyMs, reason };
    }
    const body = await resp.json();
    if (
      typeof body?.rtp !== 'number' ||
      typeof body?.hits !== 'number' ||
      typeof body?.spins !== 'number'
    ) {
      return {
        ok: false,
        verdict: 'WARN',
        latencyMs,
        raw: JSON.stringify(body).slice(0, 400),
        reason: 'response missing required keys (rtp/hits/spins)',
      };
    }
    /* hitRate parity with LV3-1 `runOnce`: LV3-1 computes
     *    hitRate = hits / config.spins
     * (i.e. wins-per-spin against the SPINS-PER-SEED budget the caller
     * asked for, not the simulator's TOTAL `spins_per_seed × num_seeds`).
     * The server returns `hit_rate = winning_spins / total_spins`, which
     * diverges when seeds > 1. Cross-paralel audit (2026-06-26) flagged
     * this as a silent math drift risk for callers using hitRate for
     * convergence calibration. We prefer the LV3-1 formula and fall
     * back to the server-side number only when the caller did not
     * supply `opts.spins` (in which case the server-side value is the
     * only honest answer). */
    const callerSpins = Number.isInteger(opts.spins) ? opts.spins : 0;
    const lv3OneHitRate =
      callerSpins > 0 && Number.isFinite(body.hits) ? body.hits / callerSpins : undefined;
    const serverHitRate = typeof body.hit_rate === 'number' ? body.hit_rate : undefined;
    return {
      ok: true,
      verdict: 'PASS',
      rtp: body.rtp,
      hits: body.hits,
      spins: body.spins,
      hitRate: lv3OneHitRate ?? serverHitRate,
      latencyMs,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
      raw: JSON.stringify(body).slice(0, 400),
    };
  } catch (e) {
    return { ok: false, verdict: 'FAIL', latencyMs: Date.now() - t0, reason: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST `${baseUrl}/batch`. Caller passes an array of `{id, config,
 * spins?, seeds?, seed?, sequential?}` items; the server runs them
 * sequentially and returns one result per item with the same `id` for
 * order-independent merging.
 *
 * @param {string} baseUrl
 * @param {Array<{id: string, config: object, spins?: number, seeds?: number,
 *                seed?: number, sequential?: boolean}>} items
 * @param {{stopOnError?: boolean, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, verdict: 'PASS'|'WARN'|'FAIL',
 *                    successCount: number, failureCount: number,
 *                    totalLatencyMs: number,
 *                    results: Array<{id: string, ok: boolean,
 *                                     rtp?: number, hits?: number, spins?: number,
 *                                     hitRate?: number, latencyMs: number,
 *                                     summary?: string, error?: string}>,
 *                    reason?: string}>}
 */
export async function runBatchHttp(baseUrl, items, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs)
    ? opts.timeoutMs
    : Number(process.env.SLOT_RUST_HTTP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  if (!Array.isArray(items) || items.length === 0) {
    return {
      ok: false,
      verdict: 'FAIL',
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: 0,
      results: [],
      reason: 'items must be a non-empty array',
    };
  }
  const payload = {
    items,
    stop_on_error: opts.stopOnError === true,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const resp = await fetch(`${baseUrl}/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      ...(LONG_RUN_DISPATCHER ? { dispatcher: LONG_RUN_DISPATCHER } : {}),
    });
    const totalLatencyMs = Date.now() - t0;
    if (!resp.ok) {
      let reason = `http ${resp.status}`;
      try {
        const body = await resp.json();
        if (body?.error) reason = `${reason}: ${body.error}`;
      } catch {
        /* keep status-line reason */
      }
      return {
        ok: false,
        verdict: 'FAIL',
        successCount: 0,
        failureCount: 0,
        totalLatencyMs,
        results: [],
        reason,
      };
    }
    const body = await resp.json();
    const results = (body.results || []).map((r) => ({
      id: r.id,
      ok: r.ok,
      rtp: typeof r.rtp === 'number' ? r.rtp : undefined,
      hits: typeof r.hits === 'number' ? r.hits : undefined,
      spins: typeof r.spins === 'number' ? r.spins : undefined,
      hitRate: typeof r.hit_rate === 'number' ? r.hit_rate : undefined,
      latencyMs: typeof r.latency_ms === 'number' ? r.latency_ms : 0,
      summary: typeof r.summary === 'string' ? r.summary : undefined,
      error: typeof r.error === 'string' ? r.error : undefined,
    }));
    const successCount = Number.isInteger(body.success_count) ? body.success_count : 0;
    const failureCount = Number.isInteger(body.failure_count) ? body.failure_count : 0;
    return {
      ok: failureCount === 0,
      verdict: failureCount === 0 ? 'PASS' : 'WARN',
      successCount,
      failureCount,
      totalLatencyMs,
      results,
    };
  } catch (e) {
    return {
      ok: false,
      verdict: 'FAIL',
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: Date.now() - t0,
      results: [],
      reason: e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* Test-only seam — lets unit tests inject a custom path resolver
 * without touching env vars. */
export const _internal = {
  _validateBinary,
  _candidateHttpPath,
};
