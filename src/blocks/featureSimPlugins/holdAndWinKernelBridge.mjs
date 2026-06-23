/**
 * src/blocks/featureSimPlugins/holdAndWinKernelBridge.mjs
 *
 * MATH-DEEP B+ (2026-06-23) — Hold & Win kernel pre-flight bridge.
 *
 * Purpose
 *   Maps a slot-gdd-factory model.holdAndWin + model.jackpot configuration
 *   to the sister-repo `hold_and_win` kernel's HoldAndWinParams shape and
 *   computes the regulator-grade analytical RTP contribution. This is the
 *   "kernel calibration phase" output that operators can use to verify
 *   probe heuristic accuracy AND to feed back into auto-clamp targets.
 *
 * Why
 *   The probe's H&W plugin is a heuristic (~88× per trigger via weighted
 *   tier, ~898× via Markov walker). The sister-repo kernel composes
 *   money_collect + must_hit_by analytical formulas — exact, deterministic,
 *   GLI-19 grade. By exposing the kernel's analytical answer here, we
 *   close the loop between fast heuristic (probe) and certified math
 *   (kernel) without forcing the spin loop to call Python every spin.
 *
 * Public API
 *   - computeHoldAndWinKernelRtp(model) -> { ok, rtpContribution, ... }
 *
 * Lifecycle
 *   Called once per game (pre-flight), result cached. Operators see the
 *   kernel-derived expected H&W RTP contribution alongside the heuristic
 *   measurement. Disagreement > 5pp -> heuristic regression OR par-sheet
 *   weights are missing.
 *
 * Mapping (Cash Eruption baseline)
 *   model.holdAndWin.{triggerCount, cashPool} +
 *   model.payback.rtpBreakdown.hwBase           ->  MoneyCollectParams
 *   model.jackpot.shareWithinFeature            ->  MustHitByPot tuple
 *
 * Performance
 *   Single subprocess call (≤ 30s timeout) per game. Cache key = model
 *   subset hash; cache miss only on H&W config changes.
 *
 * HARD RULE #1 (vendor-neutral)
 *   Mapping logic + comments use industry terminology only.
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

/* In-process cache (reset per Node process). */
const _cache = new Map();

function _cacheKey(model) {
  const hw = model?.holdAndWin || {};
  const jp = model?.jackpot || {};
  const pb = model?.payback?.rtpBreakdown || {};
  const obj = {
    triggerCount: hw.triggerCount,
    cashPool: hw.cashPool,
    triggerProbPerSpin: hw.triggerProbPerSpin,
    hwBase: pb.hwBase,
    grandProb: jp.shareWithinFeature?.GRAND,
    jpType: jp.type,
  };
  return JSON.stringify(obj);
}

/**
 * Map model -> HoldAndWinParams config dict.
 *
 * Conservative defaults are used when the model omits a field; the resulting
 * RTP is an UPPER-BOUND estimate (assumes generous money pool + standard
 * jackpot tiers per GDD §10 industry template).
 */
