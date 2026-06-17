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

t('defaultConfig: 0px blur / 1.0 brightness / 80ms fade (WoO-aligned)', () => {
  /* 2026-06-16 — Boki rule: cells stay sharp during spin. Cell-level blur
     default is OFF; the motion overlay on .reelCol provides the speed cue. */
  const c = defaultConfig();
  eq(c.blurPx, 0); eq(c.blurDim, 1); eq(c.blurFadeMs, 80);
  eq(c.streakAlpha, 0.04); eq(c.streakSpacingPx, 4);
  eq(c.shadowAlpha, 0.20); eq(c.speedLinesAlpha, 0.04);
  eq(c.speedLineSpeedMs, 150);
});

t('resolveConfig: blurPx bounded 0..20 (default 0)', () => {
  eq(resolveConfig({ reelEngine: { blurPx: 8 } }).blurPx, 8);
  eq(resolveConfig({ reelEngine: { blurPx: 99 } }).blurPx, 0);
  eq(resolveConfig({ reelEngine: { blurPx: -1 } }).blurPx, 0);
});

t('resolveConfig: blurDim bounded 0..1 (default 1)', () => {
  eq(resolveConfig({ reelEngine: { blurDim: 0.5 } }).blurDim, 0.5);
  eq(resolveConfig({ reelEngine: { blurDim: 1.5 } }).blurDim, 1);
});

t('resolveConfig: motion overlay knobs bounded', () => {
  eq(resolveConfig({ reelEngine: { streakAlpha: 0.5 } }).streakAlpha, 0.5);
  eq(resolveConfig({ reelEngine: { streakAlpha: 2 } }).streakAlpha, 0.04);
  eq(resolveConfig({ reelEngine: { streakSpacingPx: 8 } }).streakSpacingPx, 8);
  eq(resolveConfig({ reelEngine: { streakSpacingPx: 0 } }).streakSpacingPx, 4);
  eq(resolveConfig({ reelEngine: { shadowAlpha: 0.4 } }).shadowAlpha, 0.4);
  eq(resolveConfig({ reelEngine: { speedLineSpeedMs: 250 } }).speedLineSpeedMs, 250);
  eq(resolveConfig({ reelEngine: { speedLineSpeedMs: 10 } }).speedLineSpeedMs, 150);
});

t('emitReelEngineCSS: contains core column selectors (no overlay — moved to motionOverlay)', () => {
  /* W3.1 — motion overlay migrated to shared motionOverlay.mjs block.
   * reelEngineCSS now emits only the column / strip / cell-blur surface;
   * the ::after / ::before streak overlay + its keyframes + the reduced-
   * motion override for those pseudos live in motionOverlay (orchestrator
   * wires `.reelCol.is-spinning` to the shared emit with a per-surface
   * configOverride preserving the pre-W3.1 knob vintage). */
  const css = emitReelEngineCSS();
  ct(css, '.reelCol');
  ct(css, '.reelStrip');
  ct(css, '.cell.is-blurring');
  /* Pinning the migration: the overlay artifacts must NOT be in this
   * block's emit any longer (would be silently duplicated against the
   * shared block's emit if a future refactor reverts the move). */
  if (css.includes('.reelCol.is-spinning::after')) throw new Error('Wave 3.1 regression: reelEngineCSS still emits ::after overlay (should be in motionOverlay)');
  if (css.includes('@keyframes reelStreakIn'))     throw new Error('Wave 3.1 regression: reelEngineCSS still emits reelStreakIn keyframes');
  if (css.includes('@keyframes reelSpeedLines'))   throw new Error('Wave 3.1 regression: reelEngineCSS still emits reelSpeedLines keyframes');
});

t('emitReelEngineCSS: cell blur defaults to a no-op (blur(0px) brightness(1))', () => {
  const css = emitReelEngineCSS();
  ct(css, 'filter: blur(0px) brightness(1)');
});

t('emitReelEngineCSS: bakes blurPx + blurDim literals when overridden', () => {
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
