/**
 * tests/blocks/lightning.test.mjs — Wave P1
 */
import {
  defaultConfig, resolveConfig,
  emitLightningCSS, emitLightningRuntime,
} from '../../src/blocks/lightning.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== lightning block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default triggerChance=0.22', d.triggerChance === 0.22);
t('default minStrikes=2 maxStrikes=6', d.minStrikes === 2 && d.maxStrikes === 6);
t('default multipliers length=7', d.multipliers.length === 7);

const r = resolveConfig({ features: [{ kind: 'lightning' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'lightning' }],
  lightning: {
    triggerChance: 0.5, minStrikes: 4, maxStrikes: 10,
    multipliers: [{ value: 2, weight: 100 }],
    strikeDurationMs: 1200,
  },
});
t('override triggerChance', r2.triggerChance === 0.5);
t('override minStrikes', r2.minStrikes === 4);
t('override maxStrikes', r2.maxStrikes === 10);
t('override multipliers', r2.multipliers.length === 1 && r2.multipliers[0].value === 2);
t('override strikeDurationMs', r2.strikeDurationMs === 1200);

t('CSS empty when disabled', emitLightningCSS(defaultConfig()) === '');
const css = emitLightningCSS(r);
t('CSS has is-lightning-struck', css.includes('.cell.is-lightning-struck'));
t('CSS has lightningFlash keyframe', css.includes('@keyframes lightningFlash'));

t('runtime stub when disabled', emitLightningRuntime(defaultConfig()).includes('disabled'));
const rt = emitLightningRuntime(r);
t('runtime exposes maybeFireLightning', rt.includes('window.maybeFireLightning'));
t('runtime exposes clearLightning', rt.includes('window.clearLightning'));
t('runtime bakes LIT_POOL', rt.includes('LIT_POOL'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
