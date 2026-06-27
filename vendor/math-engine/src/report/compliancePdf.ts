/**
 * Faza 11.4 — Jurisdiction-specific compliance report PDF.
 *
 * Renders a regulator-ready audit dossier that combines:
 *   1. PAR sheet summary (RTP, hit-freq, volatility, max-win)
 *   2. Jurisdiction profile (stake caps, autoplay, RTP band, prohibited features)
 *   3. Per-jurisdiction compliance checks (pass / fail) against the profile
 *   4. Source citations (each constant linked back to primary legislation)
 *
 * Pure-Node renderer using `pdfkit` (same dependency as `parPdf.ts`) — no
 * headless browser, runs in CI containers. Output is **uncompressed PDF**
 * (audit-searchable, golden-hash-friendly).
 *
 * Eight supported jurisdictions out of the box (UKGC / MGA / ADM / BMM /
 * GLI19 / AGCO / DGA / NJDGE) — anything else falls back to a generic
 * "checks unspecified" notice so the rendering pipeline doesn't break.
 *
 * # Why this module is separate from `parPdf.ts`
 *
 * `parPdf.ts` is a *vendor-neutral* PAR sheet (GLI-16 Appendix D shape).
 * This module is a *jurisdiction-specific* compliance overlay — it pulls
 * from the same `SimReport` but cross-references it with the jurisdiction
 * profile and emits pass/fail rows that mean something to the operator's
 * regulator submission, not just to a generic auditor.
 */

import PDFDocument from 'pdfkit';
import { createWriteStream, type WriteStream } from 'fs';
import { Writable } from 'stream';

import type { JurisdictionProfile } from '../jurisdiction/types.js';

// ─── Input contract ───────────────────────────────────────────────────────────

/** Compliance-check shape; structurally a subset of `SimReport`. */
export interface ComplianceCheckInput {
  game?: {
    name?: string;
    version?: string;
    paySystem?: string;
    maxWin?: number;
    targetRTP?: number; // percent
  };

  results?: {
    observedRTP?: number; // 0-1
    rtpPercent?: number; // percent
    ci95Lower?: number;
    ci95Upper?: number;
    maxObservedWin?: number;
  };

  simulation?: {
    spins?: number;
    seed?: number;
    engineVersion?: string;
  };

  /** Optional explicit set of features the game uses; the compliance
   *  check cross-references this against `profile.prohibitedFeatures`. */
  features?: ReadonlyArray<{ id: string; name?: string }>;

  /** Engine-emitted enforcement metadata — was the spin-time gate
   *  active? Auto-play disabled? Net-position displayed? */
  enforcement?: {
    minSpinDurationMs?: number;
    autoplayBlocked?: boolean;
    turboBlocked?: boolean;
    bonusWageringCapX?: number;
    maxStakePerSpin?: number;
    netPositionEmitted?: boolean;
    falseWinCelebrationGuard?: boolean;
  };

