#!/usr/bin/env node
/**
 * tools/math-kernel-bridge.mjs
 *
 * FS-7 (MATH-DEEP Grana C, 2026-06-22) — Node → Python kernel IPC bridge.
 *
 * The sister repo `~/Projects/slot-math-engine-template/packages/
 * slot-math-kernels/` exposes 22 deterministic Python kernel modules
 * (asymmetric_paytable, both_ways, buy_feature, cascade, charge_meter,
 * cluster_pays, crash_kernel, expanding_symbol, hold_and_win, money_collect,
 * pay_anywhere, persistent_multiplier, sticky_wilds, ways_evaluator,
 * wheel, …). Each kernel computes regulator-grade math (exact RTP +
 * variance + edge cases) per industry standard. The WASM (`mathEngine.mjs`)
 * wrapper exposes 5 helper fns only — not the full 22.
 *
 * This bridge wraps `slot-math` CLI (sister repo bin script) via
 * child_process.spawnSync, providing Node access to all 22 kernels
 * with deterministic seed propagation + JSON IPC.
 *
 * USAGE
 *   import { callKernel } from './math-kernel-bridge.mjs';
 *   const result = await callKernel('both_ways', {
 *     ltrRtp: 0.96, share: 0.7
 *   });
 *
 * EXIT CODES
 *   0 — kernel call succeeded, output is JSON
 *   1 — sister repo missing OR `slot-math` CLI not installed
 *   2 — kernel name unknown
 *   3 — kernel call threw (invalid params)
 *
 * GRACEFUL DEGRADATION
 *   If sister repo is missing (operator has not cloned slot-math-engine-template),
 *   bridge returns { engine: 'unavailable', reason: '...' } instead of throwing
 *   so callers can fall back to local approximations.
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { isAuditEnabled, logKernelCall } from './kernel-audit-logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const SISTER_REPO = resolve(REPO, '..', 'slot-math-engine-template');

const KNOWN_KERNELS = Object.freeze([
  'asymmetric_paytable', 'both_ways', 'both_ways_expanding_wild', 'buy_feature',
  'cascade', 'charge_meter', 'cluster_pays', 'crash_kernel', 'expanding_symbol',
  'hold_and_win', 'inverse_solver', 'money_collect', 'multi_dim_inverse_solver',
  'must_hit_by', 'pay_anywhere', 'persistent_multiplier', 'pick_chain',
  'stacked_wilds', 'state_machine', 'sticky_wilds', 'ways_evaluator', 'wheel',
]);

/**
 * Detect sister repo availability + CLI path.
 * @returns {{ available: boolean, pythonCmd: string|null, kernelsDir: string|null, reason?: string }}
 */
export function detectKernelEngine() {
  if (!existsSync(SISTER_REPO)) {
    return { available: false, pythonCmd: null, kernelsDir: null,
             reason: `sister repo not found at ${SISTER_REPO}` };
  }
  const kernelsDir = join(SISTER_REPO, 'packages', 'slot-math-kernels');
  if (!existsSync(kernelsDir)) {
    return { available: false, pythonCmd: null, kernelsDir: null,
             reason: `kernels package not present in sister repo` };
  }
  /* Detect Python interpreter. Prefer python3 over python. */
  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    const which = spawnSync('which', [cmd], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) {
      return { available: true, pythonCmd: cmd, kernelsDir };
    }
  }
  return { available: false, pythonCmd: null, kernelsDir,
           reason: 'no python3 / python interpreter in PATH' };
}

/**
 * Invoke a Python kernel via spawnSync.
 * @param {string} kernelName — one of KNOWN_KERNELS
 * @param {object} params — JSON-serializable input
 * @returns {Promise<object>} kernel JSON output (or { engine: 'unavailable', ... })
 */
