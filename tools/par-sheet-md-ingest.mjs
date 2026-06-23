#!/usr/bin/env node
/**
 * tools/par-sheet-md-ingest.mjs
 *
 * UQ-DEEP-L (Boki 2026-06-23) — Markdown PAR sheet adapter.
 *
 * Purpose
 * -------
 * Vendor-neutral regulator-grade PAR sheets ship kao structured Markdown
 * sa numbered tabs (Cover / RTP_Summary / Paytable_Line / Reel_Strip_
 * Composition / Hit_Frequency / etc.). XLSX i CSV adapteri pokrivaju
 * formate koje vendori distribuiraju, ali in-house math team obično
 * piše PAR u MD jer je verzionable + diffable + regulator-readable.
 *
 * Parses:
 *   • "Target RTP" / "RTP" Cover field
 *   • "Volatility" sa label (HIGH/MED/LOW/ULTRA) + σ
 *   • Paytable_Line tab: symbol × {3-OAK, 4-OAK, 5-OAK} multipliers
 *   • Reel_Strip_Composition tab: symbol × R1..R5 weights
 *   • Free Spins reel strip (if present)
 *
 * Output: ParBlob schema-compatible JSON na stdout.
 *
 * Usage
 *   node tools/par-sheet-md-ingest.mjs --xlsx <path-to-md> [--out -]
 *
 * (Flag --xlsx je za uniformnost sa Python adapterima koji koriste
 * isti CLI shape; primamo bilo koji path argument.)
 *
 * Exit codes:
 *   0 — success, ParBlob on stdout
 *   1 — file not found / unreadable
 *   2 — no parseable PAR sections found (not a structured PAR MD)
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const opts = { path: null, out: '-', sheet: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--xlsx' || a === '--md' || a === '--file') opts.path = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--sheet') opts.sheet = argv[++i];
    else if (!a.startsWith('--') && !opts.path) opts.path = a;
  }
  return opts;
}

function die(code, msg) {
  process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(code);
}

/* Extract first match of regex; returns null if no match. */
function firstMatch(text, rx) {
  const m = text.match(rx);
  return m ? m[1] : null;
}

/* Parse a markdown pipe table starting at the given line. Returns
 * { header: [string], rows: [[string]] }. Stops at blank line or
 * non-pipe line. */
function parsePipeTable(lines, startIdx) {
  const splitRow = (line) =>
    line.split('|').slice(1, -1).map((c) => c.trim());
  if (startIdx >= lines.length) return null;
  const header = splitRow(lines[startIdx]);
  if (header.length === 0) return null;
  /* Next line should be separator (|---|---|---). */
  if (startIdx + 1 >= lines.length || !/^\|[\s:|-]+\|$/.test(lines[startIdx + 1].trim())) {
    return null;
  }
  const rows = [];
  for (let i = startIdx + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|') || !l.endsWith('|')) break;
    rows.push(splitRow(l));
  }
  return { header, rows };
}

/* Find the table that follows a section heading matching the regex. */
function findTableUnder(text, headingRx) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (headingRx.test(lines[i])) {
      /* Skip lines until first pipe-row. */
      for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
        if (lines[j].trim().startsWith('|')) {
          return parsePipeTable(lines, j);
        }
      }
    }
  }
  return null;
}

