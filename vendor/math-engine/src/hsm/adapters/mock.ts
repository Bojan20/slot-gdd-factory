/**
 * In-memory HSM mock adapter.
 *
 * Backed by `@noble/curves` (audited pure-JS implementations of P-256 /
 * P-384) and Node's built-in `crypto` for RSA. The private key never
 * touches the disk in this adapter — it lives in a per-instance map.
 *
 * ## Determinism
 *
 * When constructed with `{ seed: '...' }` the adapter derives its key
 * material via SHA-256(seed || keyId). Two `MockHsmAdapter` instances
 * with the same seed produce IDENTICAL signatures for the same input.
 * This is essential for known-answer tests that have to reproduce on
 * any CI runner.
 *
 * ## NOT a real HSM
 *
 * This adapter is for **unit tests and local dev only**. Production
 * deployments MUST use `AwsKmsAdapter`, `AzureKvAdapter`, or
 * `Pkcs11Adapter`. We mark the adapter name as `mock` so it's
 * unmistakable in audit logs (regulator audit kits filter on
 * `adapter != 'mock'` to flag any prod usage).
 */

import * as nodeCrypto from 'node:crypto';
import { p256 } from '@noble/curves/p256';
import { p384 } from '@noble/curves/p384';
import { sha256 } from '@noble/hashes/sha2';
import {
  HsmError,
  type AuditRecord,
  type HsmAdapter,
  type KeyHandle,
  type SignAlgorithm,
  type SignRequest,
  type SignResponse,
  type VerifyRequest,
  type VerifyResponse,
} from '../types.js';

// ─── Internal storage ────────────────────────────────────────────────────────

interface StoredKey {
  handle: KeyHandle;
  /** For ECDSA: raw 32-byte (P-256) or 48-byte (P-384) private scalar.
   *  For RSA: PEM-encoded PKCS#8 private key. */
  privateKey: Uint8Array | string;
  /** Cached SubjectPublicKeyInfo DER for export. */
  publicKeyDer: Uint8Array;
}

