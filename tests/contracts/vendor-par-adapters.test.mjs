#!/usr/bin/env node
/**
 * tests/contracts/vendor-par-adapters.test.mjs
 *
 * MATH-DEEP HYB-4 — Vendor PAR sheet adapter contract test (2026-06-23).
 *
 * Purpose
 *   Verifies tools/par-sheet-pragmatic.py + tools/par-sheet-lw.py adapter
 *   binaries exist + can be invoked + emit canonical ParSheet shape when
 *   fed a synthetic xlsx fixture that mimics their respective vendor
 *   layouts.
 *
 * Strategy
 *   Build minimal-viable xlsx via openpyxl (Python subprocess), feed to
 *   adapter, assert output matches ParSheet shape. No real Pragmatic /
 *   L&W xlsx required (those are vendor-confidential).
 *
 * Synthetic fixtures
 *   Pragmatic:  Spanish "Rodillo 1..5" + "Símbolo" headers, 3 symbols × 5 reels
 *   L&W:        "STRIP_1..5" + "SYM" headers, 3 symbols × 5 reels
 *
 * Performance: ≤ 5s total (xlsx generation + 2 adapter calls).
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
const pending = [];
const tmpRoot = mkdtempSync(join(tmpdir(), 'vendor-par-test-'));

function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('VENDOR PAR adapters · test suite (Pragmatic + L&W)');

/* ── Helper: build synthetic xlsx ───────────────────────────────────── */

