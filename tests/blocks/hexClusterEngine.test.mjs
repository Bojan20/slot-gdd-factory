/**
 * tests/blocks/hexClusterEngine.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitHexClusterEngineCSS,
  emitHexClusterEngineRuntime,
  findHexClusters,
} from '../../src/blocks/hexClusterEngine.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.minClusterSize, 4);
  equal(c.sameSymRule, 'exact');
  equal(c.wildSymbolId, 'W');
});

t('resolveConfig enables on true', () => {
  const c = resolveConfig({ hexClusterEngine: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig clamps minClusterSize to [3, 12]', () => {
  const lo = resolveConfig({ hexClusterEngine: { minClusterSize: 1 } });
  const hi = resolveConfig({ hexClusterEngine: { minClusterSize: 99 } });
  equal(lo.minClusterSize, 3);
  equal(hi.minClusterSize, 12);
});

t('resolveConfig accepts exactPlusWild rule', () => {
  const c = resolveConfig({ hexClusterEngine: { enabled: true, sameSymRule: 'exactPlusWild' } });
  equal(c.sameSymRule, 'exactPlusWild');
});

t('resolveConfig: invalid sameSymRule falls back to exact', () => {
  const c = resolveConfig({ hexClusterEngine: { sameSymRule: 'fuzzy' } });
  equal(c.sameSymRule, 'exact');
});

t('resolveConfig rejects lowercase wildSymbolId', () => {
  const c = resolveConfig({ hexClusterEngine: { wildSymbolId: 'wild' } });
  equal(c.wildSymbolId, 'W');
});

t('resolveConfig: sizeTiers sorted by minSize ascending', () => {
  const c = resolveConfig({
    hexClusterEngine: {
      sizeTiers: [
        { minSize: 10, maxSize: 99, awardX: 50 },
        { minSize:  3, maxSize:  5, awardX:  1 },
        { minSize:  6, maxSize:  9, awardX:  5 },
      ],
    },
  });
  equal(c.sizeTiers[0].minSize, 3);
  equal(c.sizeTiers[2].minSize, 10);
});

t('findHexClusters: 4 adjacent same-symbol cells form one cluster', () => {
  const cells = [
    { q: 0, r: 0, symbol: 'A' },
    { q: 1, r: 0, symbol: 'A' },
    { q: 0, r: 1, symbol: 'A' },
    { q: 1, r: -1, symbol: 'A' },
  ];
  const out = findHexClusters(cells, 3, 'exact', 'W');
  equal(out.length, 1);
  equal(out[0].size, 4);
  equal(out[0].symbol, 'A');
});

t('findHexClusters: under minSize ignored', () => {
  const cells = [
    { q: 0, r: 0, symbol: 'A' },
    { q: 1, r: 0, symbol: 'A' },
  ];
  const out = findHexClusters(cells, 3, 'exact', 'W');
  equal(out.length, 0);
});

t('findHexClusters: wild solo not anchor', () => {
  const cells = [
    { q: 0, r: 0, symbol: 'W' },
    { q: 1, r: 0, symbol: 'W' },
    { q: 0, r: 1, symbol: 'W' },
  ];
  const out = findHexClusters(cells, 3, 'exact', 'W');
  equal(out.length, 0);
});

t('findHexClusters: exactPlusWild rule connects wilds into cluster', () => {
  const cells = [
    { q: 0, r: 0, symbol: 'A' },
    { q: 1, r: 0, symbol: 'A' },
    { q: 0, r: 1, symbol: 'W' },
    { q: 1, r: 1, symbol: 'A' },
  ];
  const out = findHexClusters(cells, 3, 'exactPlusWild', 'W');
  equal(out.length, 1);
  equal(out[0].size, 4);
  equal(out[0].symbol, 'A');
});

t('findHexClusters: different symbols separate clusters', () => {
  const cells = [
    { q: 0, r: 0, symbol: 'A' },
    { q: 1, r: 0, symbol: 'A' },
    { q: 0, r: 1, symbol: 'A' },
    { q: 2, r: 0, symbol: 'B' },
    { q: 3, r: 0, symbol: 'B' },
    { q: 2, r: 1, symbol: 'B' },
  ];
  const out = findHexClusters(cells, 3, 'exact', 'W');
  equal(out.length, 2);
  ok(out.some(c => c.symbol === 'A' && c.size === 3));
  ok(out.some(c => c.symbol === 'B' && c.size === 3));
});

t('findHexClusters: empty/malformed inputs return []', () => {
  equal(findHexClusters(null, 3).length, 0);
  equal(findHexClusters([], 3).length, 0);
  equal(findHexClusters([{ q: 'bad', r: 0, symbol: 'A' }], 3).length, 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitHexClusterEngineCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits cluster + pulse keyframes + reduced-motion', () => {
  const css = emitHexClusterEngineCSS(resolveConfig({ hexClusterEngine: { enabled: true } }));
  ok(css.includes('.cell.hex.is-hex-cluster'));
  ok(css.includes('@keyframes hxc-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onSpinResult/onTumbleStep/preSpin + emits onHexClusterPay', () => {
  const r = emitHexClusterEngineRuntime(resolveConfig({ hexClusterEngine: { enabled: true } }));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onHexClusterPay'));
  ok(r.includes('__HEX_CLUSTER_WIRED__'));
});

t('emitRuntime: try/catch around emit + console.warn surface', () => {
  const r = emitHexClusterEngineRuntime(resolveConfig({ hexClusterEngine: { enabled: true } }));
  ok(r.includes('catch (e)'));
  ok(r.includes('console.warn'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitHexClusterEngineRuntime(resolveConfig({})).includes('__HEX_CLUSTER_WIRED__'));
});
