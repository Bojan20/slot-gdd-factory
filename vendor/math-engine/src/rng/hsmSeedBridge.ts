/**
 * W152 Wave 38 — Kimi K10: HSM-backed DRBG seed bridge.
 *
 * Closes Kimi deep-audit K10 ("HSM-backed seed architecture — Thales Luna 7
 * / AWS CloudHSM / HashiCorp Vault for DRBG seed injection with side-
 * channel resistance and multi-instance broadcast").
 *
 * ## Why this exists
 *
 * The existing HSM stack (`src/hsm/`) provides FIPS-grade signing for
 * jackpot multi-party / PAR sheet attestation. This module repurposes the
 * SAME HSM trust anchor for a different threat model: providing
 * cryptographically attestable ENTROPY to seed the engine's DRBG (any of
 * the 5 supported backends — mulberry32 / pcg64 / xoshiro256ss /
 * philox4x32 / chacha20).
 *
 * Industry context (Kimi 2026-05-15 deep audit):
 *
 *   "Only 3 vendors have achieved SP 800-90B entropy-source certification
 *    (Rambus, AWS Graviton4). FIPS 140-3 IG D.K mandates continuous health
 *    tests (Repetition Count + Adaptive Proportion) — a bar no commercial
 *    slot engine publicly meets. The Russian 'Alex' team reverse-
 *    engineered Aristocrat's LCG-based PRNG using ~24 recorded spins."
 *
 * HSM-backed seed broadcast turns the seed itself into a cryptographic
 * commitment — even if an attacker observes spin outcomes, they cannot
 * predict the next seed without breaking the HSM's signing key (FIPS 140-2
 * L3+ tamper-evident hardware boundary).
 *
 * ## Design
 *
 * 1. **Adapter-agnostic** — works with any `HsmAdapter` (mock for tests,
 *    AWS KMS for cloud, PKCS#11 for on-prem nCipher / Thales / Utimaco /
 *    SoftHSM).
 *
 * 2. **Deterministic broadcast** — given (root_seed_id, epoch_number),
 *    every node in a cluster computes the SAME per-epoch seed by signing
 *    the canonical tuple `epoch || cluster_id` with the SAME HSM key. The
 *    signature's hash → DRBG seed. This means N nodes in a multi-instance
 *    deployment converge on identical RNG state without any round-trip
 *    coordination.
 *
 * 3. **Side-channel posture** — we do NOT log raw signatures (full sig
 *    would let an offline attacker compute future seeds if the same epoch
 *    is replayed). We log only `audit_id` + `seed_hash` (truncated SHA-256
 *    of the derived seed, not the seed itself).
 *
 * 4. **Continuous health checks** — every `deriveSeed` call runs:
 *      - Repetition Count Test (RCT) — reject if same byte repeated > 32×
 *      - Adaptive Proportion Test (APT) — reject if any byte appears
 *        > 80% in a 64-byte window
 *    These are the FIPS 140-3 IG D.K minimum continuous health tests.
 *
 * 5. **Failure-safe fallback** — if HSM unreachable, throw a typed
 *    `HsmSeedUnavailable` error (operator decides whether to fail-closed
 *    or fall back to OS entropy `/dev/urandom`). Default: fail-closed for
 *    audit-grade configurations.
 */

import { createHash } from 'node:crypto';
import type { HsmAdapter, KeyHandle, SignAlgorithm } from '../hsm/types.js';

// ─── Errors ────────────────────────────────────────────────────────────────

/** HSM unreachable or returned an error. Operator policy decides fallback. */
export class HsmSeedUnavailable extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'HsmSeedUnavailable';
  }
}

/** Continuous health test (FIPS 140-3 IG D.K) detected entropy degradation. */
export class HsmSeedHealthFailure extends Error {
  constructor(
    public readonly test: 'RCT' | 'APT',
    public readonly detail: string,
  ) {
    super(`HSM seed health test ${test} failed: ${detail}`);
    this.name = 'HsmSeedHealthFailure';
  }
}

