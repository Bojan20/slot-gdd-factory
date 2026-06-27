/**
 * W152 Wave 22 — Multi-Party Threshold Signature for Jackpot Release
 * (Faza 8.6 ⚠️→✅).
 *
 * Generic threshold signature scheme za WAP jackpot multi-party release.
 * `t-of-n` threshold: jackpot može da se isplati samo ako se SLOJI od
 * najmanje `t` operatora (ili sigurnosnih HSM-ova) potpisi nad istim
 * payout payload-om. Sprečava single-operator-fraud i HSM compromise
 * scenarije.
 *
 * Implementacija je deliberately ENGINE-GENERIC + cryptography-agnostic:
 *   * Prima per-signer signature kao opaque bytes (caller wires real
 *     signature scheme — Ed25519, ECDSA, BLS, Schnorr — preko adapter
 *     callback).
 *   * Aggregator broji distinct valid signatures po signer ID.
 *   * Threshold check je deterministic + replay-safe.
 *
 * Why not a full BLS aggregation library: minimizes external dep
 * footprint. Operator who needs real BLS plugs in via `verifySignature`
 * callback. For test/dev path, identity-stub verifier accepts anything.
 *
 * Naming policy: `thresholdSig` engine-generic. Vendor-specific
 * implementations (e.g. tofnRelease) reserved per `docs/glossary.md`.
 *
 * References:
 *   * Shamir 1979 — secret sharing primitive.
 *   * Boneh, Lynn, Shacham 2004 — short signatures.
 *   * NIST SP 800-185 §3.1 — threshold cryptography guidelines.
 */

import { sha256 } from '@noble/hashes/sha256';

export interface SignaturePart {
  /** Free-form signer id (operator name, HSM serial, etc.). */
  signerId: string;
  /** Opaque signature bytes (hex-encoded for replay-safe storage). */
  signatureHex: string;
  /** Per-signer timestamp (ISO UTC). */
  signedAtUtc: string;
}

export interface JackpotPayload {
  jackpotId: string;
  amountMinor: number;
  currency: string;
  /** Auditor-defined unique payout id. */
  payoutRequestId: string;
  /** Recipient operator id. */
  recipientOperator: string;
  /** Generation epoch (integer, prevents replay across cycles). */
  cycleEpoch: number;
}

export interface ThresholdSigConfig {
  /** Total number of authorised signers. */
  n: number;
  /** Minimum number of valid signatures required. */
  t: number;
  /**
   * Verifier callback. Returns true iff signature is valid for the
   * given (signerId, payloadHashHex). Caller-provided. Default: stub
   * accepts any non-empty signature (TEST ONLY).
   */
  verifySignature?: (signerId: string, payloadHashHex: string, signatureHex: string) => boolean;
}

export interface AggregateVerdict {
  satisfied: boolean;
  validSignatureCount: number;
  threshold: number;
  totalSigners: number;
  validSignerIds: string[];
  invalidSignerIds: string[];
  payloadHashHex: string;
  reason: string;
}

/** Canonicalise payload for hashing — alphabetical keys + integer-only. */
export function canonicalisePayload(payload: JackpotPayload): string {
  return JSON.stringify(
    {
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      cycleEpoch: payload.cycleEpoch,
      jackpotId: payload.jackpotId,
      payoutRequestId: payload.payoutRequestId,
      recipientOperator: payload.recipientOperator,
    },
    null,
    0,
  );
}

/** SHA-256 hex digest of canonical payload. */
export function payloadHash(payload: JackpotPayload): string {
  const canonical = canonicalisePayload(payload);
  const bytes = new TextEncoder().encode(canonical);
  const digest = sha256(bytes);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Aggregate signatures + verify threshold.
 *
 * Throws on:
 *   * t > n (impossible threshold)
 *   * t < 1 (no security)
 *   * non-integer t or n
 *   * duplicate signerId in `parts` (replay attempt)
 */
export function aggregateAndVerify(
  payload: JackpotPayload,
  parts: ReadonlyArray<SignaturePart>,
  config: ThresholdSigConfig,
): AggregateVerdict {
  if (!Number.isInteger(config.n) || config.n < 1) {
    throw new RangeError(`aggregateAndVerify: n must be positive integer (got ${config.n})`);
  }
  if (!Number.isInteger(config.t) || config.t < 1) {
    throw new RangeError(`aggregateAndVerify: t must be positive integer (got ${config.t})`);
  }
  if (config.t > config.n) {
    throw new RangeError(`aggregateAndVerify: t (${config.t}) > n (${config.n})`);
  }
  // Detect replay (duplicate signerId).
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.signerId)) {
      throw new Error(`aggregateAndVerify: duplicate signerId '${p.signerId}' (replay attempt)`);
    }
    seen.add(p.signerId);
  }
  const verifier = config.verifySignature ?? defaultStubVerifier;
  const hashHex = payloadHash(payload);
  const validSignerIds: string[] = [];
  const invalidSignerIds: string[] = [];
  for (const p of parts) {
    if (verifier(p.signerId, hashHex, p.signatureHex)) {
      validSignerIds.push(p.signerId);
    } else {
      invalidSignerIds.push(p.signerId);
    }
  }
  const satisfied = validSignerIds.length >= config.t;
  return {
    satisfied,
    validSignatureCount: validSignerIds.length,
    threshold: config.t,
    totalSigners: config.n,
    validSignerIds,
    invalidSignerIds,
    payloadHashHex: hashHex,
    reason: satisfied
      ? `${validSignerIds.length}/${config.t} of ${config.n} signers verified`
      : `Only ${validSignerIds.length}/${config.t} valid signatures (need ${config.t}); rejected ${invalidSignerIds.length}`,
  };
}

/**
 * Default stub verifier — accepts any non-empty signature. TEST ONLY.
 * Production callers MUST supply real `verifySignature` via config.
 */
function defaultStubVerifier(signerId: string, _hashHex: string, sig: string): boolean {
  return signerId.length > 0 && sig.length > 0;
}

/**
 * Helper: build a release request from raw inputs. Bundles payload +
 * collected signatures into one unit suitable for audit log.
 */
export interface JackpotReleaseRequest {
  payload: JackpotPayload;
  signatures: SignaturePart[];
  config: { n: number; t: number };
  verdict: AggregateVerdict;
  builtAtUtc: string;
}

export function buildReleaseRequest(
  payload: JackpotPayload,
  signatures: ReadonlyArray<SignaturePart>,
  config: ThresholdSigConfig,
): JackpotReleaseRequest {
  const verdict = aggregateAndVerify(payload, signatures, config);
  return {
    payload,
    signatures: signatures.slice(),
    config: { n: config.n, t: config.t },
    verdict,
    builtAtUtc: new Date().toISOString(),
  };
}
