#!/usr/bin/env node
/**
 * tools/_par-sheet-structure-probe.mjs
 *
 * PAR-1 (PAR-SHEET AUTONOMOUS INGEST) — Boki direktiva 2026-06-26.
 *
 * # PURPOSE
 *
 * Par sheet format is **not strict** — every vendor lays out the workbook
 * differently. Sheet names, header rows, reel-strip layout, paytable
 * orientation, feature-allocation tables all move around. Writing a
 * parser BEFORE we know what's actually inside is how we end up with
 * silent value drift on game #3.
 *
 * This probe is read-only structural mapping. It opens every par sheet
 * in `~/Desktop/ParSheets/` and emits a JSON report describing:
 *
 *   - Sheet inventory (name → row count, col count, has data)
 *   - Header candidates per sheet (rows where ≥3 string cells appear
 *     consecutively at non-zero column)
 *   - Reel-strip detection (sheets that look like vertical strips:
 *     single column of mostly 1-3 char symbols, > 50 rows)
 *   - Paytable detection (sheets with "pay3 / pay4 / pay5" header
 *     family — fuzzy match across vendor naming variants)
 *   - Feature math detection (RTP, hit, freq, FS, BW, max-win cap
 *     keywords with their cell coordinates)
 *   - Probable SWID + slug (filename-derived neutral slug)
 *
 * Output: `reports/par-sheet-structure.json` — one entry per file.
 *
 * # NOT IN SCOPE
 *
 * - Reading actual values (PAR-2 parser does that).
 * - Synthesizing a GameConfig (PAR-2).
 * - Any value transformation or validation (PAR-2 + PAR-5).
 *
 * # USAGE
 *
 *   node tools/_par-sheet-structure-probe.mjs               # default folder
 *   node tools/_par-sheet-structure-probe.mjs --dir <path>
 *   node tools/_par-sheet-structure-probe.mjs --out <path>
 *
 * # ANTI-VENDOR
 *
 * The probe report intentionally KEEPS vendor strings in the structure
 * inventory (they're useful signals for sheet detection). The downstream
 * PAR-2/PAR-3 emitters MUST run anti-vendor sanitization before writing
 * anything into the repo. This probe report itself lives under
 * `reports/` and is git-ignored from emit (see PAR-2 closeout).
 */

import { readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { argv } from 'node:process';
/* xlsx (SheetJS Community) ships CommonJS — the default export is the
 * XLSX namespace. ESM `import * as XLSX` would expose named re-exports
 * but `XLSX.readFile` lives on the default (CJS exports) object. */
import XLSXPkg from 'xlsx';
const XLSX = XLSXPkg.default || XLSXPkg;

const DEFAULT_DIR = resolve(process.env.HOME || '', 'Desktop', 'ParSheets');
const DEFAULT_OUT = resolve(
  process.cwd(),
  'reports',
  'par-sheet-structure.json',
);

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dir: DEFAULT_DIR, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = resolve(argv[++i]);
    else if (a === '--out') out.out = resolve(argv[++i]);
  }
  return out;
}

// ─── Slug derivation (vendor-neutral; filename-derived) ────────────────────────

/**
 * Derive a neutral slug from filename. Strips date suffixes, format
 * markers, and "ParSheets" prefix. Keeps a kebab-case identifier.
 *
 * Examples:
 *   "ParSheets_CashEruption 1.xlsx"          → "cash-eruption"
 *   "PARSheets_SkeletonKey.xlsx"              → "skeleton-key"
 *   "PAR_Sheets_FortKnoxWolfRun.xlsx"         → "fort-knox-wolf-run"
 *   "ParSheets_FortuneCoinBoost_Classic.xlsx" → "fortune-coin-boost-classic"
 *   "ParSheets_BookOfUnseen_BonusBuy.xlsx"    → "book-of-unseen-bonus-buy"
 */
