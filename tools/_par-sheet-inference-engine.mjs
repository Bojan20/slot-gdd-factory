#!/usr/bin/env node
/**
 * tools/_par-sheet-inference-engine.mjs
 *
 * F3-a (Boki 2026-06-27) — Inference engine for UNKNOWN vendor par sheet
 * formats. Where `_par-sheet-to-model.mjs::classifySheet()` returns a
 * hard label per sheet (summary/reels/paytable/...), this engine:
 *
 *   1. Walks every sheet and emits a confidence-scored multi-kind
 *      classification (a sheet can be both "summary" 0.8 and "paylines"
 *      0.3 — operators can drop multi-payload xlsx files).
 *
 *   2. Emits per-sheet anchor cells:
 *        - rtpCell    — most likely RTP value location
 *        - paytableHeaderRow — header row index for the paytable block
 *        - reelStartCol      — first reel-strip column address
 *        - hnwTableRow       — first row of a Hold & Win value table
 *        - fsScheduleRow     — first row of a Free Spin awards schedule
 *
 *   3. Detects vendor signature against a known-vendor pattern DB:
 *        - Light & Wonder  (par_001/par_002/par_003/par_004 sheets,
 *                            CSF/CES/CN naming)
 *        - Pragmatic Play  (rodillo_*, sistema_, premios_)
 *        - IGT             (Reel_ prefix, RNG_ tables)
 *        - Aristocrat      (BG_/FG_ split, Pull_ table)
 *        - generic         (no signature matched)
 *
 *   4. Cross-correlates: paytable symbol IDs must reference reel-strip
 *      symbols. A high cross-correlation gives strong confidence that
 *      both the paytable and reel anchors are correctly identified.
 *
 * Used by:
 *   - `_par-sheet-to-model.mjs` (planned: best-effort guide-map for
 *     extractors when generic extraction would fall back to defaults).
 *   - `par-sheet-pipeline.mjs` (stage between INGEST and CLASSIFY —
 *     surfaces structural confidence to operator).
 *   - Audit reports — gives a human-readable "what does this xlsx
 *     actually contain" answer.
 *
 * # USAGE
 *
 *   node tools/_par-sheet-inference-engine.mjs --xlsx <path> [--json]
 *
 * # OUTPUT (text mode)
 *
 *   Vendor signature: Light & Wonder (confidence 0.92)
 *   Sheets analyzed: 4
 *   ┌───────────┬──────────────────────┬─────────────────┐
 *   │ Sheet       │ Inferred kind(s)        │ Confidence       │
 *   ├───────────┼──────────────────────┼─────────────────┤
 *   │ par_001     │ summary + reels        │ 0.85 / 0.62      │
 *   │ par_002     │ reels                  │ 0.81             │
 *   │ ...
 *   └───────────┴──────────────────────┴─────────────────┘
 *   Anchors:
 *     rtp                par_001!I54 (94.99 %)
 *     paytableHeaderRow  par_001 row 134
 *     reelStartCol       par_002 col B
 *
 * # OUTPUT (--json mode)
 *
 *   JSON.stringify(inference, null, 2) — full structured report.
 *
 * # ANTI-VENDOR
 *
 *   Vendor signature DETECTION is allowed (it's how we know which
 *   extractor heuristics to weight). Vendor NAME is NEVER emitted into
 *   downstream model.json — `_par-sheet-to-model` continues to scrub via
 *   antiVendorShield. This file only writes the vendor label into the
 *   inference report which lives at `reports/par-inference/<slug>.json`
 *   for operator audit (out of the model emission path).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import XLSXPkg from 'xlsx';

const XLSX = XLSXPkg.default ?? XLSXPkg;

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const INFERENCE_REPORT_DIR = join(REPO, 'reports', 'par-inference');

/* ─── Vendor signature DB ──────────────────────────────────────────── */

