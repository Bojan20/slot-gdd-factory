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
const _cacheBothWays = new Map();
const _cacheBuy      = new Map();
const _cachePersist  = new Map();
const _cacheMustHit  = new Map();
const _cacheWheel    = new Map();
const _cacheAsym     = new Map();
const _cacheCharge   = new Map();
const _cacheCrash    = new Map();
const _cachePick     = new Map();
const _cacheSm       = new Map();
const _cacheBwEw     = new Map();
const _cacheInverse  = new Map();
const _cacheMultiDim = new Map();

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

/* ── Both ways (LTR + RTL line pay) ──────────────────────────────────── */

export async function computeBothWaysKernelRtp(opts = {}) {
  const params = {
    ltr_only_rtp:   opts.ltrOnlyRtp   ?? 0.96,
    line_pay_share: opts.linePayShare ?? 0.7,
  };
  const key = JSON.stringify(params);
  if (_cacheBothWays.has(key)) return _cacheBothWays.get(key);
  const r = _runUniversal('both_ways', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, bidirectionalMultiplier: r.result.bidirectional_multiplier, upliftXBet: r.result.uplift_x_bet, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheBothWays.set(key, out);
  return out;
}

/* ── Buy feature audit ───────────────────────────────────────────────── */

export async function computeBuyFeatureAudit(opts = {}) {
  const params = {
    bonus_average_pay_x_bet: opts.bonusAveragePayXBet ?? 100,
    buy_cost_x_bet:          opts.buyCostXBet         ?? 100,
    base_game_rtp:           opts.baseGameRtp         ?? 0.93,
    target_buy_rtp:          opts.targetBuyRtp        ?? 0.96,
  };
  const key = JSON.stringify(params);
  if (_cacheBuy.has(key)) return _cacheBuy.get(key);
  const r = _runUniversal('buy_feature', params);
  const out = r.ok
    ? { ok: true, buyRtp: r.result.buy_rtp, fairBuyCostXBet: r.result.fair_buy_cost_x_bet, deltaPpVsBase: r.result.delta_pp_vs_base, ukgcPass: r.result.ukgc_rts13c_pass_1p0, mgaPass: r.result.mga_2021_02_pass_0p96, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheBuy.set(key, out);
  return out;
}

/* ── Persistent multiplier (FS sticky mult) ──────────────────────────── */

export async function computePersistentMultiplierKernelRtp(opts = {}) {
  const params = {
    fs_trigger_p:           opts.fsTriggerP          ?? 0.01,
    fs_initial_spins:       opts.fsInitialSpins      ?? 10,
    base_pay_per_spin_x_bet: opts.basePayPerSpinXBet ?? 0.5,
    initial_multiplier:     opts.initialMultiplier   ?? 1,
    bump_increment:         opts.bumpIncrement       ?? 1,
    p_bump_per_spin:        opts.pBumpPerSpin        ?? 0.3,
    max_multiplier:         opts.maxMultiplier       ?? null,
  };
  const key = JSON.stringify(params);
  if (_cachePersist.has(key)) return _cachePersist.get(key);
  const r = _runUniversal('persistent_multiplier', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, averageMultiplier: r.result.average_multiplier, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cachePersist.set(key, out);
  return out;
}

/* ── Must-hit-by (mystery jackpot) ────────────────────────────────────── */

export async function computeMustHitByKernelRtp(opts = {}) {
  const pots = opts.pots || [
    { name: 'mini',  seed_x_bet: 5,    contribution_x: 0.001, must_hit_by_x_bet: 50,    p_strike_per_spin: 0.01 },
    { name: 'minor', seed_x_bet: 25,   contribution_x: 0.002, must_hit_by_x_bet: 250,   p_strike_per_spin: 0.005 },
    { name: 'major', seed_x_bet: 100,  contribution_x: 0.003, must_hit_by_x_bet: 1000,  p_strike_per_spin: 0.001 },
  ];
  const params = { pots };
  const key = JSON.stringify(params);
  if (_cacheMustHit.has(key)) return _cacheMustHit.get(key);
  const r = _runUniversal('must_hit_by', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, perPot: r.result.pots, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheMustHit.set(key, out);
  return out;
}

/* ── Wheel bonus ──────────────────────────────────────────────────────── */

export async function computeWheelKernelRtp(opts = {}) {
  const params = {
    trigger_p:      opts.triggerP ?? 0.02,
    segments:       opts.segments || [
      { kind: 'credit',     weight: 0.5,  value_x_bet: 10 },
      { kind: 'credit',     weight: 0.3,  value_x_bet: 50 },
      { kind: 'spin_again', weight: 0.15, value_x_bet: 0 },
      { kind: 'no_win',     weight: 0.05, value_x_bet: 0 },
    ],
    max_spin_again: opts.maxSpinAgain ?? 3,
  };
  const key = JSON.stringify(params);
  if (_cacheWheel.has(key)) return _cacheWheel.get(key);
  const r = _runUniversal('wheel', params);
  const out = r.ok
    ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedAwardPerTrigger: r.result.expected_award_per_trigger, kernelEngine: 'python-kernel', params }
    : { ok: false, reason: r.reason };
  _cacheWheel.set(key, out);
  return out;
}

/* ── Asymmetric paytable ─────────────────────────────────────────────── */

export async function computeAsymmetricPaytableKernelRtp(opts = {}) {
  const params = {
    per_symbol_contributions: opts.perSymbolContributions || {
      'HP': { 'line5': 0.5, 'line4': 0.2, 'line3': 0.05 },
      'MP': { 'line5': 0.2, 'line4': 0.08, 'line3': 0.02 },
    },
  };
  const key = JSON.stringify(params);
  if (_cacheAsym.has(key)) return _cacheAsym.get(key);
  const r = _runUniversal('asymmetric_paytable', params);
  const out = r.ok ? { ok: true, rtpContribution: r.result.rtp_contribution, perSymbolBreakdown: r.result.per_symbol_breakdown, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cacheAsym.set(key, out);
  return out;
}

/* ── Charge meter ─────────────────────────────────────────────────────── */

export async function computeChargeMeterKernelRtp(opts = {}) {
  const params = {
    expected_charge_per_spin: opts.expectedChargePerSpin ?? 0.05,
    tiers: opts.tiers || [
      { name: 'small', threshold: 10, award_value_x_bet: 5 },
      { name: 'big',   threshold: 100, award_value_x_bet: 50 },
    ],
    persistent_across_sessions: opts.persistentAcrossSessions ?? false,
  };
  const key = JSON.stringify(params);
  if (_cacheCharge.has(key)) return _cacheCharge.get(key);
  const r = _runUniversal('charge_meter', params);
  const out = r.ok ? { ok: true, rtpContribution: r.result.rtp_contribution, tiers: r.result.tiers, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cacheCharge.set(key, out);
  return out;
}

/* ── Crash kernel (crash-game audit) ──────────────────────────────────── */

export async function computeCrashKernelAudit(opts = {}) {
  const params = {
    house_edge:         opts.houseEdge         ?? 0.01,
    cashout_multiplier: opts.cashoutMultiplier ?? 2.0,
  };
  const key = JSON.stringify(params);
  if (_cacheCrash.has(key)) return _cacheCrash.get(key);
  const r = _runUniversal('crash_kernel', params);
  const out = r.ok ? { ok: true, rtp: r.result.rtp, probabilityOfWin: r.result.probability_of_win, edgePerRound: r.result.edge_per_round, strategyClass: r.result.strategy_class, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cacheCrash.set(key, out);
  return out;
}

/* ── Pick chain (pick & click bonus) ─────────────────────────────────── */

export async function computePickChainKernelRtp(opts = {}) {
  const params = {
    trigger_p: opts.triggerP ?? 0.02,
    levels:    opts.levels || [
      { name: 'L1', pool_size: 5, award_distribution: { '5': 2, '10': 2, '0.0': 1 } },
    ],
  };
  const key = JSON.stringify(params);
  if (_cachePick.has(key)) return _cachePick.get(key);
  const r = _runUniversal('pick_chain', params);
  const out = r.ok ? { ok: true, rtpContribution: r.result.rtp_contribution, expectedTotalAwardXBet: r.result.expected_total_award_x_bet, levels: r.result.levels, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cachePick.set(key, out);
  return out;
}

/* ── State machine (game-state Markov chain) ─────────────────────────── */

export async function computeStateMachineKernelRtp(opts = {}) {
  const params = {
    states:      opts.states      || [{ name: 'base', rtp_component: 0.9 }, { name: 'fs', rtp_component: 1.2 }],
    transitions: opts.transitions || [[0.99, 0.01], [0.5, 0.5]],
  };
  const key = JSON.stringify(params);
  if (_cacheSm.has(key)) return _cacheSm.get(key);
  const r = _runUniversal('state_machine', params);
  const out = r.ok ? { ok: true, rtpContribution: r.result.rtp_contribution, stationaryDistribution: r.result.stationary_distribution, states: r.result.states, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cacheSm.set(key, out);
  return out;
}

/* ── Both-ways expanding-wild composite ───────────────────────────────── */

export async function computeBothWaysExpandingWildKernelRtp(opts = {}) {
  const params = {
    both_ways_params:  opts.bothWaysParams  || { ltr_only_rtp: 0.5, line_pay_share: 0.7 },
    expanding_params:  opts.expandingParams || {
      fs_trigger_p: 0.01, fs_initial_spins: 10, reels: 5, rows: 3,
      p_per_cell_in_fs: 0.12, pay_table: { '3': 1, '4': 5, '5': 100 }, symbol_name: 'BOOK',
    },
  };
  const key = JSON.stringify(params);
  if (_cacheBwEw.has(key)) return _cacheBwEw.get(key);
  const r = _runUniversal('both_ways_expanding_wild', params);
  const out = r.ok ? { ok: true, rtpContribution: r.result.rtp_contribution, bothWaysComponent: r.result.both_ways_component, expandingSymbolComponent: r.result.expanding_symbol_component, kernelEngine: 'python-kernel', params }
                   : { ok: false, reason: r.reason };
  _cacheBwEw.set(key, out);
  return out;
}

/* ── Inverse solver (target RTP → param) ─────────────────────────────── */

/**
 * Solve for a kernel parameter that achieves a target RTP contribution.
 *
 * Example: "what p_per_cell makes money_collect RTP = 0.40?"
 *   solveForParam({
 *     kernel: 'money_collect', solveFor: 'p_per_cell', targetRtp: 0.40,
 *     paramLo: 0.001, paramHi: 0.5, method: 'bisection',
 *     fixed: { n_cells: 15, trigger_count_min: 6, value_table: {...}, respins_reset: 3 }
 *   })
 *   → { solvedParam: 0.1198, achievedRtp: 0.4000, converged: true, iterations: 17 }
 *
 * Supported (kernel, solveFor) pairs:
 *   - ('money_collect',    'p_per_cell')
 *   - ('expanding_symbol', 'p_per_cell_in_fs')
 */
export async function solveForParam(opts = {}) {
  const params = {
    kernel:        opts.kernel        || 'money_collect',
    solve_for:     opts.solveFor      || 'p_per_cell',
    target_rtp:    opts.targetRtp     ?? 0.40,
    initial_guess: opts.initialGuess  ?? 0.1,
    param_lo:      opts.paramLo       ?? 0.001,
    param_hi:      opts.paramHi       ?? 0.5,
    method:        opts.method        || 'bisection',
    fixed:         opts.fixed         || {},
  };
  const key = JSON.stringify(params);
  if (_cacheInverse.has(key)) return _cacheInverse.get(key);

  const detect = detectKernelEngine();
  if (!detect.available) {
    const out = { ok: false, reason: `kernel unavailable: ${detect.reason}` };
    _cacheInverse.set(key, out);
    return out;
  }
  const tmpDir = join(tmpdir(), 'extra-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `inv-${process.pid}-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(params), 'utf8');
  const runnerPath = resolve(REPO, 'tools/_kernel-inverse-solver-runner.py');
  const env = { ...process.env, PYTHONPATH: join(detect.kernelsDir, 'src') };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000,
  });
  if (proc.status !== 0) {
    const out = { ok: false, reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}` };
    _cacheInverse.set(key, out);
    return out;
  }
  let parsed;
  try { parsed = JSON.parse((proc.stdout || '').trim()); }
  catch (e) {
    const out = { ok: false, reason: `JSON parse: ${e.message}` };
    _cacheInverse.set(key, out);
    return out;
  }
  if (parsed.error) {
    const out = { ok: false, reason: parsed.error };
    _cacheInverse.set(key, out);
    return out;
  }
  const out = {
    ok: true,
    solvedParam:      parsed.solved_param,
    achievedRtp:      parsed.achieved_rtp,
    targetRtp:        parsed.target_rtp,
    iterations:       parsed.iterations,
    converged:        parsed.converged,
    errorAtSolution:  parsed.error_at_solution,
    method:           parsed.method,
    kernel:           parsed.kernel,
    solveFor:         parsed.solve_for,
    kernelEngine:     'python-kernel',
  };
  _cacheInverse.set(key, out);
  return out;
}

/* ── Multi-dim inverse solver (Newton-Raphson n-D) ────────────────────── */

/**
 * Solve for MULTIPLE kernel params that together hit MULTIPLE targets.
 *
 * Example: "find (p_per_cell, trigger_count_min) that give RTP=0.40 AND
 * trigger_p=0.001 for money_collect simultaneously".
 *
 *   solveMultiDim({
 *     kernel: 'money_collect',
 *     solveFor: ['p_per_cell', 'trigger_count_min'],
 *     targets: [0.40, 0.001],
 *     initialGuess: [0.1, 6],
 *     bounds: [[0.001, 0.5], [3, 10]],
 *     fixed: { n_cells, value_table, respins_reset }
 *   })
 *
 * Returns { ok, solvedParams[], converged, iterations, finalNorm, ... }.
 *
 * Note: 2D+ solvers may not converge for highly discontinuous mappings
 * (e.g. trigger_count_min is integer-discrete). converged=false is a
 * legitimate outcome — operator inspects finalResidual + finalNorm.
 */
export async function solveMultiDim(opts = {}) {
  const params = {
    kernel:        opts.kernel        || 'money_collect',
    solve_for:     opts.solveFor      || ['p_per_cell'],
    targets:       opts.targets       || [0.40, 0.001],
    initial_guess: opts.initialGuess  || [0.1, 6],
    bounds:        opts.bounds        || null,
    fixed:         opts.fixed         || {},
  };
  const key = JSON.stringify(params);
  if (_cacheMultiDim.has(key)) return _cacheMultiDim.get(key);

  const detect = detectKernelEngine();
  if (!detect.available) {
    const out = { ok: false, reason: `kernel unavailable: ${detect.reason}` };
    _cacheMultiDim.set(key, out);
    return out;
  }
  const tmpDir = join(tmpdir(), 'extra-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `md-${process.pid}-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(params), 'utf8');
  const runnerPath = resolve(REPO, 'tools/_kernel-multi-dim-solver-runner.py');
  const env = { ...process.env, PYTHONPATH: join(detect.kernelsDir, 'src') };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000,
  });
  if (proc.status !== 0) {
    const out = { ok: false, reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}` };
    _cacheMultiDim.set(key, out);
    return out;
  }
  let parsed;
  try { parsed = JSON.parse((proc.stdout || '').trim()); }
  catch (e) {
    const out = { ok: false, reason: `JSON parse: ${e.message}` };
    _cacheMultiDim.set(key, out);
    return out;
  }
  if (parsed.error) {
    const out = { ok: false, reason: parsed.error };
    _cacheMultiDim.set(key, out);
    return out;
  }
  const out = {
    ok: true,
    solvedParams:  parsed.solved_params,
    finalResidual: parsed.final_residual,
    finalNorm:     parsed.final_norm,
    iterations:    parsed.iterations,
    converged:     parsed.converged,
    targets:       parsed.targets,
    kernel:        parsed.kernel,
    solveFor:      parsed.solve_for,
    kernelEngine:  'python-kernel',
  };
  _cacheMultiDim.set(key, out);
  return out;
}

export function _resetCache() {
  _cacheExp.clear(); _cacheSw.clear(); _cacheCascade.clear(); _cacheWays.clear();
  _cachePayAny.clear(); _cacheStacked.clear();
  _cacheBothWays.clear(); _cacheBuy.clear(); _cachePersist.clear();
  _cacheMustHit.clear(); _cacheWheel.clear();
  _cacheAsym.clear(); _cacheCharge.clear(); _cacheCrash.clear();
  _cachePick.clear(); _cacheSm.clear(); _cacheBwEw.clear();
  _cacheInverse.clear(); _cacheMultiDim.clear();
}