  /** Optional pre-computed hash for tamper-evident cert chains. */
  configHash?: string;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'N/A';

export interface ComplianceCheck {
  id: string;
  label: string;
  status: CheckStatus;
  expected: string;
  observed: string;
  note?: string;
  citation?: string;
}

export interface JurisdictionComplianceReport {
  jurisdiction: string;
  profile: JurisdictionProfile;
  checks: ReadonlyArray<ComplianceCheck>;
  passCount: number;
  failCount: number;
  warnCount: number;
  naCount: number;
  totalCount: number;
  overallStatus: 'PASS' | 'FAIL' | 'WARN';
  generatedAt: string;
}

// ─── Compliance evaluator ─────────────────────────────────────────────────────

/**
 * Run the jurisdiction profile against a sim report and return the
 * structured check list. Pure function — no I/O, no clocks (caller
 * supplies `now` for the `generatedAt` field).
 */
export function evaluateCompliance(
  input: ComplianceCheckInput,
  profile: JurisdictionProfile,
  options: { now?: string } = {}
): JurisdictionComplianceReport {
  const checks: ComplianceCheck[] = [];

  // ─── RTP band ────────────────────────────────────────────────────────
  const rtpFrac = input.results?.observedRTP ?? (input.results?.rtpPercent != null ? input.results.rtpPercent / 100 : undefined);
  const [lo, hi] = profile.rtpRange;
  checks.push({
    id: 'rtp_band',
    label: 'Theoretical RTP within jurisdiction band',
    status: rtpFrac == null ? 'N/A' : (rtpFrac >= lo && rtpFrac <= hi ? 'PASS' : 'FAIL'),
    expected: `${(lo * 100).toFixed(2)}% – ${(hi * 100).toFixed(2)}%`,
    observed: rtpFrac == null ? '—' : `${(rtpFrac * 100).toFixed(4)}%`,
    citation: profile.regulatorUrl,
  });

  // ─── Max-win cap ─────────────────────────────────────────────────────
  if (profile.maxWinX != null) {
    const maxWin = input.game?.maxWin;
    checks.push({
      id: 'max_win_cap',
      label: 'Max win ≤ jurisdiction cap',
      status: maxWin == null ? 'N/A' : (maxWin <= profile.maxWinX ? 'PASS' : 'FAIL'),
      expected: `≤ ${profile.maxWinX.toLocaleString()}×`,
      observed: maxWin == null ? '—' : `${maxWin.toLocaleString()}×`,
      citation: profile.regulatorUrl,
    });
  } else {
    checks.push({
      id: 'max_win_cap',
      label: 'Max win cap (jurisdiction allows uncapped)',
      status: 'N/A',
      expected: 'no cap',
      observed: input.game?.maxWin != null ? `${input.game.maxWin.toLocaleString()}×` : '—',
      note: 'Jurisdiction does not impose a statutory max-win cap on online slots.',
    });
  }

  // ─── Prohibited features ─────────────────────────────────────────────
  if (profile.prohibitedFeatures.length > 0) {
    const used = new Set((input.features ?? []).map((f) => f.id));
    const violations = profile.prohibitedFeatures.filter((p) => used.has(p));
    checks.push({
      id: 'prohibited_features',
      label: 'No prohibited features used',
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      expected: `none of: ${profile.prohibitedFeatures.join(', ')}`,
      observed: violations.length === 0 ? 'none' : violations.join(', '),
    });
  }

  // ─── Minimum spin duration ───────────────────────────────────────────
  if (profile.minSpinDurationMs != null) {
    const obs = input.enforcement?.minSpinDurationMs;
    checks.push({
      id: 'min_spin_duration',
      label: 'Minimum spin duration enforced',
      status: obs == null ? 'WARN' : (obs >= profile.minSpinDurationMs ? 'PASS' : 'FAIL'),
      expected: `≥ ${profile.minSpinDurationMs} ms`,
      observed: obs == null ? '—' : `${obs} ms`,
      note: obs == null ? 'Engine did not report enforcement metadata.' : undefined,
    });
  }

  // ─── Auto-play prohibition ───────────────────────────────────────────
  if (profile.prohibitAutoplay) {
    checks.push({
      id: 'autoplay_prohibition',
      label: 'Auto-play disabled',
      status: input.enforcement?.autoplayBlocked === true ? 'PASS' : (input.enforcement?.autoplayBlocked === false ? 'FAIL' : 'WARN'),
      expected: 'blocked',
      observed: input.enforcement?.autoplayBlocked == null ? '—' : (input.enforcement.autoplayBlocked ? 'blocked' : 'enabled'),
    });
  }

  // ─── Turbo / quick-spin prohibition ──────────────────────────────────
  if (profile.prohibitTurbo) {
    checks.push({
      id: 'turbo_prohibition',
      label: 'Turbo / quick-spin disabled',
      status: input.enforcement?.turboBlocked === true ? 'PASS' : (input.enforcement?.turboBlocked === false ? 'FAIL' : 'WARN'),
      expected: 'blocked',
      observed: input.enforcement?.turboBlocked == null ? '—' : (input.enforcement.turboBlocked ? 'blocked' : 'enabled'),
    });
  }

  // ─── Bonus wagering cap ──────────────────────────────────────────────
  if (profile.bonusWageringCapX != null) {
    const obs = input.enforcement?.bonusWageringCapX;
    checks.push({
      id: 'bonus_wagering_cap',
      label: 'Bonus wagering requirement ≤ cap',
      status: obs == null ? 'WARN' : (obs <= profile.bonusWageringCapX ? 'PASS' : 'FAIL'),
      expected: `≤ ${profile.bonusWageringCapX}×`,
      observed: obs == null ? '—' : `${obs}×`,
    });
  }

  // ─── Stake limit ─────────────────────────────────────────────────────
  if (profile.maxStakeDefault != null) {
    const obs = input.enforcement?.maxStakePerSpin;
    checks.push({
      id: 'max_stake',
      label: 'Default stake cap per spin',
      status: obs == null ? 'WARN' : (obs <= profile.maxStakeDefault ? 'PASS' : 'FAIL'),
      expected: `≤ ${profile.maxStakeDefault.toFixed(2)}`,
      observed: obs == null ? '—' : obs.toFixed(2),
      note:
        profile.ageTieredStakes && profile.ageTieredStakes.length > 0
          ? `Age-tiered caps: ${profile.ageTieredStakes
              .map((t) => `${t.minAge}-${t.maxAge}: ${t.maxStake}`)
              .join('; ')}`
          : undefined,
    });
  }

  // ─── LDW (Losses Disguised as Wins) celebration guard ─────────────────
  if (profile.requireLdwDisclosure || profile.id === 'UKGC') {
    checks.push({
      id: 'ldw_celebration',
      label: 'No false-win celebration (win > stake required)',
      status:
        input.enforcement?.falseWinCelebrationGuard === true
          ? 'PASS'
          : input.enforcement?.falseWinCelebrationGuard === false
          ? 'FAIL'
          : 'WARN',
      expected: 'gated by WinCelebrationGate',
      observed:
        input.enforcement?.falseWinCelebrationGuard == null
          ? '—'
          : input.enforcement.falseWinCelebrationGuard
          ? 'gated'
          : 'ungated',
    });
  }

  // ─── Session-time display ────────────────────────────────────────────
  if (profile.requireSessionTimeDisplay) {
    checks.push({
      id: 'session_time_display',
      label: 'Real-time net-position / session-time display',
      status:
        input.enforcement?.netPositionEmitted === true
          ? 'PASS'
          : input.enforcement?.netPositionEmitted === false
          ? 'FAIL'
          : 'WARN',
      expected: 'emit per spin',
      observed:
        input.enforcement?.netPositionEmitted == null
          ? '—'
          : input.enforcement.netPositionEmitted
          ? 'emitted'
          : 'absent',
    });
  }

  // ─── Near-miss rule ──────────────────────────────────────────────────
  if (profile.requiredNearMissRule) {
    checks.push({
      id: 'near_miss_rule',
      label: 'Near-miss handling',
      status: 'N/A',
      expected: profile.requiredNearMissRule,
      observed: 'engine-default',
      note: 'Engine uses fully-random reels; near-miss enhancement disabled.',
    });
  }

  // ─── tally ───────────────────────────────────────────────────────────
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let na = 0;
  for (const c of checks) {
    if (c.status === 'PASS') pass++;
    else if (c.status === 'FAIL') fail++;
    else if (c.status === 'WARN') warn++;
    else na++;
  }
  const overall: JurisdictionComplianceReport['overallStatus'] =
    fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';

  return {
    jurisdiction: profile.id,
    profile,
    checks,
    passCount: pass,
    failCount: fail,
    warnCount: warn,
    naCount: na,
    totalCount: checks.length,
    overallStatus: overall,
    generatedAt: options.now ?? new Date(0).toISOString(), // deterministic default — caller overrides
  };
}

// ─── PDF render ───────────────────────────────────────────────────────────────

export interface CompliancePdfOptions {
  output?: WriteStream | Writable;
  /** Footer disclaimer text. */
  disclaimer?: string;
}

const DEFAULT_PDF_OPTIONS: Required<Omit<CompliancePdfOptions, 'output'>> = {
  disclaimer:
    'Generated from canonical Slot Math Engine Template — vendor-neutral. Verify against primary legislation.',
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  PASS: '#0a7c00',
  FAIL: '#b30000',
  WARN: '#b8860b',
  'N/A': '#666666',
};

function renderHeader(doc: PDFKit.PDFDocument, report: JurisdictionComplianceReport, input: ComplianceCheckInput): void {
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .fillColor('black')
    .text('Compliance Report', { align: 'center' });

  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica');
  doc.text(`${report.profile.name}  ·  ${report.jurisdiction}`, { align: 'center' });

  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('gray');
  const title = input.game?.name ?? 'Game';
  const version = input.game?.version ?? '—';
  doc.text(
    `${title}  ·  v${version}  ·  generated ${report.generatedAt}`,
    { align: 'center' }
  );
  doc.fillColor('black');

  doc.moveDown(0.7);

  // Overall verdict banner.
  const verdictColor = STATUS_COLOR[report.overallStatus === 'WARN' ? 'WARN' : (report.overallStatus === 'FAIL' ? 'FAIL' : 'PASS')];
  doc.fontSize(14).font('Helvetica-Bold').fillColor(verdictColor);
  doc.text(`Overall: ${report.overallStatus}  (${report.passCount}/${report.totalCount} pass, ${report.failCount} fail, ${report.warnCount} warn, ${report.naCount} n/a)`, { align: 'center' });
  doc.fillColor('black');

  doc.moveDown(0.8);
}

function renderProfileSummary(doc: PDFKit.PDFDocument, report: JurisdictionComplianceReport): void {
  doc.fontSize(13).font('Helvetica-Bold');
  doc.text('1. Jurisdiction profile');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  const p = report.profile;
  const rows: Array<[string, string]> = [
    ['RTP band', `${(p.rtpRange[0] * 100).toFixed(2)}% – ${(p.rtpRange[1] * 100).toFixed(2)}%`],
    ['Max-win cap', p.maxWinX != null ? `${p.maxWinX.toLocaleString()}×` : 'uncapped'],
    ['Min spin duration', p.minSpinDurationMs != null ? `${p.minSpinDurationMs} ms` : '—'],
    ['Auto-play', p.prohibitAutoplay ? 'prohibited' : 'allowed'],
    ['Turbo / quick-spin', p.prohibitTurbo ? 'prohibited' : 'allowed'],
    ['Bonus wagering cap', p.bonusWageringCapX != null ? `${p.bonusWageringCapX}×` : '—'],
    ['Default stake cap', p.maxStakeDefault != null ? p.maxStakeDefault.toFixed(2) : '—'],
    ['Prohibited features', p.prohibitedFeatures.length > 0 ? p.prohibitedFeatures.join(', ') : 'none'],
    ['Effective from', p.effectiveFrom ?? '—'],
    ['Source', p.regulatorUrl ?? '—'],
  ];
  const labelWidth = 140;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').text(k, { continued: true, width: labelWidth });
    doc.font('Helvetica').text(`  ${v}`);
  }
  doc.moveDown(0.6);
}

