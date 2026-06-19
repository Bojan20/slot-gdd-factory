/**
 * tests/blocks/sessionLevelMeter.test.mjs · LEGO-PROG (DEF1 · 2/3)
 */
import {
  defaultConfig, resolveConfig,
  emitSessionLevelMeterCSS, emitSessionLevelMeterMarkup, emitSessionLevelMeterRuntime,
} from '../../src/blocks/sessionLevelMeter.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== sessionLevelMeter (LEGO-PROG DEF1 · 2/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label LVL', d.label === 'LVL');

const r1 = resolveConfig({ features: [{ kind: 'player_xp' }] });
t('auto-enable via player_xp complement', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'session_level_meter' }] });
t('auto-enable session_level_meter', r1b.enabled === true);

const r2 = resolveConfig({ sessionLevelMeter: { enabled: true, label: 'NIVO' } });
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'NIVO');

const css = emitSessionLevelMeterCSS(r1);
t('CSS empty when disabled', emitSessionLevelMeterCSS(defaultConfig()) === '');
t('CSS has meter class', css.includes('.session-level-meter'));
t('CSS has bar + fill classes', css.includes('.slm-bar') && css.includes('.slm-fill'));
t('CSS has level chip class', css.includes('.slm-level'));
t('CSS has flash state', css.includes('data-flash'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));

const markup = emitSessionLevelMeterMarkup(r1);
t('markup empty when disabled', emitSessionLevelMeterMarkup(defaultConfig()) === '');
t('markup has role=progressbar', markup.includes('role="progressbar"'));
t('markup has aria-valuenow', markup.includes('aria-valuenow="0"'));
t('markup has aria-valuemax', markup.includes('aria-valuemax="100"'));
t('markup has aria-valuetext', markup.includes('aria-valuetext='));
t('markup has level chip', markup.includes('id="sessionLevelChip"'));
t('markup has fill', markup.includes('id="sessionLevelFill"'));
t('markup has number label', markup.includes('id="sessionLevelNum"'));

const rt = emitSessionLevelMeterRuntime(r1);
t('runtime stub disabled', emitSessionLevelMeterRuntime(defaultConfig()).includes('disabled'));
t('runtime has render function', rt.includes('function render'));
t('runtime reads __PLAYER_XP__ state', rt.includes('__PLAYER_XP__'));
t('runtime listens onPlayerXpGained', rt.includes("HookBus.on('onPlayerXpGained'"));
t('runtime listens onPlayerLevelUp', rt.includes("HookBus.on('onPlayerLevelUp'"));
t('runtime updates aria-valuenow', rt.includes("'aria-valuenow'"));
t('runtime updates aria-valuetext', rt.includes("'aria-valuetext'"));
t('runtime flashes on level-up', rt.includes("data-flash"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
