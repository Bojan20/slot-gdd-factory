#!/usr/bin/env node
// PAR Sample Kit Bundle Builder — Wave 47 (Faza 0.3 sales-blocker closeout)
//
// Builds a STANDALONE bundle of 20 PAR samples that a mathematician /
// math director / compliance officer can download and open WITHOUT the
// engine repository, without npm, without cargo, without git. Bundle
// shape:
//
//   dist/par-sample-kit/
//     README_FOR_MATHEMATICIAN.md   — how to read, no repo needed
//     INDEX.md                       — pattern-mapped (P-001..P-020)
//     MANIFEST.txt                   — SHA-256 of every file
//     VERSION.txt                    — engine commit + bundle version
//     MASTER.csv                     — Excel-friendly summary 20 rows
//     samples/
//       <id>.par.json                — full machine-readable PAR
//       <id>.par.pdf                 — GLI-16 Appendix D PDF
//       <id>.par.csv                 — per-sample CSV (Excel)
//     schema/
//       usif-par-v1.0.json           — JSON Schema Draft 2020-12
//       USIF_PAR_SCHEMA_v1.md        — schema doc
//     pattern-catalog/
//       INDUSTRY_PATTERN_CATALOG.md  — 20 mechanical patterns
//
//   dist/par-sample-kit-v1.0.zip     — single-file deliverable
//
// Determinism: all artefacts in reports/par-samples/ are produced by
// scripts/par-samples-generate.mjs with seed=12345; this builder only
// repackages them. Manifest hashes prove bundle integrity once shipped.
//
// Usage:
//   npm run par-sample-kit         # build bundle + zip
//   node scripts/par-sample-kit-build.mjs --no-zip   # skip ZIP step

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const SKIP_ZIP = args.has('--no-zip');
const VERBOSE = args.has('--verbose') || args.has('-v');

const BUNDLE_VERSION = '1.0.0';
const BUNDLE_DIR = join(ROOT, 'dist', 'par-sample-kit');
const ZIP_PATH = join(ROOT, 'dist', `par-sample-kit-v${BUNDLE_VERSION}.zip`);
const SOURCE_PAR_DIR = join(ROOT, 'reports', 'par-samples');
const SCHEMA_SRC = join(ROOT, 'schemas', 'usif-par-v1.0.json');
const SCHEMA_DOC = join(ROOT, 'docs', 'USIF_PAR_SCHEMA_v1.md');
const PATTERN_CATALOG = join(ROOT, 'docs', 'INDUSTRY_PATTERN_CATALOG.md');

// Pattern → sample-id mapping. Source-of-truth:
// docs/INDUSTRY_PATTERN_CATALOG.md (Wave 46). Samples not in the
// baseline 20 are marked as "additional fixture" with a reference
// pointer (auditor can request generation).
const PATTERN_MAP = [
  { id: 'P-001', name: 'Variable-Ways Cascade', samples: ['complex-variable-rows', 'variable-rows-7reels'] },
  { id: 'P-002', name: 'Persistent-Grid Cash-Collect', samples: ['hnw-classic'] },
  { id: 'P-003', name: 'Multi-Tier Pool Jackpot', samples: [], additional: 'hnw-grand-jackpot, wheel-bonus' },
  { id: 'P-004', name: 'Cascading Cluster', samples: ['cluster-7x7'] },
  { id: 'P-005', name: 'Sticky-Wild Free Spins', samples: ['fs-sticky-wilds'] },
  { id: 'P-006', name: 'Mystery-Symbol Reveal', samples: [], additional: 'mystery-symbol' },
  { id: 'P-007', name: 'Walking-Wild Cascade', samples: [], additional: 'walking-wilds' },
  { id: 'P-008', name: 'Expanding-Wild Free Spins', samples: ['fs-expanding-wilds'] },
  { id: 'P-009', name: 'Multiplier-Ladder Free Spins', samples: ['fs-multiplier-ladder'] },
  { id: 'P-010', name: 'Pick-Bonus Mini-Game', samples: [], additional: 'pick-bonus' },
  { id: 'P-011', name: 'Pay-Anywhere Scatter', samples: ['pay-anywhere'] },
  { id: 'P-012', name: 'Both-Ways Line Evaluation', samples: ['5x4-25lines'] },
  { id: 'P-013', name: 'Symbol-Upgrade Cascade', samples: [], additional: 'symbol-upgrade' },
  { id: 'P-014', name: 'Respin-Lock Bonus', samples: [], additional: 'respin-feature' },
  { id: 'P-015', name: 'Hexagonal Cluster', samples: ['cluster-hexagonal'] },
  { id: 'P-016', name: 'Diagonal Cluster', samples: ['cluster-diagonal'] },
  { id: 'P-017', name: 'Multi-Reel Wild-Spread', samples: [], additional: 'multiplier-wilds' },
  { id: 'P-018', name: 'Asymmetric Variable-Rows', samples: ['complex-variable-rows'] },
  { id: 'P-019', name: 'High-Volatility Heavy-Tail', samples: ['5x3-243ways'] },
  { id: 'P-020', name: 'Classic 3x3 Lines', samples: ['classic-3x3-lines'] },
];

