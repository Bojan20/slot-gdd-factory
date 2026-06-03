/* eslint-disable no-console */
/**
 * Unit tests for src/blocks/scatterCelebration.mjs + parser hooks.
 * Pure Node — no DOM, no browser, no Playwright. Validates:
 *   • defaultConfig() shape and immutability
 *   • resolveConfig() guards and validation
 *   • emitScatterCelebrationCSS() bakes knobs into the CSS string
 *   • emitScatterCelebrationRuntime() emits both functions, respects disabled
 *   • parser.extractScatterCelebration() reads "## Scatter Celebration" block
 *   • parser → emit roundtrip — GDD knobs reach the runtime literally
 */

import {
  defaultConfig,
  resolveConfig,
  emitScatterCelebrationCSS,
  emitScatterCelebrationRuntime,
} from '../../src/blocks/scatterCelebration.mjs';
import { parseGDD, extractScatterCelebration } from '../../src/parser.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${msg}`);
}
function ok(cond, msg = '') {
  if (!cond) throw new Error(`expected truthy — ${msg}`);
}
function contains(haystack, needle, msg = '') {
  if (!String(haystack).includes(needle))
    throw new Error(`expected substring ${JSON.stringify(needle)} in output — ${msg}`);
}

console.log('— blocks/scatterCelebration.mjs —');

t('defaultConfig: returns a fresh object each call', () => {
  const a = defaultConfig(), b = defaultConfig();
  ok(a !== b, 'must not share reference');
  eq(a.enabled, true);
  eq(a.durationMs, 1500);
  eq(a.pulseCycles, 3);
  eq(a.pulseCycleMs, 500);
  eq(a.dimOpacity, 0.18);
  eq(a.glowColor, '255,214,110');
  eq(a.glowPeak, 1.5);
});

t('resolveConfig: no model → defaults', () => {
  const c = resolveConfig();
  eq(c.enabled, true);
  eq(c.durationMs, 1500);
});

t('resolveConfig: model without scatterCelebration → defaults', () => {
  const c = resolveConfig({});
  eq(c.durationMs, 1500);
});

t('resolveConfig: enabled=false honored', () => {
  const c = resolveConfig({ scatterCelebration: { enabled: false } });
  eq(c.enabled, false);
});

t('resolveConfig: durationMs accepted within bounds', () => {
  const c = resolveConfig({ scatterCelebration: { durationMs: 2200 } });
  eq(c.durationMs, 2200);
});

t('resolveConfig: durationMs out of bounds rejected → default', () => {
  eq(resolveConfig({ scatterCelebration: { durationMs: 0 } }).durationMs, 1500);
  eq(resolveConfig({ scatterCelebration: { durationMs: 99999 } }).durationMs, 1500);
  eq(resolveConfig({ scatterCelebration: { durationMs: 'lots' } }).durationMs, 1500);
});

t('resolveConfig: pulseCycles bounded to 1..12', () => {
  eq(resolveConfig({ scatterCelebration: { pulseCycles: 4 } }).pulseCycles, 4);
  eq(resolveConfig({ scatterCelebration: { pulseCycles: 0 } }).pulseCycles, 3);
  eq(resolveConfig({ scatterCelebration: { pulseCycles: 99 } }).pulseCycles, 3);
});

t('resolveConfig: pulseCycleMs bounded to 50..5000', () => {
  eq(resolveConfig({ scatterCelebration: { pulseCycleMs: 400 } }).pulseCycleMs, 400);
  eq(resolveConfig({ scatterCelebration: { pulseCycleMs: 10 } }).pulseCycleMs, 500);
});

t('resolveConfig: dimOpacity bounded to [0,1]', () => {
  eq(resolveConfig({ scatterCelebration: { dimOpacity: 0.25 } }).dimOpacity, 0.25);
  eq(resolveConfig({ scatterCelebration: { dimOpacity: 1.5 } }).dimOpacity, 0.18);
  eq(resolveConfig({ scatterCelebration: { dimOpacity: -0.1 } }).dimOpacity, 0.18);
});

t('resolveConfig: valid glowColor accepted, invalid rejected', () => {
  eq(resolveConfig({ scatterCelebration: { glowColor: '120,200,80' } }).glowColor, '120,200,80');
  eq(resolveConfig({ scatterCelebration: { glowColor: 'gold' } }).glowColor, '255,214,110');
  eq(resolveConfig({ scatterCelebration: { glowColor: '300,0,0' } }).glowColor, '255,214,110');
  eq(resolveConfig({ scatterCelebration: { glowColor: '1,2,3,4' } }).glowColor, '255,214,110');
});

t('resolveConfig: glowPeak bounded to 1..5', () => {
  eq(resolveConfig({ scatterCelebration: { glowPeak: 1.8 } }).glowPeak, 1.8);
  eq(resolveConfig({ scatterCelebration: { glowPeak: 0.5 } }).glowPeak, 1.5);
  eq(resolveConfig({ scatterCelebration: { glowPeak: 99 } }).glowPeak, 1.5);
});

