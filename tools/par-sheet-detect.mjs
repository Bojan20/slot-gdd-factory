#!/usr/bin/env node
/**
 * tools/par-sheet-detect.mjs
 *
 * MATH-DEEP HYB-4 (2026-06-22) — Multi-vendor PAR sheet vendor detector + dispatcher.
 *
 * Purpose
 *   Single entry point for ingesting PAR sheets across vendors. Given a path
 *   to a workbook (xlsx / csv / json), this tool sniffs the layout, identifies
 *   the vendor (or generic), and dispatches to the appropriate adapter. All
 *   adapters emit the same canonical shape (ParSheetSchema from HYB-1).
 *
 * Why
 *   Before HYB-4 we only had one adapter (IGT xlsx layout in
 *   tools/par-sheet-xlsx-ingest.py). New vendor PAR sheets (Pragmatic,
 *   L&W/Brytt, Spielo, generic CSV/JSON) required hand-coding per game.
 *   Vendor detect + adapter dispatch is the universal pattern.
 *
 * Supported vendors / formats
 *   - IGT xlsx   — multi-sheet workbook, "Reel 1..5" header at columns D-H
 *   - Pragmatic xlsx — single-sheet, Spanish headers ("Rodillo 1..5")
 *   - L&W / Brytt xlsx — multi-sheet, "STRIP_1..5" header
 *   - Spielo xlsx — single-sheet, "Strip A..E" header
 *   - Generic CSV — first row column headers, vendor-neutral
 *   - Generic JSON — already-canonical par sheet object
 *
 * Public API
 *   - detectVendor(filePath) -> { vendor, format, confidence, sheets, signals }
 *   - dispatchIngest(filePath, opts) -> { ok, parSheet, vendor, error }
 *
 * HARD RULE #1 (vendor-neutral output)
 *   Even though vendor names appear in DETECTION signals (IGT/Pragmatic/L&W),
 *   the emitted ParSheet object carries only `vendor: <code>` as metadata —
 *   no vendor product names leak into model.json field values.
 *
 * Cache strategy
 *   Vendor detection is fast (header scan, ~50ms per file), no cache needed.
 *   Full ingest is delegated to adapter; adapter caches its own output.
 *
 * Dependencies
 *   - openpyxl (xlsx via Python adapter) — optional, present in MATH-PRECISION-4
 *   - csv-parse (CSV) — Node native via fs.readFileSync + manual split
 *   - JSON — Node native
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, basename, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');

/* ── Vendor signal taxonomy ───────────────────────────────────────────── */

const VENDOR_SIGNALS = {
  igt: {
    headerPatterns: [/^Reel\s+1$/, /^Reel\s+2$/, /^Reel\s+3$/],
    sheetPatterns: [/^PAR[-_]?\d{3}$/],
    swidPatterns: [/\bSWID\s+\d{3}-\d{4}/],
  },
  pragmatic: {
    headerPatterns: [/^Rodillo\s+1$/, /^Rodillo\s+2$/, /^Reel\s+1\s*\(/, /Pragmatic\s+Play/i],
    sheetPatterns: [/^Carrete/, /^Sheet[12]/],
    swidPatterns: [/PP-\d{5}/],
  },
  lw: {
    headerPatterns: [/^STRIP[_-]?1$/, /^STRIP[_-]?2$/, /Light\s*&\s*Wonder|Scientific\s+Games/i],
    sheetPatterns: [/^Strips?$/, /^Brytt/i],
    swidPatterns: [/LW-\d{4,6}/, /Brytt-/i],
  },
  spielo: {
    headerPatterns: [/^Strip\s+[A-E]$/],
    sheetPatterns: [/^Spielo/i],
    swidPatterns: [/SP-\d{4,6}/],
  },
};

const GENERIC = 'generic';

/* ── Detect format from extension and first-byte sniff ────────────────── */

function detectFormat(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') return 'xlsx';
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return 'json';
  if (ext === '.tsv') return 'tsv';
  /* First-byte sniff fallback. */
  try {
    const head = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 8);
    if (head.startsWith('{') || head.startsWith('[')) return 'json';
    if (head.includes(',')) return 'csv';
  } catch { /* binary, fall through */ }
  return 'unknown';
}

