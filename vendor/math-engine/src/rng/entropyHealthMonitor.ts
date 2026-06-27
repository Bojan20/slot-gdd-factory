/**
 * W152 Wave 55 — General Entropy Health Monitor (RNG cross-backend).
 *
 * Closes compliance ⚠️ "General entropy health monitor" by adding a
 * continuous, sliding-window-based RNG quality watcher that can be
 * attached to any RNG backend (mulberry32 / pcg64 / xoshiro256ss /
 * philox4x32 / chacha20 / HSM bridge) and runs IN-PROCESS during
 * production simulation runs. Triggers alerts when entropy drops below
 * a configurable threshold OR χ² uniformity goodness-of-fit exceeds
 * a deviation bound.
 *
 * Different from `src/rng/ent/entStats.ts` (Wave 43) which is post-hoc
 * single-batch assessment. This module is a STREAMING monitor — feed it
 * bytes as the engine consumes RNG, get periodic health samples and
 * automatic alerts on drift.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * UKGC RTS 8.A.1, MGA Player Protection Directive 2018 §11.b, and
 * eCOGRA TG-VG audit all require evidence of CONTINUOUS RNG health
 * during operation, not just one-time certification. This module
 * provides that evidence as a streaming artifact with alertable bounds.
 *
 * ── Algorithm: O(1) amortized sliding-window counts ───────────────────────
 * Maintain count[256] vector + ring buffer of last `windowSizeBytes`
 * input bytes. On feed(b):
 *   1. evict oldest byte from window → count[evicted]--
 *   2. push new byte → count[b]++
 *   3. if bytesSinceLastAssess ≥ assessIntervalBytes:
 *        a. compute Shannon entropy = -Σ p_i log2 p_i where p_i = count[i]/N
 *        b. compute χ² = Σ (count[i] − N/256)² / (N/256)
 *        c. check both vs thresholds, emit EntropySample
 *        d. invoke alert sinks if unhealthy
 *
 * Shannon & χ² are exact for the current window (not approximate).
 * Both are O(256) per assessment — independent of window size.
 *
 * ── Naming policy (clean-room, per `docs/IP_REVIEW.md`) ───────────────────
 * "Entropy health monitor" + "sliding window χ²" are generic terms,
 * widely used in monitoring and reg standards. No vendor-specific marks.
 * Verified by `check-reserved-terms.sh`.
 *
 * ── Default thresholds (regulator-defensible) ─────────────────────────────
 * Shannon entropy ≥ 7.95 bits/byte (matches NIST SP 800-22 baseline + ENT)
 * χ² deviation ≤ 60 (df=255; 99th percentile χ²(255) ≈ 310, so |obs−255|≤60
 *                    means obs ∈ [195, 315] which is well above noise level)
 * Window size 8192 bytes minimum (32× df, ensures χ² distribution holds)
 * Assess interval 1024 bytes (8× per full-window rotation)
 *
 * ── References ────────────────────────────────────────────────────────────
 * Walker (2008) ENT — pseudorandom number sequence test program
 * NIST SP 800-22 §1.3 — uniformity test recommendations
 * UKGC RTS 8.A.1 — RNG monitoring & alerting requirements
 * Knuth TAOCP Vol 2 §3.3.2 — χ² goodness-of-fit theory
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface EntropyMonitorThresholds {
  /** Minimum Shannon entropy bits/byte (alert if observed below). */
  minEntropyBitsPerByte: number;
  /** Max |χ² − 255| (alert if observed deviation exceeds, df=255). */
  maxChiSquareDeviation: number;
  /** Optional: max consecutive unhealthy samples before alert escalation. */
  maxConsecutiveUnhealthy?: number;
}

