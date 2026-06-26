#!/usr/bin/env node
/**
 * tests/tools/par-12c-fs-reels.test.mjs
 *
 * PAR-12-C (Boki 2026-06-27) contract test — FS reel strip extractor.
 *
 * # COVERAGE
 *
 *   - Stop-based layout (Skeleton Key style): "Reel 1" / "Symbol"-
 *     "Weight" sub-header / one stop per row, stride 2 between reels
 *   - Adjacent layout (base-style): "Reel 1" / "Reel 2" in compact
 *     adjacent cols, symbol col immediately LEFT of first reel
 *   - Total / Sum row terminates extraction
 *   - Empty-streak terminates extraction (sparse rows)
 *   - Aggregation: multiple stops with same symbol sum weights
 *   - Reject when any reel ends empty
 *   - Non-bonus sheet names skipped
 *   - Non-sequential reel numbering rejected
 */

import { extractFsReelStrips } from '../../tools/_par-sheet-to-model.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-12-C FS Reel Strip extractor · test suite');

function makeSheet(cells) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  const ws = {};
  for (const [addr, val] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) throw new Error(`bad cell addr ${addr}`);
    const cn = m[1].split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const rn = parseInt(m[2], 10) - 1;
    minR = Math.min(minR, rn); maxR = Math.max(maxR, rn);
    minC = Math.min(minC, cn); maxC = Math.max(maxC, cn);
    ws[addr] = { v: val, t: typeof val === 'number' ? 'n' : 's' };
  }
  if (maxR < 0) { ws['!ref'] = 'A1:A1'; return ws; }
  const colA = (n) => {
    let s = ''; n += 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  ws['!ref'] = `${colA(minC)}${minR + 1}:${colA(maxC)}${maxR + 1}`;
  return ws;
}
function makeWb(sheets) { return { SheetNames: Object.keys(sheets), Sheets: sheets }; }

/* ── (1) Stop-based layout (Skeleton Key style) ──────────────────────── */

