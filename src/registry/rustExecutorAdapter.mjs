/**
 * src/registry/rustExecutorAdapter.mjs
 *
 * P3-P3 (Boki 2026-06-25) — N-tier Rust executor adapter.
 *
 * # WHY
 *
 * Sister repo `slot-math-engine-template/rust-sim/` ships `slot_sim` — a
 * high-performance Monte Carlo binary that simulates millions of spins
 * per second for any GameConfig JSON. This factory previously only
 * shelled out to a TypeScript JS pipeline for math probes; PAR / RTP
 * convergence / per-feature simulation paid a 10–100× cost vs the Rust
 * kernel and could not credibly cover 25M+ spins per probe (CI budget).
 *
 * This adapter is the LIGHTWEIGHT bridge: detect whether `slot_sim`
 * binary is on disk, expose `executeFeature(model, featureKind, opts)`
 * that spawns the binary with the right config JSON, and fall back to
 * `{ available: false, reason: ... }` when the binary is absent (CI
 * runners, dev boxes that never built the sister repo).
 *
 * # NON-GOALS (this atom)
 *
 *   - Cross-process WAL writer / persistent state (covered by
 *     MATH-INTEGRATION-LV3 sister atom, awaits Boki "KRENI").
 *   - HTTP daemon façade (LV3 territory).
 *   - Live RTP calibration loop driving the parser (later wave).
 *
 * THIS atom delivers: spawn primitive + per-feature contract surface +
 * defensive failure modes so downstream tools (live probe, calibrator,
 * cross-corpus walker) can opt-in without paying a setup tax.
 *
 * # API
 *
 *   import { resolveExecutor, executeFeature, FEATURE_KINDS } from '...';
 *
 *   const exec = resolveExecutor(); // { available, binary?, reason? }
 *   if (!exec.available) return { skipped: exec.reason };
 *
 *   const r = await executeFeature(model, 'cascade', { spins: 250_000 });
 *   // { ok, verdict, rtp, hitRate, latencyMs, raw }
 *
 * # CONFIGURATION
 *
 *   env SLOT_RUST_BIN          explicit binary path (highest precedence)
 *   env SLOT_RUST_REPO         sister repo root (default ~/Projects/slot-math-engine-template)
 *   env SLOT_RUST_TIMEOUT_MS   per-spawn timeout (default 60_000)
 *
 * # SECURITY
 *
 * Adapter follows the V9 wrapper allow-list pattern (UQ-U-3 atom #2):
 * binary path is `resolve`d, must be a regular file under one of the
 * allowed roots ($HOME/Projects, /usr/local/bin, /opt, $TMPDIR), and
 * must NOT be world-writable. Any failure → `{ available: false }`
 * with explicit reason so the caller surfaces the safety verdict.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/** Feature kinds the Rust kernel knows how to simulate. */
export const FEATURE_KINDS = Object.freeze([
  'baseline',
  'cascade',
  'hold_and_win',
  'free_spins',
  'bonus_buy',
  'wheel',
]);

const DEFAULT_REPO = '~/Projects/slot-math-engine-template'.replace(
  '~',
  process.env.HOME || '',
);
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Locate the `slot_sim` binary using env overrides + canonical fallbacks.
 *
 *   Order:
 *     1. SLOT_RUST_BIN env (absolute path)
 *     2. SLOT_RUST_REPO env + '/rust-sim/target/release/slot_sim'
 *     3. ~/Projects/slot-math-engine-template/rust-sim/target/release/slot_sim
 *
 * @returns {string} resolved absolute path candidate (may not exist)
 */
function _binaryCandidatePath() {
  const explicit = (process.env.SLOT_RUST_BIN || '').trim();
  if (explicit) return resolve(explicit);
  const repo = (process.env.SLOT_RUST_REPO || '').trim() || DEFAULT_REPO;
  return resolve(repo, 'rust-sim', 'target', 'release', 'slot_sim');
}