export interface EntropyMonitorConfig {
  /** Backend identifier (for tagging samples). */
  backendId: string;
  /** Sliding window size in bytes (must be ≥ 256, recommended ≥ 8192). */
  windowSizeBytes: number;
  /** Assess every N bytes consumed (must be ≥ 1, recommended ≥ 1024). */
  assessIntervalBytes: number;
  /** Healthy bounds. */
  thresholds: EntropyMonitorThresholds;
  /** Optional alert sink (invoked on unhealthy sample). */
  onAlert?: (alert: EntropyAlert) => void;
  /** Optional sample sink (invoked on every assessment). */
  onSample?: (sample: EntropySample) => void;
}

export interface EntropySample {
  backendId: string;
  /** Cumulative bytes processed at time of assessment. */
  byteOffset: number;
  /** Wall-clock ms since epoch at assessment. */
  timestampMs: number;
  /** Shannon entropy bits/byte for current window. Range [0, 8]. */
  entropyBitsPerByte: number;
  /** χ² statistic for current window (df=255). */
  chiSquare: number;
  /** |χ² − 255|. */
  chiSquareDeviation: number;
  /** Both metrics pass thresholds? */
  isHealthy: boolean;
}

export interface EntropyAlert {
  backendId: string;
  byteOffset: number;
  timestampMs: number;
  sample: EntropySample;
  /** Specific reasons: 'low_entropy' | 'high_chi_dev' | 'consecutive_unhealthy'. */
  reasons: string[];
  consecutiveUnhealthyCount: number;
}

export interface EntropyMonitorStatus {
  backendId: string;
  totalBytesProcessed: number;
  totalAssessments: number;
  healthyAssessments: number;
  unhealthyAssessments: number;
  alertsEmitted: number;
  consecutiveUnhealthy: number;
  alertActive: boolean;
  lastSample: EntropySample | null;
  configWindowBytes: number;
  configAssessInterval: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: EntropyMonitorThresholds = {
  minEntropyBitsPerByte: 7.95,
  maxChiSquareDeviation: 60,
  maxConsecutiveUnhealthy: 3,
};

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: EntropyMonitorConfig): void {
  if (typeof cfg.backendId !== 'string' || cfg.backendId.length === 0) {
    throw new Error(`backendId must be non-empty string`);
  }
  if (!Number.isInteger(cfg.windowSizeBytes) || cfg.windowSizeBytes < 256) {
    throw new Error(`windowSizeBytes must be integer ≥ 256, got ${cfg.windowSizeBytes}`);
  }
  if (!Number.isInteger(cfg.assessIntervalBytes) || cfg.assessIntervalBytes < 1) {
    throw new Error(`assessIntervalBytes must be integer ≥ 1, got ${cfg.assessIntervalBytes}`);
  }
  if (cfg.assessIntervalBytes > cfg.windowSizeBytes) {
    throw new Error(`assessIntervalBytes (${cfg.assessIntervalBytes}) must be ≤ windowSizeBytes (${cfg.windowSizeBytes})`);
  }
  const t = cfg.thresholds;
  if (!Number.isFinite(t.minEntropyBitsPerByte) || t.minEntropyBitsPerByte < 0 || t.minEntropyBitsPerByte > 8) {
    throw new Error(`minEntropyBitsPerByte must be in [0, 8], got ${t.minEntropyBitsPerByte}`);
  }
  if (!Number.isFinite(t.maxChiSquareDeviation) || t.maxChiSquareDeviation < 0) {
    throw new Error(`maxChiSquareDeviation must be non-negative finite`);
  }
  if (t.maxConsecutiveUnhealthy !== undefined) {
    if (!Number.isInteger(t.maxConsecutiveUnhealthy) || t.maxConsecutiveUnhealthy < 1) {
      throw new Error(`maxConsecutiveUnhealthy must be positive integer if provided`);
    }
  }
}

// ── Class: EntropyHealthMonitor ────────────────────────────────────────────

/**
 * Streaming entropy health monitor. O(1) amortized per byte fed,
 * O(256) per assessment.
 *
 * Usage:
 *   const m = new EntropyHealthMonitor({
 *     backendId: 'mulberry32',
 *     windowSizeBytes: 8192,
 *     assessIntervalBytes: 1024,
 *     thresholds: DEFAULT_THRESHOLDS,
 *     onAlert: (alert) => operatorMetrics.emit(alert),
 *   });
 *
 *   for (const b of rngBytes) m.feed(b);
 *   const status = m.getStatus();
 */
