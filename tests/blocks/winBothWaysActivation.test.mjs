/**
 * tests/blocks/winBothWaysActivation.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitWinBothWaysActivationCSS,
  emitWinBothWaysActivationMarkup,
  emitWinBothWaysActivationRuntime,
} from '../../src/blocks/winBothWaysActivation.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.chipPosition, 'top');
  equal(c.showChip, true);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ winBothWaysActivation: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: invalid chipPosition falls back to top', () => {
  const c = resolveConfig({ winBothWaysActivation: { chipPosition: 'inside' } });
  equal(c.chipPosition, 'top');
});

t('resolveConfig: accepts valid positions', () => {
  for (const p of ['top', 'bottom', 'topRight', 'topLeft']) {
    const c = resolveConfig({ winBothWaysActivation: { enabled: true, chipPosition: p } });
    equal(c.chipPosition, p);
  }
});

t('resolveConfig: rejects invalid hex chipColor', () => {
  const c = resolveConfig({ winBothWaysActivation: { chipColor: 'green' } });
  equal(c.chipColor, '#7af2c8');
});

t('resolveConfig: showChip can be toggled off', () => {
  const c = resolveConfig({ winBothWaysActivation: { enabled: true, showChip: false } });
  equal(c.showChip, false);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitWinBothWaysActivationCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + flash keyframes + reduced-motion', () => {
  const css = emitWinBothWaysActivationCSS(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(css.includes('.wbw-chip'));
  ok(css.includes('@keyframes wbw-flash'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits chip + ARIA contract', () => {
  const m = emitWinBothWaysActivationMarkup(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(m.includes('id="wbwChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitMarkup hidden returns no markup', () => {
  const m = emitWinBothWaysActivationMarkup(resolveConfig({ winBothWaysActivation: { enabled: true, showChip: false } }));
  ok(m.includes('disabled or hidden'));
});

t('emitRuntime enabled wires onFsTrigger/onFsEnd + emits 2 events + sentinel', () => {
  const r = emitWinBothWaysActivationRuntime(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onWinBothWaysActivated'));
  ok(r.includes('onWinBothWaysDeactivated'));
  ok(r.includes('__WIN_BOTH_WAYS_WIRED__'));
});

t('emitRuntime sets canonical window.__WIN_BOTH_WAYS__ flag', () => {
  const r = emitWinBothWaysActivationRuntime(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(r.includes('window.__WIN_BOTH_WAYS__'));
});

t('emitRuntime: try/catch + console.warn (anti-silent-failure)', () => {
  const r = emitWinBothWaysActivationRuntime(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime: idempotent on retrigger (no double-emit)', () => {
  const r = emitWinBothWaysActivationRuntime(resolveConfig({ winBothWaysActivation: { enabled: true } }));
  ok(r.includes('idempotent on retrigger'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitWinBothWaysActivationRuntime(resolveConfig({})).includes('__WIN_BOTH_WAYS_WIRED__'));
});
