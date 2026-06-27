/**
 * W152 Wave 18 — Win Tier Ladder (Faza 15.A.6).
 *
 * Non-linear win-magnitude tier ladder used by the report layer to label
 * payouts ("bigWin", "majorWin", "grandWin", …) and by the presentation
 * layer to drive rollup duration / sound triggers.
 *
 * Default thresholds are *industry-generic* (psychological win-tier
 * boundaries used across the slot industry — they are not specific to
 * any vendor's brand naming). An operator can override the ladder
 * entirely via config.
 *
 * Contract:
 *   * Pure — no I/O, no clock, no RNG.
 *   * Deterministic — same `(payoutX, ladder)` → same tier label.
 *   * Validates the ladder once at construction; subsequent classification
 *     is O(log N) via binary search on sorted thresholds.
 *
 * Naming policy: tier labels MUST be operator-supplied or chosen from
 * the engine-generic defaults. Vendor brand names are reserved per
 * `docs/glossary.md` (RESERVED TERMS) — defaults below use neutral
 * descriptors only.
 */

export interface WinTierRung {
  /** Inclusive lower bound on payoutX (multiples of stake). */
  threshold: number;
  /** Operator-defined label. Stored as-is — no normalisation. */
  label: string;
  /** Hint for the presentation layer. */
  presentationHint?: 'silent' | 'subtle' | 'standard' | 'celebrate' | 'climax';
  /** Suggested rollup animation duration in ms. */
  rollupDurationMs?: number;
}

export type WinTierLadder = WinTierRung[];

export const DEFAULT_WIN_TIER_LADDER: WinTierLadder = Object.freeze([
  { threshold: 0.0, label: 'no_win', presentationHint: 'silent', rollupDurationMs: 0 },
  { threshold: 0.01, label: 'micro_win', presentationHint: 'subtle', rollupDurationMs: 200 },
  { threshold: 1.0, label: 'standard_win', presentationHint: 'standard', rollupDurationMs: 800 },
  { threshold: 10.0, label: 'big_win', presentationHint: 'celebrate', rollupDurationMs: 2000 },
  { threshold: 50.0, label: 'major_win', presentationHint: 'celebrate', rollupDurationMs: 3500 },
  { threshold: 200.0, label: 'grand_win', presentationHint: 'climax', rollupDurationMs: 6000 },
]) as WinTierLadder;

/**
 * Validate a ladder. Throws on:
 *   * empty ladder
 *   * unsorted thresholds
 *   * duplicate thresholds
 *   * negative thresholds
 *   * empty / non-string labels
 *
 * Returns the ladder verbatim (NOT sorted — caller must commit to order).
 * This is deliberate: operators want to see the original ordering preserved
 * in their config, not silently re-sorted.
 */
export function validateWinTierLadder(ladder: WinTierLadder): WinTierLadder {
  if (ladder.length === 0) {
    throw new Error('validateWinTierLadder: ladder is empty');
  }
  for (let i = 0; i < ladder.length; i++) {
    const r = ladder[i];
    if (!Number.isFinite(r.threshold) || r.threshold < 0) {
      throw new RangeError(`validateWinTierLadder: rung[${i}].threshold invalid (${r.threshold})`);
    }
    if (typeof r.label !== 'string' || r.label.length === 0) {
      throw new TypeError(`validateWinTierLadder: rung[${i}].label must be a non-empty string`);
    }
    if (i > 0) {
      const prev = ladder[i - 1];
      if (r.threshold === prev.threshold) {
        throw new Error(`validateWinTierLadder: duplicate threshold ${r.threshold}`);
      }
      if (r.threshold < prev.threshold) {
        throw new Error(
          `validateWinTierLadder: thresholds must be ascending (rung ${i} threshold ${r.threshold} < rung ${i - 1} threshold ${prev.threshold})`,
        );
      }
    }
  }
  return ladder;
}

/**
 * Classify a payout multiplier (in stake-multiples) into a tier rung.
 *
 * Returns the highest rung whose `threshold ≤ payoutX`. Throws if
 * `payoutX` is non-finite or if the ladder is empty (defensive — Zod
 * normally prevents this).
 */
export function classifyPayout(payoutX: number, ladder: WinTierLadder = DEFAULT_WIN_TIER_LADDER): WinTierRung {
  if (!Number.isFinite(payoutX)) {
    throw new TypeError(`classifyPayout: payoutX must be finite (got ${payoutX})`);
  }
  if (payoutX < 0) {
    throw new RangeError(`classifyPayout: payoutX must be >= 0 (got ${payoutX})`);
  }
  if (ladder.length === 0) {
    throw new Error('classifyPayout: ladder is empty');
  }
  // Binary search for the highest rung with threshold ≤ payoutX.
  let lo = 0;
  let hi = ladder.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ladder[mid].threshold <= payoutX) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ladder[best];
}

/**
 * Tier-occupancy distribution — count how many payouts in `payoutsX`
 * land in each tier. Returns a frequency map keyed by `label`.
 *
 * Useful for PAR sheet "win distribution by tier" reporting and for the
 * acceptance check that base-game vs free-spin tier distributions
 * remain within design tolerance.
 */
export function tierOccupancy(
  payoutsX: number[],
  ladder: WinTierLadder = DEFAULT_WIN_TIER_LADDER,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rung of ladder) {
    out[rung.label] = 0;
  }
  for (const p of payoutsX) {
    const rung = classifyPayout(p, ladder);
    out[rung.label] = (out[rung.label] ?? 0) + 1;
  }
  return out;
}

/**
 * Apply the ladder to a list of payouts and emit `(payoutX, label,
 * presentationHint, rollupDurationMs)` tuples — convenient as a single
 * pass for downstream UI/PAR consumers that want the raw classification.
 */
export function applyTierLadder(
  payoutsX: number[],
  ladder: WinTierLadder = DEFAULT_WIN_TIER_LADDER,
): Array<{
  payoutX: number;
  label: string;
  presentationHint: WinTierRung['presentationHint'];
  rollupDurationMs: WinTierRung['rollupDurationMs'];
}> {
  return payoutsX.map((p) => {
    const rung = classifyPayout(p, ladder);
    return {
      payoutX: p,
      label: rung.label,
      presentationHint: rung.presentationHint,
      rollupDurationMs: rung.rollupDurationMs,
    };
  });
}
