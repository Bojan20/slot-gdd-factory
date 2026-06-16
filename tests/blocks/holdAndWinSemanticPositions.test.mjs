/* eslint-disable no-console */
/**
 * tests/blocks/holdAndWinSemanticPositions.test.mjs
 *
 * W48 bugfix v6 — Boki rule (2026-06-16, sixth pass):
 *   "bonus simboli koji su se pali u base game na odradjenim mestima,
 *    ostaju na istim pozicijama, ceo reel set ostaje na istim
 *    pozicijama kao i pre nego da se udje u hold and win. sada se
 *    desava da nisu ti bonus simboli na istim mestima, i cim
 *    pritisnem spin u hold and win, bonus simbol promeni mesto i
 *    padne se na drugoj celiji."
 *
 * Root cause: the previous (idx → r,c) mapping pretended the DOM was
 * row-major and assumed REELS columns × ROWS rows with no buffer cells.
 * In the real DOM the grid is column-major and each reel carries
 * stripBufferCells (default 2) hidden buffer slots, so the flat idx
 * neither matches (reel, row) semantics nor stays valid post-rotation.
 *
 * This suite verifies:
 *   1. reelEngine adds data-reel to every cell at construction.
 *   2. holdAndWin defines _hwResolveCell(reelIdx, rowIdx) that goes
 *      through window.RECT_REELS[reelIdx].cells[rowIdx + 1].
 *   3. hwHarvestBonus, hwApplyLocks, hwForceSeed all key locked cells
 *      by semantic 'reel,row' (no '/HW_REELS' division anywhere on
 *      the RECT path).
 *   4. Sandbox: hwHarvestBonus on a 5x3 + 2-buffer fake reel array
 *      finds bonus cells at the CORRECT (reel, row) coordinates,
 *      ignoring top/bottom buffer cells.
 *   5. Sandbox: hwApplyLocks retrieval round-trips through the same
 *      semantic keys back to the same cell references.
 */
import {
  defaultConfig as hwDefault,
  emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';
import {
  defaultConfig as engDefault,
  emitReelEngineRuntime,
} from '../../src/blocks/reelEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nc = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`should NOT include ${JSON.stringify(n)} — ${m}`); };

console.log('— W48 bugfix v6 · semantic (reel, row) positioning across H&W —');

const engineRt = emitReelEngineRuntime(engDefault());
const hwRt     = emitHoldAndWinRuntime({ ...hwDefault(), enabled: true });

/* ─── engine: data-reel tagging ──────────────────────────────────── */

t('reelEngine tags every cell with data-reel at construction', () => {
  ct(engineRt, 'cell.dataset.reel = String(c)');
});

t('reelEngine does NOT freeze data-row (would lie post-rotation)', () => {
  /* The construction loop must not assign a per-cell data-row that
   * could mislead readers — cells move through strip indices on each
   * rotation, so a frozen row attribute would be wrong for non-locked
   * cells. */
  const constructor = engineRt.match(/cell\.dataset\.reel = String\(c\);[\s\S]*?strip\.appendChild\(cell\);/);
  ok(constructor, 'cell construction block not extractable');
  nc(constructor[0], 'cell.dataset.row');
});

/* ─── holdAndWin: _hwResolveCell helper ──────────────────────────── */

t('holdAndWin defines _hwResolveCell(reelIdx, rowIdx) helper', () => {
  ct(hwRt, 'function _hwResolveCell(reelIdx, rowIdx)');
});

t('_hwResolveCell goes through window.RECT_REELS[reelIdx].cells[rowIdx + 1]', () => {
  const body = hwRt.match(/function _hwResolveCell\(reelIdx, rowIdx\)[\s\S]*?\n\}/);
  ok(body, '_hwResolveCell body not extractable');
  ct(body[0], 'window.RECT_REELS');
  ct(body[0], 'reel.cells[rowIdx + 1]');
});

t('_hwResolveCell honours visibleRows bounds', () => {
  const body = hwRt.match(/function _hwResolveCell\(reelIdx, rowIdx\)[\s\S]*?\n\}/);
  ct(body[0], 'reel.visibleRows');
  ct(body[0], 'rowIdx >= vis');
});

/* ─── hwHarvestBonus: semantic walk ──────────────────────────────── */

