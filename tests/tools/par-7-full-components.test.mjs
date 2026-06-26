#!/usr/bin/env node
/**
 * tests/tools/par-7-full-components.test.mjs
 *
 * PAR-7-FULL (Boki 2026-06-26) contract test — RTP component extractor.
 *
 * # COVERAGE
 *
 *   - NARROW match: "Base RTP" / "Free Spins RTP" / "Total RTP" (CE/FK/SK style)
 *   - SUM match: "Base Game multiway RTP" + "Base Game scatter RTP" → baseGame sum (FCB style)
 *   - PER-SHEET boundary: 4 identical variant sheets don't 4× inflate sums
 *   - SECTION-AWARE: column-A "BASE GAME" header + "Line Pay %" → baseGame (BoU style)
 *   - BONUS-PAY routing: "Bonus Pay %" routes to 'bonus' regardless of section
 *   - Fractional values <1.5 are rescaled to percent
 *   - Out-of-range values (negative, >130) are rejected
 *
 * # WHY A CONTRACT TEST
 *
 * extractRtpComponents drives the convergence verdict ladder. When it
 * returns baseGame: null, PAR-5 falls back to comparing measured against
 * TOTAL declared RTP (which includes FS contribution the kernel can't
 * model) — verdict drops from WARN to FAIL. A regression here silently
 * downgrades 2/5 par-sheet games from WARN to FAIL. Pin the contract.
 */

import { extractRtpComponents } from '../../tools/_par-sheet-to-model.mjs';

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

console.log('PAR-7-FULL Component extractor · test suite');

/* ── helpers to build a fake xlsx workbook (SheetJS shape) ───────────── */

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
  return { SheetNames: Object.keys(sheets), Sheets: sheets };
}

/* ── (1) Narrow match — exact field names ────────────────────────────── */

test('NARROW: "Base RTP" + "Free Spins RTP" + "Total RTP" map cleanly', () => {
  const ws = makeSheet({
    'A1': 'Total RTP', 'B1': 96.5,
    'A2': 'Base RTP', 'B2': 41.9,
    'A3': 'Free Spins RTP', 'B3': 7.0,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.total - 96.5) < 1e-6, `total mismatch: ${r.total}`);
  assert(Math.abs(r.baseGame - 41.9) < 1e-6, `baseGame mismatch: ${r.baseGame}`);
  assert(Math.abs(r.freeSpins - 7.0) < 1e-6, `freeSpins mismatch: ${r.freeSpins}`);
});

/* ── (2) Sum match — multi-component sub-fields accumulate ───────────── */

test('SUM: "Base Game multiway/scatter/coins/jackpot RTP" accumulate to baseGame', () => {
  const ws = makeSheet({
    'I54': 'Base Game multiway RTP', 'J54': 50.0,
    'I55': 'Base Game scatter RTP', 'J55': 15.0,
    'I56': 'Base Game Coins credit RTP', 'J56': 10.0,
    'I57': 'Base Game Jackpot RTP', 'J57': 6.5,
    'I58': 'Free Spins multiway RTP', 'J58': 10.0,
    'I59': 'Free Spins scatter RTP', 'J59': 3.5,
    'I62': 'Total RTP', 'J62': 95.0,
  });
  const wb = makeWb({ 'par_001': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.baseGame - 81.5) < 1e-6, `baseGame sum expected 81.5, got ${r.baseGame}`);
  assert(Math.abs(r.freeSpins - 13.5) < 1e-6, `freeSpins sum expected 13.5, got ${r.freeSpins}`);
  assert(Math.abs(r.total - 95.0) < 1e-6, `total expected 95.0, got ${r.total}`);
});

/* ── (3) Per-sheet boundary — N variant sheets don't N× inflate ──────── */

test('PER-SHEET: sum stays anchored to first hit sheet, later variants skip', () => {
  const subFields = {
    'I54': 'Base Game multiway RTP', 'J54': 50.0,
    'I55': 'Base Game scatter RTP', 'J55': 15.0,
  };
  const wb = makeWb({
    'par_001': makeSheet(subFields),
    'par_002': makeSheet(subFields),
    'par_003': makeSheet(subFields),
    'par_004': makeSheet(subFields),
  });
  const r = extractRtpComponents(wb);
  /* Without per-sheet boundary, baseGame would be (50+15) × 4 = 260.
   * With boundary, only par_001 contributes the sum → 65. */
  assert(Math.abs(r.baseGame - 65.0) < 1e-6, `baseGame expected 65 (single-sheet sum), got ${r.baseGame}`);
});

/* ── (4) Section-aware — BASE GAME + Line Pay % → baseGame ───────────── */