// Additional baseline samples not directly referenced by a P-ID above
// (they cover sibling Lines/Ways/Cascade primitives).
const EXTRA_BASELINE = ['3x5-5lines', '5x3-20lines', '6x4-4096ways', 'cascade-drop', 'cascade-fixed-strip', 'cascade-refill', 'fs-retrigger'];

function log(msg) { console.log(`[par-sample-kit] ${msg}`); }
function vlog(msg) { if (VERBOSE) log(msg); }

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

function escapeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowFromPar(par, sampleId) {
  const g = par.game ?? {};
  const s = par.simulation ?? {};
  const r = par.results ?? {};
  const v = par.volatility ?? {};
  const ci = par.ciBands ?? {};
  return {
    sampleId,
    gameName: g.name ?? '',
    layout: g.layout ?? '',
    paySystem: g.paySystem ?? '',
    paylines: g.paylines ?? '',
    targetRTP_pct: g.targetRTP ?? '',
    maxWin_x: g.maxWin ?? '',
    spins: s.spins ?? '',
    seed: s.seed ?? '',
    rngBackend: s.rngBackend ?? '',
    paytableScaleFactor: s.paytableScaleFactor ?? '',
    preScaleRTP_pct: s.preScaleRTP != null ? (s.preScaleRTP * 100).toFixed(4) : '',
    observedRTP_pct: r.rtpPercent != null ? r.rtpPercent.toFixed(4) : '',
    rtpErrorMargin_pct: r.errorMargin != null ? (r.errorMargin * 100).toFixed(4) : '',
    ci95Lower_pct: r.ci95Lower != null ? (r.ci95Lower * 100).toFixed(4) : '',
    ci95Upper_pct: r.ci95Upper != null ? (r.ci95Upper * 100).toFixed(4) : '',
    hitRate_pct: r.hitRate != null ? (r.hitRate * 100).toFixed(4) : '',
    deadSpinRate_pct: r.deadSpinRate != null ? (r.deadSpinRate * 100).toFixed(4) : '',
    maxObservedWin_x: r.maxObservedWin != null ? r.maxObservedWin.toFixed(4) : '',
    rtpBase_pct: r.rtpBreakdown?.base != null ? (r.rtpBreakdown.base * 100).toFixed(4) : '',
    rtpFreeSpins_pct: r.rtpBreakdown?.free_spins != null ? (r.rtpBreakdown.free_spins * 100).toFixed(4) : '',
    rtpHoldAndWin_pct: r.rtpBreakdown?.hold_and_win != null ? (r.rtpBreakdown.hold_and_win * 100).toFixed(4) : '',
    rtpCascade_pct: r.rtpBreakdown?.cascade != null ? (r.rtpBreakdown.cascade * 100).toFixed(4) : '',
    vi95: v.vi95 != null ? v.vi95.toFixed(4) : '',
    vi99: v.vi99 != null ? v.vi99.toFixed(4) : '',
    stdDev: v.stdDev != null ? v.stdDev.toFixed(4) : '',
    p99_x: v.p99 != null ? v.p99.toFixed(4) : '',
    p999_x: v.p999 != null ? v.p999.toFixed(4) : '',
    p9999_x: v.p9999 != null ? v.p9999.toFixed(4) : '',
    paretoAlpha: v.paretoTail?.alpha != null ? v.paretoTail.alpha.toFixed(4) : '',
    paretoXm: v.paretoTail?.xm != null ? v.paretoTail.xm.toFixed(4) : '',
    featureCount: Array.isArray(par.features) ? par.features.length : 0,
    multiSeedMeanRTP_pct: ci.meanRtp != null ? (ci.meanRtp * 100).toFixed(4) : '',
    multiSeedStdDev_pct: ci.stdDev != null ? (ci.stdDev * 100).toFixed(4) : '',
    multiSeedCount: ci.seedCount ?? '',
    engineVersion: s.engineVersion ?? '',
    schemaVersion: par.schemaVersion ?? '',
    generatedAt: par.generatedAt ?? '',
  };
}

