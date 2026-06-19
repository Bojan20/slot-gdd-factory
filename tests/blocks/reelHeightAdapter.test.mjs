/**
 * tests/blocks/reelHeightAdapter.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitReelHeightAdapterCSS,
  emitReelHeightAdapterRuntime,
  computeRowDelta,
} from '../../src/blocks/reelHeightAdapter.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.freshRowFillSymbol, '?');
  equal(c.freshRowClass, 'is-rha-fresh');
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ reelHeightAdapter: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig rejects lowercase freshRowFillSymbol', () => {
  const c = resolveConfig({ reelHeightAdapter: { freshRowFillSymbol: 'lowwer' } });
  equal(c.freshRowFillSymbol, '?');
});

t('resolveConfig accepts valid freshRowFillSymbol', () => {
  const a = resolveConfig({ reelHeightAdapter: { freshRowFillSymbol: 'A' } });
  const b = resolveConfig({ reelHeightAdapter: { freshRowFillSymbol: '10' } });
  equal(a.freshRowFillSymbol, 'A');
  equal(b.freshRowFillSymbol, '10');
});

t('resolveConfig validates freshRowClass regex', () => {
  const valid = resolveConfig({ reelHeightAdapter: { freshRowClass: 'is-my-class' } });
  const invalid = resolveConfig({ reelHeightAdapter: { freshRowClass: 'has spaces!' } });
  equal(valid.freshRowClass, 'is-my-class');
  equal(invalid.freshRowClass, 'is-rha-fresh');
});

t('computeRowDelta: positive delta = grow', () => {
  equal(computeRowDelta(3, 5), 2);
});

t('computeRowDelta: negative delta = shrink', () => {
  equal(computeRowDelta(5, 3), -2);
});

t('computeRowDelta: zero delta = no-op', () => {
  equal(computeRowDelta(4, 4), 0);
});

t('computeRowDelta: malformed inputs return 0', () => {
  equal(computeRowDelta(NaN, 5), 0);
  equal(computeRowDelta(5, NaN), 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitReelHeightAdapterCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits fresh-row class + reduced-motion gate', () => {
  const css = emitReelHeightAdapterCSS(resolveConfig({ reelHeightAdapter: { enabled: true } }));
  ok(css.includes('.cell.is-rha-fresh'));
  ok(css.includes('@keyframes rha-fresh'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onFsReelHeightEscalated + onFsEnd', () => {
  const r = emitReelHeightAdapterRuntime(resolveConfig({ reelHeightAdapter: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsReelHeightEscalated'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onReelHeightGrown'));
  ok(r.includes('onReelHeightShrunk'));
  ok(r.includes('__REEL_HEIGHT_ADAPTER_WIRED__'));
});

t('emitRuntime exposes window.growReelHeight + window.shrinkReelHeight', () => {
  const r = emitReelHeightAdapterRuntime(resolveConfig({ reelHeightAdapter: { enabled: true } }));
  ok(r.includes('window.growReelHeight'));
  ok(r.includes('window.shrinkReelHeight'));
});

t('emitRuntime: try/catch + console.warn surface', () => {
  const r = emitReelHeightAdapterRuntime(resolveConfig({ reelHeightAdapter: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime: shrink guards against mid-spin (reel.spinning check)', () => {
  const r = emitReelHeightAdapterRuntime(resolveConfig({ reelHeightAdapter: { enabled: true } }));
  ok(r.includes('reel.spinning || reel.stopping'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitReelHeightAdapterRuntime(resolveConfig({})).includes('__REEL_HEIGHT_ADAPTER_WIRED__'));
});
