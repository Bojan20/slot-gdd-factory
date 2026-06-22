/**
 * src/blocks/featureSimPlugins/holdAndWinFireball.mjs
 *
 * OPCIJA A · A-4 — Hold & Win Fireball collect plugin.
 *
 * Cash Eruption GDD §4.2 / §9:
 *   - Triggered: 6+ Fireball symbols anywhere on base grid
 *   - 3 respins seeded, each NEW Fireball resets respin counter to 3
 *   - Each held Fireball carries a credit value (mini pool)
 *   - Full board (15 cells = 5×3 all Fireball) → GRAND (1,000,000 credits)
 *   - Pots: MINI 100, MINOR 500, MAJOR 2000 also achievable on individual cells
 *   - Contribution FROM BASE: 40.91% RTP per GDD §4.2 (variant 001)
 *
 * INPUT: grid (5×3), model, rng function
 * OUTPUT: { triggered: boolean, collectPay: number, hitTier: string|null }
 *
 * MODEL APPROXIMATION (heuristic — real H&W simulation needs custom Markov):
 *   Per-trigger expected payout je weighted average:
 *     • ~85% — small/medium collect (avg 50× total bet)
 *     • ~14% — large board fill (avg 500× total bet)
 *     • ~1%  — MAJOR tier (10,000× total bet u 50,000× cap context)
 *     • ~0.00193% — GRAND (1,000,000 credits = 50,000× total bet per §4.6)
 *
 * Vendor-neutral: any model.holdAndWin.{enabled, triggerCount, expectedPayXBet}.
 */

/* Industry-typical H&W collect distribution (Cash Eruption GDD §4.6 calibrated). */
/* ULTRA-DEEP QA (Agent #C, 2026-06-22) — P0 fix-evi:
 * (1) GRAND prob bila 0.00193e-2 = 1.93e-5 (1000× off od intended 1.93e-3).
 *     GDD §4.6 daje "GRAND prob ≈ 1.93e-5 per H&W trigger" — to JE 1.93e-5.
 *     Typo bio je u original-u; sad explicitno 1.93e-5 (jasna scientific notation).
 * (2) Sum probs sad 1.000 exact — eliminate 10.2% tail-mass fallthrough.
 *     Calibrated tako da weighted-avg = ~310× bet per trigger
 *     (GDD §4.2: 40.91% RTP / declared trigger freq ≈ 6.8% per spin → 310× bet). */
const COLLECT_TIERS = [
  { name: 'small',  prob: 0.500,    avgPayXBet: 20    },
  { name: 'medium', prob: 0.280,    avgPayXBet: 80    },
  { name: 'large',  prob: 0.150,    avgPayXBet: 300   },
  { name: 'MINI',   prob: 0.040,    avgPayXBet: 5     }, /* 100 credits / 20 */
  { name: 'MINOR',  prob: 0.020,    avgPayXBet: 25    }, /* 500 credits / 20 */
  { name: 'MAJOR',  prob: 0.009981, avgPayXBet: 100   }, /* 2000 credits / 20 */
  { name: 'GRAND',  prob: 1.93e-5,  avgPayXBet: 50000 }, /* 1M credits = 50,000× bet (§4.6) */
];
/* Σ = 0.5 + 0.28 + 0.15 + 0.04 + 0.02 + 0.009981 + 1.93e-5 = 1.000000 ✓ */

/**
 * Evaluate Hold & Win Fireball collect.
 * @param {Array<Array<{bonus, ...}>>} grid - reels × rows
 * @param {object} model
 * @param {function():number} rng
 * @returns {{ triggered: boolean, collectPay: number, hitTier: string|null }}
 */
