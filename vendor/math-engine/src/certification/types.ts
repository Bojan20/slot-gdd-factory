/**
 * FAZA 14.2 — Continuous Certification Types
 *
 * Replaces the 5-year manual re-certification cycle with automated
 * daily statistical reporting + hash-chain integrity emission to
 * regulator inboxes (MGA/UKGC sandbox pilot).
 */

// ─── Config ────────────────────────────────────────────────────────────────

export interface ContinuousCertConfig {
  /** Game identifier (USIF `meta.id`). */
  gameId: string;
  /** Engine semantic version. */
  engineVersion: string;
  /** Jurisdiction for compliance gate (affects allowed RTP range). */
  jurisdiction: 'MGA' | 'UKGC' | 'ADM' | 'GLI' | 'generic';
  /** Target RTP from IR config. */
  targetRtp: number;
  /** Allowed RTP deviation from target before alarm (default ±0.02). */
  rtpTolerance?: number;
  /** Minimum spins before RTP is considered statistically valid (default 1_000_000). */
  minSpinsForValidity?: number;
  /** Transport(s) to deliver reports. At least one required for `emitToRegulator()`. */
  transports?: RegulatorTransport[];
  /** Report period in ms. Default: 86_400_000 (24h). */
  reportPeriodMs?: number;
}

// ─── Spin record (what we accumulate) ───────────────────────────────────────

export interface CertSpinRecord {
  /** Spin index (monotonically increasing). */
  spinIndex: number;
  /** Session identifier. */
  sessionId: string;
  /** Wager amount (normalized to base bet = 1.0). */
  bet: number;
  /** Win amount. */
  win: number;
  /** Whether a bonus feature triggered. */
  bonusTriggered: boolean;
  /** SHA-256 of canonical spin JSON (from recall module). */
  auditHash: string;
  /** Epoch ms. */
  timestampMs: number;
}

// ─── Daily report ───────────────────────────────────────────────────────────

export interface DailyRtpStats {
  totalSpins: number;
  totalWagered: number;
  totalPaid: number;
  rtp: number;
  hitRate: number;
  bonusFrequency: number;
  maxWin: number;
  /** Welford variance estimate. */
  rtpVariance: number;
  /** 95% confidence interval half-width. */
  rtpCI95: number;
}

export interface DailyHashChainSummary {
  /** SHA-256 of the first entry in the period. */
  periodStartHash: string;
  /** SHA-256 of the last entry in the period. */
  periodEndHash: string;
  /** Number of chain links verified intact. */
  verifiedLinks: number;
  /** Number of broken links (0 = integrity OK). */
  brokenLinks: number;
}

export interface DailyReport {
  /** Opaque ID: `${gameId}:${isoDate}` */
  reportId: string;
  gameId: string;
  engineVersion: string;
  jurisdiction: string;
  /** ISO-8601 date string of the reporting period. */
  periodDate: string;
  periodStartMs: number;
  periodEndMs: number;
  rtpStats: DailyRtpStats;
  hashChain: DailyHashChainSummary;
  complianceStatus: ComplianceStatus;
  /** Hex digest of this report's canonical JSON (self-attestation). */
  reportHash: string;
  generatedAtMs: number;
}

// ─── Compliance ──────────────────────────────────────────────────────────────

export type ComplianceFlag =
  | 'rtp_below_minimum'
  | 'rtp_above_maximum'
  | 'rtp_drift_from_target'
  | 'insufficient_spins'
  | 'hash_chain_broken'
  | 'rtp_ci_too_wide';

export interface ComplianceStatus {
  compliant: boolean;
  flags: ComplianceFlag[];
  /** Human-readable summary for regulator. */
  summary: string;
}

// ─── Certification event (emitted per report) ────────────────────────────────

export type CertificationEvent =
  | { kind: 'report_generated'; report: DailyReport }
  | { kind: 'compliance_alarm'; reportId: string; flags: ComplianceFlag[] }
  | { kind: 'hash_chain_breach'; reportId: string; brokenLinks: number }
  | { kind: 'regulator_delivery_ok'; reportId: string; transport: string }
  | { kind: 'regulator_delivery_failed'; reportId: string; transport: string; reason: string };

// ─── Regulator transport ─────────────────────────────────────────────────────

export interface RegulatorTransport {
  /** Transport identifier for logging. */
  id: string;
  /** Deliver a report. Resolve on success, reject on failure. */
  deliver(report: DailyReport): Promise<void>;
}

/** In-memory transport for testing. */
export class InMemoryTransport implements RegulatorTransport {
  public readonly id: string;
  public readonly inbox: DailyReport[] = [];

  constructor(id = 'in-memory') {
    this.id = id;
  }

  async deliver(report: DailyReport): Promise<void> {
    this.inbox.push(report);
  }
}

/** Failing transport for resilience tests. */
export class FailingTransport implements RegulatorTransport {
  public readonly id: string;
  public readonly failureReason: string;

  constructor(id = 'failing', failureReason = 'Network unreachable') {
    this.id = id;
    this.failureReason = failureReason;
  }

  async deliver(_report: DailyReport): Promise<void> {
    throw new Error(this.failureReason);
  }
}
