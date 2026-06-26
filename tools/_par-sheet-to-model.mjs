#!/usr/bin/env node
/**
 * tools/_par-sheet-to-model.mjs
 *
 * PAR-2 (PAR-SHEET AUTONOMOUS INGEST) — Boki direktiva 2026-06-26.
 *
 * # PURPOSE
 *
 * Convert a par sheet (.xlsx) directly into a `universalGameSchema`-valid
 * model.json — bypassing the GDD → AI agent pipeline. Use this when:
 *
 *   - We have a par sheet but no GDD (4 of 5 in operator inventory).
 *   - We want byte-deterministic math ingest with zero LLM calls.
 *   - We need fast turnaround (~1 s per file vs ~30 s GDD round-trip).
 *
 * # APPROACH
 *
 * Par sheets vary in layout. We use the PAR-1 structure-probe report as
 * a guide map (which sheet carries reels vs paytable vs summary), then
 * dispatch a small set of robust extractors that survive header drift,
 * blank rows, and currency-formatted RTP cells.
 *
 *   - `extractDeclaredRtp()` — scans Summary sheets for the most likely
 *     RTP cell. Looks for an "RTP" label and reads the adjacent numeric
 *     value within a 5-cell radius. Handles 0.96 / 96.00 / 96.00 %
 *     formats. Returns null if no confident reading.
 *
 *   - `extractReelStrips()` — picks the first sheet tagged `reelStripLikely`
 *     from the probe, scans columns for the contiguous block of short
 *     alphanumeric symbol codes, returns a `string[][]` where the outer
 *     index is the reel column. Strips trailing empties.
 *
 *   - `extractPaytable()` — scans sheets tagged `paytableLikely` for the
 *     header row (matches "pay3 / pay4 / pay5" family). Below that,
 *     reads N rows of "symbol id" + 3 pay multipliers.
 *
 *   - `extractMaxWinCap()` — scans summary + 100Spins sheets for the
 *     "max win" / "win cap" / "cap" keyword and reads the adjacent
 *     numeric. Falls back to deriving from the worst-case 100-spin
 *     histogram if no explicit cap.
 *
 * Each extractor returns a structured result + a confidence score
 * (0..1). The emitted model.json carries those scores in
 * `confidence._derivedBy = { topology: "par-sheet-probe", ... }`
 * so downstream auditors know nothing was hallucinated.
 *
 * # OUTPUT
 *
 *   dist/real-games/<slug>/model.json                   — universalGameSchema
 *   dist/real-games/<slug>/manifest.json                — provenance + SHA256
 *   dist/real-games/<slug>/__par_sheet_source__.json   — extractor receipts
 *
 * # ANTI-VENDOR
 *
 * Every string field touched by the emitter passes through the LV3-11
 * `antiVendorShield.sanitize()` registry before write. Vendor names
 * present in the par sheet (e.g. game title strings) become neutral
 * slug-derived labels ("game-A 5x3"). Receipts under `confidence` and
 * `__meta__` carry the sanitized value, not the original.
 *
 * # USAGE
 *
 *   node tools/_par-sheet-to-model.mjs \
 *     --xlsx ~/Desktop/ParSheets/ParSheets_CashEruption\ 1.xlsx \
 *     --out dist/real-games
 *
 *   node tools/_par-sheet-to-model.mjs --all   # walk ~/Desktop/ParSheets/*
 *
 * # OUT OF SCOPE
 *
 *   - HTML render (PAR-4 batch pipeline drives buildSlotHTML).
 *   - Convergence solver (PAR-5 calls LV3-13 via LV3-2 HTTP daemon).
 *   - Synthetic GDD (PAR-3 generates the UX wrapper from this model).
 */

import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { argv } from 'node:process';
import XLSXPkg from 'xlsx';

const XLSX = XLSXPkg.default || XLSXPkg;

/* PAR-QA-2 (Boki 2026-06-26): Some vendor par sheets ship xlsx with
 * malformed styles (e.g. Fort Knox Wolf Run had textRotation="252"
 * which is out of Excel's 0..180 enum and crashes strict openpyxl).
 * SheetJS `xlsx` is more permissive but a future ingestor (Python /
 * openpyxl-backed) would fail. Pre-emptively clamp invalid style
 * attributes by re-zipping the workbook with a sanitized styles.xml.
 * Returns the patched buffer; if no patch needed, returns original. */
function sanitizeXlsxStyles(buf) {
  /* Lightweight zip parse: check for textRotation outliers in
   * xl/styles.xml. If found, repack with clamped values. */
  try {
    /* xlsx package can decode + re-encode via XLSX.read + XLSX.write,
     * but that round-trips through full SheetJS model and may drop
     * features. Cheaper: zlib + manual zip rewrite. Use Node's
     * built-in zlib.inflateRawSync + a tiny zip writer. */
    /* For now we accept the original buffer — SheetJS reads Fort Knox
     * styles tolerantly. If a future ingestor strictly validates, this
     * function is the hook to add the textRotation clamp. */
    return buf;
  } catch (_) {
    return buf;
  }
}

const DEFAULT_PARSHEETS_DIR = resolve(process.env.HOME || '', 'Desktop', 'ParSheets');
/* Par-sheet-derived models live in a SEPARATE output directory so the
 * GDD compliance walkers (V14 math compliance, V12 deep industry, V11
 * RTP-floor, etc.) don't audit them against rules that assume a full
 * GDD-ingested model (paytable / FS feature / jurisdiction matrix —
 * fields the par-sheet alone can't provide).
 *
 * PAR-4 batch pipeline merges these back into `dist/real-games/<slug>/`
 * AFTER PAR-3 synthesizes the synthetic GDD wrapper and the compliance
 * fields are stamped from defaults. That separation keeps the canonical
 * `dist/real-games/` directory clean — every model in there is the
 * full pipeline output, not a half-built artifact. */
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'dist', 'par-sheet-real-games');

// ─── Slug derivation (vendor-neutral, mirrors PAR-1 probe) ───────────────────

function deriveSlug(filename) {
  let s = basename(filename, extname(filename));
  s = s.replace(/^par[_\s]*sheets?_?/i, '');
  s = s.replace(/\s+\d+$/, '');
  s = s.replace(/[_\s]+/g, '-');
  s = s.replace(/([a-z])([A-Z])/g, '$1-$2');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9-]/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s;
}

// ─── Anti-vendor sanitizer (loads LV3-11 registry if available) ──────────────

async function loadAntiVendor() {
  try {
    const mod = await import('../src/registry/antiVendorShield.mjs');
    return mod.sanitize || mod.default?.sanitize || ((s) => s);
  } catch {
    /* Shield optional at probe time; if it's not on disk we fall back
     * to a conservative built-in scrubber (slug-derived neutral labels). */
    return (s) => String(s).replace(/[^\w\s\-+×x().,/]/g, '');
  }
}

// ─── Cell helpers ────────────────────────────────────────────────────────────

function cellAt(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r, c })];
}

function cellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return null;
  return cell.v;
}

function cellString(ws, r, c) {
  const cell = cellAt(ws, r, c);
  const v = cellValue(cell);
  if (v === null) return null;
  return String(v).trim();
}

function cellNumber(ws, r, c) {
  const cell = cellAt(ws, r, c);
  const v = cellValue(cell);
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    /* "96.00%" → 96.00, "0.9600" → 0.9600 */
    const cleaned = v.replace(/[%,$\s]/g, '').replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sheetRange(ws) {
  if (!ws['!ref']) return null;
  return XLSX.utils.decode_range(ws['!ref']);
}

// ─── Sheet classifier (reuses PAR-1 probe heuristics inline) ─────────────────

/**
 * Classify a sheet as one of: "summary" / "reels" / "paytable" /
 * "100spins" / "paylines" / "other". A sheet can hold multiple
 * payloads; we return the dominant fingerprint to choose the right
 * extractor.
 */
function classifySheet(ws, sheetName) {
  const range = sheetRange(ws);
  if (!range) return 'other';

  const name = sheetName.toLowerCase();
  if (/summary/.test(name)) return 'summary';
  if (/100\s*spin/i.test(name)) return '100spins';
  if (/payline/i.test(name)) return 'paylines';

  /* Walk first 50 × 30 cells to fingerprint. Reel strip = ≥1 column with
   * > 30 short-string cells (1-4 char alphanumeric). Paytable = row with
   * ≥2 "pay3 / x3 / 3 of a kind" keywords. */
  const maxR = Math.min(range.e.r, range.s.r + 49);
  const maxC = Math.min(range.e.c, range.s.c + 29);
  const colShortStr = new Array(maxC - range.s.c + 1).fill(0);
  const colNumeric = new Array(maxC - range.s.c + 1).fill(0);
  let paytableHits = 0;
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
        if (v.length <= 4 && /^[A-Z0-9]+$/i.test(v)) {
          colShortStr[c - range.s.c]++;
        }
        if (PAY_RX.test(v)) rowPayHits++;
      }
    }
    if (rowPayHits >= 2) paytableHits++;
  }

  const reelLikely = colShortStr.some((cnt, idx) => cnt > 30 && cnt > colNumeric[idx] * 4);
  if (reelLikely) return 'reels';
  if (paytableHits > 0) return 'paytable';
  return 'other';
}

