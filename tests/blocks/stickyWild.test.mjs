/**
 * tests/blocks/stickyWild.test.mjs — Wave L1
 */
import {
  defaultConfig, resolveConfig,
  emitStickyWildCSS, emitStickyWildRuntime,
} from '../../src/blocks/stickyWild.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== stickyWild block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default mode=fs', d.mode === 'fs');
t('default wildSymbolId=W', d.wildSymbolId === 'W');
t('default durationSpins=0 (persistent)', d.durationSpins === 0);

const r1 = resolveConfig({ features: [{ kind: 'sticky_wild' }] });
t('auto-enable from feature', r1.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'sticky_wild' }],
  stickyWild: { mode: 'both', durationSpins: 5, wildSymbolId: 'WW', haloColor: '100,100,200' },
});
t('override mode=both', r2.mode === 'both');
t('override durationSpins=5', r2.durationSpins === 5);
t('override wildSymbolId=WW', r2.wildSymbolId === 'WW');
t('override haloColor', r2.haloColor === '100,100,200');

const r3 = resolveConfig({ features: [{ kind: 'sticky_wild' }], stickyWild: { durationSpins: 9999 } });
t('clamp durationSpins<=99', r3.durationSpins === 99);

const cssOff = emitStickyWildCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitStickyWildCSS(resolveConfig({ features: [{ kind: 'sticky_wild' }] }));
t('CSS has is-sticky-wild class', css.includes('.cell.is-sticky-wild'));
t('CSS has stickyWildPulse keyframe', css.includes('@keyframes stickyWildPulse'));

const stub = emitStickyWildRuntime(defaultConfig());
t('runtime stub when disabled', stub.includes('disabled'));

const rt = emitStickyWildRuntime(resolveConfig({ features: [{ kind: 'sticky_wild' }] }));
t('runtime declares registry', rt.includes('STICKY_WILD_REGISTRY'));
t('runtime exposes harvestStickyWilds', rt.includes('window.harvestStickyWilds'));
t('runtime exposes applyStickyWilds', rt.includes('window.applyStickyWilds'));
t('runtime exposes tickStickyWilds', rt.includes('window.tickStickyWilds'));
t('runtime exposes clearStickyWilds', rt.includes('window.clearStickyWilds'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
