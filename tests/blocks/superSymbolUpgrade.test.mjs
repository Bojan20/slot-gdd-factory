/**
 * tests/blocks/superSymbolUpgrade.test.mjs
 *
 * Unit + emit-shape tests for `superSymbolUpgrade.mjs`.
 *
 * Covers:
 *   - defaultConfig invariants
 *   - resolveConfig clamping / validation / fallbacks
 *   - nextTier pure helper (bump + cap + negative collapse)
 *   - upgradeSymbol pure helper (LP→MP, MP→HP, HP stays, unknown stays, tier=0 identity)
 *   - CSS / Markup / Runtime emit shape (enabled vs disabled)
 *   - HookBus listener wiring + guard branches + priority
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitSuperSymbolUpgradeCSS,
  emitSuperSymbolUpgradeMarkup,
  emitSuperSymbolUpgradeRuntime,
  nextTier,
  upgradeSymbol,
} from '../../src/blocks/superSymbolUpgrade.mjs';

/* ──────────────────────────────────────────────────────────────────── */
/* 1. defaultConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('defaultConfig: disabled by default, superSymbol=U', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.superSymbol, 'U');
  equal(c.maxTier, 2);
  equal(c.appliesIn, 'fs');
  ok(Array.isArray(c.lpTiers) && c.lpTiers.length > 0);
  ok(Array.isArray(c.mpTiers) && c.mpTiers.length > 0);
  ok(Array.isArray(c.hpTiers) && c.hpTiers.length > 0);
  ok(c.upgradeAnimMs >= 200 && c.upgradeAnimMs <= 3000);
  ok(c.pulseMs >= 200 && c.pulseMs <= 2000);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 2. resolveConfig                                                     */
/* ──────────────────────────────────────────────────────────────────── */

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ superSymbolUpgrade: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps maxTier + upgradeAnimMs + pulseMs to bounds', () => {
  const c = resolveConfig({
    superSymbolUpgrade: {
      enabled: true,
      maxTier: 99,
      upgradeAnimMs: 99999,
      pulseMs: 99999,
    },
  });
  ok(c.maxTier <= 5);
  ok(c.maxTier >= 1);
  ok(c.upgradeAnimMs <= 3000);
  ok(c.upgradeAnimMs >= 200);
  ok(c.pulseMs <= 2000);
  ok(c.pulseMs >= 200);
});

t('resolveConfig: clamps lower bounds (negative / zero inputs)', () => {
  const c = resolveConfig({
    superSymbolUpgrade: {
      enabled: true,
      maxTier: -5,
      upgradeAnimMs: 1,
      pulseMs: 1,
    },
  });
  equal(c.maxTier, 1);
  equal(c.upgradeAnimMs, 200);
  equal(c.pulseMs, 200);
});

t('resolveConfig: rejects invalid appliesIn → keeps default fs', () => {
  const c = resolveConfig({ superSymbolUpgrade: { appliesIn: 'bonus' } });
  equal(c.appliesIn, 'fs');
});

t('resolveConfig: accepts valid appliesIn values base/fs/both', () => {
  equal(resolveConfig({ superSymbolUpgrade: { appliesIn: 'base' } }).appliesIn, 'base');
  equal(resolveConfig({ superSymbolUpgrade: { appliesIn: 'fs'   } }).appliesIn, 'fs');
  equal(resolveConfig({ superSymbolUpgrade: { appliesIn: 'both' } }).appliesIn, 'both');
});

t('resolveConfig: rejects empty lpTiers/mpTiers/hpTiers → falls back to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    superSymbolUpgrade: {
      enabled: true,
      lpTiers: [],
      mpTiers: [],
      hpTiers: [],
    },
  });
  equal(c.lpTiers.join(','), def.lpTiers.join(','));
  equal(c.mpTiers.join(','), def.mpTiers.join(','));
  equal(c.hpTiers.join(','), def.hpTiers.join(','));
});

t('resolveConfig: accepts valid hex glowColor', () => {
  const c = resolveConfig({ superSymbolUpgrade: { glowColor: '#abcdef' } });
  equal(c.glowColor, '#abcdef');
});

t('resolveConfig: rejects bad hex glowColor → keeps default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ superSymbolUpgrade: { glowColor: 'not-a-color' } });
  equal(c.glowColor, def.glowColor);
});

t('resolveConfig: accepts custom symbol lists', () => {
  const c = resolveConfig({
    superSymbolUpgrade: {
      enabled: true,
      lpTiers: ['L1', 'L2'],
      mpTiers: ['M9'],
      hpTiers: ['H9'],
    },
  });
  equal(c.lpTiers.join(','), 'L1,L2');
  equal(c.mpTiers.join(','), 'M9');
  equal(c.hpTiers.join(','), 'H9');
});

/* ──────────────────────────────────────────────────────────────────── */
/* 3. nextTier (pure helper)                                            */
/* ──────────────────────────────────────────────────────────────────── */

t('nextTier: 0 → 1 (normal bump)', () => {
  equal(nextTier(0, 2), 1);
});