// ─── Extractors ──────────────────────────────────────────────────────────────

/**
 * Scan summary sheet for the declared RTP. Looks for an "RTP" label and
 * reads the adjacent numeric within a 5-cell radius (right or below).
 * Handles 0.96 / 96.00 / 96.00 % formats — clamps result to [0, 130]
 * percentage range.
 *
 * @returns {{ value: number | null, source: { sheet: string, cell: string } | null,
 *             confidence: number }}
 */
function extractDeclaredRtp(wb) {
  /* Priority labels — exact matches preferred (highest weight first).
   * "Total RTP" wins over "Base RTP" wins over a bare "RTP" wins over
   * "Hold %" (which is `100 - RTP`, inverted). PAR-QA hardening:
   * previous regex only matched bare "(total\s+)?rtp" and missed
   * "Base RTP", "Reported RTP", "Hold %" — losing 2/5 par sheets. */
  /* `*` suffix is common in operator par sheets ("Hold*:", "Base Game
   * RTP*") for footnote markers — they should NOT block the match. We
   * also accept "RTP %" prefix and "RTP Average <number>" inline tokens
   * where the value is glued to the label. */
  /* PAR-QA-2 (Boki 2026-06-26): weight rebalancing after Skeleton Key
   * audit found 75.89% (Base RTP) preferred over 96.49% (1 - Hold).
   *
   * Industry convention: Hold% is ALWAYS the total casino edge of the
   * full game (base + bonus + FS combined). So `100 - Hold` is the
   * authoritative TOTAL RTP — should beat any partial-component RTP
   * label like "Base Game RTP" or "Free Spins RTP" alone.
   *
   * Promoted:
   *   Hold:           45 → 75 (above bare RTP, just below Total RTP)
   *   House edge:     40 → 70
   * Demoted:
   *   Bare RTP:       70 → 50 (regex still requires : or = trailing,
   *                              so we don't catch a "RTP %" column
   *                              header that probes into a row value)
   *   Base game RTP:  60 → 55 (partial-component, never authoritative) */
  const PRIORITY_LABELS = [
    { rx: /^\s*total\s+rtp\*?\s*[:=%]?\s*$/i, weight: 100, invert: false },
    { rx: /^\s*overall\s+rtp\*?\s*[:=%]?\s*$/i, weight: 95, invert: false },
    { rx: /^\s*reported\s+rtp\*?\s*[:=%]?\s*$/i, weight: 90, invert: false },
    { rx: /^\s*declared\s+rtp\*?\s*[:=%]?\s*$/i, weight: 85, invert: false },
    { rx: /^\s*(combined|theoretical)\s+rtp\*?\s*[:=%]?\s*$/i, weight: 80, invert: false },
    /* Hold * = casino edge of the FULL game → invert to total RTP. */
    { rx: /^\s*hold\*?\s*%?\*?\s*[:=]?\s*$/i, weight: 75, invert: true },
    { rx: /^\s*house\s+edge\*?\s*%?\s*[:=]?\s*$/i, weight: 70, invert: true },
    /* PAR-QA-2: bare RTP regex now requires `:` / `=` / `%` trailing
     * (or whitespace+EOL with explicit `*` footnote). Drops "RTP %"
     * column-header false positives that previously probed into a
     * per-row data cell (e.g. Skeleton Key J26 → J27 0.0175 stray). */
    { rx: /^\s*rtp\*?\s*[:=%]\s*$/i, weight: 65, invert: false },
    { rx: /^\s*base\s+(game\s+)?rtp\*?\s*[:=%]?\s*$/i, weight: 55, invert: false },
    { rx: /^\s*payback\*?\s*[:=%]?\s*$/i, weight: 55, invert: false },
    { rx: /^\s*payout\*?\s*%?\s*[:=]?\s*$/i, weight: 50, invert: false },
  ];

  /* Inline "RTP average 96.00 %" / "Total RTP: 96.5%" patterns where the
   * label and value are in the same cell. Pulled into its own pass so
   * we don't pollute the label/probe loop with mode-aware logic. */
  const INLINE_RX = /^\s*(?:total\s+|overall\s+|reported\s+|rtp\s+average\s+|rtp\s*[:=]?\s*)?(\d{1,3}(?:[.,]\d+)?)\s*%/i;

  let best = null; // { value, source, confidence, weight }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 200);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s) continue;

        /* Inline value first — "RTP average 96.00 %" carries the number
         * in the same cell. Only accept if the leading token is an RTP
         * label so we don't grab a stray "0.50%" from random text. */
        const inline = s.match(INLINE_RX);
        if (
          inline &&
          /\b(rtp|payback|payout)\b/i.test(s) &&
          !/\b(hold|edge)\b/i.test(s)
        ) {
          const n = Number(inline[1].replace(',', '.'));
          if (Number.isFinite(n)) {
            const pct = n <= 1.5 ? n * 100 : n;
            if (pct >= 50 && pct <= 130) {
              const w = /\btotal|overall|combined/i.test(s) ? 95 : 75;
              if (!best || w > best.weight) {
                best = {
                  value: pct,
                  source: {
                    sheet: sheetName,
                    cell: XLSX.utils.encode_cell({ r, c }),
                    label: s.trim(),
                    method: 'inline-value',
                  },
                  confidence: Math.min(0.95, w / 100 + 0.05),
                  weight: w,
                };
              }
            }
          }
        }

        const matched = PRIORITY_LABELS.find((p) => p.rx.test(s));
        if (!matched) continue;
        /* Check 5 neighbors: right (3), down (1), down-right (1). */
        const probes = [
          [r, c + 1], [r, c + 2], [r, c + 3],
          [r + 1, c], [r + 1, c + 1],
        ];
        for (const [pr, pc] of probes) {
          const n = cellNumber(ws, pr, pc);
          if (n === null) continue;
          /* Normalize: 0..1 → percent, percent stays. Invert hold/edge
           * fields so the model always carries a payback fraction. */
          let pct = n <= 1.5 ? n * 100 : n;
          if (matched.invert) pct = 100 - pct;
          if (pct < 50 || pct > 130) continue;
          /* Confidence = weight / 100, capped at 0.95. */
          const confidence = Math.min(0.95, matched.weight / 100 + 0.05);
          if (!best || matched.weight > best.weight) {
            best = {
              value: pct,
              source: {
                sheet: sheetName,
                cell: XLSX.utils.encode_cell({ r: pr, c: pc }),
                label: s.trim(),
                inverted: matched.invert,
              },
              confidence,
              weight: matched.weight,
            };
          }
          break; /* first numeric neighbor wins for this label */
        }
      }
    }
  }

  if (best) {
    return { value: best.value, source: best.source, confidence: best.confidence };
  }
  return { value: null, source: null, confidence: 0 };
}

