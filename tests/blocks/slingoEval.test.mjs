#!/usr/bin/env node
/**
 * tests/blocks/slingoEval.test.mjs
 *
 * MATH-DEEP D+3 (2026-06-23) — slingo evaluator contract.
 *
 * Coverage
 *   1. updateSlingoMarks marks only matching unmarked cells
 *   2. countCompletedLines correctly tallies rows/cols/diagonals
 *   3. evalSlingo returns 0 for non-slingo topology (graceful gate)
 *   4. evalSlingo pays line_1 when one row newly completed
 *   5. evalSlingo pays full_house bonus when grid fully marked
 *   6. buildSlingoGrid + rollSlingoReveals deterministic via seeded RNG
 *   7. _selfTest passes
 */

import {
  evalSlingo,
  updateSlingoMarks,
  countCompletedLines,
  buildSlingoGrid,
  rollSlingoReveals,
  _selfTest,
} from '../../src/blocks/featureSimPlugins/slingoEval.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n    ' + detail : '')); }
}

console.log('\n=== slingoEval ===\n');

/* (1) updateSlingoMarks */
const g1 = [
  [{ id: 'A', marked: false }, { id: 'B', marked: false }, { id: 'C', marked: false }],
  [{ id: 'A', marked: false }, { id: 'C', marked: false }, { id: 'D', marked: false }],
  [{ id: 'E', marked: false }, { id: 'A', marked: false }, { id: 'B', marked: false }],
];
const newly = updateSlingoMarks(g1, ['A', 'C']);
t('updateSlingoMarks: A and C cells marked', newly.length === 5, `got ${newly.length}`);
t('updateSlingoMarks: D not marked', g1[1][2].marked === false);
t('updateSlingoMarks: idempotent on repeat call',
  updateSlingoMarks(g1, ['A', 'C']).length === 0);

/* (2) countCompletedLines */
const g2 = [
  [{ marked: true }, { marked: true }, { marked: true }],
  [{ marked: false }, { marked: true }, { marked: false }],
  [{ marked: true }, { marked: true }, { marked: true }],
];
const counts = countCompletedLines(g2);
t('countCompletedLines: 2 complete rows', counts.rows === 2, `got ${counts.rows}`);
t('countCompletedLines: 1 complete col (middle)', counts.cols === 1, `got ${counts.cols}`);
t('countCompletedLines: 2 complete diagonals', counts.diags === 2, `got ${counts.diags}`);
t('countCompletedLines: not allMarked', counts.allMarked === false);

/* (3) Non-slingo topology gate */
const noPayLine = evalSlingo(g2, { linesAddedThisSpin: 1 },
  { topology: { kind: 'lines' } });
t('evalSlingo: line topology returns 0 pay', noPayLine.totalPay === 0 && noPayLine.fired === false);

/* (4) Pay line_1 */
const pay1 = evalSlingo(g2, { linesAddedThisSpin: 1 },
  { topology: { kind: 'slingo' } });
t('evalSlingo: 1 line added → line_1 pay > 0', pay1.totalPay > 0 && pay1.fired === true);

/* (5) Full house */
const gFull = [
  [{ marked: true }, { marked: true }],
  [{ marked: true }, { marked: true }],
];
const payFull = evalSlingo(gFull, { linesAddedThisSpin: 0 },
  { topology: { kind: 'slingo' } });
t('evalSlingo: full house → pays full_house bonus',
  payFull.patterns.some(p => p.kind === 'full_house'));

/* (6) buildSlingoGrid + rollSlingoReveals determinism */
function seeded(seed) { let a = seed; return () => { a = (a * 9301 + 49297) % 233280; return a / 233280; }; }
const rng1 = seeded(7);
const rng2 = seeded(7);
const grid1 = buildSlingoGrid(5, 20, rng1);
const grid2 = buildSlingoGrid(5, 20, rng2);
const allSame = grid1.every((row, r) => row.every((c, ci) => c.id === grid2[r][ci].id));
t('buildSlingoGrid: deterministic via seeded RNG', allSame);

const rev1 = rollSlingoReveals(5, 20, seeded(11));
const rev2 = rollSlingoReveals(5, 20, seeded(11));
t('rollSlingoReveals: deterministic via seeded RNG',
  rev1.length === 5 && rev1.every((s, i) => s === rev2[i]));

/* (7) _selfTest */
try {
  _selfTest();
  t('_selfTest passes', true);
} catch (e) {
  t('_selfTest passes', false, e.message);
}

console.log(`\nResult: ${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
