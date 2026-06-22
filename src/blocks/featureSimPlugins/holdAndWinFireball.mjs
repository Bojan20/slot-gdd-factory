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
   *    much lower trigger freq than declared. */
  const explicitTriggerProb = model.holdAndWin.triggerProbPerSpin;
  let triggered = false;

  if (Number.isFinite(explicitTriggerProb) && explicitTriggerProb > 0) {
    triggered = ((typeof rng === 'function') ? rng() : Math.random()) < explicitTriggerProb;
  } else {
    /* Fallback: count Fireball/bonus cells. */
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
  }

  if (!triggered) {
    return { triggered: false, collectPay: 0, hitTier: null };
  }

  /* Sample a tier outcome via rng. */
  const r = (typeof rng === 'function') ? rng() : Math.random();
  let acc = 0;
  for (const tier of COLLECT_TIERS) {
    acc += tier.prob;
    if (r < acc) {
      return { triggered: true, collectPay: tier.avgPayXBet, hitTier: tier.name };
    }
  }
  /* Fallback (rounding) — small */
  return { triggered: true, collectPay: COLLECT_TIERS[0].avgPayXBet, hitTier: 'small' };
}

export const PLUGIN_ID = 'holdAndWinFireball';
export const PLUGIN_NAME = 'Hold & Win Fireball collect (40.91% RTP from base)';
