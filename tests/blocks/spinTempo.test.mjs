/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitSpinTempoRuntime,
} from '../../src/blocks/spinTempo.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/spinTempo.mjs —');

t('defaultConfig: s-avp cabinet reference values', () => {
  const c = defaultConfig();
  eq(c.windupMs, 100); eq(c.accelMs, 120); eq(c.steadyMs, 830);
  eq(c.decelMs, 350); eq(c.staggerMs, 320); eq(c.bouncePx, 4);
  eq(c.decelEasingSpeed, 0.11);
});

t('resolveConfig: preset "fast" loads faster cadence', () => {
  const c = resolveConfig({ spinTempo: { preset: 'fast' } });
  eq(c.steadyMs, 600); eq(c.staggerMs, 220); eq(c.decelMs, 240);
});

t('resolveConfig: preset "slow" loads cinematic cadence', () => {
  const c = resolveConfig({ spinTempo: { preset: 'slow' } });
  eq(c.steadyMs, 1100); eq(c.staggerMs, 380); eq(c.decelMs, 480);
});

t('resolveConfig: unknown preset falls back to s-avp', () => {
  const c = resolveConfig({ spinTempo: { preset: 'unicorn' } });
  eq(c.steadyMs, 830);
});

t('resolveConfig: per-key overrides preset', () => {
  const c = resolveConfig({ spinTempo: { preset: 'fast', steadyMs: 999 } });
  eq(c.steadyMs, 999); eq(c.staggerMs, 220);  /* preset still drives stagger */
});

t('resolveConfig: out-of-bounds value rejected → preset retained', () => {
  const c = resolveConfig({ spinTempo: { steadyMs: 99999 } });
  eq(c.steadyMs, 830);  /* default kept */
});

t('resolveConfig: float keys accepted within bounds', () => {
  const c = resolveConfig({ spinTempo: { bounceDecay: 0.7, decelEasingSpeed: 0.15 } });
  eq(c.bounceDecay, 0.7); eq(c.decelEasingSpeed, 0.15);
});

t('resolveConfig: negative values rejected', () => {
  const c = resolveConfig({ spinTempo: { steadyMs: -100 } });
  eq(c.steadyMs, 830);
});

t('emitSpinTempoRuntime: bakes SPIN_PROFILE constants', () => {
  const js = emitSpinTempoRuntime();
  ct(js, 'const SPIN_PROFILE = {');
  ct(js, 'windupMs: 100');
  ct(js, 'steadyMs: 830');
  ct(js, 'decelEasingSpeed: 0.11');
});

t('emitSpinTempoRuntime: fast preset baked', () => {
  const js = emitSpinTempoRuntime({ preset: 'fast' });
  ct(js, 'steadyMs: 600');
  ct(js, 'staggerMs: 220');
});

t('emitSpinTempoRuntime: per-key override baked', () => {
  const js = emitSpinTempoRuntime({ steadyMs: 950 });
  ct(js, 'steadyMs: 950');
});

t('parser: GDD without section → defaults', () => {
  const m = parseGDD('# G\n', 'md');
  /* slots all undefined */
  eq(m.spinTempo.steadyMs, undefined);
  /* but resolveConfig still yields defaults */
  eq(resolveConfig(m).steadyMs, 830);
});

t('parser: full Spin Tempo section → all knobs', () => {
  const gdd = [
    '# G', '',
    '## Spin Tempo',
    '- preset: fast',
    '- windup-ms: 80',
    '- steady-ms: 700',
    '- decel-ms: 280',
    '- stagger-ms: 240',
    '- bounce-px: 6',
    '- bounce-decay: 0.5',
    '- decel-easing-speed: 0.14',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  eq(m.spinTempo.preset, 'fast');
  eq(m.spinTempo.windupMs, 80);
  eq(m.spinTempo.steadyMs, 700);
  eq(m.spinTempo.decelMs, 280);
  eq(m.spinTempo.staggerMs, 240);
  eq(m.spinTempo.bouncePx, 6);
  eq(m.spinTempo.bounceDecay, 0.5);
  eq(m.spinTempo.decelEasingSpeed, 0.14);
});

t('parser: heading alias "Spin Cadence"', () => {
  const m = parseGDD('# G\n\n## Spin Cadence\n- steady-ms: 900\n', 'md');
  eq(m.spinTempo.steadyMs, 900);
});

t('parser → runtime roundtrip: GDD knobs reach SPIN_PROFILE', () => {
  const gdd = '# G\n\n## Spin Tempo\n- preset: slow\n- stagger-ms: 400\n';
  const m = parseGDD(gdd, 'md');
  const js = emitSpinTempoRuntime(resolveConfig(m));
  ct(js, 'steadyMs: 1100');       /* slow preset */
  ct(js, 'staggerMs: 400');       /* per-key override */
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
