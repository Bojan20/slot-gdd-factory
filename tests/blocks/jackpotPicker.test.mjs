/**
 * tests/blocks/jackpotPicker.test.mjs
 *
 * Unit + emit-shape tests for `jackpotPicker.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks / invariants
 *   - pickTierFromDistribution pure helper (deterministic + empty)
 *   - computeFinalTier pure helper (ordering / empty / single)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + sentinel + appliesIn + auto-pick
 *   - Direct HookBus.emit single-quote convention
 */
import { test as t } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitJackpotPickerCSS,
  emitJackpotPickerMarkup,
  emitJackpotPickerRuntime,
  pickTierFromDistribution,
  computeFinalTier,
} from '../../src/blocks/jackpotPicker.mjs';

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default, 4x3 grid, 3 picks required', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.gridCols, 4);
  equal(c.gridRows, 3);
  equal(c.picksRequired, 3);
  equal(c.appliesIn, 'bonus');
  equal(c.pickAnimMs, 500);
  equal(c.dismissDelayMs, 1500);
  equal(c.glowColor, '#ffaa00');
  equal(c.fontSizePx, 18);
  equal(c.autoPickMode, false);
  ok(Array.isArray(c.distribution));
  equal(c.distribution.length, 4);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ jackpotPicker: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps gridCols / gridRows to bounds', () => {
  const lo = resolveConfig({ jackpotPicker: { gridCols: 1, gridRows: 0 } });
  equal(lo.gridCols, 2);
  equal(lo.gridRows, 2);

  const hi = resolveConfig({ jackpotPicker: { gridCols: 99, gridRows: 99 } });
  equal(hi.gridCols, 8);
  equal(hi.gridRows, 8);

  /* Valid pass-through */
  const okv = resolveConfig({ jackpotPicker: { gridCols: 5, gridRows: 4 } });
  equal(okv.gridCols, 5);
  equal(okv.gridRows, 4);
});

t('resolveConfig: invariant picksRequired ≤ gridCols × gridRows (auto-clamps down)', () => {
  /* 2×2 = 4 tiles, picksRequired=5 must clamp to 4. */
  const c = resolveConfig({
    jackpotPicker: { enabled: true, gridCols: 2, gridRows: 2, picksRequired: 5 },
  });
  ok(c.picksRequired <= c.gridCols * c.gridRows);
  equal(c.picksRequired, 4);
});

t('resolveConfig: clamps pickAnimMs + dismissDelayMs to bounds', () => {
  const lo = resolveConfig({
    jackpotPicker: { enabled: true, pickAnimMs: 1, dismissDelayMs: -100 },
  });
  equal(lo.pickAnimMs, 200);
  equal(lo.dismissDelayMs, 0);

  const hi = resolveConfig({
    jackpotPicker: { enabled: true, pickAnimMs: 99999, dismissDelayMs: 99999 },
  });
  equal(hi.pickAnimMs, 2000);
  equal(hi.dismissDelayMs, 5000);
});

t('resolveConfig: accepts only valid appliesIn (hw/bonus/both); rejects others', () => {
  const def = defaultConfig();
  equal(resolveConfig({ jackpotPicker: { appliesIn: 'hw'    } }).appliesIn, 'hw');
  equal(resolveConfig({ jackpotPicker: { appliesIn: 'bonus' } }).appliesIn, 'bonus');
  equal(resolveConfig({ jackpotPicker: { appliesIn: 'both'  } }).appliesIn, 'both');
  equal(resolveConfig({ jackpotPicker: { appliesIn: 'fs'    } }).appliesIn, def.appliesIn);
  equal(resolveConfig({ jackpotPicker: { appliesIn: 42      } }).appliesIn, def.appliesIn);
});

t('resolveConfig: rejects malformed distribution → keeps default', () => {
  const def = defaultConfig();
  /* Missing fields */
  const bad1 = resolveConfig({ jackpotPicker: { distribution: [{ tier: 'X' }] } });
  deepEqual(bad1.distribution.map(e => e.tier), def.distribution.map(e => e.tier));
  /* Empty array */
  const bad2 = resolveConfig({ jackpotPicker: { distribution: [] } });
  deepEqual(bad2.distribution.map(e => e.tier), def.distribution.map(e => e.tier));
  /* Non-array */
  const bad3 = resolveConfig({ jackpotPicker: { distribution: 'oops' } });
  deepEqual(bad3.distribution.map(e => e.tier), def.distribution.map(e => e.tier));
  /* Valid pass-through */
  const okv = resolveConfig({
    jackpotPicker: {
      distribution: [
        { tier: 'A', weight: 10, value: 5 },
        { tier: 'B', weight:  5, value: 50 },
      ],
    },
  });
  equal(okv.distribution.length, 2);
  equal(okv.distribution[1].tier, 'B');
});

