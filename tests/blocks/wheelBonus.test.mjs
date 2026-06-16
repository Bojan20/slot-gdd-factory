/**
 * tests/blocks/wheelBonus.test.mjs — Wave O2
 */
import {
  defaultConfig, resolveConfig,
  emitWheelBonusCSS, emitWheelBonusMarkup, emitWheelBonusRuntime,
} from '../../src/blocks/wheelBonus.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== wheelBonus block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default segments length=8', d.segments.length === 8);
t('default spinDurationMs=3800', d.spinDurationMs === 3800);
t('default autoSpin=false', d.autoSpin === false);

const r = resolveConfig({ features: [{ kind: 'wheel_bonus' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'wheel_bonus' }],
  wheelBonus: { spinDurationMs: 2000, autoSpin: true, title: 'JACKPOT WHEEL' },
});
t('override spinDurationMs', r2.spinDurationMs === 2000);
t('override autoSpin', r2.autoSpin === true);
t('override title', r2.title === 'JACKPOT WHEEL');

t('CSS empty when disabled', emitWheelBonusCSS(defaultConfig()) === '');
const css = emitWheelBonusCSS(r);
t('CSS has wb-overlay', css.includes('.wb-overlay'));
t('CSS has wb-wheel', css.includes('.wb-wheel'));

t('markup empty when disabled', emitWheelBonusMarkup(defaultConfig()) === '');
const mk = emitWheelBonusMarkup(r);
t('markup has #wbOverlay', mk.includes('id="wbOverlay"'));
t('markup has #wbWheel', mk.includes('id="wbWheel"'));
t('markup has wb-seg per segment', (mk.match(/class="wb-seg"/g) || []).length === 8);

t('runtime stub when disabled', emitWheelBonusRuntime(defaultConfig()).includes('disabled'));
const rt = emitWheelBonusRuntime(r);
t('runtime exposes wbOpen', rt.includes('window.wbOpen'));
t('runtime exposes wbSpin', rt.includes('window.wbSpin'));
t('runtime exposes wbClose', rt.includes('window.wbClose'));

/* ─── 2026-06-16 Boki fix — wheel never spins when math gated ─── */

t('runtime carries WB_FALLBACK_MS timer constant', rt.includes('WB_FALLBACK_MS'));
t('runtime defines _wbFallbackDraw helper', rt.includes('_wbFallbackDraw'));
t('runtime arms fallback in wbSpin (setTimeout to _wbFallbackDraw)',
  /WB_FALLBACK_TIMER\s*=\s*setTimeout\(_wbFallbackDraw/.test(rt));
t('runtime cancels fallback on wbAnimateTo entry',
  /function wbAnimateTo[\s\S]{0,200}_wbCancelFallback\(\)/.test(rt));
t('runtime cancels fallback on wbClose entry',
  /function wbClose\(\)[\s\S]{0,200}_wbCancelFallback\(\)/.test(rt));
t('runtime fallback uses Math.random over WB_SEGMENTS',
  /Math\.floor\(Math\.random\(\)\s*\*\s*WB_SEGMENTS\.length\)/.test(rt));
t('runtime fallback calls wbAnimateTo with chosen idx',
  /wbAnimateTo\(idx\)/.test(rt));
t('runtime fallback gated by WB_STATE.active + spinning',
  /if\s*\(!WB_STATE\.active\s*\|\|\s*!WB_STATE\.spinning\)\s*return/.test(rt));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
