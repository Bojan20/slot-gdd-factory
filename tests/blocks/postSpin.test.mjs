/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitPostSpinRuntime,
} from '../../src/blocks/postSpin.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/postSpin.mjs —');

t('defaultConfig: standard knobs', () => {
  const c = defaultConfig();
  eq(c.settlePauseMs, 200);
  eq(c.forcedSettlePauseMs, 350);
  eq(c.retriggerCap, 3);
  eq(c.fsSpinBreathMs, 250);
  eq(c.fakeWinChance, 0.4);
  eq(c.fakeWinMaxX, 25);
});

t('resolveConfig: ms knobs bounded', () => {
  eq(resolveConfig({ postSpin: { settlePauseMs: 500 } }).settlePauseMs, 500);
  eq(resolveConfig({ postSpin: { settlePauseMs: 99999 } }).settlePauseMs, 200);
  eq(resolveConfig({ postSpin: { settlePauseMs: -1 } }).settlePauseMs, 200);
});

t('resolveConfig: fakeWinChance bounded [0,1]', () => {
  eq(resolveConfig({ postSpin: { fakeWinChance: 0.6 } }).fakeWinChance, 0.6);
  eq(resolveConfig({ postSpin: { fakeWinChance: 1.5 } }).fakeWinChance, 0.4);
  eq(resolveConfig({ postSpin: { fakeWinChance: -0.1 } }).fakeWinChance, 0.4);
});

t('resolveConfig: retriggerCap bounded 0..10', () => {
  eq(resolveConfig({ postSpin: { retriggerCap: 5 } }).retriggerCap, 5);
  eq(resolveConfig({ postSpin: { retriggerCap: 99 } }).retriggerCap, 3);
});

t('emitPostSpinRuntime: emits handlePostSpin', () => {
  const js = emitPostSpinRuntime();
  ct(js, 'function handlePostSpin(duringFs)');
});

t('emitPostSpinRuntime: bakes all literal constants', () => {
  const js = emitPostSpinRuntime({
    settlePauseMs: 250, forcedSettlePauseMs: 400, retriggerCap: 5,
    fsSpinBreathMs: 300, fakeWinChance: 0.5, fakeWinMaxX: 30,
  });
  ct(js, 'wasForced ? 400 : 250');
  ct(js, 'RETRIGGER_CAP = 5');
  ct(js, 'FSM_runNextFsSpin, 300');
  ct(js, '< 0.5');
  ct(js, '* 30 *');
});

t('emitPostSpinRuntime: references all FSM helpers + FREESPINS', () => {
  const js = emitPostSpinRuntime();
  for (const ref of [
    'FREESPINS.enabled', 'applyWinHighlight', 'clearWinHighlight',
    'playScatterCelebration', 'FSM_enterIntro', 'FSM_runNextFsSpin',
    'FSM_handleRetrigger', 'FSM_enterOutro', 'FSM_renderHud',
    'countTriggerSymbols', 'spinsForCount', 'FORCE_TRIGGER',
  ]) {
    ct(js, ref);
  }
});

t('parser: full Post Spin section', () => {
  const gdd = [
    '# G', '',
    '## Post Spin',
    '- settle-pause-ms: 250',
    '- forced-settle-pause-ms: 400',
    '- retrigger-cap: 5',
    '- fs-spin-breath-ms: 300',
    '- fake-win-chance: 0.5',
    '- fake-win-max-x: 40',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  eq(m.postSpin.settlePauseMs, 250);
  eq(m.postSpin.forcedSettlePauseMs, 400);
  eq(m.postSpin.retriggerCap, 5);
  eq(m.postSpin.fsSpinBreathMs, 300);
  eq(m.postSpin.fakeWinChance, 0.5);
  eq(m.postSpin.fakeWinMaxX, 40);
});

t('parser → runtime roundtrip', () => {
  const gdd = '# G\n\n## Post-Spin Orchestration\n- retrigger-cap: 4\n';
  const m = parseGDD(gdd, 'md');
  const js = emitPostSpinRuntime(resolveConfig(m));
  ct(js, 'RETRIGGER_CAP = 4');
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