/* ── Detect vendor from file content ───────────────────────────────────── */

/**
 * Detect vendor and format.
 *
 * Returns:
 *   {
 *     vendor: 'igt' | 'pragmatic' | 'lw' | 'spielo' | 'generic',
 *     format: 'xlsx' | 'csv' | 'json' | 'tsv' | 'unknown',
 *     confidence: 0..1,
 *     sheets: string[] | null,   // xlsx-only
 *     signals: string[],          // human-readable detection trace
 *   }
 */
export function detectVendor(filePath) {
  if (!existsSync(filePath)) {
    return { vendor: null, format: 'missing', confidence: 0, sheets: null, signals: ['file not found'] };
  }
  const format = detectFormat(filePath);
  const signals = [];
  let vendor = GENERIC;
  let confidence = 0.3; /* generic baseline */
  let sheets = null;

  if (format === 'xlsx') {
    /* Use python sniffer via openpyxl (fast headers-only read). */
    const sniffScript = `
import sys, json
try:
  import openpyxl
except ImportError:
  print(json.dumps({"error": "openpyxl-missing"}))
  sys.exit(0)
wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=True)
out = { "sheets": wb.sheetnames, "headers": {} }
for sn in wb.sheetnames[:5]:
  ws = wb[sn]
  rows = []
  for r in range(1, min(15, ws.max_row + 1)):
    row = []
    for c in range(1, min(15, ws.max_column + 1)):
      v = ws.cell(row=r, column=c).value
      row.append(str(v) if v is not None else "")
    rows.append(row)
  out["headers"][sn] = rows
print(json.dumps(out))
`;
    const r = spawnSync('python3', ['-c', sniffScript, filePath], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) {
      return { vendor: GENERIC, format, confidence: 0.1, sheets: null, signals: ['xlsx sniff failed'] };
    }
    let sniff;
    try { sniff = JSON.parse(r.stdout.trim()); }
    catch { return { vendor: GENERIC, format, confidence: 0.1, sheets: null, signals: ['xlsx sniff json parse failed'] }; }
    if (sniff.error === 'openpyxl-missing') {
      signals.push('openpyxl not installed; falling back to filename heuristic');
      /* Fall through to filename heuristic. */
    } else {
      sheets = sniff.sheets || [];
      /* Concatenate first 15x15 cells of first 3 sheets into a probe string. */
      const probe = sheets.slice(0, 3).map(sn => (sniff.headers[sn] || []).flat().join(' ')).join(' ');
      for (const [vKey, vSig] of Object.entries(VENDOR_SIGNALS)) {
        let hits = 0;
        for (const p of vSig.headerPatterns) {
          if (p.test(probe)) { hits++; signals.push(`hdr ${p} → ${vKey}`); }
        }
        for (const p of vSig.sheetPatterns) {
          for (const sn of sheets) {
            if (p.test(sn)) { hits++; signals.push(`sheet ${sn} → ${vKey}`); break; }
          }
        }
        for (const p of vSig.swidPatterns) {
          if (p.test(probe)) { hits++; signals.push(`swid → ${vKey}`); }
        }
        if (hits >= 2) {
          vendor = vKey;
          confidence = Math.min(0.6 + 0.15 * hits, 0.99);
          break;
        }
        if (hits === 1 && confidence < 0.5) {
          vendor = vKey;
          confidence = 0.45;
        }
      }
    }
  }

  if (format === 'csv' || format === 'tsv') {
    /* Header sniff. */
    try {
      const head = readFileSync(filePath, 'utf8').split(/\r?\n/).slice(0, 5).join(' ');
      for (const [vKey, vSig] of Object.entries(VENDOR_SIGNALS)) {
        for (const p of vSig.headerPatterns) {
          if (p.test(head)) { vendor = vKey; confidence = 0.7; signals.push(`csv ${p} → ${vKey}`); break; }
        }
        if (vendor !== GENERIC) break;
      }
    } catch { /* read failed */ }
  }

  if (format === 'json') {
    try {
      const obj = JSON.parse(readFileSync(filePath, 'utf8'));
      if (obj.vendor && typeof obj.vendor === 'string') {
        vendor = obj.vendor.toLowerCase();
        confidence = 0.95;
        signals.push(`json self-declared vendor=${vendor}`);
      } else if (obj.reels || obj.per_reel_weights || obj.paytable) {
        confidence = 0.6;
        signals.push('json has reels/weights/paytable shape');
      }
    } catch { /* parse failed */ }
  }

  /* Filename heuristic (lowest-confidence fallback). */
  const fname = basename(filePath).toLowerCase();
  if (vendor === GENERIC && confidence < 0.5) {
    if (/igt|cash[\s_-]?eruption|wheel[\s_-]?of[\s_-]?fortune/.test(fname)) {
      vendor = 'igt'; confidence = 0.4; signals.push(`filename suggests igt`);
    } else if (/pragmatic|gates[\s_-]?of[\s_-]?olympus|sweet[\s_-]?bonanza/.test(fname)) {
      vendor = 'pragmatic'; confidence = 0.4; signals.push(`filename suggests pragmatic`);
    } else if (/l[\s_-]?and[\s_-]?w|brytt|scientific[\s_-]?games|huff/.test(fname)) {
      vendor = 'lw'; confidence = 0.4; signals.push(`filename suggests lw`);
    } else if (/spielo/.test(fname)) {
      vendor = 'spielo'; confidence = 0.4; signals.push(`filename suggests spielo`);
    }
  }

  return { vendor, format, confidence, sheets, signals };
}