export async function callKernel(kernelName, params = {}) {
  /* N4 audit: zero-cost when env not set. Captured here for early-return
   * paths too (unknown kernel, unavailable engine). */
  const auditOn = isAuditEnabled();
  const t0 = auditOn ? performance.now() : 0;
  const emit = (ok, engineMode, errorReason) => {
    if (!auditOn) return;
    logKernelCall({
      kernel: kernelName, params, ok, engineMode,
      latencyMs: performance.now() - t0,
      errorReason: errorReason || null,
    });
  };

  if (!KNOWN_KERNELS.includes(kernelName)) {
    emit(false, 'error', `unknown kernel: ${kernelName}`);
    return { engine: 'error', reason: `unknown kernel: ${kernelName}`,
             knownKernels: KNOWN_KERNELS };
  }
  const detect = detectKernelEngine();
  if (!detect.available) {
    emit(false, 'unavailable', detect.reason);
    return { engine: 'unavailable', reason: detect.reason };
  }
  /* Write params to temp JSON for IPC (safer than CLI arg encoding). */
  const tmpDir = join(tmpdir(), 'slot-math-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const paramsFile = join(tmpDir, `${kernelName}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`);
  writeFileSync(paramsFile, JSON.stringify(params), 'utf8');

  /* Invoke sister repo's slot-math CLI via PYTHONPATH so we don't need it
   * pip-installed. The CLI's `run <kernel> --config FILE` sub-command is
   * the intended generic entry point. */
  const env = {
    ...process.env,
    PYTHONPATH: join(detect.kernelsDir, 'src'),
  };
  /* Run CLI as a module so relative imports resolve (`python3 -m
   * slot_math_kernels._cli ...`). Direct file run fails with
   * "attempted relative import" because the file uses `from . import`. */
  const proc = spawnSync(detect.pythonCmd, ['-m', 'slot_math_kernels._cli', 'run', kernelName, '--config', paramsFile],
    { encoding: 'utf8', env, timeout: 30_000 });

  if (proc.error) {
    emit(false, 'error', `python spawn failed: ${proc.error.message}`);
    return { engine: 'error', reason: `python spawn failed: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    emit(false, 'error', `kernel exit ${proc.status}`);
    return { engine: 'error', reason: `kernel exit ${proc.status}: ${(proc.stderr || '').slice(0, 500)}` };
  }
  /* Parse stdout as JSON. CLI may emit human-readable lines BEFORE the JSON
   * payload — pick last brace-balanced JSON block. */
  const stdout = (proc.stdout || '').trim();
  /* UQ-DEEP-E audit fix (KERNEL-3): empty stdout must NOT silently
   * succeed. Previously `JSON.parse('')` threw, fell to regex match
   * (no braces → no match), fell to bottom-of-function silent success
   * with `{ result: { raw: '' } }`. Regulators consuming this as RTP
   * number got `undefined`. Surface empty stdout as failure. */
  if (!stdout) {
    emit(false, 'error', 'kernel emitted no stdout');
    return { engine: 'error', reason: 'kernel emitted no stdout', stderr: (proc.stderr || '').slice(0, 300) };
  }
  try {
    /* Try direct JSON parse first. */
    const out = { engine: 'python-kernel', kernel: kernelName, result: JSON.parse(stdout) };
    emit(true, 'python-kernel', null);
    return out;
  } catch (_) {
    /* Find last JSON object in stdout. */
    const m = stdout.match(/\{[\s\S]*\}$/);
    if (m) {
      try {
        const out = { engine: 'python-kernel', kernel: kernelName, result: JSON.parse(m[0]) };
        emit(true, 'python-kernel', null);
        return out;
      }
      catch (e2) {
        emit(false, 'error', `JSON parse failed: ${e2.message}`);
        return { engine: 'error', reason: `JSON parse failed: ${e2.message}`, raw: stdout.slice(0, 500) };
      }
    }
    /* UQ-DEEP-E audit fix (KERNEL-3): the bottom-of-function path
     * previously returned `{ engine: 'python-kernel', result: { raw:
     * stdout } }` AND emitted success=true. Operator-facing
     * dashboards saw `.result.rtp = undefined` as "kernel ok, no
     * RTP" instead of "kernel failed, no parseable result". Surface
     * as ERROR instead. */
    emit(false, 'error', 'no parseable JSON in stdout');
    return {
      engine: 'error',
      reason: 'no parseable JSON in kernel stdout',
      raw: stdout.slice(0, 500),
      stderr: (proc.stderr || '').slice(0, 300),
    };
  }
}

/**
 * List all 22 known kernels.
 * @returns {Array<string>}
 */
export function listKernels() {
  return [...KNOWN_KERNELS];
}

/* ── CLI mode (invocable via `node tools/math-kernel-bridge.mjs --help`) ── */
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === '--help' || cmd === '-h' || !cmd) {
    console.log('Usage: node tools/math-kernel-bridge.mjs <command> [args]');
    console.log('Commands:');
    console.log('  detect              — print engine availability');
    console.log('  list                — list 22 known kernels');
    console.log('  call <kernel> [JSON]— invoke kernel with params');
    process.exit(0);
  }
  if (cmd === 'detect') {
    const d = detectKernelEngine();
    console.log(JSON.stringify(d, null, 2));
    process.exit(d.available ? 0 : 1);
  }
  if (cmd === 'list') {
    console.log(JSON.stringify(listKernels(), null, 2));
    process.exit(0);
  }
  if (cmd === 'call') {
    const kernel = args[1];
    const paramsRaw = args[2] || '{}';
    let params;
    try { params = JSON.parse(paramsRaw); }
    catch (e) { console.error('invalid JSON params:', e.message); process.exit(3); }
    (async () => {
      const r = await callKernel(kernel, params);
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.engine === 'python-kernel' ? 0 : 1);
    })();
  }
}
