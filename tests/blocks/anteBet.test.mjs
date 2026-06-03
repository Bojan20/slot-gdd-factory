/**
 * tests/blocks/anteBet.test.mjs
 * Wave K5 — pure Node tests for anteBet block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitAnteBetCSS,
  emitAnteBetMarkup,
  emitAnteBetRuntime,
} from '../../src/blocks/anteBet.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== anteBet block ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default costMultiplier=1.25', d.costMultiplier === 1.25);
t('default triggerMultiplier=2', d.triggerMultiplier === 2);
t('default label ANTE BET', d.label === 'ANTE BET');

const r1 = resolveConfig({ features: [{ kind: 'ante_bet', label: 'AB' }] });
t('auto-enable from feature', r1.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'ante_bet', label: 'AB' }],
  anteBet: { costMultiplier: 1.5, triggerMultiplier: 3, label: 'ANTE', color: '#0f0' },
});
t('override costMultiplier', r2.costMultiplier === 1.5);
t('override triggerMultiplier', r2.triggerMultiplier === 3);
t('override label', r2.label === 'ANTE');
t('override color', r2.color === '#0f0');

const r3 = resolveConfig({ features: [{ kind: 'ante_bet', label: 'X' }], anteBet: { costMultiplier: 0.5 } });
t('clamp costMultiplier >=1.01', r3.costMultiplier === 1.01);

const cssOff = emitAnteBetCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitAnteBetCSS(resolveConfig({ features: [{ kind: 'ante_bet', label: 'X' }] }));
t('CSS has ante-bet class', css.includes('.ante-bet'));
t('CSS has switch element', css.includes('.ante-bet .switch'));
t('CSS bakes +25% label', css.includes('25'));

const markup = emitAnteBetMarkup(resolveConfig({ features: [{ kind: 'ante_bet', label: 'X' }] }));
t('markup has anteBetToggle id', markup.includes('id="anteBetToggle"'));
t('markup has ANTE BET label', markup.includes('ANTE BET'));
t('markup has +25% indicator', markup.includes('+25%'));
t('markup has aria-checked=false', markup.includes('aria-checked="false"'));

const stub = emitAnteBetRuntime(defaultConfig());
t('runtime stub when disabled', stub.includes('disabled'));

const rt = emitAnteBetRuntime(resolveConfig({ features: [{ kind: 'ante_bet', label: 'X' }] }));
t('runtime declares ANTE_BET_COST_MULT', rt.includes('ANTE_BET_COST_MULT'));
t('runtime declares ANTE_BET_TRIGGER_MULT', rt.includes('ANTE_BET_TRIGGER_MULT'));
t('runtime wires click listener', rt.includes("addEventListener('click'"));
t('runtime wires keyboard accessibility', rt.includes("addEventListener('keydown'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
