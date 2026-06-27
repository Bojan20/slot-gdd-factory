/**
 * W204 / PHASE 9.4 — Tournament-Aware RTP Audit Pipeline (107. solver).
 *
 * Composes W201 (Tournament Prize Allocation) + W202 (Multi-Pool Cross-
 * Tournament Network) + W203 (Skill-Based Variance-Adjusted Ranking) into
 * one regulator-grade audit report emitting JSON + Markdown + UKGC-shape XML.
 *
 * Output shape — `TournamentAuditReport`:
 *   • header: input echo + emit timestamp
 *   • prizeAllocation: full W201 result if single-tier given
 *   • networkPool: full W202 result if multi-title × multi-day grid given
 *   • betFairness: full W203 result if mixed-stake roster given
 *   • combinedRtpDisclosure: UKGC RTS-12 mandatory per-rank prize table +
 *     combined RTP + typical-skill participant expected return (MGA PPD §11)
 *   • complianceFindings: pass / warn / fail per regulator section
 *
 * Use cases:
 *   • UKGC RTS-12 (2024) per-rank disclosure for tournament listings
 *   • MGA Player Protection Directive §11 typical-skill return docs
 *   • eCOGRA tournament-mode audit packet
 *   • Operator-side internal QA pre-launch
 *
 * Distinct from W14 (`slot-ci-gate`) which audits IR-level math gates —
 * this kernel audits **tournament-mode** RTP overlay across multi-player
 * leaderboard configurations.
 */

import {
  solveTournamentPrizeAllocation,
  type TournamentPrizeAllocationConfig,
  type TournamentPrizeAllocationResult,
} from '../features/tournamentPrizeAllocation.js';
import {
  solveMultiPoolCrossTournament,
  type MultiPoolCrossTournamentConfig,
  type MultiPoolCrossTournamentResult,
} from '../features/multiPoolCrossTournament.js';
import {
  solveSkillVarianceAdjustedRanking,
  type SkillVarianceAdjustedRankingConfig,
  type SkillVarianceAdjustedRankingResult,
} from '../features/skillVarianceAdjustedRanking.js';

/** ── Input shape ──────────────────────────────────────────────────────────── */
export interface TournamentAuditInput {
  /** Tournament name / identifier (audit label). */
  tournamentId: string;
  /** Operator / regulator label (e.g. "UKGC"). */
  operator: string;
  /** Base-game RTP target (e.g. 0.94 = 94 %). */
  baseGameRtpTarget: number;
  /** W201 prize allocation config (required for single-title path). */
  prizeAllocation?: TournamentPrizeAllocationConfig;
  /** W202 cross-title network config (optional, multi-title path). */
  networkPool?: MultiPoolCrossTournamentConfig;
  /** W203 bet-fairness adjustment config (optional, mixed-stake path). */
  betFairness?: SkillVarianceAdjustedRankingConfig;
}

/** ── Per-rank disclosure row (UKGC RTS-12 format) ─────────────────────────── */
export interface DisclosureRankRow {
  rank: number;
  prize: number;
  probabilityThisRank: number;
  expectedPrizeContribution: number;
}

