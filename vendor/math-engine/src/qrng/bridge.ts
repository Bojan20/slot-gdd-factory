/**
 * FAZA 13.5 — QrngBridge
 *
 * Transparent quantum-entropy bridge with automatic fallback.
 * Slot engine calls `bridge.nextBytes(N)` or `bridge.nextFloat()` —
 * it always succeeds, transparently switching to software fallback
 * when the quantum source is unavailable.
 *
 * Fallback escalation:
 *   1. Primary source (quantum) — try first
 *   2. On failure: increment failure counter, log, use fallback
 *   3. After maxPrimaryFailures consecutive failures: enter fallback-only mode
 *   4. Retry primary every `primaryRetryMs` ms (back-off style)
 *
 * Bytes → floats:
 *   Float in [0,1) = Uint32 / 2^32  (4 bytes consumed per float)
 */

import {
  ChaCha20Source,
  createEntropySource,
  estimateShannonBitsPerByte,
} from './sources.js';
import type {
  EntropySource,
  EntropyBatch,
  EntropySourceHealth,
  QrngBridgeConfig,
} from './types.js';

export class QrngBridge {
  private readonly primary: EntropySource;
  private readonly fallback: EntropySource;
  private readonly cfg: Required<QrngBridgeConfig>;

  private _consecutiveFailures = 0;
  private _inFallbackMode = false;
  private _fallbackModeEnteredAt = 0;
  private _batchLog: Array<{ timestampMs: number; source: string; bytes: number }> = [];

  constructor(config: QrngBridgeConfig) {
    this.cfg = {
      primary:                 config.primary,
      fallback:                config.fallback ?? { kind: 'chacha20' },
      maxPrimaryFailures:      config.maxPrimaryFailures     ?? 3,
      minShannonBitsPerByte:   config.minShannonBitsPerByte  ?? 7.5,
      primaryRetryMs:          config.primaryRetryMs         ?? 60_000,
    };
    this.primary  = createEntropySource(config.primary);
    this.fallback = createEntropySource(this.cfg.fallback);
  }

  /**
   * Fetch `count` random bytes.
   * Always resolves — never rejects. Falls back to software CSPRNG on error.
   */
  async nextBytes(count: number): Promise<EntropyBatch> {
    const shouldRetryPrimary =
      this._inFallbackMode &&
      Date.now() - this._fallbackModeEnteredAt >= this.cfg.primaryRetryMs;

    if (shouldRetryPrimary) {
      this._inFallbackMode = false;
      this._consecutiveFailures = 0;
    }

    if (!this._inFallbackMode) {
      try {
        const t0 = Date.now();
        const bytes = await this.primary.fetchBytes(count);
        const latencyMs = Date.now() - t0;

        // Quality gate
        const shannon = estimateShannonBitsPerByte(bytes);
        if (shannon < this.cfg.minShannonBitsPerByte && count >= 32) {
          // Treat as failure — insufficient entropy quality
          throw new Error(`Shannon quality too low: ${shannon.toFixed(2)} bits/byte`);
        }

        this._consecutiveFailures = 0;
        const batch: EntropyBatch = {
          bytes,
          source:      this.primary.kind,
          isQuantum:   this.primary.kind !== 'chacha20' && this.primary.kind !== 'mock',
          latencyMs,
          timestampMs: Date.now(),
        };
        this._batchLog.push({ timestampMs: batch.timestampMs, source: this.primary.kind, bytes: count });
        return batch;
      } catch {
        this._consecutiveFailures++;
        if (this._consecutiveFailures >= this.cfg.maxPrimaryFailures) {
          this._inFallbackMode = true;
          this._fallbackModeEnteredAt = Date.now();
        }
        // Fall through to fallback
      }
    }

    // Fallback path
    const t0 = Date.now();
    const bytes = await this.fallback.fetchBytes(count);
    const latencyMs = Date.now() - t0;
    const batch: EntropyBatch = {
      bytes,
      source:      this.fallback.kind,
      isQuantum:   false,
      latencyMs,
      timestampMs: Date.now(),
    };
    this._batchLog.push({ timestampMs: batch.timestampMs, source: this.fallback.kind, bytes: count });
    return batch;
  }

  /**
   * Get a single random float in [0, 1).
   * Consumes 4 bytes from the entropy source.
   */
  async nextFloat(): Promise<number> {
    const batch = await this.nextBytes(4);
    const u32 = (
      (batch.bytes[0]! << 24) |
      (batch.bytes[1]! << 16) |
      (batch.bytes[2]! << 8)  |
       batch.bytes[3]!
    ) >>> 0;
    return u32 / 0x100000000;
  }

  /**
   * Get N floats efficiently (single request for all bytes).
   */
  async nextFloats(count: number): Promise<number[]> {
    const batch = await this.nextBytes(count * 4);
    const result: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const off = i * 4;
      const u32 = (
        (batch.bytes[off]!     << 24) |
        (batch.bytes[off + 1]! << 16) |
        (batch.bytes[off + 2]! << 8)  |
         batch.bytes[off + 3]!
      ) >>> 0;
      result[i] = u32 / 0x100000000;
    }
    return result;
  }

  /**
   * Get an integer in [min, max] inclusive using rejection sampling.
   */
  async nextInt(min: number, max: number): Promise<number> {
    if (min > max) throw new RangeError('nextInt: min must be <= max');
    const range = max - min + 1;
    if (range === 1) return min;
    // Rejection sampling to avoid modulo bias
    const threshold = (0x100000000 % range) >>> 0;
    while (true) {
      const batch = await this.nextBytes(4);
      const u32 = (
        (batch.bytes[0]! << 24) |
        (batch.bytes[1]! << 16) |
        (batch.bytes[2]! << 8)  |
         batch.bytes[3]!
      ) >>> 0;
      if (u32 >= threshold) {
        return min + (u32 % range);
      }
      // Reject and try again
    }
  }

  /** Health of both sources. */
  health(): { primary: EntropySourceHealth; fallback: EntropySourceHealth; inFallbackMode: boolean } {
    return {
      primary:        this.primary.health(),
      fallback:       this.fallback.health(),
      inFallbackMode: this._inFallbackMode,
    };
  }

  /** Whether the bridge is currently using the fallback source. */
  get inFallbackMode(): boolean {
    return this._inFallbackMode;
  }

  /** Total batches served. */
  get batchCount(): number {
    return this._batchLog.length;
  }

  /** Whether the last batch came from a quantum source. */
  get lastBatchIsQuantum(): boolean {
    const last = this._batchLog[this._batchLog.length - 1];
    return last ? (last.source !== 'chacha20' && last.source !== 'mock') : false;
  }
}