export interface MockHsmConfig {
  /**
   * If present, key material is derived deterministically from this seed.
   * If absent, every `createKey` call generates fresh entropy.
   *
   * Tests should pin this for reproducible signature vectors.
   */
  seed?: string;
  /** Pretend the HSM is unavailable (used for circuit-breaker tests). */
  forceUnavailable?: boolean;
  /** Inject latency in ms on every operation (used for timeout tests). */
  injectLatencyMs?: number;
  /** Throw this error on the next op (used for transient-failure tests). */
  failNextWith?: HsmError;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a deterministic scalar of `len` bytes from `seed || keyId`. */
function deriveScalar(seed: string, keyId: string, len: number): Uint8Array {
  // For P-256 (32 bytes) one SHA-256 is sufficient. For P-384 (48 bytes)
  // we use a HKDF-like two-block expansion so the scalars are
  // domain-separated and pass curve-validity checks.
  const hash = sha256(new TextEncoder().encode(`${seed}|${keyId}`));
  if (len === 32) return hash;
  if (len === 48) {
    const second = sha256(new TextEncoder().encode(`${seed}|${keyId}|2`));
    const out = new Uint8Array(48);
    out.set(hash, 0);
    out.set(second.slice(0, 16), 32);
    // Ensure the scalar is < curve order — for tests this is overwhelmingly
    // likely, but we clamp the top bit to be safe.
    out[0] &= 0x7f;
    return out;
  }
  throw new HsmError('CryptoFailure', `unsupported scalar length: ${len}`);
}

function curveFor(alg: SignAlgorithm): typeof p256 | typeof p384 {
  if (alg === 'ECDSA_SHA_256') return p256;
  if (alg === 'ECDSA_SHA_384') return p384;
  throw new HsmError('UnsupportedAlgorithm', `not an ECDSA algorithm: ${alg}`);
}

function hashFor(alg: SignAlgorithm): 'sha256' | 'sha384' {
  if (alg === 'ECDSA_SHA_256' || alg === 'RSASSA_PSS_SHA_256' || alg === 'RSASSA_PKCS1_V1_5_SHA_256') {
    return 'sha256';
  }
  if (alg === 'ECDSA_SHA_384') return 'sha384';
  throw new HsmError('UnsupportedAlgorithm', `unknown algorithm: ${alg}`);
}

function digest(alg: SignAlgorithm, msg: Uint8Array): Uint8Array {
  const h = nodeCrypto.createHash(hashFor(alg));
  h.update(msg);
  return new Uint8Array(h.digest());
}

function sha256Hex(msg: Uint8Array): string {
  return nodeCrypto.createHash('sha256').update(msg).digest('hex');
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class MockHsmAdapter implements HsmAdapter {
  readonly name = 'mock';
  private readonly keys = new Map<string, StoredKey>();
  private readonly cfg: MockHsmConfig;
  private auditCounter = 0;

  constructor(cfg: MockHsmConfig = {}) {
    this.cfg = cfg;
  }

  isAvailable(): boolean {
    return !this.cfg.forceUnavailable;
  }

  /**
   * Test-only helper: create a key inside the mock with the given id. The
   * key material is derived from `cfg.seed` if set, else freshly
   * generated.
   */
  createKey(id: string, algorithm: SignAlgorithm): KeyHandle {
    if (this.keys.has(id)) {
      throw new HsmError('CryptoFailure', `key already exists: ${id}`);
    }
    const handle: KeyHandle = {
      id: `mock-key:${id}`,
      algorithm,
      publicKeyExportable: true,
    };

    if (algorithm === 'ECDSA_SHA_256' || algorithm === 'ECDSA_SHA_384') {
      const curve = curveFor(algorithm);
      const len = algorithm === 'ECDSA_SHA_256' ? 32 : 48;
      let priv: Uint8Array;
      if (this.cfg.seed !== undefined) {
        priv = deriveScalar(this.cfg.seed, id, len);
        // Reject the (vanishingly unlikely) zero scalar.
        if (priv.every((b) => b === 0)) {
          throw new HsmError('CryptoFailure', `derived zero scalar for key ${id}`);
        }
      } else {
        priv = curve.utils.randomPrivateKey();
      }
      const pub = curve.getPublicKey(priv, false); // uncompressed 0x04 || x || y
      const publicKeyDer = ecPubKeyToSpkiDer(pub, algorithm);
      this.keys.set(id, { handle, privateKey: priv, publicKeyDer });
      return handle;
    }

    if (algorithm === 'RSASSA_PSS_SHA_256' || algorithm === 'RSASSA_PKCS1_V1_5_SHA_256') {
      // RSA keypair: 2048-bit by default; deterministic via seeded PRNG
      // is impossible with Node's `generateKeyPair`, so seeded mode just
      // generates fresh material (documented limitation).
      const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicExponent: 0x10001,
      });
      const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
      const pubDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
      this.keys.set(id, { handle, privateKey: privPem, publicKeyDer: new Uint8Array(pubDer) });
      return handle;
    }

    throw new HsmError('UnsupportedAlgorithm', `unknown algorithm: ${algorithm}`);
  }

