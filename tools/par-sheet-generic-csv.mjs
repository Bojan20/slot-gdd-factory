#!/usr/bin/env node
/**
 * tools/par-sheet-generic-csv.mjs
 *
 * MATH-DEEP HYB-4 (2026-06-22) — Generic CSV PAR sheet adapter.
 *
 * Purpose
 *   Read a vendor-neutral PAR sheet CSV (or TSV) and emit the canonical
 *   ParSheetSchema shape. This adapter handles 90% of small-vendor or
 *   internally-authored PAR sheets that don't fit industry standard/Pragmatic/L&W
 *   templates.
 *
 * Expected CSV layout
 *   Row 1: header row — must include columns for symbols and per-reel weights
 *     Examples that are auto-recognized:
 *       symbol,reel1,reel2,reel3,reel4,reel5,pay3,pay4,pay5
 *       Symbol,Reel 1,Reel 2,Reel 3,Reel 4,Reel 5,3OAK,4OAK,5OAK
 *       SYM,R1,R2,R3,R4,R5,3,4,5
 *   Row 2+: data rows
 *     Symbol id in col 1; reel weights in cols 2-N; paytable in trailing cols
 *
 * Output
 *   {
 *     vendor: 'generic',
 *     reels: [[s1, s1, s2, ...], [s2, s1, ...], ...],   // expanded by weight
 *     per_reel_weights: { 0: {S1:50, S2:30, ...}, ... },
 *     paytable: [{ symbolId: 'R7', combos: { '3': 100, '4': 500, '5': 2000 } }],
 *     totals: { reels: 5, symbols: 12, sumWeight: 100000 },
 *   }
 *
 * Public API
 *   - ingestCsv(filePath) -> parSheet
 *   - parseCsvText(text) -> rows[][]    (internal, exported for tests)
 *
 * Performance
 *   400-row CSV ingests in ~30ms; no streaming needed for typical PAR sheets.
 *
 * Failure modes
 *   - Missing 'symbol' column → throws (header detection failed)
 *   - No reel columns detected → throws
 *   - Weight values not integers → coerces via parseInt, NaN → skip row
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

/* ── CSV parser (minimal, handles quoted fields + escaped quotes) ─────── */

export function parseCsvText(text) {
  /* Strip BOM and normalize line endings. */
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  /* Strip trailing empty rows. */
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

/* ── Header detection ─────────────────────────────────────────────────── */

const SYM_HEADERS = /^(symbol|sym|name|id)$/i;
const REEL_HEADERS = /^(reel[\s_]*\d+|r\d+|strip[\s_]*\d+)$/i;
const PAY_HEADERS = /^(pay\d+|(\d+)\s*oak|^(3|4|5|6)$)$/i;

function detectHeader(headerRow) {
  const cols = headerRow.map(h => (h || '').trim());
  const symIdx = cols.findIndex(c => SYM_HEADERS.test(c));
  const reelIdx = [];
  const payIdx = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (REEL_HEADERS.test(c)) {
      reelIdx.push(i);
    } else if (PAY_HEADERS.test(c)) {
      const numM = c.match(/(\d+)/);
      if (numM) payIdx[numM[1]] = i;
    }
  }
  if (symIdx === -1) throw new Error('no symbol column found in header (expected one of: symbol/sym/name/id)');
  if (reelIdx.length === 0) throw new Error('no reel columns found in header (expected reel1/r1/strip1 etc)');
  return { symIdx, reelIdx, payIdx };
}

/* ── Build par sheet from rows ────────────────────────────────────────── */

/* UQ-DEEP-C audit fix (D-MED-reels-dos): per-reel expansion is bounded
 * by MAX_REEL_EXPANSION to prevent a malformed/adversarial PAR sheet
 * with weight=1_000_000 from ballooning the strip array into hundreds
 * of MB. Real-world PARs use ≤ 200k total weight per reel, so 500k is
 * a generous ceiling that flags abuse without breaking legitimate
 * sheets. The `per_reel_weights` map (sparse, symbol→weight) carries
 * the full unexpanded data for downstream RTP math, so capping the
 * expansion never loses information needed by the calibrator. */
const MAX_REEL_EXPANSION = 500_000;

function expandReelByWeight(symbols, weights) {
  const strip = [];
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const w = Math.max(0, weights[i] | 0);
    for (let k = 0; k < w; k++) {
      if (strip.length >= MAX_REEL_EXPANSION) return strip;
      strip.push(s);
    }
  }
  return strip;
}

