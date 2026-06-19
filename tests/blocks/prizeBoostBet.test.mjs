/**
 * tests/blocks/prizeBoostBet.test.mjs · LEGO-SIDEBET (B-7 · 2/2)
 */
import {
  defaultConfig, resolveConfig,
  emitPrizeBoostBetCSS, emitPrizeBoostBetMarkup, emitPrizeBoostBetRuntime,
  PRIZE_BOOST_BANNED_JURISDICTIONS,
} from '../../src/blocks/prizeBoostBet.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== prizeBoostBet (LEGO-SIDEBET B-7 · 2/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label BOOST', d.label === 'BOOST');
t('default costMult 1.50', d.costMult === 1.50);
t('default winMult 2.0', d.winMult === 2.0);

const r1 = resolveConfig({ features: [{ kind: 'prize_boost' }] });
t('auto-enable prize_boost', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'win_boost' }] });
t('auto-enable win_boost alias', r1b.enabled === true);
const r1c = resolveConfig({ features: [{ kind: 'boost_bet' }] });
t('auto-enable boost_bet alias', r1c.enabled === true);

const r2 = resolveConfig({ prizeBoostBet: { enabled: true, costMult: 1.75, winMult: 3.0 } });
t('explicit enable honored', r2.enabled === true);
t('override costMult', r2.costMult === 1.75);
t('override winMult', r2.winMult === 3.0);

const rClamp = resolveConfig({ prizeBoostBet: { enabled: true, costMult: 99, winMult: 99 } });
t('clamp costMult ≤ 5.0', rClamp.costMult === 5.0);
t('clamp winMult ≤ 10.0', rClamp.winMult === 10.0);

for (const j of PRIZE_BOOST_BANNED_JURISDICTIONS) {
  const rj = resolveConfig({
    features: [{ kind: 'prize_boost' }],
    regulator: { profile: j },
  });
  t(`jurisdiction ${j} forces disabled`, rj.enabled === false && rj.bannedByJurisdiction === true);
}
const rMGA = resolveConfig({
  features: [{ kind: 'prize_boost' }],
  regulator: { profile: 'MGA' },
});
t('MGA stays enabled', rMGA.enabled === true && rMGA.bannedByJurisdiction === false);

const css = emitPrizeBoostBetCSS(r1);
t('CSS empty when disabled', emitPrizeBoostBetCSS(defaultConfig()) === '');
t('CSS has prize-boost-bet class', css.includes('.prize-boost-bet'));
t('CSS has switch class', css.includes('.pb-switch'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has data-locked', css.includes('data-locked'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));

const markup = emitPrizeBoostBetMarkup(r1);
t('markup empty when disabled', emitPrizeBoostBetMarkup(defaultConfig()) === '');
t('markup has id', markup.includes('id="prizeBoostBet"'));
t('markup has role=switch', markup.includes('role="switch"'));
t('markup has aria-checked=false', markup.includes('aria-checked="false"'));
t('markup shows +50% label', markup.includes('+50%'));

const rt = emitPrizeBoostBetRuntime(r1);
t('runtime stub when disabled', emitPrizeBoostBetRuntime(defaultConfig()).includes('disabled'));
t('runtime declares PB_COST_MULT', rt.includes('PB_COST_MULT'));
t('runtime declares PB_WIN_MULT', rt.includes('PB_WIN_MULT'));
t('runtime sets window.PRIZE_BOOST_ON', rt.includes('window.PRIZE_BOOST_ON'));
t('runtime sets window.PRIZE_BOOST_COST_MULT', rt.includes('window.PRIZE_BOOST_COST_MULT'));
t('runtime sets window.PRIZE_BOOST_WIN_MULT', rt.includes('window.PRIZE_BOOST_WIN_MULT'));
t('runtime emits onPrizeBoostChanged', rt.includes('onPrizeBoostChanged'));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime keyboard Enter/Space', rt.includes("e.key === 'Enter'") && rt.includes("e.key === ' '"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
