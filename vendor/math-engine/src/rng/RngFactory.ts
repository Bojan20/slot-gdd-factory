/**
 * RNG Factory — Faza 7 + P0 #10 HSM bridge
 *
 * Creates an RngBackend instance by kind and seed.
 *
 * P0 #10 adds the `'hsm_pkcs11'` kind.  Because real HSM sessions are
 * IO-bound (network for KMS, syscall for PKCS#11), the HSM branch is
 * exposed through a separate **async** factory — `createRngAsync` —
 * which the caller can await before entering a sync spin loop.  The
 * sync `createRng` still supports `'hsm_pkcs11'` *only* when the
 * caller pre-supplies an opened provider via `setHsmProvider`; with
 * the default mock provider this is purely in-process and works
 * without an await.
 *
 * Fallback rule: if `kind === 'hsm_pkcs11'` and either the config is
 * invalid OR `healthCheck.ok === false`, the factory emits a
 * `console.warn` and falls back to a ChaCha20-seeded backend so that
 * dev/CI runs keep working.  Live deployments MUST set
 * `process.env.HSM_FALLBACK_FORBIDDEN=1` so the warning becomes a
 * hard throw — see `docs/rng.md` § "HSM-backed".
 */

import { RngBackend, RngKind } from './RngBackend.js';
import { Mulberry32 } from './backends/Mulberry32.js';
import { PCG64 } from './backends/PCG64.js';
import { Xoshiro256SS } from './backends/Xoshiro256SS.js';
import { Philox4x32 } from './backends/Philox4x32.js';
import { ChaCha20 } from './backends/ChaCha20.js';
import {
  HSMProvider,
  HSMOpenOptions,
  HSMBackedRngBackend,
  MockHSMProvider,
  createHsmBackedRng,
} from '../crypto/hsm.js';
import { ChaCha20Rng } from '../crypto/chacha20.js';

// ─────────────────────────────────────────────────────────────────────────────
// Extended kind — `'hsm_pkcs11'` is recognised here but NOT added to
// `RngKind` in RngBackend.ts (which is exposed via the IR schema and
// would force a `RngKind` migration on all consumers).  Until the
// real PKCS#11 driver lands we accept it as a separate string union.
// ─────────────────────────────────────────────────────────────────────────────

export type ExtendedRngKind = RngKind | 'hsm_pkcs11';

export interface HsmRngFactoryConfig {
  /** Provider to use when `kind === 'hsm_pkcs11'`. */
  provider?: HSMProvider;
  /** Options passed to `provider.open`. */
  openOpts?: HSMOpenOptions;
  /**
   * If `true`, any fallback path throws instead of warning.  Live
   * deployments under UK/MGA/DE MUST set this to true.
   */
  fallbackForbidden?: boolean;
}

/**
 * Synchronous factory.
 *
 * For `kind ∈ {'mulberry32','pcg64','xoshiro256ss','philox4x32'}`
 * this is purely in-process — same as Faza 7.
 *
 * For `kind === 'hsm_pkcs11'` the caller MUST have an opened
 * `HSMBackedRngBackend` they constructed via `createRngAsync` and
 * pass it through; the sync path will fall back to ChaCha20 with a
 * console.warn if `cfg.provider` is missing.  This keeps the
 * existing `createRng(kind, seed)` signature backward compatible.
 */
