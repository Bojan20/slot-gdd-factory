/**
 * tests/blocks/wildCollisionMultiplier.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitWildCollisionMultiplierCSS,
  emitWildCollisionMultiplierRuntime,
  computeWildProduct,
} from '../../src/blocks/wildCollisionMultiplier.mjs';

t('defaultConfig disabled, sane defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.wildSymbolId, 'W');
  equal(c.minWildsForCollision, 2);
});

t('resolveConfig clamps minWildsForCollision to [2, 5]', () => {
  const lo = resolveConfig({ wildCollisionMultiplier: { minWildsForCollision: 1 } });
  const hi = resolveConfig({ wildCollisionMultiplier: { minWildsForCollision: 99 } });
  equal(lo.minWildsForCollision, 2);
  equal(hi.minWildsForCollision, 5);
});

t('resolveConfig rejects lower-case wildSymbolId', () => {
  const c = resolveConfig({ wildCollisionMultiplier: { wildSymbolId: 'wild' } });
  equal(c.wildSymbolId, 'W');
});

t('computeWildProduct: single value identity', () => {
  equal(computeWildProduct([5]), 5);
});

t('computeWildProduct: multi-value product', () => {
  equal(computeWildProduct([2, 3, 5]), 30);
});

t('computeWildProduct: filters bad inputs', () => {
  equal(computeWildProduct([2, -1, NaN, 4]), 8);
});

t('computeWildProduct: empty → 1 (identity)', () => {
  equal(computeWildProduct([]), 1);
});

t('emitCSS disabled returns no CSS', () => {
  const css = emitWildCollisionMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
});

t('emitCSS enabled emits chip + collision glow keyframes', () => {
  const css = emitWildCollisionMultiplierCSS(resolveConfig({ wildCollisionMultiplier: { enabled: true } }));
  ok(css.includes('.cell.has-wild-mult-chip'));
  ok(css.includes('.cell.has-wild-collision-active'));
  ok(css.includes('@keyframes wcm-glow'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onSpinResult/onTumbleStep/preSpin + emits onWildCollision', () => {
  const r = emitWildCollisionMultiplierRuntime(resolveConfig({ wildCollisionMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onWildCollision'));
  ok(r.includes('__WILD_COLLISION_MULT_WIRED__'));
});
