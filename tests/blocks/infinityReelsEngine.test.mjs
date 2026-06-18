/**
 * tests/blocks/infinityReelsEngine.test.mjs
 *
 * Unit + emit-shape tests for `infinityReelsEngine.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks / invariants
 *   - nextReelCount pure helper (cap, budget, negative input)
 *   - nextInfinityMult pure helper (growth, saturation, cap idempotence)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + guard branches + appliesIn branch
 *   - Vendor-neutral guard
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitInfinityReelsEngineCSS,
  emitInfinityReelsEngineMarkup,
  emitInfinityReelsEngineRuntime,
  nextReelCount,
  nextInfinityMult,
} from '../../src/blocks/infinityReelsEngine.mjs';

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default with baseReelCount=4 maxReels=12', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.baseReelCount, 4);
  equal(c.maxReels, 12);
  equal(c.startMult, 1);
  equal(c.growPerExpand, 1);
  equal(c.maxMult, 20);
  equal(c.appliesIn, 'both');
  equal(c.showHud, true);
  equal(c.hudPosition, 'topRight');
  equal(c.hudColor, '#aaffcc');
  equal(c.fontSizePx, 16);
  equal(c.pulseMs, 500);
  equal(c.expandAnimMs, 300);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ infinityReelsEngine: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps baseReelCount / maxReels / startMult / growPerExpand / maxMult to bounds', () => {
  const c = resolveConfig({
    infinityReelsEngine: {
      enabled: true,
      baseReelCount: 99,
      maxReels: 999,
      startMult: 999,
      growPerExpand: 999,
      maxMult: 9999,
    },
  });
  ok(c.baseReelCount <= 7);
  ok(c.baseReelCount >= 3);
  ok(c.maxReels <= 20);
  ok(c.maxReels >= 5);
  ok(c.startMult <= 5);
  ok(c.startMult >= 1);
  ok(c.growPerExpand <= 3);
  ok(c.growPerExpand >= 1);
  ok(c.maxMult <= 100);
  ok(c.maxMult >= 2);
});

t('resolveConfig: enforces invariant baseReelCount ≤ maxReels', () => {
  /* baseReelCount clamps to [3..7], maxReels clamps to [5..20].
   * Configure baseReelCount=7 and maxReels=5 — naive resolve would
   * leave baseReelCount > maxReels with a negative expansion budget.
   * Engine must lift maxReels up to at least baseReelCount. */
  const c = resolveConfig({
    infinityReelsEngine: {
      enabled: true,
      baseReelCount: 7,
      maxReels: 5,
    },
  });
  ok(c.baseReelCount <= c.maxReels, `baseReelCount=${c.baseReelCount} > maxReels=${c.maxReels}`);
});

t('resolveConfig: enforces invariant startMult ≤ maxMult', () => {
  /* startMult clamps to [1..5], maxMult clamps to [2..100]. Configure
   * startMult=5 and maxMult=2 — naive resolve would leave startMult >
   * maxMult breaking nextInfinityMult monotonicity. Engine must lift
   * maxMult up to at least startMult. */
  const c = resolveConfig({
    infinityReelsEngine: {
      enabled: true,
      startMult: 5,
      maxMult: 2,
    },
  });
  ok(c.startMult <= c.maxMult, `startMult=${c.startMult} > maxMult=${c.maxMult}`);
});

t('resolveConfig: rejects invalid appliesIn → both fallback', () => {
  const c = resolveConfig({ infinityReelsEngine: { appliesIn: 'bonus' } });
  equal(c.appliesIn, 'both');
});

t('resolveConfig: accepts all valid appliesIn values', () => {
  equal(resolveConfig({ infinityReelsEngine: { appliesIn: 'base' } }).appliesIn, 'base');
  equal(resolveConfig({ infinityReelsEngine: { appliesIn: 'fs'   } }).appliesIn, 'fs');
  equal(resolveConfig({ infinityReelsEngine: { appliesIn: 'both' } }).appliesIn, 'both');
});

