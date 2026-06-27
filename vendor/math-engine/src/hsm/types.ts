/**
 * P0 #10 — Hardware Security Module (HSM) Bridge Types
 *
 * Defines the abstract surface every HSM adapter must implement so the
 * signing / attestation pipeline is provider-agnostic. The same `Signer`
 * works against AWS KMS, Azure Key Vault, on-prem nCipher (via PKCS#11),
 * SoftHSM (CI), or the deterministic in-memory mock (unit tests).
 *
 * ## Why this exists
 *
 * UK Gambling Commission, MGA (Malta), and German GlüNeuRStV all require
 * that the signing key used to attest RNG drawings / PAR sheets / spin
 * proofs **never leaves a FIPS 140-2 Level 3 (or higher) device**. The
 * engine itself never holds private key material — it submits hash inputs
 * and gets signatures back.
 *
 * ## Design rules
 *
 * 1. **Never expose private keys.** The adapter holds a `KeyHandle`, not
 *    raw bytes. The mock adapter is the only exception (test-only).
 * 2. **Failures are typed.** `HsmError` distinguishes transient (retry-
 *    able) from permanent (don't retry, fail commit).
 * 3. **Operations are auditable.** Every `sign` call must produce an
 *    `AuditRecord` even on failure.
 * 4. **Algorithms are explicit.** The signer specifies the algorithm; the
 *    adapter either supports it or returns `UnsupportedAlgorithm`.
 * 5. **Deterministic test mode.** The mock adapter derives its keypair
 *    from a seed so test vectors are reproducible across hosts.
 */

import type { z } from 'zod';

// ─── Algorithms ──────────────────────────────────────────────────────────────

/**
 * Signing algorithms the bridge supports. The set is intentionally narrow:
 * each is FIPS 140-2 approved and supported by every major cloud HSM and
 * PKCS#11 implementation.
 */
export type SignAlgorithm =
  | 'ECDSA_SHA_256' // P-256 NIST + SHA-256. Default for new deployments.
  | 'ECDSA_SHA_384' // P-384 + SHA-384. Higher security margin.
  | 'RSASSA_PSS_SHA_256' // RSA-2048+ PSS with SHA-256. Legacy operator support.
  | 'RSASSA_PKCS1_V1_5_SHA_256'; // PKCS#1 v1.5 (deprecated; legacy operators).

/** Named curves accepted by ECDSA algorithms. */
export type EcCurve = 'P-256' | 'P-384';

// ─── Key handles ─────────────────────────────────────────────────────────────

/**
 * Opaque reference to a key inside an HSM. The string format is adapter-
 * specific:
 *
 *   - AWS KMS  → `arn:aws:kms:eu-west-1:123:key/abcd-…` or `alias/foo`
 *   - Azure KV → `https://<vault>.vault.azure.net/keys/<name>/<version>`
 *   - PKCS#11  → `pkcs11:token=…;object=…;type=private`
 *   - Mock     → `mock-key:<id>`
 *
 * The caller must never parse the string — only pass it back to the
 * adapter that issued it.
 */
export interface KeyHandle {
  readonly id: string;
  readonly algorithm: SignAlgorithm;
  /** Whether the corresponding public key is exportable from the HSM. */
  readonly publicKeyExportable: boolean;
  /** Adapter-private opaque payload (kept for adapters to round-trip context). */
  readonly opaque?: unknown;
}

// ─── Requests / responses ────────────────────────────────────────────────────

/**
 * A signing request. The bridge **pre-hashes** the message before sending
 * to the HSM when the algorithm requires it, but for FIPS-mode AWS KMS we
 * pass the raw message and let the device hash. Both paths produce the
 * same signature for the same input.
 */
export interface SignRequest {
  /** Which key to use. */
  keyHandle: KeyHandle;
  /** Message to sign (raw bytes; engine has already canonicalized JSON). */
  message: Uint8Array;
  /** Algorithm; must equal `keyHandle.algorithm` (we check). */
  algorithm: SignAlgorithm;
  /** Optional context — written to the audit log only. */
  context?: Record<string, string>;
}

export interface SignResponse {
  /** DER-encoded signature for ECDSA, or PKCS#1/PSS for RSA. */
  signature: Uint8Array;
  /** Algorithm used (echoed back; should equal the request). */
  algorithm: SignAlgorithm;
  /** Public key in SubjectPublicKeyInfo DER, IF the HSM allows export. */
  publicKey?: Uint8Array;
  /** Audit record — caller must persist this. */
  audit: AuditRecord;
}

export interface VerifyRequest {
  /** Public key (SubjectPublicKeyInfo DER) of the signer. */
  publicKey: Uint8Array;
  /** Message that was signed. */
  message: Uint8Array;
  /** Signature to check. */
  signature: Uint8Array;
  /** Algorithm. */
  algorithm: SignAlgorithm;
}