t('resolveConfig: accepts valid hex colors; rejects bad', () => {
  const def = defaultConfig();
  equal(resolveConfig({ jackpotPicker: { glowColor: '#ff00aa' } }).glowColor, '#ff00aa');
  equal(resolveConfig({ jackpotPicker: { tileColor: '#000000' } }).tileColor, '#000000');
  equal(resolveConfig({ jackpotPicker: { glowColor: 'orange'  } }).glowColor, def.glowColor);
  equal(resolveConfig({ jackpotPicker: { tileColor: 12345     } }).tileColor, def.tileColor);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. pickTierFromDistribution (pure helper)                            */
/* ──────────────────────────────────────────────────────────────────── */

t('pickTierFromDistribution: deterministic with seeded RNG', () => {
  const dist = [
    { tier: 'A', weight: 50, value: 1 },
    { tier: 'B', weight: 50, value: 2 },
  ];
  /* rng=0 always → first non-zero bucket: A */
  const result = pickTierFromDistribution(dist, () => 0);
  equal(result.tier, 'A');
  /* rng=0.99 → last bucket: B */
  const result2 = pickTierFromDistribution(dist, () => 0.99);
  equal(result2.tier, 'B');
});

t('pickTierFromDistribution: empty / null distribution → null', () => {
  equal(pickTierFromDistribution([],      () => 0.5), null);
  equal(pickTierFromDistribution(null,    () => 0.5), null);
  equal(pickTierFromDistribution(undefined, () => 0.5), null);
});

t('pickTierFromDistribution: weighted bucket honours weights', () => {
  /* 99:1 split — over 1000 draws with linear-space rng we should see
   * the heavy bucket dominate >= 90× more often. */
  const dist = [
    { tier: 'HEAVY', weight: 99, value: 1 },
    { tier: 'LIGHT', weight:  1, value: 100 },
  ];
  let heavy = 0;
  let light = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) / N; /* deterministic uniform sweep over [0,1) */
    const e = pickTierFromDistribution(dist, () => r);
    if (e.tier === 'HEAVY') heavy++;
    else if (e.tier === 'LIGHT') light++;
  }
  ok(heavy > light * 90, `expected HEAVY ≫ LIGHT, got heavy=${heavy} light=${light}`);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. computeFinalTier (pure helper)                                    */
/* ──────────────────────────────────────────────────────────────────── */

t('computeFinalTier: picks [MINI,MAJOR,MINOR] → MAJOR (highest by dist index)', () => {
  const dist = defaultConfig().distribution; /* [MINI,MINOR,MAJOR,GRAND] */
  const picks = [
    { tile: 0, tier: 'MINI',  value: 10 },
    { tile: 1, tier: 'MAJOR', value: 250 },
    { tile: 2, tier: 'MINOR', value: 50 },
  ];
  equal(computeFinalTier(picks, dist), 'MAJOR');
});

t('computeFinalTier: empty picks → null', () => {
  const dist = defaultConfig().distribution;
  equal(computeFinalTier([],   dist), null);
  equal(computeFinalTier(null, dist), null);
});

t('computeFinalTier: single pick → that tier', () => {
  const dist = defaultConfig().distribution;
  equal(computeFinalTier([{ tile: 0, tier: 'MINOR', value: 50 }], dist), 'MINOR');
  equal(computeFinalTier([{ tile: 0, tier: 'GRAND', value: 1000 }], dist), 'GRAND');
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS emit                                                          */
/* ──────────────────────────────────────────────────────────────────── */

t('emitJackpotPickerCSS: enabled → contains .jpk-tile + .jpk-overlay', () => {
  const css = emitJackpotPickerCSS(resolveConfig({ jackpotPicker: { enabled: true } }));
  ok(css.includes('.jpk-tile'));
  ok(css.includes('.jpk-overlay'));
  ok(css.includes('.jpk-board'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitJackpotPickerCSS: disabled → empty marker, no classes', () => {
  const css = emitJackpotPickerCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.jpk-tile'));
  ok(!css.includes('.jpk-overlay'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 6. Markup emit                                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emitJackpotPickerMarkup: disabled → marker only, no overlay', () => {
  const m = emitJackpotPickerMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('jpkOverlay'));
});

t('emitJackpotPickerMarkup: enabled → contains overlay div + board host', () => {
  const m = emitJackpotPickerMarkup(resolveConfig({ jackpotPicker: { enabled: true } }));
  ok(m.includes('jpkOverlay'));
  ok(m.includes('jpkBoard'));
  ok(m.includes('role="dialog"'));
  ok(m.includes('aria-modal="true"'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 7. Runtime emit                                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('emitJackpotPickerRuntime: enabled registers HookBus listeners + sentinel', () => {
  const r = emitJackpotPickerRuntime(resolveConfig({ jackpotPicker: { enabled: true } }));
  ok(r.includes("HookBus.on('onJackpotPickerTrigger'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onSkipRequested'"));
  ok(r.includes('__JPK_WIRED__'));
});

t('emitJackpotPickerRuntime: disabled → no IIFE / no sentinel', () => {
  const r = emitJackpotPickerRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__JPK_WIRED__'));
});

t('emitJackpotPickerRuntime: includes appliesIn branch (hw/bonus/both)', () => {
  const r = emitJackpotPickerRuntime(resolveConfig({
    jackpotPicker: { enabled: true, appliesIn: 'both' },
  }));
  ok(r.includes('APPLIES_IN'));
  ok(r.includes('_isHwActive'));
  ok(r.includes("'both'") || r.includes('both'));
});

t('emitJackpotPickerRuntime: autoPickMode true → branch present', () => {
  const r = emitJackpotPickerRuntime(resolveConfig({
    jackpotPicker: { enabled: true, autoPickMode: true },
  }));
  ok(r.includes('AUTO_PICK_MODE'));
  ok(r.includes('AUTO_PICK_MODE  = true') || r.includes('AUTO_PICK_MODE = true'));
  ok(r.includes('_autoPick'));
});

t('emitJackpotPickerRuntime: uses single-quoted HookBus.emit strings', () => {
  const r = emitJackpotPickerRuntime(resolveConfig({ jackpotPicker: { enabled: true } }));
  ok(r.includes("HookBus.emit('onJackpotPickerTileRevealed'"));
  ok(r.includes("HookBus.emit('onJackpotPickerComplete'"));
  ok(r.includes("HookBus.emit('onJackpotPickerDismissed'"));
  /* Negative: no double-quoted variant should appear for these events */
  ok(!r.includes('HookBus.emit("onJackpotPickerTileRevealed"'));
  ok(!r.includes('HookBus.emit("onJackpotPickerComplete"'));
});