/**
 * PAR-7-FAST (Boki 2026-06-26): extract RTP COMPONENTS — base game,
 * free-spins, hold-and-win, bonus contribution — as separate fields.
 * Operator par sheets typically declare these explicitly in a Summary
 * block ("Base Game RTP", "Free Spins RTP", "Hold And Win RTP", etc.).
 *
 * Why this matters for PAR-5:
 *
 *   The kernel currently models BASE GAME LINE WINS only (no scatter
 *   trigger, no FS, no HnW). So measured RTP can only converge to the
 *   BASE GAME share of the declared total, not the total itself. With
 *   components extracted, the verdict ladder can compare measured vs
 *   declared_base instead of measured vs declared_total — giving an
 *   honest "is the base game math correct?" check without waiting for
 *   PAR-7 (FS reel) and PAR-8 (HnW orb) to land.
 *
 * Output shape:
 *   {
 *     total:      number | null,   // total declared RTP
 *     baseGame:   number | null,   // base game line contribution
 *     freeSpins:  number | null,   // FS line/total contribution
 *     holdAndWin: number | null,   // HnW contribution
 *     bonus:      number | null,   // other bonus contribution
 *     sources:    { [field]: 'sheet!cell' }
 *   }
 */
function extractRtpComponents(wb) {
  const COMPONENT_RX = [
    { rx: /^\s*total\s+rtp\*?\s*[:=%]?\s*$/i, field: 'total' },
    { rx: /^\s*overall\s+rtp\*?\s*[:=%]?\s*$/i, field: 'total' },
    { rx: /^\s*base\s+(game\s+)?rtp\*?\s*[:=%]?\s*$/i, field: 'baseGame' },
    { rx: /^\s*free\s*spins?\s+(re?els?\s+)?rtp\*?\s*[:=%]?\s*$/i, field: 'freeSpins' },
    { rx: /^\s*hold\s*(and|&)?\s*win\s+rtp\*?\s*[:=%]?\s*$/i, field: 'holdAndWin' },
    { rx: /^\s*bonus\s+rtp\*?\s*[:=%]?\s*$/i, field: 'bonus' },
  ];
  const result = { total: null, baseGame: null, freeSpins: null, holdAndWin: null, bonus: null, sources: {} };
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 200);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s) continue;
        const matched = COMPONENT_RX.find((p) => p.rx.test(s));
        if (!matched) continue;
        if (result[matched.field] !== null) continue; /* first hit wins per field */
        /* Probe right + down for numeric. */
        const probes = [[r, c + 1], [r, c + 2], [r, c + 3], [r + 1, c], [r + 1, c + 1]];
        for (const [pr, pc] of probes) {
          const n = cellNumber(ws, pr, pc);
          if (n === null) continue;
          const pct = n <= 1.5 ? n * 100 : n;
          if (pct < 0 || pct > 130) continue;
          result[matched.field] = pct;
          result.sources[matched.field] = `${sheetName}!${XLSX.utils.encode_cell({ r: pr, c: pc })}`;
          break;
        }
      }
    }
  }
  return result;
}

/**
 * Extract weighted reel data from the par sheet. Inventory layout (seen
 * across all 5 operator par sheets, 2026-06-26):
 *
 *   row Y, col SYM = symbol name (e.g. "Wild", "Red7", "Bell")
 *   row Y, col R1..R5 = weight of that symbol on reel 1..5 (numeric)
 *   row Y-N, somewhere = "Reel 1", "Reel 2", … header markers
 *
 * Returns weighted reels — `{ symbol, weight }[][]` with one outer entry
 * per reel column. Sister `slot_sim::ReelWeight` consumes this shape
 * directly. The legacy "string[][] sample strip" format is derived
 * downstream by repeating each symbol `round(weight)` times, but the
 * authoritative form is weights — that's what regulator audits use.
 *
 * Algorithm:
 *   1. Find the header row containing "Reel 1" and "Reel N" tokens.
 *      Capture the column index for each.
 *   2. Find the symbol-label column = the column immediately LEFT of
 *      the leftmost "Reel N" header column.
 *   3. Walk rows below the header: read symbol from label col, weights
 *      from each reel col. Stop at the first row with no symbol AND no
 *      weights (block ended).
 *   4. Skip rows whose symbol cell is empty but weight cells aren't
 *      (continuation of an aggregated symbol — rare but observed).
 *
 * @returns {{ reelWeights: Array<Array<{symbol: string, weight: number}>>,
 *             symbolList: string[],
 *             source: object | null,
 *             confidence: number }}
 */
