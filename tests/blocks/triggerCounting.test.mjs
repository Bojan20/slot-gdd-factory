/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitTriggerCountingRuntime,
} from '../../src/blocks/triggerCounting.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/triggerCounting.mjs —');

t('defaultConfig: defaultThreshold=3', () => {
  eq(defaultConfig().defaultThreshold, 3);
});

t('resolveConfig: defaultThreshold bounded 1..20', () => {
  eq(resolveConfig({ triggerCounting: { defaultThreshold: 5 } }).defaultThreshold, 5);
  eq(resolveConfig({ triggerCounting: { defaultThreshold: 0 } }).defaultThreshold, 3);
  eq(resolveConfig({ triggerCounting: { defaultThreshold: 99 } }).defaultThreshold, 3);
});

t('emitTriggerCountingRuntime: emits countTriggerSymbols + spinsForCount', () => {
  const js = emitTriggerCountingRuntime();
  ct(js, 'function countTriggerSymbols()');
  ct(js, 'function spinsForCount(count)');
});

t('emitTriggerCountingRuntime: references RECT_REELS + SHAPE + FREESPINS', () => {
  const js = emitTriggerCountingRuntime();
  ct(js, 'RECT_REELS'); ct(js, 'SHAPE.kind'); ct(js, 'FREESPINS.triggerSymbol');
});

t('emitTriggerCountingRuntime: handles both perReel + any modes', () => {
  const js = emitTriggerCountingRuntime();
  ct(js, "FREESPINS.countMode === 'any'");
});

t('parser: section reads defaultThreshold', () => {
  const m = parseGDD('# G\n\n## Trigger Counting\n- default-threshold: 5\n', 'md');
  eq(m.triggerCounting.defaultThreshold, 5);
});

t('parser: heading alias "Scatter Counting"', () => {
  const m = parseGDD('# G\n\n## Scatter Counting\n- default-threshold: 4\n', 'md');
  eq(m.triggerCounting.defaultThreshold, 4);
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
