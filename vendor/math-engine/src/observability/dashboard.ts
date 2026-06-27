import { ObservabilitySession } from './session.js';
import type { AlertThreshold, ObservabilityMode } from './types.js';

// ─── Dashboard options ────────────────────────────────────────────────────

export interface CreateSessionOptions {
  sessionId?: string;
  mode?: ObservabilityMode;
  thresholds?: AlertThreshold[];
}

// ─── ObservabilityDashboard ───────────────────────────────────────────────

let _sessionCounter = 0;

export class ObservabilityDashboard {
  private _sessions = new Map<string, ObservabilitySession>();

  createSession(opts: CreateSessionOptions = {}): ObservabilitySession {
    const id = opts.sessionId ?? `session-${++_sessionCounter}-${Date.now()}`;
    const mode = opts.mode ?? 'dev';
    const session = new ObservabilitySession(id, mode, opts.thresholds ?? []);
    this._sessions.set(id, session);
    return session;
  }

  getSession(id: string): ObservabilitySession | undefined {
    return this._sessions.get(id);
  }

  getSessions(): ObservabilitySession[] {
    return Array.from(this._sessions.values());
  }

  removeSession(id: string): boolean {
    return this._sessions.delete(id);
  }

  formatLive(session: ObservabilitySession): string {
    const snap = session.snapshot();
    const rtpPct = (snap.rtp * 100).toFixed(2);
    const hitRatePct = (snap.hitRate * 100).toFixed(2);
    const topFeature =
      snap.featureContributions.length > 0
        ? snap.featureContributions[0]?.featureKind ?? 'none'
        : 'none';
    return `[${snap.sessionId}] spins=${snap.totalSpins} RTP=${rtpPct}% hitRate=${hitRatePct}% dryMax=${snap.drySpellMax} topFeature=${topFeature}`;
  }

  formatReport(session: ObservabilitySession): string {
    const report = session.finalize();
    const lines: string[] = [
      `=== Observability Report: ${report.sessionId} ===`,
      `Mode         : ${report.mode}`,
      `Total Spins  : ${report.totalSpins}`,
      `Total Bet    : ${report.totalBet.toFixed(4)}`,
      `Total Payout : ${report.totalPayout.toFixed(4)}`,
      `RTP          : ${(report.rtp * 100).toFixed(4)}%`,
      `Hit Rate     : ${(report.hitRate * 100).toFixed(4)}%`,
      `Win Spins    : ${report.winSpins}`,
      `Avg Payout   : ${report.avgPayout.toFixed(4)}`,
      `Dry Spell Max: ${report.drySpellMax}`,
      `Dry Spell Cur: ${report.drySpellCurrent}`,
      `Elapsed      : ${report.elapsedMs}ms`,
      `Finalized At : ${new Date(report.finalizedAt).toISOString()}`,
      '',
      '--- Feature Contributions ---',
    ];

    if (report.featureContributions.length === 0) {
      lines.push('  (none)');
    } else {
      for (const fc of report.featureContributions) {
        lines.push(
          `  ${fc.featureKind}: hits=${fc.hitCount} totalPayout=${fc.totalPayout.toFixed(4)} avg=${fc.avgPayout.toFixed(4)} contrib=${fc.contributionPct.toFixed(2)}%`,
        );
      }
    }

    if (report.variance !== undefined) {
      lines.push('');
      lines.push('--- Statistics (dev mode) ---');
      lines.push(`  Variance  : ${report.variance.toFixed(6)}`);
      lines.push(`  StdDev    : ${(report.stdDev ?? 0).toFixed(6)}`);
    }

    if (report.percentiles) {
      lines.push('');
      lines.push('--- Percentiles ---');
      lines.push(`  p50=${report.percentiles.p50.toFixed(4)} p90=${report.percentiles.p90.toFixed(4)} p95=${report.percentiles.p95.toFixed(4)} p99=${report.percentiles.p99.toFixed(4)} max=${report.percentiles.max.toFixed(4)}`);
    }

    if (report.payoutHistogram) {
      lines.push('');
      lines.push('--- Payout Histogram ---');
      for (const [bucket, count] of Object.entries(report.payoutHistogram)) {
        lines.push(`  ${bucket}: ${count}`);
      }
    }

    if (report.alertsFired.length > 0) {
      lines.push('');
      lines.push('--- Alerts Fired ---');
      for (const alert of report.alertsFired) {
        lines.push(`  [spin ${alert.spinIndex}] ${alert.message}`);
      }
    }

    lines.push('');
    lines.push('=== End Report ===');

    return lines.join('\n');
  }

  exportJSON(session: ObservabilitySession): string {
    return JSON.stringify(session.finalize());
  }
}

// ─── Global singleton ─────────────────────────────────────────────────────

export const globalDashboard = new ObservabilityDashboard();
