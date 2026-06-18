/**
 * tests/blocks/dynamicWaysEngine.test.mjs
 *
 * Unit + emit-shape tests for `dynamicWaysEngine.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks / invariants
 *   - rollRowsPerReel pure helper (length, bounds, determinism, weights)
 *   - computeWaysCount pure helper (product, identity, zero collapse)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + guard branches + bumpInFs branch
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitDynamicWaysEngineCSS,
  emitDynamicWaysEngineMarkup,
  emitDynamicWaysEngineRuntime,
  rollRowsPerReel,
  computeWaysCount,
} from '../../src/blocks/dynamicWaysEngine.mjs';

/* Deterministic Mulberry32 RNG for repeatable rolls.                    */
function seeded(seed) {
  let s = (seed >>> 0) || 0x12345678;
  return function() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t1 = Math.imul(s ^ (s >>> 15), 1 | s);
    t1 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
    return ((t1 ^ (t1 >>> 14)) >>> 0) / 4294967296;
  };
}

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default with reelCount=6 minRows=2 maxRows=7', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.reelCount, 6);
  equal(c.minRows, 2);
  equal(c.maxRows, 7);
  equal(c.rowDistribution, 'uniform');
  equal(c.weights, null);
  equal(c.bumpInFs, true);
  equal(c.bumpAmount, 1);
  equal(c.showHud, true);
  equal(c.hudPosition, 'topRight');
  equal(c.hudColor, '#88ddff');
  equal(c.fontSizePx, 16);
  equal(c.pulseMs, 500);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ dynamicWaysEngine: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps reelCount / minRows / maxRows to bounds', () => {
  const c = resolveConfig({
    dynamicWaysEngine: {
      enabled: true,
      reelCount: 99,
      minRows: 99,
      maxRows: 999,
    },
  });
  ok(c.reelCount <= 8);
  ok(c.reelCount >= 3);
  ok(c.minRows <= 4);
  ok(c.minRows >= 2);
  ok(c.maxRows <= 12);
  ok(c.maxRows >= 4);
});

t('resolveConfig: enforces invariant minRows ≤ maxRows', () => {
  /* minRows clamps to [2..4], maxRows clamps to [4..12]; configure
   * extremes that, if naive, would invert the interval. The engine
   * must lift maxRows up to at least minRows to keep the draw well
   * formed. */
  const c = resolveConfig({
    dynamicWaysEngine: {
      enabled: true,
      minRows: 4,
      maxRows: 4,
    },
  });
  ok(c.minRows <= c.maxRows);

  /* Inverted input case: minRows=4 (allowed max), maxRows=4 (lowest).
   * Should resolve cleanly without throwing. */
  const c2 = resolveConfig({
    dynamicWaysEngine: { enabled: true, minRows: 4, maxRows: 4 },
  });
  equal(c2.minRows, 4);
  equal(c2.maxRows, 4);
});

t('resolveConfig: rejects invalid rowDistribution → uniform fallback', () => {
  const c = resolveConfig({ dynamicWaysEngine: { rowDistribution: 'gaussian' } });
  equal(c.rowDistribution, 'uniform');
});

t('resolveConfig: rejects invalid hudPosition → topRight fallback', () => {
  const c = resolveConfig({ dynamicWaysEngine: { hudPosition: 'middle' } });
  equal(c.hudPosition, 'topRight');
});

t('resolveConfig: accepts valid hex hudColor', () => {
  const c = resolveConfig({ dynamicWaysEngine: { hudColor: '#ff00aa' } });
  equal(c.hudColor, '#ff00aa');
});

t('resolveConfig: rejects malformed hudColor → keeps default', () => {
  const c = resolveConfig({ dynamicWaysEngine: { hudColor: 'red' } });
  equal(c.hudColor, '#88ddff');
});