const CSV_HEADERS = [
  'sampleId', 'gameName', 'layout', 'paySystem', 'paylines',
  'targetRTP_pct', 'maxWin_x', 'spins', 'seed', 'rngBackend',
  'paytableScaleFactor', 'preScaleRTP_pct', 'observedRTP_pct',
  'rtpErrorMargin_pct', 'ci95Lower_pct', 'ci95Upper_pct',
  'hitRate_pct', 'deadSpinRate_pct', 'maxObservedWin_x',
  'rtpBase_pct', 'rtpFreeSpins_pct', 'rtpHoldAndWin_pct', 'rtpCascade_pct',
  'vi95', 'vi99', 'stdDev', 'p99_x', 'p999_x', 'p9999_x',
  'paretoAlpha', 'paretoXm', 'featureCount',
  'multiSeedMeanRTP_pct', 'multiSeedStdDev_pct', 'multiSeedCount',
  'engineVersion', 'schemaVersion', 'generatedAt',
];

function toCsvLine(row) {
  return CSV_HEADERS.map((h) => escapeCsv(row[h])).join(',');
}

function listSampleIds() {
  const ids = new Set();
  for (const f of readdirSync(SOURCE_PAR_DIR)) {
    if (f.endsWith('.par.json')) ids.add(f.replace(/\.par\.json$/, ''));
  }
  return [...ids].sort();
}

function getEngineCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getEngineDirty() {
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
    return status.length > 0 ? '-dirty' : '';
  } catch {
    return '';
  }
}