export class EntropyHealthMonitor {
  private cfg: EntropyMonitorConfig;
  private ring: Uint8Array;
  private ringHead = 0;
  private ringSize = 0;
  private counts = new Uint32Array(256);
  private bytesProcessed = 0;
  private bytesSinceLastAssess = 0;
  private totalAssessments = 0;
  private healthyAssessments = 0;
  private alertsEmitted = 0;
  private consecutiveUnhealthy = 0;
  private lastSample: EntropySample | null = null;
  private alertActive = false;

  constructor(config: EntropyMonitorConfig) {
    validate(config);
    this.cfg = { ...config };
    this.ring = new Uint8Array(config.windowSizeBytes);
  }

  /** Feed a single byte. Returns the latest sample if an assessment fired this call, else null. */
  feed(byte: number): EntropySample | null {
    const b = byte & 0xff;
    // If ring full → evict oldest (the slot at ringHead is oldest in FIFO)
    if (this.ringSize === this.cfg.windowSizeBytes) {
      const oldest = this.ring[this.ringHead];
      this.counts[oldest]--;
    } else {
      this.ringSize++;
    }
    this.ring[this.ringHead] = b;
    this.counts[b]++;
    this.ringHead = (this.ringHead + 1) % this.cfg.windowSizeBytes;
    this.bytesProcessed++;
    this.bytesSinceLastAssess++;

    if (this.bytesSinceLastAssess >= this.cfg.assessIntervalBytes) {
      // Only assess after window is at least 1 full window deep
      if (this.ringSize >= this.cfg.windowSizeBytes) {
        return this.assess();
      } else {
        // Reset interval timer to avoid frequent partial-window assessments
        // We still wait until window fills.
      }
    }
    return null;
  }

  /** Feed an array of bytes. Returns array of samples emitted during this call. */
  feedBytes(bytes: Uint8Array | number[]): EntropySample[] {
    const samples: EntropySample[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const s = this.feed(bytes[i]);
      if (s) samples.push(s);
    }
    return samples;
  }

  /** Force an assessment of the current window (only valid if window is full). */
  forceAssess(): EntropySample | null {
    if (this.ringSize < this.cfg.windowSizeBytes) return null;
    return this.assess();
  }

  private assess(): EntropySample {
    const N = this.ringSize;
    const expected = N / 256;
    // Shannon entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      const c = this.counts[i];
      if (c === 0) continue;
      const p = c / N;
      entropy -= p * Math.log2(p);
    }
    // Chi-squared
    let chi = 0;
    for (let i = 0; i < 256; i++) {
      const c = this.counts[i];
      const diff = c - expected;
      chi += (diff * diff) / expected;
    }
    const chiDev = Math.abs(chi - 255); // df = 255 for 256 buckets

    const isHealthy =
      entropy >= this.cfg.thresholds.minEntropyBitsPerByte &&
      chiDev <= this.cfg.thresholds.maxChiSquareDeviation;

    const sample: EntropySample = {
      backendId: this.cfg.backendId,
      byteOffset: this.bytesProcessed,
      timestampMs: Date.now(),
      entropyBitsPerByte: entropy,
      chiSquare: chi,
      chiSquareDeviation: chiDev,
      isHealthy,
    };
    this.lastSample = sample;
    this.totalAssessments++;
    if (isHealthy) {
      this.healthyAssessments++;
      this.consecutiveUnhealthy = 0;
    } else {
      this.consecutiveUnhealthy++;
    }
    this.bytesSinceLastAssess = 0;

    if (this.cfg.onSample) {
      try {
        this.cfg.onSample(sample);
      } catch {
        /* sink errors don't propagate */
      }
    }