/* Strip markdown emphasis + backticks; return cleaned text. */
function clean(s) {
  return String(s || '').replace(/[`*_]/g, '').trim();
}

function num(s) {
  if (s == null) return null;
  const cleaned = clean(s).replace(/,/g, '');
  const f = parseFloat(cleaned);
  return Number.isFinite(f) ? f : null;
}

function ingestMd(text) {
  /* Cover RTP — "Target RTP | **96.0000%**" or "RTP: 96%" */
  const declaredRtpStr = firstMatch(text, /(?:Target\s*RTP|RTP)[^\n|]*[|:]\s*\*{0,2}([0-9.]+)\s*%/i);
  const declaredRtp = declaredRtpStr ? parseFloat(declaredRtpStr) : null;

  /* Volatility — "Volatility classification | **HIGH**" or "σ = 4.5" */
  const volatilityLabel = firstMatch(text, /Volatility[^\n|]*[|:]\s*\*{0,2}(LOW|MED(?:IUM)?|HIGH|ULTRA|EXTREME)\b/i);
  const volatilitySigma = (() => {
    const v = firstMatch(text, /σ\s*=\s*([0-9.]+)/);
    return v ? parseFloat(v) : null;
  })();

  /* Geometry — "5 reels × 3 rows" */
  const geomMatch = text.match(/(\d+)\s*reels?\s*[×x]\s*(\d+)\s*rows?/i);
  const reels = geomMatch ? parseInt(geomMatch[1], 10) : null;
  const rows  = geomMatch ? parseInt(geomMatch[2], 10) : null;

  /* Paytable table — search by Tab name "Paytable" or "Pay table". */
  const paytableTable = findTableUnder(text, /^#{1,3}\s*(?:Tab\s*\d+\s*[—-]\s*)?Paytable/i);
  const paytable = [];
  if (paytableTable) {
    /* Expected header: Symbol | 3-OAK | 4-OAK | 5-OAK | ... */
    const symIdx = paytableTable.header.findIndex((h) => /symbol/i.test(h));
    const payCols = {};
    paytableTable.header.forEach((h, idx) => {
      const m = h.match(/(\d+)\s*-?\s*OAK/i);
      if (m) payCols[parseInt(m[1], 10)] = idx;
    });
    if (symIdx >= 0 && Object.keys(payCols).length > 0) {
      for (const row of paytableTable.rows) {
        const sym = clean(row[symIdx]);
        if (!sym) continue;
        const combos = {};
        for (const [cnt, col] of Object.entries(payCols)) {
          const v = num(row[col]);
          if (v != null && v > 0) combos[cnt] = v;
        }
        if (Object.keys(combos).length > 0) {
          paytable.push({ symbolId: sym, combos });
        }
      }
    }
  }

  /* Reel composition table — search by Tab name "Reel" or "Reel_Strip". */
  const reelTable = findTableUnder(text, /^#{1,3}\s*(?:Tab\s*\d+\s*[—-]\s*)?Reel[\s_-]?Strip|^#{1,3}\s*(?:Tab\s*\d+\s*[—-]\s*)?Reel\s*Composition|^#{2,4}\s*Base\s*game\s*reels?/i);
  const perReelWeights = {};
  let reelCount = 0;
  if (reelTable) {
    const symIdx = reelTable.header.findIndex((h) => /symbol/i.test(h));
    /* Reel columns are typically "R1", "R2", ... "Reel 1", etc. */
    const reelCols = reelTable.header
      .map((h, idx) => ({ h, idx }))
      .filter(({ h }) => /^R\s*\d+$|^Reel\s*\d+$|^Rodillo\s*\d+$|^Strip\s*\d+$/i.test(clean(h)));
    reelCount = reelCols.length;
    if (symIdx >= 0 && reelCount > 0) {
      reelCols.forEach((rc, rIdx) => { perReelWeights[String(rIdx)] = {}; });
      for (const row of reelTable.rows) {
        const sym = clean(row[symIdx]);
        if (!sym || /total|σ|\bsum\b/i.test(sym)) continue;
        reelCols.forEach((rc, rIdx) => {
          const w = num(row[rc.idx]);
          if (w != null && w > 0) {
            perReelWeights[String(rIdx)][sym] = Math.max(0, Math.round(w));
          }
        });
      }
    }
  }

  /* Collect symbols set. */
  const symbolSet = new Set();
  for (const m of Object.values(perReelWeights)) for (const s of Object.keys(m)) symbolSet.add(s);

  /* Per-reel sum. */
  const perReelSum = [];
  for (let i = 0; i < reelCount; i++) {
    let s = 0;
    for (const w of Object.values(perReelWeights[String(i)] || {})) s += w;
    perReelSum.push(s);
  }
  const sumWeight = perReelSum.reduce((a, b) => a + b, 0);

  return {
    vendor: 'generic',
    format: 'md',
    adapter: 'par-sheet-md-ingest',
    declared: {
      rtp: declaredRtp,
      volatility: volatilityLabel ? clean(volatilityLabel).toUpperCase() : null,
      volatilitySigma,
      reels, rows,
    },
    per_reel_weights: perReelWeights,
    paytable,
    totals: {
      reels: reelCount,
      symbols: symbolSet.size,
      sumWeight,
      perReelSum,
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.path) die(1, 'no input path provided');
  const absPath = resolve(opts.path);
  if (!existsSync(absPath)) die(1, `file not found: ${absPath}`);

  let text;
  try { text = readFileSync(absPath, 'utf8'); }
  catch (e) { die(1, `read failed: ${e.message}`); }

  const result = ingestMd(text);

  /* Reject empty parse — caller should know if MD wasn't a real PAR. */
  if (result.paytable.length === 0 && Object.keys(result.per_reel_weights).length === 0) {
    die(2, 'no parseable PAR sections found (need Paytable or Reel_Strip_Composition table)');
  }

  const out = JSON.stringify(result, null, 2);
  if (opts.out === '-' || !opts.out) {
    process.stdout.write(out + '\n');
  } else {
    writeFileSync(opts.out, out);
  }
}

main();
