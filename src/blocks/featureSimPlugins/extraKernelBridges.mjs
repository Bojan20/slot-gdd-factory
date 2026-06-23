/**
 * src/blocks/featureSimPlugins/extraKernelBridges.mjs
 *
 * MATH-DEEP B+++++ (2026-06-23) — Additional sister-repo kernel bridges.
 *
 * Wraps two more kernels from the sister-repo (slot-math-engine-template):
 *   - expanding_symbol  (Book-style FS expansion mechanic)
 *   - sticky_wilds      (sticky-wild respin chain)
 *
 * Each kernel has its own Python runner (tools/_kernel-*-runner.py) that
 * handles dict[int, float] → str-keyed JSON coercion.
 *
 * Both bridges follow the same shape established by holdAndWinKernelBridge
 * and clusterEvalKernelBridge:
 *   - In-process cache keyed by relevant model fields
 *   - Returns { ok, rtpContribution, ..., kernelEngine, params }
 *   - Graceful skip when sister repo unavailable
 *
 * Public API
 *   - computeExpandingSymbolKernelRtp(model, options?)
 *   - computeStickyWildsKernelRtp(model, options?)
 *   - _resetCache()
 */

import { detectKernelEngine } from '../../../tools/math-kernel-bridge.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..', '..', '..');

const _cacheExp = new Map();
const _cacheSw  = new Map();
const _cacheCascade = new Map();
const _cacheWays    = new Map();
const _cachePayAny  = new Map();
const _cacheStacked = new Map();