t('emitScatterCelebrationCSS: contains keyframe + main classes', () => {
  const css = emitScatterCelebrationCSS();
  contains(css, '@keyframes scatter-celebrate');
  contains(css, '.gridHost.is-scatter-celebrating');
  contains(css, '.cell--scatter-celebrate');
  contains(css, 'prefers-reduced-motion');
});

t('emitScatterCelebrationCSS: bakes knobs as literals', () => {
  const css = emitScatterCelebrationCSS({
    durationMs: 2000, pulseCycles: 4, pulseCycleMs: 500,
    dimOpacity: 0.22, glowColor: '200,100,50', glowPeak: 1.8,
  });
  contains(css, 'opacity: 0.22');
  contains(css, 'scatter-celebrate 500ms ease-in-out 4');
  contains(css, 'brightness(1.8)');
  contains(css, 'rgba(200,100,50');
});

t('emitScatterCelebrationRuntime: emits both functions when enabled', () => {
  const js = emitScatterCelebrationRuntime();
  contains(js, 'function findScatterCellsOnGrid()');
  contains(js, 'function playScatterCelebration(opts)');
  contains(js, 'FREESPINS.scatterCelebration === false');
});

t('emitScatterCelebrationRuntime: bakes durationMs as literal', () => {
  const js = emitScatterCelebrationRuntime({ durationMs: 1800 });
  contains(js, '|| 1800');
});

t('emitScatterCelebrationRuntime: enabled=false → stub that resolves', () => {
  const js = emitScatterCelebrationRuntime({ enabled: false });
  contains(js, 'disabled by GDD');
  contains(js, 'function playScatterCelebration() { return Promise.resolve()');
  contains(js, 'function findScatterCellsOnGrid() { return { host: grid, cells: [] }');
});

t('parser: GDD without Scatter Celebration section → undefined slots', () => {
  const model = parseGDD('# Some Game\n\nNo special block here.', 'md');
  ok(model.scatterCelebration, 'slot must exist on model');
  eq(model.scatterCelebration.enabled, undefined);
  eq(model.scatterCelebration.durationMs, undefined);
});

t('parser: full Scatter Celebration section → all knobs read', () => {
  const gdd = [
    '# Game X',
    '',
    '## Scatter Celebration',
    '- enabled: true',
    '- duration-ms: 1800',
    '- pulse-cycles: 4',
    '- pulse-cycle-ms: 450',
    '- dim-opacity: 0.20',
    '- glow-color: 120, 200, 80',
    '- glow-peak: 1.7',
    '',
  ].join('\n');
  const model = parseGDD(gdd, 'md');
  eq(model.scatterCelebration.enabled, true);
  eq(model.scatterCelebration.durationMs, 1800);
  eq(model.scatterCelebration.pulseCycles, 4);
  eq(model.scatterCelebration.pulseCycleMs, 450);
  eq(model.scatterCelebration.dimOpacity, 0.20);
  eq(model.scatterCelebration.glowColor, '120,200,80');
  eq(model.scatterCelebration.glowPeak, 1.7);
});

t('parser: heading variants recognised', () => {
  for (const heading of ['Scatter Celebration', 'Trigger Celebration', 'Scatter Animation', 'Trigger Animation']) {
    const gdd = `# G\n\n## ${heading}\n- enabled: false\n`;
    const model = parseGDD(gdd, 'md');
    eq(model.scatterCelebration.enabled, false, `heading "${heading}"`);
  }
});

t('parser: invalid knob values forwarded → block-level resolver rejects', () => {
  const gdd = '# G\n\n## Scatter Celebration\n- duration-ms: 0\n- dim-opacity: 9\n';
  const model = parseGDD(gdd, 'md');
  /* Parser forwards what it sees (validation lives in block.resolveConfig). */
  eq(model.scatterCelebration.durationMs, 0);
  /* Block-level validation now rejects → default returned. */
  const cfg = resolveConfig(model);
  eq(cfg.durationMs, 1500);
  eq(cfg.dimOpacity, 0.18);
});

t('parser → emit roundtrip: GDD knobs reach CSS + runtime literally', () => {
  const gdd = [
    '# G',
    '',
    '## Scatter Celebration',
    '- duration-ms: 2200',
    '- pulse-cycles: 5',
    '- pulse-cycle-ms: 440',
    '- glow-color: 100,150,200',
    '',
  ].join('\n');
  const model = parseGDD(gdd, 'md');
  const cfg = resolveConfig(model);
  const css = emitScatterCelebrationCSS(cfg);
  const js  = emitScatterCelebrationRuntime(cfg);
  contains(css, 'scatter-celebrate 440ms ease-in-out 5');
  contains(css, 'rgba(100,150,200');
  contains(js, '|| 2200');
});

t('extractScatterCelebration: directly invokable on freshModel-equivalent', () => {
  const model = parseGDD('# G\n', 'md');
  /* Calling extractor on a GDD that has the section but model was built
     without one — fresh extractor call should fill the slots. */
  extractScatterCelebration('## Scatter Celebration\n- duration-ms: 999\n', model);
  eq(model.scatterCelebration.durationMs, 999);
});

console.log('');
if (fail > 0) {
  console.log(`  ${fail} test(s) failed.`);
  process.exit(1);
} else {
  console.log('  All tests passed.');
}
