/**
 * W152 P2-11 — RGS auth signers.
 *
 * Per KIMI 13 (`docs/W152/13-rgs-integration-protocols.md`), the
 * authentication layer is fragmented across the major RGS providers:
 *   * CasinoWebScripts: HMAC-SHA256 with shared secret.
 *   * Hub88: RSA-SHA256 signature over canonicalised payload.
 *   * Capermint / Stake Engine: JWT (HS256 or RS256).
 *
 * Rather than baking one in, the engine accepts a pluggable
 * `AuthSigner` and ships three reference impls. Integrators swap the
 * signer through dependency injection in `RgsProtocol`.
 */

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

/** Common signer contract. */
export interface AuthSigner {
  /** Produce signature bytes for a canonical request body. */
  sign(payload: Uint8Array): Promise<Uint8Array>;
  /** Verify a signature against the original payload. */
  verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean>;
  /** Stable identifier emitted into audit log. */
  readonly schemeId: string;
}

// ─── HMAC-SHA256 (CWS pattern) ─────────────────────────────────────────────

/**
 * `HmacSha256Signer` — the CWS reference pattern. Both producer and
 * verifier share the same secret. Constant-time comparison protects
 * against timing-based secret extraction.
 */
export class HmacSha256Signer implements AuthSigner {
  readonly schemeId = 'hmac-sha256';
  private readonly secret: Uint8Array;

  constructor(secret: Uint8Array) {
    if (secret.length < 32) {
      throw new Error('HmacSha256Signer: shared secret must be ≥ 32 bytes');
    }
    this.secret = secret;
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return hmac(sha256, this.secret, payload);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const expected = await this.sign(payload);
    if (expected.length !== signature.length) return false;
    // Constant-time compare — bitwise OR then zero-check.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i] ^ signature[i];
    }
    return diff === 0;
  }
}

// ─── JWT signer scaffold ──────────────────────────────────────────────────

/**
 * `JwtHs256Signer` — JWT (RFC 7519) using HMAC-SHA256 inner primitive.
 * Produces and verifies the `signature` portion of a compact JWT only
 * (the caller assembles the `header.payload.signature` string). Keeps
 * the signer focused — header/payload encoding is JWT-library
 * territory.
 */
export class JwtHs256Signer implements AuthSigner {
  readonly schemeId = 'jwt-hs256';
  private readonly hmac: HmacSha256Signer;

  constructor(secret: Uint8Array) {
    this.hmac = new HmacSha256Signer(secret);
  }

  /** Returns the raw HMAC-SHA256(header_b64url . payload_b64url) bytes. */
  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return this.hmac.sign(payload);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return this.hmac.verify(payload, signature);
  }
}

// ─── RSA-SHA256 signer (Hub88 pattern) — INJECTED ─────────────────────────

/**
 * RSA-SHA256 signer wired through a caller-supplied key handle. We do
 * NOT depend on a specific RSA library here — the Node `crypto` module
 * is the canonical path but it pulls a CJS / ESM hybrid that is
 * heavyweight for browser-friendly templates. Integrators supply
 * `sign` / `verify` callbacks that wrap their RSA implementation
 * (Node `crypto.sign` / WebCrypto `SubtleCrypto.sign`).
 *
 * The Hub88 spec mandates the input be the **canonicalised** JSON
 * (sorted keys, no whitespace) — the caller MUST canonicalise before
 * calling `sign`. The signer itself is canonicalisation-agnostic.
 */
export class RsaSha256Signer implements AuthSigner {
  readonly schemeId = 'rsa-sha256';

  constructor(
    private readonly impl: {
      sign(payload: Uint8Array): Promise<Uint8Array>;
      verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean>;
    },
  ) {}

  sign(payload: Uint8Array): Promise<Uint8Array> {
    return this.impl.sign(payload);
  }

  verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return this.impl.verify(payload, signature);
  }
}

// ─── Canonical JSON encoder (helper for signers) ───────────────────────────

/**
 * Stable JSON encoding for signature input. Keys sorted
 * lexicographically at every nesting level, no whitespace, ASCII-only
 * escapes. Hub88 / many RGS specs require this exact shape so the
 * sender and verifier compute the same byte string.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}
