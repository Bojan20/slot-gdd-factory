/**
 * AWS KMS adapter — minimal pure-JS implementation.
 *
 * We deliberately do NOT pull `@aws-sdk/client-kms` (110 MB transitive
 * tree). The Sign / Verify / GetPublicKey / DescribeKey JSON API is
 * ~120 lines once you have AWS SigV4 over `fetch`. Test infrastructure
 * injects a `fetch` mock — production uses Node's global `fetch`
 * (available since Node 18).
 *
 * ## Key ID formats accepted
 *
 *   - `arn:aws:kms:eu-west-1:123456789012:key/abcd-...`
 *   - `alias/my-rng-signing-key`
 *   - bare UUID `abcd-1234-...` (region inferred from config)
 *
 * ## Supported algorithms
 *
 *   - ECDSA_SHA_256  (CustomerMasterKey spec `ECC_NIST_P256`)
 *   - ECDSA_SHA_384  (CustomerMasterKey spec `ECC_NIST_P384`)
 *   - RSASSA_PSS_SHA_256 (RSA_2048 / RSA_3072 / RSA_4096)
 *   - RSASSA_PKCS1_V1_5_SHA_256 (legacy)
 *
 * ## What this adapter does NOT do
 *
 *   - Key creation. Operators must `aws kms create-key` out-of-band; we
 *     only consume existing keys. (Compliance-wise, key ceremony is
 *     manual + audited; never via runtime API.)
 *   - Key rotation. AWS KMS auto-rotates symmetric keys; ECDSA keys
 *     are CMK-immutable and must be created anew on rotation.
 *   - Cross-region failover. The caller wires that in via the higher-
 *     level `Signer` if needed.
 */

