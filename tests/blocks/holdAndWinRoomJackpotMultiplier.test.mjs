/**
 * tests/blocks/holdAndWinRoomJackpotMultiplier.test.mjs
 *
 * Unit + emit-shape tests for `holdAndWinRoomJackpotMultiplier.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitHoldAndWinRoomJackpotMultiplierCSS,
  emitHoldAndWinRoomJackpotMultiplierMarkup,
  emitHoldAndWinRoomJackpotMultiplierRuntime,
  resolveRoomForCount,
} from '../../src/blocks/holdAndWinRoomJackpotMultiplier.mjs';

t('defaultConfig: disabled + 4 rooms with monotone thresholds', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.rooms));
  equal(c.rooms.length, 4);
  equal(c.rooms[0].threshold, 0);
  for (let i = 1; i < c.rooms.length; i++) {
    ok(c.rooms[i].threshold > c.rooms[i - 1].threshold,
      `rooms[${i}].threshold must be > rooms[${i - 1}].threshold`);
  }
  ok(c.fontSizePx >= 10 && c.fontSizePx <= 32);
  ok(c.pulseMs >= 200 && c.pulseMs <= 3000);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ holdAndWinRoomJackpotMultiplier: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps fontSizePx + pulseMs to bounds', () => {
  const c = resolveConfig({
    holdAndWinRoomJackpotMultiplier: { fontSizePx: 999, pulseMs: 999999 },
  });
  ok(c.fontSizePx <= 32);
  ok(c.fontSizePx >= 10);
  ok(c.pulseMs <= 3000);
  ok(c.pulseMs >= 200);

  const c2 = resolveConfig({
    holdAndWinRoomJackpotMultiplier: { fontSizePx: -50, pulseMs: -50 },
  });
  ok(c2.fontSizePx >= 10);
  ok(c2.pulseMs >= 200);
});

t('resolveConfig: rejects malformed rooms array (non-monotone thresholds) → keeps default', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    holdAndWinRoomJackpotMultiplier: {
      rooms: [
        { name: 'A', threshold: 0,  multX: 1 },
        { name: 'B', threshold: 10, multX: 2 },
        { name: 'C', threshold: 5,  multX: 3 }, // non-monotone — reject whole array
      ],
    },
  });
  deepEqual(c.rooms.map(r => r.name), def.rooms.map(r => r.name));
  deepEqual(c.rooms.map(r => r.threshold), def.rooms.map(r => r.threshold));
});

t('resolveConfig: accepts valid hex chipColor', () => {
  const c = resolveConfig({ holdAndWinRoomJackpotMultiplier: { chipColor: '#ff00aa' } });
  equal(c.chipColor, '#ff00aa');

  // Invalid hex → keep default.
  const def = defaultConfig();
  const c2 = resolveConfig({ holdAndWinRoomJackpotMultiplier: { chipColor: 'not-a-color' } });
  equal(c2.chipColor, def.chipColor);
});

t('resolveRoomForCount: 0 locked → MINI', () => {
  const rooms = defaultConfig().rooms;
  equal(resolveRoomForCount(rooms, 0).name, 'MINI');
});

t('resolveRoomForCount: 5 locked → MINOR', () => {
  const rooms = defaultConfig().rooms;
  equal(resolveRoomForCount(rooms, 5).name, 'MINOR');
});

t('resolveRoomForCount: 10 locked → MAJOR', () => {
  const rooms = defaultConfig().rooms;
  equal(resolveRoomForCount(rooms, 10).name, 'MAJOR');
});

t('resolveRoomForCount: 15 locked → GRAND', () => {
  const rooms = defaultConfig().rooms;
  equal(resolveRoomForCount(rooms, 15).name, 'GRAND');
});

t('resolveRoomForCount: 100 locked → GRAND (cap behavior)', () => {
  const rooms = defaultConfig().rooms;
  equal(resolveRoomForCount(rooms, 100).name, 'GRAND');
});

t('emitHoldAndWinRoomJackpotMultiplierCSS: enabled emits .hwrjm-chip class', () => {
  const css = emitHoldAndWinRoomJackpotMultiplierCSS(
    resolveConfig({ holdAndWinRoomJackpotMultiplier: { enabled: true } })
  );
  ok(css.includes('.hwrjm-chip'));
  ok(css.includes('@keyframes hwrjm-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitHoldAndWinRoomJackpotMultiplierCSS: disabled → empty (no chip class)', () => {
  const css = emitHoldAndWinRoomJackpotMultiplierCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.hwrjm-chip'));
});

t('emitHoldAndWinRoomJackpotMultiplierMarkup: disabled → empty (no chip element)', () => {
  const m = emitHoldAndWinRoomJackpotMultiplierMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('id="hwrjmChip"'));
});

t('emitHoldAndWinRoomJackpotMultiplierRuntime: enabled registers all four HookBus listeners', () => {
  const r = emitHoldAndWinRoomJackpotMultiplierRuntime(
    resolveConfig({ holdAndWinRoomJackpotMultiplier: { enabled: true } })
  );
  ok(r.includes("HookBus.on('onHoldAndWinIntro'"));
  ok(r.includes("HookBus.on('onHoldAndWinLock'"));
  ok(r.includes("HookBus.on('onHoldAndWinEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onRoomPromoted'));
  ok(r.includes('onRoomJackpotFinal'));
  ok(r.includes('__HW_ROOM_JACKPOT_MULT_WIRED__'));
});

t('emitHoldAndWinRoomJackpotMultiplierRuntime: disabled emits no IIFE', () => {
  const r = emitHoldAndWinRoomJackpotMultiplierRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__HW_ROOM_JACKPOT_MULT_WIRED__'));
});

t('emitHoldAndWinRoomJackpotMultiplierRuntime: enabled includes HW_STATE.active guard', () => {
  const r = emitHoldAndWinRoomJackpotMultiplierRuntime(
    resolveConfig({ holdAndWinRoomJackpotMultiplier: { enabled: true } })
  );
  ok(r.includes('HW_STATE'));
  ok(r.includes('active'));
});
