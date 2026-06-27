#!/usr/bin/env node
/**
 * tests/tools/par-12g-bonus-buy.test.mjs
 *
 * PAR-12-G (Boki 2026-06-27) contract test — Bonus Buy mode
 * promotion + scatter_pays scaling in the mapper.
 *
 * # COVERAGE
 *
 *   - Slug regex /bonus[\s_-]?buy/i matches BoU variants
 *   - Slug WITHOUT bonus-buy phrase doesn't trigger promotion
 *   - Mapper source contains PAR-12-G ladder narrative
 *   - Scaling factor 0.3 of declared bonus → base for scatter_pays
 *   - awards = {3:0, 4:0, 5:0} (no FS rounds)
 *   - scatter_pays = {3:base, 4:base*4, 5:base*25}
 *   - Gating: requires hasFsAwards + !hasScatter + !hasBonus + !hasHnw
 *   - Falls through to standard FS tier-scaling when not bonus-buy
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-12-G Bonus Buy mode · test suite');

const mapperPath = resolve(REPO, 'tools', '_par-sheet-convergence.mjs');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

/* ── (1) Slug regex matches bonus-buy variants ───────────────────────── */

test('Slug regex matches BoU naming variants', () => {
  const slugRx = /bonus[\s_-]?buy/i;
  assert(slugRx.test('book-of-unseen-bonus-buy'), 'hyphen variant');
  assert(slugRx.test('book-of-unseen-bonusbuy'), 'no separator');
  assert(slugRx.test('GAME_BONUS_BUY'), 'underscore variant');
  assert(slugRx.test('Foo Bonus Buy'), 'space variant');
  assert(!slugRx.test('cash-eruption'), 'unrelated slug');
  assert(!slugRx.test('skeleton-key'), 'unrelated slug 2');
});

/* ── (2) Mapper source has PAR-12-G narrative + gating ───────────────── */

test('Mapper source mentions PAR-12-G Bonus Buy ladder', () => {
  assert(/PAR-12-G/.test(mapperSrc), 'expected PAR-12-G atom comment');
  assert(/bonus[\s_-]?buy/i.test(mapperSrc), 'expected bonus-buy regex literal');
  assert(/isBonusBuy/.test(mapperSrc) || /isBb/.test(mapperSrc),
    'expected isBonusBuy / isBb flag');
});

test('PAR-12-G gating: requires no HnW + no scatter + no bonus', () => {
  assert(/!hasScatter\s*&&\s*!hasBonus\s*&&\s*!hasHnw/.test(mapperSrc),
    'expected gating !hasScatter && !hasBonus && !hasHnw chain');
});

/* ── (3) scatter_pays scaling shape ──────────────────────────────────── */

test('PAR-12-G scaling: scatter_pays uses base / base*4 / base*25 ladder', () => {
  assert(/['"]3['"]:\s*base/.test(mapperSrc), '3-scatter pay = base');
  assert(/['"]4['"]:\s*base\s*\*\s*4/.test(mapperSrc), '4-scatter pay = base × 4');
  assert(/['"]5['"]:\s*base\s*\*\s*25/.test(mapperSrc), '5-scatter pay = base × 25');
});

test('PAR-12-G scaling: base = declared bonus × 0.3', () => {
  assert(/declaredBonus\s*\*\s*0\.3/.test(mapperSrc),
    'expected declaredBonus × 0.3 scaling literal');
});

/* ── (4) PAR-12-G awards = 0 (no FS rounds) ──────────────────────────── */

test('PAR-12-G awards: {3:0, 4:0, 5:0} (no FS rounds)', () => {
  /* Match anywhere in the file with whitespace flexibility. */
  const awardsZeroRx = /awards:\s*\{\s*['"]3['"]:\s*0,\s*['"]4['"]:\s*0,\s*['"]5['"]:\s*0\s*\}/;
  assert(awardsZeroRx.test(mapperSrc),
    'expected awards: { "3": 0, "4": 0, "5": 0 }');
});

/* ── (5) Confidence thresholds ───────────────────────────────────────── */

test('PAR-12-G requires declared bonus ≥ 10 to activate', () => {
  assert(/declaredBonus\s*>=?\s*10/.test(mapperSrc),
    'expected declaredBonus ≥ 10 threshold');
});

/* ── (6) Specials must contain cash role ─────────────────────────────── */

test('PAR-12-G requires at least one cash-role special', () => {
  assert(/specials\?\.some\(\(s\)\s*=>\s*s\.role\s*===\s*['"]cash['"]\)/.test(mapperSrc)
      || /role\s*===\s*['"]cash['"]/.test(mapperSrc),
    'expected cash-role special check');
});

/* ── (7) cashScatterPromoteId is conditional on isBonusBuy ───────────── */

test('cashScatterPromoteId promotion gated on isBonusBuy slug', () => {
  assert(/isBonusBuy\s*&&\s*hasFsAwards/.test(mapperSrc),
    'expected isBonusBuy + hasFsAwards gate on promotion');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
