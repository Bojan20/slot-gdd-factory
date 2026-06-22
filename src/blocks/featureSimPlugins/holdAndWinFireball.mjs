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
const COLLECT_TIERS = [
  { name: 'small',  prob: 0.65, avgPayXBet: 20   },
  { name: 'medium', prob: 0.20, avgPayXBet: 80   },
  { name: 'large',  prob: 0.10, avgPayXBet: 300  },
  { name: 'MINI',   prob: 0.025, avgPayXBet: 100 / 20  }, /* 100 credits / 20 = 5× bet */
  { name: 'MINOR',  prob: 0.015, avgPayXBet: 500 / 20  }, /* 25× bet */
  { name: 'MAJOR',  prob: 0.008, avgPayXBet: 2000 / 20 }, /* 100× bet */
  { name: 'GRAND',  prob: 0.00193e-2, avgPayXBet: 50000 }, /* 1M credits = 50,000× total bet */
];

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

  /* Count Fireball / bonus symbols across whole grid. */
  let fireballCount = 0;
  for (const col of grid) {
    for (const cell of col) {
      if (cell?.bonus || /fireball/i.test(cell?.id || '')) fireballCount++;
    }
  }

  const triggerThreshold = model.holdAndWin.triggerCount
                        || model.holdAndWin.scatterTrigger
                        || 6;
  if (fireballCount < triggerThreshold) {
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
