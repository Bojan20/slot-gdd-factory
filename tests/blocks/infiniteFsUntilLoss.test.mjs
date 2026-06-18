/**
 * tests/blocks/infiniteFsUntilLoss.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitInfiniteFsUntilLossCSS, emitInfiniteFsUntilLossRuntime,
} from '../../src/blocks/infiniteFsUntilLoss.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.sentinelCount, 999);
});

t('resolveConfig clamps sentinelCount to [50, 99999]', () => {
  const lo = resolveConfig({ infiniteFsUntilLoss: { sentinelCount: 10 } });
  const hi = resolveConfig({ infiniteFsUntilLoss: { sentinelCount: 9999999 } });
  equal(lo.sentinelCount, 50);
  equal(hi.sentinelCount, 99999);
});

t('resolveConfig: invalid hudPosition falls back', () => {
  const c = resolveConfig({ infiniteFsUntilLoss: { hudPosition: 'middle' } });
  equal(c.hudPosition, 'topLeft');
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ infiniteFsUntilLoss: { enabled: true } });
  equal(c.enabled, true);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitInfiniteFsUntilLossCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + bump keyframes', () => {
  const css = emitInfiniteFsUntilLossCSS(resolveConfig({ infiniteFsUntilLoss: { enabled: true } }));
  ok(css.includes('.ifsl-chip'));
  ok(css.includes('@keyframes ifsl-bump'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onFsTrigger/onFsSpinResult/onFsEnd + emits 2 events', () => {
  const r = emitInfiniteFsUntilLossRuntime(resolveConfig({ infiniteFsUntilLoss: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onInfiniteFsStreakBumped'));
  ok(r.includes('onInfiniteFsModeEnded'));
  ok(r.includes('__INFINITE_FS_WIRED__'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitInfiniteFsUntilLossRuntime(resolveConfig({})).includes('__INFINITE_FS_WIRED__'));
});

t('emitRuntime bakes sentinel into IIFE', () => {
  const r = emitInfiniteFsUntilLossRuntime(resolveConfig({ infiniteFsUntilLoss: { enabled: true, sentinelCount: 555 } }));
  ok(r.includes('SENTINEL = 555'));
});