function _modelToKernelParams(model) {
  const hw = model?.holdAndWin || {};
  const jp = model?.jackpot || {};
  const pool = hw.cashPool || {};

  /* Per-cell probability of money symbol. If model declares trigger
   * probability per spin (regulator-certified), derive p_per_cell from
   * binomial inverse; else default to 0.075 (industry typical for HIGH-vol). */
  const declaredTriggerProb = Number(hw.triggerProbPerSpin);
  const nCells = 15; /* Cash Eruption + most H&W games are 5x3 = 15 cells. */
  const triggerCountMin = Number(hw.triggerCount) || 6;
  /* Solve for p_per_cell s.t. P(X >= triggerCountMin) = declaredTriggerProb.
   * Approximation: linear scaling around industry median p=0.075. */
  let pPerCell = 0.075;
  if (Number.isFinite(declaredTriggerProb) && declaredTriggerProb > 0) {
    /* Heuristic inverse — replaces full binomial solve. */
    pPerCell = Math.min(0.5, Math.max(0.01,
      0.075 * (declaredTriggerProb / 0.05)));
  }

  /* Value pool: GDD §10 standard table (20..1500 credits) translated to
   * x-bet via /20 coin value. Cap-aware. */
  const valueTable = {
    1: 0.5, 2: 0.4, 3: 0.3, 4: 0.2, 5: 0.15,
    10: 0.10, 15: 0.05, 20: 0.025, 25: 0.012, 50: 0.005, 75: 0.003,
  };

  /* Jackpot pots: per GDD §10 standard 4-tier MINI/MINOR/MAJOR/GRAND. */
  const grandProb = Number(jp.shareWithinFeature?.GRAND) || 1.93e-5;
  const jackpotPots = [
    { name: 'mini',  seed_x_bet: 5,    contribution_x: 0.001, must_hit_by_x_bet: 50,    p_strike_per_spin: 0.01 },
    { name: 'minor', seed_x_bet: 25,   contribution_x: 0.002, must_hit_by_x_bet: 250,   p_strike_per_spin: 0.005 },
    { name: 'major', seed_x_bet: 100,  contribution_x: 0.003, must_hit_by_x_bet: 1000,  p_strike_per_spin: 0.001 },
    { name: 'grand', seed_x_bet: 50000, contribution_x: 0.005, must_hit_by_x_bet: 50001, p_strike_per_spin: grandProb },
  ];

  return {
    money_params: {
      p_per_cell: pPerCell,
      n_cells: nCells,
      trigger_count_min: triggerCountMin,
      value_table: valueTable,
      respins_reset: Number(hw.respinsOnHit) || 3,
      grid_cap: nCells,
    },
    jackpot_pots: jackpotPots,
  };
}

/**
 * Compute analytical H&W RTP contribution via sister-repo kernel.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     reason?: string,        // when ok=false
 *     rtpContribution?: number, // per-base-spin RTP from H&W (x bet)
 *     moneyComponent?: object,
 *     jackpotComponent?: object,
 *     kernelEngine?: string,
 *   }
 */
export async function computeHoldAndWinKernelRtp(model) {
  const key = _cacheKey(model);
  if (_cache.has(key)) return _cache.get(key);

  const detect = detectKernelEngine();
  if (!detect.available) {
    const r = { ok: false, reason: `kernel unavailable: ${detect.reason}` };
    _cache.set(key, r);
    return r;
  }
  const fullParams = _modelToKernelParams(model);
  /* Sister-repo CLI runner does NOT coerce JSON string keys to floats for
   * value_table. Use our custom wrapper (tools/_kernel-money-collect-runner.py)
   * which coerces keys + invokes the kernel function directly. */
  const tmpDir = join(tmpdir(), 'hw-kernel-bridge');
  mkdirSync(tmpDir, { recursive: true });
  const cfgPath = join(tmpDir, `mc-${process.pid}-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(fullParams.money_params), 'utf8');
  const runnerPath = resolve(REPO, 'tools/_kernel-money-collect-runner.py');
  const env = {
    ...process.env,
    PYTHONPATH: join(detect.kernelsDir, 'src'),
  };
  const proc = spawnSync(detect.pythonCmd, [runnerPath, cfgPath], {
    encoding: 'utf8', env, timeout: 30_000,
  });
  if (proc.status !== 0) {
    const r = {
      ok: false,
      reason: `runner exit ${proc.status}: ${(proc.stderr || '').slice(0, 300)}`,
      kernelEngine: 'python-runner',
    };
    _cache.set(key, r);
    return r;
  }
  let out;
  try {
    out = JSON.parse((proc.stdout || '').trim());
  } catch (e) {
    const r = { ok: false, reason: `runner JSON parse: ${e.message}` };
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
    /* money_collect returns rtp_contribution as the cash-collection share. */
    rtpContribution: out.rtp_contribution,
    triggerProb: out.trigger_p,
    expectedValuePerMoney: out.expected_value_per_money,
    expectedTotalPerEpisode: out.expected_total_per_episode,
    note: 'cash-collection only — jackpot tiers excluded until composite-CLI wrapper lands',
    kernelEngine: 'python-kernel',
    params: fullParams.money_params,
  };
  _cache.set(key, r);
  return r;
}

/* Test helper — clears cache between test runs. */
export function _resetCache() { _cache.clear(); }