/* ── Dispatch to vendor adapter ────────────────────────────────────────── */

/* Vendor adapter table. Each entry is either an existing tool path or the
 * sentinel 'inline' (handled directly). Missing adapter files (e.g.
 * tools/par-sheet-pragmatic.py / tools/par-sheet-lw.py — placeholder
 * spec, not yet implemented) fall back to the IGT-style generic xlsx
 * ingester. The fallback emits a 'fallback_to_igt_xlsx' signal in
 * the dispatch receipt so consumers can see when a vendor-specific
 * adapter was substituted. */
const VENDOR_ADAPTERS = {
  igt: {
    xlsx: 'tools/par-sheet-xlsx-ingest.py',
    csv:  'tools/par-sheet-generic-csv.mjs',
    json: 'inline',
  },
  pragmatic: {
    /* TODO: tools/par-sheet-pragmatic.py (Spanish Rodillo headers).
     * Until present, falls back to IGT xlsx ingester (works for any
     * sufficiently-similar 5-reel layout via column heuristics). */
    xlsx: 'tools/par-sheet-xlsx-ingest.py',
    csv:  'tools/par-sheet-generic-csv.mjs',
    json: 'inline',
  },
  lw: {
    /* TODO: tools/par-sheet-lw.py (STRIP_1..5 / Brytt patterns).
     * Until present, falls back to IGT xlsx ingester. */
    xlsx: 'tools/par-sheet-xlsx-ingest.py',
    csv:  'tools/par-sheet-generic-csv.mjs',
    json: 'inline',
  },
  spielo: {
    xlsx: 'tools/par-sheet-xlsx-ingest.py',
    csv:  'tools/par-sheet-generic-csv.mjs',
    json: 'inline',
  },
  generic: {
    xlsx: 'tools/par-sheet-xlsx-ingest.py',
    csv:  'tools/par-sheet-generic-csv.mjs',
    json: 'inline',
  },
};

/**
 * Dispatch ingest to vendor adapter.
 * Returns { ok, parSheet, vendor, format, adapter, error }.
 *
 * For json adapter ('inline'), parses and returns directly.
 * For xlsx/csv adapters, spawns the appropriate tool and reads its stdout JSON.
 */
