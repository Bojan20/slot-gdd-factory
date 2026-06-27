// ChaCha20 stream cipher — RFC 8439 IETF variant, 20 rounds
// Pure TypeScript, no external dependencies

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hexToBytes: input must have even length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Rotate left 32-bit
function rotl32(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChaCha20 core
// ─────────────────────────────────────────────────────────────────────────────

// Quarter round — operates in-place on a Uint32Array
function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a],  8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c],  7);
}

// Read a little-endian u32 from a Uint8Array at offset
function readLE32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset    ]      ) |
    (buf[offset + 1] <<  8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
}

// Write a little-endian u32 into a Uint8Array at offset
function writeLE32(buf: Uint8Array, offset: number, v: number): void {
  buf[offset    ] = (v       ) & 0xff;
  buf[offset + 1] = (v >>>  8) & 0xff;
  buf[offset + 2] = (v >>> 16) & 0xff;
  buf[offset + 3] = (v >>> 24) & 0xff;
}

/**
 * Generate one 64-byte ChaCha20 keystream block.
 * key   — 32 bytes
 * counter — 32-bit block counter
 * nonce — 12 bytes (IETF variant)
 */
export function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  if (key.length !== 32)   throw new Error('chacha20Block: key must be 32 bytes');
  if (nonce.length !== 12) throw new Error('chacha20Block: nonce must be 12 bytes');

  // Constants: "expand 32-byte k"
  const state = new Uint32Array(16);
  state[0]  = 0x61707865;
  state[1]  = 0x3320646e;
  state[2]  = 0x79622d32;
  state[3]  = 0x6b206574;

  // Key (8 words)
  for (let i = 0; i < 8; i++) {
    state[4 + i] = readLE32(key, i * 4);
  }

  // Counter (1 word)
  state[12] = counter >>> 0;

  // Nonce (3 words)
  for (let i = 0; i < 3; i++) {
    state[13 + i] = readLE32(nonce, i * 4);
  }

  // Working copy
  const working = new Uint32Array(state);

  // 20 rounds (10 double-rounds)
  for (let i = 0; i < 10; i++) {
    // Column rounds
    quarterRound(working, 0, 4,  8, 12);
    quarterRound(working, 1, 5,  9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    // Diagonal rounds
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7,  8, 13);
    quarterRound(working, 3, 4,  9, 14);
  }

  // Add original state
  const output = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    writeLE32(output, i * 4, (working[i] + state[i]) >>> 0);
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChaCha20Rng class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap: derive 32-byte key + 12-byte nonce (44 bytes total) from a seed
 * string by UTF-8 encoding then XOR-diffusing into 44 bytes.
 */
function deriveKeyAndNonce(seed: string): { key: Uint8Array; nonce: Uint8Array } {
  const encoder = new TextEncoder();
  const seedBytes = encoder.encode(seed);

  // Target 44 bytes (32 key + 12 nonce)
  const derived = new Uint8Array(44);

  // XOR-diffuse seed bytes, cycling with a simple mixing step
  for (let i = 0; i < seedBytes.length; i++) {
    // Mix position: use wrapping index, add a positional twist
    const pos = i % 44;
    derived[pos] ^= seedBytes[i];
    // Cascade the mixed byte forward to spread entropy
    const next = (pos + 1) % 44;
    derived[next] ^= (seedBytes[i] * 0x9e3779b9) & 0xff;
  }

  // If derived is all zeros (empty or unlucky seed), fill with a deterministic fallback
  let nonZero = false;
  for (let i = 0; i < 44; i++) {
    if (derived[i] !== 0) { nonZero = true; break; }
  }
  if (!nonZero) {
    for (let i = 0; i < 44; i++) {
      derived[i] = (i * 0x6c62272e) & 0xff;
    }
  }

  // Additional diffusion pass — each byte influences the next
  for (let round = 0; round < 3; round++) {
    for (let i = 1; i < 44; i++) {
      derived[i] = ((derived[i] ^ derived[i - 1]) + 0x9e) & 0xff;
    }
    // Backward pass
    for (let i = 42; i >= 0; i--) {
      derived[i] = ((derived[i] ^ derived[i + 1]) + 0x37) & 0xff;
    }
  }

  return {
    key:   derived.slice(0, 32),
    nonce: derived.slice(32, 44),
  };
}

export class ChaCha20Rng {
  private readonly _key: Uint8Array;
  private readonly _nonce: Uint8Array;
  private _block: Uint8Array;
  private _blockPos: number;
  private _counter: number;

  constructor(seed: string) {
    const { key, nonce } = deriveKeyAndNonce(seed);
    this._key      = key;
    this._nonce    = nonce;
    this._counter  = 0;
    this._block    = chacha20Block(this._key, this._counter, this._nonce);
    this._blockPos = 0;
  }

  /** Consume 4 bytes from the current block, generating a new block if needed. */
  nextUint32(): number {
    if (this._blockPos + 4 > 64) {
      this._counter = (this._counter + 1) >>> 0;
      this._block    = chacha20Block(this._key, this._counter, this._nonce);
      this._blockPos = 0;
    }
    const v =
      (this._block[this._blockPos    ]      ) |
      (this._block[this._blockPos + 1] <<  8) |
      (this._block[this._blockPos + 2] << 16) |
      (this._block[this._blockPos + 3] << 24);
    this._blockPos += 4;
    return v >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  /**
   * Uniform integer in [min, max] — inclusive both ends.
   * Uses Lemire's nearly-divisionless rejection sampling to eliminate modulo bias.
   * BigInt is used for the 64-bit intermediate product to avoid precision loss.
   */
  nextInRange(min: number, max: number): number {
    if (min > max) throw new Error('nextInRange: min must be <= max');
    if (min === max) return min;

    const range = BigInt((max - min + 1) >>> 0);
    const TWO32 = BigInt(0x100000000);

    let x      = BigInt(this.nextUint32());
    let prod   = x * range;
    let hi     = prod / TWO32;       // high 32 bits = scaled result candidate
    let lo     = prod % TWO32;       // low  32 bits = leftover for rejection test

    if (lo < range) {
      // threshold = (2^32 - range) % range  (avoids division for common case)
      const threshold = (TWO32 - range) % range;
      while (lo < threshold) {
        x    = BigInt(this.nextUint32());
        prod = x * range;
        hi   = prod / TWO32;
        lo   = prod % TWO32;
      }
    }

    return min + Number(hi);
  }
}
