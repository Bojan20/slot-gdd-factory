/**
 * tests/blocks/holdAndWinLockedOrbMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `holdAndWinLockedOrbMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitHoldAndWinLockedOrbMultiplierCSS,
  emitHoldAndWinLockedOrbMultiplierMarkup,
  emitHoldAndWinLockedOrbMultiplierRuntime,
  pickMultiplierValue,
  aggregateValues,
} from '../../src/blocks/holdAndWinLockedOrbMultiplier.mjs';

t('defaultConfig: disabled + sensible distribution', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.distribution));
  ok(c.distribution.length >= 3);
  for (const e of c.distribution) {
    ok(Number.isFinite(e.value) && e.value > 0);
    ok(Number.isFinite(e.weight) && e.weight > 0);
  }
  equal(c.aggregation, 'additive');
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps fontSizePx + pulseMs to bounds', () => {
  const lo = resolveConfig({ holdAndWinLockedOrbMultiplier: { fontSizePx: -50, pulseMs: -50 } });
  ok(lo.fontSizePx >= 10);
  ok(lo.pulseMs    >= 200);
  const hi = resolveConfig({ holdAndWinLockedOrbMultiplier: { fontSizePx: 999, pulseMs: 999999 } });
  ok(hi.fontSizePx <= 20);
  ok(hi.pulseMs    <= 2000);
});

t('resolveConfig: rejects invalid aggregation, falls back to additive', () => {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: { aggregation: 'banana' } });
  equal(c.aggregation, 'additive');
  const ok2 = resolveConfig({ holdAndWinLockedOrbMultiplier: { aggregation: 'multiplicative' } });
  equal(ok2.aggregation, 'multiplicative');
});

t('resolveConfig: accepts valid hex chipColor', () => {
  const c = resolveConfig({ holdAndWinLockedOrbMultiplier: { chipColor: '#abcdef' } });
  equal(c.chipColor, '#abcdef');
  const bad = resolveConfig({ holdAndWinLockedOrbMultiplier: { chipColor: 'not-a-color' } });
  equal(bad.chipColor, defaultConfig().chipColor);
});

t('pickMultiplierValue: deterministic seeded RNG covers all entries', () => {
  const dist = [
    { value: 1, weight: 1 },
    { value: 5, weight: 1 },
    { value: 9, weight: 1 },
  ];
  /* RNG returns 0.0 → first bucket; 0.5 → middle; 0.99 → last. */
  equal(pickMultiplierValue(dist, () => 0.0),  1);
  equal(pickMultiplierValue(dist, () => 0.5),  5);
  equal(pickMultiplierValue(dist, () => 0.99), 9);
});

t('pickMultiplierValue: empty distribution returns 1', () => {
  equal(pickMultiplierValue([], () => 0.5), 1);
  equal(pickMultiplierValue(null, () => 0.5), 1);
});

t('aggregateValues additive: [2,3,5] → 10', () => {
  equal(aggregateValues([2, 3, 5], 'additive'), 10);
});

t('aggregateValues multiplicative: [2,3,5] → 30', () => {
  equal(aggregateValues([2, 3, 5], 'multiplicative'), 30);
});

t('aggregateValues empty array → additive 0, multiplicative 1', () => {
  equal(aggregateValues([], 'additive'),       0);
  equal(aggregateValues([], 'multiplicative'), 1);
  equal(aggregateValues(null, 'additive'),       0);
  equal(aggregateValues(null, 'multiplicative'), 1);
});

t('emitHoldAndWinLockedOrbMultiplierCSS: enabled emits .hwlom-chip class', () => {
  const css = emitHoldAndWinLockedOrbMultiplierCSS(resolveConfig({ holdAndWinLockedOrbMultiplier: { enabled: true } }));
  ok(css.includes('.hwlom-chip'));
  ok(css.includes('@keyframes hwlom-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitHoldAndWinLockedOrbMultiplierCSS: empty when disabled', () => {
  const css = emitHoldAndWinLockedOrbMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.hwlom-chip'));
});

t('emitHoldAndWinLockedOrbMultiplierMarkup: empty when disabled', () => {
  const m = emitHoldAndWinLockedOrbMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('hwlom-root'));
});

t('emitHoldAndWinLockedOrbMultiplierRuntime: registers HookBus listeners', () => {
  const r = emitHoldAndWinLockedOrbMultiplierRuntime(resolveConfig({ holdAndWinLockedOrbMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('onHoldAndWinLock'"));
  ok(r.includes("HookBus.on('onHoldAndWinEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onLockedOrbMultiplierRolled'));
  ok(r.includes('onLockedOrbMultiplierFinal'));
  ok(r.includes('__HW_LOCKED_ORB_MULT_WIRED__'));
});

t('emitHoldAndWinLockedOrbMultiplierRuntime: empty when disabled', () => {
  const r = emitHoldAndWinLockedOrbMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__HW_LOCKED_ORB_MULT_WIRED__'));
});

t('emitHoldAndWinLockedOrbMultiplierRuntime: includes HW_STATE.active guard', () => {
  const r = emitHoldAndWinLockedOrbMultiplierRuntime(resolveConfig({ holdAndWinLockedOrbMultiplier: { enabled: true } }));
  ok(r.includes('HW_STATE'));
  ok(r.includes('active'));
});