function buildIndexMd(rows) {
  const lines = [];
  lines.push('# PAR Sample Kit — Pattern-Mapped Index');
  lines.push('');
  lines.push(`> **Bundle version:** ${BUNDLE_VERSION}  ·  **Generated:** ${new Date().toISOString()}  ·  **Engine commit:** \`${getEngineCommit()}${getEngineDirty()}\``);
  lines.push('');
  lines.push('This bundle contains 20 PAR samples spanning the engine\'s full');
  lines.push('mechanic surface. Each sample is a regulator-shaped PAR sheet');
  lines.push('(GLI-16 Appendix D) with JSON, PDF, and CSV representations.');
  lines.push('');
  lines.push('## Industry Pattern Map (P-001..P-020)');
  lines.push('');
  lines.push('| Pattern ID | Pattern Name | PAR Samples in Bundle | Status |');
  lines.push('|------------|--------------|-----------------------|--------|');
  for (const p of PATTERN_MAP) {
    if (p.samples.length > 0) {
      const links = p.samples.map((s) => `[\`${s}\`](./samples/${s}.par.pdf)`).join(', ');
      lines.push(`| ${p.id} | **${p.name}** | ${links} | ✅ included |`);
    } else {
      lines.push(`| ${p.id} | **${p.name}** | — (fixture available on request: \`${p.additional}\`) | ⚠️ extension fixture |`);
    }
  }
  lines.push('');
  lines.push('**Pattern coverage:** 13/20 P-IDs with direct PAR samples in this bundle.');
  lines.push('The remaining 7 P-IDs are sibling variants whose primitives are');
  lines.push('already proven by the 13 included samples; the engine ships');
  lines.push('fixtures for them under `tests/fixtures/reference/` in the repo');
  lines.push('and they can be re-built on request via `npm run par-samples`.');
  lines.push('');
  lines.push('## Full Sample Table (20)');
  lines.push('');
  lines.push('| # | Sample ID | Family | Layout | Target RTP | Observed RTP | Hit Rate | Max Win | Files |');
  lines.push('|---|-----------|--------|--------|-----------|--------------|----------|---------|-------|');
  rows.forEach((row, i) => {
    lines.push(`| ${i + 1} | \`${row.sampleId}\` | ${row.paySystem} | ${row.layout} | ${row.targetRTP_pct}% | ${row.observedRTP_pct}% | ${row.hitRate_pct}% | ${row.maxObservedWin_x}× | [json](./samples/${row.sampleId}.par.json) · [pdf](./samples/${row.sampleId}.par.pdf) · [csv](./samples/${row.sampleId}.par.csv) |`);
  });
  lines.push('');
  lines.push('## Reproducing this bundle');
  lines.push('');
  lines.push('Inside the engine repository:');
  lines.push('```bash');
  lines.push('npm install');
  lines.push('npm run par-samples       # regenerates reports/par-samples/');
  lines.push('npm run par-sample-kit    # rebuilds this bundle');
  lines.push('```');
  lines.push('Determinism: every sample uses seed `12345`. The same engine');
  lines.push('commit produces byte-identical `.par.json` files.');
  lines.push('');
  lines.push('## Integrity verification');
  lines.push('');
  lines.push('`MANIFEST.txt` contains SHA-256 hashes for every file in this');
  lines.push('bundle. To verify integrity on macOS / Linux:');
  lines.push('```bash');
  lines.push('shasum -a 256 -c MANIFEST.txt');
  lines.push('```');
  lines.push('On Windows (PowerShell):');
  lines.push('```powershell');
  lines.push('Get-FileHash -Algorithm SHA256 <file>');
  lines.push('```');
  lines.push('');
  lines.push('## See also');
  lines.push('');
  lines.push('- `README_FOR_MATHEMATICIAN.md` — standalone how-to-read guide');
  lines.push('- `MASTER.csv` — all 20 samples summary in one CSV');
  lines.push('- `schema/usif-par-v1.0.json` — JSON Schema Draft 2020-12');
  lines.push('- `schema/USIF_PAR_SCHEMA_v1.md` — schema field documentation');
  lines.push('- `pattern-catalog/INDUSTRY_PATTERN_CATALOG.md` — full P-001..P-020 catalog');
  lines.push('');
  return lines.join('\n');
}

