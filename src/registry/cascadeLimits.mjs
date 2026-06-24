/**
 * src/registry/cascadeLimits.mjs
 *
 * UQ-DEEP-AN · AN-3 — Cascade depth guard (anti-infinite-loop max 100 iter).
 *
 * Industry-reference (IGT TumbleBehavior) anti-pattern explicit: a cascade /
 * tumble chain MUST have a hard ceiling — otherwise an adversarial RNG /
 * pathological reel strip can drive the iteration counter to infinity and
 * lock the spin lifecycle. IGT lessons cap the chain at 100 iterations and
 * emit a `CASCADE_DEPTH_EXCEEDED` reason when the guard trips.
 *
 * Our `src/blocks/tumble.mjs` already exposes a soft `maxChain` (1..64) for
 * the visual chain budget, but that is a per-game tuning knob — not a
 * runtime safety net. This module is the centralized hard ceiling; every
 * cascade-shaped block (tumble, cascadeBooster, cascadePathDraw, future
 * cascadeCore) must import from here so a single audit point governs all
 * cascade loops.
 *
 *   - CASCADE_MAX_DEPTH (100)               — hard halt
 *   - CASCADE_WARNING_AT_DEPTH (50)         — warn + continue
 *   - CASCADE_MAX_DEPTH_FALLBACK_REASON     — telemetry reason code
 *   - SCHEMA_VERSION ('1')                  — bumped on contract change
 *
 *   - shouldHaltCascade(depth)              — true when depth >= 100
 *   - shouldWarnCascade(depth)              — true on [50, 100)
 */

export const CASCADE_MAX_DEPTH = 100;
export const CASCADE_MAX_DEPTH_FALLBACK_REASON = 'CASCADE_DEPTH_EXCEEDED';
export const CASCADE_WARNING_AT_DEPTH = 50;
export const SCHEMA_VERSION = '1';

/**
 * Returns true when the cascade has reached or exceeded the hard halt
 * ceiling. The caller MUST finalize/abort the chain and emit
 * `onCascadeHalted` with `reason: CASCADE_MAX_DEPTH_FALLBACK_REASON`.
 *
 * @param {number} depth
 * @returns {boolean}
 */
export function shouldHaltCascade(depth) {
  const n = Number(depth);
  if (!Number.isFinite(n)) return false;
  return n >= CASCADE_MAX_DEPTH;
}

/**
 * Returns true when the cascade has reached the soft warning band but not
 * the hard halt — i.e. depth ∈ [CASCADE_WARNING_AT_DEPTH, CASCADE_MAX_DEPTH).
 * Callers SHOULD log a warning but continue. Once `shouldHaltCascade` is
 * true, this returns false (mutually exclusive bands).
 *
 * @param {number} depth
 * @returns {boolean}
 */
export function shouldWarnCascade(depth) {
  const n = Number(depth);
  if (!Number.isFinite(n)) return false;
  return n >= CASCADE_WARNING_AT_DEPTH && n < CASCADE_MAX_DEPTH;
}
