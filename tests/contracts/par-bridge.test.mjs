#!/usr/bin/env node
/**
 * tests/contracts/par-bridge.test.mjs
 *
 * N+2 D (2026-06-23) — Contract suite for the PAR sheet auto-ingest
 * pipeline (bridge + calibrator + ingest wire).
 *
 * Coverage:
 *   1.  loadParSheet() rejects missing path (ok=false, skip=true)
 *   2.  loadParSheet() rejects directory path (ok=false)
 *   3.  loadParSheet() loads vendor-neutral CSV fixture (ok=true)
 *   4.  Vendor detection returns 'generic' for fixture (no vendor leak)
 *   5.  per_reel_weights structure: 5 reels × 9 symbols
 *   6.  paytable: 9 rows with combos {3,4,5}
 *   7.  applyParToModel() pure (input unmodified)
 *   8.  applyParToModel() stamps __par_calibrated__=true
 *   9.  applyParToModel() populates reelStrips.par_sheet_weights/paytable/source
 *  10. analyticalRtpFromPar() emits numeric RTP > 0
 *  11. calibrate() PASS when declared = oracle exactly
 *  12. calibrate() PASS when declared = oracle ± 0.04% (within band)
 *  13. calibrate() WARN when declared = oracle + 0.3% (above band, < 0.5%)
 *  14. calibrate() FAIL when declared << oracle by > 0.5%
 *  15. calibrate() NON_BINDING_LINE_EXPANSION when declared >> oracle (real-game gap)
 *  16. calibrate() NON_BINDING when no declared RTP in model
 *  17. bridgeIngest() end-to-end returns merged model + warnings
 *  18. bridgeIngest() idempotent (same input → same output)
 *  19. Anti-vendor lint: bridge output contains no banned vendor product names
 *  20. CLI: par-sheet-bridge.mjs <path> exits 0 on success
 *
 * Run: node tests/contracts/par-bridge.test.mjs
 * Exit 0 on PASS, 1 on first FAIL.
 */

import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..', '..');
const FIXTURE    = resolve(REPO, 'samples/par-fixture-generic.csv');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error(`test "${name}" returned a Promise — use async test()`);
    }
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
}
function assertNear(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) {
    throw new Error(`${msg || 'expected near'}: got ${a} expected ~${b} ± ${eps}`);
  }
}

console.log('═══ par-bridge.test.mjs ═══');
console.log('  fixture:', FIXTURE);

if (!existsSync(FIXTURE)) {
  console.error('FATAL: fixture missing — ' + FIXTURE);
  process.exit(1);
}

const { loadParSheet, applyParToModel, bridgeIngest } =
  await import(resolve(REPO, 'tools/par-sheet-bridge.mjs'));
const { calibrate, analyticalRtpFromPar, declaredRtpFromModel } =
  await import(resolve(REPO, 'tools/math-precision-calibrator.mjs'));

/* ─── tests ─────────────────────────────────────────────────────────── */

await testAsync('1. loadParSheet rejects missing path', async () => {
  const r = await loadParSheet(resolve(tmpdir(), 'definitely-not-a-real-par-' + Date.now() + '.csv'));
  assert(r.ok === false, 'expected ok=false');
  assert(r.skip === true, 'expected skip=true');
});

await testAsync('2. loadParSheet rejects directory path', async () => {
  const r = await loadParSheet(REPO);
  assert(r.ok === false, 'expected ok=false for directory');
});

let load;
await testAsync('3. loadParSheet loads CSV fixture', async () => {
  load = await loadParSheet(FIXTURE);
  assert(load.ok, `expected ok=true, got: ${JSON.stringify(load)}`);
  assert(load.parSheet, 'expected parSheet payload');
});

test('4. vendor detected as generic (no vendor leak)', () => {
  assertEq(load.vendor, 'generic', 'vendor should be generic for neutral fixture');
});

test('5. per_reel_weights: 5 reels × 9 symbols', () => {
  const w = load.parSheet.per_reel_weights;
  const reelKeys = Object.keys(w);
  assertEq(reelKeys.length, 5, 'expected 5 reels');
  for (const k of reelKeys) {
    const syms = Object.keys(w[k]);
    assertEq(syms.length, 9, `reel ${k} should have 9 symbols`);
  }
});

test('6. paytable: 9 rows with combos {3,4,5}', () => {
  const pt = load.parSheet.paytable;
  assertEq(pt.length, 9, 'expected 9 paytable rows');
  for (const row of pt) {
    assert(row.symbolId, 'row needs symbolId');
    assert(row.combos['3'], 'row needs combo 3');
    assert(row.combos['4'], 'row needs combo 4');
    assert(row.combos['5'], 'row needs combo 5');
  }
});

test('7. applyParToModel pure (input unmodified)', () => {
  const inputModel = { name: 'TestModel', rtp: { target: 96.0 } };
  const inputCopy = JSON.parse(JSON.stringify(inputModel));
  const out = applyParToModel(load.parSheet, inputModel, { vendor: 'generic', format: 'csv' });
  assertEq(JSON.stringify(inputModel), JSON.stringify(inputCopy), 'input model was mutated');
  assert(out.model !== inputModel, 'output model should be new reference');
});

test('8. applyParToModel stamps __par_calibrated__=true', () => {
  const out = applyParToModel(load.parSheet, { name: 'X' }, { vendor: 'generic', format: 'csv' });
  assertEq(out.model.__par_calibrated__, true);
});

