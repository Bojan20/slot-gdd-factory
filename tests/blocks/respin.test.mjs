/**
 * tests/blocks/respin.test.mjs — Wave N2
 */
import {
  defaultConfig, resolveConfig,
  emitRespinCSS, emitRespinMarkup, emitRespinRuntime,
} from '../../src/blocks/respin.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== respin block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default mode=base', d.mode === 'base');
t('default holdRule=last-reel', d.holdRule === 'last-reel');

const r = resolveConfig({ features: [{ kind: 'respin' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'respin' }],
  respin: { mode: 'paid', holdRule: 'wild-anchor', respinsPerTrigger: 3, triggerChance: 0.3 },
});
t('override mode=paid', r2.mode === 'paid');
t('override holdRule', r2.holdRule === 'wild-anchor');
t('override respinsPerTrigger', r2.respinsPerTrigger === 3);
t('override triggerChance', r2.triggerChance === 0.3);

t('CSS empty when disabled', emitRespinCSS(defaultConfig()) === '');
const css = emitRespinCSS(r);
t('CSS has is-respinning', css.includes('.reelCol.is-respinning'));
t('CSS has respin-banner', css.includes('.respin-banner'));

t('markup empty when disabled', emitRespinMarkup(defaultConfig()) === '');
const mk = emitRespinMarkup(r);
t('markup has #respinBanner', mk.includes('id="respinBanner"'));

t('runtime stub when disabled', emitRespinRuntime(defaultConfig()).includes('disabled'));
const rt = emitRespinRuntime(r);
t('runtime exposes respinMaybeTrigger', rt.includes('window.respinMaybeTrigger'));
t('runtime exposes respinStart', rt.includes('window.respinStart'));
t('runtime exposes respinAfterSpin', rt.includes('window.respinAfterSpin'));
t('runtime exposes respinEnd', rt.includes('window.respinEnd'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
