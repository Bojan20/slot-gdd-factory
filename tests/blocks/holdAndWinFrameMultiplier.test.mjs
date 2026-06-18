/**
 * tests/blocks/holdAndWinFrameMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `holdAndWinFrameMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitHoldAndWinFrameMultiplierCSS,
  emitHoldAndWinFrameMultiplierMarkup,
  emitHoldAndWinFrameMultiplierRuntime,
  tierBumpForLanding,
} from '../../src/blocks/holdAndWinFrameMultiplier.mjs';

t('defaultConfig: disabled + valid tier ladder', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.tierLadder));
  ok(c.tierLadder.length >= 2 && c.tierLadder.length <= 12);
  ok(c.tierLadder.every(v => Number.isFinite(v) && v >= 1));
  /* Default ladder is strictly increasing. */
  for (let i = 1; i < c.tierLadder.length; i++) {
    ok(c.tierLadder[i] > c.tierLadder[i - 1]);
  }
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ holdAndWinFrameMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps fontSizePx + durationMs to bounds', () => {
  const c = resolveConfig({
    holdAndWinFrameMultiplier: { fontSizePx: 999, durationMs: 999999 },
  });
  ok(c.fontSizePx <= 24);
  ok(c.fontSizePx >= 8);
  ok(c.durationMs <= 3000);
  ok(c.durationMs >= 200);
});

t('resolveConfig: rejects malformed tierLadder, falls back to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    holdAndWinFrameMultiplier: { tierLadder: 'not-an-array' },
  });
  deepEqual(c.tierLadder, def.tierLadder.slice());

  /* Too short → falls back. */
  const c2 = resolveConfig({ holdAndWinFrameMultiplier: { tierLadder: [1] } });
  deepEqual(c2.tierLadder, def.tierLadder.slice());

  /* Too long → falls back. */
  const longArr = Array.from({ length: 20 }, (_, i) => i + 1);
  const c3 = resolveConfig({ holdAndWinFrameMultiplier: { tierLadder: longArr } });
  deepEqual(c3.tierLadder, def.tierLadder.slice());
});

t('resolveConfig: accepts valid hex chipColor', () => {
  const c = resolveConfig({ holdAndWinFrameMultiplier: { chipColor: '#abcdef' } });
  equal(c.chipColor, '#abcdef');
});

t('tierBumpForLanding: walks default ladder 1 → 2 → 3 → 5 → 10', () => {
  const ladder = [1, 2, 3, 5, 10];
  equal(tierBumpForLanding(1, ladder), 2);
  equal(tierBumpForLanding(2, ladder), 3);
  equal(tierBumpForLanding(3, ladder), 5);
  equal(tierBumpForLanding(5, ladder), 10);
});

t('tierBumpForLanding: max tier returns max (no overflow)', () => {
  const ladder = [1, 2, 3, 5, 10];
  equal(tierBumpForLanding(10, ladder), 10);
  equal(tierBumpForLanding(999, ladder), 10);
});

t('emitHoldAndWinFrameMultiplierCSS: enabled emits .hwfm-chip class', () => {
  const css = emitHoldAndWinFrameMultiplierCSS(
    resolveConfig({ holdAndWinFrameMultiplier: { enabled: true } })
  );
  ok(css.includes('.hwfm-chip'));
  ok(css.includes('@keyframes hwfm-bump'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitHoldAndWinFrameMultiplierCSS: disabled → no CSS', () => {
  const css = emitHoldAndWinFrameMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.hwfm-chip'));
});

t('emitHoldAndWinFrameMultiplierMarkup: disabled → no markup', () => {
  const m = emitHoldAndWinFrameMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('hwfm-chip'));
});

t('emitHoldAndWinFrameMultiplierRuntime: registers HookBus listeners on intro/lock/end', () => {
  const r = emitHoldAndWinFrameMultiplierRuntime(
    resolveConfig({ holdAndWinFrameMultiplier: { enabled: true } })
  );
  ok(r.includes("HookBus.on('onHoldAndWinIntro'"));
  ok(r.includes("HookBus.on('onHoldAndWinLock'"));
  ok(r.includes("HookBus.on('onHoldAndWinEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onFrameMultiplierBumped'));
  ok(r.includes('onFrameMultiplierFinal'));
  ok(r.includes('__HW_FRAME_MULT_WIRED__'));
});

t('emitHoldAndWinFrameMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitHoldAndWinFrameMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__HW_FRAME_MULT_WIRED__'));
});

t('emitHoldAndWinFrameMultiplierRuntime: includes HW_STATE.active guard', () => {
  const r = emitHoldAndWinFrameMultiplierRuntime(
    resolveConfig({ holdAndWinFrameMultiplier: { enabled: true } })
  );
  ok(r.includes('HW_STATE'));
  ok(r.includes('active'));
  ok(r.includes('_isHwActive'));
});