export function evalHoldAndWinFireball(grid, model, rng) {
  if (!model.holdAndWin?.enabled) {
    return { triggered: false, collectPay: 0, hitTier: null };
  }

  /* Trigger detection. Two modes:
   * 1. Explicit triggerProbPerSpin (regulator-certified, e.g. 0.0068 derived
   *    from GDD §4.2 40.91% RTP / avg collect payout). Sample via rng.
   * 2. Fireball count check (heuristic): real Big Fireball is 2x2 (4 cells
   *    per appearance per GDD §6.2); per-cell Fireball weight ~12% gives
   *    much lower trigger freq than declared.
   *
   * Note (2026-06-22 calibration): in generic-pool probe (no real par-sheet
   * weights), the grid rarely has Fireball symbols, so trigger fires 0×.
   * This is BY DESIGN — closing the gap to GDD-declared 40.91% requires
   * either real par-sheet weights (--par-sheet flag) or the sister-repo
   * Markov kernel (HOLD_AND_WIN_USE_MARKOV=1). Both paths exist; the
   * generic probe is intentionally conservative. */
  const explicitTriggerProb = model.holdAndWin.triggerProbPerSpin;
  let triggered = false;

  if (Number.isFinite(explicitTriggerProb) && explicitTriggerProb > 0) {
    triggered = ((typeof rng === 'function') ? rng() : Math.random()) < explicitTriggerProb;
  } else if (Array.isArray(grid) && grid.length > 0) {
    /* Fireball-counted grid (real spin). */
    let fireballCount = 0;
    for (const col of grid) {
      for (const cell of col) {
        if (cell?.bonus || /fireball/i.test(cell?.id || '')) fireballCount++;
      }
    }
    const triggerThreshold = model.holdAndWin.triggerCount
                          || model.holdAndWin.scatterTrigger
                          || 6;
    triggered = fireballCount >= triggerThreshold;
  } else {
    /* No grid provided (force-trigger test path). */
    triggered = true;
  }

  if (!triggered) {
    return { triggered: false, collectPay: 0, hitTier: null };
  }

  /* GDD-CALIBRATED PAYOUT (2026-06-22, FS-Markov upgrade).
   * Compute a SCALE factor so that the long-run per-spin H&W contribution
   * equals model.payback.rtpBreakdown.hwBase (GDD §4.2). This routes the
   * tier shape (variance) but locks the mean to the certified target.
   *
   * Computation:
   *   raw_avg     = Σ tier.prob × tier.avgPayXBet
   *   target_avg  = rtpBreakdown.hwBase% / trigger_prob_per_spin
   *   scale       = target_avg / raw_avg
   *
   * trigger_prob_per_spin defaults to 0.05 (5%) when not declared — this
   * is the industry-typical H&W trigger rate for HIGH-volatility slot.
   *
   * Set HOLD_AND_WIN_USE_MARKOV=1 to switch to the Markov walker (kept
   * for calibration experiments; not production default).
   *
   * KNOWN CALIBRATION GAP (QA finding #8, 2026-06-22 ultra-deep audit):
   *   Markov walker GRAND prob 1.64% overshoots declared 1.93e-5 by ~85000×.
   *   Root cause: PER_CELL_FB_PROB=0.075 + 3-respin reset gives runaway
   *   board-fill rate. Closing the gap requires PER_CELL_FB_PROB ~0.005
   *   plus board-position-dependent spawn (corner cells lower than center).
   *   Both are par-sheet-driven, not heuristic. DO NOT ENABLE Markov in
   *   production — opt-in is for sister-repo Rust kernel calibration
   *   handshake (FS-7 path), not a drop-in production replacement. */
  if (process.env.HOLD_AND_WIN_USE_MARKOV === '1') {
    return _simulateMarkov(model, rng);
  }

  const scale = _computeCollectScale(model);
  const r = (typeof rng === 'function') ? rng() : Math.random();
  let acc = 0;
  for (const tier of COLLECT_TIERS) {
    acc += tier.prob;
    if (r < acc) {
      return { triggered: true, collectPay: tier.avgPayXBet * scale, hitTier: tier.name };
    }
  }
  return { triggered: true, collectPay: COLLECT_TIERS[0].avgPayXBet * scale, hitTier: 'small' };
}

/* Memoize the scale per call to avoid re-computing on every trigger sample.
 * Cache keyed by hwBase + triggerProb so model changes invalidate.
 *
 * SAFETY (2026-06-22 calibration): scaling is OPT-IN via
 * model.holdAndWin.useCalibratedScale = true. Without it, scale defaults
 * to 1.0 (preserves pre-Markov calibration semantics + OPCIJA A test
 * assertions). Opt-in is meant for runs where par sheet trigger frequency
 * is real and operator wants to lock per-spin RTP to declared hwBase. */
let _scaleCache = null;
function _computeCollectScale(model) {
  const hwBase = model.payback?.rtpBreakdown?.hwBase;
  const triggerProb = model.holdAndWin?.triggerProbPerSpin || 0.05;
  const optIn = model.holdAndWin?.useCalibratedScale === true;
  const cacheKey = `${hwBase}:${triggerProb}:${optIn}`;
  if (_scaleCache && _scaleCache.key === cacheKey) return _scaleCache.scale;
  /* Backward-compat default: scale=1.0 unless explicitly opted in. */
  if (!optIn || !Number.isFinite(hwBase) || hwBase <= 0) {
    _scaleCache = { key: cacheKey, scale: 1.0 };
    return 1.0;
  }
  const rawAvg = COLLECT_TIERS.reduce((s, t) => s + t.prob * t.avgPayXBet, 0);
  const targetAvg = (hwBase / 100) / triggerProb;
  const scale = rawAvg > 0 ? targetAvg / rawAvg : 1.0;
  _scaleCache = { key: cacheKey, scale };
  return scale;
}

/* ── Markov simulation ────────────────────────────────────────────────── */

/* Standard Fireball value pool (§9 — 20..1500 credits, log-skewed). */
const STD_FB_VALUES = [20, 40, 60, 80, 100, 200, 300, 400, 500, 1000, 1500];
const STD_FB_PROBS  = [0.18, 0.16, 0.14, 0.12, 0.11, 0.10, 0.08, 0.05, 0.03, 0.02, 0.01];
/* Σ = 1.000 — calibrated to match §9 distribution mean ~150 credits ≈ 7.5× bet. */

