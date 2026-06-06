/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitSlingoSpinEngineCSS, emitSlingoSpinEngineRuntime,
} from '../../src/blocks/slingoSpinEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/slingoSpinEngine.mjs —');

t('defaultConfig defaults', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.perColumnSpinMs, 750);
});

t('resolveConfig: null safe', () => { eq(resolveConfig(null).enabled, true); });

t('resolveConfig: clamps perColumnSpinMs', () => {
  eq(resolveConfig({ slingoSpinEngine: { perColumnSpinMs: 50    } }).perColumnSpinMs, 750);
  eq(resolveConfig({ slingoSpinEngine: { perColumnSpinMs: 99999 } }).perColumnSpinMs, 750);
  eq(resolveConfig({ slingoSpinEngine: { perColumnSpinMs: 1200  } }).perColumnSpinMs, 1200);
});

t('emitSlingoSpinEngineCSS: empty when disabled', () => {
  eq(emitSlingoSpinEngineCSS({ enabled: false, perColumnSpinMs: 100, staggerMs: 0, matchPulseMs: 100, fadeFallbackMs: 100 }), '');
});

t('emitSlingoSpinEngineCSS: emits strip cycle + match pulse keyframes', () => {
  const s = emitSlingoSpinEngineCSS(defaultConfig());
  ct(s, '@keyframes slingoStripCycle');
  ct(s, '@keyframes slingoMatchPulse');
  ct(s, '@media (prefers-reduced-motion: reduce)');
});

t('emitSlingoSpinEngineRuntime: empty when disabled', () => {
  eq(emitSlingoSpinEngineRuntime({ enabled: false, perColumnSpinMs: 100, staggerMs: 0 }), '');
});

t('emitSlingoSpinEngineRuntime: registers slingo + listens preSpin', () => {
  const s = emitSlingoSpinEngineRuntime(defaultConfig());
  ct(s, '__SLOT_KIND_RUNSPIN__.slingo');
  ct(s, "HookBus.on('preSpin'");
  ct(s, 'slingo-match');
});

t('vendor neutrality', () => {
  const blob = emitSlingoSpinEngineCSS(defaultConfig()) + emitSlingoSpinEngineRuntime(defaultConfig());
  for (const v of ['IGT','Pragmatic','Cleopatra','Megaways','Olympus','playa-slot']) {
    nct(blob, v, `vendor leak: ${v}`);
  }
});

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
