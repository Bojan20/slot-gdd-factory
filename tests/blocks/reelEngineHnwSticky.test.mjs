/* eslint-disable no-console */
/**
 * tests/blocks/reelEngineHnwSticky.test.mjs
 *
 * Wave W48.bugfix — verifies the H&W sticky-cell invariant on the
 * shared `rotateStripDown(reel)` rotation helper inside reelEngine.mjs.
 *
 * Bug history (Boki 2026-06-16):
 *   "ta celija gde se nalzi taj orb ili simbol vezan za hold and win,
 *    on je sticky i ne pomenra se dok se sve ostale celije pomeraju".
 *
 * Old impl popped the bottom-most NON-locked cell but still unshifted to
 * array[0]. That displaced any locked cell sitting above the pop index
 * DOWN by one slot each tick → the orb visibly drifted across the strip.
 *
 * This test extracts the rotateStripDown body from the runtime emit and
 * runs it in a JS sandbox with fake reel.cells objects. After N rotations
 * with a cell pinned at index 2, the test asserts:
 *   • locked cell is STILL at index 2 (array)
 *   • locked cell's textContent NEVER changed (no symbol overwrite)
 *   • non-locked cells around it rotated through the strip
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };

console.log('— reelEngine H&W sticky-cell invariant —');

/* Build a fake cell. Carries .classList.contains() + .textContent +
 * .appendChild noop so the rotate helper's DOM re-append loop is a no-op. */
function _mkCell(sym, locked = false) {
  return {
    textContent: sym,
    classList: { contains: (c) => locked && c === 'is-locked-bonus' },
    _locked: locked,
  };
}

function _mkReel(cells) {
  return {
    cells: cells.slice(),
    strip: { appendChild: () => {} },
    rotationCount: 0,
  };
}

/* Extract rotateStripDown body from reelEngine.mjs source.
 * The source uses `function rotateStripDown(reel) { ... }` inside an IIFE.
 * Extract by string match — keep this brittle on purpose: if the func
 * shape changes, this test forces a re-confirmation of the invariant. */
const src = readFileSync(path.join(REPO, 'src/blocks/reelEngine.mjs'), 'utf8');
const m = src.match(/function rotateStripDown\(reel\)\s*\{([\s\S]*?)\n\s{2}\}/);
if (!m) {
  console.error('  ✗ could not extract rotateStripDown body from reelEngine.mjs');
  process.exit(1);
}
/* The body references `randomSym()` — inject a stub. */
const body = m[1].replace(/randomSym\(\)/g, '_testRandomSym()');
const rotateStripDown = new Function('reel', '_testRandomSym', body);
const randomSym = () => 'X';

/* ─── invariant tests ────────────────────────────────────────────── */

t('rotates a 5-cell reel WITHOUT any locked cell (sanity)', () => {
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), _mkCell('C'), _mkCell('D'), _mkCell('E')]);
  rotateStripDown(reel, randomSym);
  eq(reel.cells.length, 5);
  /* E (bottom) recycled to top with new symbol X. */
  eq(reel.cells[0].textContent, 'X');
  eq(reel.cells[1].textContent, 'A');
  eq(reel.cells[2].textContent, 'B');
  eq(reel.cells[3].textContent, 'C');
  eq(reel.cells[4].textContent, 'D');
});

t('locked cell at index 2 STAYS at index 2 after 1 rotation', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), locked, _mkCell('D'), _mkCell('E')]);
  rotateStripDown(reel, randomSym);
  eq(reel.cells[2], locked, 'locked moved!');
  eq(locked.textContent, '★', 'locked symbol overwritten!');
});

t('locked cell at index 2 STAYS at index 2 after 10 rotations', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), locked, _mkCell('D'), _mkCell('E')]);
  for (let i = 0; i < 10; i++) rotateStripDown(reel, randomSym);
  eq(reel.cells[2], locked);
  eq(locked.textContent, '★');
});

t('locked cell at index 0 STAYS at index 0 after 10 rotations', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([locked, _mkCell('B'), _mkCell('C'), _mkCell('D'), _mkCell('E')]);
  for (let i = 0; i < 10; i++) rotateStripDown(reel, randomSym);
  eq(reel.cells[0], locked);
});

t('locked cell at bottom (index 4) STAYS at index 4 after 10 rotations', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), _mkCell('C'), _mkCell('D'), locked]);
  for (let i = 0; i < 10; i++) rotateStripDown(reel, randomSym);
  eq(reel.cells[4], locked);
});

t('TWO locked cells (indices 1, 3) both stay pinned across 20 rotations', () => {
  const l1 = _mkCell('★', true);
  const l2 = _mkCell('◆', true);
  const reel = _mkReel([_mkCell('A'), l1, _mkCell('C'), l2, _mkCell('E')]);
  for (let i = 0; i < 20; i++) rotateStripDown(reel, randomSym);
  eq(reel.cells[1], l1);
  eq(reel.cells[3], l2);
  eq(l1.textContent, '★');
  eq(l2.textContent, '◆');
});

t('all cells locked → rotation is a no-op (still advances counter)', () => {
  const cells = [0,1,2,3,4].map(() => _mkCell('★', true));
  const reel = _mkReel(cells);
  const snapshot = reel.cells.slice();
  rotateStripDown(reel, randomSym);
  eq(reel.rotationCount, 1, 'counter did not advance');
  for (let i = 0; i < 5; i++) eq(reel.cells[i], snapshot[i], `cell ${i} moved`);
});

t('non-locked cells DO rotate around a fixed locked anchor', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), locked, _mkCell('D'), _mkCell('E')]);
  rotateStripDown(reel, randomSym);
  /* Non-locked sub-list = [A, B, D, E] → pop E, unshift to top → [E, A, B, D].
   * Reassemble with locked at idx 2 → [E, A, locked, B, D].
   * The recycled cell (was E) gets new symbol 'X'. */
  eq(reel.cells[0].textContent, 'X');
  eq(reel.cells[1].textContent, 'A');
  eq(reel.cells[2], locked);
  eq(reel.cells[3].textContent, 'B');
  eq(reel.cells[4].textContent, 'D');
});

t('determinism: 100 rotations on 5x1 with locked@2 — locked never escapes idx 2', () => {
  const locked = _mkCell('★', true);
  const reel = _mkReel([_mkCell('A'), _mkCell('B'), locked, _mkCell('D'), _mkCell('E')]);
  for (let i = 0; i < 100; i++) {
    rotateStripDown(reel, randomSym);
    if (reel.cells[2] !== locked) {
      throw new Error(`locked escaped to index ${reel.cells.indexOf(locked)} after ${i + 1} ticks`);
    }
  }
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