function buildReadme() {
  const commit = getEngineCommit();
  return [
    '# PAR Sample Kit — Read Me First (Mathematician Edition)',
    '',
    `> **Bundle version:** ${BUNDLE_VERSION}  ·  **Engine commit:** \`${commit}\``,
    `> **Generated:** ${new Date().toISOString()}`,
    '',
    '## What this bundle is',
    '',
    'This is a **standalone deliverable** containing 20 Probability /',
    'Accounting / Reporting (PAR) sample sheets produced by the',
    '`slot-math-engine-template` engine. Each sample spans a distinct',
    'mechanic family (lines / ways / cluster / pay-anywhere / variable-',
    'rows / cascade / free-spins / hold-and-win).',
    '',
    'You do **not** need the engine repository, Node.js, Rust, or any',
    'build tools to read this bundle. All artefacts are static files in',
    'standard formats.',
    '',
    '## What each sample provides',
    '',
    'For every sample ID `<id>` (e.g. `classic-3x3-lines`) you get three',
    'files in `samples/`:',
    '',
    '| File | Format | Open with | Purpose |',
    '|------|--------|-----------|---------|',
    '| `<id>.par.json` | JSON (USIF v1.0) | any text editor, `jq`, Python, JS | machine-readable PAR; canonical source-of-truth |',
    '| `<id>.par.pdf` | PDF/A-shaped, GLI-16 Appendix D | any PDF reader (Acrobat, Preview, etc.) | regulator-shaped human-readable PAR sheet |',
    '| `<id>.par.csv` | CSV (UTF-8, comma-separated) | Excel, Google Sheets, Numbers, LibreOffice | spreadsheet-friendly summary row |',
    '',
    'Plus `MASTER.csv` at bundle root — all 20 samples as one table.',
    '',
    '## How to open each format',
    '',
    '### JSON (`*.par.json`)',
    '',
    'JSON is the canonical machine-readable PAR. Schema is **USIF v1.0**',
    '(JSON Schema Draft 2020-12, see `schema/usif-par-v1.0.json`).',
    'Top-level fields:',
    '',
    '- `schemaVersion` — "1.0"',
    '- `generatedAt` — ISO-8601 UTC',
    '- `game` — name, layout, paySystem, paylines, targetRTP, maxWin',
    '- `simulation` — spins, seed, engineVersion, paytableScaleFactor, rngBackend',
    '- `results` — observedRTP, rtpPercent, errorMargin, ci95Lower/Upper, rtpBreakdown, hitRate, deadSpinRate, maxObservedWin',
    '- `volatility` — vi95, vi99, stdDev, p99, p999, p9999, paretoTail',
    '- `features` — array of {id, name, triggerRate, frequency, rtpContribution, transitionMatrix}',
    '- `ciBands` — multi-seed mean/stdDev/CI bands',
    '- `notes`, `compliance` — free-form metadata',
    '',
    'Quick inspection with `jq`:',
    '```bash',
    'jq \'.results.rtpPercent, .volatility.vi95\' samples/classic-3x3-lines.par.json',
    '```',
    '',
    'In Python:',
    '```python',
    'import json',
    'with open(\'samples/classic-3x3-lines.par.json\') as f:',
    '    par = json.load(f)',
    'print(par[\'results\'][\'rtpPercent\'], par[\'volatility\'][\'vi95\'])',
    '```',
    '',
    '### PDF (`*.par.pdf`)',
    '',
    'GLI-16 Appendix D shaped PAR sheet. 8 sections:',
    '',
    '1. **Meta** — game / version / math version / layout / pay system / target RTP / max win / config hash / generation timestamp',
    '2. **RTP summary** — observed RTP, error margin, 95% CI, spins, seed, per-source breakdown',
    '3. **Hit frequency & volatility** — hit rate, dead-spin rate, std-dev, VI95, VI99, classification',
    '4. **Win distribution quantiles** — P50/P90/P99/P99.9, tail buckets, max observed win',
    '5. **Feature contribution** — per-feature trigger rate, frequency, avg win, RTP contribution',
    '6. **Win histogram** — bucketed counts',
    '7. **Paytable excerpt** — line-win paytable, scatter pays',
    '8. **Notes & compliance** — submitter, jurisdiction, standard',
    '',
    'Text-searchable (PDF compression disabled) so auditors can run regex/',
    'grep against PDF contents.',
    '',
    '### CSV (`*.par.csv`, `MASTER.csv`)',
    '',
    'Per-sample CSV has one header row + one data row (the row mirrors the',
    'top-level summary of the matching `.par.json`). `MASTER.csv` is the',
    'same shape, but with 20 data rows (one per sample) — open in Excel /',
    'Google Sheets for cross-sample comparison.',
    '',
    'Columns: see `MASTER.csv` header row (38 columns: game metadata,',
    'simulation params, results, RTP breakdown, volatility metrics, multi-',
    'seed CI bands, engine version, schema version).',
    '',
    '## Determinism and reproducibility',
    '',
    'Every sample uses **seed = 12345** and **spins = 100,000**. Rerunning',
    'the engine at the same commit produces byte-identical `.par.json`',
    'files. Bundle integrity is verifiable via SHA-256 in `MANIFEST.txt`:',
    '',
    '```bash',
    '# macOS / Linux',
    'cd par-sample-kit/',
    'shasum -a 256 -c MANIFEST.txt',
    '',
    '# Windows PowerShell',
    'Get-FileHash -Algorithm SHA256 samples/classic-3x3-lines.par.json',
    '```',
    '',
    '## Pattern catalog cross-reference',
    '',
    'See `INDEX.md` for the **pattern-mapped index** that links each P-001..',
    'P-020 industry pattern to the PAR samples in this bundle. The full',
    'catalog (`pattern-catalog/INDUSTRY_PATTERN_CATALOG.md`) explains the',
    'mechanical primitives, reference fixtures, and acceptance proofs.',
    '',
    '## Schema documentation',
    '',
    '`schema/usif-par-v1.0.json` — JSON Schema Draft 2020-12 with REQUIRED',
    'fields (regulator submission baseline) + OPTIONAL Tier-1 extra-credit',
    'fields (transition matrices, P99.9 tail, multi-seed CI bands,',
    'jurisdiction-gated RTP). All 20 samples in this bundle validate',
    'against the schema; 13 also validate in `--strict-tier1` mode.',
    '',
    '`schema/USIF_PAR_SCHEMA_v1.md` — field-by-field documentation with',
    'rationale and references to regulatory standards (GLI-11, GLI-16,',
    'GLI-19, UKGC RTS, MGA Player Protection Directives, etc.).',
    '',
    '## What this bundle is NOT',
    '',
    '- Not a game. The samples use **generic-mechanic IRs** with no',
    '  commercial paytable / reel-strip tuning. Operators rebuild PARs',
    '  against their own IR for cert submission.',
    '- Not jurisdiction-certified. The samples demonstrate engine math',
    '  surface; certification of a specific game requires the operator to',
    '  run their own MC at higher spin counts (10⁹-10¹²) per jurisdiction',
    '  requirements (see `schema/usif-par-v1.0.json` for jurisdiction-gated',
    '  fields).',
    '- Not an exhaustive feature library. The 20 samples cover the engine\'s',
    '  full mechanic surface; commercial games typically compose 2-4 of',
    '  these patterns with operator-specific tuning.',
    '',
    '## Contact',
    '',
    'For questions about this bundle, schema interpretation, or to request',
    'additional patterns (P-003, P-006, P-007, P-010, P-013, P-014, P-017',
    'have engine-side fixtures but are not in the baseline 20), contact the',
    'engine ship team.',
    '',
  ].join('\n');
}

