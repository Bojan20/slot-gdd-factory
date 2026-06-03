/**
 * tests/blocks/mysterySymbol.test.mjs — Wave L5
 */
import {
  defaultConfig, resolveConfig,
  emitMysterySymbolCSS, emitMysterySymbolRuntime,
} from '../../src/blocks/mysterySymbol.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== mysterySymbol block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default mysterySymbolId=M', d.mysterySymbolId === 'M');
t('default revealDelayMs=320', d.revealDelayMs === 320);
t('default includeWild=false', d.includeWild === false);

const r = resolveConfig({ features: [{ kind: 'mystery_symbol' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'mystery_symbol' }],
  mysterySymbol: { mysterySymbolId: 'X', includeWild: true, revealDurationMs: 800 },
});
t('override mysterySymbolId', r2.mysterySymbolId === 'X');
t('override includeWild', r2.includeWild === true);
t('override revealDurationMs', r2.revealDurationMs === 800);

t('CSS empty when disabled', emitMysterySymbolCSS(defaultConfig()) === '');
const css = emitMysterySymbolCSS(r);
t('CSS has is-mystery', css.includes('.cell.is-mystery'));
t('CSS has mysteryReveal keyframe', css.includes('@keyframes mysteryReveal'));

t('runtime stub when disabled', emitMysterySymbolRuntime(defaultConfig()).includes('disabled'));
const rt = emitMysterySymbolRuntime(r);
t('runtime exposes markMysteryCells', rt.includes('window.markMysteryCells'));
t('runtime exposes revealMysterySymbols', rt.includes('window.revealMysterySymbols'));
t('runtime exposes clearMysteryFlags', rt.includes('window.clearMysteryFlags'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