/**
 * Vendor signature heuristics. Each entry has:
 *   - id: canonical short name (slug-safe)
 *   - label: human-readable
 *   - sheetNamePattern: regex against sheet-name list (joined w/ space)
 *   - headerCellPattern: optional regex against first 20 rows × 20 cols
 *                        cell strings (catches in-cell branding)
 *   - weight: 0..1 multiplier; sum-of-weights determines confidence
 *
 * Order matters only when two vendors share a substring — more specific
 * patterns should come first.
 */
const VENDOR_DB = [
  {
    id: 'light-and-wonder',
    label: 'Light & Wonder',
    /* PAR_001 (underscore) and PAR-001 (dash) both seen in the wild;
     * Cash Eruption uses the dash form, Fortune Coin Boost the
     * underscore form. Accept either. */
    sheetNamePattern: /\bpar[_\-]\d{3}\b/i,
    headerCellPattern: /CSF_\d|CES_(CRED|FREE|PROG)|CoinType_(BG|FG)|Fireball|Volcano|RTP|Reel\s*Strip/i,
    weight: 0.45,
  },
  {
    id: 'pragmatic-play',
    label: 'Pragmatic Play',
    sheetNamePattern: /rodillo|sistema|premios|jugar/i,
    headerCellPattern: /pago\s+por|jugada|simbolo/i,
    weight: 0.45,
  },
  {
    id: 'igt',
    label: 'IGT',
    sheetNamePattern: /^Reel_\d|RNG_/i,
    headerCellPattern: /Reel\s*Strip\s+\d|IGT|Game\s+ID/i,
    weight: 0.40,
  },
  {
    id: 'aristocrat',
    label: 'Aristocrat',
    sheetNamePattern: /^(BG|FG)_|^Pull_/i,
    headerCellPattern: /Aristocrat|Pull\s+Table|BG_Reel/i,
    weight: 0.40,
  },
];

/* ─── Cell helpers ────────────────────────────────────────────────── */

function cellAt(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r, c })];
}

function cellString(ws, r, c) {
  const cell = cellAt(ws, r, c);
  if (!cell || cell.v === undefined || cell.v === null) return null;
  return String(cell.v).trim();
}

function cellNumber(ws, r, c) {
  const cell = cellAt(ws, r, c);
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 'n') return cell.v;
  const n = Number(cell.v);
  return Number.isFinite(n) ? n : null;
}

function sheetRange(ws) {
  if (!ws['!ref']) return null;
  return XLSX.utils.decode_range(ws['!ref']);
}

/* ─── Per-sheet multi-kind classifier ─────────────────────────────── */

/**
 * Score a sheet against each candidate kind. A sheet can land multiple
 * non-zero kinds — operators frequently pack summary + reels into one
 * tab. Confidence scores are independent (0..1) per kind.
 *
 * @param {object} ws       XLSX worksheet
 * @param {string} sheetName
 * @returns {Object<string, number>} kind → confidence
 */
