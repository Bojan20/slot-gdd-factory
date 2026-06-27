/**
 * Faza 7.5 — AWS KMS RNG provider.
 *
 * Implements the `HSMProvider` contract for the AWS KMS `GenerateRandom`
 * API — the cleanest production-HSM entry point on AWS. KMS uses an
 * underlying CloudHSM cluster (FIPS 140-2 Level 3 certified hardware)
 * for entropy generation, so a `GenerateRandom` response satisfies
 * UKGC / MGA / DE / NL FIPS 140-3 procurement requirements.
 *
 * Why this lives in `src/crypto/` and not `src/hsm/adapters/`:
 *   - `src/hsm/adapters/awsKms.ts` implements `HsmAdapter` (Sign/Verify
 *     keystore) — operations bound to a long-lived KMS key.
 *   - This module implements `HSMProvider` (RNG entropy source) — no
 *     keys, pure bytes. Same SigV4 path is reused but the API surface
 *     and consumer (`RngFactory`) are different.
 *
 * Wire format (KMS `GenerateRandom`):
 *
 *     POST / HTTP/1.1
 *     Host: kms.<region>.amazonaws.com
 *     X-Amz-Target: TrentService.GenerateRandom
 *     Content-Type: application/x-amz-json-1.1
 *     {"NumberOfBytes": 1024}
 *
 *     200 OK
 *     {"Plaintext": "<base64 bytes>"}
 *
 * Implementation notes:
 *   - We DO NOT bundle the AWS SDK. The shared `signSigV4` helper in
 *     `src/hsm/adapters/awsKms.ts` is reused for header signing.
 *   - `generateRandomBytes()` is async — KMS is network-bound. The
 *     `HSMBackedRngBackend` already handles async refill via a buffer.
 *   - `NumberOfBytes` per KMS call is capped at 1024 by AWS; we chunk
 *     requests larger than that.
 *   - On any network / IAM / throttling error we throw an `Error` with
 *     `transient` metadata; `RngFactory` translates to fallback per the
 *     `HSM_FALLBACK_FORBIDDEN` operator policy.
 */

import { signSigV4 } from '../hsm/adapters/awsKms.js';
import type {
  HSMHealth,
  HSMOpenOptions,
  HSMProvider,
  HSMSession,
} from './hsm.js';

/** AWS KMS `GenerateRandom` per-call maximum (AWS-imposed). */
const KMS_GENERATE_RANDOM_MAX = 1024;

export interface AwsKmsRngProviderConfig {
  /** AWS region — e.g. `eu-west-1`. */
  readonly region: string;
  /** Override AWS KMS endpoint (default: `kms.<region>.amazonaws.com`). */
  readonly endpoint?: string;
  /** Static credentials. Optional — falls back to `AWS_ACCESS_KEY_ID` env. */
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly sessionToken?: string;
  };
  /** Per-request timeout in ms (default 5000). */
  readonly timeoutMs?: number;
  /** Override `fetch` (for testing). */
  readonly fetchImpl?: typeof fetch;
  /** Vendor label for `healthCheck()`. Default `'aws-kms'`. */
  readonly vendor?: string;
}

interface ResolvedCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function resolveCreds(cfg: AwsKmsRngProviderConfig): ResolvedCreds | null {
  if (cfg.credentials) return { ...cfg.credentials };
  const id = process.env['AWS_ACCESS_KEY_ID'];
  const sec = process.env['AWS_SECRET_ACCESS_KEY'];
  const tok = process.env['AWS_SESSION_TOKEN'];
  if (!id || !sec) return null;
  return tok
    ? { accessKeyId: id, secretAccessKey: sec, sessionToken: tok }
    : { accessKeyId: id, secretAccessKey: sec };
}

/**
 * `HSMSession` backed by AWS KMS `GenerateRandom`. One session per
 * `provider.open()` — no persistent connection (KMS is HTTPS, every
 * call is a fresh TLS request).
 */
class AwsKmsRngSession implements HSMSession {
  private _closed = false;
  private readonly _cfg: AwsKmsRngProviderConfig;
  private readonly _creds: ResolvedCreds;
  private readonly _fetch: typeof fetch;
  private readonly _serialNo: string;