import * as nodeCrypto from 'node:crypto';
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
import { MockHsmAdapter } from './mock.js';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AwsKmsConfig {
  region: string;
  /** Optional explicit credentials. If absent, we use the environment
   *  (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN) — same
   *  contract as the AWS SDK default chain. */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Override the endpoint host (used by LocalStack tests). */
  endpoint?: string;
  /** Per-call HTTP timeout. Default 5000ms. */
  timeoutMs?: number;
  /** Injected fetch function for testing. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

// ─── KMS algorithm mapping ───────────────────────────────────────────────────

function toKmsSigningAlgorithm(alg: SignAlgorithm): string {
  switch (alg) {
    case 'ECDSA_SHA_256':
      return 'ECDSA_SHA_256';
    case 'ECDSA_SHA_384':
      return 'ECDSA_SHA_384';
    case 'RSASSA_PSS_SHA_256':
      return 'RSASSA_PSS_SHA_256';
    case 'RSASSA_PKCS1_V1_5_SHA_256':
      return 'RSASSA_PKCS1_V1_5_SHA_256';
  }
}

function fromKmsSigningAlgorithm(s: string): SignAlgorithm {
  if (
    s === 'ECDSA_SHA_256' ||
    s === 'ECDSA_SHA_384' ||
    s === 'RSASSA_PSS_SHA_256' ||
    s === 'RSASSA_PKCS1_V1_5_SHA_256'
  ) {
    return s;
  }
  throw new HsmError('UnsupportedAlgorithm', `unknown KMS algorithm: ${s}`);
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class AwsKmsAdapter implements HsmAdapter {
  readonly name = 'aws-kms';
  private readonly cfg: AwsKmsConfig;
  private auditCounter = 0;
  /** Verification helper — uses the mock adapter's offline verify path,
   *  because verify never needs to hit AWS once we have the public key. */
  private readonly offlineVerifier = new MockHsmAdapter();

  constructor(cfg: AwsKmsConfig) {
    this.cfg = { timeoutMs: 5000, ...cfg };
  }

  isAvailable(): boolean {
    const haveCreds = !!(
      this.cfg.credentials ??
      (process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY'])
    );
    return haveCreds;
  }

  async describeKey(id: string): Promise<KeyHandle> {
    const body = JSON.stringify({ KeyId: id });
    const resp = await this.kmsCall('DescribeKey', body);
    const meta = (resp as { KeyMetadata?: { KeyUsage?: string; KeySpec?: string } }).KeyMetadata;
    if (!meta || meta.KeyUsage !== 'SIGN_VERIFY') {
      throw new HsmError('InvalidKey', `KMS key ${id} is not SIGN_VERIFY`);
    }
    const alg = inferAlgorithmFromKeySpec(meta.KeySpec ?? '');
    return {
      id,
      algorithm: alg,
      publicKeyExportable: true,
    };
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    const started = Date.now();
    const messageHashHex = sha256Hex(req.message);
    try {
      if (req.algorithm !== req.keyHandle.algorithm) {
        throw new HsmError(
          'UnsupportedAlgorithm',
          `request algorithm ${req.algorithm} != key algorithm ${req.keyHandle.algorithm}`,
        );
      }
      const body = JSON.stringify({
        KeyId: req.keyHandle.id,
        Message: Buffer.from(req.message).toString('base64'),
        MessageType: 'RAW',
        SigningAlgorithm: toKmsSigningAlgorithm(req.algorithm),
      });
      const resp = await this.kmsCall('Sign', body);
      const r = resp as { Signature?: string; SigningAlgorithm?: string };
      if (!r.Signature) throw new HsmError('CryptoFailure', 'KMS Sign returned no signature');
      const signature = new Uint8Array(Buffer.from(r.Signature, 'base64'));
      const echoAlg = r.SigningAlgorithm ? fromKmsSigningAlgorithm(r.SigningAlgorithm) : req.algorithm;
      const audit: AuditRecord = {
        recordId: ++this.auditCounter,
        timestampMs: Date.now(),
        adapter: this.name,
        operation: 'sign',
        keyId: req.keyHandle.id,
        algorithm: echoAlg,
        messageHashHex,
        outcome: 'success',
        latencyMs: Date.now() - started,
        context: req.context,
      };
      return { signature, algorithm: echoAlg, audit };
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
      (hsmErr as HsmError & { audit?: AuditRecord }).audit = audit;
      throw hsmErr;
    }
  }

  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    // Offline verification — public-key crypto doesn't need the HSM.
    return this.offlineVerifier.verify(req);
  }

  /** Fetch the SPKI-DER public key for a KMS-stored key. Cached by caller. */
  async getPublicKey(keyId: string): Promise<Uint8Array> {
    const body = JSON.stringify({ KeyId: keyId });
    const resp = await this.kmsCall('GetPublicKey', body);
    const r = resp as { PublicKey?: string };
    if (!r.PublicKey) throw new HsmError('InvalidKey', 'KMS GetPublicKey returned no key');
    return new Uint8Array(Buffer.from(r.PublicKey, 'base64'));
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async kmsCall(operation: string, body: string): Promise<unknown> {
    const region = this.cfg.region;
    const host = this.cfg.endpoint ?? `kms.${region}.amazonaws.com`;
    const url = `https://${host}/`;
    const creds = this.resolveCreds();
    if (!creds) {
      throw new HsmError('AccessDenied', 'no AWS credentials available');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `TrentService.${operation}`,
      Host: host,
    };
    if (creds.sessionToken) headers['X-Amz-Security-Token'] = creds.sessionToken;

    const signed = signSigV4({
      method: 'POST',
      host,
      path: '/',
      region,
      service: 'kms',
      headers,
      body,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    });

    const fetchImpl = this.cfg.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!fetchImpl) throw new HsmError('AdapterUnavailable', 'no fetch implementation available');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: signed.headers,
        body,
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const code = mapKmsErrorStatus(resp.status, text);
        throw new HsmError(code, `KMS ${operation} HTTP ${resp.status}: ${text.slice(0, 200)}`, {
          transient: code === 'NetworkTimeout' || code === 'RateLimited',
        });
      }
      const json: unknown = await resp.json();
      return json;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new HsmError('NetworkTimeout', `KMS ${operation} timed out`, { transient: true });
      }
      if (err instanceof HsmError) throw err;
      throw new HsmError('ConnectionRefused', `KMS ${operation} failed: ${String(err)}`, {
        transient: true,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveCreds(): {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } | null {
    if (this.cfg.credentials) return this.cfg.credentials;
    const id = process.env['AWS_ACCESS_KEY_ID'];
    const sec = process.env['AWS_SECRET_ACCESS_KEY'];
    const tok = process.env['AWS_SESSION_TOKEN'];
    if (!id || !sec) return null;
    return tok
      ? { accessKeyId: id, secretAccessKey: sec, sessionToken: tok }
      : { accessKeyId: id, secretAccessKey: sec };
  }
}

// ─── KMS error mapping ───────────────────────────────────────────────────────

function mapKmsErrorStatus(status: number, body: string): import('../types.js').HsmErrorCode {
  if (status === 400 && /NotFoundException|InvalidKeyId/.test(body)) return 'KeyNotFound';
  if (status === 400 && /InvalidSignatureException/.test(body)) return 'InvalidSignature';
  if (status === 400 && /UnsupportedOperationException|InvalidParameterValue/.test(body)) {
    return 'UnsupportedAlgorithm';
  }
  if (status === 403) return 'AccessDenied';
  if (status === 429 || /ThrottlingException/.test(body)) return 'RateLimited';
  if (status >= 500) return 'NetworkTimeout';
  return 'CryptoFailure';
}

function inferAlgorithmFromKeySpec(spec: string): SignAlgorithm {
  switch (spec) {
    case 'ECC_NIST_P256':
      return 'ECDSA_SHA_256';
    case 'ECC_NIST_P384':
      return 'ECDSA_SHA_384';
    case 'RSA_2048':
    case 'RSA_3072':
    case 'RSA_4096':
      return 'RSASSA_PSS_SHA_256';
    default:
      throw new HsmError('UnsupportedAlgorithm', `KMS KeySpec ${spec} not supported by bridge`);
  }
}

// ─── AWS SigV4 (just enough for KMS) ─────────────────────────────────────────

interface SigV4Input {
  method: 'POST';
  host: string;
  path: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

export function signSigV4(input: SigV4Input): { headers: Record<string, string> } {
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = input.path;
  const canonicalQuerystring = '';
  const payloadHash = nodeCrypto.createHash('sha256').update(input.body).digest('hex');

  const allHeaders: Record<string, string> = { ...input.headers, 'X-Amz-Date': amzDate };
  const sortedKeys = Object.keys(allHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders =
    sortedKeys.map((k) => `${k}:${allHeaders[Object.keys(allHeaders).find((kk) => kk.toLowerCase() === k)!]?.trim()}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    nodeCrypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmacHex(kSigning, stringToSign);

  const authorization = `${algorithm} Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: { ...allHeaders, Authorization: authorization, 'X-Amz-Date': amzDate },
  };
}

function hmac(key: string | Buffer, data: string): Buffer {
  return nodeCrypto.createHmac('sha256', key).update(data).digest();
}
function hmacHex(key: Buffer, data: string): string {
  return nodeCrypto.createHmac('sha256', key).update(data).digest('hex');
}
function formatAmzDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}
function sha256Hex(msg: Uint8Array): string {
  return nodeCrypto.createHash('sha256').update(msg).digest('hex');
}
