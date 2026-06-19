/**
 * tests/blocks/fsReelHeightEscalation.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitFsReelHeightEscalationCSS,
  emitFsReelHeightEscalationRuntime,
  computeNewRowCount,
} from '../../src/blocks/fsReelHeightEscalation.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.rowsPerRetrigger, 1);
  equal(c.maxRows, 8);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ fsReelHeightEscalation: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps rowsPerRetrigger to [1, 5]', () => {
  const lo = resolveConfig({ fsReelHeightEscalation: { rowsPerRetrigger: 0 } });
  const hi = resolveConfig({ fsReelHeightEscalation: { rowsPerRetrigger: 99 } });
  equal(lo.rowsPerRetrigger, 1);
  equal(hi.rowsPerRetrigger, 5);
});

t('resolveConfig clamps maxRows to [2, 14]', () => {
  const lo = resolveConfig({ fsReelHeightEscalation: { maxRows: 1 } });
  const hi = resolveConfig({ fsReelHeightEscalation: { maxRows: 99 } });
  equal(lo.maxRows, 2);
  equal(hi.maxRows, 14);
});

t('resolveConfig: fillSymbol regex accepts uppercase + digits + ?', () => {
  const a = resolveConfig({ fsReelHeightEscalation: { fillSymbol: 'A' } });
  const b = resolveConfig({ fsReelHeightEscalation: { fillSymbol: '10' } });
  const q = resolveConfig({ fsReelHeightEscalation: { fillSymbol: '?' } });
  equal(a.fillSymbol, 'A');
  equal(b.fillSymbol, '10');
  equal(q.fillSymbol, '?');
});

t('resolveConfig rejects lowercase fillSymbol', () => {
  const c = resolveConfig({ fsReelHeightEscalation: { fillSymbol: 'wild' } });
  equal(c.fillSymbol, '?');
});

t('resolveConfig: showChip can be toggled off', () => {
  const c = resolveConfig({ fsReelHeightEscalation: { enabled: true, showChip: false } });
  equal(c.showChip, false);
});

t('computeNewRowCount: simple +1 increment', () => {
  equal(computeNewRowCount(3, 1, 8), 4);
});

t('computeNewRowCount: clamps at maxRows', () => {
  equal(computeNewRowCount(7, 5, 8), 8);
  equal(computeNewRowCount(8, 1, 8), 8);
});

t('computeNewRowCount: per-retrigger 2', () => {
  equal(computeNewRowCount(3, 2, 8), 5);
});

t('computeNewRowCount: malformed returns current', () => {
  equal(computeNewRowCount(NaN, 1, 8), 0);
  equal(computeNewRowCount(3, NaN, 8), 3);
  equal(computeNewRowCount(3, 1, NaN), 3);
});

t('computeNewRowCount: negative perRetrigger treated as 0 (no decrement)', () => {
  equal(computeNewRowCount(3, -5, 8), 3);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitFsReelHeightEscalationCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + bump + fresh-row keyframes + reduced-motion', () => {
  const css = emitFsReelHeightEscalationCSS(resolveConfig({ fsReelHeightEscalation: { enabled: true } }));
  ok(css.includes('.fsrhe-chip'));
  ok(css.includes('@keyframes fsrhe-bump'));
  ok(css.includes('.cell.is-fsrhe-fresh-row'));
  ok(css.includes('@keyframes fsrhe-fresh'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onFsTrigger/onFsRetrigger/onFsEnd + emits canonical event', () => {
  const r = emitFsReelHeightEscalationRuntime(resolveConfig({ fsReelHeightEscalation: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsRetrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onFsReelHeightEscalated'));
  ok(r.includes('__FS_REEL_HEIGHT_WIRED__'));
});

t('emitRuntime: try/catch + console.warn surface', () => {
  const r = emitFsReelHeightEscalationRuntime(resolveConfig({ fsReelHeightEscalation: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime updates RECT_REELS visibleRows on retrigger', () => {
  const r = emitFsReelHeightEscalationRuntime(resolveConfig({ fsReelHeightEscalation: { enabled: true } }));
  ok(r.includes('RECT_REELS'));
  ok(r.includes('visibleRows'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitFsReelHeightEscalationRuntime(resolveConfig({})).includes('__FS_REEL_HEIGHT_WIRED__'));
});

t('emitRuntime bakes maxRows + perTrig into IIFE', () => {
  const r = emitFsReelHeightEscalationRuntime(resolveConfig({
    fsReelHeightEscalation: { enabled: true, rowsPerRetrigger: 2, maxRows: 10 },
  }));
  ok(r.includes('PER_TRIG  = 2'));
  ok(r.includes('MAX_ROWS  = 10'));
});