export function scoreSheetKinds(ws, sheetName) {
  const scores = {
    summary: 0,
    reels: 0,
    paytable: 0,
    paylines: 0,
    freespin: 0,
    holdandwin: 0,
    hundredspins: 0,
    other: 0,
  };

  const name = sheetName.toLowerCase();
  if (/summary/.test(name)) scores.summary += 0.6;
  if (/100\s*spin/.test(name)) scores.hundredspins += 0.7;
  if (/payline|line/.test(name)) scores.paylines += 0.5;
  if (/free\s*spin|bonus/.test(name)) scores.freespin += 0.4;
  if (/hold|cash\s*on/.test(name)) scores.holdandwin += 0.4;

  const range = sheetRange(ws);
  if (!range) {
    scores.other = 1;
    return scores;
  }

  /* Walk first 200 × 80 cells. Rich Light & Wonder par sheets pack
   * structural anchors (RTP, paytable header, reel strips) into rows
   * 50-150 and columns A-CX (cell area >100k); the 80×40 scan in PAR-1
   * missed everything past row 80. Even with the wider window, scan
   * stays sub-second per sheet on a 5×3 par. */
  const maxR = Math.min(range.e.r, range.s.r + 199);
  const maxC = Math.min(range.e.c, range.s.c + 79);

  let rtpHits = 0;
  let paytableRowHits = 0;
  let shortStrColumns = 0;
  let hnwKeyword = 0;
  let fsScheduleKeyword = 0;
  let payline20Hits = 0;
  const colShortStr = new Array(maxC - range.s.c + 1).fill(0);
  const colNumeric = new Array(maxC - range.s.c + 1).fill(0);
  const PAY_RX = /^(pay\s*[345]|[345]\s*oak|[345]\s*of\s*a\s*kind|x[345])$/i;

  for (let r = range.s.r; r <= maxR; r++) {
    let rowPayHits = 0;
    for (let c = range.s.c; c <= maxC; c++) {
      const cell = cellAt(ws, r, c);
      if (!cell) continue;
      if (cell.t === 'n') {
        colNumeric[c - range.s.c]++;
      } else if (cell.t === 's' || typeof cell.v === 'string') {
        const v = String(cell.v).trim();
        if (!v) continue;
        if (v.length <= 4 && /^[A-Z0-9]+$/i.test(v)) {
          colShortStr[c - range.s.c]++;
        }
        if (PAY_RX.test(v)) rowPayHits++;
        if (/^\s*(rtp|return\s+to\s+player|payback)\s*[%:]?\s*\*?\s*$/i.test(v)) {
          rtpHits++;
        }
        if (/hold\s*(and|&)\s*win|fireball|orb\s+value/i.test(v)) {
          hnwKeyword++;
        }
        if (/free\s*spin\s+(award|schedule|count)|scatter\s+pays/i.test(v)) {
          fsScheduleKeyword++;
        }
        if (/^(line|payline)\s*\d{1,3}$/i.test(v)) {
          payline20Hits++;
        }
      }
    }
    if (rowPayHits >= 2) paytableRowHits++;
  }

  for (let i = 0; i < colShortStr.length; i++) {
    if (colShortStr[i] > 30 && colShortStr[i] > colNumeric[i] * 4) {
      shortStrColumns++;
    }
  }

  if (rtpHits > 0) scores.summary += Math.min(0.4, rtpHits * 0.15);
  if (paytableRowHits > 0) scores.paytable += Math.min(0.6, paytableRowHits * 0.3);
  if (shortStrColumns >= 3) scores.reels += Math.min(0.8, shortStrColumns * 0.18);
  if (hnwKeyword > 0) scores.holdandwin += Math.min(0.5, hnwKeyword * 0.2);
  if (fsScheduleKeyword > 0) scores.freespin += Math.min(0.5, fsScheduleKeyword * 0.2);
  if (payline20Hits >= 5) scores.paylines += Math.min(0.6, payline20Hits * 0.08);

  /* "other" is the fallback only — set it inversely to the max of all
   * positive signals. */
  const maxSig = Math.max(scores.summary, scores.reels, scores.paytable,
    scores.paylines, scores.freespin, scores.holdandwin, scores.hundredspins);
  scores.other = Math.max(0, 1 - maxSig);

  /* Clamp every kind to [0, 1]. */
  for (const k of Object.keys(scores)) {
    scores[k] = Math.max(0, Math.min(1, scores[k]));
  }
  return scores;
}

/* ─── Anchor scanners ────────────────────────────────────────────── */

/**
 * Find the RTP value anchor across all sheets. Returns the cell with the
 * highest confidence by combining:
 *   - label-adjacent numeric within a 5-cell radius
 *   - value in plausible RTP range [50..130 %] (50% accounts for base-
 *     game-only declarations)
 *   - sheet kind score for "summary"
 */