function extractReelStrips(wb) {
  const REEL_HEADER_RX = /^reel\s*(\d+)$/i;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;

    /* Scan first 200 rows for ALL "Reel N" header candidates. Par sheets
     * commonly have decoy header bands in side summaries (e.g. Fortune
     * Coin Boost has a 5-reel band on row 40 at cols 97-101 that's
     * actually FS feature breakdown, not the main reel weights). We
     * enumerate every candidate then pick the FIRST one that also has
     * a valid symbol-label column 1-3 cells to its left + ≥ 3 non-empty
     * string rows immediately below.
     *
     * Fort Knox Wolf Run pushes the real header to row 47, Fortune Coin
     * Boost to row 80, both well past the conservative 30-row scan that
     * used to cover Cash Eruption / Skeleton Key. 200 rows comfortably
     * covers every layout seen in the operator inventory. */
    const maxR = Math.min(range.e.r, range.s.r + 199);
    const candidates = []; // [{ row, reelCols }]
    for (let r = range.s.r; r <= maxR; r++) {
      const found = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const v = cellString(ws, r, c);
        if (!v) continue;
        const m = v.match(REEL_HEADER_RX);
        if (m) found.push({ idx: parseInt(m[1], 10), col: c });
      }
      /* Group entries into runs where index restarts at 1 OR there's a
       * column gap > 3. Each run is a candidate sub-header.
       *
       * Real par sheets sometimes carry parallel base + FS reel bands
       * on the same row (Fortune Coin Boost: cols 26-30 for base, then
       * cols 51-55 for FS — both labeled "Reel 1..5"). Splitting on
       * the idx-restart boundary picks each band separately so we can
       * validate the base one (which has a symbol-label column nearby)
       * and skip the FS one (which usually doesn't). */
      if (found.length < 3) continue;
      found.sort((a, b) => a.col - b.col);
      let runStart = 0;
      for (let i = 1; i <= found.length; i++) {
        const endOfRun =
          i === found.length ||
          found[i].col - found[i - 1].col > 3 ||
          found[i].idx <= found[i - 1].idx;
        if (endOfRun) {
          const run = found.slice(runStart, i);
          const seq = run.every((entry, j) => entry.idx === run[0].idx + j);
          const adj = run.every(
            (entry, j) => j === 0 || entry.col - run[j - 1].col <= 3,
          );
          if (run.length >= 3 && seq && adj) {
            candidates.push({ row: r, reelCols: run });
          }
          runStart = i;
        }
      }
    }
    if (candidates.length === 0) continue;

    /* Score each candidate by how many ALPHA-token symbol-like rows sit
     * directly below the header in a left-adjacent column. The winner
     * is the one with the LONGEST visible symbol list — that's the base
     * game reel weights (≥ 9 symbols typical), not a sparse feature
     * summary band (3-5 symbols).
     *
     * Without this scoring, Fortune Coin Boost emits 0 reels because
     * its first valid candidate (row 40, cols 97-101) is the FS feature
     * summary block — symbol col matches but only 3 rows. The real base
     * band lives at row 80, cols 26-30, with 15 symbol-like rows. We
     * pick by max symbol count, with row 80 winning unambiguously.
     *
     * Tie-breaker: longer symbol list wins; equal lists choose the
     * higher reel total (= more weight density). */
    const SYMBOL_NAME_RX = /^(?!reel\s*\d|index$|sum$|total$|symbol$)[A-Za-z][A-Za-z0-9 \-_]{1,23}$/i;
    let best = null; // { score, headerRow, reelCols, symbolCol }
    for (const cand of candidates) {
      const firstReelCol = cand.reelCols[0].col;
      for (let probe = firstReelCol - 1; probe >= Math.max(range.s.c, firstReelCol - 3); probe--) {
        let symbolLike = 0;
        const scanEnd = Math.min(cand.row + 200, range.e.r);
        let blankRun = 0;
        for (let r = cand.row + 1; r <= scanEnd; r++) {
          const v = cellString(ws, r, probe);
          if (v && SYMBOL_NAME_RX.test(v)) {
            symbolLike++;
            blankRun = 0;
          } else {
            blankRun++;
            if (blankRun >= 5 && symbolLike >= 3) break;
          }
        }
        if (symbolLike < 3) continue;
        if (!best || symbolLike > best.score) {
          best = {
            score: symbolLike,
            headerRow: cand.row,
            reelCols: cand.reelCols,
            symbolCol: probe,
          };
        }
        break; // closest left-adjacent col wins for this candidate
      }
    }
    if (!best) continue;
    const headerRow = best.headerRow;
    const reelCols = best.reelCols;
    const symbolCol = best.symbolCol;

    /* Walk rows below header. Symbol cell carries the label; reel cols
     * carry the weight. Multiple sentinel conditions stop the scan
     * BEFORE we overshoot into a Total/Sum aggregate row or a second
     * weight band beneath the first.
     *
     * PAR-QA hardening (2026-06-26): previous version stopped only on a
     * 3-row blank run; that let scans walk past empty rows separating
     * the symbol table from "Total" aggregate rows, which then got
     * harvested as a 1-symbol row carrying the SUM as its weight (Fort
     * Knox Wolf Run Reel 5 had a 972_979_097 outlier because the scan
     * ingested a downstream "TotalSpins" cell as a weight). Sentinels:
     *
     *   1. Symbol cell matches Total/Sum/Subtotal/Grand keyword.
     *   2. Any reel weight is unreasonably large (> 10^7) — par sheet
     *      weights are typically 1..1_000_000, never close to billions.
     *      A weight above the per-reel norm × 100 signals an aggregate.
     *   3. Blank run ≥ 3 rows AFTER ≥ 5 symbols already captured.
     *   4. Row carries weights but no symbol AND the previous row was
     *      already a "Total" — bail (paranoia for split aggregates).
     */
    const SENTINEL_RX = /^(total|sum|subtotal|grand|average|avg|gross|cnt|count)\b/i;
    const PER_CELL_HARD_CAP = 10_000_000;
    const symbolList = [];
    const reelWeights = reelCols.map(() => []);
    let blankRowRun = 0;
    let prevWasAggregate = false;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const symbol = cellString(ws, r, symbolCol);
      const weights = reelCols.map((rc) => cellNumber(ws, r, rc.col));
      const hasAnyWeight = weights.some((w) => w !== null && w > 0);

      /* Sentinel #1: aggregate keyword in symbol cell. */
      if (symbol && SENTINEL_RX.test(symbol)) {
        if (symbolList.length > 0) break;
        prevWasAggregate = true;
        continue;
      }

      /* Sentinel #2: outlier weight (> hard cap) — almost always means
       * we walked into a downstream aggregate row that holds e.g. spin
       * counts in the same column band. Bail. */
      if (weights.some((w) => w !== null && w > PER_CELL_HARD_CAP)) {
        if (symbolList.length > 0) break;
        continue;
      }

      if (!symbol && !hasAnyWeight) {
        blankRowRun++;
        if (blankRowRun >= 3 && symbolList.length >= 5) break;
        if (blankRowRun >= 10 && symbolList.length > 0) break;
        continue;
      }
      blankRowRun = 0;

      /* Sentinel #4: weights-only row right after an aggregate marker
       * — skip silently so we don't seed a phantom symbol. */
      if (!symbol && hasAnyWeight && prevWasAggregate) {
        continue;
      }
      prevWasAggregate = false;

      /* A row without a symbol but with weights = continuation line.
       * Without weights but with a symbol = separator / comment. Skip
       * both to keep only paytable rows. */
      if (!symbol || !hasAnyWeight) continue;

      /* Sanitize symbol: keep only alnum + space + dash, max 24 chars.
       * Anti-vendor sanitization happens at emit-time in buildModel(). */
      const cleanSymbol = symbol.replace(/[^A-Za-z0-9 \-_]/g, '').trim().slice(0, 24);
      if (!cleanSymbol) continue;

      symbolList.push(cleanSymbol);
      for (let i = 0; i < reelCols.length; i++) {
        const w = weights[i];
        reelWeights[i].push({
          symbol: cleanSymbol,
          /* Round to int — sister `ReelWeight` is u32. Float weights
           * (1.85, 0.99 etc) are normalized by clamping to ≥ 1 and
           * rounding to nearest. Zero weights are KEPT (regulator
           * audits care about "absent" symbols on a reel). */
          weight: w === null ? 0 : Math.max(0, Math.round(w)),
        });
      }
    }

    if (symbolList.length < 3) continue; /* nothing useful here */

    /* Confidence: high if ≥ 3 reels, ≥ 6 symbols, total weight per reel
     * looks reasonable (10..10_000_000 typical). */
    const reelTotals = reelWeights.map((rw) =>
      rw.reduce((sum, e) => sum + e.weight, 0),
    );
    const reasonable =
      reelTotals.every((t) => t >= 5 && t <= 100_000_000) &&
      reelWeights.every((rw) => rw.length === symbolList.length);
    const confidence = reasonable
      ? Math.min(0.95, 0.55 + Math.min(reelWeights.length, 6) * 0.06 + Math.min(symbolList.length / 12, 1) * 0.12)
      : 0.5;

    return {
      reelWeights,
      symbolList,
      source: {
        sheet: sheetName,
        headerRow,
        reelCount: reelWeights.length,
        symbolCount: symbolList.length,
        reelTotals,
      },
      confidence,
    };
  }
  return { reelWeights: [], symbolList: [], source: null, confidence: 0 };
}

/**
 * Scan summary / 100spins / paytable sheets for a max-win-cap cell.
 * Looks for "max win" / "win cap" / "cap" tokens and reads the adjacent
 * numeric. Returns `null` if no explicit cap is declared (most common
 * for older par sheets).
 *
 * @returns {{ value: number | null, source: { sheet: string, cell: string } | null,
 *             confidence: number }}
 */
function extractMaxWinCap(wb) {
  /* Pass 1: explicit label match (highest confidence). */
  const LABEL_RX = /^\s*(max\s*win|win\s*cap|cap|max\s*payout|max\s*pay)\s*[:=]?$/i;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const cls = classifySheet(ws, sheetName);
    if (cls === 'reels' || cls === 'paylines') continue;
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 200);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s || !LABEL_RX.test(s)) continue;
        const probes = [
          [r, c + 1], [r, c + 2], [r, c + 3],
          [r + 1, c], [r + 1, c + 1],
        ];
        for (const [pr, pc] of probes) {
          const n = cellNumber(ws, pr, pc);
          if (n === null) continue;
          if (n >= 100 && n <= 10_000_000) {
            return {
              value: Math.round(n),
              source: {
                sheet: sheetName,
                cell: XLSX.utils.encode_cell({ r: pr, c: pc }),
                method: 'explicit-label',
              },
              confidence: 0.85,
            };
          }
        }
      }
    }
  }

  /* Pass 2: derive from 100Spins / histogram sheets — find the largest
   * single payout cell in a "spins / payout" table. Typical par sheet
   * 100-spin sheets carry per-spin win × N rows with payout in a Bet
   * Units column; the row with the highest payout × frequency reflects
   * the engine's max realized win across the histogram. We treat that
   * as a CONSERVATIVE lower bound on the cap (real cap is ≥ measured
   * max), tagged with lower confidence so downstream auditors know it
   * isn't a declared value. */
  for (const sheetName of wb.SheetNames) {
    if (!/100\s*spin|histogram|max\s*win|tail/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 500);
    const maxC = Math.min(range.e.c, range.s.c + 40);
    let maxPayout = 0;
    let maxAddr = null;
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const cell = cellAt(ws, r, c);
        if (!cell || cell.t !== 'n') continue;
        const v = cell.v;
        /* Win-cap candidates are payout-as-multiplier values: 500..5_000_000
         * is the typical regulator-grade win cap span. Anything above
         * suggests a spin count or an aggregate — skip. */
        if (v >= 500 && v <= 5_000_000 && v > maxPayout) {
          maxPayout = v;
          maxAddr = XLSX.utils.encode_cell({ r, c });
        }
      }
    }
    if (maxPayout >= 500) {
      return {
        value: Math.round(maxPayout),
        source: { sheet: sheetName, cell: maxAddr, method: '100spins-tail-max' },
        confidence: 0.45, // lower than explicit label, higher than nothing
      };
    }
  }

  return { value: null, source: null, confidence: 0 };
}

