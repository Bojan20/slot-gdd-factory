/**
 * tests/blocks/persistentMultiplier.test.mjs — Wave M3
 */
import {
  defaultConfig, resolveConfig,
  emitPersistentMultiplierCSS, emitPersistentMultiplierMarkup, emitPersistentMultiplierRuntime,
} from '../../src/blocks/persistentMultiplier.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== persistentMultiplier block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default startMult=1', d.startMult === 1);
t('default growPerWin=1', d.growPerWin === 1);
t('default maxMult=0 (uncapped)', d.maxMult === 0);
t('default resetOnRoundEnd=true', d.resetOnRoundEnd === true);

const r = resolveConfig({ features: [{ kind: 'persistent_multiplier' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'persistent_multiplier' }],
  persistentMultiplier: { startMult: 2, growPerWin: 0, growPerCascade: 1, maxMult: 100, resetOnRoundEnd: false },
});
t('override startMult', r2.startMult === 2);
t('override growPerWin', r2.growPerWin === 0);
t('override growPerCascade', r2.growPerCascade === 1);
t('override maxMult', r2.maxMult === 100);
t('override resetOnRoundEnd', r2.resetOnRoundEnd === false);

t('CSS empty when disabled', emitPersistentMultiplierCSS(defaultConfig()) === '');
const css = emitPersistentMultiplierCSS(r);
t('CSS has pm-chip', css.includes('.pm-chip'));
t('CSS has pmGrow keyframe', css.includes('@keyframes pmGrow'));

t('markup empty when disabled', emitPersistentMultiplierMarkup(defaultConfig()) === '');
const mk = emitPersistentMultiplierMarkup(r);
t('markup has #pmChip', mk.includes('id="pmChip"'));

t('runtime stub when disabled', emitPersistentMultiplierRuntime(defaultConfig()).includes('disabled'));
const rt = emitPersistentMultiplierRuntime(r);
t('runtime exposes pmReset/pmOnWin/pmOnCascade/pmOnRoundEnd/pmGet',
  rt.includes('window.pmReset') && rt.includes('window.pmOnWin') &&
  rt.includes('window.pmOnCascade') && rt.includes('window.pmOnRoundEnd') &&
  rt.includes('window.pmGet'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
