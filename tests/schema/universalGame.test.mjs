#!/usr/bin/env node
/**
 * tests/schema/universalGame.test.mjs
 *
 * MATH-DEEP HYB-1 — Universal Game Schema test suite.
 *
 * Strategy
 *   Validate (1) all 5 real GDD model.json files PASS the schema (so the
 *   parser output is contract-compliant), (2) intentionally-broken fixtures
 *   FAIL with informative errors, (3) Cash Eruption D-9..D-17 fields are
 *   recognized and not stripped by .passthrough() drift, (4) vendorExtensions
 *   namespace round-trips, (5) the convenience validateModel() returns
 *   structured result.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UniversalGameSchema,
  TopologySchema,
  FreeSpinsSchema,
  HoldAndWinSchema,
  ComplianceSchema,
  validateModel,
  SCHEMA_VERSION,
} from '../../src/schema/universalGame.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');

function assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); }
function fail(msg) { throw new Error(`FAIL: ${msg}`); }

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('HYB-1 Universal Game Schema · test suite');

/* ── (1) 5 baseline GDDs PASS the schema ──────────────────────────────── */
const BASELINE_GAMES = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];
for (const slug of BASELINE_GAMES) {
  test(`${slug} model.json passes schema`, () => {
    const p = join(REAL_GAMES, slug, 'model.json');
    if (!existsSync(p)) fail(`missing ${p} — run \`node tests/parse-real-pdfs.mjs\``);
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    const r = validateModel(obj);
    if (!r.ok) {
      const sample = r.errors.slice(0, 5).join(' | ');
      fail(`${r.errors.length} validation errors: ${sample}`);
    }
  });
}

/* ── (2) Intentional negative fixtures FAIL ───────────────────────────── */

test('topology.reels=2 fails (below industry range)', () => {
  const r = validateModel({ topology: { reels: 2, rows: 3 } });
  assert(!r.ok, 'expected schema fail for reels=2');
});

test('topology.evaluation=empty-string fails (must have content)', () => {
  /* Schema accepts any non-empty string for forward compat (new evaluators).
   * Strict closed-enum validation lives in V10 T1.2 walker rule, not here.
   * The only schema-side reject is empty/oversized. */
  const r = validateModel({ topology: { evaluation: '' } });
  assert(!r.ok, 'expected schema fail for empty evaluation string');
});

test('payback.rtp=200 fails (above 130%)', () => {
  const r = validateModel({ payback: { rtp: 200 } });
  assert(!r.ok, 'expected schema fail for rtp>130');
});

test('freeSpins.retrigger.hardCap=999 fails (above max 500)', () => {
  const r = validateModel({ freeSpins: { retrigger: { enabled: true, hardCap: 999 } } });
  assert(!r.ok, 'expected schema fail for hardCap=999');
});

test('symbols.high[0].id=empty fails (must be non-empty)', () => {
  const r = validateModel({ symbols: { high: [{ id: '', label: 'Red 7', tier: 'HP' }] } });
  assert(!r.ok, 'expected schema fail for empty symbol id');
});

test('symbols.high[0].id=whitespace fails (no whitespace allowed)', () => {
  const r = validateModel({ symbols: { high: [{ id: 'Red 7', label: 'Red 7', tier: 'HP' }] } });
  assert(!r.ok, 'expected schema fail for id with whitespace');
});

test('compliance missing code fails', () => {
  const r = validateModel({ compliance: [{ name: 'Some authority' }] });
  assert(!r.ok, 'expected schema fail for compliance entry missing code');
});

/* ── (3) Cash Eruption D-9..D-17 fields recognized ────────────────────── */