  async describeKey(id: string): Promise<KeyHandle> {
    await this.applyInjections();
    if (!this.isAvailable()) {
      throw new HsmError('AdapterUnavailable', 'mock HSM is offline');
    }
    const stripped = id.startsWith('mock-key:') ? id.slice('mock-key:'.length) : id;
    const k = this.keys.get(stripped);
    if (!k) throw new HsmError('KeyNotFound', `key not found: ${id}`);
    return k.handle;
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    const started = Date.now();
    const messageHashHex = sha256Hex(req.message);
    try {
      await this.applyInjections();
      if (!this.isAvailable()) {
        throw new HsmError('AdapterUnavailable', 'mock HSM is offline');
      }
      if (req.algorithm !== req.keyHandle.algorithm) {
        throw new HsmError(
          'UnsupportedAlgorithm',
          `request algorithm ${req.algorithm} != key algorithm ${req.keyHandle.algorithm}`,
        );
      }
      const stripped = req.keyHandle.id.startsWith('mock-key:')
        ? req.keyHandle.id.slice('mock-key:'.length)
        : req.keyHandle.id;
      const k = this.keys.get(stripped);
      if (!k) throw new HsmError('KeyNotFound', `key not found: ${req.keyHandle.id}`);

      let signature: Uint8Array;
      if (req.algorithm === 'ECDSA_SHA_256' || req.algorithm === 'ECDSA_SHA_384') {
        const curve = curveFor(req.algorithm);
        const h = digest(req.algorithm, req.message);
        const sig = curve.sign(h, k.privateKey as Uint8Array, {
          // Low-S form per RFC 6979 — required by some operators (BTC/ETH-style canonicalization).
          lowS: true,
        });
        signature = sig.toDERRawBytes();
      } else {
        // RSA PSS / PKCS#1 v1.5
        const pad =
          req.algorithm === 'RSASSA_PSS_SHA_256'
            ? nodeCrypto.constants.RSA_PKCS1_PSS_PADDING
            : nodeCrypto.constants.RSA_PKCS1_PADDING;
        const signer = nodeCrypto.createSign('sha256');
        signer.update(req.message);
        const sig = signer.sign({
          key: k.privateKey as string,
          padding: pad,
          ...(req.algorithm === 'RSASSA_PSS_SHA_256' ? { saltLength: 32 } : {}),
        });
        signature = new Uint8Array(sig);
      }

      const audit: AuditRecord = {
        recordId: ++this.auditCounter,
        timestampMs: Date.now(),
        adapter: this.name,
        operation: 'sign',
        keyId: req.keyHandle.id,
        algorithm: req.algorithm,
        messageHashHex,
        outcome: 'success',
        latencyMs: Date.now() - started,
        context: req.context,
      };
      return { signature, algorithm: req.algorithm, publicKey: k.publicKeyDer, audit };
    } catch (err) {
      const hsmErr = err instanceof HsmError ? err : new HsmError('CryptoFailure', String(err), { cause: err });
      const audit: AuditRecord = {
        recordId: ++this.auditCounter,
        timestampMs: Date.now(),
        adapter: this.name,
        operation: 'sign',
        keyId: req.keyHandle.id,
        algorithm: req.algorithm,
        messageHashHex,
        outcome: 'failure',
        errorCode: hsmErr.code,
        latencyMs: Date.now() - started,
        context: req.context,
      };
      // We still throw — caller decides whether to surface the audit record.
      (hsmErr as HsmError & { audit?: AuditRecord }).audit = audit;
      throw hsmErr;
    }
  }

  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    await this.applyInjections();
    try {
      if (req.algorithm === 'ECDSA_SHA_256' || req.algorithm === 'ECDSA_SHA_384') {
        const curve = curveFor(req.algorithm);
        const h = digest(req.algorithm, req.message);
        const rawPub = spkiDerToEcPubKey(req.publicKey, req.algorithm);
        const ok = curve.verify(req.signature, h, rawPub);
        return ok ? { valid: true } : { valid: false, reason: 'ECDSA verify rejected signature' };
      }
      // RSA paths
      const pad =
        req.algorithm === 'RSASSA_PSS_SHA_256'
          ? nodeCrypto.constants.RSA_PKCS1_PSS_PADDING
          : nodeCrypto.constants.RSA_PKCS1_PADDING;
      const v = nodeCrypto.createVerify('sha256');
      v.update(req.message);
      const pubKeyObj = nodeCrypto.createPublicKey({
        key: Buffer.from(req.publicKey),
        format: 'der',
        type: 'spki',
      });
      const verifyInput: nodeCrypto.VerifyKeyObjectInput = {
        key: pubKeyObj,
        padding: pad,
        ...(req.algorithm === 'RSASSA_PSS_SHA_256' ? { saltLength: 32 } : {}),
      };
      const ok = v.verify(verifyInput, Buffer.from(req.signature));
      return ok ? { valid: true } : { valid: false, reason: 'RSA verify rejected signature' };
    } catch (err) {
      return { valid: false, reason: `verify threw: ${(err as Error).message}` };
    }
  }

  // ─── Test-only helpers ─────────────────────────────────────────────────

  /** Export the public key for a stored key id (DER-encoded SPKI). */
  exportPublicKey(handle: KeyHandle): Uint8Array {
    const stripped = handle.id.startsWith('mock-key:')
      ? handle.id.slice('mock-key:'.length)
      : handle.id;
    const k = this.keys.get(stripped);
    if (!k) throw new HsmError('KeyNotFound', `key not found: ${handle.id}`);
    return k.publicKeyDer;
  }

  private async applyInjections(): Promise<void> {
    if (this.cfg.injectLatencyMs && this.cfg.injectLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.cfg.injectLatencyMs));
    }
    if (this.cfg.failNextWith) {
      const err = this.cfg.failNextWith;
      this.cfg.failNextWith = undefined;
      throw err;
    }
  }
}