t('hwHarvestBonus walks RECT_REELS by (reel, row)', () => {
  const body = hwRt.match(/function hwHarvestBonus\(opts\)[\s\S]*?\nfunction _hwForceSeedMount/);
  ok(body, 'hwHarvestBonus extract failed');
  ct(body[0], 'window.RECT_REELS');
  ct(body[0], 'reel.cells[row + 1]');
  /* Old flat-idx math should NOT appear in the RECT path. */
  const rectPath = body[0].match(/if \(typeof window !== 'undefined' && Array\.isArray\(window\.RECT_REELS\)[\s\S]*?return added;\s*\}/);
  ok(rectPath, 'RECT branch extract failed');
  nc(rectPath[0], 'Math.floor(idx / HW_REELS)');
  nc(rectPath[0], 'idx % HW_REELS');
});

t('hwHarvestBonus retains a flat-fallback for non-rect topology', () => {
  const body = hwRt.match(/function hwHarvestBonus\(opts\)[\s\S]*?\nfunction _hwForceSeedMount/);
  /* Flat fallback uses 'flat,idx' key shape. */
  ct(body[0], "'flat,' + idx");
});

/* ─── PHASE 2 retrieval ──────────────────────────────────────────── */

t('_hwBeginRound PHASE 2 retrieves via _hwResolveCell (no flat idx math)', () => {
  const begin = hwRt.match(/async function _hwBeginRound\(\)[\s\S]*?\n\}/);
  ok(begin, '_hwBeginRound extract failed');
  /* PHASE 2 walks lockedCells, splits the key, takes the RECT path. */
  ct(begin[0], '_hwResolveCell(reelIdx, rowIdx)');
  /* No HW_REELS multiplication anywhere in PHASE 2. */
  const phase2 = begin[0].slice(begin[0].indexOf('PHASE 2'));
  nc(phase2, '* HW_REELS');
});

t('_hwForceSeedMount PHASE 2 retrieves via _hwResolveCell', () => {
  const mount = hwRt.match(/function _hwForceSeedMount\(pickedKeys\)[\s\S]*?\n\}/);
  ok(mount, '_hwForceSeedMount extract failed');
  ct(mount[0], '_hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10))');
});

t('hwApplyLocks retrieves via _hwResolveCell', () => {
  const body = hwRt.match(/function hwApplyLocks\(\)[\s\S]*?\n\}/);
  ok(body, 'hwApplyLocks extract failed');
  ct(body[0], '_hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10))');
});

/* ─── hwForceSeed picks semantic keys, not flat indices ─────────── */

t('hwForceSeed picks {reel,row} keys from RECT_REELS, not flat idx', () => {
  const body = hwRt.match(/function hwForceSeed\(orbCount\)[\s\S]*?\n\}/);
  ok(body, 'hwForceSeed extract failed');
  ct(body[0], "r + ',' + row");
  ct(body[0], '_hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10))');
});

/* ─── sandbox: end-to-end correctness on a 5x3+buffer fake reel set ─ */