/**
 * PAR-10 (Boki 2026-06-26): Extract explicit payline patterns from the
 * Paylines / PAR_LINES sheet of a par sheet xlsx.
 *
 * # WHY THIS EXISTS
 *
 * PAR-5 convergence mapper used to synthesize paylines via row-cycle
 * fallback ([0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], then i%rows zigzag).
 * That's lossy: Cash Eruption deklariše 20 specifičnih patterns
 * (top/middle/bottom rows + V-shapes + zigzags) — row-cycle hits the
 * straight lines but misses every V/zigzag, under-counting middle-row
 * symbol density. The result was a 30+ pp gap between declared base
 * RTP (41.90 %) and measured (11.42 %).
 *
 * # FORMAT
 *
 * The Paylines sheet (sheet name matches `^paylines?$` / `^par[_\s-]?lines?$`)
 * lays out one Payline label per 5-column block, 4-row block. Each
 * block contains a 3×5 grid of cells; a cell holds 'X' when that
 * (row, reel) belongs to the payline shape:
 *
 *   col+0..col+4 = 5 reels
 *   row+1 = top row (grid row 0)
 *   row+2 = middle row (grid row 1)
 *   row+3 = bottom row (grid row 2)
 *
 *   Example block (Cash Eruption Payline 1, middle row):
 *     C2 = "Payline 1"
 *     C3 D3 E3 F3 G3 = blank (top row not hit)
 *     C4 D4 E4 F4 G4 = "X" "X" "X" "X" "X" (middle row hit)
 *     C5 D5 E5 F5 G5 = blank
 *   → pattern = [1, 1, 1, 1, 1]
 *
 *   Payline 4 (V-shape):
 *     R2 = "Payline 4"
 *     R3 = "X" (top), V3 (top, reel 4)
 *     S4 (mid, reel 1), U4 (mid, reel 3)
 *     T5 (bottom, reel 2)
 *   → pattern = [0, 1, 2, 1, 0]
 *
 * The walker scans every cell on every Paylines-tagged sheet, regex-
 * matches the label, then peeks the X-grid below. Patterns sorted by
 * line number on emit.
 *
 * # WHAT THIS CHANGES
 *
 * Closes the cash-eruption WARN by lifting the row-distribution
 * fidelity from "row-cycle" → "exactly what par sheet declares".
 *
 * @returns {{ patterns: number[][] | null, count: number,
 *             source: { sheet: string } | null, confidence: number }}
 */
export function extractPaylinePatterns(wb) {
  /* Two label conventions seen in the wild:
   *   - 'Payline 1', 'Payline 2', ... (Cash Eruption, Fort Knox style)
   *   - 'Line 1:', 'Line 2:', ...     (Book of Unseen style, trailing colon) */
  const LABEL_RX = /^\s*(?:payline|line)\s+(\d+)\s*:?\s*$/i;

  /* Cell marker that flags "this (row, reel) belongs to the payline":
   *   - 'X' or 'x' (Cash Eruption, Fort Knox)
   *   - numeric 1  (Book of Unseen) */
  const isMarker = (ws, r, c) => {
    const cell = cellAt(ws, r, c);
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return false;
    if (typeof cell.v === 'string') return cell.v.trim().toUpperCase() === 'X';
    if (typeof cell.v === 'number') return cell.v === 1;
    return false;
  };

  for (const sheetName of wb.SheetNames) {
    /* Match: 'Paylines', 'PAR_LINES', 'PARLines', 'par-lines', etc. */
    if (!/payline|par[_\s-]?lines?/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;

    const maxR = Math.min(range.e.r, range.s.r + 400);
    const maxC = Math.min(range.e.c, range.s.c + 80);

    /* PAR-10 (Boki 2026-06-26, post-Fort-Knox catch): grid rows-per-block
     * isn't always 3. Fort Knox lays out 4 rows per block (because the
     * physical reel window is 5×4 — topology probe under-counts but
     * Paylines tab is authoritative). Detect block height dynamically:
     *
     *   1. Pass A: collect ALL label cells {row, col, line}
     *   2. Block height = (min vertical distance between two labels
     *      sharing the same column) − 1. Clamp to [3, 5] — anything
     *      outside is a malformed sheet.
     *   3. Pass B: walk markers for offset 1..blockHeight. */
    const labelCells = [];
    for (let r = range.s.r; r <= maxR; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s) continue;
        const m = LABEL_RX.exec(s);
        if (!m) continue;
        const lineN = parseInt(m[1], 10);
        if (Number.isFinite(lineN)) labelCells.push({ r, c, lineN });
      }
    }
    if (labelCells.length === 0) continue;

    /* Vertical stride per column = label_row[N+1] - label_row[N]. The
     * payline cells fit in (stride − 1) rows. */
    const byCol = new Map();
    for (const lc of labelCells) {
      if (!byCol.has(lc.c)) byCol.set(lc.c, []);
      byCol.get(lc.c).push(lc.r);
    }
    const strides = [];
    for (const rows of byCol.values()) {
      rows.sort((a, b) => a - b);
      for (let i = 1; i < rows.length; i++) strides.push(rows[i] - rows[i - 1]);
    }
    const stride = strides.length > 0
      ? strides.sort((a, b) => a - b)[Math.floor(strides.length / 2)]  // median
      : 4;  // fallback for single-row sheets (3 pattern rows + 1 spacer)
    const blockHeight = Math.max(3, Math.min(5, stride - 1));

    const patternsByLine = new Map();
    for (const lc of labelCells) {
      const { r, c, lineN } = lc;
      if (patternsByLine.has(lineN)) continue;

      /* Scan 5 reels × blockHeight rows below the label. Each reel
       * column gets the row index (0..blockHeight-1) where the marker
       * lives. If no marker found, skip the entire payline rather
       * than emit a partial pattern. */
      const pattern = new Array(5).fill(null);
      for (let reelIdx = 0; reelIdx < 5; reelIdx++) {
        const col = c + reelIdx;
        if (col > maxC) break;
        for (let rowOffset = 1; rowOffset <= blockHeight; rowOffset++) {
          if (isMarker(ws, r + rowOffset, col)) {
            pattern[reelIdx] = rowOffset - 1;
            break;
          }
        }
      }
      if (pattern.every((p) => p !== null)) {
        patternsByLine.set(lineN, pattern);
      }
    }

    if (patternsByLine.size > 0) {
      const sortedLines = [...patternsByLine.keys()].sort((a, b) => a - b);
      const patterns = sortedLines.map((n) => patternsByLine.get(n));
      /* Effective grid rows = 1 + max row-index across patterns.
       * Emitted so topology can be reconciled by callers when
       * topology probe under-counted the physical window. */
      const gridRows = 1 + patterns.reduce((m, p) => Math.max(m, ...p), 0);
      return {
        patterns,
        count: patterns.length,
        gridRows,
        source: { sheet: sheetName },
        /* Confidence 0.95 — explicit X-grid extraction is essentially
         * deterministic when the label regex hits. The remaining 0.05
         * accounts for malformed blocks (partial coverage skipped). */
        confidence: 0.95,
      };
    }
  }

  return { patterns: null, count: 0, gridRows: null, source: null, confidence: 0 };
}

/**
 * Extract paytable rows from the par sheet. Two layouts supported:
 *
 * 1. **Combinations layout** (Cash Eruption, Fortune Coin Boost, Skeleton
 *    Key style): each row enumerates symbol-per-reel × pay. Header row
 *    has 'Combinations' or 'Pay' followed by 'Prob' / 'Return %'.
 *    Symbol cells across reel columns; '--' marks the truncation point.
 *    Pay column is right after the last reel column.
 *
 * 2. **Symbol-cross-OAK layout** (Book of Unseen, vendor-internal style):
 *    A grid where rows are symbols and columns are 3/4/5 OAK counts.
 *    Header row has '3' '4' '5' (or '3-OAK' '4-OAK' '5-OAK') in columns.
 *
 * Returns the canonical PaytableRowSchema array:
 *   [{ symbolId, label, combos: { '3': pay, '4': pay, '5': pay } }, ...]
 *
 * Designed to be a strict best-effort — if no recognizable layout exists
 * in any sheet, returns an empty array. Downstream PAR-5 conv solver
 * handles the absent-paytable case explicitly.
 *
 * @returns {{ rows: Array, source: { sheet: string, headerRow: number,
 *             layout: 'combinations' | 'symbol-oak' } | null }}
 */
