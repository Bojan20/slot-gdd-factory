/**
 * Philox4x32-10 backend — Faza 7
 *
 * Counter-based PRNG with 4x32-bit counter, 2x32-bit key, 10 rounds.
 * Suitable for parallel simulation (independent streams via counter).
 *
 * Reference: Salmon et al., "Random123: A Library of Counter-Based Random
 *            Number Generators", SC'11.
 */

import { RngBackend, u64ToF64, lemireBounded } from '../RngBackend.js';

const PHILOX_M0 = 0xD2511F53;
const PHILOX_M1 = 0xCD9E8D57;
const PHILOX_W0 = 0x9E3779B9;
const PHILOX_W1 = 0xBB67AE85;

/**
 * 32x32 -> 64-bit multiply using BigInt to avoid JS float precision loss.
 * Returns [hi32, lo32].
 */
function mulhi32(a: number, b: number): [number, number] {
  const product = BigInt(a >>> 0) * BigInt(b >>> 0);
  const hi = Number((product >> 32n) & 0xFFFFFFFFn);
  const lo = Number(product & 0xFFFFFFFFn);
  return [hi, lo];
}

type U32x4 = [number, number, number, number];
type U32x2 = [number, number];

function philoxRound(x: U32x4, key: U32x2): U32x4 {
  const [hi0, lo0] = mulhi32(PHILOX_M0, x[0]);
  const [hi1, lo1] = mulhi32(PHILOX_M1, x[2]);
  return [
    (hi1 ^ x[1] ^ key[0]) >>> 0,
    lo1 >>> 0,
    (hi0 ^ x[3] ^ key[1]) >>> 0,
    lo0 >>> 0,
  ];
}

function bumpKey(key: U32x2): U32x2 {
  return [
    (key[0] + PHILOX_W0) >>> 0,
    (key[1] + PHILOX_W1) >>> 0,
  ];
}

export class Philox4x32 implements RngBackend {
  private counter: U32x4;
  private key: U32x2;
  /** Current output buffer: 4 u32 values */
  private output: U32x4;
  private outIdx: number;

  constructor(seed: number) {
    this.key = [seed >>> 0, Math.floor(seed / 4294967296) >>> 0];
    this.counter = [0, 0, 0, 0];
    this.output = [0, 0, 0, 0];
    this.outIdx = 4; // force generate on first use
  }

  private generate(): void {
    let x: U32x4 = [...this.counter] as U32x4;
    let key: U32x2 = [...this.key] as U32x2;

    // 10 rounds of Philox
    for (let r = 0; r < 10; r++) {
      x = philoxRound(x, key);
      if (r < 9) key = bumpKey(key);
    }

    this.output = x;
    this.outIdx = 0;

    // Increment counter (128-bit little-endian)
    this.counter[0] = (this.counter[0] + 1) >>> 0;
    if (this.counter[0] === 0) {
      this.counter[1] = (this.counter[1] + 1) >>> 0;
      if (this.counter[1] === 0) {
        this.counter[2] = (this.counter[2] + 1) >>> 0;
        if (this.counter[2] === 0) {
          this.counter[3] = (this.counter[3] + 1) >>> 0;
        }
      }
    }
  }

  private nextU32(): number {
    if (this.outIdx >= 4) {
      this.generate();
    }
    return this.output[this.outIdx++] >>> 0;
  }

  nextU64(): [number, number] {
    const hi = this.nextU32();
    const lo = this.nextU32();
    return [hi, lo];
  }

  nextF64(): number {
    const [hi, lo] = this.nextU64();
    return u64ToF64(hi, lo);
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  split(nonce: number): RngBackend {
    const child = new Philox4x32(0);
    // Derive child key from parent key + nonce
    child.key = [
      (this.key[0] ^ (nonce >>> 0)) >>> 0,
      (this.key[1] ^ Math.imul(nonce >>> 0, 0x9E3779B9)) >>> 0,
    ];
    child.counter = [...this.counter] as U32x4;
    child.outIdx = 4; // force generate
    return child;
  }
}
