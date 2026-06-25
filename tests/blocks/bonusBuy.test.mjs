/**
 * tests/blocks/bonusBuy.test.mjs
 * Wave K4 — pure Node tests for bonusBuy block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitBonusBuyCSS,
  emitBonusBuyMarkup,
  emitBonusBuyRuntime,
} from '../../src/blocks/bonusBuy.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== bonusBuy block ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
/* Wave T-bonus: industry-median 75× replaces 100× GoO-style default. */
t('default costX=75 (Wave T-bonus)', d.costX === 75);
t('default label BUY BONUS', d.label === 'BUY BONUS');
t('default forceScatters=4', d.forceScatters === 4);

const r1 = resolveConfig({ features: [{ kind: 'bonus_buy', label: 'BB' }] });
t('auto-enable from feature', r1.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'bonus_buy', label: 'BB' }],
  bonusBuy: { costX: 75, label: 'GET BONUS', forceScatters: 5, color: '#abc' },
});
t('override costX', r2.costX === 75);
t('override label', r2.label === 'GET BONUS');
t('override forceScatters', r2.forceScatters === 5);
t('override color', r2.color === '#abc');

const r3 = resolveConfig({ features: [{ kind: 'bonus_buy', label: '' }], bonusBuy: { costX: 99999 } });
t('clamp costX <=10000', r3.costX === 10000);

const cssOff = emitBonusBuyCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitBonusBuyCSS(resolveConfig({ features: [{ kind: 'bonus_buy', label: 'X' }] }));
t('CSS has bonus-buy-btn class', css.includes('.bonus-buy-btn'));
t('CSS bakes color', css.includes('#ff5050'));

const markup = emitBonusBuyMarkup(resolveConfig({ features: [{ kind: 'bonus_buy', label: 'X' }] }));
t('markup has button#bonusBuyBtn', markup.includes('id="bonusBuyBtn"'));
t('markup has BUY BONUS label', markup.includes('BUY BONUS'));
// N+2-H (Boki 2026-06-25) — markup gained an i18n <span> wrapper around
// "BET" so the betSelector fallback can swap labels without touching the
// cost span (src/blocks/bonusBuy.mjs:268). The "75× BET" substring is no
// longer literal — there is `75× <span ...>BET</span>` instead. The
// architectural intent of the original test (cost number + BET label
// both present on the button) is preserved by checking both pieces
// independently against the rendered markup.
t('markup has 75× cost (Wave T-bonus)', markup.includes('75×'));
t('markup carries BET label (i18n-wrapped)', />BET</.test(markup));

const stub = emitBonusBuyRuntime(defaultConfig());
t('runtime stub empty/comment when disabled', stub.includes('disabled'));

const rt = emitBonusBuyRuntime(resolveConfig({ features: [{ kind: 'bonus_buy', label: 'X' }] }));
t('runtime declares BONUS_BUY_COST_X (Wave T-bonus default 75)', rt.includes('BONUS_BUY_COST_X = 75'));
t('runtime declares BONUS_BUY_FORCE_SCATTERS', rt.includes('BONUS_BUY_FORCE_SCATTERS = 4'));
t('runtime wires click listener', rt.includes("addEventListener('click'"));
t('runtime sets FORCE_TRIGGER', rt.includes('FORCE_TRIGGER = BONUS_BUY_FORCE_SCATTERS'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