test('9. applyParToModel populates reelStrips.par_sheet_*', () => {
  const out = applyParToModel(load.parSheet, { name: 'X' }, { vendor: 'generic', format: 'csv' });
  assert(out.model.reelStrips.par_sheet_weights, 'expected par_sheet_weights');
  assert(out.model.reelStrips.par_sheet_paytable, 'expected par_sheet_paytable');
  assert(out.model.reelStrips.par_sheet_source, 'expected par_sheet_source');
  assertEq(out.model.reelStrips.par_sheet_source.vendor, 'generic');
  assertEq(out.model.reelStrips.par_sheet_source.format, 'csv');
});

let oracleRtp;
test('10. analyticalRtpFromPar emits numeric RTP > 0', () => {
  const ana = analyticalRtpFromPar(load.parSheet);
  assert(Number.isFinite(ana.rtp), 'rtp must be finite');
  assert(ana.rtp > 0, 'rtp must be positive');
  assert(ana.rtp < 100, 'rtp must be < 100');
  oracleRtp = ana.rtp;
});

test('11. calibrate PASS when declared = oracle', () => {
  const cal = calibrate({ rtp: { target: oracleRtp } }, load.parSheet);
  assertEq(cal.verdict, 'PASS', `reason: ${cal.reason}`);
});

test('12. calibrate PASS when declared = oracle + 0.04%', () => {
  const cal = calibrate({ rtp: { target: oracleRtp + 0.04 } }, load.parSheet);
  assertEq(cal.verdict, 'PASS', `reason: ${cal.reason}`);
});

test('13. calibrate WARN when declared = oracle + 0.3%', () => {
  const cal = calibrate({ rtp: { target: oracleRtp + 0.3 } }, load.parSheet);
  assertEq(cal.verdict, 'WARN', `reason: ${cal.reason}`);
});

test('14. calibrate FAIL when declared << oracle by > 0.5%', () => {
  const cal = calibrate({ rtp: { target: oracleRtp - 1.0 } }, load.parSheet);
  assertEq(cal.verdict, 'FAIL', `reason: ${cal.reason}`);
});

test('15. calibrate NON_BINDING_LINE_EXPANSION when declared >> oracle', () => {
  /* real-game RTP (96%) far exceeds single-line oracle baseline */
  const cal = calibrate({ rtp: { target: 96.0 } }, load.parSheet);
  assertEq(cal.verdict, 'NON_BINDING_LINE_EXPANSION', `reason: ${cal.reason}`);
});

test('16. calibrate NON_BINDING when no declared RTP', () => {
  const cal = calibrate({ name: 'no-rtp' }, load.parSheet);
  assertEq(cal.verdict, 'NON_BINDING', `reason: ${cal.reason}`);
});

await testAsync('17. bridgeIngest end-to-end', async () => {
  const r = await bridgeIngest(FIXTURE, { name: 'Bridge', rtp: { target: oracleRtp } });
  assert(r.ok, `expected ok, got: ${r.reason}`);
  assert(r.model.__par_calibrated__, 'model should be calibrated');
  assertEq(r.reelCount, 5);
  assertEq(r.symbolCount, 9);
  assertEq(r.paytableRowCount, 9);
});

await testAsync('18. bridgeIngest idempotent (Pass 1 = Pass 2)', async () => {
  const r1 = await bridgeIngest(FIXTURE, { name: 'Idem', rtp: { target: oracleRtp } });
  const r2 = await bridgeIngest(FIXTURE, { name: 'Idem', rtp: { target: oracleRtp } });
  /* MED-4 audit fix: assert appliedAt is a valid ISO timestamp BEFORE
   * stripping (catches future regression where it goes undefined/NaN
   * and the strip-then-compare false-passes). */
  const t1 = r1.model.reelStrips.par_sheet_source.appliedAt;
  const t2 = r2.model.reelStrips.par_sheet_source.appliedAt;
  assert(typeof t1 === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(t1),
    'appliedAt must be ISO 8601 string, got: ' + JSON.stringify(t1));
  assert(typeof t2 === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(t2),
    'appliedAt must be ISO 8601 string, got: ' + JSON.stringify(t2));
  delete r1.model.reelStrips.par_sheet_source.appliedAt;
  delete r2.model.reelStrips.par_sheet_source.appliedAt;
  assertEq(JSON.stringify(r1.model), JSON.stringify(r2.model), 'idempotent merge required');
});

test('19. anti-vendor lint: bridge output has no banned product names', () => {
  /* Conservative: no PRODUCT names (Eldritch, Wrath, etc.). Vendor
   * routing codes (igt/pragmatic/lw) are routing metadata only and
   * allowed in source field. */
  const banned = /eldritch|woo[\s_-]?wrath|wrath[\s_-]?of[\s_-]?olympus|crystal[\s_-]?forge[\s_-]?adb/i;
  const serialized = JSON.stringify(load);
  assert(!banned.test(serialized), 'banned vendor product leaked into bridge output');
});

await testAsync('20. CLI bridge exits 0 on success', async () => {
  const cliPath = resolve(REPO, 'tools/par-sheet-bridge.mjs');
  const r = spawnSync('node', [cliPath, FIXTURE], { encoding: 'utf8', timeout: 30000 });
  assertEq(r.status, 0, `CLI exit ${r.status}, stderr: ${r.stderr || '(none)'}`);
  assert(r.stdout.includes('"ok": true'), 'CLI stdout should contain ok:true');
});

/* ─── summary ─────────────────────────────────────────────────────── */
console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
