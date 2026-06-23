/**
 * src/blocks/featureSimPlugins/clusterEvalKernelBridge.mjs
 *
 * MATH-DEEP B+ (2026-06-23) — Cluster-pays kernel pre-flight bridge.
 *
 * Purpose
 *   Maps cluster-topology model → sister-repo `cluster_pays` kernel
 *   (ClusterPaysParams shape) + returns analytical per-spin RTP contribution.
 *
 * Why
 *   Probe's clusterEval.mjs is a Monte-Carlo BFS approximation with
 *   default pay table. Sister-repo kernel is closed-form: takes empirical
 *   cluster_count_distribution per symbol per size + pay_table per symbol
 *   per size, returns exact RTP contribution. Audit-grade.
 *
 * Public API
 *   - computeClusterPaysKernelRtp(model, options?) -> { ok, rtpContribution, perSymbol, ... }
 *
 * Model mapping
 *   When `options.clusterCountDistribution` provided (empirical PAR data),
 *   uses that directly. Otherwise builds a synthetic distribution from
 *   industry-standard percolation approximation (small clusters frequent,
 *   large clusters rare exponential decay).
 *
 * Performance
 *   Single subprocess call cached per (model + options) hash.
 *
 * HARD RULE #1
 *   No vendor names in mapping logic.
 */

import { detectKernelEngine } from '../../../tools/math-kernel-bridge.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/* UQ-DEEP-E audit fix (KERNEL-1+2+4): cleanup + UUID + maxBuffer. */
const KERNEL_MAX_BUFFER = 10 * 1024 * 1024;
function _safeUnlink(p) { try { unlinkSync(p); } catch { /* best-effort */ } }
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..', '..', '..');

const _cache = new Map();

function _cacheKey(model, options) {
  const t = model?.topology || {};
  const sym = model?.symbols || {};
  return JSON.stringify({
    reels: t.reels, rows: t.rows,
    minSize: t.cluster_min_size,
    symCount: (sym.high?.length || 0) + (sym.mid?.length || 0) + (sym.low?.length || 0),
    optHash: options ? JSON.stringify(Object.keys(options).sort()) : null,
  });
}

/* Industry percolation approximation: P(cluster of size s for symbol with
 * tier-weight p, grid n=reels*rows) ~ (n*p) * exp(-(s - 5) * 0.7) for s ≥ 5. */
function _approxClusterCountDist(model) {
  const reels = model.topology?.reels || 6;
  const rows = model.topology?.rows || 5;
  const N = reels * rows;
  const tierWeights = { HP: 0.07, MP: 0.13, LP: 0.20 };
  const out = {};
  const buckets = ['high', 'mid', 'low'];
  for (const bucket of buckets) {
    const tierKey = bucket === 'high' ? 'HP' : (bucket === 'mid' ? 'MP' : 'LP');
    const symList = model.symbols?.[bucket] || [];
    for (const s of symList) {
      const id = s.id || s.label || `S${Object.keys(out).length}`;
      const p = tierWeights[tierKey] / Math.max(1, symList.length);
      const sizes = {};
      for (let size = 5; size <= 15; size++) {
        /* Expected cluster count per spin — exponential decay. */
        const exp = N * p * Math.exp(-(size - 5) * 0.7) * 0.02;
        if (exp > 1e-6) sizes[String(size)] = +exp.toFixed(6);
      }
      if (Object.keys(sizes).length > 0) out[id] = sizes;
    }
  }
  return out;
}

/* Synthetic pay table when not provided: tier-based industry baseline. */
function _approxPayTable(model) {
  const out = {};
  const buckets = [
    { key: 'high', table: { 5: 5, 6: 10, 7: 20, 8: 40, 9: 80, 10: 200, 11: 400, 12: 800, 13: 1500, 14: 3000, 15: 5000 } },
    { key: 'mid',  table: { 5: 2, 6: 5, 7: 10, 8: 20, 9: 40, 10: 100, 11: 200, 12: 400, 13: 800, 14: 1500, 15: 3000 } },
    { key: 'low',  table: { 5: 1, 6: 2, 7: 4, 8: 8, 9: 16, 10: 40, 11: 80, 12: 160, 13: 320, 14: 600, 15: 1200 } },
  ];
  for (const b of buckets) {
    const symList = model.symbols?.[b.key] || [];
    for (const s of symList) {
      const id = s.id || s.label || `S${Object.keys(out).length}`;
      const tbl = {};
      for (const [size, pay] of Object.entries(b.table)) tbl[size] = pay;
      out[id] = tbl;
    }
  }
  return out;
}

/**
 * Compute analytical cluster-pays RTP via sister-repo kernel.
 *
 * @param {object} model — slot model with topology.kind/evaluation === 'cluster'
 * @param {object} [options]
 * @param {object} [options.clusterCountDistribution] — empirical PAR-derived dist
 * @param {object} [options.payTable] — explicit pay table override
 * @returns {Promise<object>} { ok, rtpContribution, perSymbol[], ... }
 */
export async function computeClusterPaysKernelRtp(model, options = {}) {
  const key = _cacheKey(model, options);
  if (_cache.has(key)) return _cache.get(key);

  /* Topology gate — only for cluster games. */
  const t = model?.topology || {};
  const isCluster = t.kind === 'cluster' || t.evaluation === 'cluster';
  if (!isCluster) {
    const r = { ok: false, reason: 'model topology is not cluster' };
    _cache.set(key, r);
    return r;
  }

  const detect = detectKernelEngine();
  if (!detect.available) {
    const r = { ok: false, reason: `kernel unavailable: ${detect.reason}` };
    _cache.set(key, r);
    return r;
  }

  const ccd = options.clusterCountDistribution || _approxClusterCountDist(model);
  const pt = options.payTable || _approxPayTable(model);
  if (Object.keys(ccd).length === 0 || Object.keys(pt).length === 0) {
    const r = { ok: false, reason: 'no symbols in model to build distribution' };
    _cache.set(key, r);
    return r;
  }
  const params = {
    cluster_count_distribution: ccd,
    pay_table: pt,
    min_cluster_size: Number(t.cluster_min_size) || 5,
  };

  const tmpDir = join(tmpdir(), 'cluster-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `cp-${randomUUID()}.json`);
  writeFileSync(cfgPath, JSON.stringify(params), 'utf8');
  const runnerPath = resolve(REPO, 'tools/_kernel-cluster-pays-runner.py');
  const env = { ...process.env, PYTHONPATH: join(detect.kernelsDir, 'src') };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000, maxBuffer: KERNEL_MAX_BUFFER,
  });
  _safeUnlink(cfgPath);
  if (proc.status !== 0) {
    const r = { ok: false, reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}` };
    _cache.set(key, r);
    return r;
  }
  let out;
  try { out = JSON.parse((proc.stdout || '').trim()); }
  catch (e) {
    const r = { ok: false, reason: `JSON parse: ${e.message}` };
    _cache.set(key, r);
    return r;
  }
  if (out.error) {
    const r = { ok: false, reason: `runner error: ${out.error}` };
    _cache.set(key, r);
    return r;
  }
  const r = {
    ok: true,
    rtpContribution: out.rtp_contribution,
    perSymbol: out.per_symbol,
    grid: out.grid,
    adjacency: out.adjacency,
    minClusterSize: out.min_cluster_size,
    kernelEngine: 'python-kernel',
    params,
  };
  _cache.set(key, r);
  return r;
}

export function _resetCache() { _cache.clear(); }
