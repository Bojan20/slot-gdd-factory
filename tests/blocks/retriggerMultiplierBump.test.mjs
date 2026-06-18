/**
 * tests/blocks/retriggerMultiplierBump.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitRetriggerMultiplierBumpCSS,
  emitRetriggerMultiplierBumpMarkup,
  emitRetriggerMultiplierBumpRuntime,
  nextLadderValue,
} from '../../src/blocks/retriggerMultiplierBump.mjs';

t('defaultConfig disabled, mode=step', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.mode, 'step');
  equal(c.step, 1);
});

t('resolveConfig clamps step to [1, 50]', () => {
  const lo = resolveConfig({ retriggerMultiplierBump: { step: -5 } });
  const hi = resolveConfig({ retriggerMultiplierBump: { step: 999 } });
  equal(lo.step, 1);
  equal(hi.step, 50);
});

t('resolveConfig sorts ladder ascending (defensive)', () => {
  const c = resolveConfig({ retriggerMultiplierBump: { ladder: [10, 1, 5, 3] } });
  deepEqual(c.ladder, [1, 3, 5, 10]);
});

t('resolveConfig: invalid mode falls back to step', () => {
  const c = resolveConfig({ retriggerMultiplierBump: { mode: 'turbo' } });
  equal(c.mode, 'step');
});

t('nextLadderValue: walks past current', () => {
  equal(nextLadderValue([1, 2, 3, 5, 10], 1), 2);
  equal(nextLadderValue([1, 2, 3, 5, 10], 3), 5);
  equal(nextLadderValue([1, 2, 3, 5, 10], 5), 10);
});

t('nextLadderValue: saturates at top', () => {
  equal(nextLadderValue([1, 2, 3], 10), 3);
});

t('nextLadderValue: empty ladder returns current', () => {
  equal(nextLadderValue([], 7), 7);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitRetriggerMultiplierBumpCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip class + bump keyframes', () => {
  const css = emitRetriggerMultiplierBumpCSS(resolveConfig({ retriggerMultiplierBump: { enabled: true } }));
  ok(css.includes('.rmb-chip'));
  ok(css.includes('@keyframes rmb-bump'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits chip with ARIA contract', () => {
  const m = emitRetriggerMultiplierBumpMarkup(resolveConfig({ retriggerMultiplierBump: { enabled: true } }));
  ok(m.includes('id="rmbChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitRuntime enabled wires onFsTrigger/onFsRetrigger/onFsEnd', () => {
  const r = emitRetriggerMultiplierBumpRuntime(resolveConfig({ retriggerMultiplierBump: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsRetrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onRetriggerMultiplierBumped'));
  ok(r.includes('__RETRIGGER_MULT_WIRED__'));
});

t('emitRuntime: ladder mode bakes ladder array into runtime', () => {
  const r = emitRetriggerMultiplierBumpRuntime(resolveConfig({
    retriggerMultiplierBump: { enabled: true, mode: 'ladder', ladder: [1, 2, 4, 8] },
  }));
  ok(r.includes('[1,2,4,8]'));
  ok(r.includes('MODE   = "ladder"'));
});
