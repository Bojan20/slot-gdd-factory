/**
 * PAR sheet PDF renderer — P0 #6.
 *
 * Pure-Node renderer that turns a `SimReport` (the canonical PAR JSON) into a
 * GLI-16 Appendix D shaped PDF. Uses `pdfkit` so there is **no headless
 * browser dependency** — runs in CI, sandboxed containers, etc.
 *
 * Inputs are intentionally typed as a **structural subset** of `SimReport` so
 * external `PAR.json` payloads from other engines / dialects can be rendered
 * too. Anything the renderer doesn't have data for is rendered as `—`.
 *
 * The output is regulator-shaped, not pretty-marketing — sections match
 * GLI-16 §"Required Disclosure" so an auditor can tick boxes top-to-bottom.
 */

import PDFDocument from 'pdfkit';
import { createWriteStream, type WriteStream } from 'fs';
import { Writable } from 'stream';

// ─── Input contract ─────────────────────────────────────────────────────────

/**
 * Minimal PAR shape the PDF renderer needs.
 * `SimReport` (and any compatible PAR JSON) is structurally compatible.
 *
 * All fields are optional in this minimal contract because external
 * dialects may not populate every section. The renderer fills in `—`
 * for any missing field rather than throwing.
 */
export interface ParRenderInput {
  schemaVersion?: string;
  generatedAt?: string;
  configHash?: string;

  game?: {
    name?: string;
    version?: string;
    mathVersion?: string;
    layout?: string;
    paySystem?: string;
    paylines?: number;
    targetRTP?: number;          // percent, e.g. 96.0
    targetVolatility?: string;
    maxWin?: number;             // bet multiplier
  };

  simulation?: {
    spins?: number;
    seed?: number;
    engineVersion?: string;
  };

  results?: {
    observedRTP?: number;        // 0-1 fraction
    rtpPercent?: number;         // percent
    errorMargin?: number;
    ci95Lower?: number;
    ci95Upper?: number;
    rtpBreakdown?: Record<string, number>;
    hitRate?: number;            // 0-1 fraction
    deadSpinRate?: number;
    avgWinOnHit?: number;
    percentiles?: Record<string, number>;
    tailBuckets?: Record<string, number>;
    maxObservedWin?: number;
    maxWinSpin?: number;
  };

  volatility?: {
    variance?: number;
    stdDev?: number;
    volatilityIndex?: number;
    classification?: string;
  };

  features?: Array<{
    id: string;
    name?: string;
    triggerRate?: number;
    frequency?: string;
    avgWin?: number;
    rtpContribution?: number;
    additionalMetrics?: Record<string, number | string>;
  }>;

  streaks?: {
    deadMean?: number;
    deadMax?: number;
  };

  histogram?: Array<{
    bucket: string;
    count: number;
    percentage: number;
    rtpContribution: number;
  }>;

  paytable?: {
    lineWins?: Array<{ symbol: string; pays: Record<string, number> | number[] }>;
    scatter?: Array<{ count: number; pay: number; freeSpins?: number }>;
    holdAndWin?: { orbValues?: Array<{ type: string; multiplier: number; weight: number }>; expectedOrbValue?: number };
  };

  notes?: string[];

  // Compliance metadata — optional but recommended for regulator submission.
  compliance?: {
    jurisdiction?: string;       // 'UKGC' | 'MGA' | 'ADM' | ...
    standard?: string;           // 'GLI-11' | 'GLI-19' | 'GLI-16'
    submitter?: string;
    cycleSize?: number;
  };
}

// ─── Render options ─────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Output stream (file or buffer). If omitted, returns Buffer. */
  output?: WriteStream | Writable;
  /** Disclaimer text printed at the bottom of every page. */
  disclaimer?: string;
  /** Maximum number of histogram rows rendered (rest go to "and N more"). */
  histogramRowLimit?: number;
  /** Maximum number of reel-strip distribution rows rendered per reel. */
  paytableRowLimit?: number;
}

