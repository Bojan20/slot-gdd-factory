/* eslint-disable no-console */
/**
 * Wave T-slim Phase 2 — devForceButtons runtime tests.
 *
 * Coverage:
 *   • resolveDevForceButtonsConfig — defaults, defensive on missing /
 *     malformed features, every multiplier-style kind detected
 *   • emitDevForceButtonsRuntime — emits all 3 handler IIFEs, bakes
 *     HAS_MULT_FEATURE correctly, force-button rule compliance
 *     (every click MUST call runOneBaseSpin), vendor neutrality
 */

import {
  resolveDevForceButtonsConfig,
  emitDevForceButtonsRuntime,
} from '../../src/runtime/devForceButtons.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— runtime/devForceButtons.mjs —');

/* ── resolveDevForceButtonsConfig ── */

t('resolveDevForceButtonsConfig: default false when no features', () => {
  eq(resolveDevForceButtonsConfig({}).hasMultFeature, false);
});

t('resolveDevForceButtonsConfig: null model → false', () => {
  eq(resolveDevForceButtonsConfig(null).hasMultFeature, false);
  eq(resolveDevForceButtonsConfig(undefined).hasMultFeature, false);
});

t('resolveDevForceButtonsConfig: non-array features → false', () => {
  eq(resolveDevForceButtonsConfig({ features: 'string' }).hasMultFeature, false);
  eq(resolveDevForceButtonsConfig({ features: { kind: 'multiplier' } }).hasMultFeature, false);
});

t('resolveDevForceButtonsConfig: detects "multiplier" kind', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'multiplier' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: detects multiplier_orb / multiplier-orb', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'multiplier_orb' }] }).hasMultFeature, true);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'multiplier-orb' }] }).hasMultFeature, true);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'multiplierorb' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: detects persistent_multiplier variants', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'persistent_multiplier' }] }).hasMultFeature, true);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'persistent-multiplier' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: detects lightning', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'lightning' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: detects progressive_free_spins variants', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'progressive_free_spins' }] }).hasMultFeature, true);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'progressive-free-spins' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: case-insensitive kind match', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'MULTIPLIER' }] }).hasMultFeature, true);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'Lightning' }] }).hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: non-multiplier kinds → false', () => {
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'scatter' }] }).hasMultFeature, false);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'wild' }] }).hasMultFeature, false);
  eq(resolveDevForceButtonsConfig({ features: [{ kind: 'free_spins' }] }).hasMultFeature, false);
});

t('resolveDevForceButtonsConfig: malformed entry skipped without throwing', () => {
  const r = resolveDevForceButtonsConfig({
    features: [null, undefined, {}, { kind: 123 }, { kind: 'multiplier' }],
  });
  eq(r.hasMultFeature, true);
});

t('resolveDevForceButtonsConfig: returns boolean exactly', () => {
  const r = resolveDevForceButtonsConfig({ features: [{ kind: 'multiplier' }] });
  eq(typeof r.hasMultFeature, 'boolean');
});

/* ── emitDevForceButtonsRuntime ── */

t('emitDevForceButtonsRuntime: emits all 3 button handlers', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'if (devFsBtn) {');
  ct(s, "document.getElementById(\"devBwBtn\")");
  ct(s, "document.getElementById(\"devMultBtn\")");
});

t('emitDevForceButtonsRuntime: every click → runOneBaseSpin (rule_force_buttons_real_spin)', () => {
  const s = emitDevForceButtonsRuntime({});
  /* must occur 3 times — once per button */
  const count = (s.match(/runOneBaseSpin\(\)/g) || []).length;
  if (count < 3) throw new Error(`expected ≥ 3 runOneBaseSpin() calls, got ${count}`);
});

t('emitDevForceButtonsRuntime: FS handler sets FORCE_TRIGGER', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'FORCE_TRIGGER = { scatterCount: first.count }');
});

t('emitDevForceButtonsRuntime: BW handler sets window.__FORCE_BIG_WIN_TIER__', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'window.__FORCE_BIG_WIN_TIER__ = maxTier');
});

t('emitDevForceButtonsRuntime: Mult handler calls HookBus.setMult', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'window.HookBus.setMult(val)');
});

t('emitDevForceButtonsRuntime: HAS_MULT_FEATURE baked from model', () => {
  const sNo = emitDevForceButtonsRuntime({ features: [] });
  ct(sNo, 'var HAS_MULT_FEATURE = false;');
  const sYes = emitDevForceButtonsRuntime({ features: [{ kind: 'multiplier' }] });
  ct(sYes, 'var HAS_MULT_FEATURE = true;');
});

t('emitDevForceButtonsRuntime: Mult cycle is industry baseline ladder', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'var MULT_CYCLE = [2, 5, 10, 25, 50, 100, 1];');
});

t('emitDevForceButtonsRuntime: BW re-enable on onBigWinTierEnd', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, "window.HookBus.on('onBigWinTierEnd', oneShot)");
});

t('emitDevForceButtonsRuntime: Mult re-enable on postSpin', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, "window.HookBus.on('postSpin', oneShotPS)");
});

t('emitDevForceButtonsRuntime: defensive guard on every button (if (btn))', () => {
  const s = emitDevForceButtonsRuntime({});
  ct(s, 'if (devFsBtn) {');
  ct(s, 'if (devBwBtn) {');
  ct(s, 'if (devMultBtn) {');
});

/* ── Vendor neutrality ── */

t('vendor neutrality: no game / vendor names emitted', () => {
  const blob = emitDevForceButtonsRuntime({ features: [{ kind: 'multiplier' }] });
  for (const v of ['industry standard','Pragmatic','Cleopatra','Buffalo','Megaways','NetEnt',
                   'Zeus','Olympus','Reactoonz','Bonanza','WoO','GoO',
                   'playa-slot']) {
    nct(blob, v, `vendor mention "${v}" leaked into runtime emit`);
  }
});

/* ── Summary ── */

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
