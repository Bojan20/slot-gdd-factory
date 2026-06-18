/**
 * tests/blocks/symbolSplitReveal.test.mjs
 *
 * Unit + emit-shape tests for `symbolSplitReveal.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks
 *   - findSuperBlocks pure helper (empty / present / out-of-bounds)
 *   - cellsInBlock pure helper (2x2, 3x3, edge truncation, negatives)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + priority + HW guard + appliesIn branch
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitSymbolSplitRevealCSS,
  emitSymbolSplitRevealMarkup,
  emitSymbolSplitRevealRuntime,
  findSuperBlocks,
  cellsInBlock,
} from '../../src/blocks/symbolSplitReveal.mjs';

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default, blockSize=2', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.blockSize, 2);
  equal(c.appliesIn, 'both');
  equal(c.revealAnimMs, 600);
  equal(c.splitDelayMs, 150);
  equal(c.glowColor, '#ffcc00');
  equal(c.pulseMs, 800);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ symbolSplitReveal: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: rejects invalid blockSize (only 2/3/4 accepted)', () => {
  const def = defaultConfig();
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 5 } }).blockSize, def.blockSize);
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 1 } }).blockSize, def.blockSize);
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 0 } }).blockSize, def.blockSize);
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 'big' } }).blockSize, def.blockSize);
  /* Valid values pass through */
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 2 } }).blockSize, 2);
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 3 } }).blockSize, 3);
  equal(resolveConfig({ symbolSplitReveal: { blockSize: 4 } }).blockSize, 4);
});

t('resolveConfig: clamps revealAnimMs + pulseMs + splitDelayMs to bounds', () => {
  const lo = resolveConfig({
    symbolSplitReveal: {
      enabled: true,
      revealAnimMs: 1,
      splitDelayMs: -100,
      pulseMs: 1,
    },
  });
  equal(lo.revealAnimMs, 200);
  equal(lo.splitDelayMs, 0);
  equal(lo.pulseMs, 200);

  const hi = resolveConfig({
    symbolSplitReveal: {
      enabled: true,
      revealAnimMs: 99999,
      splitDelayMs: 99999,
      pulseMs: 99999,
    },
  });
  equal(hi.revealAnimMs, 3000);
  equal(hi.splitDelayMs, 500);
  equal(hi.pulseMs, 2000);
});

t('resolveConfig: rejects invalid appliesIn → keeps default both', () => {
  const c = resolveConfig({ symbolSplitReveal: { appliesIn: 'bonus' } });
  equal(c.appliesIn, 'both');
  equal(resolveConfig({ symbolSplitReveal: { appliesIn: 'base' } }).appliesIn, 'base');
  equal(resolveConfig({ symbolSplitReveal: { appliesIn: 'fs'   } }).appliesIn, 'fs');
});

