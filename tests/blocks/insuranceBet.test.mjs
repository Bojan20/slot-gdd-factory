/**
 * tests/blocks/insuranceBet.test.mjs · LEGO-SIDEBET (B-7 · 1/2)
 */
import {
  defaultConfig, resolveConfig,
  emitInsuranceBetCSS, emitInsuranceBetMarkup, emitInsuranceBetRuntime,
  INSURANCE_BET_BANNED_JURISDICTIONS,
} from '../../src/blocks/insuranceBet.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== insuranceBet (LEGO-SIDEBET B-7 · 1/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label INSURE', d.label === 'INSURE');
t('default costMult 1.20', d.costMult === 1.20);
t('default payoutRatio 0.50', d.payoutRatio === 0.50);

const r1 = resolveConfig({ features: [{ kind: 'insurance_bet' }] });
t('auto-enable insurance_bet', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'insurance' }] });
t('auto-enable insurance alias', r1b.enabled === true);

const r2 = resolveConfig({ insuranceBet: { enabled: true, costMult: 1.30, payoutRatio: 0.75 } });
t('explicit enable honored', r2.enabled === true);
t('override costMult', r2.costMult === 1.30);
t('override payoutRatio', r2.payoutRatio === 0.75);

const rClamp = resolveConfig({ insuranceBet: { enabled: true, costMult: 99, payoutRatio: 99 } });
t('clamp costMult ≤ 2.0', rClamp.costMult === 2.0);
t('clamp payoutRatio ≤ 1.0', rClamp.payoutRatio === 1.0);

/* Jurisdiction matrix */
for (const j of INSURANCE_BET_BANNED_JURISDICTIONS) {
  const rj = resolveConfig({
    features: [{ kind: 'insurance_bet' }],
    regulator: { profile: j },
  });
  t(`jurisdiction ${j} forces disabled`, rj.enabled === false && rj.bannedByJurisdiction === true);
}
const rMGA = resolveConfig({
  features: [{ kind: 'insurance_bet' }],
  regulator: { profile: 'MGA' },
});
t('MGA stays enabled', rMGA.enabled === true && rMGA.bannedByJurisdiction === false);

const css = emitInsuranceBetCSS(r1);
t('CSS empty when disabled', emitInsuranceBetCSS(defaultConfig()) === '');
t('CSS has insurance-bet class', css.includes('.insurance-bet'));
t('CSS has switch class', css.includes('.ib-switch'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has data-locked state', css.includes('data-locked'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));

const markup = emitInsuranceBetMarkup(r1);
t('markup empty when disabled', emitInsuranceBetMarkup(defaultConfig()) === '');
t('markup has id', markup.includes('id="insuranceBet"'));
t('markup has role=switch', markup.includes('role="switch"'));
t('markup has aria-checked=false', markup.includes('aria-checked="false"'));
t('markup shows +20% label', markup.includes('+20%'));

const rt = emitInsuranceBetRuntime(r1);
t('runtime stub when disabled', emitInsuranceBetRuntime(defaultConfig()).includes('disabled'));
t('runtime declares IB_COST_MULT', rt.includes('IB_COST_MULT'));
t('runtime declares IB_PAYOUT_RATIO', rt.includes('IB_PAYOUT_RATIO'));
t('runtime sets window.INSURANCE_BET_ON', rt.includes('window.INSURANCE_BET_ON'));
t('runtime sets window.INSURANCE_BET_COST_MULT', rt.includes('window.INSURANCE_BET_COST_MULT'));
t('runtime sets window.INSURANCE_BET_PAYOUT_RATIO', rt.includes('window.INSURANCE_BET_PAYOUT_RATIO'));
t('runtime emits onInsuranceBetChanged', rt.includes('onInsuranceBetChanged'));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime keyboard Enter/Space', rt.includes("e.key === 'Enter'") && rt.includes("e.key === ' '"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
