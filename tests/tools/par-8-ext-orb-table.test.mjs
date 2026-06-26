#!/usr/bin/env node
/**
 * tests/tools/par-8-ext-orb-table.test.mjs
 *
 * PAR-8-EXT (Boki 2026-06-27) contract test — Cash Eruption-style
 * orb table extractor.
 *
 * # COVERAGE
 *
 *   - "coin values" + "low" "med" "high" header detection
 *   - Per-sheet boundary (4 variant sheets don't 4× weights)
 *   - First-orb-table-only per sheet (subsequent sections skipped)
 *   - Total/Sum row terminates extraction
 *   - Coin value > 10000 filtered (avoid spillover columns)
 *   - Empty workbook returns null safely
 *   - Aggregated weight = sum of low + med + high
 */

import { extractHnwOrbValues } from '../../tools/_par-sheet-to-model.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-8-EXT Orb table extractor · test suite');

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

/* ── (1) Standard CE-style orb table ─────────────────────────────────── */

test('Standard: "coin values" + low/med/high → aggregated orb table', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,    /* 20-coin: total 60400 */
    'K3': 40, 'L3': 20000, 'M3': 20000, 'N3': 600,    /* 40-coin: total 40600 */
    'K4': 100, 'L4': 2500, 'M4': 30000, 'N4': 29000,  /* 100-coin: total 61500 */
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.orbValues !== null, 'expected orb table extracted');
  assert(r.orbValues.length === 3, `expected 3 tiers, got ${r.orbValues.length}`);
  const byValue = Object.fromEntries(r.orbValues.map((o) => [o.value, o.weight]));
  assert(byValue[20] === 60400, `value 20: ${byValue[20]} vs 60400`);
  assert(byValue[40] === 40600, `value 40: ${byValue[40]} vs 40600`);
  assert(byValue[100] === 61500, `value 100: ${byValue[100]} vs 61500`);
});

/* ── (2) Per-sheet boundary — 3 variant sheets don't triple weight ──── */

test('Per-sheet boundary: identical tables in PAR-001/002/003 stay 1×', () => {
  const tbl = {
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,
  };
  const wb = makeWb({
    'PAR-001': makeSheet(tbl),
    'PAR-002': makeSheet(tbl),
    'PAR-003': makeSheet(tbl),
  });
  const r = extractHnwOrbValues(wb);
  assert(r.orbValues !== null, 'expected orb table extracted');
  assert(r.orbValues[0].weight === 60400, `weight should NOT triple, got ${r.orbValues[0].weight}`);
  assert(r.source.sheet === 'PAR-001', `source should be PAR-001, got ${r.source.sheet}`);
});

/* ── (3) Total row terminates inside same table ─────────────────────── */

test('Total row terminates extraction within the table', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,
    'J3': 'Total', 'K3': 100000,  /* total row in J column */
    'K4': 9999, 'L4': 99999, 'M4': 99999, 'N4': 99999,  /* should NOT be picked */
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.orbValues.length === 1, `expected 1 row before Total, got ${r.orbValues.length}`);
  assert(r.orbValues[0].value === 20, 'first row is value=20');
});

/* ── (4) Coin value > 10000 filtered ─────────────────────────────────── */

test('Coin value > 10000 filtered (avoid spillover column)', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,        /* keep */
    'K3': 50000, 'L3': 99, 'M3': 99, 'N3': 99,            /* skip — too high */
    'K4': 100, 'L4': 1000, 'M4': 1000, 'N4': 1000,        /* keep */
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  const vals = r.orbValues.map((o) => o.value);
  assert(vals.includes(20) && vals.includes(100), 'expected 20 and 100');
  assert(!vals.includes(50000), `50000 should be filtered, got ${vals}`);
});

/* ── (5) Workbook without orb section → null ─────────────────────────── */

test('Workbook without "coin values" header returns null', () => {
  const ws = makeSheet({ 'A1': 'no orb section here', 'B1': 'just text' });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.orbValues === null, `expected null, got ${JSON.stringify(r.orbValues)}`);
});

/* ── (6) Mis-shapen header (no low/med/high) rejected ────────────────── */

test('Mis-shapen header (missing tier labels) rejected', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'foo', 'M1': 'bar', 'N1': 'baz',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.orbValues === null, 'expected null when tier labels missing');
});

/* ── (7) Source tag returned ─────────────────────────────────────────── */

test('Source field tagged with sheet + headerRow', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.source.sheet === 'PAR-001', `sheet wrong: ${r.source.sheet}`);
  assert(r.source.headerRow === 1, `headerRow wrong: ${r.source.headerRow}`);
});

/* ── (8) Confidence 0.85 on success ──────────────────────────────────── */

test('Confidence is 0.85 when extraction succeeds', () => {
  const ws = makeSheet({
    'K1': 'coin values', 'L1': 'low', 'M1': 'med', 'N1': 'high',
    'K2': 20, 'L2': 50000, 'M2': 10000, 'N2': 400,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractHnwOrbValues(wb);
  assert(r.confidence === 0.85, `confidence: ${r.confidence}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