const DEFAULT_OPTIONS: Required<Omit<RenderOptions, 'output'>> = {
  disclaimer: 'Generated from canonical Slot Math Engine Template — no game / vendor IP.',
  histogramRowLimit: 30,
  paytableRowLimit: 20,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const dashIfMissing = <T>(v: T | undefined | null): string =>
  v === undefined || v === null ? '—' : String(v);

const fmtPercent = (v: number | undefined, digits = 4): string =>
  v === undefined ? '—' : (v * 100).toFixed(digits) + '%';

const fmtNumber = (v: number | undefined, digits = 2): string =>
  v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits });

const fmtMoney = (v: number | undefined): string =>
  v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Section renderers ──────────────────────────────────────────────────────

function renderHeader(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('PAR Sheet — Probability and Returns', { align: 'center' });

  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  const title = input.game?.name ?? 'Game';
  const version = input.game?.version ?? '—';
  doc.text(`${title}  ·  v${version}`, { align: 'center' });

  if (input.compliance?.standard) {
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('gray');
    doc.text(
      `Standard: ${input.compliance.standard}` +
      (input.compliance.jurisdiction ? `  ·  Jurisdiction: ${input.compliance.jurisdiction}` : ''),
      { align: 'center' }
    );
    doc.fillColor('black');
  }

  doc.moveDown(1);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('black');
  doc.text(title);
  doc
    .strokeColor('#444444')
    .lineWidth(0.5)
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
}

function kvTable(
  doc: PDFKit.PDFDocument,
  rows: Array<[string, string]>,
  labelWidth = 200
): void {
  const startX = doc.x;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font('Helvetica-Bold').text(label, startX, y, { width: labelWidth, continued: false });
    doc.font('Helvetica').text(value, startX + labelWidth, y);
    doc.moveDown(0.1);
  }
  doc.moveDown(0.2);
}

function renderMeta(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '1. Meta');
  kvTable(doc, [
    ['Game name', dashIfMissing(input.game?.name)],
    ['Game version', dashIfMissing(input.game?.version)],
    ['Math version', dashIfMissing(input.game?.mathVersion)],
    ['Layout', dashIfMissing(input.game?.layout)],
    ['Pay system', dashIfMissing(input.game?.paySystem)],
    ['Paylines', dashIfMissing(input.game?.paylines)],
    ['Target RTP', input.game?.targetRTP !== undefined ? `${input.game.targetRTP.toFixed(4)}%` : '—'],
    ['Target volatility', dashIfMissing(input.game?.targetVolatility)],
    ['Max win (×bet)', dashIfMissing(input.game?.maxWin)],
    ['Config hash', dashIfMissing(input.configHash)],
    ['Generated at', dashIfMissing(input.generatedAt)],
    ['Schema version', dashIfMissing(input.schemaVersion)],
    ['Engine version', dashIfMissing(input.simulation?.engineVersion)],
  ]);
}

function renderRtpSummary(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '2. RTP Summary');
  const r = input.results;
  kvTable(doc, [
    ['Observed RTP', fmtPercent(r?.observedRTP)],
    ['RTP percent', r?.rtpPercent !== undefined ? r.rtpPercent.toFixed(4) + '%' : '—'],
    ['Error margin', r?.errorMargin !== undefined ? r.errorMargin.toFixed(6) : '—'],
    ['95% CI lower', fmtPercent(r?.ci95Lower)],
    ['95% CI upper', fmtPercent(r?.ci95Upper)],
    ['Spins simulated', fmtNumber(input.simulation?.spins, 0)],
    ['Seed', dashIfMissing(input.simulation?.seed)],
  ]);

  if (r?.rtpBreakdown) {
    doc.moveDown(0.2).font('Helvetica-Bold').text('RTP Breakdown by source:');
    doc.font('Helvetica');
    for (const [source, value] of Object.entries(r.rtpBreakdown)) {
      doc.text(`  ${source}: ${fmtPercent(value)}`);
    }
    doc.moveDown(0.2);
  }
}

