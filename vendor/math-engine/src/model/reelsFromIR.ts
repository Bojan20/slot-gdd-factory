/**
 * W152 Wave 17 — Tech-debt closeout: BASE_REELS / FREE_SPINS_REELS
 * IR migration adapter.
 *
 * The legacy `BASE_REELS` and `FREE_SPINS_REELS` constants in `model/reels.ts`
 * are template-default reel strips for the demo game shipped with this
 * repo. They live there so the default fixtures simulate without anyone
 * having to wire IR loading. Production operators integrating the engine
 * load their game's strips from an IR JSON, NOT from these constants.
 *
 * That's the tech debt the master_todo registers: "TS BASE_REELS as TS
 * const — IR adapter ih učitava, ali izvori su još hardcoded TS." This
 * module closes that gap by providing a clean factory:
 *
 *   loadReelsFromIR(ir) → { baseReels, fsReels?, mode }
 *
 * The factory:
 *   * Accepts both `weighted` and `strips` IR reel modes.
 *   * For `strips`, returns the strips verbatim — direct production path.
 *   * For `weighted`, materialises a deterministic strip from the
 *     weighted distribution (sorted by symbol id for byte-stability)
 *     so the same IR + same engine version always produces the same
 *     strip. This is what the par-samples generator and `runIRSimulation`
 *     already do internally; we surface it as a public helper for the
 *     last `BASE_REELS` consumers (mathValidator + parReport).
 *   * Returns sentinel `null` for `fsReels` when the IR doesn't declare
 *     them — caller decides whether that's an error.
 *
 * After this lands, `validateReels()` and friends still work against
 * the template-default constants for back-compat, but operators using
 * IR can call `loadReelsFromIR(ir)` and skip the demo defaults entirely.
 *
 * NOT exported from `src/model/reels.ts` to keep the public surface of
 * that file unchanged for back-compat. Import directly from this module.
 */

import type { SlotGameIR, SymbolKey } from '../ir/types.js';
import type { ReelStrip } from './reels.js';

export type ReelLoadMode = 'weighted' | 'strips';

export interface ReelsFromIR {
  /** Materialised base-game reel strips. */
  baseReels: ReelStrip[];
  /** Materialised free-spins reel strips, or `null` if the IR omits them. */
  fsReels: ReelStrip[] | null;
  /** Source mode the strips were derived from. */
  mode: ReelLoadMode;
}

/**
 * Convert one weighted reel `{symbol: weight}` map into a deterministic
 * explicit strip whose symbol ratios match the weights exactly.
 *
 * Algorithm:
 *   1. Sort symbol ids alphabetically — byte-stable across runs.
 *   2. Each symbol contributes `weight` consecutive copies in the strip.
 *
 * The resulting strip has length `Σ weights`. Identical IR + identical
 * engine commit always produces an identical strip — replay-safe.
 *
 * Example: `{LP1: 3, LP2: 2, HP1: 1}` →
 *   `['HP1', 'LP1', 'LP1', 'LP1', 'LP2', 'LP2']`
 */
export function materialiseWeightedReel(weights: Record<SymbolKey, number>): ReelStrip {
  const out: ReelStrip = [];
  const symbols = Object.keys(weights).sort();
  for (const sym of symbols) {
    const w = weights[sym];
    if (!Number.isInteger(w) || w < 0) {
      throw new RangeError(
        `materialiseWeightedReel: weight for '${sym}' must be a non-negative integer (got ${w})`,
      );
    }
    for (let i = 0; i < w; i++) out.push(sym);
  }
  if (out.length === 0) {
    throw new Error('materialiseWeightedReel: refusing to produce an empty strip (all weights are zero)');
  }
  return out;
}

/**
 * Public factory: derive runtime reel strips from an `SlotGameIR`.
 *
 * Throws on missing/invalid `ir.reels`. Throws on weighted reels with
 * an empty weight map (would produce an unspinnable reel). Returns the
 * deterministic materialised result so the caller can store, hash, or
 * compare across runs.
 */
export function loadReelsFromIR(ir: SlotGameIR): ReelsFromIR {
  const reels = ir.reels;
  if (reels === undefined || reels === null || typeof reels !== 'object') {
    throw new TypeError('loadReelsFromIR: ir.reels missing or not an object');
  }
  if (reels.mode === 'strips') {
    return {
      baseReels: reels.base.map((reel) => reel.slice()),
      fsReels: reels.free_spins ? reels.free_spins.map((reel) => reel.slice()) : null,
      mode: 'strips',
    };
  }
  if (reels.mode === 'weighted') {
    return {
      baseReels: reels.base.map((m) => materialiseWeightedReel(m)),
      fsReels: reels.free_spins ? reels.free_spins.map((m) => materialiseWeightedReel(m)) : null,
      mode: 'weighted',
    };
  }
  throw new TypeError(`loadReelsFromIR: unsupported reel mode '${(reels as { mode: string }).mode}'`);
}

/**
 * Convenience: count total stops across base + (optional) FS reels.
 *
 * Engineers eyeballing a config can use this to sanity-check that a
 * `weighted` IR with tiny weights didn't accidentally explode into a
 * 100 000-stop strip per reel. The default 5 × 54 = 270 stops base
 * is a reasonable bound; anything above 5 × 1000 = 5000 should raise
 * a flag in code review.
 */
export function totalStops(loaded: ReelsFromIR): { base: number; fs: number } {
  const base = loaded.baseReels.reduce((s, r) => s + r.length, 0);
  const fs = loaded.fsReels === null ? 0 : loaded.fsReels.reduce((s, r) => s + r.length, 0);
  return { base, fs };
}