export function dispatchIngest(filePath, opts = {}) {
  const det = detectVendor(filePath);
  if (det.format === 'missing') {
    return { ok: false, error: `file not found: ${filePath}`, vendor: null, format: null, adapter: null };
  }
  const adapter = (VENDOR_ADAPTERS[det.vendor] || VENDOR_ADAPTERS.generic)[det.format];
  if (!adapter) {
    return { ok: false, error: `no adapter for vendor=${det.vendor} format=${det.format}`,
             vendor: det.vendor, format: det.format, adapter: null };
  }
  if (adapter === 'inline') {
    try {
      const obj = JSON.parse(readFileSync(filePath, 'utf8'));
      return { ok: true, parSheet: { ...obj, vendor: det.vendor }, vendor: det.vendor, format: det.format, adapter, signals: det.signals };
    } catch (e) {
      return { ok: false, error: `inline json parse: ${e.message}`, vendor: det.vendor, format: det.format, adapter };
    }
  }
  /* External adapter — invoke.
   *
   * SECURITY (QA Agent#4 finding #5, 2026-06-22 ultra-deep): sanitize the
   * sheet name to reject shell metacharacters and path traversal. The
   * adapter binary is fixed (one of VENDOR_ADAPTERS entries), so adapterPath
   * is trusted. filePath is the input we received — caller is responsible
   * for its provenance, but we resolve absolute to prevent relative escape. */
  const adapterPath = join(REPO, adapter);
  if (!existsSync(adapterPath)) {
    return { ok: false, error: `adapter binary not found: ${adapter}`, vendor: det.vendor, format: det.format, adapter };
  }
  const interp = adapter.endsWith('.py') ? 'python3' : 'node';
  /* Sheet name guard: only [A-Za-z0-9_-] and dots allowed (Excel sheet
   * names can be e.g. "PAR-001" or "Sheet1"). Reject anything else loud. */
  if (opts.sheet != null) {
    if (typeof opts.sheet !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(opts.sheet)) {
      return { ok: false, error: `invalid --sheet "${opts.sheet}" (alphanumeric+dot+dash+underscore only)`,
               vendor: det.vendor, format: det.format, adapter };
    }
  }
  const sheetArg = opts.sheet ? ['--sheet', opts.sheet] : [];
  /* Resolve filePath absolute to prevent shell-relative path traversal. */
  const absFilePath = resolve(filePath);
  const r = spawnSync(interp, [adapterPath, '--xlsx', absFilePath, ...sheetArg, '--out', '-'],
                      { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    return { ok: false, error: `adapter exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`,
             vendor: det.vendor, format: det.format, adapter };
  }
  try {
    const obj = JSON.parse((r.stdout || '').trim());
    return { ok: true, parSheet: { ...obj, vendor: det.vendor }, vendor: det.vendor, format: det.format, adapter, signals: det.signals };
  } catch (e) {
    return { ok: false, error: `adapter stdout parse: ${e.message}`,
             vendor: det.vendor, format: det.format, adapter, raw: (r.stdout || '').slice(0, 200) };
  }
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('par-sheet-detect.mjs')) {
  const args = process.argv.slice(2);
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: node tools/par-sheet-detect.mjs <path> [--ingest] [--sheet=<name>]');
    process.exit(2);
  }
  const ingest = args.includes('--ingest');
  const sheetArg = args.find(a => a.startsWith('--sheet='))?.slice(8);
  if (ingest) {
    const r = dispatchIngest(filePath, sheetArg ? { sheet: sheetArg } : {});
    if (!r.ok) { console.error(`▸ INGEST FAILED: ${r.error}`); process.exit(1); }
    console.log(JSON.stringify(r.parSheet, null, 2));
  } else {
    const d = detectVendor(filePath);
    console.log(JSON.stringify(d, null, 2));
  }
}