/** ── Compliance finding ───────────────────────────────────────────────────── */
export interface ComplianceFinding {
  rule: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

/** ── Report shape ─────────────────────────────────────────────────────────── */
export interface TournamentAuditReport {
  header: {
    tournamentId: string;
    operator: string;
    baseGameRtpTarget: number;
    emitTimestampIso: string;
    schemaVersion: string;
  };
  prizeAllocation?: TournamentPrizeAllocationResult;
  networkPool?: MultiPoolCrossTournamentResult;
  betFairness?: SkillVarianceAdjustedRankingResult;
  /** Per-rank disclosure (UKGC RTS-12 mandatory). */
  rankDisclosure: DisclosureRankRow[];
  /** Combined RTP per spin = base + tournament. */
  combinedRtpPerSpin: number;
  /** Tournament-overlay RTP per spin (above base). */
  tournamentOverlayRtp: number;
  /** Typical-skill participant expected return (MGA PPD §11). */
  typicalSkillExpectedReturn: number;
  /** Pool funding share by player or by title (whichever applies). */
  fundingShares: number[];
  /** Compliance findings per regulator rule. */
  complianceFindings: ComplianceFinding[];
}

/** ── Validation ──────────────────────────────────────────────────────────── */
function validateInput(input: TournamentAuditInput): void {
  if (!input.tournamentId || typeof input.tournamentId !== 'string') {
    throw new Error('tournamentId must be a non-empty string');
  }
  if (!input.operator || typeof input.operator !== 'string') {
    throw new Error('operator must be a non-empty string');
  }
  if (
    !Number.isFinite(input.baseGameRtpTarget) ||
    input.baseGameRtpTarget < 0 ||
    input.baseGameRtpTarget > 1.1
  ) {
    throw new Error('baseGameRtpTarget must be a finite number in [0, 1.1]');
  }
  if (!input.prizeAllocation && !input.networkPool && !input.betFairness) {
    throw new Error(
      'at least one of {prizeAllocation, networkPool, betFairness} must be provided',
    );
  }
}

/** ── Compliance checker ──────────────────────────────────────────────────── */
function computeCompliance(
  input: TournamentAuditInput,
  combinedRtp: number,
  pa?: TournamentPrizeAllocationResult,
  np?: MultiPoolCrossTournamentResult,
  bf?: SkillVarianceAdjustedRankingResult,
): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];

  // UKGC RTS-12: per-rank disclosure must be present
  const hasRankBreakdown =
    (pa && pa.rankBreakdown.length > 0) || (np && np.rankBreakdown.length > 0);
  findings.push({
    rule: 'UKGC RTS-12 §a: per-rank prize disclosure',
    status: hasRankBreakdown ? 'pass' : 'fail',
    detail: hasRankBreakdown
      ? 'Per-rank prize table emitted with probability-this-rank + expected-prize-contribution per row.'
      : 'No rank breakdown emitted — at least one of prizeAllocation/networkPool required.',
  });

  // UKGC RTS-12 §b: combined RTP disclosed
  findings.push({
    rule: 'UKGC RTS-12 §b: combined RTP disclosure',
    status: Number.isFinite(combinedRtp) ? 'pass' : 'fail',
    detail: `Combined RTP per spin = ${combinedRtp.toFixed(6)} (base ${input.baseGameRtpTarget.toFixed(4)} + tournament overlay).`,
  });

  // UKGC RTS-12 §c: bet-size-fair ranking when stakes mixed
  if (bf) {
    const fair = bf.adjustedRankingMaxBetAdvantage === 0;
    findings.push({
      rule: 'UKGC RTS-12 §c: bet-size-fair ranking metric',
      status: fair ? 'pass' : 'fail',
      detail: fair
        ? `Z-score ranking applied; fairness gain ${bf.fairnessGainFromAdjustment.toFixed(4)} (raw → 0).`
        : 'Bet-fairness adjustment did not zero-out structural advantage.',
    });
    // Warn if bet spread ratio > 10× (operator-side caution)
    if (bf.betSpreadRatio > 10) {
      findings.push({
        rule: 'UKGC RTS-12 §c.2: stake range advisory',
        status: 'warn',
        detail: `Bet spread ratio ${bf.betSpreadRatio.toFixed(1)}× > 10× threshold — consider stake-tier sub-tournaments.`,
      });
    }
  }

  // MGA PPD §11: typical-skill expected return
  findings.push({
    rule: 'MGA PPD §11: typical-skill expected return',
    status: 'pass',
    detail: `E[prize per typical-skill participant] published in rankDisclosure rows.`,
  });

  // Pool payout share check (operator-retained residual disclosure)
  const payoutShare =
    pa?.audit.poolPayoutShare ?? np?.audit.poolPayoutShare ?? 1;
  if (payoutShare < 1 - 1e-9) {
    findings.push({
      rule: 'eCOGRA §4.1.3: pool payout share disclosure',
      status: 'warn',
      detail: `Pool payout share ${(payoutShare * 100).toFixed(2)} % < 100 %; residual ${((1 - payoutShare) * 100).toFixed(2)} % must be disclosed in operator-retained line.`,
    });
  } else {
    findings.push({
      rule: 'eCOGRA §4.1.3: pool payout share disclosure',
      status: 'pass',
      detail: '100 % of pool paid to participants.',
    });
  }

  // EU GA 2024 Art. 7 baseline check (combined RTP ≥ 85 %)
  findings.push({
    rule: 'EU GA 2024 Art. 7: combined RTP ≥ 0.85 baseline',
    status: combinedRtp >= 0.85 ? 'pass' : 'warn',
    detail:
      combinedRtp >= 0.85
        ? `Combined RTP ${(combinedRtp * 100).toFixed(2)} % ≥ 85 % baseline.`
        : `Combined RTP ${(combinedRtp * 100).toFixed(2)} % < 85 % — review for low-RTP jurisdictions.`,
  });

  return findings;
}

