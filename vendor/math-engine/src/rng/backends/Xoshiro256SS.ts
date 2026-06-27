/**
 * Xoshiro256** backend — Faza 7
 *
 * 256-bit state (4x u64 as BigInt), 64-bit output.
 * Excellent statistical quality and speed.
 *
 * Reference: https://prng.di.unimi.it/
 */

import { RngBackend, u64ToF64, lemireBounded } from '../RngBackend.js';

const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = (1n << 32n) - 1n;

function rotl64(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK_64;
}

/**
 * SplitMix64 — used for seeding from a single 64-bit value.
 */
function smx64(z: bigint): bigint {
  z = (z + 0x9E3779B97F4A7C15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK_64;
  return z ^ (z >> 31n);
}

export class Xoshiro256SS implements RngBackend {
  private s: [bigint, bigint, bigint, bigint];

  constructor(seed: number) {
    const s0 = smx64(BigInt(seed >>> 0));
    const s1 = smx64(s0);
    const s2 = smx64(s1);
    const s3 = smx64(s2);
    this.s = [s0, s1, s2, s3];
  }

  private next(): bigint {
    const s = this.s;
    const result = rotl64(s[1] * 5n & MASK_64, 7n) * 9n & MASK_64;

    const t = (s[1] << 17n) & MASK_64;
    s[2] = (s[2] ^ s[0]) & MASK_64;
    s[3] = (s[3] ^ s[1]) & MASK_64;
    s[1] = (s[1] ^ s[2]) & MASK_64;
    s[0] = (s[0] ^ s[3]) & MASK_64;
    s[2] = (s[2] ^ t) & MASK_64;
    s[3] = rotl64(s[3], 45n);

    return result;
  }

  nextU64(): [number, number] {
    const r = this.next();
    return [Number((r >> 32n) & MASK_32), Number(r & MASK_32)];
  }

  nextF64(): number {
    const [hi, lo] = this.nextU64();
    return u64ToF64(hi, lo);
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  split(nonce: number): RngBackend {
    // Derive a new seed from current state + nonce
    const derived = Number((this.s[0] ^ BigInt(nonce >>> 0)) & MASK_32);
    return new Xoshiro256SS(derived);
  }
}
