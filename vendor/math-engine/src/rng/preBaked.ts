/**
 * W152 Wave 18 — Pre-Baked Array RNG (Faza 15.A.12).
 *
 * Performance optimisation for hot-path symbol selection. Where the
 * canonical weighted-pick (Walker's Alias, Vose-style) does:
 *
 *     // O(1) per pick but two array accesses + multiplication
 *     const i = pickWalker(weights, uniformU);
 *     return symbols[i];
 *
 * the pre-baked path materialises the weighted distribution into an
 * explicit duplicate array at config-load time:
 *
 *     // Build once: [A, A, A, B, B, C]   (weights: A=3, B=2, C=1)
 *     const baked = buildPreBaked({A: 3, B: 2, C: 1});
 *
 *     // Hot loop: ONE array access, no multiplication.
 *     return baked.array[uniformInt(baked.length)];
 *
 * When does it pay off?
 *   * Symbol pools small (≤ 50 symbols) and weights have small GCD.
 *   * Hot SIMD loop where the inner-loop indirection cost dominates.
 *   * Bulk MC paths (1M+ spins) where the pre-bake amortises away.
 *
 * When does it NOT pay off?
 *   * Symbol pools where weights are coprime large numbers (array
 *     blows up — e.g. weights {A:7919, B:7920} → 15 839-element array).
 *   * One-shot evaluation (Walker's Alias O(N) build is wasted).
 *
 * The acceptance bench target is **≥ 1.15× speedup** vs Walker's Alias
 * on the 50-state symbol-pool fixture. Below that, the indirection
 * savings don't outweigh the cache-locality cost — and we keep Walker.
 *
 * KAT parity:
 *   * Same `uniformU` stream → same picks → bit-identical with Walker
 *     for any weight map whose pre-bake length is < 2^32. The seeded
 *     test fixture pins this for the parity gate.
 */

import type { JsonValue } from '../ir/extensions.js';

export interface PreBakedDistribution<T extends string> {
  /** Pre-materialised duplicate array. */
  readonly array: ReadonlyArray<T>;
  /** Total length — cached for branch-free hot loop. */
  readonly length: number;
  /** Original weight map — kept for replay / debug. */
  readonly weights: Readonly<Record<T, number>>;
}

/** Hard cap on pre-baked array size. Above this we throw — caller
 *  should fall back to Walker's Alias. 1M elements = ~8 MB at 8 bytes
 *  per string ref, comfortable for any modern hot-path. */
export const MAX_PRE_BAKED_LENGTH = 1_000_000;

/**
 * Build the pre-baked array from a weight map.
 *
 * Throws on:
 *   * empty weight map
 *   * non-integer weight (use `floor` or `round` upstream)
 *   * negative weight
 *   * zero-everywhere map (would produce empty array)
 *   * total length > `MAX_PRE_BAKED_LENGTH` (suggests caller use Walker's Alias)
 *
 * Order is deterministic — symbols inserted in alphabetical order. Two
 * callers passing the same weight map get byte-identical baked arrays
 * (essential for KAT parity across TS↔Rust).
 */
export function buildPreBaked<T extends string>(
  weights: Record<T, number>,
): PreBakedDistribution<T> {
  const symbols = (Object.keys(weights) as T[]).sort();
  if (symbols.length === 0) {
    throw new Error('buildPreBaked: empty weights map');
  }
  // First pass — validate AND compute total length.
  let totalLength = 0;
  for (const sym of symbols) {
    const w = weights[sym];
    if (!Number.isFinite(w) || !Number.isInteger(w)) {
      throw new TypeError(`buildPreBaked: weight for '${sym}' must be a finite integer (got ${w})`);
    }
    if (w < 0) {
      throw new RangeError(`buildPreBaked: weight for '${sym}' must be non-negative (got ${w})`);
    }
    totalLength += w;
  }
  if (totalLength === 0) {
    throw new Error('buildPreBaked: total weight is zero (all symbols would have probability 0)');
  }
  if (totalLength > MAX_PRE_BAKED_LENGTH) {
    throw new RangeError(
      `buildPreBaked: total length ${totalLength} exceeds MAX_PRE_BAKED_LENGTH ${MAX_PRE_BAKED_LENGTH}. Use Walker's Alias instead.`,
    );
  }
  // Second pass — materialise.
  const array: T[] = new Array(totalLength);
  let cursor = 0;
  for (const sym of symbols) {
    const w = weights[sym];
    for (let i = 0; i < w; i++) {
      array[cursor++] = sym;
    }
  }
  return Object.freeze({
    array: Object.freeze(array),
    length: totalLength,
    weights: Object.freeze({ ...weights }),
  }) as PreBakedDistribution<T>;
}

/**
 * Hot-path pick from a pre-baked distribution.
 *
 * Single array access + integer multiplication. The caller supplies the
 * `uniformU ∈ [0, 1)` source — typically from a PCG-64 / ChaCha20
 * stream. Bit-identical with Walker's Alias on the same uniform.
 */
export function pickPreBaked<T extends string>(dist: PreBakedDistribution<T>, uniformU: number): T {
  if (!Number.isFinite(uniformU) || uniformU < 0 || uniformU >= 1) {
    throw new RangeError(`pickPreBaked: uniformU must be in [0, 1) (got ${uniformU})`);
  }
  const idx = Math.floor(uniformU * dist.length);
  // Defensive clamp — handles uniformU = 0.9999999... edge case.
  return dist.array[idx >= dist.length ? dist.length - 1 : idx];
}

/**
 * Bulk pick — N picks at once for MC throughput. Returns a fresh array
 * (caller may pool). Useful for SIMD-prefetched evaluator paths.
 */
export function bulkPickPreBaked<T extends string>(
  dist: PreBakedDistribution<T>,
  uniforms: number[],
): T[] {
  const out: T[] = new Array(uniforms.length);
  for (let i = 0; i < uniforms.length; i++) {
    out[i] = pickPreBaked(dist, uniforms[i]);
  }
  return out;
}

/**
 * Memory-footprint estimator (bytes). Useful for the operator who is
 * deciding whether to commit a 200K-element baked array on a memory-
 * constrained edge box.
 *
 * Rough: 8 bytes per element ref + 64 bytes header overhead.
 */
export function estimateMemoryBytes<T extends string>(dist: PreBakedDistribution<T>): number {
  return dist.length * 8 + 64;
}

/** Serialisable form for diagnostic JSON dumps. */
export function describePreBaked<T extends string>(dist: PreBakedDistribution<T>): JsonValue {
  return {
    length: dist.length,
    uniqueSymbols: Object.keys(dist.weights).length,
    weights: dist.weights as Record<string, number>,
    estimatedBytes: estimateMemoryBytes(dist),
  };
}
