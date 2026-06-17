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
});

t('W3.2 cleanup: 5 deprecated overlay knobs are removed from defaultConfig', () => {
  /* The pre-W3.1 motion-overlay knobs (streakAlpha / streakSpacingPx /
     shadowAlpha / speedLinesAlpha / speedLineSpeedMs) were retained as
     no-ops through W3.1 for back-compat. W3.2 removes them. The shared
     motionOverlay block now owns the overlay surface; rect grid's
     visual identity is preserved by the orchestrator's per-surface
     configOverride in MOTION_OVERLAY_SURFACES (buildSlotHTML.mjs). */
  const c = defaultConfig();
  if ('streakAlpha'      in c) throw new Error('W3.2 regression: streakAlpha still in defaultConfig');
  if ('streakSpacingPx'  in c) throw new Error('W3.2 regression: streakSpacingPx still in defaultConfig');
  if ('shadowAlpha'      in c) throw new Error('W3.2 regression: shadowAlpha still in defaultConfig');
  if ('speedLinesAlpha'  in c) throw new Error('W3.2 regression: speedLinesAlpha still in defaultConfig');
  if ('speedLineSpeedMs' in c) throw new Error('W3.2 regression: speedLineSpeedMs still in defaultConfig');
});

t('W3.2 cleanup: deprecated knobs in GDD model are silently ignored (back-compat)', () => {
  /* Existing GDDs that still set these knobs must not crash the parser
     or produce a deprecation warning. The clampNum loop in resolveConfig
     ignores any key not in its allowlist; we just verify nothing leaks
     onto the returned config. */
  const c = resolveConfig({ reelEngine: {
    streakAlpha: 0.5,
    streakSpacingPx: 8,
    shadowAlpha: 0.4,
    speedLinesAlpha: 0.1,
    speedLineSpeedMs: 250,
    blurPx: 4,
  }});
  eq(c.blurPx, 4);  /* still honored */
  if ('streakAlpha'      in c) throw new Error('deprecated knob leaked: streakAlpha');
  if ('streakSpacingPx'  in c) throw new Error('deprecated knob leaked: streakSpacingPx');
  if ('shadowAlpha'      in c) throw new Error('deprecated knob leaked: shadowAlpha');
  if ('speedLinesAlpha'  in c) throw new Error('deprecated knob leaked: speedLinesAlpha');
  if ('speedLineSpeedMs' in c) throw new Error('deprecated knob leaked: speedLineSpeedMs');
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

t('W3.2 pin: motionOverlay configOverride in MOTION_OVERLAY_SURFACES preserves vintage', async () => {
  /* The pre-W3.1 vintage values (0.04 / 4 / 0.20 / 0.04 / 150) MUST
     still live in the orchestrator's per-surface configOverride for the
     rect surface, otherwise the rect grid's visual identity drifts. */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve: joinPath } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const orchSrc = readFileSync(joinPath(here, '../../src/buildSlotHTML.mjs'), 'utf8');
  ct(orchSrc, 'streakAlpha:      0.04');
  ct(orchSrc, 'streakSpacingPx:  4');
  ct(orchSrc, 'shadowAlpha:      0.20');
  ct(orchSrc, 'speedLinesAlpha:  0.04');
  ct(orchSrc, 'speedLineSpeedMs: 150');
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
