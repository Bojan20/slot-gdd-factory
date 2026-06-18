/**
 * tests/blocks/megaWildCluster.test.mjs
 *
 * Unit + emit-shape tests for `megaWildCluster.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitMegaWildClusterCSS,
  emitMegaWildClusterMarkup,
  emitMegaWildClusterRuntime,
  pickValidAnchor,
} from '../../src/blocks/megaWildCluster.mjs';

/* ───────────────────────── config ───────────────────────── */

t('defaultConfig: disabled + blockSize 2', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.blockSize, 2);
  equal(c.appliesIn, 'fs');
  equal(c.wildSymbol, 'W');
  equal(c.triggerSymbol, 'MW');
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ megaWildCluster: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: rejects invalid blockSize (only 2/3/4)', () => {
  const def = defaultConfig();
  const c5  = resolveConfig({ megaWildCluster: { blockSize: 5 } });
  const c1  = resolveConfig({ megaWildCluster: { blockSize: 1 } });
  const cStr= resolveConfig({ megaWildCluster: { blockSize: '3' } });
  equal(c5.blockSize, def.blockSize);
  equal(c1.blockSize, def.blockSize);
  equal(cStr.blockSize, def.blockSize);
  /* sanity: valid 3 is accepted */
  const cOk = resolveConfig({ megaWildCluster: { blockSize: 3 } });
  equal(cOk.blockSize, 3);
});

t('resolveConfig: clamps pulseMs + cornerRadiusPx to bounds', () => {
  const cHigh = resolveConfig({ megaWildCluster: { pulseMs: 99999, cornerRadiusPx: 999 } });
  ok(cHigh.pulseMs <= 3000);
  ok(cHigh.cornerRadiusPx <= 32);
  const cLow  = resolveConfig({ megaWildCluster: { pulseMs: -50, cornerRadiusPx: -10 } });
  ok(cLow.pulseMs >= 200);
  ok(cLow.cornerRadiusPx >= 0);
});

t('resolveConfig: rejects invalid appliesIn', () => {
  const def = defaultConfig();
  const c   = resolveConfig({ megaWildCluster: { appliesIn: 'somewhere' } });
  equal(c.appliesIn, def.appliesIn);
  /* sanity: valid 'both' is accepted */
  const cOk = resolveConfig({ megaWildCluster: { appliesIn: 'both' } });
  equal(cOk.appliesIn, 'both');
});

t('resolveConfig: accepts valid hex glowColor', () => {
  const c = resolveConfig({ megaWildCluster: { glowColor: '#00ffcc' } });
  equal(c.glowColor, '#00ffcc');
  const bad = resolveConfig({ megaWildCluster: { glowColor: 'pinkish' } });
  equal(bad.glowColor, defaultConfig().glowColor);
});

t('resolveConfig: rejects malformed wildSymbol', () => {
  const def = defaultConfig();
  const c1 = resolveConfig({ megaWildCluster: { wildSymbol: '' } });
  const c2 = resolveConfig({ megaWildCluster: { wildSymbol: 'W!@#$' } });
  const c3 = resolveConfig({ megaWildCluster: { wildSymbol: 'ABCDEFGHIJ' } }); /* >8 */
  equal(c1.wildSymbol, def.wildSymbol);
  equal(c2.wildSymbol, def.wildSymbol);
  equal(c3.wildSymbol, def.wildSymbol);
  /* sanity: valid stays */
  const cOk = resolveConfig({ megaWildCluster: { wildSymbol: 'W2' } });
  equal(cOk.wildSymbol, 'W2');
});

/* ───────────────────────── pickValidAnchor ───────────────────────── */

t('pickValidAnchor: 5x3 grid, size 2 → reelIdx<=3, rowIdx<=1', () => {
  for (let i = 0; i < 50; i++) {
    const a = pickValidAnchor(5, 3, 2, () => Math.random());
    ok(a !== null);
    ok(a.reelIdx >= 0 && a.reelIdx <= 3);
    ok(a.rowIdx  >= 0 && a.rowIdx  <= 1);
  }
});

t('pickValidAnchor: 5x3 grid, size 3 → reelIdx<=2, rowIdx==0', () => {
  for (let i = 0; i < 50; i++) {
    const a = pickValidAnchor(5, 3, 3, () => Math.random());
    ok(a !== null);
    ok(a.reelIdx >= 0 && a.reelIdx <= 2);
    equal(a.rowIdx, 0);
  }
});

t('pickValidAnchor: 2x2 grid, size 3 → null (no fit)', () => {
  const a = pickValidAnchor(2, 2, 3, () => Math.random());
  equal(a, null);
});

t('pickValidAnchor: deterministic seeded RNG returns predictable anchor', () => {
  /* RNG returns 0.0 → (0,0); RNG returns 0.999 → (max,max). */
  const aMin = pickValidAnchor(5, 4, 2, () => 0.0);
  equal(aMin.reelIdx, 0);
  equal(aMin.rowIdx,  0);
  const aMax = pickValidAnchor(5, 4, 2, () => 0.999);
  equal(aMax.reelIdx, 3);
  equal(aMax.rowIdx,  2);
});

/* ───────────────────────── emit shapes ───────────────────────── */

t('emitMegaWildClusterCSS: enabled → contains .is-mega-wild-cell class', () => {
  const css = emitMegaWildClusterCSS(resolveConfig({ megaWildCluster: { enabled: true } }));
  ok(css.includes('.is-mega-wild-cell'));
  ok(css.includes('@keyframes mwc-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMegaWildClusterCSS: disabled → empty/no class', () => {
  const css = emitMegaWildClusterCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.is-mega-wild-cell'));
});

t('emitMegaWildClusterMarkup: disabled → empty marker comment, no overlay', () => {
  const m = emitMegaWildClusterMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('mwc-overlay-marker'));
});

t('emitMegaWildClusterRuntime: enabled → registers HookBus listeners', () => {
  const r = emitMegaWildClusterRuntime(resolveConfig({ megaWildCluster: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onMegaWildClusterLanded'));
  ok(r.includes('onMegaWildClusterCleared'));
  ok(r.includes('__MWC_WIRED__'));
});

t('emitMegaWildClusterRuntime: disabled → no IIFE', () => {
  const r = emitMegaWildClusterRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__MWC_WIRED__'));
});

t('emitMegaWildClusterRuntime: includes HW guard + appliesIn branch', () => {
  const r = emitMegaWildClusterRuntime(resolveConfig({
    megaWildCluster: { enabled: true, appliesIn: 'both' },
  }));
  ok(r.includes('HW_STATE'));
  ok(r.includes('APPLIES_IN'));
  ok(r.includes('"both"'));
});