    if (!isHealthy) {
      const reasons: string[] = [];
      if (entropy < this.cfg.thresholds.minEntropyBitsPerByte) reasons.push('low_entropy');
      if (chiDev > this.cfg.thresholds.maxChiSquareDeviation) reasons.push('high_chi_dev');
      const maxConsec = this.cfg.thresholds.maxConsecutiveUnhealthy;
      if (maxConsec !== undefined && this.consecutiveUnhealthy >= maxConsec) {
        reasons.push('consecutive_unhealthy');
        this.alertActive = true;
      }
      const alert: EntropyAlert = {
        backendId: this.cfg.backendId,
        byteOffset: this.bytesProcessed,
        timestampMs: sample.timestampMs,
        sample,
        reasons,
        consecutiveUnhealthyCount: this.consecutiveUnhealthy,
      };
      this.alertsEmitted++;
      if (this.cfg.onAlert) {
        try {
          this.cfg.onAlert(alert);
        } catch {
          /* sink errors don't propagate */
        }
      }
    } else {
      // Clear alert when consecutive unhealthy resets
      this.alertActive = false;
    }

    return sample;
  }

  getStatus(): EntropyMonitorStatus {
    return {
      backendId: this.cfg.backendId,
      totalBytesProcessed: this.bytesProcessed,
      totalAssessments: this.totalAssessments,
      healthyAssessments: this.healthyAssessments,
      unhealthyAssessments: this.totalAssessments - this.healthyAssessments,
      alertsEmitted: this.alertsEmitted,
      consecutiveUnhealthy: this.consecutiveUnhealthy,
      alertActive: this.alertActive,
      lastSample: this.lastSample,
      configWindowBytes: this.cfg.windowSizeBytes,
      configAssessInterval: this.cfg.assessIntervalBytes,
    };
  }

  /** Clear all state. Counts and ring reset. */
  reset(): void {
    this.ring = new Uint8Array(this.cfg.windowSizeBytes);
    this.ringHead = 0;
    this.ringSize = 0;
    this.counts = new Uint32Array(256);
    this.bytesProcessed = 0;
    this.bytesSinceLastAssess = 0;
    this.totalAssessments = 0;
    this.healthyAssessments = 0;
    this.alertsEmitted = 0;
    this.consecutiveUnhealthy = 0;
    this.lastSample = null;
    this.alertActive = false;
  }

  /** Current window byte count (≤ windowSizeBytes). */
  windowSize(): number {
    return this.ringSize;
  }
}

// ── Composite monitor for multiple backends ────────────────────────────────

/**
 * Coordinates multiple per-backend monitors with a single alert sink.
 * Useful for an operator dashboard watching all RNG paths simultaneously.
 */
export class MultiBackendEntropyMonitor {
  private monitors = new Map<string, EntropyHealthMonitor>();
  private globalAlertSink?: (alert: EntropyAlert) => void;

  constructor(globalAlertSink?: (alert: EntropyAlert) => void) {
    this.globalAlertSink = globalAlertSink;
  }

  register(config: EntropyMonitorConfig): EntropyHealthMonitor {
    if (this.monitors.has(config.backendId)) {
      throw new Error(`backendId "${config.backendId}" already registered`);
    }
    const userAlert = config.onAlert;
    const wrappedAlert = (alert: EntropyAlert) => {
      if (userAlert) userAlert(alert);
      if (this.globalAlertSink) this.globalAlertSink(alert);
    };
    const monitor = new EntropyHealthMonitor({ ...config, onAlert: wrappedAlert });
    this.monitors.set(config.backendId, monitor);
    return monitor;
  }

  get(backendId: string): EntropyHealthMonitor | undefined {
    return this.monitors.get(backendId);
  }

  getAllStatuses(): EntropyMonitorStatus[] {
    return Array.from(this.monitors.values()).map((m) => m.getStatus());
  }

  /** Summary across all backends: any alert active = global alert. */
  isAnyAlertActive(): boolean {
    for (const m of this.monitors.values()) {
      if (m.getStatus().alertActive) return true;
    }
    return false;
  }

  size(): number {
    return this.monitors.size;
  }

  clear(): void {
    this.monitors.clear();
  }
}
