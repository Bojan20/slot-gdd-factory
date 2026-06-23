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

export function _resetCache() {
  _cacheExp.clear();
  _cacheSw.clear();
}
