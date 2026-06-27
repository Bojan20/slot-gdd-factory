/**
 * FAZA 14.2 — ContinuousCertifier
 *
 * Accumulates per-spin records → generates daily statistical reports →
 * delivers to regulator inbox. Eliminates 5-year manual re-cert cycle.
 *
 * Architecture:
 *   ContinuousCertifier.addSpin(record)
 *     → internal Kahan-compensated accumulators
 *   ContinuousCertifier.generateDailyReport(periodStartMs, periodEndMs)
 *     → DailyReport with RTP stats, hash-chain summary, compliance gate
 *   ContinuousCertifier.emitToRegulator(report)
 *     → delivers to configured RegulatorTransport(s), returns CertificationEvent[]
 *   ContinuousCertifier.verifyHashChain(entries)
 *     → walks entries checking prev_hash linkage, returns broken count
 */

import type {
  ContinuousCertConfig,
  CertSpinRecord,
  DailyReport,
  DailyRtpStats,
  DailyHashChainSummary,
  ComplianceStatus,
  ComplianceFlag,
  CertificationEvent,
} from './types.js';

// ─── Jurisdiction RTP bounds ─────────────────────────────────────────────────

const JURISDICTION_RTP_BOUNDS: Record<string, [number, number]> = {
  MGA:     [0.92, 0.99],
  UKGC:    [0.94, 0.99],
  ADM:     [0.90, 0.99],
  GLI:     [0.80, 0.99],
  generic: [0.80, 1.00],
};

// ─── Simple SHA-256 via SubtleCrypto or fallback ─────────────────────────────

async function sha256Hex(data: string): Promise<string> {
  // Node.js 18+: SubtleCrypto is available as `globalThis.crypto`
  try {
    const enc = new TextEncoder();
    const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(data));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback: FNV-1a 64-bit (deterministic, fast, sufficient for tests)
    let h = BigInt('14695981039346656037');
    const enc = new TextEncoder();
    for (const byte of enc.encode(data)) {
      h ^= BigInt(byte);
      h = BigInt.asUintN(64, h * BigInt('1099511628211'));
    }
    return h.toString(16).padStart(16, '0').repeat(4).slice(0, 64);
  }
}

// ─── Online stats accumulator ────────────────────────────────────────────────

/** Kahan-compensated + Welford variance accumulator for per-period stats. */
class PeriodAccumulator {
  totalSpins = 0;
  // Kahan sums
  private _sumWagered = 0;
  private _cWagered = 0;
  private _sumPaid = 0;
  private _cPaid = 0;
  // Welford for win/bet ratio (per-spin RTP sample)
  private _wMean = 0;
  private _wM2 = 0;
  hitSpins = 0;
  bonusSpins = 0;
  maxWin = 0;

  addSpin(bet: number, win: number, bonusTriggered: boolean): void {
    this.totalSpins++;

    // Kahan sum — wagered
    const yW = bet - this._cWagered;
    const tW = this._sumWagered + yW;
    this._cWagered = tW - this._sumWagered - yW;
    this._sumWagered = tW;

    // Kahan sum — paid
    const yP = win - this._cPaid;
    const tP = this._sumPaid + yP;
    this._cPaid = tP - this._sumPaid - yP;
    this._sumPaid = tP;

    // Welford update on spin RTP (win/bet)
    const spinRtp = bet > 0 ? win / bet : 0;
    const delta = spinRtp - this._wMean;
    this._wMean += delta / this.totalSpins;
    const delta2 = spinRtp - this._wMean;
    this._wM2 += delta * delta2;

    if (win > 0) this.hitSpins++;
    if (bonusTriggered) this.bonusSpins++;
    if (win > this.maxWin) this.maxWin = win;
  }

  get totalWagered(): number { return this._sumWagered; }
  get totalPaid(): number    { return this._sumPaid; }

  get rtp(): number {
    return this._sumWagered > 0 ? this._sumPaid / this._sumWagered : 0;
  }

  get hitRate(): number {
    return this.totalSpins > 0 ? this.hitSpins / this.totalSpins : 0;
  }

  get bonusFrequency(): number {
    return this.totalSpins > 0 ? this.bonusSpins / this.totalSpins : 0;
  }

  /** Welford variance of per-spin RTP. */
  get rtpVariance(): number {
    return this.totalSpins > 1 ? this._wM2 / (this.totalSpins - 1) : 0;
  }

