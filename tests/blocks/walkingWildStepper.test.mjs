/**
 * tests/blocks/walkingWildStepper.test.mjs
 *
 * Unit + emit-shape tests for `walkingWildStepper.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks
 *   - nextPosition pure helper (right/left + edge exits)
 *   - nextMult pure helper (bump + cap)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + guard branches
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitWalkingWildStepperCSS,
  emitWalkingWildStepperMarkup,
  emitWalkingWildStepperRuntime,
  nextPosition,
  nextMult,
} from '../../src/blocks/walkingWildStepper.mjs';

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default, direction=right', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.direction, 'right');
  equal(c.stepCells, 1);
  equal(c.startMult, 1);
  equal(c.growPerStep, 1);
  equal(c.maxMult, 10);
  ok(c.triggerProbability > 0 && c.triggerProbability <= 1);
  equal(c.appliesIn, 'fs');
  equal(c.wildSymbol, 'W');
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ walkingWildStepper: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps stepCells/startMult/growPerStep/maxMult to bounds', () => {
  const c = resolveConfig({
    walkingWildStepper: {
      enabled: true,
      stepCells: 99,
      startMult: 999,
      growPerStep: 999,
      maxMult: 9999,
    },
  });
  ok(c.stepCells <= 3);
  ok(c.stepCells >= 1);
  ok(c.startMult <= 10);
  ok(c.growPerStep <= 5);
  ok(c.maxMult <= 100);
});

t('resolveConfig: clamps lower bounds (negative / zero inputs)', () => {
  const c = resolveConfig({
    walkingWildStepper: {
      enabled: true,
      stepCells: -5,
      startMult: 0,
      growPerStep: 0,
      maxMult: -1,
      triggerProbability: -0.5,
      pulseMs: 1,
    },
  });
  equal(c.stepCells, 1);
  equal(c.startMult, 1);
  equal(c.growPerStep, 1);
  equal(c.maxMult, 2);
  equal(c.triggerProbability, 0);
  equal(c.pulseMs, 200);
});

t('resolveConfig: rejects invalid direction → falls back to right', () => {
  const c = resolveConfig({ walkingWildStepper: { direction: 'diagonal' } });
  equal(c.direction, 'right');
});

t('resolveConfig: accepts valid direction values left/right/random', () => {
  equal(resolveConfig({ walkingWildStepper: { direction: 'left'   } }).direction, 'left');
  equal(resolveConfig({ walkingWildStepper: { direction: 'right'  } }).direction, 'right');
  equal(resolveConfig({ walkingWildStepper: { direction: 'random' } }).direction, 'random');
});

t('resolveConfig: rejects invalid appliesIn → keeps default fs', () => {
  const c = resolveConfig({ walkingWildStepper: { appliesIn: 'bonus' } });
  equal(c.appliesIn, 'fs');
});

t('resolveConfig: accepts valid hex glowColor', () => {
  const c = resolveConfig({ walkingWildStepper: { glowColor: '#ff00aa' } });
  equal(c.glowColor, '#ff00aa');
});

t('resolveConfig: rejects bad hex glowColor', () => {
  const def = defaultConfig();
  const c = resolveConfig({ walkingWildStepper: { glowColor: 'not-a-color' } });
  equal(c.glowColor, def.glowColor);
});

t('resolveConfig: enforces startMult ≤ maxMult invariant', () => {
  const c = resolveConfig({
    walkingWildStepper: { enabled: true, startMult: 10, maxMult: 5 },
  });
  ok(c.startMult <= c.maxMult);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. nextPosition (pure helper)                                        */
/* ──────────────────────────────────────────────────────────────────── */

t('nextPosition: right direction, current=0 step=1 reels=5 → 1', () => {
  equal(nextPosition(0, 'right', 1, 5), 1);
});

t('nextPosition: right direction, current=4 step=1 reels=5 → null (exits)', () => {
  equal(nextPosition(4, 'right', 1, 5), null);
});

t('nextPosition: left direction, current=0 step=1 reels=5 → null (exits)', () => {
  equal(nextPosition(0, 'left', 1, 5), null);
});

t('nextPosition: left direction, current=4 step=2 reels=5 → 2', () => {
  equal(nextPosition(4, 'left', 2, 5), 2);
});

t('nextPosition: step exceeds remaining grid → null', () => {
  equal(nextPosition(3, 'right', 3, 5), null);
});

t('nextPosition: invalid inputs return null', () => {
  equal(nextPosition(NaN, 'right', 1, 5), null);
  equal(nextPosition(0, 'right', 1, 0),   null);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. nextMult (pure helper)                                            */
/* ──────────────────────────────────────────────────────────────────── */

t('nextMult: 1 + 1 (cap 10) → 2', () => {
  equal(nextMult(1, 1, 10), 2);
});

t('nextMult: 9 + 5 (cap 10) → 10 (capped)', () => {
  equal(nextMult(9, 5, 10), 10);
});

t('nextMult: 10 + 5 (cap 10) → 10 (already at cap)', () => {
  equal(nextMult(10, 5, 10), 10);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS emit                                                          */
/* ──────────────────────────────────────────────────────────────────── */

t('emitWalkingWildStepperCSS: enabled emits .walking-wild-cell class + keyframes', () => {
  const css = emitWalkingWildStepperCSS(resolveConfig({ walkingWildStepper: { enabled: true } }));
  ok(css.includes('.walking-wild-cell'));
  ok(css.includes('@keyframes wws-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitWalkingWildStepperCSS: disabled → no CSS / no class', () => {
  const css = emitWalkingWildStepperCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.walking-wild-cell'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 6. Markup emit                                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emitWalkingWildStepperMarkup: disabled → no shell (no badges to mount)', () => {
  const m = emitWalkingWildStepperMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
});

t('emitWalkingWildStepperMarkup: enabled emits inert placeholder (runtime mounts on cells)', () => {
  const m = emitWalkingWildStepperMarkup(resolveConfig({ walkingWildStepper: { enabled: true } }));
  ok(m.length > 0);
  /* No DOM shell required — walker mounts directly on grid cells. */
  ok(!m.includes('disabled'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 7. Runtime emit                                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('emitWalkingWildStepperRuntime: enabled registers HookBus listeners + sentinel', () => {
  const r = emitWalkingWildStepperRuntime(resolveConfig({ walkingWildStepper: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('__WWS_WIRED__'));
  ok(r.includes('WWS_STATE'));
});

t('emitWalkingWildStepperRuntime: disabled → no IIFE / no sentinel', () => {
  const r = emitWalkingWildStepperRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__WWS_WIRED__'));
});

t('emitWalkingWildStepperRuntime: FS-active guard + HW guard + appliesIn branch present', () => {
  const r = emitWalkingWildStepperRuntime(resolveConfig({
    walkingWildStepper: { enabled: true, appliesIn: 'both' },
  }));
  ok(r.includes('_isFsActive'));
  ok(r.includes('_isHwActive'));
  ok(r.includes('APPLIES_IN'));
  /* When appliesIn='both', onSpinResult branch must be wired too. */
  ok(r.includes("HookBus.on('onSpinResult'"));
});

t('emitWalkingWildStepperRuntime: emits documented events onWalkingWildSpawned/Step/Exited', () => {
  const r = emitWalkingWildStepperRuntime(resolveConfig({ walkingWildStepper: { enabled: true } }));
  ok(r.includes("HookBus.emit('onWalkingWildSpawned'"));
  ok(r.includes("HookBus.emit('onWalkingWildStep'"));
  ok(r.includes("HookBus.emit('onWalkingWildExited'"));
});
