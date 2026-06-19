/**
 * tests/blocks/cascadingWildPersistence.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitCascadingWildPersistenceCSS,
  emitCascadingWildPersistenceRuntime,
  shouldPinCell,
} from '../../src/blocks/cascadingWildPersistence.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.wildSymbolId, 'W');
  equal(c.showCounter, true);
  equal(c.counterPosition, 'topLeft');
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ cascadingWildPersistence: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: rejects lowercase wildSymbolId', () => {
  const c = resolveConfig({ cascadingWildPersistence: { wildSymbolId: 'wild' } });
  equal(c.wildSymbolId, 'W');
});

t('resolveConfig: accepts valid 1-4 char uppercase symbol', () => {
  const c = resolveConfig({ cascadingWildPersistence: { wildSymbolId: 'WLD' } });
  equal(c.wildSymbolId, 'WLD');
});

t('resolveConfig: rejects invalid hex pinColor', () => {
  const c = resolveConfig({ cascadingWildPersistence: { pinColor: 'not-a-color' } });
  equal(c.pinColor, '#7af2c8');
});

t('resolveConfig: showCounter can be toggled off', () => {
  const c = resolveConfig({ cascadingWildPersistence: { enabled: true, showCounter: false } });
  equal(c.showCounter, false);
});

t('resolveConfig: invalid counterPosition falls back', () => {
  const c = resolveConfig({ cascadingWildPersistence: { counterPosition: 'middle' } });
  equal(c.counterPosition, 'topLeft');
});

t('shouldPinCell: matches WILD symbol', () => {
  equal(shouldPinCell('W', 'W'), true);
  equal(shouldPinCell('w', 'W'), true);  /* case-insensitive */
  equal(shouldPinCell(' W ', 'W'), true);  /* trim */
});

t('shouldPinCell: rejects non-matches', () => {
  equal(shouldPinCell('HP', 'W'), false);
  equal(shouldPinCell('', 'W'), false);
  equal(shouldPinCell('W', ''), false);
  equal(shouldPinCell(null, 'W'), false);
  equal(shouldPinCell('W', null), false);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitCascadingWildPersistenceCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits pin + fresh-pin + counter + reduced-motion gate', () => {
  const css = emitCascadingWildPersistenceCSS(resolveConfig({ cascadingWildPersistence: { enabled: true } }));
  ok(css.includes('.cell.is-cascade-pinned'));
  ok(css.includes('.cell.is-cascade-pinned.is-fresh-pin'));
  ok(css.includes('@keyframes cwp-fresh'));
  ok(css.includes('.cwp-counter'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires 4 lifecycle hooks (preSpin/onSpinResult/onTumbleStep/postSpin)', () => {
  const r = emitCascadingWildPersistenceRuntime(resolveConfig({ cascadingWildPersistence: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('postSpin'"));
  ok(r.includes('onCascadingWildPinned'));
  ok(r.includes('__CASCADING_WILD_WIRED__'));
});

t('emitRuntime: try/catch around emit (anti-silent-failure)', () => {
  const r = emitCascadingWildPersistenceRuntime(resolveConfig({ cascadingWildPersistence: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitCascadingWildPersistenceRuntime(resolveConfig({})).includes('__CASCADING_WILD_WIRED__'));
});

t('emitRuntime bakes wildSymbolId into IIFE', () => {
  const r = emitCascadingWildPersistenceRuntime(resolveConfig({
    cascadingWildPersistence: { enabled: true, wildSymbolId: 'WLD' },
  }));
  ok(r.includes('"WLD"'));
});
