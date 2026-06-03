/**
 * tests/blocks/superSymbol.test.mjs — Wave P3
 */
import {
  defaultConfig, resolveConfig,
  emitSuperSymbolCSS, emitSuperSymbolRuntime,
} from '../../src/blocks/superSymbol.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== superSymbol block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default blockSize=2', d.blockSize === 2);
t('default triggerChance=0.18', d.triggerChance === 0.18);
t('default symbolPool=null', d.symbolPool === null);

const r = resolveConfig({ features: [{ kind: 'super_symbol' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'super_symbol' }],
  superSymbol: { blockSize: 3, triggerChance: 0.5, symbolPool: ['A', 'K', 'Q'] },
});
t('override blockSize', r2.blockSize === 3);
t('override triggerChance', r2.triggerChance === 0.5);
t('override symbolPool', JSON.stringify(r2.symbolPool) === '["A","K","Q"]');

const r3 = resolveConfig({ features: [{ kind: 'super_symbol' }], superSymbol: { blockSize: 99 } });
t('clamp blockSize<=5', r3.blockSize === 5);

t('CSS empty when disabled', emitSuperSymbolCSS(defaultConfig()) === '');
const css = emitSuperSymbolCSS(r);
t('CSS has is-super-anchor', css.includes('.cell.is-super-anchor'));
t('CSS has is-super-covered', css.includes('.cell.is-super-covered'));
t('CSS has superLand keyframe', css.includes('@keyframes superLand'));

t('runtime stub when disabled', emitSuperSymbolRuntime(defaultConfig()).includes('disabled'));
const rt = emitSuperSymbolRuntime(r);
t('runtime exposes maybeFireSuperSymbol', rt.includes('window.maybeFireSuperSymbol'));
t('runtime exposes clearSuperSymbols', rt.includes('window.clearSuperSymbols'));
t('runtime bakes SUPER_SIZE', rt.includes('SUPER_SIZE     = 2'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
