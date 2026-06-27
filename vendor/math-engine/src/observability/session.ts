import type {
  ObservabilityMode,
  SpinRecord,
  FeatureContribution,
  AlertThreshold,
  AlertFired,
  SessionSnapshot,
  ObservabilityReport,
  PercentileStats,
} from './types.js';

// ─── Histogram bucket helpers ─────────────────────────────────────────────

const HISTOGRAM_BUCKETS = ['0', '0-1', '1-5', '5-25', '25-100', '100-500', '500+'] as const;

function histogramBucket(payout: number): string {
  if (payout === 0) return '0';
  if (payout < 1) return '0-1';
  if (payout < 5) return '1-5';
  if (payout < 25) return '5-25';
  if (payout < 100) return '25-100';
  if (payout < 500) return '100-500';
  return '500+';
}

// ─── Percentile computation from sorted array ─────────────────────────────

function computePercentiles(sorted: number[]): PercentileStats {
  if (sorted.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const n = sorted.length;
  const at = (pct: number): number => {
    const idx = Math.min(Math.floor(pct * n), n - 1);
    return sorted[idx] ?? 0;
  };
  return {
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[n - 1] ?? 0,
  };
}

// ─── ObservabilitySession ─────────────────────────────────────────────────

export class ObservabilitySession {
  readonly sessionId: string;
  readonly mode: ObservabilityMode;
  private readonly startMs: number;

  // Kahan compensated sums
  private _totalBet = 0;
  private _betCompensation = 0;
  private _totalPayout = 0;
  private _payoutCompensation = 0;

  // Spin counts
  private _totalSpins = 0;
  private _winSpins = 0;

  // Dry spell tracking
  private _drySpellCurrent = 0;
  private _drySpellMax = 0;

  // Per-feature data: kind → { hitCount, totalPayout }
  private _featureMap = new Map<string, { hitCount: number; totalPayout: number }>();

  // Welford online variance (dev mode only)
  private _welfM2 = 0;   // sum of squared deviations
  private _welfMean = 0; // running mean for Welford

  // Reservoir sampling (Algorithm R, max 10,000, dev mode only)
  private readonly RESERVOIR_SIZE = 10_000;
  private _reservoir: number[] = [];
  private _reservoirFull = false;

  // Alert thresholds and de-bounce
  private _alertThresholds: AlertThreshold[] = [];
  private _alertsFired: AlertFired[] = [];
  // de-bounce: threshold-key → last spinIndex when fired
  private _alertDebounce = new Map<string, number>();
  private readonly DEBOUNCE_SPINS = 1000;

  constructor(sessionId: string, mode: ObservabilityMode, thresholds: AlertThreshold[] = []) {
    this.sessionId = sessionId;
    this.mode = mode;
    this._alertThresholds = thresholds;
    this.startMs = Date.now();
  }

  // ── Kahan addition ────────────────────────────────────────────────────────

  private kahanAddBet(value: number): void {
    const y = value - this._betCompensation;
    const t = this._totalBet + y;
    this._betCompensation = t - this._totalBet - y;
    this._totalBet = t;
  }

  private kahanAddPayout(value: number): void {
    const y = value - this._payoutCompensation;
    const t = this._totalPayout + y;
    this._payoutCompensation = t - this._totalPayout - y;
    this._totalPayout = t;
  }

  // ── Welford online variance update ────────────────────────────────────────

  private welfordUpdate(x: number): void {
    // Only in dev mode
    const n = this._totalSpins; // already incremented before this call
    const delta = x - this._welfMean;
    this._welfMean += delta / n;
    const delta2 = x - this._welfMean;
    this._welfM2 += delta * delta2;
  }

  // ── Algorithm R reservoir sampling ───────────────────────────────────────

  private reservoirSample(x: number): void {
    const n = this._totalSpins; // already incremented
    if (this._reservoir.length < this.RESERVOIR_SIZE) {
      this._reservoir.push(x);
      if (this._reservoir.length === this.RESERVOIR_SIZE) {
        this._reservoirFull = true;
      }
    } else {
      // Algorithm R: replace random element with probability RESERVOIR_SIZE/n
      const j = Math.floor(Math.random() * n);
      if (j < this.RESERVOIR_SIZE) {
        this._reservoir[j] = x;
      }
    }
  }

  // ── Alert threshold key for de-bouncing ──────────────────────────────────

  private alertKey(t: AlertThreshold): string {
    return `${t.metric}:${t.min ?? ''}:${t.max ?? ''}`;
  }

  // ── Alert checking ────────────────────────────────────────────────────────

  private checkAlerts(): void {
    if (this._alertThresholds.length === 0) return;

    const rtp = this._totalBet > 0 ? this._totalPayout / this._totalBet : 0;
    const hitRate = this._totalSpins > 0 ? this._winSpins / this._totalSpins : 0;

    for (const threshold of this._alertThresholds) {
      const key = this.alertKey(threshold);
      const lastFired = this._alertDebounce.get(key) ?? -this.DEBOUNCE_SPINS;
      if (this._totalSpins - lastFired < this.DEBOUNCE_SPINS) continue;

      let actual: number;
      if (threshold.metric === 'rtp') {
        actual = rtp;
      } else {
        actual = hitRate;
      }

      let triggered = false;
      let message = '';
      if (threshold.min !== undefined && actual < threshold.min) {
        triggered = true;
        message = `${threshold.metric} ${actual.toFixed(4)} below min ${threshold.min}`;
      } else if (threshold.max !== undefined && actual > threshold.max) {
        triggered = true;
        message = `${threshold.metric} ${actual.toFixed(4)} above max ${threshold.max}`;
      }

      if (triggered) {
        this._alertsFired.push({
          threshold,
          actual,
          spinIndex: this._totalSpins,
          message,
        });
        this._alertDebounce.set(key, this._totalSpins);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  recordSpin(spin: SpinRecord): void {
    this._totalSpins++;

    // Kahan sums
    this.kahanAddBet(spin.bet);
    this.kahanAddPayout(spin.payout);

    // Win tracking
    const isWin = spin.payout > 0;
    if (isWin) {
      this._winSpins++;
      this._drySpellCurrent = 0;
    } else {
      this._drySpellCurrent++;
      if (this._drySpellCurrent > this._drySpellMax) {
        this._drySpellMax = this._drySpellCurrent;
      }
    }

    // Welford (dev mode only)
    if (this.mode === 'dev') {
      this.welfordUpdate(spin.payout);
      this.reservoirSample(spin.payout);
    }

    // Per-feature tracking
    for (const hit of spin.features) {
      const existing = this._featureMap.get(hit.kind);
      if (existing) {
        existing.hitCount++;
        existing.totalPayout += hit.payout;
      } else {
        this._featureMap.set(hit.kind, { hitCount: 1, totalPayout: hit.payout });
      }
    }

    // Alert check
    this.checkAlerts();
  }

  snapshot(): SessionSnapshot {
    const rtp = this._totalBet > 0 ? this._totalPayout / this._totalBet : 0;
    const hitRate = this._totalSpins > 0 ? this._winSpins / this._totalSpins : 0;
    const avgPayout = this._totalSpins > 0 ? this._totalPayout / this._totalSpins : 0;

    // Build feature contributions
    const featureContributions: FeatureContribution[] = [];
    for (const [kind, data] of this._featureMap) {
      featureContributions.push({
        featureKind: kind,
        hitCount: data.hitCount,
        totalPayout: data.totalPayout,
        avgPayout: data.hitCount > 0 ? data.totalPayout / data.hitCount : 0,
        contributionPct:
          this._totalPayout > 0 ? (data.totalPayout / this._totalPayout) * 100 : 0,
      });
    }
    // Sort by totalPayout descending
    featureContributions.sort((a, b) => b.totalPayout - a.totalPayout);

    return {
      sessionId: this.sessionId,
      mode: this.mode,
      totalSpins: this._totalSpins,
      totalBet: this._totalBet,
      totalPayout: this._totalPayout,
      rtp,
      hitRate,
      winSpins: this._winSpins,
      featureContributions,
      avgPayout,
      drySpellCurrent: this._drySpellCurrent,
      drySpellMax: this._drySpellMax,
      alertsFired: [...this._alertsFired],
      elapsedMs: Date.now() - this.startMs,
    };
  }

  finalize(): ObservabilityReport {
    const snap = this.snapshot();
    const report: ObservabilityReport = {
      ...snap,
      finalizedAt: Date.now(),
    };

    if (this.mode === 'dev') {
      // Variance: Welford M2 / (n - 1) for sample variance
      if (this._totalSpins > 1) {
        const variance = this._welfM2 / (this._totalSpins - 1);
        report.variance = variance;
        report.stdDev = Math.sqrt(variance);
      } else {
        report.variance = 0;
        report.stdDev = 0;
      }

      // Percentiles from sorted reservoir
      const sorted = [...this._reservoir].sort((a, b) => a - b);
      report.percentiles = computePercentiles(sorted);

      // Histogram
      const histogram: Record<string, number> = {};
      for (const bucket of HISTOGRAM_BUCKETS) {
        histogram[bucket] = 0;
      }
      for (const val of this._reservoir) {
        const bucket = histogramBucket(val);
        histogram[bucket] = (histogram[bucket] ?? 0) + 1;
      }
      report.payoutHistogram = histogram;
    }

    return report;
  }
}
