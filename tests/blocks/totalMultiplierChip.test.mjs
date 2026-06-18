/**
 * tests/blocks/totalMultiplierChip.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitTotalMultiplierChipCSS,
  emitTotalMultiplierChipMarkup,
  emitTotalMultiplierChipRuntime,
} from '../../src/blocks/totalMultiplierChip.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.position, 'topLeft');
  equal(c.hideWhenOne, true);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ totalMultiplierChip: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: invalid position falls back to topLeft', () => {
  const c = resolveConfig({ totalMultiplierChip: { position: 'middle' } });
  equal(c.position, 'topLeft');
});

t('resolveConfig: hideWhenOne can be turned off', () => {
  const c = resolveConfig({ totalMultiplierChip: { enabled: true, hideWhenOne: false } });
  equal(c.hideWhenOne, false);
});

t('resolveConfig: clamps fontSizePx into [11, 36]', () => {
  const lo = resolveConfig({ totalMultiplierChip: { fontSizePx: 1 } });
  const hi = resolveConfig({ totalMultiplierChip: { fontSizePx: 999 } });
  ok(lo.fontSizePx >= 11);
  ok(hi.fontSizePx <= 36);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitTotalMultiplierChipCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + pulse keyframes', () => {
  const css = emitTotalMultiplierChipCSS(resolveConfig({ totalMultiplierChip: { enabled: true } }));
  ok(css.includes('.tmc-chip'));
  ok(css.includes('@keyframes tmc-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits chip + ARIA contract', () => {
  const m = emitTotalMultiplierChipMarkup(resolveConfig({ totalMultiplierChip: { enabled: true } }));
  ok(m.includes('id="tmcChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitRuntime enabled wires onMultiplierChanged + preSpin + onFsEnd', () => {
  const r = emitTotalMultiplierChipRuntime(resolveConfig({ totalMultiplierChip: { enabled: true } }));
  ok(r.includes("HookBus.on('onMultiplierChanged'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('__TOTAL_MULT_CHIP_WIRED__'));
});

t('emitRuntime disabled is empty', () => {
  const r = emitTotalMultiplierChipRuntime(resolveConfig({}));
  ok(!r.includes('__TOTAL_MULT_CHIP_WIRED__'));
});
