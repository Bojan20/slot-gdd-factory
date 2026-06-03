/**
 * tests/blocks/winCap.test.mjs — Wave N3
 */
import {
  defaultConfig, resolveConfig,
  emitWinCapCSS, emitWinCapMarkup, emitWinCapRuntime,
} from '../../src/blocks/winCap.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== winCap block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default maxWinX=5000', d.maxWinX === 5000);
t('default mode=round', d.mode === 'round');
t('default forceRoundEnd=true', d.forceRoundEnd === true);

const r = resolveConfig({ features: [{ kind: 'win_cap' }] });
t('auto-enable from feature', r.enabled === true);

const rLim = resolveConfig({ limits: { max_win_x: 10000 } });
t('auto-enable from limits.max_win_x', rLim.enabled === true);
t('maxWinX from limits', rLim.maxWinX === 10000);

const r2 = resolveConfig({
  features: [{ kind: 'win_cap' }],
  winCap: { maxWinX: 25000, mode: 'spin', overlayLabel: 'MEGA WIN', overlayMs: 4000, forceRoundEnd: false },
});
t('override maxWinX', r2.maxWinX === 25000);
t('override mode=spin', r2.mode === 'spin');
t('override overlayLabel', r2.overlayLabel === 'MEGA WIN');
t('override overlayMs', r2.overlayMs === 4000);
t('override forceRoundEnd', r2.forceRoundEnd === false);

t('CSS empty when disabled', emitWinCapCSS(defaultConfig()) === '');
const css = emitWinCapCSS(r);
t('CSS has wincap-overlay', css.includes('.wincap-overlay'));

t('markup empty when disabled', emitWinCapMarkup(defaultConfig()) === '');
const mk = emitWinCapMarkup(r);
t('markup has #winCapOverlay', mk.includes('id="winCapOverlay"'));
t('markup escapes label', mk.includes('MAX WIN!'));

t('runtime stub when disabled', emitWinCapRuntime(defaultConfig()).includes('disabled'));
const rt = emitWinCapRuntime(r);
t('runtime exposes winCapAdd', rt.includes('window.winCapAdd'));
t('runtime exposes winCapTrigger', rt.includes('window.winCapTrigger'));
t('runtime exposes winCapReset', rt.includes('window.winCapReset'));
t('runtime bakes WIN_CAP_MAX_X', rt.includes('WIN_CAP_MAX_X        = 5000'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
