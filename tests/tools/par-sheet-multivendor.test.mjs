#!/usr/bin/env node
/**
 * tests/tools/par-sheet-multivendor.test.mjs
 *
 * MATH-DEEP HYB-4 test suite — Multi-vendor PAR sheet ingest.
 *
 * Coverage
 *   - parseCsvText() handles quoted fields, escapes, BOM, CRLF
 *   - detectHeader() finds symbol/reel/pay columns under various aliases
 *   - ingestCsv() round-trips a small synthetic CSV into canonical shape
 *   - detectVendor() handles JSON self-declared vendor
 *   - detectVendor() handles missing file gracefully
 *   - dispatchIngest() inline JSON adapter works
 *   - Generic CSV file actually parsable end-to-end
 */

import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectVendor,
  dispatchIngest,
} from '../../tools/par-sheet-detect.mjs';
import {
  ingestCsv,
  parseCsvText,
} from '../../tools/par-sheet-generic-csv.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
const tmpDir = mkdtempSync(join(tmpdir(), 'hyb4-test-'));

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('HYB-4 Multi-Vendor PAR Sheet Ingest · test suite');

/* ── (1) parseCsvText handles quoted fields ───────────────────────────── */

test('parseCsvText splits comma-separated rows', () => {
  const rows = parseCsvText('a,b,c\n1,2,3\n4,5,6\n');
  assert(rows.length === 3, `expected 3 rows, got ${rows.length}`);
  assert(rows[0].length === 3 && rows[0][0] === 'a', 'header row');
  assert(rows[1][2] === '3', 'data row');
});

test('parseCsvText handles quoted comma in field', () => {
  const rows = parseCsvText('name,desc\nR7,"a,b,c"\n');
  assert(rows.length === 2, 'two rows');
  assert(rows[1][1] === 'a,b,c', `quoted comma preserved, got: ${rows[1][1]}`);
});

test('parseCsvText handles escaped quotes', () => {
  const rows = parseCsvText('name,desc\nR7,"He said ""ok"""\n');
  assert(rows[1][1] === 'He said "ok"', `escaped quote, got: ${rows[1][1]}`);
});

test('parseCsvText strips BOM', () => {
  const rows = parseCsvText('﻿a,b\n1,2\n');
  assert(rows[0][0] === 'a', `BOM stripped, got: ${rows[0][0]}`);
});

test('parseCsvText handles CRLF line endings', () => {
  const rows = parseCsvText('a,b\r\n1,2\r\n');
  assert(rows.length === 2, 'CRLF normalized');
});

/* ── (2) ingestCsv end-to-end on synthetic CSV ────────────────────────── */

test('ingestCsv handles symbol+reel+pay CSV layout', () => {
  const csvPath = join(tmpDir, 'test.csv');
  const csv = `symbol,reel1,reel2,reel3,reel4,reel5,pay3,pay4,pay5
R7,5,5,5,5,5,100,500,2000
B7,10,8,8,8,10,50,200,1000
BL,15,15,15,15,15,20,100,500
A,30,30,30,30,30,5,20,100
`;
  writeFileSync(csvPath, csv, 'utf8');
  const par = ingestCsv(csvPath);
  assert(par.vendor === 'generic', `vendor: ${par.vendor}`);
  assert(par.reels.length === 5, `5 reels, got ${par.reels.length}`);
  assert(par.totals.reels === 5, 'totals.reels = 5');
  assert(par.totals.symbols === 4, `4 symbols, got ${par.totals.symbols}`);
  assert(par.paytable.length === 4, '4 paytable rows');
  assert(par.paytable[0].symbolId === 'R7', 'R7 first');
  assert(par.paytable[0].combos['3'] === 100, 'R7 3OAK = 100');
  /* Reel 1 expanded: 5 R7 + 10 B7 + 15 BL + 30 A = 60 entries. */
  assert(par.reels[0].length === 60, `reel 1 expanded length 60, got ${par.reels[0].length}`);
  assert(par.per_reel_weights[0].R7 === 5, 'per_reel_weights R7 reel 1');
});