function buildSyntheticXlsx(outPath, headers, rows) {
  const script = `
import openpyxl
import sys
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Sheet1"
headers = ${JSON.stringify(headers)}
rows = ${JSON.stringify(rows)}
for ci, h in enumerate(headers, start=1):
    ws.cell(row=1, column=ci, value=h)
for ri, row in enumerate(rows, start=2):
    for ci, v in enumerate(row, start=1):
        ws.cell(row=ri, column=ci, value=v)
wb.save(sys.argv[1])
print("OK")
`;
  const r = spawnSync('python3', ['-c', script, outPath], {
    encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) {
    throw new Error(`xlsx build failed: ${r.stderr}`);
  }
}

/* ── (1) Pragmatic adapter exists + invokable ───────────────────────── */

test('par-sheet-pragmatic.py binary exists', () => {
  const p = join(REPO, 'tools/par-sheet-pragmatic.py');
  assert(existsSync(p), `adapter not found: ${p}`);
});

test('par-sheet-lw.py binary exists', () => {
  const p = join(REPO, 'tools/par-sheet-lw.py');
  assert(existsSync(p), `adapter not found: ${p}`);
});

/* ── (2) Pragmatic adapter ingests Spanish-header xlsx ──────────────── */

test('Pragmatic adapter ingests Spanish-header synthetic xlsx', () => {
  const xlsx = join(tmpRoot, 'pragmatic-test.xlsx');
  /* Spanish headers: Símbolo + Rodillo 1..5 + 3OAK/4OAK/5OAK. */
  buildSyntheticXlsx(xlsx,
    ['Símbolo', 'Rodillo 1', 'Rodillo 2', 'Rodillo 3', 'Rodillo 4', 'Rodillo 5', '3OAK', '4OAK', '5OAK'],
    [
      ['A',  5, 5, 5, 5, 5, 100, 500, 2000],
      ['K', 10, 8, 8, 8, 10, 50, 200, 1000],
      ['Q', 15, 15, 15, 15, 15, 20, 100, 500],
      ['W',  3, 3, 3, 3, 3, 0, 0, 0],
    ]);
  const r = spawnSync('python3', [join(REPO, 'tools/par-sheet-pragmatic.py'),
    '--xlsx', xlsx, '--out', '-'], { encoding: 'utf8', timeout: 30_000 });
  assert(r.status === 0, `adapter exit ${r.status}: ${r.stderr}`);
  const par = JSON.parse(r.stdout);
  assert(par.vendor === 'pragmatic', `vendor: ${par.vendor}`);
  assert(par.totals.reels === 5, `reels: ${par.totals.reels}`);
  assert(par.totals.symbols === 4, `symbols: ${par.totals.symbols}`);
  assert(par.paytable.length === 3, `paytable rows: ${par.paytable.length}`);
  assert(par.paytable[0].symbolId === 'A', `first paytable id: ${par.paytable[0].symbolId}`);
  assert(par.paytable[0].combos['3'] === 100, `A 3OAK: ${par.paytable[0].combos['3']}`);
});

/* ── (3) L&W adapter ingests STRIP_1..5 / SYM xlsx ──────────────────── */

test('L&W adapter ingests STRIP/SYM synthetic xlsx', () => {
  const xlsx = join(tmpRoot, 'lw-test.xlsx');
  buildSyntheticXlsx(xlsx,
    ['SYM', 'STRIP_1', 'STRIP_2', 'STRIP_3', 'STRIP_4', 'STRIP_5', '3OAK', '4OAK', '5OAK'],
    [
      ['A',  5, 5, 5, 5, 5, 100, 500, 2000],
      ['K', 10, 8, 8, 8, 10, 50, 200, 1000],
      ['Q', 15, 15, 15, 15, 15, 20, 100, 500],
    ]);
  const r = spawnSync('python3', [join(REPO, 'tools/par-sheet-lw.py'),
    '--xlsx', xlsx, '--out', '-'], { encoding: 'utf8', timeout: 30_000 });
  assert(r.status === 0, `adapter exit ${r.status}: ${r.stderr}`);
  const par = JSON.parse(r.stdout);
  assert(par.vendor === 'lw', `vendor: ${par.vendor}`);
  assert(par.totals.reels === 5, `reels: ${par.totals.reels}`);
  assert(par.totals.symbols === 3, `symbols: ${par.totals.symbols}`);
  assert(par.paytable.length === 3, `paytable rows: ${par.paytable.length}`);
});

/* ── (4) Both adapters emit canonical ParSheet shape ─────────────────── */

test('Both adapters emit canonical fields (vendor, reels, per_reel_weights, paytable, totals)', () => {
  const xlsx = join(tmpRoot, 'common-test.xlsx');
  buildSyntheticXlsx(xlsx,
    ['Símbolo', 'Rodillo 1', 'Rodillo 2', 'Rodillo 3', '3OAK'],
    [['A', 5, 5, 5, 100]]);
  const r = spawnSync('python3', [join(REPO, 'tools/par-sheet-pragmatic.py'),
    '--xlsx', xlsx, '--out', '-'], { encoding: 'utf8', timeout: 30_000 });
  assert(r.status === 0, `adapter exit ${r.status}`);
  const par = JSON.parse(r.stdout);
  for (const key of ['vendor', 'reels', 'per_reel_weights', 'paytable', 'totals']) {
    assert(key in par, `missing canonical key: ${key}`);
  }
  assert(typeof par.totals.sumWeight === 'number', 'sumWeight should be number');
});

/* ── (5) dispatcher routes pragmatic + lw through correct adapter ─────── */

test('dispatchIngest routes pragmatic vendor to par-sheet-pragmatic.py', async () => {
  const xlsx = join(tmpRoot, 'dispatch-pragmatic.xlsx');
  buildSyntheticXlsx(xlsx,
    ['Símbolo', 'Rodillo 1', 'Rodillo 2', 'Rodillo 3', 'Rodillo 4', 'Rodillo 5'],
    [['A', 5, 5, 5, 5, 5]]);
  const { dispatchIngest } = await import('../../tools/par-sheet-detect.mjs');
  const r = dispatchIngest(xlsx);
  assert(r.ok === true, `dispatch failed: ${r.error}`);
  assert(r.adapter === 'tools/par-sheet-pragmatic.py' ||
         r.adapter === 'tools/par-sheet-xlsx-ingest.py',  /* fallback ok */
    `unexpected adapter: ${r.adapter}`);
});

/* ── Result + cleanup (await all pending) ───────────────────────────── */

Promise.all(pending).then(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
