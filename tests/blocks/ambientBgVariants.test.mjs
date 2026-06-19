/**
 * tests/blocks/ambientBgVariants.test.mjs · LEGO-THEME (B-8 · 3/3)
 */
import {
  defaultConfig, resolveConfig,
  emitAmbientBgVariantsCSS, emitAmbientBgVariantsMarkup, emitAmbientBgVariantsRuntime,
} from '../../src/blocks/ambientBgVariants.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== ambientBgVariants (LEGO-THEME B-8 · 3/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default tenseAtX 1', d.tenseAtX === 1);
t('default celebrationAtX 10', d.celebrationAtX === 10);
t('default calmRGB', /^\d+,\d+,\d+$/.test(d.calmRGB));
t('default bonusRGB', /^\d+,\d+,\d+$/.test(d.bonusRGB));

const r1 = resolveConfig({ features: [{ kind: 'ambient_bg_variants' }] });
t('auto-enable ambient_bg_variants', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'mood_bg' }] });
t('auto-enable mood_bg alias', r1b.enabled === true);

const r2 = resolveConfig({
  ambientBgVariants: { enabled: true, tenseAtX: 2, celebrationAtX: 50,
    calmRGB: '10,20,30', tenseRGB: '40,30,10' },
});
t('explicit enable honored', r2.enabled === true);
t('override tenseAtX', r2.tenseAtX === 2);
t('override celebrationAtX', r2.celebrationAtX === 50);
t('override calmRGB', r2.calmRGB === '10,20,30');
t('override tenseRGB', r2.tenseRGB === '40,30,10');

const rInv = resolveConfig({
  ambientBgVariants: { enabled: true, tenseAtX: 50, celebrationAtX: 5 },
});
t('celebrationAtX clamped up to tenseAtX when inverted',
  rInv.celebrationAtX >= rInv.tenseAtX);

const css = emitAmbientBgVariantsCSS(r1);
t('CSS empty when disabled', emitAmbientBgVariantsCSS(defaultConfig()) === '');
t('CSS targets body.ambient-bg', css.includes('body.ambient-bg'));
t('CSS has 4 mood variants',
  css.includes('data-mood="calm"') && css.includes('data-mood="tense"') &&
  css.includes('data-mood="celebration"') && css.includes('data-mood="bonus"'));
t('CSS uses --ambient-rgb var', css.includes('--ambient-rgb'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));

const markup = emitAmbientBgVariantsMarkup(r1);
t('markup empty when disabled', emitAmbientBgVariantsMarkup(defaultConfig()) === '');
t('markup has live region', markup.includes('id="ambientMoodLive"'));

const rt = emitAmbientBgVariantsRuntime(r1);
t('runtime stub disabled', emitAmbientBgVariantsRuntime(defaultConfig()).includes('disabled'));
t('runtime declares AB_TENSE_AT', rt.includes('AB_TENSE_AT'));
t('runtime declares AB_CELEBRATION_AT', rt.includes('AB_CELEBRATION_AT'));
t('runtime adds ambient-bg class', rt.includes("classList.add('ambient-bg'"));
t('runtime has setMood function', rt.includes('function setMood'));
t('runtime has moodFromWin function', rt.includes('function moodFromWin'));
t('runtime emits onAmbientMoodChanged', rt.includes('onAmbientMoodChanged'));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onBigWinTierEnter', rt.includes("HookBus.on('onBigWinTierEnter'"));
t('runtime listens onBigWinTierExit', rt.includes("HookBus.on('onBigWinTierExit'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime listens onThemeChanged', rt.includes("HookBus.on('onThemeChanged'"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
