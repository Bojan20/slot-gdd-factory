/**
 * tests/blocks/bonusOverlayMutex.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitBonusOverlayMutexCSS,
  emitBonusOverlayMutexRuntime,
} from '../../src/blocks/bonusOverlayMutex.mjs';

t('defaultConfig disabled, default rejectWhenBusy=false', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.rejectWhenBusy, false);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ bonusOverlayMutex: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: rejectWhenBusy can be turned on', () => {
  const c = resolveConfig({ bonusOverlayMutex: { enabled: true, rejectWhenBusy: true } });
  equal(c.rejectWhenBusy, true);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitBonusOverlayMutexCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits state-only marker (no animations to gate)', () => {
  const css = emitBonusOverlayMutexCSS(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(css.includes('pure state'));
});

t('emitRuntime enabled binds 3 Request + 3 Ended events', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('onMatchThreeBonusRequested'));
  ok(r.includes('onMoneyGrabRequested'));
  ok(r.includes('onPathBonusRequested'));
  ok(r.includes('onMatchThreeBonusEnded'));
  ok(r.includes('onMoneyGrabEnded'));
  ok(r.includes('onPathBonusEnded'));
});

t('emitRuntime: emits Acquired + Released events', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('onBonusOverlayMutexAcquired'));
  ok(r.includes('onBonusOverlayMutexReleased'));
});

t('emitRuntime: sentinel + state', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('__BONUS_OVERLAY_MUTEX_WIRED__'));
  ok(r.includes('BONUS_OVERLAY_MUTEX_STATE'));
});

t('emitRuntime: queue cap (QUEUE_MAX = 8)', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('QUEUE_MAX'));
  ok(r.includes('8'));
});

t('emitRuntime: re-entrant emit guard (_viaMutex)', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('_viaMutex'));
});

t('emitRuntime: try/catch + console.warn surface', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime: queue de-dup logic present', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes('queue.indexOf'));
});

t('emitRuntime: REJECT_BUSY mode baked into IIFE', () => {
  const a = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true, rejectWhenBusy: true } }));
  const b = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true, rejectWhenBusy: false } }));
  ok(a.includes('REJECT_BUSY = true'));
  ok(b.includes('REJECT_BUSY = false'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitBonusOverlayMutexRuntime(resolveConfig({})).includes('__BONUS_OVERLAY_MUTEX_WIRED__'));
});

t('emitRuntime: 3 kinds bound (match3, moneyGrab, pathBonus)', () => {
  const r = emitBonusOverlayMutexRuntime(resolveConfig({ bonusOverlayMutex: { enabled: true } }));
  ok(r.includes("_bindKind('match3')"));
  ok(r.includes("_bindKind('moneyGrab')"));
  ok(r.includes("_bindKind('pathBonus')"));
});