function renderHitFreqVolatility(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '3. Hit Frequency & Volatility');
  const r = input.results;
  const v = input.volatility;
  kvTable(doc, [
    ['Hit rate', fmtPercent(r?.hitRate)],
    ['Dead-spin rate', fmtPercent(r?.deadSpinRate)],
    ['Avg win on hit', fmtMoney(r?.avgWinOnHit)],
    ['Variance', fmtNumber(v?.variance, 4)],
    ['Std deviation', fmtNumber(v?.stdDev, 4)],
    ['Volatility index', fmtNumber(v?.volatilityIndex, 2)],
    ['Volatility class', dashIfMissing(v?.classification)],
    ['Streak (dead) mean', fmtNumber(input.streaks?.deadMean, 2)],
    ['Streak (dead) max', fmtNumber(input.streaks?.deadMax, 0)],
  ]);
}

function renderQuantiles(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '4. Win Distribution Quantiles');
  const p = input.results?.percentiles;
  const t = input.results?.tailBuckets;
  if (!p && !t) {
    doc.font('Helvetica-Oblique').text('No quantile data available.');
    doc.font('Helvetica');
    return;
  }

  if (p) {
    doc.font('Helvetica-Bold').text('Percentiles (× bet):').font('Helvetica');
    for (const [k, v] of Object.entries(p)) {
      doc.text(`  ${k}: ${fmtMoney(v)}`);
    }
  }

  if (t) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Tail buckets (count of spins):').font('Helvetica');
    for (const [k, v] of Object.entries(t)) {
      doc.text(`  ${k}: ${fmtNumber(v, 0)}`);
    }
  }

  if (input.results?.maxObservedWin !== undefined) {
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .text('Max observed win: ')
      .font('Helvetica')
      .text(
        fmtMoney(input.results.maxObservedWin) +
        (input.results.maxWinSpin !== undefined ? ` (spin #${input.results.maxWinSpin})` : ''),
        { continued: false }
      );
  }
}

function renderFeatures(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '5. Feature Contribution');
  if (!input.features || input.features.length === 0) {
    doc.font('Helvetica-Oblique').text('No feature data available.');
    doc.font('Helvetica');
    return;
  }

  // Header row
  doc.font('Helvetica-Bold');
  doc.text('Feature                   Trigger Rate      Avg Win      RTP %');
  doc.font('Helvetica');

  for (const f of input.features) {
    const name = (f.name ?? f.id).padEnd(24, ' ').slice(0, 24);
    const trig = (f.triggerRate !== undefined ? fmtPercent(f.triggerRate, 3) : '—').padEnd(15);
    const win = (fmtMoney(f.avgWin) ?? '—').padEnd(12);
    const rtp = fmtPercent(f.rtpContribution, 4);
    doc.text(`${name} ${trig} ${win} ${rtp}`);
  }
}

function renderHistogram(doc: PDFKit.PDFDocument, input: ParRenderInput, limit: number): void {
  sectionTitle(doc, '6. Win Histogram');
  const rows = input.histogram ?? [];
  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').text('No histogram data available.');
    doc.font('Helvetica');
    return;
  }

  doc.font('Helvetica-Bold').text('Bucket           Count        %          RTP %');
  doc.font('Helvetica');

  const trimmed = rows.slice(0, limit);
  for (const r of trimmed) {
    const bucket = String(r.bucket).padEnd(16);
    const count = fmtNumber(r.count, 0).padEnd(12);
    const pct = `${(r.percentage * 100).toFixed(3)}%`.padEnd(10);
    const rtpC = `${(r.rtpContribution * 100).toFixed(4)}%`;
    doc.text(`${bucket} ${count} ${pct} ${rtpC}`);
  }
  if (rows.length > limit) {
    doc.font('Helvetica-Oblique').text(`… and ${rows.length - limit} more rows in source JSON`);
    doc.font('Helvetica');
  }
}