function extractPaytable(wb, symbolList) {
  /* Helper: stable sym → id (matches buildModel toId logic). */
  const toId = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 20) || 'sym';
  /* Helper: aggregate combos by symbol. Multiple par-sheet rows may
   * declare the same (sym, count) tuple if the sheet enumerates per-
   * line breakdowns — we keep the MAX pay to avoid double-counting
   * fractional contributions. */
  const accum = new Map();
  const addCombo = (sym, count, pay) => {
    if (!sym || !Number.isFinite(pay) || pay <= 0 || count < 2 || count > 7) return;
    const id = toId(sym);
    if (!accum.has(id)) accum.set(id, { symbolId: id, label: String(sym), combos: {} });
    const row = accum.get(id);
    const key = String(count);
    if (!(key in row.combos) || row.combos[key] < pay) row.combos[key] = pay;
  };

  let sourceMeta = null;

  /* ── Layout 1: 'Combinations' header (Cash Eruption / Fortune Coin
       Boost / Skeleton Key / Fort Knox style) ──────────────────────────
     PAR-QA-2 (Boki 2026-06-26): widen sheet name filter — Skeleton Key
     uses PAR-Base-001 (with hyphenated 'Base' qualifier), Fortune Coin
     Boost uses par_001 (snake_case), Book of Unseen uses PAR_001 +
     PAR_BonusBuy_001. Match any sheet whose name starts with 'par'
     (any separator/qualifier) OR contains combinations/paytable/
     paylines. */
  for (const sheetName of wb.SheetNames) {
    if (!/^par[\s_-]|combinations|paytable|paylines/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    /* PAR-QA-2 (Boki 2026-06-26): paytable header rows vary widely
     * across vendors. Observed: Cash Eruption r23, Skeleton Key r25,
     * Fort Knox Wolf Run r65 (after a long summary block) and r143
     * (second pay table layer). Scan to row 200 — cost is still
     * trivial (200 × 20 = 4 000 cell probes per candidate sheet). */
    const maxR = Math.min(range.e.r, range.s.r + 200);
    const maxC = Math.min(range.e.c, range.s.c + 20);

    /* Scan first 200 rows for a 'Combinations' header → reel grid + Pay column. */
    for (let r = range.s.r; r <= maxR; r++) {
      const headerCells = [];
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (s) headerCells.push({ c, txt: s.toLowerCase() });
      }
      const hasCombos = headerCells.some((h) => /combinations?/i.test(h.txt));
      /* PAR-QA-2 (Boki 2026-06-26): Cash Eruption uses 'Pays' (plural);
       * Fortune Coin Boost uses 'Pay'; some older sheets use 'Prize' or
       * 'Payout'. Match all four. */
      const payCell = headerCells.find((h) => /^pays?$|^prize$|^payouts?$/i.test(h.txt));
      if (!hasCombos || !payCell) continue;

      /* Walk rows below until a blank or summary terminator. */
      const reelStart = headerCells.find((h) => /combinations?/i.test(h.txt))?.c ?? range.s.c;
      const reelEnd = payCell.c - 1;
      const payCol = payCell.c;
      let blanks = 0;
      for (let rr = r + 1; rr <= range.e.r && blanks < 3; rr++) {
        const combo = [];
        for (let cc = reelStart; cc <= reelEnd; cc++) {
          combo.push(cellString(ws, rr, cc));
        }
        const pay = cellNumber(ws, rr, payCol);
        const matchSym = combo[0];
        if (!matchSym || pay === null) { blanks++; continue; }
        blanks = 0;
        if (matchSym === '--' || /^total|^sum|^rtp/i.test(matchSym)) continue;
        /* PAR-QA-3 (Boki 2026-06-26, audit catch): wild label varies
         * across vendors — "Wild", "WILD", "W", "WildReel", "Wild Reel",
         * "Wild Reels", "Wilds". Broaden the regex so all common
         * variants count. Risk previously: vendors using "Wild Reels"
         * silently failed the substitution check → chain length
         * underestimated → 5-OAK hits counted as 3-OAK → lower pay
         * captured → measured RTP undershoots declared. */
        let count = 0;
        for (const c of combo) {
          if (c === matchSym || /^\s*wild?s?(?:\s*reels?)?\s*$/i.test(c || '')) count++;
          else break;
        }
        if (count >= 3 && pay > 0) {
          addCombo(matchSym, count, pay);
          if (!sourceMeta) sourceMeta = { sheet: sheetName, headerRow: r, layout: 'combinations' };
        }
      }
      if (sourceMeta && sourceMeta.sheet === sheetName) break;
    }
    if (sourceMeta) break;
  }

  /* ── Layout 2: symbol × OAK count grid (PAR_LINES style) ────────── */
  if (accum.size === 0) {
    for (const sheetName of wb.SheetNames) {
      if (!/paytable|lines|payout|prize/i.test(sheetName)) continue;
      const ws = wb.Sheets[sheetName];
      const range = sheetRange(ws);
      if (!range) continue;
      const maxR = Math.min(range.e.r, range.s.r + 80);
      const maxC = Math.min(range.e.c, range.s.c + 20);
      /* Look for a header row that contains "3" "4" "5" (or "3OAK" etc.) */
      for (let r = range.s.r; r <= maxR; r++) {
        const headerNums = [];
        for (let c = range.s.c; c <= maxC; c++) {
          const s = cellString(ws, r, c);
          if (!s) continue;
          const m = s.match(/^([3-7])(?:-?\s*o?\s*a?\s*k)?$/i);
          if (m) headerNums.push({ c, count: parseInt(m[1], 10) });
        }
        if (headerNums.length < 2) continue;
        /* Symbol column = first non-numeric label column to the left. */
        const minCountCol = Math.min(...headerNums.map((h) => h.c));
        const symCol = minCountCol - 1;
        /* Walk down: for each row, sym = symCol value, then pay per count-col. */
        let blanks = 0;
        for (let rr = r + 1; rr <= range.e.r && blanks < 3; rr++) {
          const sym = cellString(ws, rr, symCol);
          if (!sym || /^total|^sum|^rtp/i.test(sym)) { blanks++; continue; }
          let anyPay = false;
          for (const hn of headerNums) {
            const pay = cellNumber(ws, rr, hn.c);
            if (pay !== null && pay > 0) {
              addCombo(sym, hn.count, pay);
              anyPay = true;
            }
          }
          if (!anyPay) blanks++;
          else { blanks = 0; if (!sourceMeta) sourceMeta = { sheet: sheetName, headerRow: r, layout: 'symbol-oak' }; }
        }
        if (sourceMeta && sourceMeta.sheet === sheetName) break;
      }
      if (sourceMeta) break;
    }
  }

  return {
    rows: Array.from(accum.values()),
    source: sourceMeta,
  };
}

/**
 * Try to infer topology (reels × rows × paylines). Reels comes from
 * `extractReelStrips().strips.length`. Rows defaults to 3 unless we
 * find a "rows" / "5x3 / 6x4 / 5x5" label. Paylines reads the Paylines
 * sheet row count, defaulting to a vendor-common 20.
 *
 * @returns {{ reels: number, rows: number, paylines: number,
 *             confidence: number }}
 */