function deriveSlug(filename) {
  let s = basename(filename, extname(filename));
  s = s.replace(/^par[_\s]*sheets?_?/i, '');
  s = s.replace(/\s+\d+$/, ''); // trailing " 1" etc
  s = s.replace(/[_\s]+/g, '-');
  // CamelCase split: "CashEruption" → "Cash-Eruption", "WolfRun" → "Wolf-Run"
  s = s.replace(/([a-z])([A-Z])/g, '$1-$2');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9-]/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s;
}

// ─── Sheet structure analyzer ────────────────────────────────────────────────

/**
 * Walk one sheet's cells and tally what kind of content it carries.
 * Returns a coarse fingerprint the downstream PAR-2 parser uses to
 * pick the right extractor per sheet.
 */
function analyzeSheet(ws) {
  const ref = ws['!ref'];
  if (!ref) {
    return {
      ref: null,
      rows: 0,
      cols: 0,
      stringCells: 0,
      numericCells: 0,
      emptyCells: 0,
      headerCandidates: [],
      reelStripLikely: false,
      paytableLikely: false,
      featureMathHits: {},
    };
  }
  const range = XLSX.utils.decode_range(ref);
  const rows = range.e.r - range.s.r + 1;
  const cols = range.e.c - range.s.c + 1;

  let stringCells = 0;
  let numericCells = 0;
  let emptyCells = 0;
  const headerCandidates = [];
  const featureMathHits = {};

  // Cheap fingerprint: walk first 500 rows × 30 cols max, that covers
  // every par sheet sheet I've ever seen and keeps runtime under 1 s
  // per file.
  const maxR = Math.min(range.e.r, range.s.r + 499);
  const maxC = Math.min(range.e.c, range.s.c + 29);

  // Reel-strip heuristic counters (mostly-short-string column dominance).
  const colShortStringCount = new Array(maxC - range.s.c + 1).fill(0);
  const colNumericCount = new Array(maxC - range.s.c + 1).fill(0);

  // Paytable heuristic: rows where "pay3 / pay4 / pay5" or similar
  // appear within 5 cells of each other.
  let payRowsFound = 0;
  const PAY_KEYS = /^(pay\s*3|3\s*oak|3\s*of\s*a\s*kind|pay3|x3)$/i;

  const FEATURE_KEYS = {
    rtp: /\brtp\b/i,
    hit: /\bhit\s*(rate|freq|frequency)\b/i,
    fs_freq: /\b(free[\s_-]?spins?|fs)\s*(freq|frequency|trigger|rate)\b/i,
    bw_freq: /\b(hold[\s_-]?(and|n|&)[\s_-]?win|bonus[\s_-]?wheel|h&w|bw)\b/i,
    max_win: /\b(max[\s_-]?win|win[\s_-]?cap|cap)\b/i,
    bonus_buy: /\bbonus[\s_-]?buy\b/i,
    cascade: /\bcascade\b/i,
    multiplier: /\bmultiplier\b/i,
  };

  for (let r = range.s.r; r <= maxR; r++) {
    let rowStringCount = 0;
    let rowNumericCount = 0;
    let firstStringCol = -1;
    let lastStringCol = -1;
    let payHits = 0;
    for (let c = range.s.c; c <= maxC; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || cell.v === undefined || cell.v === null || cell.v === '') {
        emptyCells++;
        continue;
      }
      if (cell.t === 'n') {
        numericCells++;
        rowNumericCount++;
        colNumericCount[c - range.s.c]++;
      } else if (cell.t === 's' || typeof cell.v === 'string') {
        stringCells++;
        rowStringCount++;
        const v = String(cell.v).trim();
        // Short string heuristic for reel strips: 1-4 chars, alphanumeric.
        if (v.length <= 4 && /^[A-Z0-9]+$/i.test(v)) {
          colShortStringCount[c - range.s.c]++;
        }
        if (firstStringCol < 0) firstStringCol = c;
        lastStringCol = c;
        if (PAY_KEYS.test(v)) payHits++;
        for (const [k, rx] of Object.entries(FEATURE_KEYS)) {
          if (rx.test(v)) {
            featureMathHits[k] = featureMathHits[k] || [];
            if (featureMathHits[k].length < 5) {
              featureMathHits[k].push({ addr, value: v.slice(0, 60) });
            }
          }
        }
      } else {
        // boolean / error / date — ignored for structure fingerprint
        emptyCells++;
      }
    }
    // Header candidate: row with ≥3 consecutive non-empty strings starting
    // at a low column index (vendors put headers in the leftmost cells).
    if (
      rowStringCount >= 3 &&
      firstStringCol <= range.s.c + 4 &&
      lastStringCol - firstStringCol <= 12
    ) {
      headerCandidates.push({ row: r, cols: [firstStringCol, lastStringCol] });
    }
    if (payHits >= 2) payRowsFound++;
  }

  // Reel-strip detection: ≥1 column with > 50 short-string cells and
  // dominant short-string ratio.
  const reelStripLikely = colShortStringCount.some(
    (cnt, idx) => cnt > 50 && cnt > colNumericCount[idx] * 4,
  );
  const paytableLikely = payRowsFound > 0;

  return {
    ref,
    rows,
    cols,
    stringCells,
    numericCells,
    emptyCells,
    headerCandidates: headerCandidates.slice(0, 20),
    reelStripLikely,
    paytableLikely,
    featureMathHits,
  };
}