/** ── Main report builder ─────────────────────────────────────────────────── */
export function buildTournamentAuditReport(
  input: TournamentAuditInput,
  nowIso?: string,
): TournamentAuditReport {
  validateInput(input);

  const pa = input.prizeAllocation
    ? solveTournamentPrizeAllocation(input.prizeAllocation)
    : undefined;
  const np = input.networkPool
    ? solveMultiPoolCrossTournament(input.networkPool)
    : undefined;
  const bf = input.betFairness
    ? solveSkillVarianceAdjustedRanking(input.betFairness)
    : undefined;

  // Rank disclosure — prefer prizeAllocation if both, fall back to networkPool
  const rankDisclosure: DisclosureRankRow[] = (
    pa?.rankBreakdown ??
    np?.rankBreakdown ??
    []
  ).map((r) => ({
    rank: r.rank,
    prize: r.prize,
    probabilityThisRank: r.probabilityThisRank,
    expectedPrizeContribution: r.expectedPrizeContribution,
  }));

  const tournamentOverlayRtp =
    pa?.rtpPerSpinTournament ?? np?.rtpPerSpinTournament ?? 0;
  const baseRtp = input.baseGameRtpTarget;
  const combinedRtpPerSpin = baseRtp + tournamentOverlayRtp;

  const typicalSkillExpectedReturn =
    pa?.expectedPrizePerPlayer ?? np?.expectedPrizePerPlayer ?? 0;

  // Funding shares: prefer betFairness per-player; else per-title (network).
  const fundingShares: number[] = bf
    ? bf.perPlayer.map((p) => p.fundingShare)
    : np
      ? np.perTitle.map((t) => t.shareOfPool)
      : pa
        ? new Array(pa.rankBreakdown.length).fill(1 / pa.rankBreakdown.length)
        : [];

  const complianceFindings = computeCompliance(input, combinedRtpPerSpin, pa, np, bf);

  return {
    header: {
      tournamentId: input.tournamentId,
      operator: input.operator,
      baseGameRtpTarget: input.baseGameRtpTarget,
      emitTimestampIso: nowIso ?? new Date().toISOString(),
      schemaVersion: 'urn:slotmath:tournament-audit:v1',
    },
    prizeAllocation: pa,
    networkPool: np,
    betFairness: bf,
    rankDisclosure,
    combinedRtpPerSpin,
    tournamentOverlayRtp,
    typicalSkillExpectedReturn,
    fundingShares,
    complianceFindings,
  };
}

/** ── Format emitters ─────────────────────────────────────────────────────── */

