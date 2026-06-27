/**
 * Faza 9.4 — Binary self-verification.
 *
 * The engine hashes its own `.js` bundle (or `.so/.dylib` for the Rust
 * runtime — handled separately by `rust-sim/src/integrity/`) at
 * startup and compares against an embedded expected digest. A drift
 * means an attacker (or accidental corruption) replaced the binary on
 * disk; the engine must refuse to operate until the operator
 * re-installs a known-good build.
 *
 * # Threat model (KIMI 08 — Alex 2017 case)
 *
 * The 2017 "Alex" case (Aristocrat / Novomatic slots, EU and US
 * casinos) demonstrated that a privileged insider with disk-write
 * access to the operator's slot server can swap the math binary for
 * a modified version that emits attacker-favourable streaks. Even
 * with HSM RNG and TLS, if the **evaluator binary itself** is
 * tampered with, the RNG output is interpreted through the attacker's
 * code — every other defence is bypassed.
 *
 * Self-verification closes this attack:
 *   * At build time we hash the binary deterministically.
 *   * The hash is committed to the repo (so any drift is loud during
 *     `git status`) and embedded into the binary itself.
 *   * At startup the engine re-hashes the running binary and compares.
 *   * Mismatch → engine refuses to serve, surfaces a typed error.
 *
 * # GLI-19 §3.3.3 requirement
 *
 * "The gaming software shall provide tamper-evident verification of
 * its own integrity at start-up. Mechanisms such as hash digests
 * computed over the executable and compared against a known-good
 * reference are sufficient. The system shall refuse to operate if
 * the verification fails."
 *
 * # Determinism
 *
 * SHA-256 of a stable file is deterministic. The only friction is
 * **dev-mode hot reload** — when running from TypeScript source via
 * `tsx` or `node --experimental-strip-types`, there is no compiled
 * `.js` to hash. The function therefore supports a `mode:'permissive'`
 * dev path that returns `unknown` instead of `fail`. Production
 * deployments MUST set `mode:'strict'`.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SelfVerifyStatus = 'ok' | 'mismatch' | 'missing' | 'unknown';

export interface SelfVerifyResult {
  readonly status: SelfVerifyStatus;
  readonly actualDigestHex: string | null;
  readonly expectedDigestHex: string | null;
  readonly checkedPath: string;
  readonly sizeBytes: number | null;
  /** Human-readable reason — empty when `status === 'ok'`. */
  readonly reason: string;
}

export interface SelfVerifyOptions {
  /** Absolute path to the binary to hash. */
  readonly binaryPath: string;
  /** Expected SHA-256 hex digest. `null` means "no reference baked in". */
  readonly expectedDigestHex: string | null;
  /** `strict` (default) fails on any non-`ok`; `permissive` allows `unknown`. */
  readonly mode?: 'strict' | 'permissive';
}

/**
 * Compute SHA-256 of a file. Returns the lowercase hex digest, or
 * `null` if the file cannot be read.
 */
export function hashFileSha256Hex(path: string): string | null {
  try {
    const buf = readFileSync(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Resolve the path to the running module's `.js` bundle (post-tsc).
 * Returns `null` when called from a `.ts` source — that's the dev
 * loop case the caller should detect and treat as `unknown`.
 */
export function resolveSelfBinaryPath(metaUrl: string): string | null {
  try {
    const path = fileURLToPath(metaUrl);
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return null;
    if (!path.endsWith('.js') && !path.endsWith('.mjs') && !path.endsWith('.cjs')) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * Run the self-verification check. Pure function (caller threads the
 * IO via the options). On any failure it returns a structured result;
 * the operator wires `fail-stop` behaviour at the call site.
 */
export function verifySelfBinary(opts: SelfVerifyOptions): SelfVerifyResult {
  const mode = opts.mode ?? 'strict';
  let sizeBytes: number | null = null;
  try {
    sizeBytes = statSync(opts.binaryPath).size;
  } catch {
    return {
      status: 'missing',
      actualDigestHex: null,
      expectedDigestHex: opts.expectedDigestHex,
      checkedPath: opts.binaryPath,
      sizeBytes: null,
      reason: `binary not readable at ${opts.binaryPath}`,
    };
  }
  const actualDigestHex = hashFileSha256Hex(opts.binaryPath);
  if (actualDigestHex == null) {
    return {
      status: 'missing',
      actualDigestHex: null,
      expectedDigestHex: opts.expectedDigestHex,
      checkedPath: opts.binaryPath,
      sizeBytes,
      reason: `cannot hash ${opts.binaryPath}`,
    };
  }
  if (opts.expectedDigestHex == null) {
    return {
      status: mode === 'permissive' ? 'unknown' : 'missing',
      actualDigestHex,
      expectedDigestHex: null,
      checkedPath: opts.binaryPath,
      sizeBytes,
      reason:
        mode === 'permissive'
          ? 'no expected digest baked in (dev mode)'
          : 'no expected digest provided in strict mode',
    };
  }
  // Constant-time comparison (defensive — even though side-channel is
  // not part of this threat model, it costs nothing to do this right).
  const a = Buffer.from(actualDigestHex.toLowerCase(), 'hex');
  const b = Buffer.from(opts.expectedDigestHex.toLowerCase(), 'hex');
  let mismatch = a.length !== b.length;
  const len = Math.min(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < len; i++) acc |= a[i]! ^ b[i]!;
  if (acc !== 0 || mismatch) {
    return {
      status: 'mismatch',
      actualDigestHex,
      expectedDigestHex: opts.expectedDigestHex,
      checkedPath: opts.binaryPath,
      sizeBytes,
      reason: 'digest mismatch — binary tampered or stale build',
    };
  }
  return {
    status: 'ok',
    actualDigestHex,
    expectedDigestHex: opts.expectedDigestHex,
    checkedPath: opts.binaryPath,
    sizeBytes,
    reason: '',
  };
}

/**
 * `assertSelfBinary` — throw on non-`ok` status. Use this at the
 * top of the production CLI / RGS adapter entry point.
 */
export class SelfVerifyError extends Error {
  readonly result: SelfVerifyResult;
  constructor(result: SelfVerifyResult) {
    super(`self-verify FAIL [${result.status}]: ${result.reason}`);
    this.name = 'SelfVerifyError';
    this.result = result;
  }
}

export function assertSelfBinary(opts: SelfVerifyOptions): SelfVerifyResult {
  const r = verifySelfBinary(opts);
  if (r.status !== 'ok') {
    if (opts.mode === 'permissive' && r.status === 'unknown') {
      return r;
    }
    throw new SelfVerifyError(r);
  }
  return r;
}