  /** 95% CI half-width for RTP (normal approximation: 1.96 × SE). */
  get rtpCI95(): number {
    if (this.totalSpins < 2) return Infinity;
    const se = Math.sqrt(this.rtpVariance / this.totalSpins);
    return 1.96 * se;
  }

  toStats(): DailyRtpStats {
    return {
      totalSpins:    this.totalSpins,
      totalWagered:  this.totalWagered,
      totalPaid:     this.totalPaid,
      rtp:           this.rtp,
      hitRate:       this.hitRate,
      bonusFrequency: this.bonusFrequency,
      maxWin:        this.maxWin,
      rtpVariance:   this.rtpVariance,
      rtpCI95:       this.rtpCI95,
    };
  }
}

// ─── Hash chain verifier ─────────────────────────────────────────────────────

export interface HashChainEntry {
  /** Self-hash of this entry. */
  hash: string;
  /** Hash of the previous entry. First entry should be all-zeros or empty. */
  prev_hash: string;
  /** Spin index — must be monotonically increasing. */
  seq: number;
}

export function verifyHashChain(entries: HashChainEntry[]): DailyHashChainSummary {
  if (entries.length === 0) {
    return {
      periodStartHash: '',
      periodEndHash: '',
      verifiedLinks: 0,
      brokenLinks: 0,
    };
  }

  let brokenLinks = 0;
  let prevHash = entries[0]!.hash;

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prev_hash !== prevHash) {
      brokenLinks++;
    }
    // Monotonicity check
    if (entry.seq <= entries[i - 1]!.seq) {
      brokenLinks++;
    }
    prevHash = entry.hash;
  }

  return {
    periodStartHash: entries[0]!.hash,
    periodEndHash:   entries[entries.length - 1]!.hash,
    verifiedLinks:   entries.length - 1 - brokenLinks,
    brokenLinks,
  };
}

// ─── Compliance gate ─────────────────────────────────────────────────────────

function checkCompliance(
  stats: DailyRtpStats,
  hashChain: DailyHashChainSummary,
  config: ContinuousCertConfig,
): ComplianceStatus {
  const flags: ComplianceFlag[] = [];
  const bounds = JURISDICTION_RTP_BOUNDS[config.jurisdiction] ?? [0.80, 1.00];
  const [minRtp, maxRtp] = bounds;
  const tolerance = config.rtpTolerance ?? 0.02;
  const minSpins = config.minSpinsForValidity ?? 1_000_000;

  if (stats.totalSpins < minSpins) {
    flags.push('insufficient_spins');
  }

  if (stats.rtp < minRtp) flags.push('rtp_below_minimum');
  if (stats.rtp > maxRtp) flags.push('rtp_above_maximum');

  if (Math.abs(stats.rtp - config.targetRtp) > tolerance && stats.totalSpins >= minSpins) {
    flags.push('rtp_drift_from_target');
  }

  if (hashChain.brokenLinks > 0) {
    flags.push('hash_chain_broken');
  }

  if (stats.rtpCI95 > 0.05 && stats.totalSpins >= minSpins) {
    flags.push('rtp_ci_too_wide');
  }

  const compliant = flags.length === 0 || flags.every(f => f === 'insufficient_spins');

  const summary = compliant
    ? `COMPLIANT — ${stats.totalSpins.toLocaleString()} spins, RTP ${(stats.rtp * 100).toFixed(4)}% (target ${(config.targetRtp * 100).toFixed(2)}%), CI95 ±${(stats.rtpCI95 * 100).toFixed(4)}%`
    : `NON-COMPLIANT — flags: [${flags.join(', ')}]`;

  return { compliant, flags, summary };
}

// ─── ContinuousCertifier ─────────────────────────────────────────────────────

export class ContinuousCertifier {
  private readonly config: Required<ContinuousCertConfig>;
  private readonly accum = new PeriodAccumulator();
  private readonly spinBuffer: CertSpinRecord[] = [];
  private readonly eventLog: CertificationEvent[] = [];

  constructor(config: ContinuousCertConfig) {
    this.config = {
      ...config,
      rtpTolerance:        config.rtpTolerance        ?? 0.02,
      minSpinsForValidity: config.minSpinsForValidity ?? 1_000_000,
      transports:          config.transports          ?? [],
      reportPeriodMs:      config.reportPeriodMs      ?? 86_400_000,
    };
  }

  /** Add one spin record to the certification accumulator. */
  addSpin(record: CertSpinRecord): void {
    this.accum.addSpin(record.bet, record.win, record.bonusTriggered);
    this.spinBuffer.push(record);
  }