export function findRtpAnchor(wb, sheetScores) {
  let best = null;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const summaryScore = sheetScores[sheetName]?.summary || 0;
    if (summaryScore < 0.2) continue;
    const maxR = Math.min(range.e.r, range.s.r + 120);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s || !/^\s*(rtp|return\s+to\s+player|payback|total\s+rtp)\s*[%:]?\s*\*?\s*$/i.test(s)) continue;
        /* Walk 5-cell neighborhood for plausible RTP number. */
        for (let dr = -1; dr <= 5; dr++) {
          for (let dc = -1; dc <= 5; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr, cc = c + dc;
            if (rr < range.s.r || cc < range.s.c) continue;
            const n = cellNumber(ws, rr, cc);
            if (n === null) continue;
            let pct = n;
            if (pct > 0 && pct <= 1.5) pct *= 100;
            if (pct < 50 || pct > 130) continue;
            const conf = summaryScore + 0.4 - (Math.abs(dr) + Math.abs(dc)) * 0.04;
            const candidate = {
              sheet: sheetName,
              cell: XLSX.utils.encode_cell({ r: rr, c: cc }),
              label: s,
              value_pct: pct,
              confidence: Math.max(0.05, Math.min(0.99, conf)),
            };
            if (!best || candidate.confidence > best.confidence) best = candidate;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Find the first paytable header row (row with ≥2 PAY-keyword hits)
 * across sheets tagged "paytable". Returns top-confidence candidate.
 */
export function findPaytableAnchor(wb, sheetScores) {
  const PAY_RX = /^(pay\s*[345]|[345]\s*oak|[345]\s*of\s*a\s*kind|x[345])$/i;
  let best = null;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const paytableScore = sheetScores[sheetName]?.paytable || 0;
    if (paytableScore < 0.2) continue;
    const maxR = Math.min(range.e.r, range.s.r + 200);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    for (let r = range.s.r; r <= maxR; r++) {
      let hits = 0;
      let firstC = null;
      for (let c = range.s.c; c <= maxC; c++) {
        const v = cellString(ws, r, c);
        if (!v) continue;
        if (PAY_RX.test(v)) {
          hits++;
          if (firstC === null) firstC = c;
        }
      }
      if (hits >= 2) {
        const conf = paytableScore + Math.min(0.5, hits * 0.15);
        const candidate = {
          sheet: sheetName,
          row: r + 1,
          firstCol: firstC !== null ? XLSX.utils.encode_col(firstC) : null,
          hits,
          confidence: Math.min(0.99, conf),
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
    }
  }
  return best;
}

/**
 * Find the first reel strip column (column with ≥30 short-string cells
 * dominating numeric content). Returns top-confidence candidate.
 */
export function findReelStartAnchor(wb, sheetScores) {
  let best = null;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const reelScore = sheetScores[sheetName]?.reels || 0;
    if (reelScore < 0.2) continue;
    const maxR = Math.min(range.e.r, range.s.r + 300);
    const maxC = Math.min(range.e.c, range.s.c + 39);
    const colShortStr = new Array(maxC - range.s.c + 1).fill(0);
    const colNumeric = new Array(maxC - range.s.c + 1).fill(0);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const cell = cellAt(ws, r, c);
        if (!cell) continue;
        if (cell.t === 'n') {
          colNumeric[c - range.s.c]++;
        } else if (cell.t === 's' || typeof cell.v === 'string') {
          const v = String(cell.v).trim();
          if (v.length <= 4 && /^[A-Z0-9]+$/i.test(v)) {
            colShortStr[c - range.s.c]++;
          }
        }
      }
    }
    for (let i = 0; i < colShortStr.length; i++) {
      if (colShortStr[i] > 30 && colShortStr[i] > colNumeric[i] * 4) {
        const conf = reelScore + Math.min(0.5, colShortStr[i] / 200);
        const candidate = {
          sheet: sheetName,
          col: XLSX.utils.encode_col(range.s.c + i),
          shortStrCount: colShortStr[i],
          confidence: Math.min(0.99, conf),
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
        break; /* Take the LEFTMOST reel column per sheet — typical layout. */
      }
    }
  }
  return best;
}

/* ─── Vendor signature ──────────────────────────────────────────── */

export function detectVendorSignature(wb) {
  const sheetNamesJoined = wb.SheetNames.join(' ');
  const headerSample = collectHeaderSample(wb);
  const scores = VENDOR_DB.map((entry) => {
    let score = 0;
    if (entry.sheetNamePattern && entry.sheetNamePattern.test(sheetNamesJoined)) {
      score += entry.weight;
    }
    if (entry.headerCellPattern && entry.headerCellPattern.test(headerSample)) {
      score += entry.weight;
    }
    return { id: entry.id, label: entry.label, confidence: score };
  });
  scores.sort((a, b) => b.confidence - a.confidence);
  const best = scores[0];
  if (!best || best.confidence < 0.3) {
    return { id: 'generic', label: 'generic / unknown', confidence: 0, candidates: scores };
  }
  return { ...best, candidates: scores };
}

function collectHeaderSample(wb) {
  const samples = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 19);
    const maxC = Math.min(range.e.c, range.s.c + 19);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (s) samples.push(s);
      }
    }
    if (samples.length > 2000) break;
  }
  return samples.join(' ');
}

