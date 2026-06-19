/**
 * tests/blocks/mysteryWildReveal.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitMysteryWildRevealCSS,
  emitMysteryWildRevealRuntime,
  shouldRevealAsWild,
} from '../../src/blocks/mysteryWildReveal.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.mysterySymbolId, '?');
  equal(c.wildSymbolId, 'W');
  equal(c.revealProbability, 1.0);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ mysteryWildReveal: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: rejects lowercase wildSymbolId', () => {
  const c = resolveConfig({ mysteryWildReveal: { wildSymbolId: 'wild' } });
  equal(c.wildSymbolId, 'W');
});

t('resolveConfig: accepts uppercase mystery symbol id', () => {
  const c = resolveConfig({ mysteryWildReveal: { mysterySymbolId: 'MY' } });
  equal(c.mysterySymbolId, 'MY');
});

t('resolveConfig: clamps revealProbability to [0, 1]', () => {
  const lo = resolveConfig({ mysteryWildReveal: { revealProbability: -1 } });
  const hi = resolveConfig({ mysteryWildReveal: { revealProbability: 5 } });
  equal(lo.revealProbability, 0);
  equal(hi.revealProbability, 1);
});

t('resolveConfig: clamps fontSizePx to [11, 48]', () => {
  const lo = resolveConfig({ mysteryWildReveal: { fontSizePx: 5 } });
  const hi = resolveConfig({ mysteryWildReveal: { fontSizePx: 99 } });
  equal(lo.fontSizePx, 11);
  equal(hi.fontSizePx, 48);
});

t('resolveConfig: rejects invalid hex wildColor', () => {
  const c = resolveConfig({ mysteryWildReveal: { wildColor: 'orange' } });
  equal(c.wildColor, '#ff9a40');
});

t('shouldRevealAsWild: probability 1.0 always reveals', () => {
  equal(shouldRevealAsWild(() => 0.99, 1.0), true);
  equal(shouldRevealAsWild(() => 0.0, 1.0), true);
});

t('shouldRevealAsWild: probability 0 never reveals', () => {
  equal(shouldRevealAsWild(() => 0.0, 0), false);
});

t('shouldRevealAsWild: deterministic RNG controls outcome', () => {
  equal(shouldRevealAsWild(() => 0.1, 0.5), true);
  equal(shouldRevealAsWild(() => 0.9, 0.5), false);
});

t('shouldRevealAsWild: handles malformed probability', () => {
  equal(shouldRevealAsWild(() => 0.5, NaN), false);
  equal(shouldRevealAsWild(() => 0.5, null), false);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitMysteryWildRevealCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits reveal class + flip keyframes + reduced-motion gate', () => {
  const css = emitMysteryWildRevealCSS(resolveConfig({ mysteryWildReveal: { enabled: true } }));
  ok(css.includes('.cell.has-mystery-wild-reveal'));
  ok(css.includes('@keyframes mwr-flip'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onSpinResult/onTumbleStep/preSpin', () => {
  const r = emitMysteryWildRevealRuntime(resolveConfig({ mysteryWildReveal: { enabled: true } }));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onMysteryWildRevealed'));
  ok(r.includes('__MYSTERY_WILD_WIRED__'));
});

t('emitRuntime: try/catch around emit (anti-silent-failure)', () => {
  const r = emitMysteryWildRevealRuntime(resolveConfig({ mysteryWildReveal: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitMysteryWildRevealRuntime(resolveConfig({})).includes('__MYSTERY_WILD_WIRED__'));
});

t('emitRuntime bakes wild + mystery symbol ids into IIFE', () => {
  const r = emitMysteryWildRevealRuntime(resolveConfig({
    mysteryWildReveal: { enabled: true, wildSymbolId: 'WLD', mysterySymbolId: 'MY' },
  }));
  ok(r.includes('"WLD"'));
  ok(r.includes('"MY"'));
});
