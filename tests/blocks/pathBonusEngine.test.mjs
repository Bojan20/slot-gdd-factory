/**
 * tests/blocks/pathBonusEngine.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitPathBonusEngineCSS,
  emitPathBonusEngineMarkup,
  emitPathBonusEngineRuntime,
  rollDice,
} from '../../src/blocks/pathBonusEngine.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.tileCount, 16);
  equal(c.startRolls, 5);
  equal(c.maxRoll, 6);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ pathBonusEngine: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps tileCount to [4, 40]', () => {
  const lo = resolveConfig({ pathBonusEngine: { tileCount: 1 } });
  const hi = resolveConfig({ pathBonusEngine: { tileCount: 999 } });
  equal(lo.tileCount, 4);
  equal(hi.tileCount, 40);
});

t('resolveConfig clamps startRolls to [1, 50]', () => {
  const lo = resolveConfig({ pathBonusEngine: { startRolls: 0 } });
  const hi = resolveConfig({ pathBonusEngine: { startRolls: 99 } });
  equal(lo.startRolls, 1);
  equal(hi.startRolls, 50);
});

t('resolveConfig clamps maxRoll to [2, 12]', () => {
  const lo = resolveConfig({ pathBonusEngine: { maxRoll: 1 } });
  const hi = resolveConfig({ pathBonusEngine: { maxRoll: 99 } });
  equal(lo.maxRoll, 2);
  equal(hi.maxRoll, 12);
});

t('resolveConfig: tileValueRange accepts valid {min, max}', () => {
  const c = resolveConfig({ pathBonusEngine: { tileValueRange: { min: 5, max: 100 } } });
  equal(c.tileValueRange.min, 5);
  equal(c.tileValueRange.max, 100);
});

t('resolveConfig: rejects tileValueRange where max < min', () => {
  const def = defaultConfig();
  const c = resolveConfig({ pathBonusEngine: { tileValueRange: { min: 100, max: 5 } } });
  equal(c.tileValueRange.min, def.tileValueRange.min);
  equal(c.tileValueRange.max, def.tileValueRange.max);
});

t('resolveConfig clamps finishTileIdx to [0, tileCount-1]', () => {
  const c = resolveConfig({ pathBonusEngine: { tileCount: 10, finishTileIdx: 99 } });
  equal(c.finishTileIdx, 9);
});

t('resolveConfig: rejects invalid hex colors', () => {
  const c = resolveConfig({ pathBonusEngine: { overlayBg: 'bg', playerColor: 'pp' } });
  equal(c.overlayBg, '#08111d');
  equal(c.playerColor, '#ff9a40');
});

t('rollDice: deterministic with RNG', () => {
  /* rng → floor(x * maxRoll) + 1; (0.0 → 1, 0.99 → maxRoll for maxRoll<100) */
  equal(rollDice(6, () => 0.0), 1);
  equal(rollDice(6, () => 0.5), 4);   /* 1 + floor(0.5 * 6) = 1 + 3 = 4 */
  equal(rollDice(6, () => 0.99), 6);
});

t('rollDice: invalid maxRoll returns 1', () => {
  equal(rollDice(NaN, () => 0.5), 1);
  equal(rollDice(0, () => 0.5), 1);
  equal(rollDice(-5, () => 0.5), 1);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitPathBonusEngineCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits overlay + tiles + reduced-motion gate', () => {
  const css = emitPathBonusEngineCSS(resolveConfig({ pathBonusEngine: { enabled: true } }));
  ok(css.includes('.pb-overlay'));
  ok(css.includes('.pb-tile'));
  ok(css.includes('.pb-roll-btn'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits tileCount tiles + dialog ARIA', () => {
  const m = emitPathBonusEngineMarkup(resolveConfig({ pathBonusEngine: { enabled: true, tileCount: 8, finishTileIdx: 7 } }));
  ok(m.includes('id="pbOverlay"'));
  ok(m.includes('role="dialog"'));
  ok(m.includes('aria-modal="true"'));
  const tileCount = (m.match(/data-pb-tile=/g) || []).length;
  equal(tileCount, 8);
  ok(m.includes('FIN'));
});

t('emitRuntime enabled wires 2 hooks + 3 events + sentinel', () => {
  const r = emitPathBonusEngineRuntime(resolveConfig({ pathBonusEngine: { enabled: true } }));
  ok(r.includes("HookBus.on('onPathBonusRequested'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onPathBonusEntered'));
  ok(r.includes('onPathBonusRolled'));
  ok(r.includes('onPathBonusEnded'));
  ok(r.includes('__PATH_BONUS_WIRED__'));
});

t('emitRuntime: try/catch + console.warn surface', () => {
  const r = emitPathBonusEngineRuntime(resolveConfig({ pathBonusEngine: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime exposes window.pathBonusForceRoll QA hook', () => {
  const r = emitPathBonusEngineRuntime(resolveConfig({ pathBonusEngine: { enabled: true } }));
  ok(r.includes('pathBonusForceRoll'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitPathBonusEngineRuntime(resolveConfig({})).includes('__PATH_BONUS_WIRED__'));
});
