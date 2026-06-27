/**
 * PCG64 XSL-RR-64 backend — Faza 7
 *
 * PCG64 with 128-bit state, 64-bit output using BigInt.
 * Variant: XSL-RR-64 (xor-shift-low + random-rotation)
 *
 * Reference: https://www.pcg-random.org/
 */

import { RngBackend, u64ToF64, lemireBounded } from '../RngBackend.js';

const MASK_128 = (1n << 128n) - 1n;
const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = (1n << 32n) - 1n;
// Multiplier must satisfy m ≡ 1 (mod 4) for full-period LCG mod 2^128.
// The correct value ends in ...EF45 (not ...EF44 which would be divisible by 4).
const PCG_MULTIPLIER = 0x2360ED051FC65DA44385DF649FCCEF45n;
// INC must be odd (128-bit). lo64 = 0x0000000000000001 satisfies that.
const PCG_INC = 0xDA3E39CB94B95BDB0000000000000001n;

/**
 * Rotate right a 64-bit value by n bits.
 * Uses BigInt because JS numbers are only 32-bit for bit operations.
 */
function rotateRight64(x: number, n: number): number {
  if (n === 0) return x >>> 0;
  const xb = BigInt(x >>> 0);
  const nb = BigInt(n & 63);
  const result = ((xb >> nb) | (xb << (64n - nb))) & MASK_64;
  // Convert back to JS number (fits in 32 bits as u32 pair → we return lo32)
  return Number(result & MASK_32);
}

/**
 * Returns the full 64-bit result as [hi32, lo32].
 */
function rotateRight64Full(x: number, n: number): [number, number] {
  if (n === 0) {
    return [0, x >>> 0];
  }
  const xb = BigInt(x >>> 0);
  const nb = BigInt(n & 63);
  const result = ((xb >> nb) | (xb << (64n - nb))) & MASK_64;
  const hi = Number((result >> 32n) & MASK_32);
  const lo = Number(result & MASK_32);
  return [hi, lo];
}

export class PCG64 implements RngBackend {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: number) {
    this.inc = PCG_INC;
    this.state = 0n;
    // Seeding sequence
    this.state = (this.state * PCG_MULTIPLIER + this.inc) & MASK_128;
    this.state = (this.state + BigInt(seed >>> 0)) & MASK_128;
    this.state = (this.state * PCG_MULTIPLIER + this.inc) & MASK_128;
    this.state = (this.state + 0x9E3779B97F4A7C15n) & MASK_128;
    this.state = (this.state * PCG_MULTIPLIER + this.inc) & MASK_128;
  }

  private advance(): [number, number] {
    const old = this.state;
    this.state = (old * PCG_MULTIPLIER + this.inc) & MASK_128;

    // XSL-RR-64 output function
    const hi32 = Number((old >> 96n) & MASK_32);       // top 32 bits of old state (bits 127..96)
    const lo64hi = Number((old >> 64n) & MASK_32);     // bits 95..64 of old state
    const lo64lo = Number(old & MASK_32);              // bits 31..0 of old state

    // xorshifted = hi64 ^ lo64 (we work with 64-bit pieces)
    const hi64 = (old >> 64n) & MASK_64;
    const lo64 = old & MASK_64;
    const xorshifted64 = (hi64 ^ lo64) & MASK_64;

    // rotation count: top 6 bits of old state (bits 127..122)
    const count = Number((old >> 122n) & 0x3Fn);

    // rotate right the 64-bit xorshifted value by count
    const xs_hi = Number((xorshifted64 >> 32n) & MASK_32);
    const xs_lo = Number(xorshifted64 & MASK_32);

    if (count === 0) {
      return [xs_hi, xs_lo];
    }

    const nb = BigInt(count & 63);
    const result = ((xorshifted64 >> nb) | (xorshifted64 << (64n - nb))) & MASK_64;
    return [Number((result >> 32n) & MASK_32), Number(result & MASK_32)];
  }

  nextU64(): [number, number] {
    return this.advance();
  }

  nextF64(): number {
    const [hi, lo] = this.advance();
    return u64ToF64(hi, lo);
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  split(nonce: number): RngBackend {
    // Create a new PCG64 with a derived seed
    const derived = Number(((this.state >> 32n) ^ BigInt(nonce >>> 0)) & MASK_32);
    return new PCG64(derived);
  }
}