test('ingestCsv handles header aliases (R1/Sym/3OAK)', () => {
  const csvPath = join(tmpDir, 'test-alias.csv');
  const csv = `sym,R1,R2,R3,R4,R5,3OAK,4OAK,5OAK
R7,5,5,5,5,5,100,500,2000
`;
  writeFileSync(csvPath, csv, 'utf8');
  const par = ingestCsv(csvPath);
  assert(par.totals.symbols === 1, 'one symbol');
  assert(par.paytable[0].combos['3'] === 100, '3OAK = 100');
});

test('ingestCsv throws on missing symbol column', () => {
  const csvPath = join(tmpDir, 'test-missing-sym.csv');
  writeFileSync(csvPath, 'reel1,reel2\n1,2\n', 'utf8');
  let threw = false;
  try { ingestCsv(csvPath); } catch (e) { threw = e.message.includes('symbol'); }
  assert(threw, 'should throw on missing symbol column');
});

/* ── (3) detectVendor on missing / json / csv ─────────────────────────── */

test('detectVendor returns missing for nonexistent file', () => {
  const r = detectVendor('/tmp/__does_not_exist_xyz.xlsx');
  assert(r.format === 'missing', `format: ${r.format}`);
  assert(r.confidence === 0, 'confidence 0 for missing');
});

test('detectVendor recognizes self-declared json vendor', () => {
  const p = join(tmpDir, 'test-pragmatic.json');
  writeFileSync(p, JSON.stringify({ vendor: 'pragmatic', reels: [] }), 'utf8');
  const r = detectVendor(p);
  assert(r.vendor === 'pragmatic', `vendor: ${r.vendor}`);
  assert(r.confidence >= 0.9, `confidence >= 0.9, got ${r.confidence}`);
});

test('detectVendor identifies generic CSV', () => {
  const p = join(tmpDir, 'test-generic.csv');
  writeFileSync(p, 'symbol,reel1,reel2,reel3,reel4,reel5\nR7,1,1,1,1,1\n', 'utf8');
  const r = detectVendor(p);
  assert(r.format === 'csv', `format: ${r.format}`);
  assert(r.vendor === 'generic', `vendor: ${r.vendor}`);
});

/* ── (4) dispatchIngest inline json ───────────────────────────────────── */

test('dispatchIngest handles inline JSON adapter', () => {
  const p = join(tmpDir, 'test-inline.json');
  writeFileSync(p, JSON.stringify({ vendor: 'generic', reels: [['R7','BL']], paytable: [] }), 'utf8');
  const r = dispatchIngest(p);
  assert(r.ok === true, `ok=true, error: ${r.error}`);
  assert(r.parSheet?.vendor === 'generic', 'vendor preserved');
  assert(r.parSheet?.reels?.length === 1, 'reels preserved');
});

test('dispatchIngest returns ok=false for missing file', () => {
  const r = dispatchIngest('/tmp/__nope__.xlsx');
  assert(r.ok === false, 'should not be ok');
  assert(r.error.includes('not found'), `error should mention not found, got: ${r.error}`);
});

/* ── (5) Schema compliance ────────────────────────────────────────────── */

test('Generic CSV output validates against ParSheetSchema-compatible shape', () => {
  const csvPath = join(tmpDir, 'test-schema.csv');
  const csv = `symbol,reel1,reel2,reel3,reel4,reel5
R7,5,5,5,5,5
`;
  writeFileSync(csvPath, csv, 'utf8');
  const par = ingestCsv(csvPath);
  /* Schema validation deferred to HYB-1 ParSheetSchema; here we check
   * top-level shape matches the documented contract. */
  assert(typeof par.vendor === 'string', 'vendor is string');
  assert(Array.isArray(par.reels), 'reels is array');
  assert(typeof par.per_reel_weights === 'object', 'per_reel_weights is object');
  assert(Array.isArray(par.paytable), 'paytable is array');
  assert(typeof par.totals === 'object', 'totals is object');
});

/* ── Cleanup ──────────────────────────────────────────────────────────── */

try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
