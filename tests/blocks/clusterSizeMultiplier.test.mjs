/**
 * tests/blocks/clusterSizeMultiplier.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitClusterSizeMultiplierCSS,
  emitClusterSizeMultiplierRuntime,
  tierMultForSize,
} from '../../src/blocks/clusterSizeMultiplier.mjs';

t('defaultConfig disabled, tiers present', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.tiers));
  ok(c.tiers.length >= 3);
});

t('resolveConfig: showBadge toggle works', () => {
  const a = resolveConfig({ clusterSizeMultiplier: { enabled: true, showBadge: false } });
  const b = resolveConfig({ clusterSizeMultiplier: { enabled: true } });
  equal(a.showBadge, false);
  equal(b.showBadge, true);
});

t('resolveConfig: sorts tiers by minSize ascending', () => {
  const c = resolveConfig({
    clusterSizeMultiplier: {
      tiers: [
        { minSize: 15, maxSize: 99, multX: 10 },
        { minSize:  5, maxSize:  7, multX:  1 },
        { minSize:  8, maxSize: 14, multX:  3 },
      ],
    },
  });
  equal(c.tiers[0].minSize, 5);
  equal(c.tiers[1].minSize, 8);
  equal(c.tiers[2].minSize, 15);
});

t('resolveConfig: rejects malformed tier entries', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    clusterSizeMultiplier: {
      tiers: [
        { minSize: 'oops', maxSize: 5, multX: 1 },        /* bad min */
        { minSize: 5, maxSize: 3, multX: 1 },             /* max < min */
        { minSize: 5, maxSize: 7, multX: -1 },            /* negative mult */
      ],
    },
  });
  /* All entries invalid → fallback to default tiers. */
  equal(c.tiers.length, def.tiers.length);
});

t('tierMultForSize: matches range', () => {
  const tiers = [
    { minSize: 5, maxSize: 7, multX: 1 },
    { minSize: 8, maxSize: 10, multX: 2 },
    { minSize: 11, maxSize: 99, multX: 5 },
  ];
  equal(tierMultForSize(tiers, 6), 1);
  equal(tierMultForSize(tiers, 8), 2);
  equal(tierMultForSize(tiers, 50), 5);
});

t('tierMultForSize: no match returns 1 (identity)', () => {
  const tiers = [{ minSize: 5, maxSize: 7, multX: 3 }];
  equal(tierMultForSize(tiers, 100), 1);
});

t('tierMultForSize: malformed input returns 1', () => {
  equal(tierMultForSize(null, 5), 1);
  equal(tierMultForSize([], 5), 1);
  equal(tierMultForSize([{ minSize: 1, maxSize: 5, multX: 9 }], NaN), 1);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitClusterSizeMultiplierCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits badge class + pulse keyframes', () => {
  const css = emitClusterSizeMultiplierCSS(resolveConfig({ clusterSizeMultiplier: { enabled: true } }));
  ok(css.includes('.csm-badge'));
  ok(css.includes('@keyframes csm-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onClusterPay + preSpin + emits onClusterSizeMultiplierApplied', () => {
  const r = emitClusterSizeMultiplierRuntime(resolveConfig({ clusterSizeMultiplier: { enabled: true } }));
  ok(r.includes("HookBus.on('onClusterPay'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onClusterSizeMultiplierApplied'));
  ok(r.includes('__CLUSTER_SIZE_MULT_WIRED__'));
});
