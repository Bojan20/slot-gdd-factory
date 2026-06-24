/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitPlinkoSpinEngineCSS, emitPlinkoSpinEngineRuntime,
} from '../../src/blocks/plinkoSpinEngine.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/plinkoSpinEngine.mjs —');

t('defaultConfig defaults', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.rowStepMs, 110);
});

t('resolveConfig: null safe', () => { eq(resolveConfig(null).enabled, true); });

t('resolveConfig: clamps rowStepMs', () => {
  eq(resolveConfig({ plinkoSpinEngine: { rowStepMs: 10  } }).rowStepMs, 110);
  eq(resolveConfig({ plinkoSpinEngine: { rowStepMs: 999 } }).rowStepMs, 110);
  eq(resolveConfig({ plinkoSpinEngine: { rowStepMs: 150 } }).rowStepMs, 150);
});

t('emitPlinkoSpinEngineCSS: empty when disabled', () => {
  eq(emitPlinkoSpinEngineCSS({ enabled: false, rowStepMs: 100, finalSettleMs: 100, fadeFallbackMs: 100 }), '');
});

t('emitPlinkoSpinEngineCSS: emits ball CSS + reduce-motion guard', () => {
  const s = emitPlinkoSpinEngineCSS(defaultConfig());
  ct(s, '.plinko-ball');
  ct(s, '.plinko-ball.is-armed');
  ct(s, '.plinko-ball.is-landed');
  ct(s, '@media (prefers-reduced-motion: reduce)');
});

t('emitPlinkoSpinEngineRuntime: empty when disabled', () => {
  eq(emitPlinkoSpinEngineRuntime({ enabled: false, rowStepMs: 100, finalSettleMs: 100 }), '');
});

t('emitPlinkoSpinEngineRuntime: registers plinko + listens preSpin', () => {
  const s = emitPlinkoSpinEngineRuntime(defaultConfig());
  ct(s, '__SLOT_KIND_RUNSPIN__.plinko');
  ct(s, "HookBus.on('preSpin'");
});

t('vendor neutrality', () => {
  const blob = emitPlinkoSpinEngineCSS(defaultConfig()) + emitPlinkoSpinEngineRuntime(defaultConfig());
  for (const v of ['industry standard','Pragmatic','Cleopatra','Megaways','Olympus','playa-slot']) {
    nct(blob, v, `vendor leak: ${v}`);
  }
});

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
