#!/usr/bin/env node
/**
 * tests/tools/par-12-free-spins.test.mjs
 *
 * PAR-12-A/B (Boki 2026-06-27) contract test — Free Spin award schedule
 * extractor + average-pay column.
 *
 * # COVERAGE
 *
 *   - Skeleton Key style: "Trigger" / "Avg. Pay" header + "N Free Spins" rows
 *   - Industry-default scatter mapping (row 1 → 3 scatters, etc.)
 *   - Avg-pay numeric capture as scatter_pays equivalent
 *   - No bonus/FS sheet → null result
 *   - Partial table (no Avg. Pay header) → awards extracted, avgPays null
 *   - Out-of-range pay values rejected
 *   - Non-bonus sheet names skipped
 *   - Spacer rows don't advance scatter counter
 *
 * # WHY A CONTRACT TEST
 *
 * extractFreeSpinAwards drives the PAR-5 mapper's free_spins.awards
 * and free_spins.scatter_pays population. Pre-PAR-12 those were
 * hard-coded empty maps; sister kernel never simulated FS for any par
 * sheet. A regression here would silently turn off FS contribution
 * across all eligible slugs. Pin the contract.
 */

import { extractFreeSpinAwards } from '../../tools/_par-sheet-to-model.mjs';

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

console.log('PAR-12 Free Spin extractor · test suite');

/* ── helpers ─────────────────────────────────────────────────────────── */

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
    let s = '';
    n += 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  ws['!ref'] = `${colA(minC)}${minR + 1}:${colA(maxC)}${maxR + 1}`;
  return ws;
}
function makeWb(sheets) { return { SheetNames: Object.keys(sheets), Sheets: sheets }; }

/* ── (1) Skeleton Key style: Trigger + Avg. Pay → awards + avgPays ───── */

test('Skeleton Key style: Trigger header + N Free Spins → awards + avgPays', () => {
  const ws = makeSheet({
    'C26': 'Trigger', 'D26': 'Avg. Pay',
    'C27': '10 Free Spins', 'D27': 94.68,
    'C28': '20 Free Spins', 'D28': 269.99,
    'C29': '30 Free Spins', 'D29': 547.55,
  });
  const wb = makeWb({ 'PAR-Bonus': ws });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards !== null, 'expected awards extracted');
  assert(r.awards['3'] === 10, `awards[3] expected 10, got ${r.awards['3']}`);
  assert(r.awards['4'] === 20, `awards[4] expected 20, got ${r.awards['4']}`);
  assert(r.awards['5'] === 30, `awards[5] expected 30, got ${r.awards['5']}`);
  assert(r.avgPays !== null, 'expected avgPays extracted');
  assert(Math.abs(r.avgPays['3'] - 94.68) < 1e-6, `avgPays[3] mismatch: ${r.avgPays['3']}`);
  assert(Math.abs(r.avgPays['4'] - 269.99) < 1e-6, `avgPays[4] mismatch: ${r.avgPays['4']}`);
  assert(Math.abs(r.avgPays['5'] - 547.55) < 1e-6, `avgPays[5] mismatch: ${r.avgPays['5']}`);
  assert(r.source.sheet === 'PAR-Bonus', `source sheet wrong: ${r.source.sheet}`);
});

/* ── (2) "FS Awarded" header variant ─────────────────────────────────── */

test('Header variant: "FS Awarded" instead of "Avg. Pay"', () => {
  const ws = makeSheet({
    'A5': 'Trigger', 'B5': 'FS Awarded',
    'A6': '10 Free Spins', 'B6': 10,
    'A7': '15 Free Spins', 'B7': 15,
  });
  const wb = makeWb({ 'Bonus': ws });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards !== null, 'expected awards extracted');
  assert(r.awards['3'] === 10, `awards[3] expected 10, got ${r.awards['3']}`);
  assert(r.awards['4'] === 15, `awards[4] expected 15, got ${r.awards['4']}`);
});

