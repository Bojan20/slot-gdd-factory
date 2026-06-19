/**
 * tests/blocks/replayControlBar.test.mjs · LEGO-REPLAY (B-2 · 2/2)
 */
import {
  defaultConfig, resolveConfig,
  emitReplayControlBarCSS, emitReplayControlBarMarkup, emitReplayControlBarRuntime,
} from '../../src/blocks/replayControlBar.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== replayControlBar (LEGO-REPLAY B-2 · 2/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);

const r1 = resolveConfig({ features: [{ kind: 'spin_replay' }] });
t('auto-enable from spin_replay', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'replay_bar' }] });
t('auto-enable from replay_bar alias', r1b.enabled === true);

const r2 = resolveConfig({ replayControlBar: { enabled: true, label: 'BAR' } });
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'BAR');

const css = emitReplayControlBarCSS(r1);
t('CSS empty when disabled', emitReplayControlBarCSS(defaultConfig()) === '');
t('CSS has control bar class', css.includes('.replay-control-bar'));
t('CSS has rcb-btn class', css.includes('.rcb-btn'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has aria-disabled state', css.includes('aria-disabled'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));

const markup = emitReplayControlBarMarkup(r1);
t('markup empty when disabled', emitReplayControlBarMarkup(defaultConfig()) === '');
t('markup has role=toolbar', markup.includes('role="toolbar"'));
t('markup has 4 buttons', (markup.match(/rcb-btn/g) || []).length >= 4);
t('markup has rcbReplay', markup.includes('id="rcbReplay"'));
t('markup has rcbPrev', markup.includes('id="rcbPrev"'));
t('markup has rcbNext', markup.includes('id="rcbNext"'));
t('markup has rcbStop', markup.includes('id="rcbStop"'));
t('markup buttons initial aria-disabled', markup.includes('aria-disabled="true"'));

const rt = emitReplayControlBarRuntime(r1);
t('runtime stub when disabled', emitReplayControlBarRuntime(defaultConfig()).includes('disabled'));
t('runtime has syncButtons', rt.includes('function syncButtons'));
t('runtime has invoke function', rt.includes('function invoke'));
t('runtime emits onReplayControlInvoked', rt.includes('onReplayControlInvoked'));
t('runtime listens onSpinReplayStart', rt.includes("HookBus.on('onSpinReplayStart'"));
t('runtime listens onSpinReplayEnd', rt.includes("HookBus.on('onSpinReplayEnd'"));
t('runtime listens onSpinReplayPaused', rt.includes("HookBus.on('onSpinReplayPaused'"));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime handles keyboard ArrowRight/Left', rt.includes('ArrowRight') && rt.includes('ArrowLeft'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
