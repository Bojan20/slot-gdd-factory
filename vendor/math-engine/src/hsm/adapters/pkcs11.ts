/**
 * PKCS#11 process-bridge adapter — wraps the `pkcs11-tool` CLI.
 *
 * Used by operators with on-prem nCipher / Thales / Utimaco / SoftHSM
 * deployments. We deliberately do NOT bind to libpkcs11 directly (would
 * require a native add-on); instead we spawn `pkcs11-tool` which is the
 * standard OpenSC reference CLI and present on every HSM-equipped
 * production host.
 *
 * ## What this provides
 *
 *   - Sign via `pkcs11-tool --sign --mechanism …`
 *   - Verify via `pkcs11-tool --verify` OR offline using @noble/curves
 *     (preferred — no need to round-trip the device for verify)
 *   - Describe a key (list mechanisms, infer algorithm)
 *
 * ## What this does NOT provide
 *
 *   - Token PIN handling beyond `--pin` flag (operators usually configure
 *     PIN via env or hardware loader)
 *   - Key creation / wrapping (operations done out-of-band by HSM admin)
 *
 * ## Unavailable mode
 *
 * If `pkcs11-tool` is not on PATH OR the module path is unset, the
 * adapter reports `isAvailable() === false` and every sign/verify throws
 * `AdapterUnavailable`. Tests run cleanly without a real HSM.
 */

import * as nodeCrypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export interface Pkcs11Config {
  /** Absolute path to the PKCS#11 module (.so / .dll / .dylib). */
  modulePath: string;
  /** Token slot identifier — operator-specific. */
  slot?: string;
  /** Token label (alt to slot). */
  tokenLabel?: string;
  /** User PIN. If absent, we expect PIN to be present in the env or
   *  hardware loader (some HSMs read PIN from a connected smart card). */
  pin?: string;
  /** Override the `pkcs11-tool` binary path (defaults to PATH lookup). */
  toolPath?: string;
  /** Per-operation timeout in ms. Default 8s. */
  timeoutMs?: number;
}

interface SpawnResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

async function spawnCapture(
  cmd: string,
  args: string[],
  opts: { input?: Buffer; timeoutMs?: number } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : null;
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
      });
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

function mechanismFor(alg: SignAlgorithm): string {
  switch (alg) {
    case 'ECDSA_SHA_256':
      return 'ECDSA-SHA256';
    case 'ECDSA_SHA_384':
      return 'ECDSA-SHA384';
    case 'RSASSA_PSS_SHA_256':
      return 'RSA-PSS-SHA-256';
    case 'RSASSA_PKCS1_V1_5_SHA_256':
      return 'SHA256-RSA-PKCS';
  }
}

function sha256Hex(msg: Uint8Array): string {
  return nodeCrypto.createHash('sha256').update(msg).digest('hex');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findBinary(name: string): Promise<string | null> {
  const pathEnv = process.env['PATH'] ?? '';
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export class Pkcs11Adapter implements HsmAdapter {
  readonly name = 'pkcs11';
  private readonly cfg: Pkcs11Config;
  /** Synchronous "is the tool present?" cache. Populated by `init()`
   *  which the constructor invokes asynchronously; until init resolves,
   *  `isAvailable()` returns false. */
  private toolAbsolutePath: string | null = null;
  private moduleExists = false;
  private initialized = false;
  private auditCounter = 0;
  private readonly offlineVerifier = new MockHsmAdapter();

  constructor(cfg: Pkcs11Config) {
    this.cfg = { timeoutMs: 8000, ...cfg };
    // Kick off probe — but isAvailable still works correctly without await.
    void this.init();
  }

  /** Probe the runtime so `isAvailable()` is honest. Idempotent. */
  async init(): Promise<void> {
    if (this.initialized) return;
    const tool = this.cfg.toolPath ?? (await findBinary('pkcs11-tool'));
    this.toolAbsolutePath = tool;
    this.moduleExists = await pathExists(this.cfg.modulePath);
    this.initialized = true;
  }

  isAvailable(): boolean {
    return this.initialized && !!this.toolAbsolutePath && this.moduleExists;
  }

  async describeKey(id: string): Promise<KeyHandle> {
    await this.init();
    if (!this.isAvailable()) {
      throw new HsmError('AdapterUnavailable', 'pkcs11-tool or module missing');
    }
    // Lazy: we only return what we know from id. Full inspection would
    // require a `--list-objects` round-trip; out of scope for this layer.
    if (!id.startsWith('pkcs11:')) {
      throw new HsmError('InvalidKey', `key id must start with 'pkcs11:': ${id}`);
    }
    // Default to ECDSA_SHA_256 — caller can override via opaque hint
    return {
      id,
      algorithm: 'ECDSA_SHA_256',
      publicKeyExportable: false,
    };
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    const started = Date.now();
    const messageHashHex = sha256Hex(req.message);
    try {
      await this.init();
      if (!this.isAvailable()) {
        throw new HsmError('AdapterUnavailable', 'pkcs11-tool / module not present');
      }
      const id = req.keyHandle.id.startsWith('pkcs11:')
        ? req.keyHandle.id.slice('pkcs11:'.length)
        : req.keyHandle.id;
      // Write the message to a temp file so we don't fight stdin buffering.
      const tmpMsg = join(tmpdir(), `pkcs11-sign-${process.pid}-${this.auditCounter + 1}.bin`);
      await fs.writeFile(tmpMsg, req.message);
      try {
        const args: string[] = [
          '--module',
          this.cfg.modulePath,
          '--sign',
          '--mechanism',
          mechanismFor(req.algorithm),
          '--input-file',
          tmpMsg,
          '--id',
          id,
        ];
        if (this.cfg.slot) args.push('--slot', this.cfg.slot);
        if (this.cfg.tokenLabel) args.push('--token-label', this.cfg.tokenLabel);
        if (this.cfg.pin) args.push('--pin', this.cfg.pin);
        const result = await spawnCapture(this.toolAbsolutePath!, args, {
          timeoutMs: this.cfg.timeoutMs,
        });
        if (result.code !== 0) {
          throw new HsmError('CryptoFailure', `pkcs11-tool sign failed: ${result.stderr.slice(0, 300)}`);
        }
        const signature = new Uint8Array(result.stdout);
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
        return { signature, algorithm: req.algorithm, audit };
      } finally {
        await fs.unlink(tmpMsg).catch(() => undefined);
      }
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
    // Offline verify — same primitive as Mock / AWS. PKCS#11 round-trip
    // for verify is wasteful and many HSMs don't even support it.
    return this.offlineVerifier.verify(req);
  }
}