// ─── File walker ─────────────────────────────────────────────────────────────

function probeFile(absPath) {
  const wb = XLSX.readFile(absPath, { cellDates: false, cellNF: false });
  const sheets = {};
  for (const name of wb.SheetNames) {
    sheets[name] = analyzeSheet(wb.Sheets[name]);
  }
  return {
    file: basename(absPath),
    slug: deriveSlug(absPath),
    sheetCount: wb.SheetNames.length,
    sheetNames: wb.SheetNames,
    sheets,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(argv.slice(2));
  let entries;
  try {
    entries = readdirSync(args.dir);
  } catch (e) {
    console.error(`ERROR: cannot read ${args.dir}: ${e.message}`);
    process.exit(2);
  }
  const xlsxFiles = entries
    .filter((f) => /\.xlsx$/i.test(f))
    .map((f) => join(args.dir, f))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });

  if (xlsxFiles.length === 0) {
    console.error(`ERROR: no xlsx files in ${args.dir}`);
    process.exit(2);
  }

  const reports = [];
  const t0 = Date.now();
  for (const f of xlsxFiles) {
    process.stdout.write(`probing ${basename(f)} … `);
    const t1 = Date.now();
    try {
      const r = probeFile(f);
      r.probeMs = Date.now() - t1;
      reports.push(r);
      console.log(`ok (${r.sheetCount} sheets, ${r.probeMs} ms)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      reports.push({ file: basename(f), error: e.message });
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    source_dir: args.dir,
    file_count: reports.length,
    total_probe_ms: Date.now() - t0,
    reports,
  };

  // Ensure reports/ exists.
  try {
    mkdirSync(resolve(args.out, '..'), { recursive: true });
  } catch {}

  writeFileSync(args.out, JSON.stringify(summary, null, 2));
  console.log(`\nstructure report → ${args.out}`);
  console.log(`total probe wall-time: ${summary.total_probe_ms} ms`);

  // Brief human-readable summary on stdout.
  console.log('\nper-file fingerprint:');
  for (const r of reports) {
    if (r.error) {
      console.log(`  ✗ ${r.file}: ${r.error}`);
      continue;
    }
    const sheetSummary = Object.entries(r.sheets).map(([name, s]) => {
      const tags = [];
      if (s.reelStripLikely) tags.push('reels');
      if (s.paytableLikely) tags.push('paytable');
      const featuresHit = Object.keys(s.featureMathHits);
      if (featuresHit.length > 0) tags.push(`feat:${featuresHit.join(',')}`);
      return `${name}(${s.rows}×${s.cols}${tags.length ? ` [${tags.join('|')}]` : ''})`;
    });
    console.log(`  ✓ ${r.file} → slug=${r.slug}`);
    console.log(`      sheets: ${sheetSummary.join(', ')}`);
  }
}

main();