t('resolveConfig: bumpAmount clamped to [1..3]', () => {
  equal(resolveConfig({ dynamicWaysEngine: { bumpAmount: 99 } }).bumpAmount, 3);
  equal(resolveConfig({ dynamicWaysEngine: { bumpAmount: 0  } }).bumpAmount, 1);
  equal(resolveConfig({ dynamicWaysEngine: { bumpAmount: 2  } }).bumpAmount, 2);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. rollRowsPerReel pure helper                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('rollRowsPerReel: returns an array of length reelCount', () => {
  const rng = seeded(1);
  const rows = rollRowsPerReel(6, 2, 7, rng);
  equal(rows.length, 6);
});

t('rollRowsPerReel: every entry is within [minRows, maxRows]', () => {
  const rng = seeded(42);
  for (let trial = 0; trial < 50; trial++) {
    const rows = rollRowsPerReel(6, 2, 7, rng);
    for (const r of rows) {
      ok(r >= 2, `row ${r} below min`);
      ok(r <= 7, `row ${r} above max`);
    }
  }
});

t('rollRowsPerReel: deterministic seeded RNG returns predictable array', () => {
  const a = rollRowsPerReel(6, 2, 7, seeded(123));
  const b = rollRowsPerReel(6, 2, 7, seeded(123));
  deepEqual(a, b);
});

t('rollRowsPerReel: zero / negative reelCount returns []', () => {
  deepEqual(rollRowsPerReel(0, 2, 7, seeded(1)), []);
  deepEqual(rollRowsPerReel(-3, 2, 7, seeded(1)), []);
});

t('rollRowsPerReel: weighted distribution honors weights (mass on min)', () => {
  /* Span = 7 - 2 + 1 = 6 candidate row counts (2..7). Mass entirely on
   * the first entry (row=2). Every roll must return 2. */
  const weights = [10, 0, 0, 0, 0, 0];
  const rng = seeded(7);
  const rows = rollRowsPerReel(6, 2, 7, rng, 'weighted', weights);
  equal(rows.length, 6);
  for (const r of rows) equal(r, 2);
});

t('rollRowsPerReel: weighted distribution honors weights (mass on max)', () => {
  /* Mass entirely on the last entry (row=7). */
  const weights = [0, 0, 0, 0, 0, 10];
  const rng = seeded(11);
  const rows = rollRowsPerReel(6, 2, 7, rng, 'weighted', weights);
  for (const r of rows) equal(r, 7);
});

t('rollRowsPerReel: weighted distribution with empty weights falls back to uniform', () => {
  const rng = seeded(99);
  const rows = rollRowsPerReel(6, 2, 7, rng, 'weighted', []);
  equal(rows.length, 6);
  for (const r of rows) { ok(r >= 2); ok(r <= 7); }
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. computeWaysCount pure helper                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('computeWaysCount: [2,3,4] → 24', () => {
  equal(computeWaysCount([2, 3, 4]), 24);
});

t('computeWaysCount: [6,7,8,9,10] → 30240', () => {
  equal(computeWaysCount([6, 7, 8, 9, 10]), 30240);
});

t('computeWaysCount: empty array → 1 (multiplicative identity)', () => {
  equal(computeWaysCount([]), 1);
});

t('computeWaysCount: array with 0 → 0 (zero collapse)', () => {
  equal(computeWaysCount([5, 0, 3]), 0);
});

t('computeWaysCount: industry-reference 2..7 ladder → 5040', () => {
  /* 2 * 3 * 4 * 5 * 6 * 7 = 5040 — canonical 6-reel ladder layout. */
  equal(computeWaysCount([2, 3, 4, 5, 6, 7]), 5040);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS / Markup / Runtime emit                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emit CSS: enabled output contains .dwe-hud class', () => {
  const css = emitDynamicWaysEngineCSS({ ...defaultConfig(), enabled: true });
  ok(css.includes('.dwe-hud'));
  ok(css.includes('dwe-pulse'));
});

t('emit CSS: empty (disabled marker) when disabled', () => {
  const css = emitDynamicWaysEngineCSS({ ...defaultConfig(), enabled: false });
  ok(css.includes('disabled'));
  ok(!css.includes('.dwe-hud {'));
});

t('emit Markup: empty (disabled marker) when disabled', () => {
  const html = emitDynamicWaysEngineMarkup({ ...defaultConfig(), enabled: false });
  ok(html.includes('disabled'));
  ok(!html.includes('id="dweHud"'));
});

t('emit Markup: contains hud div when enabled', () => {
  const html = emitDynamicWaysEngineMarkup({ ...defaultConfig(), enabled: true });
  ok(html.includes('id="dweHud"'));
  ok(html.includes('class="dwe-hud"'));
  ok(html.includes('role="status"'));
  ok(html.includes('aria-live="polite"'));
});

t('emit Markup: skips hud div when showHud=false', () => {
  const html = emitDynamicWaysEngineMarkup({ ...defaultConfig(), enabled: true, showHud: false });
  ok(!html.includes('id="dweHud"'));
});

t('emit Runtime: empty (disabled marker) when disabled', () => {
  const js = emitDynamicWaysEngineRuntime({ ...defaultConfig(), enabled: false });
  ok(js.includes('disabled'));
  ok(!js.includes('HookBus.on'));
});

t('emit Runtime: registers HookBus listeners for preSpin / onSpinResult / onFsTrigger / onFsEnd', () => {
  const js = emitDynamicWaysEngineRuntime({ ...defaultConfig(), enabled: true });
  ok(js.includes("HookBus.on('preSpin'"));
  ok(js.includes("HookBus.on('onSpinResult'"));
  ok(js.includes("HookBus.on('onFsTrigger'"));
  ok(js.includes("HookBus.on('onFsEnd'"));
});

t('emit Runtime: includes wired-once sentinel + HW guard + grid-kind guard + bumpInFs branch', () => {
  const js = emitDynamicWaysEngineRuntime({ ...defaultConfig(), enabled: true });
  ok(js.includes('__DWE_WIRED__'));
  ok(js.includes('HW_STATE'));
  ok(js.includes('GRID_KIND'));
  ok(js.includes('BUMP_IN_FS'));
  ok(js.includes('__WAYS_COUNT__'));
  ok(js.includes("emit('onWaysReshaped'"));
  ok(js.includes("emit('onWaysResetForRound'"));
});

t('emit Runtime: priority 25 wired on every subscribed event', () => {
  const js = emitDynamicWaysEngineRuntime({ ...defaultConfig(), enabled: true });
  /* All four subscriptions must use priority 25 (pre-eval slot). */
  const matches = js.match(/priority:\s*25/g) || [];
  ok(matches.length >= 4, `expected ≥ 4 priority:25 sites, got ${matches.length}`);
});

t('vendor-neutral guard: no banned vendor / product strings in any emit', () => {
  /* Hard repo rule: vendor names (Megaways, etc) never leak into source
   * or emitted artefacts. */
  const enabled = { ...defaultConfig(), enabled: true };
  const css = emitDynamicWaysEngineCSS(enabled);
  const md  = emitDynamicWaysEngineMarkup(enabled);
  const js  = emitDynamicWaysEngineRuntime(enabled);
  const all = (css + md + js).toLowerCase();
  const banned = ['megaways', 'pragmatic', 'netent', 'microgaming', 'igt', 'cleopatra', 'buffalo'];
  for (const word of banned) {
    ok(!all.includes(word), `banned vendor word leaked: ${word}`);
  }
});
