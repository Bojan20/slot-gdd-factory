/**
 * tests/blocks/randomLightningMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `randomLightningMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitRandomLightningMultiplierCSS,
  emitRandomLightningMultiplierMarkup,
  emitRandomLightningMultiplierRuntime,
  pickLightningMultiplier,
  shouldStrike,
} from '../../src/blocks/randomLightningMultiplier.mjs';

t('defaultConfig: disabled + triggerProb 0.05 + sensible distribution', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.triggerProbability, 0.05);
  ok(Array.isArray(c.distribution));
  ok(c.distribution.length >= 3);
  ok(c.vfxDurationMs >= 200 && c.vfxDurationMs <= 3000);
  equal(c.appliesOnlyOnBaseWin, true);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ randomLightningMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps triggerProbability to [0,1]', () => {
  const hi = resolveConfig({ randomLightningMultiplier: { triggerProbability: 5 } });
  const lo = resolveConfig({ randomLightningMultiplier: { triggerProbability: -3 } });
  equal(hi.triggerProbability, 1);
  equal(lo.triggerProbability, 0);
});

t('resolveConfig: rejects malformed distribution → keeps default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ randomLightningMultiplier: { distribution: [{ value: -1, weight: -1 }] } });
  deepEqual(c.distribution.map(e => e.value), def.distribution.map(e => e.value));
});

t('resolveConfig: clamps vfxDurationMs to bounds', () => {
  const hi = resolveConfig({ randomLightningMultiplier: { vfxDurationMs: 999999 } });
  const lo = resolveConfig({ randomLightningMultiplier: { vfxDurationMs: 1 } });
  ok(hi.vfxDurationMs <= 3000);
  ok(lo.vfxDurationMs >= 200);
});

t('resolveConfig: accepts valid hex colors (bolt + glow)', () => {
  const c = resolveConfig({ randomLightningMultiplier: { boltColor: '#ff00aa', glowColor: '#00ddee' } });
  equal(c.boltColor, '#ff00aa');
  equal(c.glowColor, '#00ddee');
});

t('pickLightningMultiplier: deterministic seeded RNG covers all entries', () => {
  const dist = [
    { value: 2,  weight: 1 },
    { value: 5,  weight: 1 },
    { value: 10, weight: 1 },
  ];
  /* RNG returns 0.0 → first bucket; 0.5 → middle; 0.99 → last. */
  equal(pickLightningMultiplier(dist, () => 0.0),  2);
  equal(pickLightningMultiplier(dist, () => 0.5),  5);
  equal(pickLightningMultiplier(dist, () => 0.99), 10);
});

t('pickLightningMultiplier: empty distribution returns 1', () => {
  equal(pickLightningMultiplier([], () => 0.5), 1);
});

t('shouldStrike: probability 1.0 always strikes', () => {
  equal(shouldStrike(1.0, () => 0.99), true);
  equal(shouldStrike(1.0, () => 0.0),  true);
});

t('shouldStrike: probability 0.0 never strikes', () => {
  equal(shouldStrike(0.0, () => 0.0),  false);
  equal(shouldStrike(0.0, () => 0.99), false);
});

t('shouldStrike: deterministic RNG returns predictable boolean', () => {
  /* p=0.5 + rng=0.4 → 0.4 < 0.5 → strike. p=0.5 + rng=0.6 → no strike. */
  equal(shouldStrike(0.5, () => 0.4), true);
  equal(shouldStrike(0.5, () => 0.6), false);
});

t('emitRandomLightningMultiplierCSS: enabled emits bolt overlay class + keyframes', () => {
  const css = emitRandomLightningMultiplierCSS(resolveConfig({ randomLightningMultiplier: { enabled: true } }));
  ok(css.includes('.lightning-bolt-overlay'));
  ok(css.includes('@keyframes rlm-strike'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRandomLightningMultiplierCSS: disabled → no CSS', () => {
  const css = emitRandomLightningMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.lightning-bolt-overlay'));
});

t('emitRandomLightningMultiplierMarkup: disabled → no overlay div', () => {
  const m = emitRandomLightningMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('id="rlmBoltOverlay"'));
});

t('emitRandomLightningMultiplierRuntime: enabled wires HookBus listeners', () => {
  const r = emitRandomLightningMultiplierRuntime(resolveConfig({ randomLightningMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onLightningStrike'));
  ok(r.includes('onLightningStrikeMissed'));
  ok(r.includes('__RLM_WIRED__'));
});

t('emitRandomLightningMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitRandomLightningMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__RLM_WIRED__'));
});

t('emitRandomLightningMultiplierRuntime: includes FS guard + HW guard', () => {
  const r = emitRandomLightningMultiplierRuntime(resolveConfig({ randomLightningMultiplier: { enabled: true } }));
  ok(r.includes('_isFsActive'));
  ok(r.includes('_isHwActive'));
  ok(r.includes('HW_STATE'));
  ok(r.includes('FREESPINS'));
});