/* ─── Cross-correlation ────────────────────────────────────────── */

/**
 * Verify paytable and reels reference the same symbol IDs. Returns a
 * 0..1 score:
 *   1.0  — every reel symbol appears in paytable header column
 *   0.0  — no overlap
 * Operators trust the paytable + reel anchors more when this is high.
 */
export function paytableReelsCrossCorrelation(wb, paytableAnchor, reelAnchor) {
  if (!paytableAnchor || !reelAnchor) return 0;
  const ws_pt = wb.Sheets[paytableAnchor.sheet];
  const ws_reel = wb.Sheets[reelAnchor.sheet];
  if (!ws_pt || !ws_reel) return 0;
  const reelRange = sheetRange(ws_reel);
  if (!reelRange) return 0;

  /* Symbol-ID column in paytable: typically the column LEFT of the
   * first PAY-keyword column. */
  const ptHeaderRowIdx = paytableAnchor.row - 1;
  const ptFirstColIdx = paytableAnchor.firstCol
    ? XLSX.utils.decode_col(paytableAnchor.firstCol)
    : 0;
  const symColIdx = Math.max(0, ptFirstColIdx - 1);

  const ptSymbols = new Set();
  const ptRange = sheetRange(ws_pt);
  if (!ptRange) return 0;
  for (let r = ptHeaderRowIdx + 1; r <= Math.min(ptHeaderRowIdx + 30, ptRange.e.r); r++) {
    const v = cellString(ws_pt, r, symColIdx);
    if (v && v.length <= 16) ptSymbols.add(v.toLowerCase());
  }
  if (ptSymbols.size === 0) return 0;

  /* Reel column: collect distinct short-string values. */
  const reelColIdx = XLSX.utils.decode_col(reelAnchor.col);
  const reelSymbols = new Set();
  for (let r = reelRange.s.r; r <= Math.min(reelRange.s.r + 200, reelRange.e.r); r++) {
    const v = cellString(ws_reel, r, reelColIdx);
    if (v && v.length <= 16) reelSymbols.add(v.toLowerCase());
  }
  if (reelSymbols.size === 0) return 0;

  let overlap = 0;
  for (const s of reelSymbols) {
    if (ptSymbols.has(s)) overlap++;
  }
  return overlap / reelSymbols.size;
}

/* ─── Main inference assembly ───────────────────────────────────── */

export function inferStructure(wb) {
  const sheetScores = {};
  const sheets = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const kinds = scoreSheetKinds(ws, sheetName);
    sheetScores[sheetName] = kinds;
    /* Top-3 kinds by confidence for the readable summary. */
    const ranked = Object.entries(kinds)
      .filter(([, v]) => v > 0.15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => ({ kind: k, confidence: Math.round(v * 100) / 100 }));
    sheets.push({
      name: sheetName,
      topKinds: ranked,
      allScores: kinds,
    });
  }
  const rtpAnchor = findRtpAnchor(wb, sheetScores);
  const paytableAnchor = findPaytableAnchor(wb, sheetScores);
  const reelAnchor = findReelStartAnchor(wb, sheetScores);
  const crossCorr = paytableReelsCrossCorrelation(wb, paytableAnchor, reelAnchor);
  const vendor = detectVendorSignature(wb);

  return {
    vendor,
    sheets,
    anchors: {
      rtp: rtpAnchor,
      paytable: paytableAnchor,
      reelStart: reelAnchor,
    },
    crossCorrelation: {
      paytable_reel_symbol_overlap: Math.round(crossCorr * 100) / 100,
    },
    summary: {
      sheetCount: sheets.length,
      anchorsResolved: [rtpAnchor, paytableAnchor, reelAnchor].filter(Boolean).length,
    },
  };
}

