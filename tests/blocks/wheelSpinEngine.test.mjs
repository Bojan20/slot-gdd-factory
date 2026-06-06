/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitWheelSpinEngineCSS, emitWheelSpinEngineRuntime,
} from '../../src/blocks/wheelSpinEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/wheelSpinEngine.mjs —');

t('defaultConfig: industry-baseline', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.spinDurationMs, 2400);
  eq(d.minRevolutions, 4);
  eq(d.maxRevolutions, 7);
});

t('resolveConfig: defensive on null/undefined', () => {
  eq(resolveConfig(null).enabled, true);
  eq(resolveConfig(undefined).enabled, true);
  eq(resolveConfig({}).enabled, true);
});

t('resolveConfig: clamps spinDurationMs', () => {
  eq(resolveConfig({ wheelSpinEngine: { spinDurationMs: 10    } }).spinDurationMs, 2400);
  eq(resolveConfig({ wheelSpinEngine: { spinDurationMs: 9999  } }).spinDurationMs, 2400);
  eq(resolveConfig({ wheelSpinEngine: { spinDurationMs: 3000  } }).spinDurationMs, 3000);
});

t('resolveConfig: swaps min/max revolutions when inverted', () => {
  const c = resolveConfig({ wheelSpinEngine: { minRevolutions: 8, maxRevolutions: 3 } });
  eq(c.minRevolutions, 3);
  eq(c.maxRevolutions, 8);
});

t('resolveConfig: boolean coercion for enabled', () => {
  eq(resolveConfig({ wheelSpinEngine: { enabled: false } }).enabled, false);
  eq(resolveConfig({ wheelSpinEngine: { enabled: 'yes' } }).enabled, true, 'non-bool ignored');
});

t('emitWheelSpinEngineCSS: empty when disabled', () => {
  eq(emitWheelSpinEngineCSS({ enabled: false, spinDurationMs: 1000, fadeFallbackMs: 100 }), '');
});

t('emitWheelSpinEngineCSS: emits .wheel-svg transition + reduce-motion guard', () => {
  const s = emitWheelSpinEngineCSS(defaultConfig());
  ct(s, '.grid-wheel .wheel-svg');
  ct(s, 'transition: transform');
  ct(s, '@media (prefers-reduced-motion: reduce)');
});

t('emitWheelSpinEngineRuntime: empty when disabled', () => {
  const s = emitWheelSpinEngineRuntime({ enabled: false, spinDurationMs: 100, minRevolutions: 1, maxRevolutions: 1 });
  nct(s, '__SLOT_KIND_RUNSPIN__.wheel');
});

t('emitWheelSpinEngineRuntime: registers wheel + radial in registry', () => {
  const s = emitWheelSpinEngineRuntime(defaultConfig());
  ct(s, '__SLOT_KIND_RUNSPIN__.wheel');
  ct(s, '__SLOT_KIND_RUNSPIN__.radial');
});

t('emitWheelSpinEngineRuntime: HookBus preSpin listener registered', () => {
  ct(emitWheelSpinEngineRuntime(defaultConfig()), "HookBus.on('preSpin'");
});

t('vendor neutrality: zero leaked mentions', () => {
  const blob = emitWheelSpinEngineCSS(defaultConfig()) + emitWheelSpinEngineRuntime(defaultConfig());
  for (const v of ['IGT','Pragmatic','Cleopatra','Buffalo','Megaways','Olympus','Zeus','Reactoonz','playa-slot']) {
    nct(blob, v, `vendor leak: ${v}`);
  }
});

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
