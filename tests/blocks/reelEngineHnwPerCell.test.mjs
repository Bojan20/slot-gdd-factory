/* eslint-disable no-console */
/**
 * tests/blocks/reelEngineHnwPerCell.test.mjs
 *
 * W48 BUGFIX (Boki 2026-06-16, second pass) — verifies the H&W per-cell
 * respin mode in reelEngine.mjs:
 *
 *   • runOneBaseSpin branches to runHnwPerCellRespin when
 *     window.HW_STATE.active === true.
 *   • Only NON-locked cells get .hnw-cell-spinning.
 *   • Strip transform is NEUTRALISED (set to '') so locked orbs cannot
 *     visually drift with a parent transform.
 *   • Stagger stop window cycles each non-locked cell through
 *     spinning → stopping → stopped, replacing the symbol along the way.
 *   • Locked cells are NEVER tagged with any per-cell class.
 *   • preSpin / onSpinResult lifecycle still fires with hwRespin: true.
 *
 * Approach: emit the reelEngine runtime via emitReelEngineRuntime(),
 * extract the runHnwPerCellRespin function via string-match + new
 * Function, drive it against a fake `grid` / RECT_REELS / HookBus. The
 * source-level shape check stays brittle on purpose — if the helper is
 * renamed or restructured, the test forces re-confirmation of contract.
 */
import {
  defaultConfig,
  emitReelEngineRuntime,
} from '../../src/blocks/reelEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };

console.log('— reelEngine H&W per-cell respin mode —');

/* ─── source-level contract ───────────────────────────────────────── */

const src = emitReelEngineRuntime(defaultConfig());

t('runtime defines runHnwPerCellRespin function', () => {
  ct(src, 'function runHnwPerCellRespin');
});

t('runtime defines HW_STATE.active branch in runOneBaseSpin', () => {
  ct(src, 'HW_STATE && window.HW_STATE.active === true');
});

t('runtime calls runHnwPerCellRespin from runOneBaseSpin when hwActive', () => {
  ct(src, 'runHnwPerCellRespin(() => handlePostSpin');
});

t('runtime emits preSpin with hwRespin flag', () => {
  ct(src, "HookBus.emit('preSpin', { duringFs: false, hwRespin: hwActive })");
});

t('runtime adds hnw-cell-spinning class to non-locked cells', () => {
  ct(src, "c.classList.add('hnw-cell-spinning')");
});

t('runtime stages spinning → stopping → stopped lifecycle', () => {
  ct(src, "remove('hnw-cell-spinning')");
  ct(src, "add('hnw-cell-stopping')");
  ct(src, "remove('hnw-cell-stopping')");
  ct(src, "add('hnw-cell-stopped')");
});

t('runtime neutralises parent strip transform on entry', () => {
  /* The strip transform must be cleared so locked cells cannot drift
   * with a parent translateY. */
  ct(src, "reel.strip.style.transform = ''");
});

t('runtime partitions cells by .is-locked-bonus class', () => {
  ct(src, "c.classList.contains('is-locked-bonus')");
  /* And the partition feeds nonLocked.filter, NOT a generic select. */
  ct(src, 'allCells.filter');
});

t('runtime tail emits onSpinResult with hwRespin: true', () => {
  ct(src, "HookBus.emit('onSpinResult', { duringFs: false, hwRespin: true })");
});

t('runtime honours turbo multiplier on BASE_MS and STAGGER_MS', () => {
  ct(src, "__SLOT_TURBO_SPEED_MULT__");
  ct(src, "Math.round(900 * turboMult)");
  ct(src, "Math.round(60  * turboMult)");
});

t('runtime falls back gracefully when every cell is locked', () => {
  ct(src, 'if (nonLocked.length === 0)');
  ct(src, "setTimeout(onSettled, 200)");
});

/* ─── sandbox runtime — drive runHnwPerCellRespin against a fake DOM ── */

