/**
 * tests/blocks/gamble.test.mjs — Wave P2
 */
import {
  defaultConfig, resolveConfig,
  emitGambleCSS, emitGambleMarkup, emitGambleRuntime,
} from '../../src/blocks/gamble.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== gamble block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default mode=color', d.mode === 'color');
t('default maxRounds=5', d.maxRounds === 5);
t('default multiplier=2', d.multiplier === 2);

const r = resolveConfig({ features: [{ kind: 'gamble' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'gamble' }],
  gamble: { mode: 'suit', maxRounds: 8, collectThresholdX: 500 },
});
t('mode=suit auto sets multiplier=4', r2.mode === 'suit' && r2.multiplier === 4);
t('override maxRounds', r2.maxRounds === 8);
t('override collectThresholdX', r2.collectThresholdX === 500);

const r3 = resolveConfig({ features: [{ kind: 'gamble' }], gamble: { mode: 'ladder' } });
t('mode=ladder accepted', r3.mode === 'ladder');

t('CSS empty when disabled', emitGambleCSS(defaultConfig()) === '');
const css = emitGambleCSS(r);
t('CSS has gamble-overlay', css.includes('.gamble-overlay'));

t('markup empty when disabled', emitGambleMarkup(defaultConfig()) === '');
const mk1 = emitGambleMarkup(r);
t('color markup has RED + BLACK', mk1.includes('RED') && mk1.includes('BLACK'));
const mk2 = emitGambleMarkup(r2);
t('suit markup has ♥ ♠ ♦ ♣', mk2.includes('♥') && mk2.includes('♠') && mk2.includes('♦') && mk2.includes('♣'));
const mk3 = emitGambleMarkup(r3);
t('ladder markup has HIGHER + LOWER', mk3.includes('HIGHER') && mk3.includes('LOWER'));

t('runtime stub when disabled', emitGambleRuntime(defaultConfig()).includes('disabled'));
const rt = emitGambleRuntime(r);
t('runtime exposes gambleOpen', rt.includes('window.gambleOpen'));
t('runtime exposes gambleCollect', rt.includes('window.gambleCollect'));
t('runtime exposes GAMBLE_STATE', rt.includes('window.GAMBLE_STATE'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
