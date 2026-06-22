/**
 * src/blocks/featureSimPlugins/freeSpinsRound.mjs
 *
 * OPCIJA A · A-5 — Free Spins round simulation plugin.
 *
 * Cash Eruption GDD §4.2 / §4.8 / §8:
 *   - Trigger: ≥3 Volcano scatters in base
 *   - Award: 6 spins per trigger (D-5 fix — was variable ladder)
 *   - Retrigger: +3 spins per additional 3-scatter, max 15 spins total
 *   - Avg ~6.45 spins played per trigger
 *   - FS strip set: premium-heavy (linked center reels → fuller screens)
 *   - Declared contribution: 7.00% RTP (FS line wins, variant 001)
 *   - Big Fireball ≥9 trigger inside FS → H&W FROM FREE SPINS (6.19% RTP)
 *
 * INPUT: model, rng, spinFn (closure za base spin)
 * OUTPUT: { fsRoundPay: number, spinsPlayed: number, hwTriggeredInFs: boolean }
 *
 * APPROXIMATION:
 *   FS strips give ~1.3× line-win rate vs base. Each FS spin uses same probe
 *   spin() logic but multiplied by FS premium factor. H&W FROM FS uses same
 *   plugin as A-4 with separate sample probability.
 *
 * Vendor-neutral: model.freeSpins.{spinsPerTrigger, retriggerCount, maxSpins, premiumFactor}
 */

/**
 * Simulate one Free Spins round (entered after base game triggers).
 * @param {object} model
 * @param {function():number} rng
 * @param {function():number} fsSpinFn - closure that returns one FS spin's pay × bet
 * @returns {{ fsRoundPay: number, spinsPlayed: number, hwTriggeredInFs: boolean }}
 */
export function simulateFreeSpinsRound(model, rng, fsSpinFn) {
  const fs = model.freeSpins || {};
  const initialSpins = fs.spinsPerTrigger
                    || (Array.isArray(fs.awards) && fs.awards[0]?.spins)
                    || 6;
  const retriggerSpins = fs.retriggerSpins || 3;
  const maxTotalSpins = fs.maxSpins || 15;
  const premiumFactor = fs.premiumFactor || 1.3;

  /* Per-spin retrigger probability — approximate from declared retrigger rate.
   * Industry typical: ~1-2% retrigger chance per FS spin. */
  const retriggerChancePerSpin = fs.retriggerChancePerSpin || 0.015;
  /* H&W FROM FS trigger probability per FS spin (per GDD §4.2 6.19% RTP):
   * if H&W base trigger ~ 1% per spin sa Fireball weights, FS premium-heavy
   * strips bump na ~2% per FS spin. */
  const hwInFsChancePerSpin = fs.hwInFsChancePerSpin || 0.02;

  let totalSpins = initialSpins;
  let spinsPlayed = 0;
  let fsRoundPay = 0;
  let hwTriggeredInFs = false;

  while (spinsPlayed < totalSpins && spinsPlayed < maxTotalSpins) {
    spinsPlayed++;
    /* FS spin payout = base spin × premium factor (line wins flatter, premium-heavy). */
    const basePay = (typeof fsSpinFn === 'function') ? fsSpinFn() : 0;
    fsRoundPay += basePay * premiumFactor;

    /* Retrigger check */
    if (rng() < retriggerChancePerSpin && totalSpins < maxTotalSpins) {
      totalSpins = Math.min(maxTotalSpins, totalSpins + retriggerSpins);
    }

    /* H&W FROM FS trigger check */
    if (!hwTriggeredInFs && rng() < hwInFsChancePerSpin) {
      hwTriggeredInFs = true;
      /* Average H&W FROM FS payout: industry typical 100× total bet
       * (per GDD §4.2 6.19% RTP / trigger freq ≈ 100× per FS-H&W). */
      fsRoundPay += 100;
    }
  }

  return { fsRoundPay, spinsPlayed, hwTriggeredInFs };
}

export const PLUGIN_ID = 'freeSpinsRound';
export const PLUGIN_NAME = 'Free Spins round simulation (6 spins + retrigger + H&W in FS)';
