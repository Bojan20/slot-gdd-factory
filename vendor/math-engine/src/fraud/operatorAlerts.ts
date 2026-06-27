/**
 * W152 Wave 22 — Operator Anti-Fraud Alert Wiring (Faza 13.3 ⚠️→✅).
 *
 * Real-time alert emit ka pluggable operator dashboard. Where the
 * existing `src/fraud/detector.ts` produces fraud-classification
 * verdicts in-process, this module wraps the classifier sa pluggable
 * **alert-sink** backend tako da operator's casino dashboard prima
 * detection events kako se dešavaju.
 *
 * Backends (callable preko callback adapter pattern — same shape kao
 * `PluggableUploaderAdapter` u src/recall/storageAdapter.ts):
 *   * `MemoryAlertSink`        — in-process queue (test path)
 *   * `WebhookAlertSink`       — POST every alert to operator URL
 *   * `BufferedBatchAlertSink` — batch up N alerts, then flush via callback
 *   * `MultiplexAlertSink`     — fan-out to multiple sinks
 *
 * Naming policy: `operatorAlerts` engine-generic.
 *
 * Pure module — no I/O outside caller-supplied callbacks. Deterministic
 * given the verdict stream.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface FraudAlert {
  /** Unique alert id (operator-side correlation). */
  alertId: string;
  /** ISO UTC. */
  emittedAtUtc: string;
  severity: AlertSeverity;
  /** Free-form classification (e.g. 'velocity_anomaly', 'session_scrape'). */
  category: string;
  /** Player / session identifier (operator-supplied). */
  playerId: string;
  sessionId?: string;
  /** Free-form payload (operator-side parser interprets). */
  details: Record<string, unknown>;
}

export interface AlertSink {
  /** Push one alert. Sync or async. */
  publish(alert: FraudAlert): void | Promise<void>;
  /** Force any buffered batches through. */
  flush(): void | Promise<void>;
  /** Total alerts successfully published. */
  publishedCount(): number;
  /** Alerts buffered but not yet flushed. */
  pendingCount(): number;
}

// ════════════════════════════════════════════════════════════════════════════
// MemoryAlertSink — test/dev path
// ════════════════════════════════════════════════════════════════════════════

export class MemoryAlertSink implements AlertSink {
  private alerts: FraudAlert[] = [];