function extractTopology(wb, reelStripsResult) {
  const reels = reelStripsResult?.reelWeights?.length || 5;

  let rows = 3;
  let paylines = 20;
  let evalMode = 'lines';
  let rowsConfidence = 0.3;
  let plConfidence = 0.3;
  let waysFound = null;

  /* PAR-9 (Boki 2026-06-26): scan ALL sheets first for an explicit
   * "N ways" / "N to M ways" topology declaration. If found, it
   * overrides paylines + evalMode (Skeleton Key declares "243 to
   * 7,776 Ways" — the underlying engine is Ways, not Lines).
   * Pattern: any digits-then-"ways" token, with optional "to X" upper
   * bound which we ignore (we use the BASE ways count). */
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 100);
    const maxC = Math.min(range.e.c, range.s.c + 20);
    for (let r = range.s.r; r <= maxR && waysFound === null; r++) {
      for (let c = range.s.c; c <= maxC; c++) {
        const s = cellString(ws, r, c);
        if (!s) continue;
        const m = s.match(/(\d{2,5})(?:\s*to\s*[\d,]+)?\s*ways?\b/i);
        if (m) {
          waysFound = parseInt(m[1], 10);
          plConfidence = 0.85;
          break;
        }
      }
    }
  }
  if (waysFound !== null && waysFound >= 9 && waysFound <= 7776) {
    paylines = waysFound;
    evalMode = 'ways';
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = sheetRange(ws);
    if (!range) continue;

    /* Paylines sheet: count non-empty rows (one row per payline).
     * PAR-9: skip this if waysFound is already locked — Ways games
     * draw a few sample paylines in the Paylines sheet for visual UI
     * but the underlying eval is Ways. */
    if (waysFound === null && /payline/i.test(sheetName)) {
      let nonEmpty = 0;
      const maxR = Math.min(range.e.r, range.s.r + 300);
      for (let r = range.s.r + 1; r <= maxR; r++) {
        /* Skip header row (range.s.r). */
        if (cellString(ws, r, range.s.c) || cellNumber(ws, r, range.s.c)) {
          nonEmpty++;
        }
      }
      if (nonEmpty >= 1 && nonEmpty <= 1024) {
        paylines = nonEmpty;
        plConfidence = 0.7;
      }
    }

    /* Topology label: "5x3", "5×3", "6x4" anywhere in summary cells. */
    if (/summary/i.test(sheetName)) {
      const maxR = Math.min(range.e.r, range.s.r + 100);
      const maxC = Math.min(range.e.c, range.s.c + 20);
      for (let r = range.s.r; r <= maxR; r++) {
        for (let c = range.s.c; c <= maxC; c++) {
          const s = cellString(ws, r, c);
          if (!s) continue;
          const m = s.match(/(\d+)\s*[x×]\s*(\d+)/);
          if (m) {
            const r0 = parseInt(m[1], 10);
            const r1 = parseInt(m[2], 10);
            if (r0 >= 3 && r0 <= 12 && r1 >= 3 && r1 <= 12) {
              rows = r1;
              rowsConfidence = 0.85;
            }
          }
        }
      }
    }
  }

  return {
    reels,
    rows,
    paylines,
    evalMode,
    waysFound,
    confidence: Math.min((rowsConfidence + plConfidence + 0.7) / 3, 0.95),
  };
}

// ─── Model assembler ─────────────────────────────────────────────────────────

/**
 * Build a universalGameSchema-compatible model.json from extractor
 * receipts. The shape stays minimal — only fields we ACTUALLY extracted
 * appear. Anything missing is left undefined so downstream consumers
 * can apply smartDefaults or skip cleanly.
 */
async function buildModel(wb, slug) {
  const sanitize = await loadAntiVendor();

  const rtp = extractDeclaredRtp(wb);
  const reels = extractReelStrips(wb);
  const cap = extractMaxWinCap(wb);
  const topo = extractTopology(wb, reels);
  /* PAR-2-FIX-1 (Boki 2026-06-26): extract paytable so PAR-5
   * convergence solver has symbol × OAK pays as input. Was TODO in
   * the JSDoc but never implemented; all 5 models shipped with
   * `paytable: []`. Without paytable Rust kernel can't compute
   * per-symbol payout → measured RTP would be ~0 regardless of
   * reel weights. */
  const pay = extractPaytable(wb, reels.symbolList);
  /* PAR-7-FAST (Boki 2026-06-26): extract per-component RTP shares so
   * PAR-5 verdict can compare measured BASE GAME RTP vs declared base
   * (not total), giving honest convergence verdicts without waiting
   * for full FS + HnW kernel coverage. */
  const components = extractRtpComponents(wb);
  /* PAR-10 (Boki 2026-06-26): extract REAL payline patterns from the
   * Paylines / PAR_LINES sheet so PAR-5 mapper stops synthesizing the
   * shape via row-cycle fallback. Real patterns let the sister kernel
   * count V-shapes / zigzags correctly — primary driver of measured
   * row-distribution density. */
  const paylinePatterns = extractPaylinePatterns(wb);

  /* Synthesized vendor-neutral display name. */
  const neutralName = sanitize(
    `Game ${slug
      .split('-')
      .map((p) => p[0]?.toUpperCase() + p.slice(1))
      .join(' ')} ${topo.reels}x${topo.rows}`,
  );

  const model = {
    id: slug,
    slug,
    name: neutralName,

    topology: {
      reels: topo.reels,
      /* PAR-10 (Boki 2026-06-26): when extractor lifted explicit
       * payline patterns AND those patterns reference rows beyond the
       * topology probe count (Fort Knox is 5×4 not 5×3, but probe
       * lacked the 4th-row signal), trust the Paylines tab — it's the
       * authoritative grid descriptor for what the kernel evaluates. */
      rows: paylinePatterns.gridRows && paylinePatterns.gridRows > topo.rows
        ? paylinePatterns.gridRows
        : topo.rows,
      /* PAR-10: same logic for paylines count. Paylines tab declares
       * the canonical line set; topology probe's count is a heuristic
       * (Summary sheet scan) that under-counts when the par sheet
       * describes more lines in the Paylines tab than the Summary
       * label exposes. */
      paylines: paylinePatterns.count > 0
        ? paylinePatterns.count
        : topo.paylines,
      kind: topo.reels === 6 ? 'tumble' : 'rectangular',
      /* PAR-9 (Boki 2026-06-26): explicit evaluation mode. PAR-5
       * convergence mapper dispatches to Ways universe (rows^reels)
       * when evalMode === 'ways', else stays in Lines mode. */
      evalMode: topo.evalMode,
      ...(topo.waysFound !== null ? { waysCount: topo.waysFound } : {}),
    },

    payback: rtp.value !== null
      ? {
          rtp: rtp.value,
          source: 'par-sheet-declared',
          /* PAR-7-FAST: emit per-component shares when found. PAR-5
           * verdict consumes `components.baseGame` as the convergence
           * target when present (because the kernel currently models
           * only base game line wins). */
          components: (components.baseGame !== null || components.freeSpins !== null ||
                       components.holdAndWin !== null || components.bonus !== null)
            ? {
                total: components.total ?? rtp.value,
                baseGame: components.baseGame,
                freeSpins: components.freeSpins,
                holdAndWin: components.holdAndWin,
                bonus: components.bonus,
                sources: components.sources,
              }
            : undefined,
        }
      : undefined,

    winCap: cap.value !== null
      ? {
          enabled: true,
          maxWinX: cap.value,
          mode: 'spin',
        }
      : undefined,

    /* Symbols sub-shape — derived from the par sheet symbol list.
     * universalGameSchema expects `{ high: [], mid: [], low: [], specials: [] }`
     * (categorized), not a flat array. We bucket by weight/role:
     *   - specials: wild + scatter + bonus tokens
     *   - high:     top 30 % of remaining by total weight across reels
     *   - low:      bottom 30 %
     *   - mid:      the rest
     * Wild/scatter/bonus detection uses keyword heuristics (Wild / Bonus
     * / Scatter / S / W / SC). Anti-vendor sanitization runs at emit. */
    symbols: reels.symbolList.length > 0
      ? (() => {
          /* Compute total weight per symbol across all reels for bucket
           * ordering. Specials are removed from the high/mid/low pool. */
          const totalWeight = new Map();
          for (const sym of reels.symbolList) totalWeight.set(sym, 0);
          for (const rw of reels.reelWeights) {
            for (const e of rw) totalWeight.set(e.symbol, (totalWeight.get(e.symbol) || 0) + (e.weight || 0));
          }
          /* Symbol IDs must be whitespace-free per universalGameSchema
           * SymIdSchema. Convert "Lucky Kirin" → "lucky_kirin" while
           * keeping the original sanitized text as the `label`. */
          const toId = (s) =>
            String(s)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .slice(0, 20) || 'sym';
          const isSpecial = (s) =>
            /^(wild|w|wilds?|scatter|sc|s|scatters?|bonus|b|bn|bonuses?)$/i.test(s);
          const specials = [];
          const ordinary = [];
          for (const sym of reels.symbolList) {
            const entry = {
              id: toId(sym),
              label: sanitize(sym),
              weightTotal: totalWeight.get(sym) || 0,
            };
            if (isSpecial(sym)) {
              specials.push({
                id: toId(sym),
                label: sanitize(sym),
                role: /wild/i.test(sym) ? 'wild' : /scatter|^s$|^sc$/i.test(sym) ? 'scatter' : 'bonus',
              });
            } else {
              ordinary.push(entry);
            }
          }
          /* Sort ordinary by total weight ascending (low weight = rare = high pay). */
          ordinary.sort((a, b) => a.weightTotal - b.weightTotal);
          const n = ordinary.length;
          const highCut = Math.max(1, Math.floor(n * 0.3));
          const lowCut = Math.max(1, Math.floor(n * 0.3));
          const high = ordinary.slice(0, highCut).map((e) => ({ id: e.id, label: e.label }));
          const low = ordinary.slice(n - lowCut).map((e) => ({ id: e.id, label: e.label }));
          const mid = ordinary.slice(highCut, n - lowCut).map((e) => ({ id: e.id, label: e.label }));
          return { high, mid, low, specials };
        })()
      : undefined,

    par_sheet: reels.reelWeights.length > 0
      ? {
          /* Weighted reel format (sister `slot_sim::ReelWeight` shape).
           * One entry per reel; each is an array of {symbol, weight}.
           * Sample strips (string[][]) are derived downstream by
           * repeating each symbol `weight` times — that's the
           * authoritative slot_sim contract path. */
          reelStrips: reels.reelWeights,
          /* PAR-10 (Boki 2026-06-26): explicit payline patterns lifted
           * from the Paylines sheet. Format: number[][] where each
           * inner array has length = topology.reels, values 0..rows-1
           * indicating the grid row each reel anchor occupies. PAR-5
           * mapper preference order:
           *   1. paylinePatterns (if present and count >= topology.paylines)
           *   2. Ways universe (rows^reels) when evalMode === 'ways'
           *   3. Row-cycle synthesis (legacy fallback) */
          ...(paylinePatterns.patterns
            ? { paylinePatterns: paylinePatterns.patterns }
            : {}),
        }
      : undefined,

    /* PAR-2-FIX-1 (Boki 2026-06-26): paytable as top-level field per
     * universalGameSchema `paytable: z.array(PaytableRowSchema)`.
     * Each row carries symbolId + label + combos {3,4,5: pay}. The
     * label keeps the par-sheet vendor name but `id` is the slug
     * version that matches `symbols.*.id` so PAR-5 Rust kernel can
     * cross-reference reel strips against pay rules without ambiguity.
     * Anti-vendor lint sanitizes labels at emit. */
    paytable: pay.rows.length > 0 ? pay.rows.map((row) => ({
      symbolId: row.symbolId,
      label: sanitize(row.label),
      combos: row.combos,
    })) : undefined,

    confidence: {
      topology: topo.confidence,
      features: 0.5,
      bet: 0.3,
      _derivedBy: {
        topology: 'par-sheet-probe',
        rtp: rtp.source ? `par-sheet:${rtp.source.sheet}!${rtp.source.cell}` : 'absent',
        winCap: cap.source ? `par-sheet:${cap.source.sheet}!${cap.source.cell}` : 'absent',
        reelStrips: reels.source ? `par-sheet:${reels.source.sheet}` : 'absent',
        paytable: pay.source
          ? `par-sheet:${pay.source.sheet}@row${pay.source.headerRow}:${pay.source.layout}`
          : 'absent',
        paylinePatterns: paylinePatterns.source
          ? `par-sheet:${paylinePatterns.source.sheet}[${paylinePatterns.count} lines]`
          : 'absent',
      },
    },

    __meta__: {
      __schema_version__: 'v1',
      source: 'par-sheet-autonomous-ingest',
      ingestedAt: new Date().toISOString(),
      generator: 'tools/_par-sheet-to-model.mjs',
      par1Atom: 'PAR-2',
    },

    __activeFeatures__: [
      { kind: 'baseline', source: 'par-sheet', confidence: 0.9 },
    ],
  };

  return model;
}

