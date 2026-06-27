/**
 * HSM Bridge — P0 #10 (RNG-side)
 *
 * Provider-agnostic HSM entropy bridge. UK / MGA / DE jurisdictions
 * require *hardware-backed* random number generation for live deploys
 * (GLI-19 §4.2, UKGC RTS-7, MGA Directive 2 §7.4).  This module
 * supplies the interface (`HSMProvider`, `HSMSession`) and a
 * deterministic, dependency-free `MockHSMProvider` so the engine can
 * already integrate today.  A real PKCS#11 / KMIP backend drops in
 * later **without API churn** — just register another provider.
 *
 * Sibling pattern: `src/qrng/bridge.ts` (Faza 13.5) does the same for
 * quantum sources — primary source + software fallback with health
 * checks.  The HSM bridge is narrower (no automatic mode-switch — a
 * regulator-mandated source is either present or the live tenant
 * MUST refuse to start).  The fallback path here is therefore a
 * *config-time* concern: bad config → warn + ChaCha20 (dev only).
 *
 * The mock provider is backed by `ChaCha20Rng` (already used in
 * `src/crypto/chacha20.ts` for commit-reveal entropy).  Deterministic
 * with a constructor seed → identical byte sequences across runs,
 * which is what the RngBackend conformance tests rely on.
 *
 * Real-driver integration path (future PR, intentionally out of scope):
 *   1. Add `Pkcs11Provider` here implementing `HSMProvider.open` by
 *      `dlopen()`-ing the vendor's PKCS#11 module (libcknfast.so /
 *      libCryptoki2_64.so / libsofthsm2.so) via Node's `process.dlopen`
 *      or an N-API addon.
 *   2. Map `mechanism` to `CKM_AES_KEY_GEN` / `CKM_RSA_PKCS_OAEP` /
 *      `CKM_ECDSA` on the C side.
 *   3. `generateRandomBytes` → `C_GenerateRandom`.
 *   4. `healthCheck` → `C_GetTokenInfo` (latency probe).
 *   5. Register the new provider:
 *        `RngFactory` reads `ir.rng.kind === 'hsm_pkcs11'` and
 *        constructs `HSMBackedRngBackend` using the active provider.
 *
 * The interface in this file is stable: a new provider implements
 * `HSMProvider` and the engine consumes it without touching any of
 * the spin/eval paths.
 */

import { ChaCha20Rng } from './chacha20.js';
import { RngBackend, u64ToF64, lemireBounded } from '../rng/RngBackend.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cryptographic mechanism the HSM should expose for downstream use.
 * For pure RNG we only need the bytes — `mechanism` is recorded so the
 * audit log can prove which FIPS-140-2 module mode was used.
 */
export type HSMMechanism = 'AES_CBC_PAD' | 'RSA_OAEP' | 'ECDSA_P256';

/**
 * Options for `HSMProvider.open`.  All optional — a provider may
 * accept zero-config for dev (mock) or require slot/PIN/lib path for
 * production (PKCS#11).  Providers MUST throw on invalid combos so
 * `RngFactory` can fall back / warn.
 */
export interface HSMOpenOptions {
  /** PKCS#11 slot number (vendor-defined, usually 0..N). */
  slot?: number;
  /** User PIN — passed straight to `C_Login`; never logged in plain. */
  pin?: string;
  /** Absolute path to the vendor's PKCS#11 .so / .dll. */
  libraryPath?: string;
  /** Mechanism the HSM should report on `healthCheck`. */
  mechanism?: HSMMechanism;
  /**
   * Deterministic seed — ONLY honoured by `MockHSMProvider`.  Real
   * providers MUST ignore this (true RNG cannot be deterministic).
   */
  seed?: string;
}

/**
 * One open session on an HSM.  Lifetime: from `provider.open()` to
 * `session.close()`.  All operations are async because real drivers
 * are IO-bound (network for KMS, syscall for PKCS#11).
 */
export interface HSMSession {
  /**
   * Pull `n` bytes of entropy from the HSM.  Caller treats the result
   * as already-conditioned (FIPS-140-2 §4.9.1 health-tested) — the
   * provider is responsible for any continuous-test or rejection
   * sampling internally.
   */
  generateRandomBytes(n: number): Promise<Uint8Array>;

  /** Tear down the session.  Idempotent. */
  close(): Promise<void>;