test('Cash Eruption D-9..D-17 fields recognized + round-trip', () => {
  const p = join(REAL_GAMES, 'cash-eruption-foundry-gdd/model.json');
  if (!existsSync(p)) fail('Cash Eruption model.json missing');
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  const r = validateModel(obj);
  if (!r.ok) fail(`schema fail: ${r.errors.slice(0, 3).join(' | ')}`);
  /* All declared D-9..D-17 fields present (verified by parity check). */
  assert(r.parsed.freeSpins?.retrigger?.hardCap === 15, 'D-9 hardCap');
  assert(Array.isArray(r.parsed.compliance) && r.parsed.compliance.length >= 4, 'D-10 compliance ≥ 4');
  assert(r.parsed.scatter?.payTable?.['3'] === 2, 'D-11 scatter 3=2x');
  assert(r.parsed.patternWin?.awardX === 1000, 'D-12 patternWin');
  assert(r.parsed.holdAndWin?.fsTriggerCount === 9, 'D-13 fsTrig=9');
  assert(r.parsed.jackpot?.shareWithinFeature?.GRAND > 0, 'D-14 GRAND prob');
  assert(r.parsed.freeSpins?.avgSpinsPlayed === 6.45, 'D-14 avgSpinsPlayed');
  assert(r.parsed.holdAndWin?.cashPool?.min === 100, 'D-15 cashPool min');
  assert(r.parsed.holdAndWin?.cashPool?.max === 2000, 'D-15 cashPool max');
  assert(r.parsed.expandingWild?.onlyIfWinning === true, 'D-16 wild onlyIfWinning');
  assert(r.parsed.payback?.rtpBreakdown?.baseLine === 41.9, 'D-17 rtpBreakdown baseLine');
});

/* ── (4) vendorExtensions namespace round-trips ───────────────────────── */

test('vendorExtensions namespace passes through', () => {
  const r = validateModel({
    topology: { reels: 5, rows: 3, evaluation: 'lines' },
    vendorExtensions: {
      pragmaticPayAnywhere: { enabled: true, version: 2 },
      lwMegaways: { minReels: 117_649 },
    },
  });
  assert(r.ok, `expected pass, got errors: ${r.errors.join(' | ')}`);
  assert(r.parsed.vendorExtensions?.pragmaticPayAnywhere?.enabled === true, 'pragmatic ext');
  assert(r.parsed.vendorExtensions?.lwMegaways?.minReels === 117_649, 'lw ext');
});

/* ── (5) validateModel() structured result ────────────────────────────── */

test('validateModel returns { ok, errors, parsed }', () => {
  const good = validateModel({ topology: { reels: 5, rows: 3 } });
  assert(good.ok === true && Array.isArray(good.errors) && good.parsed !== null,
    'good case should return ok=true, parsed object');
  const bad = validateModel({ topology: { reels: 999 } });
  assert(bad.ok === false && bad.errors.length > 0 && bad.parsed === null,
    'bad case should return ok=false with errors');
  assert(bad.errors[0].includes('topology.reels') || bad.errors[0].includes('reels'),
    `error path should mention topology.reels, got: ${bad.errors[0]}`);
});

/* ── (6) Schema version marker exists ─────────────────────────────────── */

test('SCHEMA_VERSION marker is semver', () => {
  assert(/^\d+\.\d+\.\d+$/.test(SCHEMA_VERSION),
    `SCHEMA_VERSION should be semver, got: ${SCHEMA_VERSION}`);
});

/* ── (7) Walk full corpus — sanity ─────────────────────────────────────── */

test('Full corpus (338 GDDs) passes schema', () => {
  if (!existsSync(REAL_GAMES)) fail('dist/real-games missing — run parse-real-pdfs.mjs');
  const slugs = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
  });
  let count = 0, failures = [];
  for (const slug of slugs) {
    const obj = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
    const r = validateModel(obj);
    if (!r.ok) {
      failures.push(`${slug}: ${r.errors[0]}`);
      if (failures.length >= 5) break;
    } else {
      count++;
    }
  }
  if (failures.length > 0) {
    fail(`${failures.length}+ corpus failures: ${failures.slice(0, 3).join(' | ')}`);
  }
  console.log(`    (validated ${count} / ${slugs.length} models)`);
});

/* ── Result ─────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
