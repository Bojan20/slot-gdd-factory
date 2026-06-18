/**
 * tests/blocks/fsExpansionWilds.test.mjs
 *
 * Unit + emit-shape tests for `fsExpansionWilds.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitFsExpansionWildsCSS,
  emitFsExpansionWildsMarkup,
  emitFsExpansionWildsRuntime,
  shouldExpandReel,
} from '../../src/blocks/fsExpansionWilds.mjs';

t('defaultConfig: disabled by default with sensible bounds', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.wildSymbol, 'W');
  ok(c.triggerProbability >= 0 && c.triggerProbability <= 1);
  ok(c.maxStickyReels >= 1 && c.maxStickyReels <= 10);
  ok(c.pulseMs >= 200 && c.pulseMs <= 3000);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ fsExpansionWilds: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps maxStickyReels to [1, 10]', () => {
  const hi = resolveConfig({ fsExpansionWilds: { maxStickyReels: 9999 } });
  const lo = resolveConfig({ fsExpansionWilds: { maxStickyReels: -50 } });
  equal(hi.maxStickyReels, 10);
  equal(lo.maxStickyReels, 1);
});

t('resolveConfig: clamps triggerProbability to [0, 1]', () => {
  const hi = resolveConfig({ fsExpansionWilds: { triggerProbability: 17 } });
  const lo = resolveConfig({ fsExpansionWilds: { triggerProbability: -3 } });
  equal(hi.triggerProbability, 1);
  equal(lo.triggerProbability, 0);
});

t('resolveConfig: rejects malformed wildSymbol → keeps default', () => {
  const def = defaultConfig();
  const bad1 = resolveConfig({ fsExpansionWilds: { wildSymbol: '!!!@@@###' } });
  const bad2 = resolveConfig({ fsExpansionWilds: { wildSymbol: '' } });
  const bad3 = resolveConfig({ fsExpansionWilds: { wildSymbol: 'tooooolong' } });
  equal(bad1.wildSymbol, def.wildSymbol);
  equal(bad2.wildSymbol, def.wildSymbol);
  equal(bad3.wildSymbol, def.wildSymbol);
});

t('resolveConfig: accepts valid hex expansionColor', () => {
  const c = resolveConfig({ fsExpansionWilds: { expansionColor: '#abcdef' } });
  equal(c.expansionColor, '#abcdef');
});

t('shouldExpandReel: reel not in set + room available → true', () => {
  const set = new Set([0, 2]);
  equal(shouldExpandReel(set, 1, 5), true);
});

t('shouldExpandReel: reel already in set → false', () => {
  const set = new Set([0, 1, 2]);
  equal(shouldExpandReel(set, 1, 5), false);
});

t('shouldExpandReel: set at max capacity → false', () => {
  const set = new Set([0, 1, 2, 3, 4]);
  equal(shouldExpandReel(set, 5, 5), false);
});

t('emitFsExpansionWildsCSS: contains .is-expansion-wild class when enabled', () => {
  const css = emitFsExpansionWildsCSS(resolveConfig({ fsExpansionWilds: { enabled: true } }));
  ok(css.includes('.is-expansion-wild'));
  ok(css.includes('@keyframes fsew-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitFsExpansionWildsCSS: empty (disabled marker only) when disabled', () => {
  const css = emitFsExpansionWildsCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.is-expansion-wild'));
});

t('emitFsExpansionWildsMarkup: empty (disabled marker only) when disabled', () => {
  const m = emitFsExpansionWildsMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('fsewAnchor'));
});

t('emitFsExpansionWildsRuntime: registers HookBus listeners when enabled', () => {
  const r = emitFsExpansionWildsRuntime(resolveConfig({ fsExpansionWilds: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onExpansionWildAdded'));
  ok(r.includes('onExpansionWildsCleared'));
  ok(r.includes('__FSEW_WIRED__'));
});

t('emitFsExpansionWildsRuntime: disabled emits no IIFE', () => {
  const r = emitFsExpansionWildsRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__FSEW_WIRED__'));
});

t('emitFsExpansionWildsRuntime: includes FS-active + HW guards', () => {
  const r = emitFsExpansionWildsRuntime(resolveConfig({ fsExpansionWilds: { enabled: true } }));
  ok(r.includes('_isFsActive'));
  ok(r.includes('_isHwActive'));
  ok(r.includes('HW_STATE'));
});
