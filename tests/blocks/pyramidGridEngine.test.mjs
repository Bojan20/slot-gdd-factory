/**
 * tests/blocks/pyramidGridEngine.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitPyramidGridEngineCSS,
  emitPyramidGridEngineMarkup,
  emitPyramidGridEngineRuntime,
  buildPyramidShape,
} from '../../src/blocks/pyramidGridEngine.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.reelCount, 5);
  equal(c.startRows, 1);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ pyramidGridEngine: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps reelCount to [2, 8]', () => {
  const lo = resolveConfig({ pyramidGridEngine: { reelCount: 1 } });
  const hi = resolveConfig({ pyramidGridEngine: { reelCount: 99 } });
  equal(lo.reelCount, 2);
  equal(hi.reelCount, 8);
});

t('resolveConfig clamps startRows to [1, 8]', () => {
  const lo = resolveConfig({ pyramidGridEngine: { startRows: 0 } });
  const hi = resolveConfig({ pyramidGridEngine: { startRows: 99 } });
  equal(lo.startRows, 1);
  equal(hi.startRows, 8);
});

t('resolveConfig clamps spinDurationMs to [200, 8000]', () => {
  const lo = resolveConfig({ pyramidGridEngine: { spinDurationMs: 10 } });
  const hi = resolveConfig({ pyramidGridEngine: { spinDurationMs: 99999 } });
  equal(lo.spinDurationMs, 200);
  equal(hi.spinDurationMs, 8000);
});

t('resolveConfig clamps cellSizePx to [32, 120]', () => {
  const lo = resolveConfig({ pyramidGridEngine: { cellSizePx: 5 } });
  const hi = resolveConfig({ pyramidGridEngine: { cellSizePx: 999 } });
  equal(lo.cellSizePx, 32);
  equal(hi.cellSizePx, 120);
});

t('resolveConfig rejects invalid hex colors', () => {
  const c = resolveConfig({ pyramidGridEngine: { cellColor: 'blue', cellBorderColor: 'gold' } });
  equal(c.cellColor, '#1a2840');
  equal(c.cellBorderColor, '#c9a227');
});

t('buildPyramidShape: 5-reel pyramid with startRows=1', () => {
  const shape = buildPyramidShape(5, 1);
  equal(shape.length, 5);
  deepEqual(shape.map(r => r.rows), [1, 2, 3, 4, 5]);
  /* Total cells = 1+2+3+4+5 = 15 */
  const total = shape.reduce((s, r) => s + r.rows, 0);
  equal(total, 15);
});

t('buildPyramidShape: with custom startRows', () => {
  const shape = buildPyramidShape(3, 2);
  deepEqual(shape.map(r => r.rows), [2, 3, 4]);
});

t('buildPyramidShape: malformed inputs return []', () => {
  equal(buildPyramidShape(0, 1).length, 0);
  equal(buildPyramidShape(NaN, 1).length, 0);
  equal(buildPyramidShape(5, 0).length, 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitPyramidGridEngineCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits grid + reel + fall keyframes + reduced-motion gate', () => {
  const css = emitPyramidGridEngineCSS(resolveConfig({ pyramidGridEngine: { enabled: true } }));
  ok(css.includes('.grid-pyramid'));
  ok(css.includes('.py-reel'));
  ok(css.includes('@keyframes py-fall'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits correct cell count for pyramid shape', () => {
  const m = emitPyramidGridEngineMarkup(resolveConfig({ pyramidGridEngine: { enabled: true, reelCount: 5, startRows: 1 } }));
  ok(m.includes('class="grid-pyramid"'));
  ok(m.includes('role="grid"'));
  /* 5-reel pyramid: 1+2+3+4+5 = 15 cells */
  const cellCount = (m.match(/data-reel="\d+" data-row="\d+"/g) || []).length;
  equal(cellCount, 15);
});

t('emitRuntime enabled wires preSpin + emits onPyramidSpinResult (NOT onSpinResult to avoid double-emit)', () => {
  const r = emitPyramidGridEngineRuntime(resolveConfig({ pyramidGridEngine: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.emit('onPyramidSpinResult'"));
  /* Anti-double-emit: reelEngine._wrappedSettled already emits onSpinResult
   * for engines dispatched via __SLOT_KIND_RUNSPIN__ (WASH PASS #2 ruling). */
  ok(!r.includes("HookBus.emit('onSpinResult'"));
  ok(r.includes('__PYRAMID_GRID_WIRED__'));
});

t('emitRuntime: try/catch + console.warn surface', () => {
  const r = emitPyramidGridEngineRuntime(resolveConfig({ pyramidGridEngine: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime exposes window.__SLOT_KIND_RUNSPIN__.pyramid', () => {
  const r = emitPyramidGridEngineRuntime(resolveConfig({ pyramidGridEngine: { enabled: true } }));
  ok(r.includes('__SLOT_KIND_RUNSPIN__.pyramid'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitPyramidGridEngineRuntime(resolveConfig({})).includes('__PYRAMID_GRID_WIRED__'));
});
