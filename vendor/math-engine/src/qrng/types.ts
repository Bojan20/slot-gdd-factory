/**
 * FAZA 13.5 — QRNG Bridge Types
 *
 * Quantum Random Number Generator bridge to off-the-shelf quantum entropy
 * sources (ID Quantique, Quantinuum APIs). Falls back to HSM-grade ChaCha20
 * when quantum source is unavailable.
 *
 * Design principles:
 *   - Transparent fallback: callers always get bytes, never an error
 *   - Health monitoring: per-source quality metrics
 *   - Audit trail: each batch records its source for regulatory compliance
 *   - Pluggable: any source implementing `EntropySource` can be used
 */

// ─── Source types ─────────────────────────────────────────────────────────────

export type EntropySourceKind =
  | 'quantinuum'   // Quantinuum H-series quantum processor
  | 'id_quantique' // ID Quantique QRNG chip (Cerberis XG, Quantis)
  | 'anu'          // Australian National University QRNG API (free tier)
  | 'chacha20'     // Software fallback (RFC 8439 ChaCha20-DRBG)
  | 'mock';        // Test/simulation mock

export interface EntropySourceConfig {
  kind: EntropySourceKind;
  /** API key / auth token for cloud quantum sources. */
  apiKey?: string;
  /** Base URL override (useful for sandbox/test endpoints). */
  baseUrl?: string;
  /** Max request timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Pre-shared seed for 'chacha20' and 'mock' sources. */
  seed?: string;
}

// ─── Health & quality metrics ─────────────────────────────────────────────────

export interface EntropySourceHealth {
  kind: EntropySourceKind;
  available: boolean;
  /** Estimated bits of entropy per byte (ideal = 8.0). */
  shannonBitsPerByte: number;
  /** Running success rate (successful requests / total requests). */
  successRate: number;
  /** Average latency of successful requests in ms. */
  avgLatencyMs: number;
  /** Total bytes served by this source. */
  totalBytesServed: number;
  /** Timestamp of last successful request (0 = never). */
  lastSuccessMs: number;
  /** Reason for last failure (null = none). */
  lastFailureReason: string | null;
}

// ─── Batch result ─────────────────────────────────────────────────────────────

export interface EntropyBatch {
  /** Raw entropy bytes. */
  bytes: Uint8Array;
  /** Which source actually produced these bytes. */
  source: EntropySourceKind;
  /** Whether this came from a quantum source (true) or software fallback (false). */
  isQuantum: boolean;
  /** Latency of the request that produced this batch. */
  latencyMs: number;
  /** Epoch ms when the batch was produced. */
  timestampMs: number;
}

// ─── QRNG bridge config ───────────────────────────────────────────────────────

export interface QrngBridgeConfig {
  /** Primary quantum source to use. */
  primary: EntropySourceConfig;
  /** Fallback source (used when primary fails). Default: ChaCha20. */
  fallback?: EntropySourceConfig;
  /** Maximum consecutive primary failures before switching to fallback permanently. */
  maxPrimaryFailures?: number;
  /** Minimum Shannon bits/byte before a source is considered "unhealthy" (default 7.5). */
  minShannonBitsPerByte?: number;
  /** Re-attempt primary after this many ms in fallback mode (default 60_000 = 1 min). */
  primaryRetryMs?: number;
}

// ─── Per-source interface ─────────────────────────────────────────────────────

export interface EntropySource {
  readonly kind: EntropySourceKind;
  /** Fetch `count` random bytes. Rejects on network/auth failure. */
  fetchBytes(count: number): Promise<Uint8Array>;
  /** Synchronous health snapshot. */
  health(): EntropySourceHealth;
}
