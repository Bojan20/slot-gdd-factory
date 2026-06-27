/**
 * ChaCha20 backend — W152 P0-1 (RFC 8439 IETF, 20 rounds, CSPRNG).
 *
 * First-class wrapper around the existing `src/crypto/chacha20.ts`
 * ChaCha20Rng. Bit-identical to the Rust `ChaCha20Backend` in
 * `rust-sim/src/rng.rs` for any string seed — verified by the W152 P0-5
 * cross-impl parity test (`tests/rng/chacha20.parity.spec.ts`).
 *
 * Use this backend whenever the active jurisdiction profile demands a
 * cryptographically strong RNG (UKGC RTS 7, MGA Art. 11, GLI-19 §3.3.2).
 *
 * Numeric seed convention
 * -----------------------
 * The `Mulberry32 / PCG64 / Xoshiro256SS / Philox4x32` backends all take a
 * numeric u32 seed. For ChaCha20 we render the numeric seed as the
 * lowercase hex string `"u64:<016x>"` so it round-trips with
 * `create_rng(RngKind::ChaCha20, seed)` on the Rust side. If the caller
 * wants arbitrary string seeds (typical HSM derivation path), use
 * `ChaCha20.fromSeedString(seed)` instead.
 */

import { RngBackend, lemireBounded } from '../RngBackend.js';
import { ChaCha20Rng } from '../../crypto/chacha20.js';

export class ChaCha20 implements RngBackend {
  private readonly _rng: ChaCha20Rng;
  private readonly _seedStr: string;

  constructor(seed: number) {
    // Render numeric seed to the canonical 16-hex form. `>>> 0` would
    // truncate to 32 bits; instead use `BigInt(seed) & 0xFFFF_FFFF_FFFF_FFFFn`
    // so callers passing `Number.MAX_SAFE_INTEGER` survive intact.
    const seedHex = (BigInt(seed) & 0xffff_ffff_ffff_ffffn)
      .toString(16)
      .padStart(16, '0');
    this._seedStr = `u64:${seedHex}`;
    this._rng = new ChaCha20Rng(this._seedStr);
  }

  /**
   * Construct from a raw string seed. Use this when the caller has a
   * higher-entropy source (HSM session ID, KMS DEK fingerprint) than a
   * 64-bit integer can carry. Bit-identical to the Rust
   * `ChaCha20Backend::from_seed_str` constructor.
   */
  static fromSeedString(seed: string): ChaCha20 {
    const inst = Object.create(ChaCha20.prototype) as ChaCha20;
    Object.defineProperty(inst, '_seedStr', { value: seed, enumerable: false });
    Object.defineProperty(inst, '_rng', {
      value: new ChaCha20Rng(seed),
      enumerable: false,
    });
    return inst;
  }

  nextU64(): [number, number] {
    // Match Rust: lo = next_u32, hi = next_u32 (counter advance in between
    // is handled inside ChaCha20Rng.nextUint32).
    const lo = this._rng.nextUint32();
    const hi = this._rng.nextUint32();
    return [hi >>> 0, lo >>> 0];
  }

  nextF64(): number {
    // Use the top 53 bits of (hi, lo) — same as u64ToF64 in RngBackend.ts.
    const lo = this._rng.nextUint32();
    const hi = this._rng.nextUint32();
    return ((hi >>> 0) * 2097152 + ((lo >>> 0) >>> 11)) / 9007199254740992;
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  split(nonce: number): RngBackend {
    // Mirror the Rust split convention: append the nonce to the seed
    // string and derive a fresh key+nonce from the combined string.
    const nonceHex = ((nonce >>> 0) | 0).toString(16).padStart(16, '0');
    const childSeed = `${this._seedStr}::split:${nonceHex.slice(-16)}`;
    return ChaCha20.fromSeedString(childSeed);
  }
}