/* ─── CLI ────────────────────────────────────────────────────────── */

function parseArgs(args) {
  const out = { xlsx: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--xlsx') out.xlsx = args[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function renderHuman(inference, xlsxPath) {
  console.log(`\n=== Inference report for ${xlsxPath.split('/').pop()} ===`);
  console.log(`\nVendor signature: ${inference.vendor.label} (confidence ${inference.vendor.confidence.toFixed(2)})`);
  console.log(`Sheets analyzed:  ${inference.summary.sheetCount}`);
  console.log(`Anchors resolved: ${inference.summary.anchorsResolved}/3`);
  console.log(`Paytable↔reel symbol overlap: ${(inference.crossCorrelation.paytable_reel_symbol_overlap * 100).toFixed(0)}%`);

  console.log(`\nPer-sheet inference:`);
  for (const s of inference.sheets) {
    const top = s.topKinds.length > 0
      ? s.topKinds.map((k) => `${k.kind} ${k.confidence.toFixed(2)}`).join(' · ')
      : 'other';
    console.log(`  ${s.name.padEnd(18)} ${top}`);
  }

  console.log(`\nAnchors:`);
  if (inference.anchors.rtp) {
    console.log(`  rtp                 ${inference.anchors.rtp.sheet}!${inference.anchors.rtp.cell}  (${inference.anchors.rtp.value_pct.toFixed(2)}%, conf ${inference.anchors.rtp.confidence.toFixed(2)})`);
  } else {
    console.log(`  rtp                 — not found`);
  }
  if (inference.anchors.paytable) {
    console.log(`  paytable header     ${inference.anchors.paytable.sheet} row ${inference.anchors.paytable.row}  (${inference.anchors.paytable.hits} pay-cols, conf ${inference.anchors.paytable.confidence.toFixed(2)})`);
  } else {
    console.log(`  paytable header     — not found`);
  }
  if (inference.anchors.reelStart) {
    console.log(`  reel start          ${inference.anchors.reelStart.sheet} col ${inference.anchors.reelStart.col}  (${inference.anchors.reelStart.shortStrCount} sym, conf ${inference.anchors.reelStart.confidence.toFixed(2)})`);
  } else {
    console.log(`  reel start          — not found`);
  }
}

function writeReport(xlsxPath, inference) {
  if (!existsSync(INFERENCE_REPORT_DIR)) mkdirSync(INFERENCE_REPORT_DIR, { recursive: true });
  const slug = (xlsxPath.split('/').pop() || 'unknown')
    .replace(/\.xlsx$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const path = join(INFERENCE_REPORT_DIR, `${slug}.json`);
  writeFileSync(path, JSON.stringify({ xlsx: xlsxPath, inference, ingestedAt: new Date().toISOString() }, null, 2));
  return path;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (!opts.xlsx) {
    console.error('USAGE: --xlsx <path> [--json]');
    process.exit(2);
  }
  if (!existsSync(opts.xlsx)) {
    console.error(`FATAL: xlsx not found at ${opts.xlsx}`);
    process.exit(2);
  }
  const wb = XLSX.readFile(opts.xlsx, { cellDates: false, cellNF: false });
  const inference = inferStructure(wb);
  const reportPath = writeReport(opts.xlsx, inference);
  if (opts.json) {
    console.log(JSON.stringify(inference, null, 2));
  } else {
    renderHuman(inference, opts.xlsx);
    console.log(`\nReport written: ${reportPath}`);
  }
}

const __isCliEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (__isCliEntry) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}