test('Stop-based: stride-2 Reel headers + Symbol/Weight sub-header', () => {
  const cells = {
    'C1': 'Reel 1', 'E1': 'Reel 2', 'G1': 'Reel 3',
    'C2': 'Symbol', 'D2': 'Weight', 'E2': 'Symbol', 'F2': 'Weight', 'G2': 'Symbol', 'H2': 'Weight',
    /* 3 stops each reel, some duplicates to test aggregation */
    'C3': 'Wild',  'D3': 1, 'E3': 'Red7',  'F3': 1, 'G3': 'Ace', 'H3': 2,
    'C4': 'Wild',  'D4': 1, 'E4': 'Red7',  'F4': 1, 'G4': 'Ace', 'H4': 1,
    'C5': 'Red7',  'D5': 3, 'E5': 'Ace',   'F5': 5, 'G5': 'Red7', 'H5': 2,
  };
  const wb = makeWb({ 'PAR-Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips !== null, 'expected reels extracted');
  assert(r.reelStrips.length === 3, `expected 3 reels, got ${r.reelStrips.length}`);
  assert(r.source.layout === 'stop-based', `layout should be stop-based, got ${r.source.layout}`);
  /* Reel 1 aggregate: Wild=2, Red7=3 */
  const r1 = Object.fromEntries(r.reelStrips[0].map((e) => [e.symbol, e.weight]));
  assert(r1.Wild === 2 && r1.Red7 === 3, `reel 1 aggregate wrong: ${JSON.stringify(r1)}`);
  /* Reel 3 aggregate: Ace=3, Red7=2 */
  const r3 = Object.fromEntries(r.reelStrips[2].map((e) => [e.symbol, e.weight]));
  assert(r3.Ace === 3 && r3.Red7 === 2, `reel 3 aggregate wrong: ${JSON.stringify(r3)}`);
});

/* ── (2) Adjacent layout (base style) ────────────────────────────────── */

test('Adjacent: shared symbol col + per-reel weight cols', () => {
  const cells = {
    'C1': 'Symbol',
    'D1': 'Reel 1', 'E1': 'Reel 2', 'F1': 'Reel 3',
    'C2': 'Wild',  'D2': 1, 'E2': 2, 'F2': 0,
    'C3': 'Red7',  'D3': 5, 'E3': 4, 'F3': 7,
    'C4': 'Ace',   'D4': 8, 'E4': 9, 'F4': 6,
  };
  const wb = makeWb({ 'Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips !== null, 'expected reels extracted');
  assert(r.source.layout === 'adjacent', `layout should be adjacent, got ${r.source.layout}`);
  const r1 = Object.fromEntries(r.reelStrips[0].map((e) => [e.symbol, e.weight]));
  assert(r1.Wild === 1 && r1.Red7 === 5 && r1.Ace === 8, `reel 1 wrong: ${JSON.stringify(r1)}`);
  /* Reel 3 should NOT include Wild because its weight was 0 (filtered). */
  const r3sym = r.reelStrips[2].map((e) => e.symbol);
  assert(!r3sym.includes('Wild'), `reel 3 should drop zero-weight Wild, got ${JSON.stringify(r3sym)}`);
});

/* ── (3) Total row terminates ───────────────────────────────────────── */

test('Total row terminates data walk', () => {
  const cells = {
    'C1': 'Reel 1', 'E1': 'Reel 2', 'G1': 'Reel 3',
    'C2': 'Symbol', 'D2': 'Weight', 'E2': 'Symbol', 'F2': 'Weight', 'G2': 'Symbol', 'H2': 'Weight',
    'C3': 'Wild', 'D3': 5, 'E3': 'Wild', 'F3': 5, 'G3': 'Wild', 'H3': 5,
    'C4': 'Total', 'D4': 5,  /* terminator */
    /* These rows should NOT be included */
    'C5': 'Ghost', 'D5': 99, 'E5': 'Ghost', 'F5': 99, 'G5': 'Ghost', 'H5': 99,
  };
  const wb = makeWb({ 'PAR-Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips !== null, 'expected reels extracted');
  const r1sym = r.reelStrips[0].map((e) => e.symbol);
  assert(!r1sym.includes('Ghost'), `Ghost should be excluded after Total: ${JSON.stringify(r1sym)}`);
});

/* ── (4) Non-bonus sheet names skipped ───────────────────────────────── */

test('Non-bonus sheet names are skipped', () => {
  const cells = {
    'C1': 'Reel 1', 'E1': 'Reel 2', 'G1': 'Reel 3',
    'C2': 'Symbol', 'D2': 'Weight', 'E2': 'Symbol', 'F2': 'Weight', 'G2': 'Symbol', 'H2': 'Weight',
    'C3': 'Wild', 'D3': 5, 'E3': 'Wild', 'F3': 5, 'G3': 'Wild', 'H3': 5,
  };
  const wb = makeWb({ 'PAR-001': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips === null, 'expected null on non-bonus sheet');
});

/* ── (5) Non-sequential reel numbers rejected ────────────────────────── */

test('Non-sequential reel numbering (1, 3, 5) rejected', () => {
  const cells = {
    'C1': 'Reel 1', 'E1': 'Reel 3', 'G1': 'Reel 5',
    'C2': 'Symbol', 'D2': 'Weight', 'E2': 'Symbol', 'F2': 'Weight', 'G2': 'Symbol', 'H2': 'Weight',
    'C3': 'Wild', 'D3': 5, 'E3': 'Wild', 'F3': 5, 'G3': 'Wild', 'H3': 5,
  };
  const wb = makeWb({ 'Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips === null, 'non-sequential reels should be rejected');
});

/* ── (6) Fewer than 3 reels rejected ────────────────────────────────── */

test('Fewer than 3 reel headers in one row → not detected as FS table', () => {
  const cells = {
    'A1': 'Reel 1', 'B1': 'Reel 2',
    'A2': 'Symbol', 'B2': 'Weight',
    'A3': 'Wild', 'B3': 5,
  };
  const wb = makeWb({ 'Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips === null, 'expected null when only 2 reels');
});

/* ── (7) Empty workbook safety ───────────────────────────────────────── */

test('Empty workbook returns all-null safely', () => {
  const wb = makeWb({ 'Bonus': makeSheet({ 'A1': 'no reel headers' }) });
  const r = extractFsReelStrips(wb);
  assert(r.reelStrips === null, 'expected null');
  assert(r.confidence === 0, 'confidence 0');
});

/* ── (8) Confidence 0.85 when extraction succeeds ────────────────────── */

test('Confidence is 0.85 when extraction succeeds', () => {
  const cells = {
    'C1': 'Reel 1', 'E1': 'Reel 2', 'G1': 'Reel 3',
    'C2': 'Symbol', 'D2': 'Weight', 'E2': 'Symbol', 'F2': 'Weight', 'G2': 'Symbol', 'H2': 'Weight',
    'C3': 'Wild', 'D3': 5, 'E3': 'Wild', 'F3': 5, 'G3': 'Wild', 'H3': 5,
  };
  const wb = makeWb({ 'Bonus': makeSheet(cells) });
  const r = extractFsReelStrips(wb);
  assert(r.confidence === 0.85, `confidence expected 0.85, got ${r.confidence}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