t('resolveConfig: accepts valid hex glowColor + rejects bad hex', () => {
  equal(resolveConfig({ symbolSplitReveal: { glowColor: '#ff00aa' } }).glowColor, '#ff00aa');
  const def = defaultConfig();
  equal(resolveConfig({ symbolSplitReveal: { glowColor: 'orange' } }).glowColor, def.glowColor);
  equal(resolveConfig({ symbolSplitReveal: { glowColor: 123     } }).glowColor, def.glowColor);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. findSuperBlocks (pure helper)                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('findSuperBlocks: empty / null grid → []', () => {
  deepEqual(findSuperBlocks([], 2),    []);
  deepEqual(findSuperBlocks(null, 2),  []);
  deepEqual(findSuperBlocks(undefined, 2), []);
});

t('findSuperBlocks: 5x4 grid with no super blocks → []', () => {
  const grid = [];
  for (let r = 0; r < 5; r++) {
    grid.push([]);
    for (let y = 0; y < 4; y++) grid[r].push('A');
  }
  deepEqual(findSuperBlocks(grid, 2), []);
});

t('findSuperBlocks: 1 super block at (1,1) → returns [{anchor:{1,1}, symbol:H}]', () => {
  const grid = [];
  for (let r = 0; r < 5; r++) {
    grid.push([]);
    for (let y = 0; y < 4; y++) grid[r].push('A');
  }
  grid[1][1] = { symbol: 'H', superBlock: true };
  const blocks = findSuperBlocks(grid, 2);
  equal(blocks.length, 1);
  equal(blocks[0].anchor.reel, 1);
  equal(blocks[0].anchor.row,  1);
  equal(blocks[0].symbol,      'H');
});

t('findSuperBlocks: ignores anchors that would overflow grid bounds', () => {
  const grid = [];
  for (let r = 0; r < 5; r++) {
    grid.push([]);
    for (let y = 0; y < 4; y++) grid[r].push('A');
  }
  /* Anchor (4,3) with size=2 would extend to (5,4) — out of bounds. */
  grid[4][3] = { symbol: 'H', superBlock: true };
  /* Anchor (3,2) with size=3 would extend to (5,4) — out of bounds. */
  grid[3][2] = { symbol: 'K', superBlock: true };
  const blocks = findSuperBlocks(grid, 3);
  equal(blocks.length, 0);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. cellsInBlock (pure helper)                                        */
/* ──────────────────────────────────────────────────────────────────── */

t('cellsInBlock: anchor (0,0) size 2 on 5x4 → 4 cells', () => {
  const cells = cellsInBlock({ reel: 0, row: 0 }, 2, 5, 4);
  equal(cells.length, 4);
  deepEqual(cells[0], { reel: 0, row: 0 });
  deepEqual(cells[3], { reel: 1, row: 1 });
});

t('cellsInBlock: anchor (1,1) size 3 on 5x4 → 9 cells', () => {
  const cells = cellsInBlock({ reel: 1, row: 1 }, 3, 5, 4);
  /* Truncated to 4 rows max: rows {1,2,3} are all valid → 3 rows × 3 reels = 9 */
  equal(cells.length, 9);
  ok(cells.some(c => c.reel === 1 && c.row === 1));
  ok(cells.some(c => c.reel === 3 && c.row === 3));
});

t('cellsInBlock: anchor (4,0) size 3 on 5x3 → truncates to 1 reel × 3 rows = 3 cells', () => {
  /* Note: spec wording "9 cells from (4,0)" assumes ample reels. With
   * gridReels=5 the anchor reel 4 + size 3 would overflow (5..6 invalid),
   * so on a 5-reel grid only reel 4 is valid → 1 reel × 3 rows = 3 cells.
   * The pure helper must NEVER emit out-of-bounds coords — verifying that
   * truncation is the senior-grade behaviour. */
  const cells = cellsInBlock({ reel: 4, row: 0 }, 3, 5, 3);
  equal(cells.length, 3);
  for (const c of cells) {
    ok(c.reel < 5);
    ok(c.row  < 3);
  }
});

t('cellsInBlock: negative anchor / bad size → [] (graceful)', () => {
  deepEqual(cellsInBlock({ reel: -1, row: 0 }, 2, 5, 4), []);
  deepEqual(cellsInBlock({ reel: 0, row: -1 }, 2, 5, 4), []);
  deepEqual(cellsInBlock({ reel: 0, row: 0 }, 0,  5, 4), []);
  deepEqual(cellsInBlock(null,                2,  5, 4), []);
  deepEqual(cellsInBlock(undefined,           2,  5, 4), []);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS emit                                                          */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSymbolSplitRevealCSS: enabled emits .is-split-revealing + .is-split-revealed', () => {
  const css = emitSymbolSplitRevealCSS(resolveConfig({ symbolSplitReveal: { enabled: true } }));
  ok(css.includes('.is-split-revealing'));
  ok(css.includes('.is-split-revealed'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitSymbolSplitRevealCSS: disabled → no class names, marker only', () => {
  const css = emitSymbolSplitRevealCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.is-split-revealing'));
  ok(!css.includes('.is-split-revealed'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 6. Markup emit                                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSymbolSplitRevealMarkup: disabled → no shell (marker only)', () => {
  const m = emitSymbolSplitRevealMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
});

t('emitSymbolSplitRevealMarkup: enabled emits inert placeholder (runtime mounts on cells)', () => {
  const m = emitSymbolSplitRevealMarkup(resolveConfig({ symbolSplitReveal: { enabled: true } }));
  ok(m.length > 0);
  ok(!m.includes('disabled'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 7. Runtime emit                                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSymbolSplitRevealRuntime: enabled registers HookBus listeners + sentinel', () => {
  const r = emitSymbolSplitRevealRuntime(resolveConfig({ symbolSplitReveal: { enabled: true } }));
  ok(r.includes('HookBus.on("preSpin"'));
  ok(r.includes('HookBus.on("onSpinResult"'));
  ok(r.includes('HookBus.on("onFsSpinResult"'));
  ok(r.includes('HookBus.on("onFsEnd"'));
  ok(r.includes('__SSR_WIRED__'));
});

t('emitSymbolSplitRevealRuntime: disabled → no IIFE / no sentinel', () => {
  const r = emitSymbolSplitRevealRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__SSR_WIRED__'));
});

t('emitSymbolSplitRevealRuntime: includes HW guard + appliesIn branch', () => {
  const r = emitSymbolSplitRevealRuntime(resolveConfig({
    symbolSplitReveal: { enabled: true, appliesIn: 'both' },
  }));
  ok(r.includes('_isHwActive'));
  ok(r.includes('_isFsActive'));
  ok(r.includes('APPLIES_IN'));
});

t('emitSymbolSplitRevealRuntime: priority 30 declared for HookBus subscriptions', () => {
  const r = emitSymbolSplitRevealRuntime(resolveConfig({ symbolSplitReveal: { enabled: true } }));
  /* Count occurrences of "priority: 30" — should be 4 (one per listener). */
  const matches = r.match(/priority:\s*30/g) || [];
  ok(matches.length >= 4, 'expected at least 4 priority:30 declarations, got ' + matches.length);
});

t('emitSymbolSplitRevealRuntime: emits documented events Started/Revealed/Cleared', () => {
  const r = emitSymbolSplitRevealRuntime(resolveConfig({ symbolSplitReveal: { enabled: true } }));
  ok(r.includes("HookBus.emit('onSymbolSplitStarted'"));
  ok(r.includes("HookBus.emit('onSymbolSplitRevealed'"));
  ok(r.includes("HookBus.emit('onSymbolSplitCleared'"));
});