  /** Probe the device.  `ok=false` triggers `RngFactory` fallback. */
  healthCheck(): Promise<HSMHealth>;
}

export interface HSMHealth {
  /** `true` iff the device is responding + within latency budget. */
  ok: boolean;
  /** Round-trip latency for the probe, ms. */
  latencyMs: number;
  /** Vendor string — mock returns `'mock-pkcs11'`. */
  vendor: string;
  /** Optional FIPS-140-2 serial number / token label. */
  serialNo?: string;
}

/**
 * Top-level interface every backend implements.  `RngFactory`
 * discovers providers via this contract.
 */
export interface HSMProvider {
  open(opts: HSMOpenOptions): Promise<HSMSession>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MockHSMProvider — ChaCha20-backed, deterministic, no native deps
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_VENDOR = 'mock-pkcs11';

/**
 * Default seed used when a caller opens the mock provider without
 * supplying one.  Picked to be obviously fake-looking in audit logs.
 */
const MOCK_DEFAULT_SEED = 'mock-hsm-default-seed';

/**
 * Mock-session shape with an extra **synchronous** byte-generation
 * helper.  The hot spin loop uses this to refill without an await.
 * Real PKCS#11 providers do NOT expose this — their refill is async.
 */
export interface SyncCapableHSMSession extends HSMSession {
  /** Internal brand — `true` for sessions that support sync refill. */
  readonly _syncCapable: true;
  /** Synchronous byte generation.  Same contract as async sibling. */
  generateRandomBytesSync(n: number): Uint8Array;
}

export class MockHSMSession implements SyncCapableHSMSession {
  readonly _syncCapable = true as const;
  private _closed = false;
  private readonly _rng: ChaCha20Rng;
  private readonly _serialNo: string;
  private readonly _failHealth: boolean;

  constructor(seed: string, serialNo: string, failHealth: boolean) {
    this._rng = new ChaCha20Rng(seed);
    this._serialNo = serialNo;
    this._failHealth = failHealth;
  }

  generateRandomBytesSync(n: number): Uint8Array {
    if (this._closed) {
      throw new Error('HSMSession: generateRandomBytesSync called after close()');
    }
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`HSMSession.generateRandomBytesSync: n must be a non-negative integer, got ${n}`);
    }
    const out = new Uint8Array(n);
    let i = 0;
    while (i + 4 <= n) {
      const v = this._rng.nextUint32();
      out[i    ] = (v       ) & 0xff;
      out[i + 1] = (v >>>  8) & 0xff;
      out[i + 2] = (v >>> 16) & 0xff;
      out[i + 3] = (v >>> 24) & 0xff;
      i += 4;
    }
    if (i < n) {
      const tail = this._rng.nextUint32();
      let shift = 0;
      while (i < n) {
        out[i++] = (tail >>> shift) & 0xff;
        shift += 8;
      }
    }
    return out;
  }

  async generateRandomBytes(n: number): Promise<Uint8Array> {
    return this.generateRandomBytesSync(n);
  }

  async close(): Promise<void> {
    this._closed = true;
  }

  async healthCheck(): Promise<HSMHealth> {
    return this.healthSync();
  }

  /** Sync sibling of `healthCheck` — exposed for the sync factory path. */
  healthSync(): HSMHealth {
    const latencyMs = this._failHealth ? 0 : 0.1;
    return {
      ok: !this._failHealth && !this._closed,
      latencyMs,
      vendor: MOCK_VENDOR,
      serialNo: this._serialNo,
    };
  }

  get isClosed(): boolean {
    return this._closed;
  }
}

/** Type-guard for the sync-capable brand. */
function isSyncCapable(s: HSMSession): s is SyncCapableHSMSession {
  return (s as Partial<SyncCapableHSMSession>)._syncCapable === true;
}

/**
 * In-process HSM stand-in.  Deterministic with a constructor seed
 * (or the seed passed in `open({ seed })`).  Reports itself as
 * `vendor: 'mock-pkcs11'` so audit consumers can tell prod from dev.
 *
 * Determinism contract: a fresh `MockHSMProvider(seed)` followed by
 * `open({ seed: undefined })` produces the SAME byte stream as a
 * fresh `MockHSMProvider()` followed by `open({ seed })`.  This is
 * what the conformance test relies on.
 */
export class MockHSMProvider implements HSMProvider {
  private readonly _ctorSeed: string;
  private readonly _serialNo: string;
  private readonly _failHealth: boolean;