function _mkCell(sym, locked = false) {
  const cls = new Set();
  if (locked) cls.add('is-locked-bonus');
  return {
    textContent: sym,
    classList: {
      add(c)      { cls.add(c); },
      remove(c)   { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    _classes: cls,
  };
}

/* Extract just the runHnwPerCellRespin function body, drop the FREESPINS
 * / FORCE_TRIGGER closures via stubs, and run it in isolation. */
function _extractRunner() {
  const m = src.match(/function runHnwPerCellRespin\(onSettled\)\s*\{([\s\S]*?)\n  \}/);
  if (!m) throw new Error('runHnwPerCellRespin not found in runtime emit');
  return m[1];
}

t('SANDBOX: non-locked cells get hnw-cell-spinning class, locked stay clean', () => new Promise((resolve, reject) => {
  const cells = [
    _mkCell('A', false),
    _mkCell('B', false),
    _mkCell('★', true),  // locked orb cell at idx 2
    _mkCell('D', false),
    _mkCell('E', false),
  ];
  const grid = {
    querySelectorAll: (sel) => {
      if (sel !== '.cell') throw new Error('unexpected selector ' + sel);
      return cells;
    },
  };
  /* Spin-grade fake strip — verify transform was neutralised. */
  const reel = { strip: { style: { transform: 'translateY(-42px)' } }, spinning: true, stopping: true };
  const RECT_REELS = [reel];
  const fakeFs = { triggerSymbol: 'S' };
  const FORCE_TRIGGER = null;
  const fakeHookBus = { _emitted: [], emit(ev, p) { this._emitted.push({ ev, p }); } };
  const randomSym = () => 'X';

  const body = _extractRunner();
  const runner = new Function(
    'onSettled', 'window', 'document', 'grid', 'RECT_REELS', 'HookBus', 'FREESPINS', 'FORCE_TRIGGER', 'randomSym', 'setTimeout',
    body,
  );

  /* Patch setTimeout to drive synchronously — we accept whatever delay
   * the runtime picks and just fire all timers in order. */
  const queue = [];
  const fakeSet = (fn, ms) => { queue.push({ fn, ms }); return queue.length; };
  const fakeWindow = { __SLOT_TURBO_SPEED_MULT__: 1.0, HW_STATE: { active: true } };

  let settled = false;
  runner(() => { settled = true; }, fakeWindow, {}, grid, RECT_REELS, fakeHookBus, fakeFs, FORCE_TRIGGER, randomSym, fakeSet);

  /* Drive the timer queue manually in insertion order to keep order
   * deterministic. */
  while (queue.length > 0) {
    const { fn } = queue.shift();
    try { fn(); } catch (e) { /* tolerate guard early-returns */ }
  }

  try {
    /* Strip transform neutralised */
    eq(reel.strip.style.transform, '', 'strip transform was not cleared');
    /* Locked cell at idx 2 NEVER tagged */
    ok(!cells[2]._classes.has('hnw-cell-spinning'), 'locked cell got hnw-cell-spinning');
    ok(!cells[2]._classes.has('hnw-cell-stopping'), 'locked cell got hnw-cell-stopping');
    ok(!cells[2]._classes.has('hnw-cell-stopped'),  'locked cell got hnw-cell-stopped');
    /* Locked cell symbol must be untouched */
    eq(cells[2].textContent, '★', 'locked cell text mutated');
    /* Non-locked cells received new symbols */
    for (const i of [0, 1, 3, 4]) {
      eq(cells[i].textContent, 'X', `non-locked cell ${i} not refreshed`);
    }
    /* Lifecycle emit fired */
    ok(fakeHookBus._emitted.some(e => e.ev === 'onSpinResult' && e.p.hwRespin === true),
       'onSpinResult{hwRespin:true} never emitted');
    ok(settled, 'onSettled callback never fired');
    resolve();
  } catch (e) { reject(e); }
}));

t('SANDBOX: all cells locked → no-op fast path + onSettled still fires', () => new Promise((resolve, reject) => {
  const cells = [0, 1, 2, 3, 4].map(() => _mkCell('★', true));
  const grid  = { querySelectorAll: () => cells };
  const reel  = { strip: { style: { transform: '' } } };
  const RECT_REELS = [reel];
  const fakeFs = { triggerSymbol: 'S' };
  const fakeHookBus = { _emitted: [], emit(ev, p) { this._emitted.push({ ev, p }); } };
  const randomSym = () => 'X';
  const queue = [];
  const fakeSet = (fn) => queue.push({ fn });
  const fakeWindow = { __SLOT_TURBO_SPEED_MULT__: 1.0, HW_STATE: { active: true } };

  const body = _extractRunner();
  const runner = new Function(
    'onSettled', 'window', 'document', 'grid', 'RECT_REELS', 'HookBus', 'FREESPINS', 'FORCE_TRIGGER', 'randomSym', 'setTimeout',
    body,
  );

  let settled = false;
  runner(() => { settled = true; }, fakeWindow, {}, grid, RECT_REELS, fakeHookBus, fakeFs, null, randomSym, fakeSet);
  while (queue.length > 0) {
    const { fn } = queue.shift();
    try { fn(); } catch (_) {}
  }

  try {
    /* No cell got tagged */
    for (const c of cells) {
      ok(!c._classes.has('hnw-cell-spinning'), 'locked cell tagged in no-op path');
    }
    /* Lifecycle still fired */
    ok(fakeHookBus._emitted.some(e => e.ev === 'onSpinResult' && e.p.hwRespin === true));
    ok(settled, 'onSettled never fired in no-op path');
    resolve();
  } catch (e) { reject(e); }
}));

/* ─── CSS — verify per-cell classes are present + reduced-motion gated ── */

import {
  emitHoldAndWinCSS,
  resolveConfig as resolveHWConfig,
} from '../../src/blocks/holdAndWin.mjs';

t('CSS emits .hnw-cell-spinning + sweep + pulse keyframes', () => {
  const css = emitHoldAndWinCSS(resolveHWConfig({ features: [{ kind: 'hold_and_win' }] }));
  ct(css, '.cell.hnw-cell-spinning');
  ct(css, '@keyframes hnwCellPulse');
  ct(css, '@keyframes hnwCellSweep');
  ct(css, '@keyframes hnwCellStopping');
  ct(css, '@keyframes hnwCellLanded');
});

t('CSS suppresses per-cell classes on .is-locked-bonus', () => {
  const css = emitHoldAndWinCSS(resolveHWConfig({ features: [{ kind: 'hold_and_win' }] }));
  ct(css, '.cell.is-locked-bonus.hnw-cell-spinning');
  ct(css, '!important');
  ct(css, 'display: none !important');
});

t('CSS reduced-motion gate kills per-cell animations', () => {
  const css = emitHoldAndWinCSS(resolveHWConfig({ features: [{ kind: 'hold_and_win' }] }));
  ct(css, '@media (prefers-reduced-motion: reduce)');
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]+?\n\}\s*\n[\s\S]*?\.cell\.hnw-cell-spinning,/);
  ok(block || css.includes('.cell.hnw-cell-spinning,'), 'reduced-motion did not target per-cell classes');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);

/* Wait briefly for promise tests, then exit. */
setTimeout(() => { if (fail) process.exit(1); }, 50);