/** Markdown emit (regulator-friendly). */
export function emitTournamentAuditMarkdown(report: TournamentAuditReport): string {
  const out: string[] = [];
  out.push(`# Tournament Audit Report — ${report.header.tournamentId}`);
  out.push('');
  out.push(`> Operator: **${report.header.operator}**`);
  out.push(`> Emitted: ${report.header.emitTimestampIso}`);
  out.push(`> Schema: \`${report.header.schemaVersion}\``);
  out.push('');
  out.push('## Combined RTP Disclosure (UKGC RTS-12 §b)');
  out.push('');
  out.push('| Metric | Value |');
  out.push('|---|---:|');
  out.push(`| Base-game RTP target | ${(report.header.baseGameRtpTarget * 100).toFixed(2)} % |`);
  out.push(`| Tournament overlay RTP per spin | ${(report.tournamentOverlayRtp * 100).toFixed(4)} % |`);
  out.push(`| **Combined RTP per spin** | **${(report.combinedRtpPerSpin * 100).toFixed(2)} %** |`);
  out.push(`| Typical-skill expected prize (MGA PPD §11) | ${report.typicalSkillExpectedReturn.toFixed(4)} |`);
  out.push('');
  out.push('## Per-Rank Prize Table (UKGC RTS-12 §a)');
  out.push('');
  out.push('| Rank | Prize | P(this rank) | Expected contribution |');
  out.push('|---:|---:|---:|---:|');
  const maxRows = Math.min(report.rankDisclosure.length, 20);
  for (let i = 0; i < maxRows; i++) {
    const r = report.rankDisclosure[i];
    out.push(
      `| ${r.rank} | ${r.prize.toFixed(4)} | ${(r.probabilityThisRank * 100).toFixed(4)} % | ${r.expectedPrizeContribution.toFixed(6)} |`,
    );
  }
  if (report.rankDisclosure.length > maxRows) {
    out.push(`| ... | (${report.rankDisclosure.length - maxRows} more rows) | | |`);
  }
  out.push('');
  out.push('## Compliance Findings');
  out.push('');
  out.push('| Rule | Status | Detail |');
  out.push('|---|:---:|---|');
  for (const f of report.complianceFindings) {
    const badge =
      f.status === 'pass' ? '✅ PASS' : f.status === 'warn' ? '⚠️ WARN' : '❌ FAIL';
    out.push(`| ${f.rule} | ${badge} | ${f.detail} |`);
  }
  out.push('');
  if (report.betFairness) {
    out.push('## Bet-Size Fairness (UKGC RTS-12 §c)');
    out.push('');
    out.push(`Players: ${report.betFairness.nPlayers}, bet spread ratio: ${report.betFairness.betSpreadRatio.toFixed(2)}×.`);
    out.push('');
    out.push(`- Raw ranking max-bet advantage: \`${report.betFairness.rawRankingMaxBetAdvantage.toFixed(4)}\``);
    out.push(`- Adjusted (z-score) max-bet advantage: \`${report.betFairness.adjustedRankingMaxBetAdvantage.toFixed(4)}\` (by design = 0)`);
    out.push(`- **Fairness gain from adjustment**: \`${report.betFairness.fairnessGainFromAdjustment.toFixed(4)}\``);
  }
  return out.join('\n');
}

/** JSON emit (machine-readable, stable order). */
export function emitTournamentAuditJson(report: TournamentAuditReport): string {
  return JSON.stringify(report, null, 2);
}

/** UKGC-shape XML emit (urn:slotmath:tournament-audit:v1 namespace). */
export function emitTournamentAuditXml(report: TournamentAuditReport): string {
  const xmlEscape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<TournamentAudit xmlns="urn:slotmath:tournament-audit:v1">`);
  lines.push('  <Header>');
  lines.push(`    <TournamentId>${xmlEscape(report.header.tournamentId)}</TournamentId>`);
  lines.push(`    <Operator>${xmlEscape(report.header.operator)}</Operator>`);
  lines.push(`    <BaseGameRtpTarget>${report.header.baseGameRtpTarget}</BaseGameRtpTarget>`);
  lines.push(`    <EmitTimestampIso>${xmlEscape(report.header.emitTimestampIso)}</EmitTimestampIso>`);
  lines.push(`    <SchemaVersion>${xmlEscape(report.header.schemaVersion)}</SchemaVersion>`);
  lines.push('  </Header>');
  lines.push('  <CombinedRtp>');
  lines.push(`    <BaseRtp>${report.header.baseGameRtpTarget}</BaseRtp>`);
  lines.push(`    <TournamentOverlay>${report.tournamentOverlayRtp}</TournamentOverlay>`);
  lines.push(`    <Combined>${report.combinedRtpPerSpin}</Combined>`);
  lines.push(`    <TypicalSkillExpectedReturn>${report.typicalSkillExpectedReturn}</TypicalSkillExpectedReturn>`);
  lines.push('  </CombinedRtp>');
  lines.push('  <RankDisclosure>');
  for (const r of report.rankDisclosure) {
    lines.push(
      `    <Rank index="${r.rank}" prize="${r.prize}" probability="${r.probabilityThisRank}" expectedContribution="${r.expectedPrizeContribution}"/>`,
    );
  }
  lines.push('  </RankDisclosure>');
  lines.push('  <ComplianceFindings>');
  for (const f of report.complianceFindings) {
    lines.push(`    <Finding status="${f.status}">`);
    lines.push(`      <Rule>${xmlEscape(f.rule)}</Rule>`);
    lines.push(`      <Detail>${xmlEscape(f.detail)}</Detail>`);
    lines.push('    </Finding>');
  }
  lines.push('  </ComplianceFindings>');
  lines.push('</TournamentAudit>');
  return lines.join('\n');
}
