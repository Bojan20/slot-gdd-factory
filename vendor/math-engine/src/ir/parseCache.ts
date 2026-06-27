/**
 * W152 Wave 15 — TS-side parse-once IR cache (technical-debt closure).
 *
 * `parseGameIR` runs Zod schema validation + a multi-pass semantic checker on
 * every call. For typical operator workloads (CLI subcommands, RGS hot-path,
 * MC orchestrators that re-parse the same IR per-spin) this work is wasted
 * — the IR text is byte-identical from one call to the next, so the parsed
 * `SlotGameIR` would be identical too.
 *
 * The Rust bulk path already amortises this cost via `Arc<Config>`. This
 * module is the TS equivalent: an explicit cache keyed by a content digest
 * of the source text. Hits skip Zod + cross-validation entirely; misses
 * fall through to `parseGameIR` and store the result.
 *
 * Design notes:
 *   * Key is a fast non-cryptographic 64-bit FNV-1a hash of the canonical
 *     UTF-8 text. Operator-supplied JSON varies wildly (formatting,
 *     whitespace, key order) — we cache exactly what the caller passed in,
 *     not a normalised form. This is intentional: two textually different
 *     blobs that yield the same parse are still rare in practice and never
 *     a correctness issue (cache miss → re-parse → same result).
 *   * Bounded LRU (default 64 entries) so a long-running daemon that loads
 *     hundreds of operator configs can't leak memory. Most operators run
 *     ≤ 32 active titles per stack — 64 is comfortable.
 *   * Stats counter (`hits` / `misses` / `evictions`) so a perf-conscious
 *     operator can prove the cache pays off in their workload.
 *   * Failure results are NOT cached. A parse failure is usually transient
 *     (developer iteration), and caching the failure would mask later fixes
 *     that share the same broken text. This is conservative — if a hot-path
 *     ever measures repeated identical failures, we can add a separate
 *     `cacheFailures: true` opt-in.
 *   * Pure ESM, no I/O, no clock — deterministic, replay-safe, test-friendly.
 *
 * Usage:
 *   import { loadIrCached, getCacheStats, clearCache } from './parseCache.js';
 *   const result = loadIrCached(jsonText);
 *   if (result.ok) doStuff(result.ir);
 *   // ... later
 *   const stats = getCacheStats();   // { hits, misses, evictions, size, capacity }
 */

import { parseGameIR, type IRParseResult } from './index.js';

/** Default cache capacity. Tunable via `configureCache({capacity})`. */
const DEFAULT_CAPACITY = 64;

/** Minimum allowed capacity — anything below 1 disables caching entirely. */
const MIN_CAPACITY = 1;

/** Hard ceiling so a misconfigured operator can't allocate runaway memory. */
const MAX_CAPACITY = 4096;

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
}

let CAPACITY = DEFAULT_CAPACITY;
const cache = new Map<string, IRParseResult>();
let hits = 0;
let misses = 0;
let evictions = 0;

/**
 * 64-bit FNV-1a over the UTF-8 byte stream, returned as a 16-char lowercase
 * hex string. Non-cryptographic — collisions are vanishingly unlikely for
 * the JSON-shaped inputs we cache (typical IR is 5-50 KB), and a collision
 * would only return a wrong-but-valid IR for a different game, which is
 * detectable downstream by any caller that compares game ids.
 *
 * We deliberately avoid `crypto.subtle.digest()` because it's async and
 * allocates a Promise per call — a synchronous fingerprint keeps the
 * hot-path call shape simple (`loadIrCached` stays sync).
 */
export function fingerprintText(text: string): string {
  // FNV-1a 64-bit constants.
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  let hash = FNV_OFFSET;
  // TextEncoder is part of the Node + browser standard library and gives us
  // a real UTF-8 byte view — `String.charCodeAt` would mishandle surrogate
  // pairs above U+FFFF.
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Parse + validate IR JSON text, returning a cached result on hit.
 *
 * Accepts either a string (parsed once) or pre-parsed object (no JSON
 * round-trip). Object inputs are stringified deterministically via
 * `JSON.stringify` for fingerprinting — caller is responsible for the fact
 * that two objects with different key orders will hash differently and
 * therefore cache as separate entries (rarely a hot-path concern).
 *
 * Returns the same `IRParseResult` shape as `parseGameIR` so call sites
 * can substitute `loadIrCached` without changing branching logic.
 */
export function loadIrCached(input: string | object): IRParseResult {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const key = fingerprintText(text);

  const hit = cache.get(key);
  if (hit !== undefined) {
    hits++;
    // LRU touch: re-insert moves the key to the most-recently-used slot.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  misses++;

  // Miss path — parse JSON if needed, then run the canonical parser.
  let parsedJson: unknown;
  if (typeof input === 'string') {
    try {
      parsedJson = JSON.parse(input);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Don't cache JSON parse failures — see "Failure results NOT cached"
      // note in the file header.
      return { ok: false, issues: [{ path: '/', message: `JSON parse failure: ${message}` }] };
    }
  } else {
    parsedJson = input;
  }

  const result = parseGameIR(parsedJson);
  if (result.ok) {
    // Evict LRU before insert so size is bounded.
    if (cache.size >= CAPACITY) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
        evictions++;
      }
    }
    cache.set(key, result);
  }
  return result;
}

/** Return a snapshot of cache counters + current size. */
export function getCacheStats(): CacheStats {
  return { hits, misses, evictions, size: cache.size, capacity: CAPACITY };
}

/**
 * Reset all counters and entries. Test-only in production code paths;
 * exported for benchmark harnesses and unit tests.
 */
export function clearCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
  evictions = 0;
}

/**
 * Reconfigure the LRU capacity. Capacity changes downsize the cache
 * immediately by evicting the oldest entries first; counters are preserved
 * so an operator can measure hit-rate before vs after a tuning change.
 *
 * Throws on out-of-range capacity to surface misconfiguration loudly.
 */
export function configureCache(opts: { capacity?: number } = {}): void {
  if (opts.capacity !== undefined) {
    if (!Number.isFinite(opts.capacity) || !Number.isInteger(opts.capacity)) {
      throw new TypeError(`configureCache: capacity must be an integer (got ${opts.capacity})`);
    }
    if (opts.capacity < MIN_CAPACITY || opts.capacity > MAX_CAPACITY) {
      throw new RangeError(
        `configureCache: capacity must be in [${MIN_CAPACITY}, ${MAX_CAPACITY}] (got ${opts.capacity})`
      );
    }
    CAPACITY = opts.capacity;
    while (cache.size > CAPACITY) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
      evictions++;
    }
  }
}

/** Test-only inspector: returns `true` if the given fingerprint is cached. */
export function _hasFingerprint(fp: string): boolean {
  return cache.has(fp);
}