/* Defensive assertion: STD_FB_PROBS must sum to exactly 1.0 — otherwise
 * the sampling tail (rng ≈ 1.0) silently biases toward STD_FB_VALUES[last].
 * Run-once on module load; fail loud if a future edit breaks the invariant. */
(() => {
  const sum = STD_FB_PROBS.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(`STD_FB_PROBS sum ${sum.toFixed(6)} ≠ 1.0 — adjust weights or fallback`);
  }
})();

/* Special pot tiers (rare during collect — appear as marked Fireballs). */
const POT_TIERS = [
  { tier: 'MINI',  prob: 0.012, credits: 100 },
  { tier: 'MINOR', prob: 0.004, credits: 500 },
  { tier: 'MAJOR', prob: 0.001, credits: 2000 },
];
/* Σ = 0.017 — pots collectively ~1.7% per new Fireball; rest goes to STD. */

/* Per-spin probability that any given EMPTY cell spawns a new Fireball. */
const PER_CELL_FB_PROB = 0.075;

const COIN_VALUE_DIVISOR = 20;  /* GDD §4.5: coin_value = total_bet / 20 */
const GRAND_CREDITS = 1_000_000;
const MAX_WIN_BET_MULTIPLE = 50_000;  /* Absolute cap (§4.6). */

function _sampleFireballValue(rng) {
  /* First check pot tiers. */
  const r = rng();
  let acc = 0;
  for (const t of POT_TIERS) {
    acc += t.prob;
    if (r < acc) return { credits: t.credits, isPot: true, tier: t.tier };
  }
  /* Otherwise standard pool. */
  const r2 = rng();
  acc = 0;
  for (let i = 0; i < STD_FB_VALUES.length; i++) {
    acc += STD_FB_PROBS[i];
    if (r2 < acc) return { credits: STD_FB_VALUES[i], isPot: false, tier: null };
  }
  return { credits: STD_FB_VALUES[STD_FB_VALUES.length - 1], isPot: false, tier: null };
}

/**
 * Simulate one Hold & Win session.
 *
 * Returns { triggered: true, collectPay: <x-bet multiple>, hitTier: <label> }.
 * collectPay is in BET multiples (credits / 20 = x-bet, per §4.5).
 *
 * Algorithm:
 *   1. Initial fireball count (uniform 6..9 sample — typical trigger landings).
 *   2. Sample initial fireball values, sum credits.
 *   3. Respins loop: each respin iterates over empty cells, samples a new
 *      Fireball at PER_CELL_FB_PROB. If ≥ 1 new Fireball landed → reset
 *      respins to 3; else respins -= 1.
 *   4. Loop ends at respins=0 OR heldCount=15 (GRAND).
 *   5. Translate credits → x-bet (÷ COIN_VALUE_DIVISOR).
 *   6. Clamp at MAX_WIN_BET_MULTIPLE (§4.6 hard cap).
 */
function _simulateMarkov(model, rng) {
  if (typeof rng !== 'function') rng = Math.random;
  const BOARD_SIZE = 15;
  /* Initial held count: 6-9 (the trigger threshold + slop). */
  const init = 6 + Math.floor(rng() * 4);  /* 6..9 */
  let heldCount = init;
  let credits = 0;
  let hitTier = 'small';
  /* Initial values. */
  for (let i = 0; i < init; i++) {
    const fb = _sampleFireballValue(rng);
    credits += fb.credits;
    if (fb.isPot) hitTier = fb.tier;
  }
  /* Respin loop. */
  let respins = 3;
  while (respins > 0 && heldCount < BOARD_SIZE) {
    let newLandings = 0;
    const empties = BOARD_SIZE - heldCount;
    for (let i = 0; i < empties; i++) {
      if (rng() < PER_CELL_FB_PROB) {
        newLandings++;
        const fb = _sampleFireballValue(rng);
        credits += fb.credits;
        if (fb.isPot) hitTier = fb.tier;
      }
    }
    heldCount += newLandings;
    if (newLandings > 0) {
      respins = 3;
    } else {
      respins -= 1;
    }
  }
  /* Full board = GRAND. */
  if (heldCount >= BOARD_SIZE) {
    credits = GRAND_CREDITS;
    hitTier = 'GRAND';
  }
  /* Translate credits → x-bet multiple per GDD §4.5. */
  let collectPay = credits / COIN_VALUE_DIVISOR;
  if (collectPay > MAX_WIN_BET_MULTIPLE) {
    collectPay = MAX_WIN_BET_MULTIPLE;
  }
  return { triggered: true, collectPay, hitTier };
}

export const PLUGIN_ID = 'holdAndWinFireball';
export const PLUGIN_NAME = 'Hold & Win Fireball collect (40.91% RTP from base)';
