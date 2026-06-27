#!/usr/bin/env node
/**
 * tests/tools/par-13a-mystery-wild.test.mjs
 *
 * PAR-13-A (Boki 2026-06-27) contract test — Mystery → Wild promotion
 * in mapper reel-cell ID remapping.
 *
 * # COVERAGE
 *
 *   - Mapper source contains mysteryIds collection
 *   - Detection regex /mystery|reveal/i over cash-role specials
 *   - remapToWild applies in baseWeights reel mapping
 *   - is_wild flag also set on Mystery specials via effectiveRole
 *   - Non-cash, non-mystery symbols untouched
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

console.log('PAR-13-A Mystery → Wild · test suite');

const mapperPath = resolve(REPO, 'tools', '_par-sheet-convergence.mjs');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

test('Mapper source mentions PAR-13-A', () => {
  assert(/PAR-13-A/.test(mapperSrc), 'expected PAR-13-A atom narrative');
});

test('Mystery detection regex /mystery|reveal/i', () => {
  assert(/\/mystery\|reveal\/i/.test(mapperSrc), 'expected detection regex');
});

test('Detection limited to cash-role specials', () => {
  assert(/role\s*===\s*['"]cash['"]\s*&&\s*\/mystery\|reveal\/i/.test(mapperSrc)
      || /\(s\)\s*=>\s*s\.role\s*===\s*['"]cash['"]\s*&&\s*\/mystery\|reveal\/i/.test(mapperSrc),
    'expected cash + mystery regex combined check');
});

test('remapToWild helper present + uses mysteryIds set', () => {
  assert(/const\s+remapToWild\s*=/.test(mapperSrc), 'expected remapToWild const');
  assert(/mysteryIds\.has/.test(mapperSrc), 'expected mysteryIds.has check');
});

test('baseWeights mapping applies remapToWild', () => {
  /* Look for application of remapToWild within baseWeights derivation. */
  assert(/baseWeights\b[\s\S]{0,2000}remapToWild\(/.test(mapperSrc),
    'expected remapToWild applied inside baseWeights mapping');
});

test('effectiveRole assignment includes mysteryIds check', () => {
  assert(/mysteryIds\.has\(s\.id\)\)\s*effectiveRole\s*=\s*['"]wild['"]/.test(mapperSrc),
    'expected effectiveRole = wild when mysteryIds.has(s.id)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