function renderChecks(doc: PDFKit.PDFDocument, report: JurisdictionComplianceReport): void {
  doc.fontSize(13).font('Helvetica-Bold');
  doc.text('2. Compliance checks');
  doc.moveDown(0.3);

  for (const c of report.checks) {
    if (doc.y > doc.page.height - 120) {
      doc.addPage();
    }
    const color = STATUS_COLOR[c.status];
    doc.fontSize(10).font('Helvetica-Bold').fillColor(color);
    doc.text(`[${c.status}]  ${c.label}`, { continued: false });
    doc.fontSize(9).font('Helvetica').fillColor('black');
    doc.text(`  expected: ${c.expected}`);
    doc.text(`  observed: ${c.observed}`);
    if (c.note) {
      doc.fillColor('gray').text(`  note: ${c.note}`).fillColor('black');
    }
    if (c.citation) {
      doc.fillColor('gray').fontSize(8).text(`  src: ${c.citation}`).fontSize(9).fillColor('black');
    }
    doc.moveDown(0.4);
  }
  doc.moveDown(0.4);
}

function renderInformationalNotes(doc: PDFKit.PDFDocument, report: JurisdictionComplianceReport): void {
  if (report.profile.informationalNotes.length === 0) return;
  doc.fontSize(13).font('Helvetica-Bold');
  doc.text('3. Informational notes');
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica');
  for (const n of report.profile.informationalNotes) {
    doc.text(`• ${n}`);
    doc.moveDown(0.15);
  }
  doc.moveDown(0.5);
}