t('resolveConfig: rejects invalid hudPosition → topRight fallback', () => {
  const c = resolveConfig({ infinityReelsEngine: { hudPosition: 'middle' } });
  equal(c.hudPosition, 'topRight');
});

t('resolveConfig: accepts valid hex hudColor', () => {
  const c = resolveConfig({ infinityReelsEngine: { hudColor: '#ff00aa' } });
  equal(c.hudColor, '#ff00aa');
});

t('resolveConfig: rejects malformed hudColor → keeps default', () => {
  const c = resolveConfig({ infinityReelsEngine: { hudColor: 'red' } });
  equal(c.hudColor, '#aaffcc');
});

t('resolveConfig: clamps fontSizePx / pulseMs / expandAnimMs', () => {
  const c = resolveConfig({
    infinityReelsEngine: {
      enabled: true,
      fontSizePx: 999,
      pulseMs: 99999,
      expandAnimMs: 99999,
    },
  });
  ok(c.fontSizePx <= 32);
  ok(c.fontSizePx >= 12);
  ok(c.pulseMs <= 2000);
  ok(c.pulseMs >= 200);
  ok(c.expandAnimMs <= 1500);
  ok(c.expandAnimMs >= 100);

  const c2 = resolveConfig({
    infinityReelsEngine: {
      enabled: true,
      fontSizePx: 0,
      pulseMs: 0,
      expandAnimMs: 0,
    },
  });
  equal(c2.fontSizePx, 12);
  equal(c2.pulseMs, 200);
  equal(c2.expandAnimMs, 100);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. nextReelCount pure helper                                         */
/* ──────────────────────────────────────────────────────────────────── */

t('nextReelCount: 0 expanded + base=4 + max=12 → 1 (normal expand)', () => {
  equal(nextReelCount(0, 12, 4), 1);
});

t('nextReelCount: at-cap input + base=4 + max=12 → 8 (budget cap respected)', () => {
  /* budget = maxReels - baseReelCount = 12 - 4 = 8. Once expanded
   * count has reached 8, further calls must return 8 (saturation). */
  equal(nextReelCount(8, 12, 4), 8);
  equal(nextReelCount(7, 12, 4), 8);
  equal(nextReelCount(20, 12, 4), 8);
});

t('nextReelCount: negative input → 0 (floor to safe state)', () => {
  equal(nextReelCount(-5, 12, 4), 1);
  equal(nextReelCount(-0.5, 12, 4), 1);
});

t('nextReelCount: non-finite input → treated as 0', () => {
  equal(nextReelCount(NaN, 12, 4), 1);
  equal(nextReelCount(Infinity, 12, 4), 1);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. nextInfinityMult pure helper                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('nextInfinityMult: 1 + 1, max=20 → 2', () => {
  equal(nextInfinityMult(1, 1, 20), 2);
});

t('nextInfinityMult: 19 + 5, max=20 → 20 (capped at maxMult)', () => {
  equal(nextInfinityMult(19, 5, 20), 20);
});

t('nextInfinityMult: 20 + 1, max=20 → 20 (already at cap, idempotent)', () => {
  equal(nextInfinityMult(20, 1, 20), 20);
});

t('nextInfinityMult: negative current → floors to 0 + grow', () => {
  equal(nextInfinityMult(-3, 1, 20), 1);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS / Markup / Runtime emit                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emit CSS: enabled output contains .ire-hud + .ire-expand-anim classes', () => {
  const css = emitInfinityReelsEngineCSS({ ...defaultConfig(), enabled: true });
  ok(css.includes('.ire-hud'));
  ok(css.includes('.ire-expand-anim'));
  ok(css.includes('ire-pulse'));
  ok(css.includes('ire-expand'));
});

t('emit CSS: empty (disabled marker) when disabled', () => {
  const css = emitInfinityReelsEngineCSS({ ...defaultConfig(), enabled: false });
  ok(css.includes('disabled'));
  ok(!css.includes('.ire-hud {'));
});

t('emit Markup: empty (disabled marker) when disabled', () => {
  const html = emitInfinityReelsEngineMarkup({ ...defaultConfig(), enabled: false });
  ok(html.includes('disabled'));
  ok(!html.includes('id="ireHud"'));
});

t('emit Markup: contains hud div when enabled', () => {
  const html = emitInfinityReelsEngineMarkup({ ...defaultConfig(), enabled: true });
  ok(html.includes('id="ireHud"'));
  ok(html.includes('class="ire-hud"'));
  ok(html.includes('role="status"'));
  ok(html.includes('aria-live="polite"'));
});

t('emit Markup: skips hud div when showHud=false', () => {
  const html = emitInfinityReelsEngineMarkup({ ...defaultConfig(), enabled: true, showHud: false });
  ok(!html.includes('id="ireHud"'));
});

t('emit Runtime: empty (disabled marker) when disabled', () => {
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: false });
  ok(js.includes('disabled'));
  ok(!js.includes('HookBus.on'));
});

t('emit Runtime: registers HookBus listeners for preSpin / onTumbleStep / onSpinResult / onFsTrigger / onFsEnd', () => {
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: true });
  ok(js.includes("HookBus.on('preSpin'"));
  ok(js.includes("HookBus.on('onTumbleStep'"));
  ok(js.includes("HookBus.on('onSpinResult'"));
  ok(js.includes("HookBus.on('onFsTrigger'"));
  ok(js.includes("HookBus.on('onFsEnd'"));
});

