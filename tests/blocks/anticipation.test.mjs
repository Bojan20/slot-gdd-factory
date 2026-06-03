/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitAnticipationCSS, emitAnticipationRuntime,
} from '../../src/blocks/anticipation.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/anticipation.mjs —');

t('defaultConfig: 600ms hold / 700ms pulse / gold default / skipDuringFs true', () => {
  const c = defaultConfig();
  eq(c.holdMs, 600); eq(c.pulseMs, 700); eq(c.gold, '255,214,110'); eq(c.skipDuringFs, true);
});

t('resolveConfig: holdMs bounded 100..5000', () => {
  eq(resolveConfig({ anticipation: { holdMs: 1200 } }).holdMs, 1200);
  eq(resolveConfig({ anticipation: { holdMs: 50 } }).holdMs, 600);
  eq(resolveConfig({ anticipation: { holdMs: 99999 } }).holdMs, 600);
});

t('resolveConfig: pulseMs bounded 200..5000', () => {
  eq(resolveConfig({ anticipation: { pulseMs: 1000 } }).pulseMs, 1000);
  eq(resolveConfig({ anticipation: { pulseMs: 50 } }).pulseMs, 700);
});

t('resolveConfig: gold validation', () => {
  eq(resolveConfig({ anticipation: { gold: '50,100,150' } }).gold, '50,100,150');
  eq(resolveConfig({ anticipation: { gold: 'gold' } }).gold, '255,214,110');
});

t('resolveConfig: skipDuringFs=false honored', () => {
  eq(resolveConfig({ anticipation: { skipDuringFs: false } }).skipDuringFs, false);
});

t('emitAnticipationCSS: emits both keyframe sets', () => {
  const css = emitAnticipationCSS();
  ct(css, '@keyframes reel-antic-pulse');
  ct(css, '@keyframes cell-antic-pulse');
  ct(css, '.reelCol--anticipating');
  ct(css, '.cell--anticipating');
  ct(css, 'prefers-reduced-motion');
});

t('emitAnticipationCSS: disabled → no rules', () => {
  const css = emitAnticipationCSS({ enabled: false });
  ok(!css.includes('@keyframes'), 'no keyframes when disabled');
});

t('emitAnticipationCSS: bakes pulseMs literal', () => {
  ct(emitAnticipationCSS({ pulseMs: 1200 }), 'reel-antic-pulse 1200ms');
});

t('emitAnticipationRuntime: enabled emits HOLD_BASE + maybeArmAnticipation', () => {
  const js = emitAnticipationRuntime();
  ct(js, 'const HOLD_BASE = 600');
  ct(js, 'function maybeArmAnticipation()');
  ct(js, 'reelCol--anticipating');
});

t('emitAnticipationRuntime: disabled emits no-op stub', () => {
  const js = emitAnticipationRuntime({ enabled: false });
  ct(js, 'disabled by GDD');
  ct(js, 'function maybeArmAnticipation() { /* no-op */ }');
});

t('emitAnticipationRuntime: skipDuringFs=false drops FS guard', () => {
  const js = emitAnticipationRuntime({ skipDuringFs: false });
  ok(!js.includes("FSM.phase !== 'BASE'"), 'no FS skip when skipDuringFs=false');
  ct(js, 'skipDuringFs disabled');
});

t('parser: full Anticipation section → all knobs', () => {
  const gdd = [
    '# G', '',
    '## Anticipation',
    '- enabled: true',
    '- hold-ms: 800',
    '- pulse-ms: 900',
    '- gold: 50, 100, 200',
    '- skip-during-fs: false',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  eq(m.anticipation.enabled, true);
  eq(m.anticipation.holdMs, 800);
  eq(m.anticipation.pulseMs, 900);
  eq(m.anticipation.gold, '50,100,200');
  eq(m.anticipation.skipDuringFs, false);
});

t('parser: heading alias "Reel Anticipation"', () => {
  const m = parseGDD('# G\n\n## Reel Anticipation\n- hold-ms: 750\n', 'md');
  eq(m.anticipation.holdMs, 750);
});

t('parser → runtime roundtrip: holdMs reaches HOLD_BASE', () => {
  const gdd = '# G\n\n## Anticipation\n- hold-ms: 480\n';
  const m = parseGDD(gdd, 'md');
  const js = emitAnticipationRuntime(resolveConfig(m));
  ct(js, 'const HOLD_BASE = 480');
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