  /**
   * @param seed       — deterministic ChaCha20 seed.  Defaults to a
   *                     well-known string for reproducibility.
   * @param serialNo   — optional FIPS serial (mock returns it on
   *                     healthCheck).  Defaults to `'MOCK-0000-0001'`.
   * @param failHealth — force healthCheck → `ok: false`.  Used by
   *                     tests to exercise the fallback path.
   */
  constructor(
    seed: string = MOCK_DEFAULT_SEED,
    serialNo: string = 'MOCK-0000-0001',
    failHealth: boolean = false,
  ) {
    this._ctorSeed = seed;
    this._serialNo = serialNo;
    this._failHealth = failHealth;
  }

  async open(opts: HSMOpenOptions): Promise<HSMSession> {
    // Per-call seed (`opts.seed`) overrides the constructor seed —
    // this lets tests construct one provider and open many
    // independent streams.
    const seed = opts.seed ?? this._ctorSeed;
    return this.openSync(seed);
  }

  /**
   * Synchronous open — mock-only.  Used by `RngFactory.createRng`
   * (sync path) so the rest of the engine can stay synchronous.
   * Real providers do NOT expose this method.
   */
  openSync(seedOverride?: string): MockHSMSession {
    const seed = seedOverride ?? this._ctorSeed;
    return new MockHSMSession(seed, this._serialNo, this._failHealth);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HSMBackedRngBackend — turns an HSMSession into an RngBackend
// ─────────────────────────────────────────────────────────────────────────────

const HSM_REFILL_BYTES = 4096;

/**
 * `RngBackend` adapter that pulls entropy in 4 KiB chunks from an
 * underlying `HSMSession` and serves `nextU64` / `nextU32Bounded` /
 * `nextF64` / `split` from that buffer.  Refills on underrun.
 *
 * Why 4 KiB: matches PKCS#11 `C_GenerateRandom` page granularity on
 * nCipher and Luna; small enough that a single slow call doesn't
 * dominate a 1M-spin Monte Carlo.
 *
 * Important determinism note: `RngFactory` only ever instantiates
 * this from a synchronous code path, but `generateRandomBytes` is
 * async.  We solve this by *prefetching* the first chunk in the
 * factory (see `RngFactory.ts::createRngWithHsm`) and passing it in
 * as the initial buffer.  Subsequent refills happen synchronously
 * against a fresh, pre-fetched chunk that the bridge requested
 * speculatively — see `_refillSync`.  If a refill happens mid-spin
 * we surface a typed error rather than silently blocking.
 *
 * For the mock provider this is trivially synchronous (ChaCha20 is
 * in-process), so we expose a sync-fetch path that the bridge uses
 * when the session is mock.
 */
export class HSMBackedRngBackend implements RngBackend {
  private readonly _session: HSMSession;
  private readonly _vendor: string;
  private _buf: Uint8Array;
  private _bufPos: number;

  /**
   * @param session    — opened HSM session (caller owns lifecycle)
   * @param initialBuf — pre-fetched entropy chunk (sync RNG contract)
   * @param vendor     — recorded for audit (`healthCheck` would be async)
   */
  constructor(session: HSMSession, initialBuf: Uint8Array, vendor: string) {
    this._session = session;
    this._vendor = vendor;
    this._buf = initialBuf;
    this._bufPos = 0;
  }

  /**
   * Async refill — used by `RngFactory` and by future async-aware
   * spin loops.  Returns the number of bytes added.
   */
  async refill(n: number = HSM_REFILL_BYTES): Promise<number> {
    const fresh = await this._session.generateRandomBytes(n);
    // If the existing buffer still has tail bytes, splice them.
    const tail = this._buf.length - this._bufPos;
    if (tail > 0) {
      const combined = new Uint8Array(tail + fresh.length);
      combined.set(this._buf.subarray(this._bufPos), 0);
      combined.set(fresh, tail);
      this._buf = combined;
    } else {
      this._buf = fresh;
    }
    this._bufPos = 0;
    return fresh.length;
  }

  /**
   * Sync refill — works when the underlying session is sync-capable
   * (`SyncCapableHSMSession`, i.e. mock / SoftHSM in-process).  For
   * real PKCS#11 sessions the caller MUST prefetch via `refill()`
   * before entering the spin loop; we throw a typed error if not.
   */
  private _refillSync(): void {
    if (!isSyncCapable(this._session)) {
      throw new Error(
        'HSMBackedRngBackend: synchronous underrun on async-only session — ' +
        'caller must prefetch via refill() before entering the spin loop. ' +
        'See docs/rng.md → "HSM-backed" subsection.'
      );
    }
    const fresh = this._session.generateRandomBytesSync(HSM_REFILL_BYTES);
    const tail = this._buf.length - this._bufPos;
    if (tail > 0) {
      const combined = new Uint8Array(tail + fresh.length);
      combined.set(this._buf.subarray(this._bufPos), 0);
      combined.set(fresh, tail);
      this._buf = combined;
    } else {
      this._buf = fresh;
    }
    this._bufPos = 0;
  }

  private _readU32(): number {
    if (this._bufPos + 4 > this._buf.length) {
      this._refillSync();
    }
    const v =
      (this._buf[this._bufPos    ]      ) |
      (this._buf[this._bufPos + 1] <<  8) |
      (this._buf[this._bufPos + 2] << 16) |
      (this._buf[this._bufPos + 3] << 24);
    this._bufPos += 4;
    return v >>> 0;
  }

  nextU64(): [number, number] {
    const hi = this._readU32();
    const lo = this._readU32();
    return [hi, lo];
  }

  nextF64(): number {
    const [hi, lo] = this.nextU64();
    return u64ToF64(hi, lo);
  }

  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }

  /**
   * Split — derives an independent stream by mixing the parent's
   * next u64 with the nonce and seeding a fresh `ChaCha20Rng`.  This
   * stays in-process and avoids opening a second HSM session per
   * worker (which would exhaust slots on a real device).
   *
   * The child stream is NOT HSM-backed — it is a software CSPRNG
   * derived from HSM entropy.  GLI-11 §4.3 allows this: the rule is
   * "different RNGs for game / shuffle / jackpot," not "every worker
   * pulls from the HSM."
   */
  split(nonce: number): RngBackend {
    const [hi, lo] = this.nextU64();
    const seedStr = `hsm-split:${this._vendor}:${hi.toString(16)}:${lo.toString(16)}:${(nonce >>> 0).toString(16)}`;
    return new ChaCha20RngBackendAdapter(seedStr);
  }

  /** Vendor string forwarded from the underlying session. */
  get vendor(): string {
    return this._vendor;
  }

  /** Remaining buffered bytes — exposed for tests + observability. */
  get bufferedBytes(): number {
    return this._buf.length - this._bufPos;
  }
}

/**
 * Internal helper — adapts `ChaCha20Rng` (sync, in-process) to
 * `RngBackend` for the `split()` path.  Not exported; the public
 * API is via `HSMBackedRngBackend`.
 */
class ChaCha20RngBackendAdapter implements RngBackend {
  private readonly _rng: ChaCha20Rng;
  constructor(seed: string) {
    this._rng = new ChaCha20Rng(seed);
  }
  nextU64(): [number, number] {
    const hi = this._rng.nextUint32();
    const lo = this._rng.nextUint32();
    return [hi >>> 0, lo >>> 0];
  }
  nextF64(): number {
    const [hi, lo] = this.nextU64();
    return u64ToF64(hi, lo);
  }
  nextU32Bounded(max: number): number {
    return lemireBounded(this, max);
  }
  split(nonce: number): RngBackend {
    return new ChaCha20RngBackendAdapter(`split:${(nonce >>> 0).toString(16)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used by RngFactory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construct an `HSMBackedRngBackend` using a provider.  This is
 * async because real HSM sessions are IO-bound — `RngFactory` does
 * the await on the sync-to-async boundary and surfaces a typed
 * error / fallback if things go wrong.
 */
export async function createHsmBackedRng(
  provider: HSMProvider,
  opts: HSMOpenOptions,
): Promise<HSMBackedRngBackend> {
  const session = await provider.open(opts);
  const health = await session.healthCheck();
  if (!health.ok) {
    await session.close();
    throw new Error(`HSM healthCheck failed (vendor=${health.vendor})`);
  }
  const initial = await session.generateRandomBytes(HSM_REFILL_BYTES);
  return new HSMBackedRngBackend(session, initial, health.vendor);
}

// Re-export the constant for tests / docs.
export { HSM_REFILL_BYTES };
