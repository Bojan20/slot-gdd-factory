/**
 * tests/blocks/moneyGrabGrid.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitMoneyGrabGridCSS,
  emitMoneyGrabGridMarkup,
  emitMoneyGrabGridRuntime,
  pickGridValue,
} from '../../src/blocks/moneyGrabGrid.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.rows, 4);
  equal(c.cols, 5);
  equal(c.maxPicks, 6);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ moneyGrabGrid: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps rows to [1, 8] and cols to [1, 8]', () => {
  const lo = resolveConfig({ moneyGrabGrid: { rows: 0, cols: 0 } });
  const hi = resolveConfig({ moneyGrabGrid: { rows: 99, cols: 99 } });
  equal(lo.rows, 1);
  equal(lo.cols, 1);
  equal(hi.rows, 8);
  equal(hi.cols, 8);
});

t('resolveConfig clamps maxPicks to [1, 30] AND total cells', () => {
  const c = resolveConfig({ moneyGrabGrid: { rows: 2, cols: 2, maxPicks: 99 } });
  equal(c.maxPicks, 4);   /* 2*2=4 caps the picks */
});

t('resolveConfig: empty/invalid distribution falls back to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ moneyGrabGrid: { distribution: [{ value: -1, weight: 1 }] } });
  equal(c.distribution.length, def.distribution.length);
});

t('resolveConfig rejects invalid hex colors', () => {
  const c = resolveConfig({ moneyGrabGrid: { overlayBg: 'bg', cardColor: 'cc' } });
  equal(c.overlayBg, '#08111d');
  equal(c.cardColor, '#1a3030');
});

t('pickGridValue: deterministic with RNG', () => {
  const d = [
    { value: 1, weight: 1 },
    { value: 100, weight: 1 },
  ];
  equal(pickGridValue(d, () => 0.0), 1);
  equal(pickGridValue(d, () => 0.99), 100);
});

t('pickGridValue: empty distribution returns 0', () => {
  equal(pickGridValue([], () => 0.5), 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitMoneyGrabGridCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits grid + flip keyframes + reduced-motion', () => {
  const css = emitMoneyGrabGridCSS(resolveConfig({ moneyGrabGrid: { enabled: true } }));
  ok(css.includes('.mgg-overlay'));
  ok(css.includes('.mgg-grid'));
  ok(css.includes('@keyframes mgg-flip'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits rows*cols cards', () => {
  const m = emitMoneyGrabGridMarkup(resolveConfig({ moneyGrabGrid: { enabled: true, rows: 3, cols: 4 } }));
  const cardCount = (m.match(/data-mgg-idx=/g) || []).length;
  equal(cardCount, 12);
});

t('emitMarkup has dialog ARIA contract', () => {
  const m = emitMoneyGrabGridMarkup(resolveConfig({ moneyGrabGrid: { enabled: true } }));
  ok(m.includes('id="mggOverlay"'));
  ok(m.includes('role="dialog"'));
  ok(m.includes('aria-modal="true"'));
});

t('emitRuntime enabled wires 2 hooks + 3 events + sentinel', () => {
  const r = emitMoneyGrabGridRuntime(resolveConfig({ moneyGrabGrid: { enabled: true } }));
  ok(r.includes("HookBus.on('onMoneyGrabRequested'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onMoneyGrabEntered'));
  ok(r.includes('onMoneyGrabRevealed'));
  ok(r.includes('onMoneyGrabEnded'));
  ok(r.includes('__MONEY_GRAB_WIRED__'));
});

t('emitRuntime: try/catch + console.warn (anti-silent-failure)', () => {
  const r = emitMoneyGrabGridRuntime(resolveConfig({ moneyGrabGrid: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitMoneyGrabGridRuntime(resolveConfig({})).includes('__MONEY_GRAB_WIRED__'));
});

t('emitRuntime exposes window.moneyGrabForceReveal QA hook', () => {
  const r = emitMoneyGrabGridRuntime(resolveConfig({ moneyGrabGrid: { enabled: true } }));
  ok(r.includes('moneyGrabForceReveal'));
});
