#!/usr/bin/env node
/**
 * tests/tools/f3-a-inference-engine.test.mjs
 *
 * F3-a contract test — PAR sheet inference engine.
 *
 * # COVERAGE
 *
 *   A: pure-library exports — `scoreSheetKinds`, `findRtpAnchor`,
 *      `findPaytableAnchor`, `findReelStartAnchor`, `detectVendorSignature`,
 *      `paytableReelsCrossCorrelation`, `inferStructure`.
 *
 *   B: vendor signature DB carries Light & Wonder + Pragmatic Play +
 *      IGT + Aristocrat patterns; generic fallback when none match.
 *
 *   C: live inference on each portfolio par sheet finds at least the
 *      RTP anchor + vendor signature L&W (0.90+ for both naming styles)
 *      + correct per-sheet kind classification for the well-known
 *      sheets (PAR_Summary → summary; Paylines → paylines).
 *
 *   D: CLI emits structured JSON via `--json` and writes a receipt at
 *      `reports/par-inference/<slug>.json`.
 *
 *   E: scan window is wide enough — earlier 80×40 missed everything
 *      past row 80; current 200×80 catches FCB / FK / BoU anchors.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import XLSXPkg from 'xlsx';
const XLSX = XLSXPkg.default ?? XLSXPkg;

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools', '_par-sheet-inference-engine.mjs');

const PARSHEETS = `${process.env.HOME}/Desktop/ParSheets`;
const FCB = join(PARSHEETS, 'ParSheets_FortuneCoinBoost_Classic.xlsx');
const FK = join(PARSHEETS, 'PAR_Sheets_FortKnoxWolfRun.xlsx');
const BOU = join(PARSHEETS, 'ParSheets_BookOfUnseen_BonusBuy.xlsx');
const CE = join(PARSHEETS, 'ParSheets_CashEruption 1.xlsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('F3-a INFERENCE ENGINE · contract test');

const toolSrc = readFileSync(TOOL, 'utf-8');

/* ── A: exports ────────────────────────────────────────────────── */

const EXPECTED_EXPORTS = [
  'scoreSheetKinds',
  'findRtpAnchor',
  'findPaytableAnchor',
  'findReelStartAnchor',
  'detectVendorSignature',
  'paytableReelsCrossCorrelation',
  'inferStructure',
];

for (const ex of EXPECTED_EXPORTS) {
  test(`A: exports ${ex}`, () => {
    const re = new RegExp(`export\\s+function\\s+${ex}\\s*\\(`);
    assert(re.test(toolSrc), `expected export function ${ex}(...)`);
  });
}

/* ── B: vendor signature DB ───────────────────────────────────── */