t('nextTier: maxTier=2, currentTier=2 → 2 (capped)', () => {
  equal(nextTier(2, 2), 2);
});

t('nextTier: negative input collapses to 0', () => {
  equal(nextTier(-3, 2), 0);
});

t('nextTier: NaN input collapses to 0', () => {
  equal(nextTier(NaN, 2), 0);
});

/* ──────────────────────────────────────────────────────────────────── */
/* 4. upgradeSymbol (pure helper)                                       */
/* ──────────────────────────────────────────────────────────────────── */

const LP = ['10', 'J', 'Q', 'K', 'A'];
const MP = ['M1', 'M2', 'M3'];
const HP = ['H1', 'H2'];

t('upgradeSymbol: LP "J" at tier=1 → MP symbol', () => {
  const out = upgradeSymbol('J', 1, LP, MP, HP);
  ok(MP.includes(out));
});

t('upgradeSymbol: MP "M1" at tier=1 → HP symbol', () => {
  const out = upgradeSymbol('M1', 1, LP, MP, HP);
  ok(HP.includes(out));
});

t('upgradeSymbol: HP "H1" already-HP → "H1" (no further upgrade)', () => {
  const out = upgradeSymbol('H1', 1, LP, MP, HP);
  equal(out, 'H1');
});

t('upgradeSymbol: unknown symbol at tier=1 → unchanged', () => {
  const out = upgradeSymbol('UNKNOWN', 1, LP, MP, HP);
  equal(out, 'UNKNOWN');
});

t('upgradeSymbol: tier=0 → identity', () => {
  equal(upgradeSymbol('J', 0, LP, MP, HP), 'J');
  equal(upgradeSymbol('M2', 0, LP, MP, HP), 'M2');
});

t('upgradeSymbol: LP "10" at tier=2 → HP symbol', () => {
  const out = upgradeSymbol('10', 2, LP, MP, HP);
  ok(HP.includes(out));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 5. CSS emit                                                          */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSuperSymbolUpgradeCSS: enabled contains tier-1 + tier-2 classes', () => {
  const css = emitSuperSymbolUpgradeCSS(resolveConfig({ superSymbolUpgrade: { enabled: true } }));
  ok(css.includes('.is-upgraded-tier-1'));
  ok(css.includes('.is-upgraded-tier-2'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitSuperSymbolUpgradeCSS: disabled → no CSS / no tier class', () => {
  const css = emitSuperSymbolUpgradeCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.is-upgraded-tier-1'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 6. Markup emit                                                       */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSuperSymbolUpgradeMarkup: disabled → marker stub', () => {
  const m = emitSuperSymbolUpgradeMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
});

t('emitSuperSymbolUpgradeMarkup: enabled → no shell (runtime decorates cells)', () => {
  const m = emitSuperSymbolUpgradeMarkup(resolveConfig({ superSymbolUpgrade: { enabled: true } }));
  ok(m.length > 0);
  ok(!m.includes('disabled'));
});

/* ──────────────────────────────────────────────────────────────────── */
/* 7. Runtime emit                                                      */
/* ──────────────────────────────────────────────────────────────────── */

t('emitSuperSymbolUpgradeRuntime: enabled registers HookBus listeners + sentinel', () => {
  const r = emitSuperSymbolUpgradeRuntime(resolveConfig({ superSymbolUpgrade: { enabled: true } }));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('onTumbleStep'"));
  ok(r.includes("HookBus.on('onSpinResult'"));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('__SSU_WIRED__'));
  ok(r.includes('SSU_STATE'));
});

t('emitSuperSymbolUpgradeRuntime: disabled → no IIFE / no sentinel', () => {
  const r = emitSuperSymbolUpgradeRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__SSU_WIRED__'));
});

t('emitSuperSymbolUpgradeRuntime: HW guard + FS-active + appliesIn branch present', () => {
  const r = emitSuperSymbolUpgradeRuntime(resolveConfig({
    superSymbolUpgrade: { enabled: true, appliesIn: 'both' },
  }));
  ok(r.includes('_isHwActive'));
  ok(r.includes('_isFsActive'));
  ok(r.includes('APPLIES_IN'));
});

t('emitSuperSymbolUpgradeRuntime: uses priority 30 for onTumbleStep listener', () => {
  const r = emitSuperSymbolUpgradeRuntime(resolveConfig({ superSymbolUpgrade: { enabled: true } }));
  /* The onTumbleStep wire line must carry priority 30. */
  const tumbleLineRe = /HookBus\.on\(\s*['"]onTumbleStep['"][^)]*priority:\s*30/;
  ok(tumbleLineRe.test(r));
});

t('emitSuperSymbolUpgradeRuntime: emits documented events', () => {
  const r = emitSuperSymbolUpgradeRuntime(resolveConfig({ superSymbolUpgrade: { enabled: true } }));
  ok(r.includes("HookBus.emit('onSuperSymbolUpgraded'"));
  ok(r.includes("HookBus.emit('onSuperSymbolUpgradeReset'"));
});
