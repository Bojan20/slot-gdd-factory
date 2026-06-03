/**
 * tests/blocks/bonusPick.test.mjs — Wave O1
 */
import {
  defaultConfig, resolveConfig,
  emitBonusPickCSS, emitBonusPickMarkup, emitBonusPickRuntime,
} from '../../src/blocks/bonusPick.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== bonusPick block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default tileCount=12', d.tileCount === 12);
t('default maxPicks=5', d.maxPicks === 5);
t('default prizePool length=7', d.prizePool.length === 7);
t('default endTokens has POP', d.endTokens.includes('POP'));

const r = resolveConfig({ features: [{ kind: 'bonus_pick' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'bonus_pick' }],
  bonusPick: { tileCount: 16, maxPicks: 8, title: 'CHOOSE A GIFT', endTokens: ['DONE'] },
});
t('override tileCount', r2.tileCount === 16);
t('override maxPicks', r2.maxPicks === 8);
t('override title', r2.title === 'CHOOSE A GIFT');
t('override endTokens', r2.endTokens[0] === 'DONE');

t('CSS empty when disabled', emitBonusPickCSS(defaultConfig()) === '');
const css = emitBonusPickCSS(r);
t('CSS has bp-overlay', css.includes('.bp-overlay'));
t('CSS has bpFlip keyframe', css.includes('@keyframes bpFlip'));

t('markup empty when disabled', emitBonusPickMarkup(defaultConfig()) === '');
const mk = emitBonusPickMarkup(r);
t('markup has #bpOverlay', mk.includes('id="bpOverlay"'));
t('markup has 12 bp-tile buttons (default)', (mk.match(/class="bp-tile"/g) || []).length === 12);

t('runtime stub when disabled', emitBonusPickRuntime(defaultConfig()).includes('disabled'));
const rt = emitBonusPickRuntime(r);
t('runtime exposes bpOpen', rt.includes('window.bpOpen'));
t('runtime exposes bpClose', rt.includes('window.bpClose'));
t('runtime bakes BP_POOL', rt.includes('BP_POOL = '));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
