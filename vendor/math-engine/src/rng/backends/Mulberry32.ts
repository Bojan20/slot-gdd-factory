/**
 * Mulberry32 backend — Faza 7
 *
 * Wraps the existing mulberry32 algorithm in the RngBackend interface.
 * The core algorithm is BIT-IDENTICAL to src/engine/rng.ts and src/utils/rng.ts.
 *
 * Period: ~2^32
 * State: single u32
 */

import { RngBackend, u64ToF64, lemireBounded } from '../RngBackend.js';

export class Mulberry32 implements RngBackend {
  private t: number;

  constructor(seed: number) {
    this.t = seed >>> 0;
  }

  /**
   * One step of Mulberry32 — returns value in [0, 1).
   * Must stay bit-identical to the legacy implementation.
   */
  private step(): number {
    this.t = (this.t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(this.t ^ (this.t >>> 15), 1 | this.t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * nextU64: Mulberry32 produces 32-bit values, so we call step twice.
   * hi = first call mapped back to u32, lo = second call mapped back to u32.
   */
  nextU64(): [number, number] {
    const hi = (this.step() * 4294967296) >>> 0;
    const lo = (this.step() * 4294967296) >>> 0;
    return [hi, lo];
  }

  nextF64(): number {
    // For Mulberry32, the native output IS already a 32-bit-based float.
    // We use the standard step() directly for best quality (full 32 bits).
    return this.step();
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  split(nonce: number): RngBackend {
    // Derive a new seed by mixing current t with nonce
    let s = (this.t ^ (nonce >>> 0)) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return new Mulberry32(s);
  }
}