  publish(alert: FraudAlert): void {
    this.alerts.push(alert);
  }
  flush(): void {
    /* no-op — sync */
  }
  publishedCount(): number {
    return this.alerts.length;
  }
  pendingCount(): number {
    return 0;
  }
  /** Test inspector: all collected alerts in order. */
  drained(): FraudAlert[] {
    return this.alerts.slice();
  }
  /** Test inspector: filter by severity. */
  bySeverity(severity: AlertSeverity): FraudAlert[] {
    return this.alerts.filter((a) => a.severity === severity);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WebhookAlertSink — POST per alert
// ════════════════════════════════════════════════════════════════════════════

export interface WebhookAlertOptions {
  /** Caller-provided POST function. Returns promise that rejects on
   *  HTTP failure. Default uses fetch — caller may inject mock for tests. */
  poster: (alert: FraudAlert) => Promise<void>;
  /** Throw on poster failure (vs swallow). Default false (swallow + count). */
  rethrowOnFailure?: boolean;
}

export class WebhookAlertSink implements AlertSink {
  private published = 0;
  private pending: FraudAlert[] = [];

  constructor(private readonly opts: WebhookAlertOptions) {}

  publish(alert: FraudAlert): Promise<void> {
    this.pending.push(alert);
    return this.opts
      .poster(alert)
      .then(() => {
        this.pending = this.pending.filter((a) => a.alertId !== alert.alertId);
        this.published += 1;
      })
      .catch((e) => {
        if (this.opts.rethrowOnFailure) {
          throw new Error(`WebhookAlertSink: POST failed for alert ${alert.alertId}: ${e}`);
        }
        // Swallow + leave in pending for retry via flush.
      });
  }

  async flush(): Promise<void> {
    const toRetry = this.pending.slice();
    for (const alert of toRetry) {
      try {
        await this.opts.poster(alert);
        this.pending = this.pending.filter((a) => a.alertId !== alert.alertId);
        this.published += 1;
      } catch (e) {
        if (this.opts.rethrowOnFailure) {
          throw new Error(`WebhookAlertSink.flush: POST failed for ${alert.alertId}: ${e}`);
        }
        // Keep in pending for next flush.
      }
    }
  }

  publishedCount(): number {
    return this.published;
  }
  pendingCount(): number {
    return this.pending.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BufferedBatchAlertSink — batch up N then flush
// ════════════════════════════════════════════════════════════════════════════

export interface BufferedBatchAlertOptions {
  flushBatchSize: number;
  flushCallback: (batch: FraudAlert[]) => Promise<void>;
}

export class BufferedBatchAlertSink implements AlertSink {
  private buffer: FraudAlert[] = [];
  private published = 0;

  constructor(private readonly opts: BufferedBatchAlertOptions) {
    if (!Number.isInteger(opts.flushBatchSize) || opts.flushBatchSize <= 0) {
      throw new RangeError(`BufferedBatchAlertSink: flushBatchSize must be positive integer`);
    }
  }

  publish(alert: FraudAlert): void {
    this.buffer.push(alert);
    if (this.buffer.length >= this.opts.flushBatchSize) {
      // Async fire-and-forget — caller can `await flush()` for guarantee.
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.slice();
    this.buffer = [];
    await this.opts.flushCallback(batch);
    this.published += batch.length;
  }

  publishedCount(): number {
    return this.published;
  }
  pendingCount(): number {
    return this.buffer.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MultiplexAlertSink — fan-out to multiple sinks
// ════════════════════════════════════════════════════════════════════════════

export class MultiplexAlertSink implements AlertSink {
  constructor(private readonly sinks: AlertSink[]) {
    if (sinks.length === 0) {
      throw new Error('MultiplexAlertSink: at least one sink required');
    }
  }

  publish(alert: FraudAlert): void {
    for (const s of this.sinks) {
      try {
        const r = s.publish(alert);
        // Swallow promise; sinks own their own retry semantics.
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {});
        }
      } catch {
        // Sink-internal failures don't block fan-out to other sinks.
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => Promise.resolve(s.flush())));
  }

  publishedCount(): number {
    return this.sinks.reduce((s, x) => s + x.publishedCount(), 0);
  }
  pendingCount(): number {
    return this.sinks.reduce((s, x) => s + x.pendingCount(), 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Bridge — convert detector verdicts into fraud alerts
// ════════════════════════════════════════════════════════════════════════════

export interface FraudVerdictLike {
  classifier: string;
  score: number;
  threshold: number;
  features: Record<string, number | string>;
  playerId: string;
  sessionId?: string;
}

/**
 * Map a detector's verdict into a FraudAlert. Severity scaling:
 *   * score >= threshold + 0.5 → critical
 *   * score >= threshold      → warning
 *   * else                     → info (still emitted for audit log)
 *
 * `alertIdSeed` makes alertId deterministic — useful for replay.
 */
export function verdictToAlert(
  verdict: FraudVerdictLike,
  alertIdSeed: string,
  emittedAtUtc: string = new Date().toISOString(),
): FraudAlert {
  let severity: AlertSeverity;
  if (verdict.score >= verdict.threshold + 0.5) severity = 'critical';
  else if (verdict.score >= verdict.threshold) severity = 'warning';
  else severity = 'info';
  return {
    alertId: alertIdSeed,
    emittedAtUtc,
    severity,
    category: verdict.classifier,
    playerId: verdict.playerId,
    sessionId: verdict.sessionId,
    details: {
      score: verdict.score,
      threshold: verdict.threshold,
      features: verdict.features,
    },
  };
}