function renderPaytable(doc: PDFKit.PDFDocument, input: ParRenderInput, limit: number): void {
  sectionTitle(doc, '7. Paytable Excerpt');
  const p = input.paytable;
  if (!p) {
    doc.font('Helvetica-Oblique').text('No paytable data available.');
    doc.font('Helvetica');
    return;
  }

  if (p.lineWins && p.lineWins.length > 0) {
    doc.font('Helvetica-Bold').text('Line-win paytable (symbol → count → pay × bet):');
    doc.font('Helvetica');
    for (const row of p.lineWins.slice(0, limit)) {
      const pays = Array.isArray(row.pays)
        ? row.pays.map((v, i) => `${i + 3}x:${fmtMoney(v)}`).join('  ')
        : Object.entries(row.pays).map(([k, v]) => `${k}x:${fmtMoney(v as number)}`).join('  ');
      doc.text(`  ${row.symbol}: ${pays}`);
    }
  }

  if (p.scatter && p.scatter.length > 0) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Scatter pays:');
    doc.font('Helvetica');
    for (const s of p.scatter.slice(0, limit)) {
      const fs = s.freeSpins !== undefined ? ` → ${s.freeSpins} FS` : '';
      doc.text(`  ${s.count}× scatter: ${fmtMoney(s.pay)}${fs}`);
    }
  }

  if (p.holdAndWin) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Hold & Win orbs:');
    doc.font('Helvetica');
    doc.text(`  Expected orb value: ${fmtNumber(p.holdAndWin.expectedOrbValue, 4)}`);
    for (const o of (p.holdAndWin.orbValues ?? []).slice(0, limit)) {
      doc.text(`  ${o.type}: ×${o.multiplier}  weight=${o.weight}`);
    }
  }
}

function renderNotes(doc: PDFKit.PDFDocument, input: ParRenderInput): void {
  sectionTitle(doc, '8. Notes & Compliance');
  if (input.compliance) {
    kvTable(doc, [
      ['Jurisdiction', dashIfMissing(input.compliance.jurisdiction)],
      ['Standard', dashIfMissing(input.compliance.standard)],
      ['Submitter', dashIfMissing(input.compliance.submitter)],
      ['Cycle size', input.compliance.cycleSize !== undefined ? fmtNumber(input.compliance.cycleSize, 0) : '—'],
    ]);
  }
  const notes = input.notes ?? [];
  if (notes.length === 0) {
    doc.font('Helvetica-Oblique').text('No notes attached.');
    doc.font('Helvetica');
  } else {
    for (const n of notes) {
      doc.text(`• ${n}`);
    }
  }
}

function renderFooter(doc: PDFKit.PDFDocument, disclaimer: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 10;
    doc
      .fontSize(8)
      .fillColor('gray')
      .font('Helvetica-Oblique')
      .text(disclaimer, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      })
      .fillColor('black');
    doc
      .fontSize(8)
      .text(`Page ${i + 1} / ${range.count}`, doc.page.margins.left, y + 11, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'right',
      });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Render the PAR sheet as a PDF.
 *
 * If `output` is supplied (a writable stream), the function pipes the PDF into
 * it and resolves when the stream has been finished.
 *
 * If `output` is omitted, the function resolves with a `Buffer` containing
 * the entire PDF.
 */
export async function renderParSheetPdf(
  input: ParRenderInput,
  options: RenderOptions = {}
): Promise<Buffer | void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 60, left: 50, right: 50 },
    bufferPages: true,
    compress: false,  // keep streams uncompressed → text is searchable for audit / regression tests
    info: {
      Title: `PAR Sheet — ${input.game?.name ?? 'Game'}`,
      Author: input.compliance?.submitter ?? 'Slot Math Engine Template',
      Subject: 'Probability and Returns sheet',
      CreationDate: new Date(),
    },
  });

  // ─── Sections ────────────────────────────────────────────────────────────
  renderHeader(doc, input);
  renderMeta(doc, input);
  renderRtpSummary(doc, input);
  renderHitFreqVolatility(doc, input);
  renderQuantiles(doc, input);
  renderFeatures(doc, input);
  renderHistogram(doc, input, opts.histogramRowLimit);
  renderPaytable(doc, input, opts.paytableRowLimit);
  renderNotes(doc, input);

  // Footer + page numbers must run *after* content is laid out.
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

  // Buffer mode
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Convenience: render to file path.
 */
export async function renderParSheetToFile(
  input: ParRenderInput,
  filePath: string,
  options: Omit<RenderOptions, 'output'> = {}
): Promise<void> {
  const stream = createWriteStream(filePath);
  await renderParSheetPdf(input, { ...options, output: stream });
}
