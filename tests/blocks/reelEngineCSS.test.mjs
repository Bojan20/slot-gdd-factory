/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitReelEngineCSS,
} from '../../src/blocks/reelEngineCSS.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/reelEngineCSS.mjs —');

t('defaultConfig: 4.5px blur / 0.88 brightness / 80ms fade', () => {
  const c = defaultConfig();
  eq(c.blurPx, 4.5); eq(c.blurDim, 0.88); eq(c.blurFadeMs, 80);
});

t('resolveConfig: blurPx bounded 0..20', () => {
  eq(resolveConfig({ reelEngine: { blurPx: 8 } }).blurPx, 8);
  eq(resolveConfig({ reelEngine: { blurPx: 99 } }).blurPx, 4.5);
  eq(resolveConfig({ reelEngine: { blurPx: -1 } }).blurPx, 4.5);
});

t('resolveConfig: blurDim bounded 0..1', () => {
  eq(resolveConfig({ reelEngine: { blurDim: 0.5 } }).blurDim, 0.5);
  eq(resolveConfig({ reelEngine: { blurDim: 1.5 } }).blurDim, 0.88);
});

t('emitReelEngineCSS: contains all 3 selectors', () => {
  const css = emitReelEngineCSS();
  ct(css, '.reelCol'); ct(css, '.reelStrip'); ct(css, '.cell.is-blurring');
});

t('emitReelEngineCSS: bakes blurPx + blurDim literals', () => {
  const css = emitReelEngineCSS({ blurPx: 6, blurDim: 0.75, blurFadeMs: 120 });
  ct(css, 'filter: blur(6px) brightness(0.75)');
  ct(css, 'transition: filter 120ms linear');
});

t('parser: full Reel Engine section', () => {
  const gdd = '# G\n\n## Reel Engine\n- blur-px: 6\n- blur-dim: 0.7\n- blur-fade-ms: 120\n';
  const m = parseGDD(gdd, 'md');
  eq(m.reelEngine.blurPx, 6);
  eq(m.reelEngine.blurDim, 0.7);
  eq(m.reelEngine.blurFadeMs, 120);
});

t('parser: heading alias "Spin Blur"', () => {
  const m = parseGDD('# G\n\n## Spin Blur\n- blur-px: 8\n', 'md');
  eq(m.reelEngine.blurPx, 8);
});

t('parser → CSS roundtrip', () => {
  const gdd = '# G\n\n## Reel Engine\n- blur-px: 5.5\n';
  const m = parseGDD(gdd, 'md');
  ct(emitReelEngineCSS(resolveConfig(m)), 'blur(5.5px)');
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
