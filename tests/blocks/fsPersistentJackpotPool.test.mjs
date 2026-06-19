/**
 * tests/blocks/fsPersistentJackpotPool.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitFsPersistentJackpotPoolCSS,
  emitFsPersistentJackpotPoolMarkup,
  emitFsPersistentJackpotPoolRuntime,
  computePoolBump,
} from '../../src/blocks/fsPersistentJackpotPool.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.floorX, 10);
  equal(c.payoutTrigger, 'fsEnd');
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ fsPersistentJackpotPool: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps floorX/deltaPerSpinX', () => {
  const c = resolveConfig({ fsPersistentJackpotPool: { floorX: -10, deltaPerSpinX: -5 } });
  equal(c.floorX, 0);
  equal(c.deltaPerSpinX, 0);
});

t('resolveConfig clamps winFraction to [0, 1]', () => {
  const lo = resolveConfig({ fsPersistentJackpotPool: { winFraction: -0.5 } });
  const hi = resolveConfig({ fsPersistentJackpotPool: { winFraction: 5 } });
  equal(lo.winFraction, 0);
  equal(hi.winFraction, 1);
});

t('resolveConfig: invalid payoutTrigger falls back to fsEnd', () => {
  const c = resolveConfig({ fsPersistentJackpotPool: { payoutTrigger: 'instant' } });
  equal(c.payoutTrigger, 'fsEnd');
});

t('resolveConfig: payoutTrigger maxScatters accepted', () => {
  const c = resolveConfig({ fsPersistentJackpotPool: { enabled: true, payoutTrigger: 'maxScatters' } });
  equal(c.payoutTrigger, 'maxScatters');
});

t('resolveConfig clamps maxScattersThreshold to [1, 50]', () => {
  const lo = resolveConfig({ fsPersistentJackpotPool: { maxScattersThreshold: 0 } });
  const hi = resolveConfig({ fsPersistentJackpotPool: { maxScattersThreshold: 999 } });
  equal(lo.maxScattersThreshold, 1);
  equal(hi.maxScattersThreshold, 50);
});

t('computePoolBump: base + delta only', () => {
  equal(computePoolBump(10, 0, 2, 0.1), 12);
});

t('computePoolBump: includes winFraction of winX', () => {
  /* 10 + 2 + (100 * 0.1) = 22 */
  equal(computePoolBump(10, 100, 2, 0.1), 22);
});

t('computePoolBump: malformed inputs treated as zero', () => {
  equal(computePoolBump(NaN, null, 'abc', undefined), 0);
});

t('computePoolBump: negative winX treated as zero', () => {
  /* 10 + 2 + max(0, -50) * 0.1 = 12 */
  equal(computePoolBump(10, -50, 2, 0.1), 12);
});

t('computePoolBump: rounds to 2 decimal places', () => {
  /* 10 + 2 + (33 * 0.333) = 12 + 10.989 = 22.989 → 22.99 */
  equal(computePoolBump(10, 33, 2, 0.333), 22.99);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitFsPersistentJackpotPoolCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + bump + paid keyframes + reduced-motion', () => {
  const css = emitFsPersistentJackpotPoolCSS(resolveConfig({ fsPersistentJackpotPool: { enabled: true } }));
  ok(css.includes('.fspjp-chip'));
  ok(css.includes('@keyframes fspjp-bump'));
  ok(css.includes('@keyframes fspjp-paid'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits chip + ARIA', () => {
  const m = emitFsPersistentJackpotPoolMarkup(resolveConfig({ fsPersistentJackpotPool: { enabled: true } }));
  ok(m.includes('id="fspjpChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitMarkup hidden returns no markup', () => {
  const m = emitFsPersistentJackpotPoolMarkup(resolveConfig({ fsPersistentJackpotPool: { enabled: true, showChip: false } }));
  ok(m.includes('disabled or hidden'));
});

t('emitRuntime enabled wires 5 hooks + 3 events + sentinel', () => {
  const r = emitFsPersistentJackpotPoolRuntime(resolveConfig({ fsPersistentJackpotPool: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onScatterCelebrationStart'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onFsJackpotPoolBumped'));
  ok(r.includes('onFsJackpotPoolPaidOut'));
  ok(r.includes('onFsJackpotPoolEndRequested'));
  ok(r.includes('__FS_JACKPOT_POOL_WIRED__'));
});

t('emitRuntime: try/catch + console.warn (anti-silent-failure)', () => {
  const r = emitFsPersistentJackpotPoolRuntime(resolveConfig({ fsPersistentJackpotPool: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitFsPersistentJackpotPoolRuntime(resolveConfig({})).includes('__FS_JACKPOT_POOL_WIRED__'));
});