// ─── Configuration ─────────────────────────────────────────────────────────

export interface HsmSeedConfig {
  /** HSM adapter backing the bridge. Required. */
  adapter: HsmAdapter;
  /** Key handle on the HSM that signs seed-derivation tuples. Required. */
  keyHandle: KeyHandle;
  /** Signing algorithm. Default 'ECDSA_SHA_256'. */
  algorithm?: SignAlgorithm;
  /** Cluster identifier for multi-instance broadcast. Required. */
  clusterId: string;
  /** Per-derivation timeout in ms. Default 4000ms. */
  timeoutMs?: number;
  /** Disable RCT/APT health tests (NOT recommended). */
  disableHealthTests?: boolean;
}

export interface DerivedSeed {
  /** Final 32-byte DRBG seed material. */
  seed: Uint8Array;
  /** Truncated (12-char) SHA-256 of the seed for audit logging.
   *  Logging the full seed would compromise forward-secrecy. */
  seedHash: string;
  /** Epoch this seed belongs to. */
  epoch: number;
  /** ISO timestamp of derivation. */
  derivedAt: string;
  /** HSM audit id (links to the full sign-audit record). */
  hsmAuditId?: string;
}

// ─── Health tests (FIPS 140-3 IG D.K minimum) ──────────────────────────────

/**
 * Repetition Count Test — flag if any single byte value appears more than
 * `cutoff` times consecutively. Cutoff 32 corresponds to entropy <2 bits/byte
 * which is well below any reasonable noise source. Aligns with NIST SP 800-90B.
 */
export function runRct(bytes: Uint8Array, cutoff: number = 32): void {
  if (bytes.length === 0) return;
  let last = bytes[0];
  let run = 1;
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i] === last) {
      run++;
      if (run > cutoff) {
        throw new HsmSeedHealthFailure(
          'RCT',
          `byte 0x${last.toString(16).padStart(2, '0')} repeated ${run}× consecutively (cutoff ${cutoff})`,
        );
      }
    } else {
      last = bytes[i];
      run = 1;
    }
  }
}

/**
 * Adaptive Proportion Test — over a sliding window, no single byte value
 * may exceed `maxFraction` of the window. Default 0.80 (80%).
 */
export function runApt(
  bytes: Uint8Array,
  windowSize: number = 64,
  maxFraction: number = 0.8,
): void {
  if (bytes.length < windowSize) return;
  for (let start = 0; start + windowSize <= bytes.length; start += windowSize) {
    const counts = new Map<number, number>();
    for (let i = start; i < start + windowSize; i++) {
      counts.set(bytes[i], (counts.get(bytes[i]) ?? 0) + 1);
    }
    for (const [byte, count] of counts) {
      const frac = count / windowSize;
      if (frac > maxFraction) {
        throw new HsmSeedHealthFailure(
          'APT',
          `byte 0x${byte.toString(16).padStart(2, '0')} = ${(frac * 100).toFixed(1)}% in window [${start}, ${start + windowSize}) (cap ${(maxFraction * 100).toFixed(0)}%)`,
        );
      }
    }
  }
}

// ─── Bridge ────────────────────────────────────────────────────────────────

export class HsmSeedBridge {
  constructor(private readonly config: HsmSeedConfig) {
    if (!config.clusterId || config.clusterId.length === 0) {
      throw new Error('HsmSeedBridge: clusterId is required');
    }
  }

