/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitCrashSpinEngineCSS, emitCrashSpinEngineRuntime,
} from '../../src/blocks/crashSpinEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/crashSpinEngine.mjs —');

t('defaultConfig defaults', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.spinDurationMs, 1800);
  eq(d.peakMultiplierMin, 1.2);
  eq(d.peakMultiplierMax, 25.0);
});

t('resolveConfig: null safe', () => { eq(resolveConfig(null).enabled, true); });

t('resolveConfig: clamps spinDurationMs', () => {
  eq(resolveConfig({ crashSpinEngine: { spinDurationMs: 50    } }).spinDurationMs, 1800);
  eq(resolveConfig({ crashSpinEngine: { spinDurationMs: 99999 } }).spinDurationMs, 1800);
  eq(resolveConfig({ crashSpinEngine: { spinDurationMs: 2200  } }).spinDurationMs, 2200);
});

t('resolveConfig: clamps peakMultiplierMax', () => {
  eq(resolveConfig({ crashSpinEngine: { peakMultiplierMax: 0.5    } }).peakMultiplierMax, 25.0);
  eq(resolveConfig({ crashSpinEngine: { peakMultiplierMax: 9999.0 } }).peakMultiplierMax, 25.0);
  eq(resolveConfig({ crashSpinEngine: { peakMultiplierMax: 50.0   } }).peakMultiplierMax, 50.0);
});

t('resolveConfig: swaps min/max when inverted', () => {
  const c = resolveConfig({ crashSpinEngine: { peakMultiplierMin: 30.0, peakMultiplierMax: 5.0 } });
  if (c.peakMultiplierMin > c.peakMultiplierMax) throw new Error('did not swap');
});

t('emitCrashSpinEngineCSS: empty when disabled', () => {
  eq(emitCrashSpinEngineCSS({ enabled: false, spinDurationMs: 100, fadeFallbackMs: 100 }), '');
});

t('emitCrashSpinEngineCSS: emits path transition + reduce-motion guard', () => {
  const s = emitCrashSpinEngineCSS(defaultConfig());
  ct(s, 'stroke-dashoffset');
  ct(s, '@media (prefers-reduced-motion: reduce)');
  ct(s, '@keyframes crashCounter');
});

t('emitCrashSpinEngineRuntime: empty when disabled', () => {
  eq(emitCrashSpinEngineRuntime({ enabled: false, spinDurationMs: 100, peakMultiplierMin: 1, peakMultiplierMax: 2 }), '');
});

t('emitCrashSpinEngineRuntime: registers crash + listens preSpin', () => {
  const s = emitCrashSpinEngineRuntime(defaultConfig());
  ct(s, '__SLOT_KIND_RUNSPIN__.crash');
  ct(s, "HookBus.on('preSpin'");
  ct(s, 'getTotalLength');
});

t('vendor neutrality', () => {
  const blob = emitCrashSpinEngineCSS(defaultConfig()) + emitCrashSpinEngineRuntime(defaultConfig());
  for (const v of ['IGT','Pragmatic','Cleopatra','Megaways','Olympus','playa-slot']) {
    nct(blob, v, `vendor leak: ${v}`);
  }
});

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