t('emit Runtime: includes wired-once sentinel + HW guard + grid-kind guard + appliesIn branch', () => {
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: true });
  ok(js.includes('__IRE_WIRED__'));
  ok(js.includes('HW_STATE'));
  ok(js.includes('GRID_KIND'));
  ok(js.includes('APPLIES_IN'));
  ok(js.includes('IRE_STATE'));
});

t('emit Runtime: uses priority 25 on every subscribed event', () => {
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: true });
  /* All five subscriptions must use priority 25 (pre-eval slot). */
  const matches = js.match(/priority:\s*25/g) || [];
  ok(matches.length >= 5, `expected ≥ 5 priority:25 sites, got ${matches.length}`);
});

t('emit Runtime: priority 25 specifically on onTumbleStep listener', () => {
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: true });
  /* Spec requires onTumbleStep at priority 25 so the expansion fires
   * BEFORE the next re-evaluation. */
  const re = /HookBus\.on\(\s*'onTumbleStep'[\s\S]*?priority:\s*25/;
  ok(re.test(js), 'onTumbleStep must use priority 25');
});

t('emit Runtime: direct HookBus.emit string literals (no helper indirection)', () => {
  /* lego gate parser only catches direct HookBus.emit('name', ...)
   * call sites. Wrapping through a _emit() helper would invisibilise
   * the event names. */
  const js = emitInfinityReelsEngineRuntime({ ...defaultConfig(), enabled: true });
  ok(js.includes("HookBus.emit('onInfinityEngineExpanded'"));
  ok(js.includes("HookBus.emit('onInfinityEngineCommit'"));
  ok(js.includes("HookBus.emit('onInfinityEngineReset'"));
});

t('vendor-neutral guard: no banned vendor / product strings in any emit', () => {
  /* Hard repo rule: vendor names never leak into source or emitted
   * artefacts (CLAUDE.md HARD RULE — Megaways, IGT, etc forbidden). */
  const enabled = { ...defaultConfig(), enabled: true };
  const css = emitInfinityReelsEngineCSS(enabled);
  const md  = emitInfinityReelsEngineMarkup(enabled);
  const js  = emitInfinityReelsEngineRuntime(enabled);
  const all = (css + md + js).toLowerCase();
  const banned = ['megaways', 'pragmatic', 'netent', 'microgaming', 'igt', 'cleopatra', 'buffalo', 'wolf run', 'cash eruption'];
  for (const word of banned) {
    ok(!all.includes(word), `banned vendor word leaked: ${word}`);
  }
});