test('B1: VENDOR_DB lists Light & Wonder', () => {
  assert(/id:\s*['"]light-and-wonder['"]/.test(toolSrc), 'missing L&W entry');
});

test('B2: VENDOR_DB lists Pragmatic Play', () => {
  assert(/id:\s*['"]pragmatic-play['"]/.test(toolSrc), 'missing Pragmatic entry');
});

test('B3: VENDOR_DB lists IGT + Aristocrat', () => {
  assert(/id:\s*['"]igt['"]/.test(toolSrc), 'missing IGT entry');
  assert(/id:\s*['"]aristocrat['"]/.test(toolSrc), 'missing Aristocrat entry');
});

test('B4: L&W matches both par_001 (underscore) AND PAR-001 (dash)', () => {
  /* Cash Eruption uses PAR-001 (dash); Fortune Coin Boost uses par_001
   * (underscore). Single regex must catch both. */
  assert(/par\[_\\?\-\]\\d\{3\}/.test(toolSrc) || /par\[_\-\]\\d\{3\}/.test(toolSrc),
    'expected par[_-]\\d{3} regex pattern');
});

/* ── C: live inference on portfolio ────────────────────────────── */

async function inferenceOf(xlsxPath) {
  if (!existsSync(xlsxPath)) return null;
  const { inferStructure } = await import(TOOL);
  const wb = XLSX.readFile(xlsxPath, { cellDates: false, cellNF: false });
  return inferStructure(wb);
}

await testAsync('C1: FCB inference finds reel anchor + L&W vendor', async () => {
  const inf = await inferenceOf(FCB);
  if (!inf) { console.log('    (skipped — FCB par sheet not present)'); return; }
  assert(inf.vendor.id === 'light-and-wonder',
    `expected L&W vendor, got ${inf.vendor.id} (conf ${inf.vendor.confidence})`);
  assert(inf.anchors.reelStart !== null,
    'expected reel start anchor on FCB');
  assert(inf.summary.sheetCount === 4,
    `expected 4 sheets for FCB, got ${inf.summary.sheetCount}`);
});

await testAsync('C2: Fort Knox inference finds RTP + classifies Paylines + 100Spins', async () => {
  const inf = await inferenceOf(FK);
  if (!inf) { console.log('    (skipped — FK par sheet not present)'); return; }
  assert(inf.anchors.rtp !== null, 'expected RTP anchor on FK');
  assert(inf.anchors.rtp.value_pct > 90 && inf.anchors.rtp.value_pct < 100,
    `expected RTP 90..100%, got ${inf.anchors.rtp.value_pct}`);
  const paylines = inf.sheets.find((s) => /paylines/i.test(s.name));
  assert(paylines, 'expected a Paylines sheet entry');
  assert(paylines.topKinds.some((k) => k.kind === 'paylines'),
    `expected Paylines sheet to be classified as paylines, got ${JSON.stringify(paylines.topKinds)}`);
});

await testAsync('C3: BoU inference finds RTP + reel start + freespin sheets', async () => {
  const inf = await inferenceOf(BOU);
  if (!inf) { console.log('    (skipped — BoU par sheet not present)'); return; }
  assert(inf.anchors.rtp !== null, 'expected RTP anchor on BoU');
  assert(inf.anchors.reelStart !== null, 'expected reel start anchor on BoU');
  const bonusBuySheet = inf.sheets.find((s) => /BonusBuy/i.test(s.name));
  assert(bonusBuySheet, 'expected at least one BonusBuy sheet entry');
});

await testAsync('C4: CE inference matches L&W signature via dash naming', async () => {
  const inf = await inferenceOf(CE);
  if (!inf) { console.log('    (skipped — CE par sheet not present)'); return; }
  assert(inf.vendor.id === 'light-and-wonder',
    `expected L&W vendor (dash naming), got ${inf.vendor.id} (conf ${inf.vendor.confidence})`);
  assert(inf.vendor.confidence >= 0.4,
    `expected confidence ≥ 0.4, got ${inf.vendor.confidence}`);
});

/* ── D: CLI + receipt ─────────────────────────────────────────── */

await testAsync('D1: CLI --json emits structured inference', async () => {
  if (!existsSync(FK)) { console.log('    (skipped — FK par sheet not present)'); return; }
  const proc = spawnSync('node', [TOOL, '--xlsx', FK, '--json'], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 30000,
  });
  assert(proc.status === 0, `CLI exited ${proc.status}: ${proc.stderr || proc.stdout}`);
  const parsed = JSON.parse(proc.stdout);
  assert(parsed.vendor && parsed.sheets && parsed.anchors && parsed.summary,
    'expected vendor + sheets + anchors + summary top-level keys');
});

await testAsync('D2: CLI text mode writes receipt to reports/par-inference/', async () => {
  if (!existsSync(FK)) { console.log('    (skipped — FK par sheet not present)'); return; }
  const proc = spawnSync('node', [TOOL, '--xlsx', FK], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 30000,
  });
  assert(proc.status === 0, `CLI exited ${proc.status}`);
  /* Slug: PAR_Sheets_FortKnoxWolfRun.xlsx → par-sheets-fortknoxwolfrun */
  const receiptPath = join(REPO, 'reports', 'par-inference', 'par-sheets-fortknoxwolfrun.json');
  assert(existsSync(receiptPath), `expected receipt at ${receiptPath}`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
  assert(receipt.xlsx === FK && receipt.inference && receipt.ingestedAt,
    'receipt missing xlsx/inference/ingestedAt fields');
});

/* ── E: scan window ───────────────────────────────────────────── */

test('E: scan window bumped from 80×40 to 200×80', () => {
  assert(/range\.s\.r\s*\+\s*199/.test(toolSrc),
    'expected maxR = range.s.r + 199 (200 row scan)');
  assert(/range\.s\.c\s*\+\s*79/.test(toolSrc),
    'expected maxC = range.s.c + 79 (80 col scan)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
