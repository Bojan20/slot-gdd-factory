/**
 * tests/blocks/holdAndWinReelExpansion.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitHoldAndWinReelExpansionCSS,
  emitHoldAndWinReelExpansionRuntime,
  shouldExpand,
} from '../../src/blocks/holdAndWinReelExpansion.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.respinTrigger, 3);
  equal(c.lockedPctTrigger, 0.75);
  equal(c.maxExpansions, 2);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ holdAndWinReelExpansion: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: respinTrigger=0 (disabled) accepted', () => {
  const c = resolveConfig({ holdAndWinReelExpansion: { respinTrigger: 0 } });
  equal(c.respinTrigger, 0);
});

t('resolveConfig clamps respinTrigger to [0, 50]', () => {
  const lo = resolveConfig({ holdAndWinReelExpansion: { respinTrigger: -5 } });
  const hi = resolveConfig({ holdAndWinReelExpansion: { respinTrigger: 999 } });
  equal(lo.respinTrigger, 0);
  equal(hi.respinTrigger, 50);
});

t('resolveConfig clamps lockedPctTrigger to [0, 1]', () => {
  const lo = resolveConfig({ holdAndWinReelExpansion: { lockedPctTrigger: -0.5 } });
  const hi = resolveConfig({ holdAndWinReelExpansion: { lockedPctTrigger: 5 } });
  equal(lo.lockedPctTrigger, 0);
  equal(hi.lockedPctTrigger, 1);
});

t('resolveConfig clamps maxExpansions to [1, 10]', () => {
  const lo = resolveConfig({ holdAndWinReelExpansion: { maxExpansions: 0 } });
  const hi = resolveConfig({ holdAndWinReelExpansion: { maxExpansions: 999 } });
  equal(lo.maxExpansions, 1);
  equal(hi.maxExpansions, 10);
});

t('resolveConfig clamps animDurationMs to [100, 4000]', () => {
  const lo = resolveConfig({ holdAndWinReelExpansion: { animDurationMs: 10 } });
  const hi = resolveConfig({ holdAndWinReelExpansion: { animDurationMs: 99999 } });
  equal(lo.animDurationMs, 100);
  equal(hi.animDurationMs, 4000);
});

t('resolveConfig rejects lowercase columnFillSymbol', () => {
  const c = resolveConfig({ holdAndWinReelExpansion: { columnFillSymbol: 'bonus' } });
  equal(c.columnFillSymbol, 'B');
});

t('shouldExpand: respin trigger fires on multiples', () => {
  const cfg = defaultConfig();
  equal(shouldExpand(3, 0.1, cfg), 'respin');
  equal(shouldExpand(6, 0.1, cfg), 'respin');
  equal(shouldExpand(9, 0.1, cfg), 'respin');
});

t('shouldExpand: respin trigger does NOT fire on non-multiples', () => {
  const cfg = defaultConfig();
  equal(shouldExpand(1, 0.1, cfg), '');
  equal(shouldExpand(2, 0.1, cfg), '');
});

t('shouldExpand: pct trigger fires when threshold met', () => {
  const cfg = defaultConfig();
  equal(shouldExpand(1, 0.75, cfg), 'pct');
  equal(shouldExpand(1, 0.95, cfg), 'pct');
});

t('shouldExpand: respin trigger takes precedence when both fire', () => {
  const cfg = defaultConfig();
  /* respin=3 matches AND pct=0.9 ≥ 0.75 — respin wins (first check) */
  equal(shouldExpand(3, 0.9, cfg), 'respin');
});

t('shouldExpand: respin trigger 0 disables that path', () => {
  const cfg = { ...defaultConfig(), respinTrigger: 0 };
  equal(shouldExpand(3, 0.5, cfg), '');
  equal(shouldExpand(3, 0.8, cfg), 'pct');
});

t('shouldExpand: malformed inputs return empty', () => {
  const cfg = defaultConfig();
  equal(shouldExpand(NaN, NaN, cfg), '');
  equal(shouldExpand('abc', null, cfg), '');
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitHoldAndWinReelExpansionCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits column + slide-in keyframes + reduced-motion gate', () => {
  const css = emitHoldAndWinReelExpansionCSS(resolveConfig({ holdAndWinReelExpansion: { enabled: true } }));
  ok(css.includes('.cell.is-hwre-bonus-column'));
  ok(css.includes('@keyframes hwre-slide-in'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onHoldAndWinPhase/postSpin/onHoldAndWinRespin + emits canonical event', () => {
  const r = emitHoldAndWinReelExpansionRuntime(resolveConfig({ holdAndWinReelExpansion: { enabled: true } }));
  ok(r.includes("HookBus.on('onHoldAndWinPhase'"));
  ok(r.includes("HookBus.on('postSpin'"));
  ok(r.includes("HookBus.on('onHoldAndWinRespin'"));
  ok(r.includes('onHoldAndWinReelExpanded'));
  ok(r.includes('__HW_REEL_EXPANSION_WIRED__'));
});

t('emitRuntime: try/catch around emit + console.warn', () => {
  const r = emitHoldAndWinReelExpansionRuntime(resolveConfig({ holdAndWinReelExpansion: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitHoldAndWinReelExpansionRuntime(resolveConfig({})).includes('__HW_REEL_EXPANSION_WIRED__'));
});