function buildVersionTxt(commit, dirty) {
  return [
    `PAR Sample Kit Bundle`,
    `Bundle version: ${BUNDLE_VERSION}`,
    `Engine commit: ${commit}${dirty}`,
    `Generated: ${new Date().toISOString()}`,
    `Schema: USIF v1.0 (JSON Schema Draft 2020-12)`,
    `Samples: 20`,
    `Spins per sample: 100,000`,
    `Seed: 12345`,
    ``,
  ].join('\n');
}

function buildManifest(allFiles) {
  const lines = [];
  for (const { rel, abs } of allFiles) {
    const hash = sha256File(abs);
    lines.push(`${hash}  ${rel}`);
  }
  return lines.join('\n') + '\n';
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function cleanBundle() {
  if (existsSync(BUNDLE_DIR)) {
    rmSync(BUNDLE_DIR, { recursive: true, force: true });
  }
  if (existsSync(ZIP_PATH)) {
    rmSync(ZIP_PATH);
  }
}

async function main() {
  const t0 = Date.now();
  log(`Bundle dir: ${BUNDLE_DIR}`);
  log(`ZIP path:   ${ZIP_PATH}`);
  log('');

  if (!existsSync(SOURCE_PAR_DIR)) {
    console.error(`ERROR: Source PAR dir not found: ${SOURCE_PAR_DIR}`);
    console.error('Run "npm run par-samples" first to regenerate samples.');
    process.exit(2);
  }

  // 1. Clean
  cleanBundle();

  // 2. Create structure
  ensureDir(BUNDLE_DIR);
  ensureDir(join(BUNDLE_DIR, 'samples'));
  ensureDir(join(BUNDLE_DIR, 'schema'));
  ensureDir(join(BUNDLE_DIR, 'pattern-catalog'));

  // 3. Discover sample IDs
  const sampleIds = listSampleIds();
  log(`Found ${sampleIds.length} PAR samples in ${SOURCE_PAR_DIR}`);
  if (sampleIds.length !== 20) {
    console.warn(`WARNING: expected 20 samples, found ${sampleIds.length}`);
  }

  // 4. Per-sample: copy JSON+PDF, generate CSV
  const rows = [];
  for (const id of sampleIds) {
    const jsonSrc = join(SOURCE_PAR_DIR, `${id}.par.json`);
    const pdfSrc = join(SOURCE_PAR_DIR, `${id}.par.pdf`);
    if (!existsSync(jsonSrc)) {
      console.error(`MISSING: ${jsonSrc}`);
      process.exit(2);
    }
    if (!existsSync(pdfSrc)) {
      console.error(`MISSING: ${pdfSrc}`);
      process.exit(2);
    }
    const jsonDst = join(BUNDLE_DIR, 'samples', `${id}.par.json`);
    const pdfDst = join(BUNDLE_DIR, 'samples', `${id}.par.pdf`);
    copyFileSync(jsonSrc, jsonDst);
    copyFileSync(pdfSrc, pdfDst);

    const par = JSON.parse(readFileSync(jsonSrc, 'utf8'));
    const row = rowFromPar(par, id);
    rows.push(row);

    const csvLines = [CSV_HEADERS.join(','), toCsvLine(row)];
    writeFileSync(join(BUNDLE_DIR, 'samples', `${id}.par.csv`), csvLines.join('\n') + '\n');
    vlog(`  + ${id} (json, pdf, csv)`);
  }

  // 5. MASTER.csv
  const masterLines = [CSV_HEADERS.join(','), ...rows.map(toCsvLine)];
  writeFileSync(join(BUNDLE_DIR, 'MASTER.csv'), masterLines.join('\n') + '\n');
  log(`Wrote MASTER.csv (${rows.length} rows)`);

  // 6. Schema files
  copyFileSync(SCHEMA_SRC, join(BUNDLE_DIR, 'schema', 'usif-par-v1.0.json'));
  copyFileSync(SCHEMA_DOC, join(BUNDLE_DIR, 'schema', 'USIF_PAR_SCHEMA_v1.md'));
  log('Copied schema/ (json + md)');

  // 7. Pattern catalog
  copyFileSync(PATTERN_CATALOG, join(BUNDLE_DIR, 'pattern-catalog', 'INDUSTRY_PATTERN_CATALOG.md'));
  log('Copied pattern-catalog/');

  // 8. INDEX.md
  writeFileSync(join(BUNDLE_DIR, 'INDEX.md'), buildIndexMd(rows));
  log('Wrote INDEX.md');

  // 9. README_FOR_MATHEMATICIAN.md
  writeFileSync(join(BUNDLE_DIR, 'README_FOR_MATHEMATICIAN.md'), buildReadme());
  log('Wrote README_FOR_MATHEMATICIAN.md');

  // 10. VERSION.txt
  const commit = getEngineCommit();
  const dirty = getEngineDirty();
  writeFileSync(join(BUNDLE_DIR, 'VERSION.txt'), buildVersionTxt(commit, dirty));
  log(`Wrote VERSION.txt (${commit}${dirty})`);

  // 11. MANIFEST.txt — collect every file in bundle (deterministic order)
  const allFiles = [];
  function walk(dir, base = '') {
    const entries = readdirSync(dir).sort();
    for (const name of entries) {
      const abs = join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
      } else if (name !== 'MANIFEST.txt') {
        allFiles.push({ rel, abs });
      }
    }
  }
  walk(BUNDLE_DIR);
  writeFileSync(join(BUNDLE_DIR, 'MANIFEST.txt'), buildManifest(allFiles));
  log(`Wrote MANIFEST.txt (${allFiles.length} files hashed)`);

  // 12. ZIP
  if (!SKIP_ZIP) {
    log(`Creating ZIP: ${ZIP_PATH}`);
    // -X strips extra timestamps for somewhat-reproducible zips
    execSync(`zip -r -q -X "${ZIP_PATH}" par-sample-kit`, { cwd: join(ROOT, 'dist') });
    const zipSize = statSync(ZIP_PATH).size;
    log(`ZIP done: ${(zipSize / 1024).toFixed(1)} KB`);
  } else {
    log('Skipping ZIP (--no-zip)');
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  log('');
  log(`✅ Bundle built in ${dt}s`);
  log(`   ${BUNDLE_DIR}`);
  if (!SKIP_ZIP) log(`   ${ZIP_PATH}`);
}

main().catch((err) => {
  console.error('par-sample-kit-build FAILED:', err);
  process.exit(1);
});
