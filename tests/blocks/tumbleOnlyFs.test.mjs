/**
 * tests/blocks/tumbleOnlyFs.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitTumbleOnlyFsCSS, emitTumbleOnlyFsRuntime,
} from '../../src/blocks/tumbleOnlyFs.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.chainsBudget, 10);
  equal(c.hudPosition, 'topRight');
});

t('resolveConfig clamps chainsBudget to [1, 99]', () => {
  const lo = resolveConfig({ tumbleOnlyFs: { chainsBudget: 0 } });
  const hi = resolveConfig({ tumbleOnlyFs: { chainsBudget: 999 } });
  equal(lo.chainsBudget, 1);
  equal(hi.chainsBudget, 99);
});

t('resolveConfig: invalid hudPosition falls back', () => {
  const c = resolveConfig({ tumbleOnlyFs: { hudPosition: 'inside' } });
  equal(c.hudPosition, 'topRight');
});

t('resolveConfig: enables on true', () => {
  const c = resolveConfig({ tumbleOnlyFs: { enabled: true } });
  equal(c.enabled, true);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitTumbleOnlyFsCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits badge + flash keyframes', () => {
  const css = emitTumbleOnlyFsCSS(resolveConfig({ tumbleOnlyFs: { enabled: true } }));
  ok(css.includes('.tofs-badge'));
  ok(css.includes('@keyframes tofs-flash'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onFsTrigger/onTumbleStep/onFsEnd + emits events', () => {
  const r = emitTumbleOnlyFsRuntime(resolveConfig({ tumbleOnlyFs: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onTumbleOnlyFsModeEntered'));
  ok(r.includes('onTumbleOnlyFsChainEnded'));
  ok(r.includes('__TUMBLE_ONLY_FS_WIRED__'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitTumbleOnlyFsRuntime(resolveConfig({})).includes('__TUMBLE_ONLY_FS_WIRED__'));
});

t('emitRuntime bakes chainsBudget into IIFE', () => {
  const r = emitTumbleOnlyFsRuntime(resolveConfig({ tumbleOnlyFs: { enabled: true, chainsBudget: 7 } }));
  ok(r.includes('BUDGET = 7'));
});
