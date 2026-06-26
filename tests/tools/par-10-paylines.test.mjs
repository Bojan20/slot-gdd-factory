#!/usr/bin/env node
/**
 * tests/tools/par-10-paylines.test.mjs
 *
 * PAR-10 (Boki 2026-06-26) contract test — Paylines tab extractor.
 *
 * # COVERAGE
 *
 *   - Cash Eruption style: "Payline 1" label + 'X' marker, 3-row blocks
 *   - Book of Unseen style: "Line 1:" label + numeric 1 marker
 *   - Fort Knox style: 4-row blocks (5×4 grid promotion)
 *   - Mixed sheet name detection (Paylines / PAR_LINES / par-lines)
 *   - Partial-pattern rejection (missing X in a reel column → skip)
 *   - Empty sheet path returns null safely
 *   - Pattern shape invariants (all entries integer, in [0, rows-1])
 *
 * # WHY A CONTRACT TEST
 *
 * Pre-PAR-10 the PAR-5 mapper synthesized paylines via row-cycle
 * fallback. Replacing that with par-sheet-lifted patterns is a behavior
 * change that downstream convergence verdicts depend on. A regression
 * here (extractor returns null when patterns ARE present, or returns
 * a malformed shape) would silently drop pattern fidelity and inflate
 * the measured-vs-declared gap. This test pins the contract so any
 * future refactor must keep the lift working.
 */

import { extractPaylinePatterns } from '../../tools/_par-sheet-to-model.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-10 Paylines extractor · test suite');

/* ── helpers to build a fake xlsx workbook (SheetJS shape) ───────────── */

function makeSheet(cells) {
  /* cells is an object: { 'A1': 'val', 'B2': 1, ... }. Compute !ref
   * from the bounding box automatically. Each cell entry is wrapped
   * as { v: value } to match SheetJS in-memory format consumed by
   * cellAt() / cellString() / cellNumber(). */
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
  if (maxR < 0) {
    ws['!ref'] = 'A1:A1';
    return ws;
  }
  const colA = (n) => {
    let s = '';
    n += 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  ws['!ref'] = `${colA(minC)}${minR + 1}:${colA(maxC)}${maxR + 1}`;
  return ws;
}

function makeWb(sheets) {
  return {
    SheetNames: Object.keys(sheets),
    Sheets: sheets,
  };
}

/* ── (1) Cash Eruption style (Payline N + X) ─────────────────────────── */

test('Cash Eruption style: "Payline N" + X markers, 3-row block', () => {
  /* Two paylines in one row: P1 at C2, P2 at H2. Block height 4
   * (label row + 3 pattern rows). */
  const ws = makeSheet({
    'C2': 'Payline 1',
    'H2': 'Payline 2',
    /* Payline 1 = middle row [1,1,1,1,1] → row 4 (offset 2 from label) */
    'C4': 'X', 'D4': 'X', 'E4': 'X', 'F4': 'X', 'G4': 'X',
    /* Payline 2 = top row [0,0,0,0,0] → row 3 (offset 1 from label) */
    'H3': 'X', 'I3': 'X', 'J3': 'X', 'K3': 'X', 'L3': 'X',
    /* spacer to set stride 4 (so block height = 3) */
    'C6': 'Payline 3',
    'C9': 'X', 'D9': 'X', 'E9': 'X', 'F9': 'X', 'G9': 'X',  /* bottom row */
  });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns !== null, 'expected patterns extracted');
  assert(r.count === 3, `expected 3 patterns, got ${r.count}`);
  assert(JSON.stringify(r.patterns[0]) === '[1,1,1,1,1]', `P1 mismatch: ${JSON.stringify(r.patterns[0])}`);
  assert(JSON.stringify(r.patterns[1]) === '[0,0,0,0,0]', `P2 mismatch: ${JSON.stringify(r.patterns[1])}`);
  assert(JSON.stringify(r.patterns[2]) === '[2,2,2,2,2]', `P3 mismatch: ${JSON.stringify(r.patterns[2])}`);
  assert(r.source.sheet === 'Paylines', `source sheet wrong: ${r.source.sheet}`);
  assert(r.gridRows === 3, `gridRows expected 3, got ${r.gridRows}`);
});

/* ── (2) Book of Unseen style (Line N: + numeric 1) ──────────────────── */