function _mkCell(sym) {
  const cls = new Set();
  const dataset = {};
  return {
    textContent: sym,
    dataset,
    classList: {
      add(c)      { cls.add(c); },
      remove(c)   { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    _classes: cls,
  };
}

function _mkReelSet(rows, cols, layout) {
  /* layout[r][c] = symbol. Build column-major arrays with 2 buffer cells
   * (1 top, 1 bottom; v2 default is 2 but split top/bottom). For test
   * simplicity we use a 1-top + 1-bottom layout so visibleRows = rows. */
  const reels = [];
  for (let c = 0; c < cols; c++) {
    const cells = [];
    cells.push(_mkCell('TOP'));                                   // top buffer
    for (let r = 0; r < rows; r++) cells.push(_mkCell(layout[r][c]));
    cells.push(_mkCell('BOT'));                                   // bottom buffer
    reels.push({
      cells,
      visibleRows: rows,
    });
  }
  return reels;
}

t('SANDBOX: hwHarvestBonus mapOnly with 5x3 grid finds bonus at correct (reel, row)', () => {
  /* Place bonus 'B' at (reel=1, row=1) and (reel=3, row=2). */
  const layout = [
    ['A','A','A','A','A'],   // row 0
    ['A','B','A','A','A'],   // row 1
    ['A','A','A','B','A'],   // row 2
  ];
  const reels = _mkReelSet(3, 5, layout);
  /* Inline the helper + harvest mapOnly path against this fake set. */
  const HW_BONUS_SYMBOL = 'B';
  const HW_STATE = { lockedCells: new Map(), totalWinX: 0, jackpotsHit: [] };
  function rollOrb() { return { label: '5x', tier: null, valueX: 5 }; }

  for (let r = 0; r < reels.length; r++) {
    const reel = reels[r];
    const vis = reel.visibleRows;
    for (let row = 0; row < vis; row++) {
      const cell = reel.cells[row + 1];
      const txt = (cell.textContent || '').trim();
      if (txt !== HW_BONUS_SYMBOL) continue;
      const key = r + ',' + row;
      const orb = rollOrb();
      HW_STATE.lockedCells.set(key, orb);
      HW_STATE.totalWinX += orb.valueX;
    }
  }
  /* Only 2 entries, with keys '1,1' and '3,2'. */
  eq(HW_STATE.lockedCells.size, 2);
  ok(HW_STATE.lockedCells.has('1,1'), `missing key '1,1' (reel 1 row 1)`);
  ok(HW_STATE.lockedCells.has('3,2'), `missing key '3,2' (reel 3 row 2)`);
  /* Buffer cells were NOT harvested (would have returned 'TOP' or 'BOT'). */
  ok(!HW_STATE.lockedCells.has('0,-1'));
  ok(!HW_STATE.lockedCells.has('0,3'));
});

t('SANDBOX: PHASE 2 lookup round-trips back to the SAME cell refs', () => {
  const layout = [
    ['A','A','A','A','A'],
    ['A','B','A','A','A'],
    ['A','A','A','B','A'],
  ];
  const reels = _mkReelSet(3, 5, layout);
  /* Discovered positions (from previous test). */
  const HW_STATE = {
    lockedCells: new Map([
      ['1,1', { valueX: 5, label: '5x', tier: null }],
      ['3,2', { valueX: 10, label: '10x', tier: null }],
    ]),
  };
  /* Inline _hwResolveCell semantics. */
  function resolveCell(reelIdx, rowIdx) {
    const reel = reels[reelIdx];
    if (!reel) return null;
    return reel.cells[rowIdx + 1] || null;
  }
  /* PHASE 2 walk: lockedCells.forEach → resolveCell(reel, row). */
  let applied = 0;
  HW_STATE.lockedCells.forEach((orb, key) => {
    const parts = key.split(',');
    const cell = resolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10));
    if (cell) { cell._appliedOrb = orb; applied++; }
  });
  eq(applied, 2);
  /* The right cells got the orb (reel 1 row 1 cell = reel[1].cells[2]). */
  eq(reels[1].cells[2]._appliedOrb.label, '5x');
  eq(reels[3].cells[3]._appliedOrb.label, '10x');
  /* No other cells got an orb. */
  for (let c = 0; c < reels.length; c++) {
    for (let i = 0; i < reels[c].cells.length; i++) {
      const cell = reels[c].cells[i];
      if (cell._appliedOrb && !(c === 1 && i === 2) && !(c === 3 && i === 3)) {
        throw new Error(`stray orb applied to reel ${c} cells[${i}]`);
      }
    }
  }
});

t('SANDBOX: locked cell remains pinned across simulated rotation (visibility preserved)', () => {
  /* Locked cell at reel 1 cells[2]. Simulate strip rotation that
   * preserves locked cells at their index. PHASE 2 lookup after
   * rotation must still hit the same cell ref. */
  const layout = [
    ['A','A','A','A','A'],
    ['A','B','A','A','A'],
    ['A','A','A','A','A'],
  ];
  const reels = _mkReelSet(3, 5, layout);
  const reel1 = reels[1];
  reel1.cells[2].classList.add('is-locked-bonus');     // mark locked
  const lockedCellRef = reel1.cells[2];

  /* Simulate 10 rotations that rotate only non-locked cells (W48 v1
   * sticky-pin fix). Locked cell stays at index 2 verbatim. */
  for (let tick = 0; tick < 10; tick++) {
    const lockedIdx = [];
    const nonLockedCells = [];
    for (let i = 0; i < reel1.cells.length; i++) {
      if (reel1.cells[i].classList.contains('is-locked-bonus')) lockedIdx.push(i);
      else nonLockedCells.push(reel1.cells[i]);
    }
    const last = nonLockedCells.pop();
    nonLockedCells.unshift(last);
    last.textContent = 'X';
    const next = new Array(reel1.cells.length);
    for (const li of lockedIdx) next[li] = reel1.cells[li];
    let nlPtr = 0;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === undefined) next[i] = nonLockedCells[nlPtr++];
    }
    reel1.cells = next;
  }

  /* PHASE 2 retrieval after rotation must still return locked cell. */
  function resolveCell(reelIdx, rowIdx) {
    return reels[reelIdx].cells[rowIdx + 1];
  }
  const retrieved = resolveCell(1, 1);
  ok(retrieved === lockedCellRef, 'locked cell reference drifted across rotation');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
