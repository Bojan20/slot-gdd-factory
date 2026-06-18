/**
 * tests/blocks/mysterySymbolMultiplier.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitMysterySymbolMultiplierCSS,
  emitMysterySymbolMultiplierRuntime,
  pickMysteryMultValue,
} from '../../src/blocks/mysterySymbolMultiplier.mjs';

t('defaultConfig disabled, distribution present', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.distribution));
  equal(c.mysterySymbolId, '?');
});

t('resolveConfig enables + accepts custom mysterySymbolId', () => {
  const c = resolveConfig({ mysterySymbolMultiplier: { enabled: true, mysterySymbolId: 'MY' } });
  equal(c.enabled, true);
  equal(c.mysterySymbolId, 'MY');
});

t('resolveConfig rejects malformed mysterySymbolId', () => {
  const c = resolveConfig({ mysterySymbolMultiplier: { mysterySymbolId: 'lower' } });
  equal(c.mysterySymbolId, '?');
});

t('resolveConfig clamps revealProbability to [0, 1]', () => {
  const lo = resolveConfig({ mysterySymbolMultiplier: { revealProbability: -1 } });
  const hi = resolveConfig({ mysterySymbolMultiplier: { revealProbability: 5 } });
  equal(lo.revealProbability, 0);
  equal(hi.revealProbability, 1);
});

t('pickMysteryMultValue is deterministic with seeded RNG', () => {
  const d = [{ value: 2, weight: 1 }, { value: 9, weight: 1 }];
  equal(pickMysteryMultValue(d, () => 0.0), 2);
  equal(pickMysteryMultValue(d, () => 0.9), 9);
});

t('emitCSS disabled returns no CSS', () => {
  const css = emitMysterySymbolMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
});

t('emitCSS enabled emits chip class + flip keyframes + prefers-reduced-motion', () => {
  const css = emitMysterySymbolMultiplierCSS(resolveConfig({ mysterySymbolMultiplier: { enabled: true } }));
  ok(css.includes('.cell.has-mystery-mult-chip'));
  ok(css.includes('@keyframes msm-flip'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onSpinResult/onTumbleStep/preSpin', () => {
  const r = emitMysterySymbolMultiplierRuntime(resolveConfig({ mysterySymbolMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onMysteryMultiplierRevealed'));
  ok(r.includes('__MYSTERY_MULT_WIRED__'));
});

t('emitRuntime disabled is empty IIFE', () => {
  const r = emitMysterySymbolMultiplierRuntime(resolveConfig({}));
  ok(!r.includes('__MYSTERY_MULT_WIRED__'));
});