test('Book of Unseen style: "Line N:" + numeric 1 markers', () => {
  /* Line 1 = middle row [1,1,1,1,1], Line 2 = top row.
   * Sheet name PAR_LINES (underscore variant of regex). */
  const ws = makeSheet({
    'B8': 'Line 1:',
    'H8': 'Line 2:',
    'B10': 1, 'C10': 1, 'D10': 1, 'E10': 1, 'F10': 1,  /* P1 middle */
    'H9': 1, 'I9': 1, 'J9': 1, 'K9': 1, 'L9': 1,        /* P2 top */
    'B13': 'Line 3:',
    'B16': 1, 'C16': 1, 'D16': 1, 'E16': 1, 'F16': 1,   /* P3 bottom */
  });
  const wb = makeWb({ 'PAR_LINES': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns !== null, 'expected patterns extracted');
  assert(r.count === 3, `expected 3 patterns, got ${r.count}`);
  assert(JSON.stringify(r.patterns[0]) === '[1,1,1,1,1]', `P1 mismatch: ${JSON.stringify(r.patterns[0])}`);
  assert(JSON.stringify(r.patterns[1]) === '[0,0,0,0,0]', `P2 mismatch: ${JSON.stringify(r.patterns[1])}`);
  assert(JSON.stringify(r.patterns[2]) === '[2,2,2,2,2]', `P3 mismatch: ${JSON.stringify(r.patterns[2])}`);
});

/* ── (3) Fort Knox 5×4 grid (block height 4) ─────────────────────────── */

test('Fort Knox style: 5×4 grid with 4-row blocks, gridRows promotion', () => {
  /* Block height 4 means stride between labels in same column = 5
   * (label + 4 pattern rows). Use one column to define stride. */
  const ws = makeSheet({
    'B3': 'Payline 1',
    'B8': 'Payline 6',  /* stride 5 → block height 4 */
    'H3': 'Payline 2',
    /* Payline 1: pattern uses row offset 4 = row 7 (last of 4 pattern rows)
     * → row index 3 (4th row = grid row 3). */
    'B7': 'X', 'C7': 'X', 'D7': 'X', 'E7': 'X', 'F7': 'X',
    /* Payline 2: top row */
    'H4': 'X', 'I4': 'X', 'J4': 'X', 'K4': 'X', 'L4': 'X',
    /* Payline 6: middle-low (row offset 3 → grid row 2) */
    'B11': 'X', 'C11': 'X', 'D11': 'X', 'E11': 'X', 'F11': 'X',
  });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns !== null, 'expected patterns extracted');
  assert(r.count === 3, `expected 3 patterns, got ${r.count}`);
  assert(JSON.stringify(r.patterns[0]) === '[3,3,3,3,3]', `P1 mismatch (expected bottom row 3 of 4): ${JSON.stringify(r.patterns[0])}`);
  assert(JSON.stringify(r.patterns[1]) === '[0,0,0,0,0]', `P2 mismatch: ${JSON.stringify(r.patterns[1])}`);
  assert(JSON.stringify(r.patterns[2]) === '[2,2,2,2,2]', `P6 mismatch: ${JSON.stringify(r.patterns[2])}`);
  assert(r.gridRows === 4, `gridRows expected 4, got ${r.gridRows}`);
});

/* ── (4) V-shape pattern fidelity ────────────────────────────────────── */

test('V-shape pattern [0,1,2,1,0] preserved (not row-cycle synthesis)', () => {
  const ws = makeSheet({
    'B2': 'Payline 1',
    /* V-shape: reel 0 top, reel 1 mid, reel 2 bottom, reel 3 mid, reel 4 top */
    'B3': 'X',
    'C4': 'X',
    'D5': 'X',
    'E4': 'X',
    'F3': 'X',
  });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns !== null, 'expected patterns extracted');
  assert(JSON.stringify(r.patterns[0]) === '[0,1,2,1,0]', `V-shape mismatch: ${JSON.stringify(r.patterns[0])}`);
});

/* ── (5) Partial pattern → skipped ───────────────────────────────────── */

test('Partial pattern (missing X in one reel column) is rejected', () => {
  const ws = makeSheet({
    'B2': 'Payline 1',
    /* Reels 0, 1, 2, 3 marked; reel 4 has NO marker → pattern incomplete */
    'B4': 'X', 'C4': 'X', 'D4': 'X', 'E4': 'X',
    /* second payline valid as control */
    'B6': 'Payline 2',
    'B7': 'X', 'C7': 'X', 'D7': 'X', 'E7': 'X', 'F7': 'X',
  });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  /* Only the complete payline should survive. P1 dropped, P2 kept. */
  assert(r.count === 1, `expected 1 valid pattern, got ${r.count}`);
  assert(JSON.stringify(r.patterns[0]) === '[0,0,0,0,0]', `surviving payline mismatch: ${JSON.stringify(r.patterns[0])}`);
});

/* ── (6) No Paylines sheet → null safely ─────────────────────────────── */

test('Workbook without Paylines sheet returns null patterns', () => {
  const ws = makeSheet({ 'A1': 'PAR-001 Title', 'A2': 'Some unrelated cell' });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns === null, `expected null, got: ${JSON.stringify(r.patterns)}`);
  assert(r.count === 0, `expected count 0, got ${r.count}`);
  assert(r.confidence === 0, `expected confidence 0, got ${r.confidence}`);
});

/* ── (7) Empty Paylines sheet → null safely ──────────────────────────── */

test('Empty Paylines sheet (no labels) returns null patterns', () => {
  const ws = makeSheet({ 'A1': 'Paylines heading only' });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns === null, 'expected null patterns when no labels');
  assert(r.confidence === 0, 'expected zero confidence');
});

/* ── (8) Shape invariants always hold ────────────────────────────────── */

test('All extracted patterns satisfy shape invariants', () => {
  const ws = makeSheet({
    'C2': 'Payline 1',
    'H2': 'Payline 2',
    'C4': 'X', 'D4': 'X', 'E4': 'X', 'F4': 'X', 'G4': 'X',
    'H3': 'X', 'I3': 'X', 'J3': 'X', 'K3': 'X', 'L3': 'X',
  });
  const wb = makeWb({ 'Paylines': ws });
  const r = extractPaylinePatterns(wb);
  assert(r.patterns !== null, 'expected patterns extracted');
  for (const p of r.patterns) {
    assert(Array.isArray(p), 'each pattern is array');
    assert(p.length === 5, 'pattern length = 5 reels');
    for (const v of p) {
      assert(Number.isInteger(v), `each entry integer (got ${v})`);
      assert(v >= 0 && v < r.gridRows, `entry within [0, gridRows): ${v} vs ${r.gridRows}`);
    }
  }
  assert(r.confidence === 0.95, `confidence should be 0.95 for explicit lift, got ${r.confidence}`);
});

/* ── summary ─────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