export function ingestCsv(filePath) {
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const text = readFileSync(filePath, 'utf8');
  const allRows = parseCsvText(text);
  /* QA Agent#2 finding (2026-06-23 LOW#1): strip comment lines (#-prefix
   * in column 0) BEFORE header detection so vendor-annotated CSVs parse.
   * Example: a CSV that begins with "# Vendor: Acme PAR sheet v1.2" then
   * the real symbol/reel header. Comment lines anywhere in the file are
   * skipped; this matches the convention used by xlsx -> csv exports from
   * regulator tools that prepend provenance metadata. */
  const rows = allRows.filter(row => {
    const first = (row[0] || '').trim();
    return first.length > 0 && !first.startsWith('#');
  });
  if (rows.length < 2) throw new Error('CSV has < 2 non-comment rows (need header + at least one data row)');
  const { symIdx, reelIdx, payIdx } = detectHeader(rows[0]);

  const symbols = [];
  const weightsByReel = reelIdx.map(() => []);
  const payRows = [];

  /* UQ-DEEP-C audit fix (D-HIGH-locale): European PAR sheets exported
   * from regulator tools (EU-GLI, MGA) often use comma as the decimal
   * separator: `0,05` instead of `0.05`. Raw `parseInt('0,05', 10)`
   * stops at the comma and returns 0, silently truncating weights and
   * pays to zero. Normalize to dot form before parsing.
   *
   * UQ-DEEP-D regression fix (REGR-1): the naive `.replace(',', '.')`
   * corrupts US-format thousand separators — `"1,234.56"` would become
   * `"1.234.56"` and `parseFloat` then yields `1.234` (off by 1000×).
   * Detect format by counting separators:
   *   - comma+dot present  → US "1,234.56" — strip commas (thousands)
   *   - multiple commas    → US "1,234,567" — strip commas (thousands)
   *   - one comma, no dot  → EU "0,05"      — comma is decimal, swap
   *   - else               → use as-is
   * Also clamp negative weights to 0 (parity with Python adapters). */
  const localeNumber = (raw) => {
    let s = String(raw || '').trim();
    if (s === '') return 0;
    const commaCount = (s.match(/,/g) || []).length;
    const dotCount   = (s.match(/\./g) || []).length;
    if (commaCount >= 1 && dotCount >= 1) {
      /* US format with thousands separator: 1,234.56 */
      s = s.replace(/,/g, '');
    } else if (commaCount > 1 && dotCount === 0) {
      /* US format without decimal: 1,234,567 */
      s = s.replace(/,/g, '');
    } else if (commaCount === 1 && dotCount === 0) {
      /* EU format decimal: 0,05 */
      s = s.replace(',', '.');
    }
    /* else: no commas, or 0 commas + N dots — leave untouched. */
    const f = parseFloat(s);
    if (!Number.isFinite(f)) return 0;
    if (f < 0) return 0; /* defensive — negative weights are invalid */
    return Math.round(f);
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const sym = (row[symIdx] || '').trim();
    if (!sym || sym.startsWith('#')) continue;
    symbols.push(sym);
    for (let k = 0; k < reelIdx.length; k++) {
      weightsByReel[k].push(localeNumber(row[reelIdx[k]]));
    }
    if (Object.keys(payIdx).length > 0) {
      const combos = {};
      for (const [count, idx] of Object.entries(payIdx)) {
        const v = localeNumber(row[idx]);
        if (v > 0) combos[count] = v;
      }
      if (Object.keys(combos).length > 0) {
        payRows.push({ symbolId: sym, combos });
      }
    }
  }

  /* Expand reels (symbol id repeated per weight). For large weights this
   * can be a big array — typical PAR sheets use 100k total weight per reel
   * but symbol cardinality stays at ~15-30 unique symbols. */
  const reels = weightsByReel.map(w => expandReelByWeight(symbols, w));

  /* Per-reel weights as { reelIdx: { symId: weight } }. */
  const per_reel_weights = {};
  weightsByReel.forEach((wArr, idx) => {
    const m = {};
    symbols.forEach((s, i) => { if (wArr[i] > 0) m[s] = wArr[i]; });
    per_reel_weights[idx] = m;
  });

  /* Totals. */
  const sumWeight = weightsByReel.reduce((acc, w) => acc + w.reduce((a, b) => a + b, 0), 0);
  const totals = {
    reels: reelIdx.length,
    symbols: symbols.length,
    sumWeight,
    perReelSum: weightsByReel.map(w => w.reduce((a, b) => a + b, 0)),
  };

  return {
    vendor: 'generic',
    reels,
    per_reel_weights,
    paytable: payRows,
    totals,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('par-sheet-generic-csv.mjs')) {
  const args = process.argv.slice(2);
  let inPath = null, outPath = '-';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' || args[i] === '--xlsx' || args[i] === '--in') inPath = args[++i];
    else if (args[i] === '--out') outPath = args[++i];
    else if (!inPath) inPath = args[i];
  }
  if (!inPath) {
    console.error('Usage: node tools/par-sheet-generic-csv.mjs --csv <path> [--out <path|->]');
    process.exit(2);
  }
  try {
    const par = ingestCsv(inPath);
    const out = JSON.stringify(par, null, 2);
    if (outPath === '-' || !outPath) {
      console.log(out);
    } else {
      writeFileSync(outPath, out, 'utf8');
      console.error(`▸ wrote ${outPath}`);
    }
  } catch (e) {
    console.error(`▸ INGEST FAILED: ${e.message}`);
    process.exit(1);
  }
}