  constructor(cfg: AwsKmsRngProviderConfig, creds: ResolvedCreds, serialNo: string) {
    this._cfg = cfg;
    this._creds = creds;
    this._serialNo = serialNo;
    const f = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) {
      throw new Error('AwsKmsRngProvider: no fetch implementation available');
    }
    this._fetch = f;
  }

  async generateRandomBytes(n: number): Promise<Uint8Array> {
    if (this._closed) {
      throw new Error('AwsKmsRngSession: generateRandomBytes called after close()');
    }
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(
        `AwsKmsRngSession.generateRandomBytes: n must be a non-negative integer, got ${n}`
      );
    }
    if (n === 0) return new Uint8Array(0);

    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const chunk = Math.min(n - written, KMS_GENERATE_RANDOM_MAX);
      const bytes = await this._callGenerateRandom(chunk);
      out.set(bytes, written);
      written += bytes.length;
    }
    return out;
  }

  async healthCheck(): Promise<HSMHealth> {
    if (this._closed) {
      return { ok: false, latencyMs: 0, vendor: this._cfg.vendor ?? 'aws-kms', serialNo: this._serialNo };
    }
    const t0 = Date.now();
    try {
      await this._callGenerateRandom(1);
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        vendor: this._cfg.vendor ?? 'aws-kms',
        serialNo: this._serialNo,
      };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        vendor: this._cfg.vendor ?? 'aws-kms',
        serialNo: this._serialNo,
      };
    }
  }

  async close(): Promise<void> {
    this._closed = true;
  }

  /** Single KMS `GenerateRandom` call. Chunked by the caller. */
  private async _callGenerateRandom(numberOfBytes: number): Promise<Uint8Array> {
    if (numberOfBytes < 1 || numberOfBytes > KMS_GENERATE_RANDOM_MAX) {
      throw new RangeError(
        `AwsKmsRngSession._callGenerateRandom: n must be 1..${KMS_GENERATE_RANDOM_MAX}, got ${numberOfBytes}`
      );
    }
    const region = this._cfg.region;
    const host = this._cfg.endpoint ?? `kms.${region}.amazonaws.com`;
    const url = `https://${host}/`;
    const body = JSON.stringify({ NumberOfBytes: numberOfBytes });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'TrentService.GenerateRandom',
      Host: host,
    };
    if (this._creds.sessionToken) {
      headers['X-Amz-Security-Token'] = this._creds.sessionToken;
    }

    const signed = signSigV4({
      method: 'POST',
      host,
      path: '/',
      region,
      service: 'kms',
      headers,
      body,
      credentials: {
        accessKeyId: this._creds.accessKeyId,
        secretAccessKey: this._creds.secretAccessKey,
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._cfg.timeoutMs ?? 5000);
    try {
      const resp = await this._fetch(url, {
        method: 'POST',
        headers: signed.headers,
        body,
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(
          `KMS GenerateRandom HTTP ${resp.status}: ${text.slice(0, 200)}`
        );
        (err as Error & { transient?: boolean }).transient =
          resp.status === 429 || resp.status >= 500;
        throw err;
      }
      const payload = (await resp.json()) as { Plaintext?: string };
      if (!payload.Plaintext) {
        throw new Error('KMS GenerateRandom: response missing Plaintext');
      }
      return new Uint8Array(Buffer.from(payload.Plaintext, 'base64'));
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        const e = new Error('KMS GenerateRandom timed out');
        (e as Error & { transient?: boolean }).transient = true;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * `HSMProvider` backed by AWS KMS `GenerateRandom`. Plug into
 * `RngFactory` with `kind: 'hsm_aws_kms'` once the factory is
 * extended (or use the `HSMBackedRngBackend` directly).
 */
export class AwsKmsRngProvider implements HSMProvider {
  private readonly _cfg: AwsKmsRngProviderConfig;

  constructor(cfg: AwsKmsRngProviderConfig) {
    if (!cfg.region || typeof cfg.region !== 'string') {
      throw new RangeError('AwsKmsRngProvider: region required');
    }
    this._cfg = cfg;
  }

  async open(opts: HSMOpenOptions): Promise<HSMSession> {
    void opts; // KMS sessions don't need slot/pin/token-label
    const creds = resolveCreds(this._cfg);
    if (!creds) {
      throw new Error(
        'AwsKmsRngProvider: no AWS credentials (set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY or pass `credentials`)'
      );
    }
    const serialNo = `kms-${this._cfg.region}`;
    return new AwsKmsRngSession(this._cfg, creds, serialNo);
  }
}