/* Shared helper to invoke the universal runner with kernel name + params. */
function _runUniversal(kernelName, params) {
  const detect = detectKernelEngine();
  if (!detect.available) return { ok: false, reason: `kernel unavailable: ${detect.reason}` };
  const tmpDir = join(tmpdir(), 'extra-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `cfg-${kernelName}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(cfgPath, JSON.stringify(params), 'utf8');
  const runnerPath = resolve(REPO, 'tools/_kernel-universal-runner.py');
  const env = { ...process.env, PYTHONPATH: join(detect.kernelsDir, 'src') };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, kernelName, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000,
  });
  if (proc.status !== 0) {
    return { ok: false, reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}` };
  }
  try {
    const out = JSON.parse((proc.stdout || '').trim());
    if (out.error) return { ok: false, reason: `runner error: ${out.error}` };
    return { ok: true, result: out };
  } catch (e) {
    return { ok: false, reason: `JSON parse: ${e.message}` };
  }
}

/* Shared helper to invoke a runner script with JSON config. */
function _runPython(runnerRelPath, params) {
  const detect = detectKernelEngine();
  if (!detect.available) {
    return { ok: false, reason: `kernel unavailable: ${detect.reason}` };
  }
  const tmpDir = join(tmpdir(), 'extra-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `cfg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(cfgPath, JSON.stringify(params), 'utf8');
  const runnerPath = resolve(REPO, runnerRelPath);
  const env = { ...process.env, PYTHONPATH: join(detect.kernelsDir, 'src') };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000,
  });
  if (proc.status !== 0) {
    return { ok: false, reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}` };
  }
  try {
    const out = JSON.parse((proc.stdout || '').trim());
    if (out.error) return { ok: false, reason: `runner error: ${out.error}` };
    return { ok: true, result: out };
  } catch (e) {
    return { ok: false, reason: `JSON parse: ${e.message}` };
  }
}

/* ── Expanding Symbol (Book-style FS expansion) ──────────────────────── */

/**
 * Compute analytical FS expansion RTP via sister-repo kernel.
 *
 * Model mapping:
 *   model.freeSpins.triggerProbPerSpin → fs_trigger_p
 *   model.freeSpins.awards[*].spins → fs_initial_spins (first award)
 *   model.topology.{reels, rows}
 *   model.expandingWild / industry default 0.12 → p_per_cell_in_fs
 *   model.expandingSymbol.payTable / industry default → pay_table
 */
export async function computeExpandingSymbolKernelRtp(model, options = {}) {
  const fs = model?.freeSpins || {};
  const topo = model?.topology || {};
  const key = JSON.stringify({
    trigger: fs.triggerProbPerSpin,
    spins: fs.awards?.[0]?.spins ?? fs.awards?.[0],
    reels: topo.reels, rows: topo.rows,
    optHash: options ? JSON.stringify(Object.keys(options).sort()) : null,
  });
  if (_cacheExp.has(key)) return _cacheExp.get(key);
  const params = {
    fs_trigger_p: Number.isFinite(fs.triggerProbPerSpin) ? fs.triggerProbPerSpin : 0.01,
    fs_initial_spins: Number(fs.awards?.[0]?.spins || fs.awards?.[0] || 10),
    reels: Number(topo.reels) || 5,
    rows: Number(topo.rows) || 3,
    p_per_cell_in_fs: options.pPerCellInFs ?? 0.12,
    pay_table: options.payTable ?? { 3: 1, 4: 5, 5: 100 },
    symbol_name: options.symbolName ?? '?',
  };
  const r = _runPython('tools/_kernel-expanding-symbol-runner.py', params);
  if (!r.ok) {
    const out = { ok: false, reason: r.reason };
    _cacheExp.set(key, out);
    return out;
  }
  const out = {
    ok: true,
    rtpContribution: r.result.rtp_contribution,
    fsTriggerP: r.result.fs_trigger_p,
    expectedReelsExpandedPerSpin: r.result.expected_reels_expanded_per_spin,
    expectedPayPerTrigger: r.result.expected_pay_per_trigger,
    kernelEngine: 'python-kernel',
    params,
  };
  _cacheExp.set(key, out);
  return out;
}

/* ── Sticky Wilds (respin chain) ──────────────────────────────────────── */

/**
 * Compute analytical sticky-wild chain RTP via sister-repo kernel.
 *
 * Model mapping:
 *   model.stickyWild.triggerProbPerSpin → trigger_p
 *   model.stickyWild.nRespins / industry 3 → n_respins
 *   model.topology.{reels, rows} → n_cells
 *   model.stickyWild.pWildPerCell / industry 0.05 → p_wild_per_cell_per_respin
 *   model.stickyWild.payPerWildCount / industry default → pay_per_wild_count
 */
export async function computeStickyWildsKernelRtp(model, options = {}) {
  const sw = model?.stickyWild || {};
  const topo = model?.topology || {};
  const key = JSON.stringify({
    trigger: sw.triggerProbPerSpin,
    respins: sw.nRespins,
    cells: (topo.reels || 5) * (topo.rows || 3),
    optHash: options ? JSON.stringify(Object.keys(options).sort()) : null,
  });
  if (_cacheSw.has(key)) return _cacheSw.get(key);
  const params = {
    trigger_p: Number.isFinite(sw.triggerProbPerSpin) ? sw.triggerProbPerSpin : 0.02,
    n_respins: Number(sw.nRespins) || 3,
    n_cells: (Number(topo.reels) || 5) * (Number(topo.rows) || 3),
    p_wild_per_cell_per_respin: options.pWildPerCellPerRespin ?? 0.05,
    pay_per_wild_count: options.payPerWildCount ?? { 1: 0.5, 2: 2, 3: 8, 4: 20, 5: 50 },
    initial_wilds: options.initialWilds ?? 1,
  };
  const r = _runPython('tools/_kernel-sticky-wilds-runner.py', params);
  if (!r.ok) {
    const out = { ok: false, reason: r.reason };
    _cacheSw.set(key, out);
    return out;
  }
  const out = {
    ok: true,
    rtpContribution: r.result.rtp_contribution,
    triggerProb: r.result.trigger_p,
    nRespins: r.result.n_respins,
    expectedWildsPerRespin: r.result.expected_wilds_per_respin,
    expectedPayPerChainXBet: r.result.expected_pay_per_chain_x_bet,
    kernelEngine: 'python-kernel',
    params,
  };
  _cacheSw.set(key, out);
  return out;
}

/* ── Cascade (tumble) ─────────────────────────────────────────────────── */

export async function computeCascadeKernelRtp(opts = {}) {
  const params = {
    p_initial_win:           opts.pInitialWin           ?? 0.3,
    base_pay_per_cascade_x_bet: opts.basePayPerCascade  ?? 5,
    p_win_per_cascade:       opts.pWinPerCascade        ?? 0.4,
    multiplier_ladder:       opts.multiplierLadder      || [1, 2, 3, 5, 10],
    max_chain:               opts.maxChain              ?? 10,
  };
  const key = JSON.stringify(params);
  if (_cacheCascade.has(key)) return _cacheCascade.get(key);
  const r = _runUniversal('cascade', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedChainLength: r.result.expected_chain_length, expectedPayPerTriggerXBet: r.result.expected_pay_per_trigger_x_bet, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheCascade.set(key, out);
  return out;
}

/* ── Ways evaluator ──────────────────────────────────────────────────── */

export async function computeWaysEvaluatorKernelRtp(opts = {}) {
  const reels = opts.reels ?? 5;
  const defaultRowDist = { 2: 0.2, 3: 0.5, 4: 0.3 };
  const params = {
    row_distribution_per_reel: opts.rowDistributionPerReel
      || Array.from({ length: reels }, () => defaultRowDist),
    per_way_rtp_x_bet: opts.perWayRtpXBet ?? 0.001,
  };
  const key = JSON.stringify(params);
  if (_cacheWays.has(key)) return _cacheWays.get(key);
  const r = _runUniversal('ways_evaluator', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedWaysCount: r.result.expected_ways_count, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheWays.set(key, out);
  return out;
}

/* ── Pay-anywhere kernel (analytical) ─────────────────────────────────── */

export async function computePayAnywhereKernelRtp(model, opts = {}) {
  const topo = model?.topology || {};
  const params = {
    n_cells:       (Number(topo.reels) || 5) * (Number(topo.rows) || 3),
    p_per_cell:    opts.pPerCell ?? 0.1,
    pay_table:     opts.payTable || { 8: 0.5, 10: 1, 12: 5, 15: 20 },
    min_pay_count: opts.minPayCount ?? 8,
    symbol_name:   opts.symbolName ?? 'HP',
  };
  const key = JSON.stringify(params);
  if (_cachePayAny.has(key)) return _cachePayAny.get(key);
  const r = _runUniversal('pay_anywhere', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedLandings: r.result.expected_landings, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cachePayAny.set(key, out);
  return out;
}

/* ── Stacked Wilds ───────────────────────────────────────────────────── */

export async function computeStackedWildsKernelRtp(model, opts = {}) {
  const topo = model?.topology || {};
  const params = {
    n_reels:               Number(topo.reels) || 5,
    p_stacked_per_reel:    opts.pStackedPerReel ?? 0.02,
    pay_per_stacked_count: opts.payPerStackedCount || { 1: 0.5, 2: 5, 3: 20, 4: 50, 5: 200 },
  };
  const key = JSON.stringify(params);
  if (_cacheStacked.has(key)) return _cacheStacked.get(key);
  const r = _runUniversal('stacked_wilds', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedStackedCount: r.result.expected_stacked_count, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheStacked.set(key, out);
  return out;
}

export function _resetCache() {
  _cacheExp.clear();
  _cacheSw.clear();
  _cacheCascade.clear();
  _cacheWays.clear();
  _cachePayAny.clear();
  _cacheStacked.clear();
}
