/**
 * tests/blocks/holdAndWin.test.mjs — Wave N1
 */
import {
  defaultConfig, resolveConfig,
  emitHoldAndWinCSS, emitHoldAndWinMarkup, emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== holdAndWin block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default triggerCount=6', d.triggerCount === 6);
t('default respinsAwarded=3', d.respinsAwarded === 3);
t('default resetOnNewBonus=true', d.resetOnNewBonus === true);
t('default bonusSymbolId=B', d.bonusSymbolId === 'B');

const r = resolveConfig({ features: [{ kind: 'hold_and_win' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'hold_and_win' }],
  holdAndWin: { triggerCount: 4, respinsAwarded: 5, resetOnNewBonus: false, bonusSymbolId: 'C' },
});
t('override triggerCount', r2.triggerCount === 4);
t('override respinsAwarded', r2.respinsAwarded === 5);
t('override resetOnNewBonus', r2.resetOnNewBonus === false);
t('override bonusSymbolId', r2.bonusSymbolId === 'C');

t('CSS empty when disabled', emitHoldAndWinCSS(defaultConfig()) === '');
const css = emitHoldAndWinCSS(r);
t('CSS has is-locked-bonus', css.includes('.cell.is-locked-bonus'));
t('CSS has hw-hud', css.includes('.hw-hud'));

t('markup empty when disabled', emitHoldAndWinMarkup(defaultConfig()) === '');
const mk = emitHoldAndWinMarkup(r);
t('markup has #hwHud', mk.includes('id="hwHud"'));
t('markup has hwRespins', mk.includes('id="hwRespins"'));

t('runtime stub when disabled', emitHoldAndWinRuntime(defaultConfig()).includes('disabled'));
const rt = emitHoldAndWinRuntime(r);
t('runtime exposes hwMaybeEnter', rt.includes('window.hwMaybeEnter'));
t('runtime exposes hwAfterRespin', rt.includes('window.hwAfterRespin'));
t('runtime exposes hwHarvestBonus', rt.includes('window.hwHarvestBonus'));
t('runtime exposes HW_STATE', rt.includes('window.HW_STATE'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