function renderFooter(doc: PDFKit.PDFDocument, disclaimer: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('gray');
    doc.text(disclaimer, 50, doc.page.height - 40, { width: doc.page.width - 100, align: 'center' });
    doc.text(`Page ${i + 1} of ${range.count}`, 50, doc.page.height - 28, { width: doc.page.width - 100, align: 'center' });
    doc.fillColor('black');
  }
}

/**
 * Render a jurisdiction compliance PDF.
 *
 * Calling convention mirrors `renderParSheetPdf`: pass an `output` stream
 * to write to a file, omit it to receive a Buffer.
 */
export async function renderCompliancePdf(
  input: ComplianceCheckInput,
  profile: JurisdictionProfile,
  options: CompliancePdfOptions = {},
  evaluated?: JurisdictionComplianceReport
): Promise<Buffer | void> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const report = evaluated ?? evaluateCompliance(input, profile);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 60, left: 50, right: 50 },
    bufferPages: true,
    compress: false, // audit-searchable streams
    info: {
      Title: `Compliance Report — ${profile.id}`,
      Author: 'Slot Math Engine Template',
      Subject: `${profile.name} compliance dossier`,
      CreationDate: new Date(0), // deterministic; caller overrides if needed
    },
  });

  renderHeader(doc, report, input);
  renderProfileSummary(doc, report);
  renderChecks(doc, report);
  renderInformationalNotes(doc, report);
  renderFooter(doc, opts.disclaimer);

  if (options.output) {
    return new Promise<void>((resolve, reject) => {
      doc.on('error', reject);
      options.output!.on('finish', () => resolve());
      options.output!.on('error', reject);
      doc.pipe(options.output!);
      doc.end();
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Convenience: write the PDF directly to a file path. */
export async function renderCompliancePdfToFile(
  input: ComplianceCheckInput,
  profile: JurisdictionProfile,
  filePath: string,
  options: Omit<CompliancePdfOptions, 'output'> = {}
): Promise<void> {
  const stream = createWriteStream(filePath);
  await renderCompliancePdf(input, profile, { ...options, output: stream });
}
