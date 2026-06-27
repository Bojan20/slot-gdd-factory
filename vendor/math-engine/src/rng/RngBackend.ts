/**
 * RNG Backend Interface — Faza 7
 *
 * Defines the pluggable RNG contract used by all backends.
 * JS has no native u64, so nextU64 returns [hi32, lo32].
 */

export interface RngBackend {
  /** Returns a 64-bit unsigned integer split as [hi32, lo32] */
  nextU64(): [number, number];

  /** Returns a uniform float in [0, 1) using 53 significant bits */
  nextF64(): number;

  /** Returns a uniform integer in [0, max) with no modulo bias (Lemire) */
  nextU32Bounded(max: number): number;

  /** Returns a new independent RNG derived from this one + a nonce */
  split(nonce: number): RngBackend;
}

export type RngKind =
  | 'mulberry32'
  | 'pcg64'
  | 'xoshiro256ss'
  | 'philox4x32'
  /**
   * W152 P0-1 — RFC 8439 ChaCha20 CSPRNG.
   *
   * First-class crypto backend; bit-identical to the Rust
   * `RngKind::ChaCha20` variant. Required by jurisdictions that mandate
   * a cryptographically strong RNG (UKGC RTS 7, MGA Art. 11, GLI-19
   * §3.3.2 — "cryptographically strong" plus external-entropy reseed).
   */
  | 'chacha20';

/**
 * Convert a [hi32, lo32] u64 pair to a float in [0, 1) using the top 53 bits.
 * Formula: (hi * 2^21 + (lo >>> 11)) / 2^53
 */
export function u64ToF64(hi: number, lo: number): number {
  return ((hi >>> 0) * 2097152 + ((lo >>> 0) >>> 11)) / 9007199254740992;
}

/**
 * Lemire's nearly-divisionless algorithm for unbiased bounded random integers.
 * Returns a value in [0, max).
 */
export function lemireBounded(rng: RngBackend, max: number): number {
  // Use 32-bit Lemire with the lo word of nextU64
  const m = max >>> 0;
  let x = rng.nextU64()[1] >>> 0;
  let t = Math.imul(x, m) >>> 0;
  // Using BigInt for the threshold comparison to avoid float precision issues
  if (t < m) {
    const threshold = ((2 ** 32 - m) % m) >>> 0;
    while (t < threshold) {
      x = rng.nextU64()[1] >>> 0;
      t = Math.imul(x, m) >>> 0;
    }
  }
  return Number(BigInt(x) * BigInt(m) >> 32n);
}
