/**
 * tests/blocks/perFsSpinMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `perFsSpinMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitPerFsSpinMultiplierCSS,
  emitPerFsSpinMultiplierMarkup,
  emitPerFsSpinMultiplierRuntime,
  pickValueFromDistribution,
} from '../../src/blocks/perFsSpinMultiplier.mjs';

t('defaultConfig: disabled + sensible distribution', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.distribution));
  ok(c.distribution.length >= 3);
  ok(c.fontSizePx >= 11 && c.fontSizePx <= 48);
  ok(c.durationMs >= 200 && c.durationMs <= 8000);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ perFsSpinMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: invalid chipPosition falls back to default', () => {
  const c = resolveConfig({ perFsSpinMultiplier: { chipPosition: 'inside-out' } });
  equal(c.chipPosition, 'top');
});

t('resolveConfig: clamps fontSizePx + durationMs to bounds', () => {
  const c = resolveConfig({ perFsSpinMultiplier: { fontSizePx: 999, durationMs: 999999 } });
  ok(c.fontSizePx <= 48);
  ok(c.durationMs <= 8000);
});

t('resolveConfig: rejects empty distribution → keeps default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ perFsSpinMultiplier: { distribution: [{ value: -1, weight: -1 }] } });
  deepEqual(c.distribution.map(e => e.value), def.distribution.map(e => e.value));
});

t('resolveConfig: accepts valid hex chipColor', () => {
  const c = resolveConfig({ perFsSpinMultiplier: { chipColor: '#ff00aa' } });
  equal(c.chipColor, '#ff00aa');
});

t('pickValueFromDistribution: deterministic seeded RNG covers all entries', () => {
  const dist = [
    { value: 1, weight: 1 },
    { value: 5, weight: 1 },
    { value: 9, weight: 1 },
  ];
  /* RNG returns 0.0 → first bucket; 0.5 → middle; 0.99 → last. */
  equal(pickValueFromDistribution(dist, () => 0.0),  1);
  equal(pickValueFromDistribution(dist, () => 0.5),  5);
  equal(pickValueFromDistribution(dist, () => 0.99), 9);
});

t('pickValueFromDistribution: empty array returns 1', () => {
  equal(pickValueFromDistribution([], () => 0.5), 1);
});

t('pickValueFromDistribution: zero-total weights returns first value', () => {
  equal(pickValueFromDistribution([{ value: 7, weight: 0 }], () => 0.5), 7);
});

t('emitPerFsSpinMultiplierCSS: disabled → no CSS', () => {
  const css = emitPerFsSpinMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.pfsm-chip'));
});

t('emitPerFsSpinMultiplierCSS: enabled emits chip class + keyframes', () => {
  const css = emitPerFsSpinMultiplierCSS(resolveConfig({ perFsSpinMultiplier: { enabled: true } }));
  ok(css.includes('.pfsm-chip'));
  ok(css.includes('@keyframes pfsm-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitPerFsSpinMultiplierMarkup: enabled emits chip + ARIA contract', () => {
  const m = emitPerFsSpinMultiplierMarkup(resolveConfig({ perFsSpinMultiplier: { enabled: true } }));
  ok(m.includes('id="pfsmChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitPerFsSpinMultiplierRuntime: enabled wires HookBus.on onFsSpinResult + onFsEnd', () => {
  const r = emitPerFsSpinMultiplierRuntime(resolveConfig({ perFsSpinMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onPerFsSpinMultiplierRolled'));
  ok(r.includes('__PER_FS_SPIN_MULT_WIRED__'));
});

t('emitPerFsSpinMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitPerFsSpinMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__PER_FS_SPIN_MULT_WIRED__'));
});