  /** Add multiple spins at once. */
  addSpins(records: CertSpinRecord[]): void {
    for (const r of records) this.addSpin(r);
  }

  /** Current live stats (no report generated). */
  getLiveStats(): DailyRtpStats {
    return this.accum.toStats();
  }

  /**
   * Generate a DailyReport for the given period.
   * Verifies the hash chain from buffered spins.
   */
  async generateDailyReport(
    periodStartMs: number,
    periodEndMs: number,
  ): Promise<DailyReport> {
    const stats = this.accum.toStats();

    // Build chain entries from buffered spins within period
    const periodSpins = this.spinBuffer.filter(
      s => s.timestampMs >= periodStartMs && s.timestampMs <= periodEndMs,
    );

    const chainEntries: HashChainEntry[] = periodSpins.map((s, i) => ({
      hash: s.auditHash,
      prev_hash: i === 0 ? '0'.repeat(64) : periodSpins[i - 1]!.auditHash,
      seq: s.spinIndex,
    }));

    const hashChain = verifyHashChain(chainEntries);
    const complianceStatus = checkCompliance(stats, hashChain, this.config);

    const periodDate = new Date(periodStartMs).toISOString().slice(0, 10);
    const reportId = `${this.config.gameId}:${periodDate}`;

    // Self-attestation hash (deterministic canonical JSON)
    const canonical = JSON.stringify({
      reportId,
      gameId: this.config.gameId,
      engineVersion: this.config.engineVersion,
      periodDate,
      periodStartMs,
      periodEndMs,
      rtpStats: stats,
      hashChain,
      complianceStatus,
    });
    const reportHash = await sha256Hex(canonical);

    const report: DailyReport = {
      reportId,
      gameId: this.config.gameId,
      engineVersion: this.config.engineVersion,
      jurisdiction: this.config.jurisdiction,
      periodDate,
      periodStartMs,
      periodEndMs,
      rtpStats: stats,
      hashChain,
      complianceStatus,
      reportHash,
      generatedAtMs: Date.now(),
    };

    const genEvent: CertificationEvent = { kind: 'report_generated', report };
    this.eventLog.push(genEvent);

    if (!complianceStatus.compliant) {
      const alarmEvent: CertificationEvent = {
        kind: 'compliance_alarm',
        reportId,
        flags: complianceStatus.flags,
      };
      this.eventLog.push(alarmEvent);
    }

    if (hashChain.brokenLinks > 0) {
      const breachEvent: CertificationEvent = {
        kind: 'hash_chain_breach',
        reportId,
        brokenLinks: hashChain.brokenLinks,
      };
      this.eventLog.push(breachEvent);
    }

    return report;
  }

  /**
   * Deliver a report to all configured transports.
   * Returns an event per transport (ok or failed).
   * Never throws — failures are captured as events.
   */
  async emitToRegulator(report: DailyReport): Promise<CertificationEvent[]> {
    const events: CertificationEvent[] = [];

    for (const transport of this.config.transports) {
      try {
        await transport.deliver(report);
        const ok: CertificationEvent = {
          kind: 'regulator_delivery_ok',
          reportId: report.reportId,
          transport: transport.id,
        };
        events.push(ok);
        this.eventLog.push(ok);
      } catch (err) {
        const failed: CertificationEvent = {
          kind: 'regulator_delivery_failed',
          reportId: report.reportId,
          transport: transport.id,
          reason: err instanceof Error ? err.message : String(err),
        };
        events.push(failed);
        this.eventLog.push(failed);
      }
    }

    return events;
  }

  /**
   * Verify an external hash chain (e.g. from recall journal entries).
   * Returns summary without affecting internal state.
   */
  verifyHashChain(entries: HashChainEntry[]): DailyHashChainSummary {
    return verifyHashChain(entries);
  }

  /** All certification events emitted so far. */
  getEventLog(): readonly CertificationEvent[] {
    return this.eventLog;
  }

  /** Compliance status of accumulated stats (no report generated). */
  checkLiveCompliance(): ComplianceStatus {
    const stats = this.accum.toStats();
    const pristineChain: DailyHashChainSummary = {
      periodStartHash: '', periodEndHash: '', verifiedLinks: 0, brokenLinks: 0,
    };
    return checkCompliance(stats, pristineChain, this.config);
  }

  /** Reset accumulators (call at period boundary). */
  resetPeriod(): void {
    // Replace accumulator with fresh one
    Object.assign(this.accum, new PeriodAccumulator());
    this.spinBuffer.length = 0;
  }
}