export function createRng(
  kind: ExtendedRngKind,
  seed: number,
  cfg?: HsmRngFactoryConfig,
): RngBackend {
  switch (kind) {
    case 'mulberry32':
      return new Mulberry32(seed);
    case 'pcg64':
      return new PCG64(seed);
    case 'xoshiro256ss':
      return new Xoshiro256SS(seed);
    case 'philox4x32':
      return new Philox4x32(seed);
    case 'chacha20':
      return new ChaCha20(seed);
    case 'hsm_pkcs11':
      return createHsmRngSync(seed, cfg);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown RNG kind: ${exhaustive}`);
    }
  }
}

/**
 * Async factory — the proper entry point for `kind === 'hsm_pkcs11'`.
 * Falls back to ChaCha20 (with console.warn) on bad config or failed
 * health check, unless `cfg.fallbackForbidden === true`.
 */
export async function createRngAsync(
  kind: ExtendedRngKind,
  seed: number,
  cfg?: HsmRngFactoryConfig,
): Promise<RngBackend> {
  if (kind !== 'hsm_pkcs11') {
    return createRng(kind, seed, cfg);
  }
  const provider = cfg?.provider;
  if (!provider) {
    return hsmFallback(seed, 'no provider configured', cfg);
  }
  try {
    return await createHsmBackedRng(provider, cfg?.openOpts ?? {});
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return hsmFallback(seed, reason, cfg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function createHsmRngSync(seed: number, cfg?: HsmRngFactoryConfig): RngBackend {
  const provider = cfg?.provider;
  if (!provider) {
    return hsmFallback(seed, 'no provider configured (sync path)', cfg);
  }
  if (!(provider instanceof MockHSMProvider)) {
    // Real providers cannot be opened synchronously — fall back with warn.
    return hsmFallback(seed, 'non-mock provider on sync path (use createRngAsync)', cfg);
  }
  // Mock provider is fully in-process — open + prefetch synchronously.
  const session = new (MockHSMProvider as unknown as {
    new (): MockHSMProvider;
  })();
  // Use the public open() — but we need the resolved session.  Mock
  // open is microtask-only; we cannot block on it from sync code, so
  // we instead instantiate the mock session directly via a brand-new
  // provider configured from cfg.openOpts.seed.  This keeps the
  // factory purely synchronous.
  void session; // unused — kept to make the intent explicit

  // Construct the mock session directly so we stay synchronous.
  const seedStr = cfg?.openOpts?.seed ?? `factory-mock-seed:${(seed >>> 0).toString(16)}`;
  // Re-use the provider the caller gave us so audit metadata
  // (serialNo, failHealth flag) is preserved.
  const mockProvider = provider as MockHSMProvider;
  // Open synchronously by leveraging the deterministic mock contract.
  const ms = openMockSync(mockProvider, seedStr);
  if (!ms.healthSync().ok) {
    return hsmFallback(seed, 'mock healthCheck failed', cfg);
  }
  const initial = ms.generateRandomBytesSync(4096);
  return new HSMBackedRngBackend(ms, initial, 'mock-pkcs11');
}

/**
 * Open the mock provider synchronously.  Internal helper that
 * relies on the mock-session brand exported from `src/crypto/hsm.ts`.
 */
function openMockSync(provider: MockHSMProvider, seed: string): MockHSMSessionLike {
  // The public `open(opts)` is async only because the interface is
  // unified across providers; the mock implementation is in-process
  // and we know it never blocks.  We piggy-back on `Promise.resolve`
  // via a `then` chain that is synchronously resolved.  But to keep
  // this code easy to audit we instead read through a documented
  // back-door: `MockHSMProvider.openSync` (added below).
  return (provider as unknown as { openSync(seed: string): MockHSMSessionLike }).openSync(seed);
}

interface MockHSMSessionLike {
  _syncCapable: true;
  generateRandomBytes(n: number): Promise<Uint8Array>;
  generateRandomBytesSync(n: number): Uint8Array;
  close(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; vendor: string; serialNo?: string }>;
  healthSync(): { ok: boolean; latencyMs: number; vendor: string; serialNo?: string };
}

function hsmFallback(
  seed: number,
  reason: string,
  cfg?: HsmRngFactoryConfig,
): RngBackend {
  const forbidden =
    cfg?.fallbackForbidden === true ||
    (typeof process !== 'undefined' && process.env?.HSM_FALLBACK_FORBIDDEN === '1');
  if (forbidden) {
    throw new Error(`HSM fallback forbidden by config; reason: ${reason}`);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[RngFactory] hsm_pkcs11 → ChaCha20 fallback (dev only). reason: ${reason}`,
  );
  const seedStr = `hsm-fallback:${(seed >>> 0).toString(16)}`;
  return new ChaCha20Backend(seedStr);
}

/**
 * Thin RngBackend wrapper around ChaCha20Rng — used only by the
 * fallback path.  Not exported from the rng barrel; the canonical
 * production backends remain mulberry32 / pcg64 / xoshiro256ss /
 * philox4x32.
 */
class ChaCha20Backend implements RngBackend {
  private readonly _rng: ChaCha20Rng;
  constructor(seed: string) {
    this._rng = new ChaCha20Rng(seed);
  }
  nextU64(): [number, number] {
    return [this._rng.nextUint32(), this._rng.nextUint32()];
  }
  nextF64(): number {
    const hi = this._rng.nextUint32();
    const lo = this._rng.nextUint32();
    return (hi * 2097152 + (lo >>> 11)) / 9007199254740992;
  }
  nextU32Bounded(max: number): number {
    return this._rng.nextInRange(0, Math.max(0, max - 1));
  }
  split(nonce: number): RngBackend {
    return new ChaCha20Backend(`chacha-split:${(nonce >>> 0).toString(16)}`);
  }
}
