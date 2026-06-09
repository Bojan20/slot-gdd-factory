/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitReelEngineRuntime,
} from '../../src/blocks/reelEngine.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/reelEngine.mjs (hot-path) —');

t('defaultConfig: S-AVP cabinet defaults', () => {
  const c = defaultConfig();
  eq(c.minRotations, 8);
  eq(c.settleBreathMs, 80);
  eq(c.stripBufferCells, 2);
  eq(c.staticStaggerMs, 200);
  eq(c.staticHoldMs, 400);
  eq(c.snapThreshold, 0.6);
  eq(c.minStepPx, 0.5);
  eq(c.accelMinFactor, 0.3);
});

t('resolveConfig: bounds work', () => {
  eq(resolveConfig({ reelEngineHot: { minRotations: 12 } }).minRotations, 12);
  eq(resolveConfig({ reelEngineHot: { minRotations: 99 } }).minRotations, 8);
  eq(resolveConfig({ reelEngineHot: { settleBreathMs: 200 } }).settleBreathMs, 200);
  eq(resolveConfig({ reelEngineHot: { settleBreathMs: -1 } }).settleBreathMs, 80);
});

t('resolveConfig: float bounds', () => {
  eq(resolveConfig({ reelEngineHot: { snapThreshold: 1.2 } }).snapThreshold, 1.2);
  eq(resolveConfig({ reelEngineHot: { snapThreshold: 10 } }).snapThreshold, 0.6);
  eq(resolveConfig({ reelEngineHot: { accelMinFactor: 0.5 } }).accelMinFactor, 0.5);
});

t('emitReelEngineRuntime: emits all hot-path symbols', () => {
  const js = emitReelEngineRuntime();
  for (const sym of [
    'let RECT_REELS', 'let RECT_SIDE', 'let spinTicker',
    'let spinStartTime', 'let allReelsActive', 'let FORCE_TRIGGER',
    'function randomSym', 'function rotateStripDown',
    'function commitStopSymbols', 'function buildReelColumns',
    'function startSpinAll', 'function onTickAll',
    'function runOneBaseSpin', 'function runStaticReroll',
  ]) {
    ct(js, sym);
  }
});

t('emitReelEngineRuntime: bakes minRotations into reel state', () => {
  const js = emitReelEngineRuntime({ minRotations: 12 });
  ct(js, 'minRotations: 12,');
});

t('emitReelEngineRuntime: bakes static path cadence', () => {
  const js = emitReelEngineRuntime({
    staticStaggerMs: 250, staticHoldMs: 500, staticPreRollMs: 300,
    staticBlurSwapMs: 280, staticSettleMs: 120,
  });
  ct(js, 'STAGGER = 250');
  ct(js, 'HOLD_BASE = 500');
  ct(js, 'elapsed = 300');
  /* 2026-06-09 turbo gate: legacy static path now wraps the
     staticBlurSwapMs constant inside `Math.round(<MS> * _stm)` so the
     turbo chip compresses cadence for dual / SVG / irregular grids.
     Bake-time invariant: the literal constant still appears verbatim,
     just inside a Math.round expression instead of as a bare timer arg. */
  ct(js, 'Math.round(280');         /* static blur swap (turbo-aware) */
  ct(js, 'Math.round(300');         /* static pre-roll (turbo-aware) */
  ct(js, 'cursor + 120');           /* static settle */
});

t('emitReelEngineRuntime: bakes accel ramp params', () => {
  const js = emitReelEngineRuntime({ accelMinFactor: 0.4 });
  ct(js, 'baseSpeed * (0.4 + 0.6000');
});

t('emitReelEngineRuntime: bakes snap threshold + min step', () => {
  const js = emitReelEngineRuntime({ snapThreshold: 1.0, minStepPx: 0.8 });
  ct(js, 'snapThreshold = 1');
  ct(js, '< 0.8 && ');
  ct(js, 'currentAmp < 0.8');
});

t('emitReelEngineRuntime: bakes stripBufferCells', () => {
  const js = emitReelEngineRuntime({ stripBufferCells: 4 });
  ct(js, 'visibleRows + 4');
});

t('emitReelEngineRuntime: bakes settle breath + static fallback', () => {
  const js = emitReelEngineRuntime({ settleBreathMs: 120, staticFallbackMs: 90 });
  /* settleBreathMs is the pause before invoking onSettled at the end of
   * a successful spin tick chain. */
  ct(js, 'setTimeout(onSettled, 120)');
  /* staticFallbackMs is the empty-grid (SVG/wheel) timeout. After Wave R
   * refactor the call goes through _settled(onSettled) wrapper, so the
   * literal we look for is the duration in the wrapped call site. */
  ct(js, '_settled(onSettled), 90');
});

t('parser: full Reel Engine Hot section', () => {
  const gdd = [
    '# G', '',
    '## Reel Engine Hot',
    '- min-rotations: 10',
    '- settle-breath-ms: 100',
    '- strip-buffer-cells: 3',
    '- static-pre-roll-ms: 300',
    '- static-stagger-ms: 250',
    '- static-hold-ms: 500',
    '- snap-threshold: 0.8',
    '- accel-min-factor: 0.4',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  eq(m.reelEngineHot.minRotations, 10);
  eq(m.reelEngineHot.settleBreathMs, 100);
  eq(m.reelEngineHot.stripBufferCells, 3);
  eq(m.reelEngineHot.staticPreRollMs, 300);
  eq(m.reelEngineHot.staticStaggerMs, 250);
  eq(m.reelEngineHot.staticHoldMs, 500);
  eq(m.reelEngineHot.snapThreshold, 0.8);
  eq(m.reelEngineHot.accelMinFactor, 0.4);
});

t('parser: heading alias "Spin Physics"', () => {
  const m = parseGDD('# G\n\n## Spin Physics\n- min-rotations: 6\n', 'md');
  eq(m.reelEngineHot.minRotations, 6);
});

t('parser → runtime roundtrip', () => {
  const gdd = '# G\n\n## Reel Engine Hot\n- min-rotations: 15\n- static-stagger-ms: 280\n';
  const m = parseGDD(gdd, 'md');
  const js = emitReelEngineRuntime(resolveConfig(m));
  ct(js, 'minRotations: 15,');
  ct(js, 'STAGGER = 280');
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