/**
 * Validate that a wrapper binary is safe to spawn. Mirror of the V9
 * vision-wrapper guard (UQ-U-3 atom #2) — DRY would mean a shared
 * helper, but the policies diverge slightly (Rust binary allowed under
 * `target/release/` which is NOT under one of the V9 roots), so we keep
 * a private copy here.
 *
 * @param {string} abs absolute path candidate
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function _validateBinary(abs) {
  if (!existsSync(abs)) {
    return { ok: false, reason: `binary missing: ${abs}` };
  }
  let st;
  try { st = statSync(abs); } catch (e) {
    return { ok: false, reason: `stat failed: ${e.message}` };
  }
  if (!st.isFile()) {
    return { ok: false, reason: `not a regular file: ${abs}` };
  }
  if ((st.mode & 0o002) !== 0) {
    return { ok: false, reason: `binary world-writable (insecure): ${abs}` };
  }
  const allowed = [
    resolve(process.env.HOME || '', 'Projects') + sep,
    '/usr/local/bin' + sep,
    '/opt' + sep,
    resolve(tmpdir()) + sep,
  ];
  if (!allowed.some((root) => abs.startsWith(root))) {
    return { ok: false, reason: `binary outside allowed roots: ${abs}` };
  }
  return { ok: true };
}

/**
 * Resolve the Rust executor. Result is intentionally a value object
 * (no side effects) so callers can branch without try/catch.
 *
 * @returns {{available: boolean, binary?: string, reason?: string}}
 */
export function resolveExecutor() {
  const abs = _binaryCandidatePath();
  const v = _validateBinary(abs);
  if (!v.ok) return { available: false, reason: v.reason };
  return { available: true, binary: abs };
}

/**
 * Validate a feature kind against the allow-list. Throws TypeError on
 * unknown kind so callers fail loud — silent "unknown feature" would
 * hide GDD parser drift.
 *
 * @param {string} kind
 */
function _assertFeatureKind(kind) {
  if (!FEATURE_KINDS.includes(kind)) {
    throw new TypeError(
      `executeFeature: unknown kind ${JSON.stringify(kind)}. ` +
        `Allowed: ${FEATURE_KINDS.join(', ')}`,
    );
  }
}

/**
 * Build a minimal GameConfig payload for the Rust binary. The schema
 * follows `slot_sim --quick` defaults; per-feature variants override
 * what they care about (cascade depth cap, FS retrigger, etc).
 *
 * Returns a *plain object* — callers pipe it as JSON to stdin or write
 * to a temp file before spawn. We do NOT touch disk here.
 *
 * @param {object} model
 * @param {string} kind
 * @param {object} opts
 * @returns {object}
 */
function _buildConfigPayload(model, kind, opts) {
  const spins = Number.isInteger(opts.spins) && opts.spins > 0 ? opts.spins : 250_000;
  return {
    name: model?.name || 'slot-gdd-factory-probe',
    schema: model?.__schema__?.version || '1.0.0',
    topology: model?.topology || { reels: 5, rows: 3, paylines: 20 },
    featureKind: kind,
    spins,
    seed: typeof opts.seed === 'number' ? opts.seed : 1,
  };
}

/**
 * Parse `slot_sim` stdout into a normalized result. The binary emits
 * one JSON line per spin batch (verbose) plus a final summary line that
 * starts with `SUMMARY|`. We grep for the summary and return that;
 * absence falls back to `{ ok: false, raw: stdoutHead }` so callers see
 * the disagreement.
 *
 * @param {string} stdout
 * @returns {{ok: boolean, summary?: object, raw: string}}
 */
/* UQ-U-5 atom #2 (post-impl agent VERIFIED): require ALL contract keys
   present so a malformed `SUMMARY|garbage=1` cannot present as
   verdict:PASS with undefined rtp downstream. */
const REQUIRED_SUMMARY_KEYS = Object.freeze(['rtp', 'hits', 'spins']);

