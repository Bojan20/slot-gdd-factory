/**
 * tests/blocks/tumbleGrowingFsMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `tumbleGrowingFsMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitTumbleGrowingFsMultiplierCSS,
  emitTumbleGrowingFsMultiplierMarkup,
  emitTumbleGrowingFsMultiplierRuntime,
  computeNextMult,
} from '../../src/blocks/tumbleGrowingFsMultiplier.mjs';

t('defaultConfig: disabled + startMult=1', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.startMult, 1);
  equal(c.growPerTumble, 1);
  ok(c.maxMult >= 2);
  ok(c.fontSizePx >= 12 && c.fontSizePx <= 48);
  ok(c.pulseMs >= 200 && c.pulseMs <= 2000);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps startMult/growPerTumble/maxMult to bounds', () => {
  const c = resolveConfig({
    tumbleGrowingFsMultiplier: {
      startMult: 999,
      growPerTumble: 999,
      maxMult: 999999,
    },
  });
  ok(c.startMult     <= 10);
  ok(c.growPerTumble <= 5);
  ok(c.maxMult       <= 1000);

  const c2 = resolveConfig({
    tumbleGrowingFsMultiplier: {
      startMult: -50,
      growPerTumble: -50,
      maxMult: -50,
    },
  });
  ok(c2.startMult     >= 1);
  ok(c2.growPerTumble >= 1);
  ok(c2.maxMult       >= 2);
});

t('resolveConfig: clamps fontSizePx + pulseMs', () => {
  const c = resolveConfig({
    tumbleGrowingFsMultiplier: { fontSizePx: 999, pulseMs: 999999 },
  });
  ok(c.fontSizePx <= 48);
  ok(c.pulseMs    <= 2000);

  const c2 = resolveConfig({
    tumbleGrowingFsMultiplier: { fontSizePx: -10, pulseMs: -10 },
  });
  ok(c2.fontSizePx >= 12);
  ok(c2.pulseMs    >= 200);
});

t('resolveConfig: rejects invalid chipPosition, falls back to default', () => {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: { chipPosition: 'middle-of-nowhere' } });
  equal(c.chipPosition, 'top');
});

t('resolveConfig: accepts valid hex chipColor', () => {
  const c = resolveConfig({ tumbleGrowingFsMultiplier: { chipColor: '#ff00aa' } });
  equal(c.chipColor, '#ff00aa');
  /* Invalid → default. */
  const c2 = resolveConfig({ tumbleGrowingFsMultiplier: { chipColor: 'notacolor' } });
  equal(c2.chipColor, defaultConfig().chipColor);
});

t('computeNextMult: 1 + 1 = 2 (normal grow)', () => {
  equal(computeNextMult(1, 1, 100), 2);
  equal(computeNextMult(5, 2, 100), 7);
});

t('computeNextMult: cap respected (current=100, grow=5, max=100) → 100', () => {
  equal(computeNextMult(100, 5, 100), 100);
});

t('computeNextMult: large grow beyond cap → cap value', () => {
  equal(computeNextMult(50, 1000, 100), 100);
  equal(computeNextMult(99, 50,   100), 100);
});

t('emitTumbleGrowingFsMultiplierCSS: enabled contains .tgfm-chip class', () => {
  const css = emitTumbleGrowingFsMultiplierCSS(
    resolveConfig({ tumbleGrowingFsMultiplier: { enabled: true } })
  );
  ok(css.includes('.tgfm-chip'));
  ok(css.includes('@keyframes tgfm-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitTumbleGrowingFsMultiplierCSS: disabled → no chip class', () => {
  const css = emitTumbleGrowingFsMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.tgfm-chip'));
});

t('emitTumbleGrowingFsMultiplierMarkup: disabled → no chip div', () => {
  const m = emitTumbleGrowingFsMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('id="tgfmChip"'));
});

t('emitTumbleGrowingFsMultiplierMarkup: enabled emits chip + ARIA contract', () => {
  const m = emitTumbleGrowingFsMultiplierMarkup(
    resolveConfig({ tumbleGrowingFsMultiplier: { enabled: true } })
  );
  ok(m.includes('id="tgfmChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitTumbleGrowingFsMultiplierRuntime: registers HookBus listeners', () => {
  const r = emitTumbleGrowingFsMultiplierRuntime(
    resolveConfig({ tumbleGrowingFsMultiplier: { enabled: true } })
  );
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onTumbleMultiplierGrown'));
  ok(r.includes('onTumbleMultiplierReset'));
  ok(r.includes('__TGFM_WIRED__'));
});

t('emitTumbleGrowingFsMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitTumbleGrowingFsMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__TGFM_WIRED__'));
});

t('emitTumbleGrowingFsMultiplierRuntime: includes FS-active + HW guard', () => {
  const r = emitTumbleGrowingFsMultiplierRuntime(
    resolveConfig({ tumbleGrowingFsMultiplier: { enabled: true } })
  );
  ok(r.includes('_isFsActive'));
  ok(r.includes('_isHwActive'));
  ok(r.includes('HW_STATE'));
  ok(r.includes('FREESPINS'));
});