/* ── (3) Non-bonus sheet name → skipped ──────────────────────────────── */

test('Non-bonus sheet names are skipped (only bonus/free.*spin/fs)', () => {
  const ws = makeSheet({
    'A1': 'Trigger', 'B1': 'Avg. Pay',
    'A2': '10 Free Spins', 'B2': 100,
  });
  const wb = makeWb({ 'PAR_001': ws });  /* not bonus/FS-tagged */
  const r = extractFreeSpinAwards(wb);
  assert(r.awards === null, `expected null on non-bonus sheet, got ${JSON.stringify(r.awards)}`);
});

/* ── (4) Workbook without bonus sheet → null ─────────────────────────── */

test('Workbook without bonus / FS sheet returns null', () => {
  const ws = makeSheet({ 'A1': 'PAR Summary', 'A2': 'something else' });
  const wb = makeWb({ 'PAR-001': ws, 'Paylines': makeSheet({ 'A1': 'data' }) });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards === null, 'expected null');
  assert(r.avgPays === null, 'avgPays null');
  assert(r.confidence === 0, 'confidence 0');
});

/* ── (5) Out-of-range fs counts skipped ──────────────────────────────── */

test('FS counts outside [1, 200] are skipped', () => {
  const ws = makeSheet({
    'A1': 'Trigger', 'B1': 'Avg. Pay',
    'A2': '500 Free Spins', 'B2': 100,  /* out of range */
    'A3': '10 Free Spins', 'B3': 95,
  });
  const wb = makeWb({ 'PAR-Bonus': ws });
  const r = extractFreeSpinAwards(wb);
  /* "500 Free Spins" rejected → first valid row "10 Free Spins" anchors
   * scatter=3. */
  assert(r.awards !== null && r.awards['3'] === 10,
    `expected awards[3]=10 only, got ${JSON.stringify(r.awards)}`);
});

/* ── (6) Spacer rows don't advance scatter counter ───────────────────── */

test('Spacer rows (no FS label) do not advance scatter counter', () => {
  const ws = makeSheet({
    'A1': 'Trigger', 'B1': 'Avg. Pay',
    'A2': '10 Free Spins', 'B2': 95,
    'A3': 'spacer note', 'B3': 0,   /* not FS label, skip */
    'A4': '20 Free Spins', 'B4': 270,
  });
  const wb = makeWb({ 'PAR-Bonus': ws });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards['3'] === 10, `awards[3] expected 10, got ${r.awards['3']}`);
  assert(r.awards['4'] === 20, `awards[4] expected 20 (spacer skipped), got ${r.awards['4']}`);
});

/* ── (7) Partial table (no Avg. Pay) → awards + null avgPays ─────────── */

test('Partial table without Avg. Pay column: awards extracted, avgPays null', () => {
  const ws = makeSheet({
    'A1': 'Trigger', 'B1': 'Spins Awarded',
    'A2': '10 Free Spins',  /* no numeric in B2 */
    'A3': '20 Free Spins',
  });
  const wb = makeWb({ 'PAR-Bonus': ws });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards !== null, 'awards still extracted from label');
  assert(r.awards['3'] === 10, `awards[3] expected 10, got ${r.awards['3']}`);
  assert(r.awards['4'] === 20, `awards[4] expected 20, got ${r.awards['4']}`);
  assert(r.avgPays === null, `avgPays should be null when no numeric column, got ${JSON.stringify(r.avgPays)}`);
});

/* ── (8) Empty workbook safety ───────────────────────────────────────── */

test('Empty workbook returns all-null result safely', () => {
  const wb = makeWb({ 'Bonus': makeSheet({ 'A1': 'header only' }) });
  const r = extractFreeSpinAwards(wb);
  assert(r.awards === null, 'awards null');
  assert(r.avgPays === null, 'avgPays null');
  assert(r.source === null, 'source null');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
