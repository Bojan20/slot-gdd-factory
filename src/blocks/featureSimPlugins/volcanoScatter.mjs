/**
 * src/blocks/featureSimPlugins/volcanoScatter.mjs
 *
 * OPCIJA A · A-3 — Volcano scatter handler GDD-faithful.
 *
 * Cash Eruption GDD §6.3 / §5.3:
 *   Volcano scatter pays:
 *     3-of  → 2× total bet
 *     4-of  → 15× total bet
 *     5-of  → 100× total bet
 *   Pays ONCE per spin on the best count (not per position),
 *   independent of line positions, anywhere on grid.
 *   ALSO acts as Free Spins trigger (≥3 Volcano → 6 FS).
 *
 * Pre-A-3 probe je tretirao SVAKI scatter pay kao instant line-pay
 * (legitiman za scatter, but pay table hard-coded). Sad sa pluginom:
 *   • Pay table parameterized iz model.scatter.payTable ili default
 *   • Returns scatter count za FS trigger evaluation (A-5)
 *
 * Vendor-neutral: any model.scatter.{enabled, payTable, fsTrigger} schema.
 */

const DEFAULT_SCATTER_PAY = { 3: 2, 4: 15, 5: 100 };

/**
 * Evaluate Volcano scatter pay + FS trigger eligibility.
 * @param {Array<Array<{scatter}>>} grid
 * @param {object} model
 * @returns {{ scatterPay: number, scatterCount: number, fsTriggered: boolean }}
 */
export function evalVolcanoScatter(grid, model) {
  let scatterCount = 0;
  for (const col of grid) {
    for (const cell of col) {
      if (cell?.scatter) scatterCount++;
    }
  }

  if (scatterCount < 3) {
    return { scatterPay: 0, scatterCount, fsTriggered: false };
  }

  /* Pay table: model.scatter.payTable per-count, fallback to GDD §6.3
   * Cash Eruption defaults. */
  const payTable = model.scatter?.payTable || DEFAULT_SCATTER_PAY;
  const cappedCount = Math.min(5, scatterCount);
  const scatterPay = payTable[cappedCount] || 0;

  /* FS trigger threshold: model.freeSpins.scatterTrigger or default 3 */
  const fsTriggerThreshold = model.freeSpins?.scatterTrigger
                          || model.freeSpins?.triggerCount
                          || 3;
  const fsTriggered = scatterCount >= fsTriggerThreshold;

  return { scatterPay, scatterCount, fsTriggered };
}

export const PLUGIN_ID = 'volcanoScatter';
export const PLUGIN_NAME = 'Volcano scatter pay + FS trigger detection';