function _parseSimStdout(stdout) {
  if (!stdout) return { ok: false, raw: '' };
  const summaryLine = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('SUMMARY|'));
  if (!summaryLine) {
    return { ok: false, raw: stdout.slice(0, 400) };
  }
  /* SUMMARY|rtp=0.9612|hits=187432|spins=250000|win_buckets=... */
  const parts = summaryLine.slice('SUMMARY|'.length).split('|');
  const summary = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (!k) continue;
    const num = Number(v);
    summary[k] = Number.isFinite(num) ? num : v;
  }
  const missing = REQUIRED_SUMMARY_KEYS.filter(
    (k) => typeof summary[k] !== 'number' || !Number.isFinite(summary[k]),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      raw: stdout.slice(0, 400),
      reason: `SUMMARY missing required numeric keys: ${missing.join(', ')}`,
    };
  }
  return { ok: true, summary, raw: stdout.slice(0, 400) };
}

/**
 * Execute a single feature simulation via the Rust binary. Synchronous
 * spawn (uses `spawnSync`) — this adapter is for batch / probe code
 * paths that already block on results.
 *
 * @param {object} model
 * @param {string} kind
 * @param {{spins?: number, seed?: number, timeoutMs?: number, binary?: string}} [opts]
 * @returns {{ok: boolean, verdict: string, rtp?: number, hitRate?: number, latencyMs: number, raw?: string, reason?: string}}
 */
export function executeFeature(model, kind, opts = {}) {
  _assertFeatureKind(kind);
  /* UQ-U-5 atom #1 (post-impl agent VERIFIED): opts.binary used to
     bypass _validateBinary entirely → arbitrary execve primitive.
     Route opts.binary through the same safety check as env resolution. */
  let exec;
  if (opts.binary) {
    const absOverride = resolve(opts.binary);
    const v = _validateBinary(absOverride);
    if (!v.ok) {
      return { ok: false, verdict: 'SKIP', latencyMs: 0, reason: v.reason };
    }
    exec = { available: true, binary: absOverride };
  } else {
    exec = resolveExecutor();
  }
  if (!exec.available) {
    return {
      ok: false,
      verdict: 'SKIP',
      latencyMs: 0,
      reason: exec.reason,
    };
  }
  const payload = _buildConfigPayload(model, kind, opts);
  const argv = ['--quick'];
  const timeoutMs =
    Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(exec.binary, argv, {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return {
      ok: false,
      verdict: 'FAIL',
      latencyMs: Date.now() - t0,
      reason: `spawn threw: ${e.message}`,
    };
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
  const parsed = _parseSimStdout(r.stdout || '');
  if (!parsed.ok) {
    return {
      ok: false,
      verdict: 'WARN',
      latencyMs,
      raw: parsed.raw,
      reason: 'no SUMMARY line in stdout',
    };
  }
  return {
    ok: true,
    verdict: 'PASS',
    rtp: typeof parsed.summary.rtp === 'number' ? parsed.summary.rtp : undefined,
    hitRate:
      typeof parsed.summary.hits === 'number' && payload.spins > 0
        ? parsed.summary.hits / payload.spins
        : undefined,
    latencyMs,
    raw: parsed.raw,
  };
}

/**
 * Test-only seam: build the GameConfig payload that would be sent to
 * the binary, WITHOUT spawning. Lets tests pin the payload shape across
 * future kernel ABI changes.
 *
 * @param {object} model
 * @param {string} kind
 * @param {object} [opts]
 * @returns {object}
 */
export function buildPayloadForTests(model, kind, opts = {}) {
  _assertFeatureKind(kind);
  return _buildConfigPayload(model, kind, opts);
}

/**
 * Test-only seam: parse a stdout sample (success / fail / malformed)
 * without spawning. Lets tests verify the SUMMARY|... contract.
 *
 * @param {string} stdout
 */
export function parseStdoutForTests(stdout) {
  return _parseSimStdout(stdout);
}