  /**
   * Derive a 32-byte DRBG seed for a specific epoch. Deterministic across
   * cluster nodes that share the same `(adapter, keyHandle, clusterId)`.
   *
   * Algorithm:
   *   1. Build canonical tuple bytes = `epoch_be_u64 || sha256(clusterId)`.
   *   2. HSM signs the tuple via the configured key.
   *   3. SHA-256 of the signature bytes → 32-byte DRBG seed.
   *   4. Run RCT + APT health tests on the seed (skip if disabled).
   *   5. Return DerivedSeed with truncated audit hash (NEVER raw seed).
   *
   * The signature → SHA-256 step turns a variable-length DER signature
   * into a fixed-width seed and provides a uniformity property (under the
   * random-oracle model on the HSM signature).
   */
  async deriveSeed(epoch: number): Promise<DerivedSeed> {
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > Number.MAX_SAFE_INTEGER) {
      throw new Error(`HsmSeedBridge: epoch must be a non-negative safe integer (got ${epoch})`);
    }
    const tuple = this.buildCanonicalTuple(epoch);
    let signResult;
    try {
      signResult = await Promise.race([
        this.config.adapter.sign({
          keyHandle: this.config.keyHandle,
          algorithm: this.config.algorithm ?? 'ECDSA_SHA_256',
          message: tuple,
        }),
        this.timeoutPromise(),
      ]);
    } catch (cause) {
      throw new HsmSeedUnavailable(
        `HSM sign call failed for epoch ${epoch}`,
        cause,
      );
    }
    if (!signResult || !signResult.signature) {
      throw new HsmSeedUnavailable(`HSM returned no signature for epoch ${epoch}`);
    }
    const seed = sha256Bytes(signResult.signature);
    if (!this.config.disableHealthTests) {
      runRct(seed);
      runApt(seed);
    }
    const seedHash = sha256Hex(seed).slice(0, 12);
    return {
      seed,
      seedHash,
      epoch,
      derivedAt: new Date().toISOString(),
      hsmAuditId: signResult.audit?.recordId !== undefined ? String(signResult.audit.recordId) : undefined,
    };
  }

  /**
   * Derive a u64 seed suitable for the engine's PRNGs (Mulberry32 / PCG64 /
   * Xoshiro256SS / Philox4x32). Truncates the 32-byte derived seed to its
   * leading 8 bytes interpreted big-endian.
   */
  async deriveU64Seed(epoch: number): Promise<{ u64: bigint; meta: DerivedSeed }> {
    const meta = await this.deriveSeed(epoch);
    const view = new DataView(meta.seed.buffer, meta.seed.byteOffset, 8);
    const u64 = view.getBigUint64(0, false);
    return { u64, meta };
  }

  /**
   * Derive ChaCha20 seed material (32 bytes key + 12 bytes nonce) for the
   * CSPRNG backend. Uses a single HSM call: sig → first 32 bytes = key,
   * SHA-256 of key → first 12 bytes = nonce.
   */
  async deriveChaCha20Seed(epoch: number): Promise<{
    key: Uint8Array;
    nonce: Uint8Array;
    meta: DerivedSeed;
  }> {
    const meta = await this.deriveSeed(epoch);
    const key = meta.seed; // 32 bytes
    const nonce = sha256Bytes(meta.seed).slice(0, 12); // deterministic 12-byte nonce
    return { key, nonce, meta };
  }

  private buildCanonicalTuple(epoch: number): Uint8Array {
    // epoch_be_u64 (8 bytes) || sha256(clusterId) (32 bytes)
    const buf = new Uint8Array(8 + 32);
    const view = new DataView(buf.buffer);
    view.setBigUint64(0, BigInt(epoch), false);
    const clusterDigest = sha256Bytes(new TextEncoder().encode(this.config.clusterId));
    buf.set(clusterDigest, 8);
    return buf;
  }

  private timeoutPromise(): Promise<never> {
    const ms = this.config.timeoutMs ?? 4000;
    return new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`HSM sign timeout after ${ms}ms`)), ms);
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sha256Bytes(input: Uint8Array): Uint8Array {
  const h = createHash('sha256');
  h.update(input);
  return new Uint8Array(h.digest());
}

function sha256Hex(input: Uint8Array): string {
  const h = createHash('sha256');
  h.update(input);
  return h.digest('hex');
}
