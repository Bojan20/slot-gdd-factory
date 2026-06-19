/**
 * tests/blocks/wildTriggerHoldAndWin.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitWildTriggerHoldAndWinCSS,
  emitWildTriggerHoldAndWinRuntime,
  countVisibleWilds,
} from '../../src/blocks/wildTriggerHoldAndWin.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.wildSymbolId, 'W');
  equal(c.triggerThreshold, 4);
  equal(c.mode, 'onScreen');
  equal(c.skipDuringFs, true);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ wildTriggerHoldAndWin: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps triggerThreshold to [2, 20]', () => {
  const lo = resolveConfig({ wildTriggerHoldAndWin: { triggerThreshold: 0 } });
  const hi = resolveConfig({ wildTriggerHoldAndWin: { triggerThreshold: 999 } });
  equal(lo.triggerThreshold, 2);
  equal(hi.triggerThreshold, 20);
});

t('resolveConfig: invalid mode falls back to onScreen', () => {
  const c = resolveConfig({ wildTriggerHoldAndWin: { mode: 'turbo' } });
  equal(c.mode, 'onScreen');
});

t('resolveConfig accepts cascade mode', () => {
  const c = resolveConfig({ wildTriggerHoldAndWin: { enabled: true, mode: 'cascade' } });
  equal(c.mode, 'cascade');
});

t('resolveConfig rejects lowercase wildSymbolId', () => {
  const c = resolveConfig({ wildTriggerHoldAndWin: { wildSymbolId: 'wild' } });
  equal(c.wildSymbolId, 'W');
});

t('resolveConfig: seedOrbsFromWilds + skipDuringFs toggles', () => {
  const c = resolveConfig({ wildTriggerHoldAndWin: {
    enabled: true, seedOrbsFromWilds: false, skipDuringFs: false,
  }});
  equal(c.seedOrbsFromWilds, false);
  equal(c.skipDuringFs, false);
});

t('countVisibleWilds: counts string array', () => {
  equal(countVisibleWilds(['W', 'A', 'W', 'K', 'W'], 'W'), 3);
});

t('countVisibleWilds: counts object array with .symbol', () => {
  const grid = [{ symbol: 'W' }, { symbol: 'A' }, { symbol: 'w' }];
  equal(countVisibleWilds(grid, 'W'), 2);
});

t('countVisibleWilds: empty/malformed returns 0', () => {
  equal(countVisibleWilds([], 'W'), 0);
  equal(countVisibleWilds(['A', 'K'], 'W'), 0);
  equal(countVisibleWilds(null, 'W'), 0);
  equal(countVisibleWilds(['W'], ''), 0);
});

t('countVisibleWilds: case-insensitive', () => {
  equal(countVisibleWilds(['w', 'W', ' W ', 'A'], 'W'), 3);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitWildTriggerHoldAndWinCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits flash + ARIA SR class + reduced-motion gate', () => {
  const css = emitWildTriggerHoldAndWinCSS(resolveConfig({ wildTriggerHoldAndWin: { enabled: true } }));
  ok(css.includes('.cell.is-wild-trigger-flash'));
  ok(css.includes('@keyframes wthw-flash'));
  ok(css.includes('.wthw-aria'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires preSpin/onSpinResult/onTumbleStep + emits canonical event', () => {
  const r = emitWildTriggerHoldAndWinRuntime(resolveConfig({ wildTriggerHoldAndWin: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes('onWildTriggerHoldAndWinRequested'));
  ok(r.includes('__WILD_TRIG_HW_WIRED__'));
});

t('emitRuntime: try/catch around emit + console.warn surface', () => {
  const r = emitWildTriggerHoldAndWinRuntime(resolveConfig({ wildTriggerHoldAndWin: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime: skipDuringFs gate present', () => {
  const r = emitWildTriggerHoldAndWinRuntime(resolveConfig({ wildTriggerHoldAndWin: { enabled: true } }));
  ok(r.includes('_isFsActive'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitWildTriggerHoldAndWinRuntime(resolveConfig({})).includes('__WILD_TRIG_HW_WIRED__'));
});