// ─── DER helpers (ASN.1 SubjectPublicKeyInfo for EC) ─────────────────────────

/**
 * Wrap a raw uncompressed EC point (0x04 || x || y) in a
 * SubjectPublicKeyInfo DER envelope so consumers receive the same shape
 * as `crypto.createPublicKey({ format: 'der', type: 'spki' })` produces
 * for real HSM exports.
 *
 * Structure:
 *   SEQUENCE {
 *     SEQUENCE {
 *       OID ecPublicKey (1.2.840.10045.2.1)
 *       OID secp256r1   (1.2.840.10045.3.1.7)  -- or P-384
 *     }
 *     BIT STRING { 0x00 || pubKeyBytes }
 *   }
 */
function ecPubKeyToSpkiDer(pub: Uint8Array, algorithm: SignAlgorithm): Uint8Array {
  // OID ecPublicKey
  const oidEcPub = Uint8Array.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  // OID for the named curve.
  const oidCurve =
    algorithm === 'ECDSA_SHA_256'
      ? Uint8Array.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]) // P-256
      : Uint8Array.from([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]); // P-384

  const algId = derSeq(concat(oidEcPub, oidCurve));
  const bitStr = derBitString(concat(Uint8Array.from([0x00]), pub));
  return derSeq(concat(algId, bitStr));
}

function spkiDerToEcPubKey(spki: Uint8Array, algorithm: SignAlgorithm): Uint8Array {
  // Use Node to parse — robust, handles every well-formed SPKI shape.
  const key = nodeCrypto.createPublicKey({
    key: Buffer.from(spki),
    format: 'der',
    type: 'spki',
  });
  const jwk = key.export({ format: 'jwk' });
  const xLen = algorithm === 'ECDSA_SHA_256' ? 32 : 48;
  if (!jwk.x || !jwk.y) {
    throw new HsmError('InvalidKey', 'SPKI is missing EC coordinates');
  }
  const x = base64urlDecode(jwk.x);
  const y = base64urlDecode(jwk.y);
  if (x.length !== xLen || y.length !== xLen) {
    throw new HsmError(
      'InvalidKey',
      `EC point coordinate length mismatch: expected ${xLen} got x=${x.length} y=${y.length}`,
    );
  }
  return concat(Uint8Array.from([0x04]), x, y);
}

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

// ─── DER primitives ──────────────────────────────────────────────────────────

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.from([n]);
  if (n < 0x100) return Uint8Array.from([0x81, n]);
  if (n < 0x10000) return Uint8Array.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  throw new HsmError('CryptoFailure', `DER length too large: ${n}`);
}

function derSeq(body: Uint8Array): Uint8Array {
  return concat(Uint8Array.from([0x30]), derLength(body.length), body);
}

function derBitString(body: Uint8Array): Uint8Array {
  return concat(Uint8Array.from([0x03]), derLength(body.length), body);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