export interface VerifyResponse {
  valid: boolean;
  /** If invalid, a one-line human-readable reason. */
  reason?: string;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * One row in the append-only HSM audit log. Compliance regimes (UKGC,
 * MGA, GLI-19) require non-repudiable per-operation records. The log is
 * write-only — never mutated, only appended.
 */
export interface AuditRecord {
  /** Monotonic record id within the audit log file. */
  recordId: number;
  /** Epoch ms when the operation was attempted. */
  timestampMs: number;
  /** Which adapter handled it (e.g. `aws-kms`, `pkcs11`, `mock`). */
  adapter: string;
  /** Operation kind. */
  operation: 'sign' | 'verify' | 'key_create' | 'key_describe';
  /** Key id (handle.id). For `verify` operations, the public-key hash. */
  keyId: string;
  /** Algorithm used. */
  algorithm: SignAlgorithm;
  /** SHA-256 of the message (NOT the message itself — avoid logging PII). */
  messageHashHex: string;
  /** Outcome. */
  outcome: 'success' | 'failure';
  /** If failure, the error code (mapped from `HsmError`). */
  errorCode?: HsmErrorCode;
  /** Latency of the underlying HSM call in ms. */
  latencyMs: number;
  /** Optional free-form context from the caller (engine spin id, etc.). */
  context?: Record<string, string>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type HsmErrorCode =
  | 'KeyNotFound'
  | 'AccessDenied'
  | 'NetworkTimeout'
  | 'ConnectionRefused'
  | 'UnsupportedAlgorithm'
  | 'InvalidSignature'
  | 'InvalidKey'
  | 'CryptoFailure'
  | 'AdapterUnavailable'
  | 'RateLimited'
  | 'AuditWriteFailure';

export class HsmError extends Error {
  readonly code: HsmErrorCode;
  readonly transient: boolean;
  readonly cause?: unknown;

  constructor(code: HsmErrorCode, message: string, opts: { transient?: boolean; cause?: unknown } = {}) {
    super(`[${code}] ${message}`);
    this.name = 'HsmError';
    this.code = code;
    this.transient = opts.transient ?? false;
    this.cause = opts.cause;
  }
}

/** Map of which error codes are transient (worth a retry). */
export const TRANSIENT_CODES: ReadonlySet<HsmErrorCode> = new Set([
  'NetworkTimeout',
  'ConnectionRefused',
  'RateLimited',
]);

// ─── Adapter contract ────────────────────────────────────────────────────────

/**
 * Every HSM provider implements this. Methods are async; the bridge
 * applies retry / timeout / circuit-breaker policy externally — adapters
 * do NOT implement their own retry loops (single-shot only).
 */
export interface HsmAdapter {
  /** Stable adapter name written to audit logs (`aws-kms`, `pkcs11`, …). */
  readonly name: string;

  /** Whether this adapter is operational right now (network reachable,
   *  PKCS#11 module loaded, etc.). Synchronous heuristic — does NOT
   *  perform a network round-trip on every call. */
  isAvailable(): boolean;

  /** Look up a key handle by adapter-specific id. */
  describeKey(id: string): Promise<KeyHandle>;

  /** Sign a message. Returns the signature + audit record. */
  sign(req: SignRequest): Promise<SignResponse>;

  /** Verify a signature. Verification is OFFLINE — does not touch the HSM
   *  for the mock / AWS path (uses pure-JS @noble/curves). Some PKCS#11
   *  paths do call the device. Returns `{valid:false}` for any failure
   *  mode that maps to "signature is wrong"; throws `HsmError` only for
   *  transport / config problems. */
  verify(req: VerifyRequest): Promise<VerifyResponse>;
}

// ─── Audit-log writer interface ──────────────────────────────────────────────

/**
 * Audit log persistence. Implementations append synchronously and flush
 * to durable storage before returning. Writers are intentionally tiny —
 * the engine ships a JSONL file writer (`JsonlAuditLog`) for the
 * default case; operators can plug their own (S3, Splunk, etc.).
 */
export interface AuditLog {
  append(record: AuditRecord): Promise<void>;
  /** Read records sequentially. For audit playback / reconciliation. */
  read(): AsyncIterable<AuditRecord>;
  /** Total records written (cheap counter — does NOT scan the log). */
  size(): Promise<number>;
}

// ─── Validation schemas (re-exported from Zod at runtime if desired) ─────────

/** Marker — the actual schema lives in `./schemas.ts` (lazy import to keep
 *  this types file zero-dep). */
export type SignRequestSchemaType = SignRequest;
export type VerifyRequestSchemaType = VerifyRequest;

// Re-export hint so consumers can `import type {z} from 'zod'` if they
// need to write schemas at call sites. (Tree-shaken away in production.)
export type ZodAlias = z.ZodTypeAny;