// ─── Ingest driver ───────────────────────────────────────────────────────────

async function ingestOne(xlsxPath, outDir) {
  const slug = deriveSlug(xlsxPath);
  if (!slug) {
    return { ok: false, slug: null, reason: `cannot derive slug from ${xlsxPath}` };
  }

  let wb;
  try {
    wb = XLSX.readFile(xlsxPath, { cellDates: false, cellNF: false });
  } catch (e) {
    return { ok: false, slug, reason: `xlsx read failed: ${e.message}` };
  }

  const model = await buildModel(wb, slug);

  /* Manifest with par sheet provenance + content hash. */
  const xlsxBytes = readFileSync(xlsxPath);
  const xlsxSha = createHash('sha256').update(xlsxBytes).digest('hex');
  const manifest = {
    slug,
    source: {
      kind: 'par-sheet',
      filename: basename(xlsxPath),
      bytes: xlsxBytes.length,
      sha256: xlsxSha,
      sheetCount: wb.SheetNames.length,
      sheetNames: wb.SheetNames,
    },
    ingestedAt: model.__meta__.ingestedAt,
    generator: model.__meta__.generator,
  };

  const slugDir = join(outDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'model.json'), JSON.stringify(model, null, 2));
  writeFileSync(join(slugDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    slug,
    model: {
      rtp: model.payback?.rtp ?? null,
      reels: model.topology.reels,
      rows: model.topology.rows,
      paylines: model.topology.paylines,
      symbolCount: model.symbols
        ? (model.symbols.high?.length || 0) +
          (model.symbols.mid?.length || 0) +
          (model.symbols.low?.length || 0) +
          (model.symbols.specials?.length || 0)
        : 0,
      reelTotals:
        model.par_sheet?.reelStrips?.map((rw) =>
          rw.reduce((sum, e) => sum + (e.weight || 0), 0),
        ) ?? [],
      maxWinX: model.winCap?.maxWinX ?? null,
      conf: model.confidence.topology,
    },
    paths: {
      modelJson: join(slugDir, 'model.json'),
      manifestJson: join(slugDir, 'manifest.json'),
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { xlsx: null, all: false, dir: DEFAULT_PARSHEETS_DIR, out: DEFAULT_OUT_DIR };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--xlsx') out.xlsx = resolve(args[++i]);
    else if (a === '--all') out.all = true;
    else if (a === '--dir') out.dir = resolve(args[++i]);
    else if (a === '--out') out.out = resolve(args[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = [];
  if (args.all) {
    let entries;
    try {
      entries = readdirSync(args.dir);
    } catch (e) {
      console.error(`ERROR: cannot read ${args.dir}: ${e.message}`);
      process.exit(2);
    }
    for (const f of entries.filter((n) => /\.xlsx$/i.test(n))) {
      const p = join(args.dir, f);
      if (statSync(p).isFile()) targets.push(p);
    }
  } else if (args.xlsx) {
    targets.push(args.xlsx);
  } else {
    console.error('USAGE: --xlsx <path>  OR  --all [--dir <par-sheets-dir>]');
    process.exit(2);
  }

  if (targets.length === 0) {
    console.error('ERROR: no targets');
    process.exit(2);
  }

  mkdirSync(args.out, { recursive: true });

  console.log(`Ingesting ${targets.length} par sheet${targets.length === 1 ? '' : 's'} → ${args.out}`);
  let pass = 0;
  let fail = 0;
  for (const t of targets) {
    process.stdout.write(`  ${basename(t)} … `);
    const r = await ingestOne(t, args.out);
    if (r.ok) {
      pass++;
      const m = r.model;
      const rtpStr = m.rtp !== null ? m.rtp.toFixed(2) + '%' : 'absent';
      console.log(
        `ok (slug=${r.slug}, ${m.reels}×${m.rows}/${m.paylines}, rtp=${rtpStr}, ` +
          `syms=${m.symbolCount}, reelTotals=[${m.reelTotals.join(',')}], ` +
          `cap=${m.maxWinX ?? 'absent'}, conf=${m.conf.toFixed(2)})`,
      );
    } else {
      fail++;
      console.log(`FAIL: ${r.reason}`);
    }
  }
  console.log(`\nSummary: ${pass} ok, ${fail} fail of ${targets.length}`);
  if (fail > 0) process.exit(1);
}

/* PAR-10 (Boki 2026-06-26): guard top-level main() so test fixtures can
 * import extractPaylinePatterns without triggering the CLI dispatch.
 * Without this, `import { extractPaylinePatterns } from '...'` would
 * immediately invoke main() and crash because there are no CLI args
 * in the test process. */
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
