/**
 * tests/blocks/expandingWildMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `expandingWildMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitExpandingWildMultiplierCSS,
  emitExpandingWildMultiplierMarkup,
  emitExpandingWildMultiplierRuntime,
  rollWildMultiplier,
  aggregateWildMults,
} from '../../src/blocks/expandingWildMultiplier.mjs';

/* ── config: defaults ──────────────────────────────────────────────── */

t('defaultConfig: disabled + sensible distribution', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.distribution));
  ok(c.distribution.length >= 3);
  ok(c.distribution.every(e => Number.isFinite(e.value) && e.value > 0));
  ok(c.distribution.every(e => Number.isFinite(e.weight) && e.weight > 0));
  equal(c.aggregation, 'multiplicative');
  equal(c.appliesIn, 'both');
});

/* ── config: resolve ───────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ expandingWildMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps multTagFontPx + pulseMs to bounds', () => {
  const lo = resolveConfig({ expandingWildMultiplier: { multTagFontPx: -50, pulseMs: 1 } });
  const hi = resolveConfig({ expandingWildMultiplier: { multTagFontPx: 999, pulseMs: 999999 } });
  ok(lo.multTagFontPx >= 10);
  ok(lo.pulseMs       >= 200);
  ok(hi.multTagFontPx <= 22);
  ok(hi.pulseMs       <= 2000);
});

t('resolveConfig: rejects invalid aggregation → keeps default', () => {
  const def = defaultConfig();
  const c   = resolveConfig({ expandingWildMultiplier: { aggregation: 'avg-of-doom' } });
  equal(c.aggregation, def.aggregation);
});

t('resolveConfig: rejects invalid appliesIn (only base/fs/both)', () => {
  const def = defaultConfig();
  const c   = resolveConfig({ expandingWildMultiplier: { appliesIn: 'bonus' } });
  equal(c.appliesIn, def.appliesIn);
  /* sanity: each valid value is accepted */
  for (const v of ['base', 'fs', 'both']) {
    equal(resolveConfig({ expandingWildMultiplier: { appliesIn: v } }).appliesIn, v);
  }
});

t('resolveConfig: accepts valid hex wildColor', () => {
  const c = resolveConfig({ expandingWildMultiplier: { wildColor: '#abcdef' } });
  equal(c.wildColor, '#abcdef');
});

/* ── pure helper: rollWildMultiplier ───────────────────────────────── */

t('rollWildMultiplier: deterministic seeded RNG covers all entries', () => {
  const dist = [
    { value:  2, weight: 1 },
    { value:  7, weight: 1 },
    { value: 13, weight: 1 },
  ];
  equal(rollWildMultiplier(dist, () => 0.0),  2);
  equal(rollWildMultiplier(dist, () => 0.5),  7);
  equal(rollWildMultiplier(dist, () => 0.99), 13);
});

t('rollWildMultiplier: empty distribution → 1', () => {
  equal(rollWildMultiplier([], () => 0.5), 1);
});

/* ── pure helper: aggregateWildMults ───────────────────────────────── */

t('aggregateWildMults additive: [2,3,5] → 10', () => {
  equal(aggregateWildMults([2, 3, 5], 'additive'), 10);
});

t('aggregateWildMults multiplicative: [2,3,5] → 30', () => {
  equal(aggregateWildMults([2, 3, 5], 'multiplicative'), 30);
});

t('aggregateWildMults empty → additive 0, multiplicative 1', () => {
  equal(aggregateWildMults([], 'additive'), 0);
  equal(aggregateWildMults([], 'multiplicative'), 1);
});

/* ── emit: CSS ─────────────────────────────────────────────────────── */

t('emitExpandingWildMultiplierCSS: enabled contains .is-mult-wild class', () => {
  const css = emitExpandingWildMultiplierCSS(resolveConfig({ expandingWildMultiplier: { enabled: true } }));
  ok(css.includes('.is-mult-wild'));
  ok(css.includes('@keyframes ewm-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitExpandingWildMultiplierCSS: disabled → no CSS', () => {
  const css = emitExpandingWildMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.is-mult-wild'));
});

/* ── emit: Markup ──────────────────────────────────────────────────── */

t('emitExpandingWildMultiplierMarkup: disabled emits no badges up-front', () => {
  const m = emitExpandingWildMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('ewm-tag'));
  ok(!m.includes('ewmAnchor'));
});

/* ── emit: Runtime ─────────────────────────────────────────────────── */

t('emitExpandingWildMultiplierRuntime: registers HookBus listeners', () => {
  const r = emitExpandingWildMultiplierRuntime(resolveConfig({ expandingWildMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onExpandingWildMultRolled'));
  ok(r.includes('onExpandingWildMultsCleared'));
  ok(r.includes('__EWM_WIRED__'));
});

t('emitExpandingWildMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitExpandingWildMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__EWM_WIRED__'));
});

t('emitExpandingWildMultiplierRuntime: includes HW guard + appliesIn branch', () => {
  const r = emitExpandingWildMultiplierRuntime(resolveConfig({ expandingWildMultiplier: { enabled: true } }));
  /* HW guard so paint never collides with Hold & Win. */
  ok(r.includes('_isHwActive'));
  ok(r.includes('HW_STATE'));
  /* appliesIn branch must distinguish base vs fs vs both. */
  ok(r.includes('APPLIES_IN'));
  ok(r.includes("'both'"));
  ok(r.includes("'fs'"));
  ok(r.includes("'base'"));
});