test('SECTION: column-A "BASE GAME" + "Line Pay %" → baseGame', () => {
  const ws = makeSheet({
    'A6': 'BASE GAME',
    'H63': 'Line Pay %', 'I63': 0.008,  /* 0.80 % as fraction */
    'H65': 'Bonus Pay %', 'I65': 89.3,
    'A98': 'BONUS GAME',
    'H100': 'Line Pay %', 'I100': 7.28,
  });
  const wb = makeWb({ 'PAR_001': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.baseGame - 0.8) < 1e-6, `baseGame expected 0.80, got ${r.baseGame}`);
  assert(Math.abs(r.freeSpins - 7.28) < 1e-6, `freeSpins (BONUS GAME) expected 7.28, got ${r.freeSpins}`);
  assert(Math.abs(r.bonus - 89.3) < 1e-6, `bonus expected 89.3, got ${r.bonus}`);
});

/* ── (5) Bonus Pay % routes to bonus regardless of section ───────────── */

test('BONUS-PAY: "Bonus Pay %" always routes to bonus field', () => {
  const ws = makeSheet({
    'A1': 'BASE GAME',
    'B3': 'Bonus Pay %', 'C3': 12.0,
  });
  const wb = makeWb({ 'PAR': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.bonus - 12.0) < 1e-6, `bonus expected 12.0, got ${r.bonus}`);
  assert(r.baseGame === null, `baseGame should be null, got ${r.baseGame}`);
});

/* ── (6) Fractional values <1.5 rescaled to percent ──────────────────── */

test('Fractional values (< 1.5) rescale to percent', () => {
  const ws = makeSheet({
    'A1': 'Base RTP', 'B1': 0.419,  /* fraction */
    'A2': 'Total RTP', 'B2': 0.96,
  });
  const wb = makeWb({ 'PAR': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.baseGame - 41.9) < 1e-6, `baseGame fractional rescale: ${r.baseGame}`);
  assert(Math.abs(r.total - 96.0) < 1e-6, `total fractional rescale: ${r.total}`);
});

/* ── (7) Out-of-range values rejected ────────────────────────────────── */

test('Out-of-range values (<0, >130) are rejected', () => {
  const ws = makeSheet({
    'A1': 'Base RTP', 'B1': 500.0,
    'A2': 'Total RTP', 'B2': -5.0,
    'A3': 'Free Spins RTP', 'B3': 75.0,  /* valid */
  });
  const wb = makeWb({ 'PAR': ws });
  const r = extractRtpComponents(wb);
  assert(r.baseGame === null, `baseGame out-of-range should be null, got ${r.baseGame}`);
  assert(r.total === null, `total negative should be null, got ${r.total}`);
  assert(Math.abs(r.freeSpins - 75.0) < 1e-6, `freeSpins valid expected 75.0, got ${r.freeSpins}`);
});

/* ── (8) Empty workbook returns all-null result ──────────────────────── */

test('Empty workbook returns all-null result safely', () => {
  const wb = makeWb({ 'sheet1': makeSheet({ 'A1': 'unrelated text' }) });
  const r = extractRtpComponents(wb);
  assert(r.total === null, 'total null');
  assert(r.baseGame === null, 'baseGame null');
  assert(r.freeSpins === null, 'freeSpins null');
  assert(r.holdAndWin === null, 'holdAndWin null');
  assert(r.bonus === null, 'bonus null');
});

/* ── (9) Narrow + Sum on same field: narrow wins (first-hit-wins) ────── */

test('Narrow + Sum interleaved: narrow first hit takes the field exclusively', () => {
  const ws = makeSheet({
    /* Narrow match first */
    'A1': 'Base RTP', 'B1': 41.9,
    /* Sum match later — should NOT add because narrow already claimed
     * the field (isSum=false anchors first-hit-wins semantics). */
    'A5': 'Base Game multiway RTP', 'B5': 50.0,
    'A6': 'Base Game scatter RTP', 'B6': 15.0,
  });
  const wb = makeWb({ 'PAR': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.baseGame - 41.9) < 1e-6, `baseGame should stay at narrow 41.9, got ${r.baseGame}`);
});

/* ── (10) Sources tagging ────────────────────────────────────────────── */

test('Sources field tags each populated field with sheet!cell', () => {
  const ws = makeSheet({
    'A1': 'Base RTP', 'B1': 41.9,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractRtpComponents(wb);
  assert(r.sources.baseGame && /PAR-001!B1/.test(r.sources.baseGame),
    `baseGame source expected PAR-001!B1, got ${r.sources.baseGame}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
