/**
 * tests/blocks/fsSymbolUpgradeEscalation.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitFsSymbolUpgradeEscalationCSS,
  emitFsSymbolUpgradeEscalationMarkup,
  emitFsSymbolUpgradeEscalationRuntime,
  removeLowestTierSymbol,
} from '../../src/blocks/fsSymbolUpgradeEscalation.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.spinsPerUpgrade, 3);
  ok(c.tierOrder.length >= 5);
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps spinsPerUpgrade to [1, 50]', () => {
  const lo = resolveConfig({ fsSymbolUpgradeEscalation: { spinsPerUpgrade: 0 } });
  const hi = resolveConfig({ fsSymbolUpgradeEscalation: { spinsPerUpgrade: 999 } });
  equal(lo.spinsPerUpgrade, 1);
  equal(hi.spinsPerUpgrade, 50);
});

t('resolveConfig: tierOrder < 2 falls back to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ fsSymbolUpgradeEscalation: { tierOrder: ['X'] } });
  deepEqual(c.tierOrder, def.tierOrder);
});

t('resolveConfig: tierOrder filters non-string and bad regex', () => {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: { tierOrder: ['A', 'B', 99, 'bad-id'] } });
  deepEqual(c.tierOrder, ['A', 'B']);
});

t('resolveConfig: invalid chipPosition falls back', () => {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: { chipPosition: 'middle' } });
  equal(c.chipPosition, 'topRight');
});

t('removeLowestTierSymbol: removes lowest from front of tierOrder', () => {
  const r = removeLowestTierSymbol(['9', '10', 'J', 'A', 'W'], ['9', '10', 'J', 'A', 'W']);
  equal(r.removedSymbol, '9');
  deepEqual(r.newPool, ['10', 'J', 'A', 'W']);
});

t('removeLowestTierSymbol: skips missing tiers', () => {
  const r = removeLowestTierSymbol(['J', 'Q', 'A'], ['9', '10', 'J', 'A', 'W']);
  equal(r.removedSymbol, 'J');
  deepEqual(r.newPool, ['Q', 'A']);
});

t('removeLowestTierSymbol: returns null when only one symbol left', () => {
  const r = removeLowestTierSymbol(['W'], ['9', 'W']);
  equal(r.removedSymbol, null);
  deepEqual(r.newPool, ['W']);
});

t('removeLowestTierSymbol: handles empty inputs', () => {
  const r1 = removeLowestTierSymbol([], ['A']);
  equal(r1.removedSymbol, null);
  const r2 = removeLowestTierSymbol(['A'], []);
  equal(r2.removedSymbol, null);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitFsSymbolUpgradeEscalationCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits chip + bump keyframes + reduced-motion', () => {
  const css = emitFsSymbolUpgradeEscalationCSS(resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true } }));
  ok(css.includes('.fsse-chip'));
  ok(css.includes('@keyframes fsse-bump'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits chip + ARIA', () => {
  const m = emitFsSymbolUpgradeEscalationMarkup(resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true } }));
  ok(m.includes('id="fsseChip"'));
  ok(m.includes('role="status"'));
  ok(m.includes('aria-live="polite"'));
});

t('emitMarkup hidden returns no markup', () => {
  const m = emitFsSymbolUpgradeEscalationMarkup(resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true, showChip: false } }));
  ok(m.includes('disabled or hidden'));
});

t('emitRuntime enabled wires onFsTrigger/onFsSpinResult/onFsEnd + emits onFsSymbolUpgraded', () => {
  const r = emitFsSymbolUpgradeEscalationRuntime(resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onFsSymbolUpgraded'));
  ok(r.includes('__FS_SYMBOL_UPGRADE_WIRED__'));
});

t('emitRuntime: try/catch around emit + console.warn surface', () => {
  const r = emitFsSymbolUpgradeEscalationRuntime(resolveConfig({ fsSymbolUpgradeEscalation: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitFsSymbolUpgradeEscalationRuntime(resolveConfig({})).includes('__FS_SYMBOL_UPGRADE_WIRED__'));
});
