/**
 * tests/blocks/matchThreeBonusReveal.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitMatchThreeBonusRevealCSS,
  emitMatchThreeBonusRevealMarkup,
  emitMatchThreeBonusRevealRuntime,
  pickRevealValue,
} from '../../src/blocks/matchThreeBonusReveal.mjs';

t('defaultConfig disabled, distribution incl. STOP', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(c.distribution.some(e => e.value === 'STOP'));
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ matchThreeBonusReveal: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig accepts custom distribution with STOP', () => {
  const c = resolveConfig({ matchThreeBonusReveal: {
    enabled: true,
    distribution: [{ value: 1, weight: 1 }, { value: 'STOP', weight: 1 }],
  }});
  equal(c.distribution.length, 2);
  ok(c.distribution.some(e => e.value === 'STOP'));
});

t('resolveConfig rejects distribution with < 2 entries', () => {
  const def = defaultConfig();
  const c = resolveConfig({ matchThreeBonusReveal: {
    distribution: [{ value: 1, weight: 1 }],
  }});
  equal(c.distribution.length, def.distribution.length);
});

t('resolveConfig clamps fontSizePx to [11, 48]', () => {
  const lo = resolveConfig({ matchThreeBonusReveal: { fontSizePx: 5 } });
  const hi = resolveConfig({ matchThreeBonusReveal: { fontSizePx: 99 } });
  equal(lo.fontSizePx, 11);
  equal(hi.fontSizePx, 48);
});

t('resolveConfig rejects invalid hex colors', () => {
  const c = resolveConfig({ matchThreeBonusReveal: {
    overlayBg: 'orange', cardColor: 'blue', cardRevealedColor: 'red',
  }});
  equal(c.overlayBg, '#08111d');
  equal(c.cardColor, '#1a2840');
  equal(c.cardRevealedColor, '#ffd84d');
});

t('pickRevealValue: deterministic seeded RNG', () => {
  const d = [
    { value: 1, weight: 1 },
    { value: 5, weight: 1 },
    { value: 'STOP', weight: 1 },
  ];
  equal(pickRevealValue(d, () => 0.0), 1);
  equal(pickRevealValue(d, () => 0.5), 5);
  equal(pickRevealValue(d, () => 0.9), 'STOP');
});

t('pickRevealValue: empty distribution returns 0', () => {
  equal(pickRevealValue([], () => 0.5), 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitMatchThreeBonusRevealCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits overlay + cards + flip keyframes + reduced-motion', () => {
  const css = emitMatchThreeBonusRevealCSS(resolveConfig({ matchThreeBonusReveal: { enabled: true } }));
  ok(css.includes('.m3b-overlay'));
  ok(css.includes('.m3b-card'));
  ok(css.includes('@keyframes m3b-flip'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits dialog + 9 cards', () => {
  const m = emitMatchThreeBonusRevealMarkup(resolveConfig({ matchThreeBonusReveal: { enabled: true } }));
  ok(m.includes('id="m3bOverlay"'));
  ok(m.includes('role="dialog"'));
  ok(m.includes('aria-modal="true"'));
  const cardCount = (m.match(/data-m3b-idx=/g) || []).length;
  equal(cardCount, 9);
});

t('emitRuntime enabled wires 2 hooks + 3 events + sentinel', () => {
  const r = emitMatchThreeBonusRevealRuntime(resolveConfig({ matchThreeBonusReveal: { enabled: true } }));
  ok(r.includes("HookBus.on('onMatchThreeBonusRequested'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onMatchThreeBonusEntered'));
  ok(r.includes('onMatchThreeBonusRevealed'));
  ok(r.includes('onMatchThreeBonusEnded'));
  ok(r.includes('__MATCH3_BONUS_WIRED__'));
});

t('emitRuntime: try/catch around emit + console.warn surface', () => {
  const r = emitMatchThreeBonusRevealRuntime(resolveConfig({ matchThreeBonusReveal: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime exposes QA hook window.match3BonusForceReveal', () => {
  const r = emitMatchThreeBonusRevealRuntime(resolveConfig({ matchThreeBonusReveal: { enabled: true } }));
  ok(r.includes('match3BonusForceReveal'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitMatchThreeBonusRevealRuntime(resolveConfig({})).includes('__MATCH3_BONUS_WIRED__'));
});
