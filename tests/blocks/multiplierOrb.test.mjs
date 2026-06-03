/**
 * tests/blocks/multiplierOrb.test.mjs
 * Wave K3 — pure Node tests for multiplierOrb block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitMultiplierOrbCSS,
  emitMultiplierOrbRuntime,
} from '../../src/blocks/multiplierOrb.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== multiplierOrb block ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default symbolId=M', d.symbolId === 'M');
t('default distribution non-empty', d.distribution.length >= 10);
t('default bonusAccumulate=false', d.bonusAccumulate === false);
t('default chipColor #ffe680', d.chipColor === '#ffe680');
t('default pulseMs=1000', d.pulseMs === 1000);

const r1 = resolveConfig({
  symbols: { specials: [{ id: 'M', name: 'Multiplier Orb' }] },
});
t('auto-enable from specials with orb name', r1.enabled === true);

const r2 = resolveConfig({
  multiplierOrb: { symbolId: 'X', bonusAccumulate: true, distribution: [{ value: 2, weight: 1 }, { value: 1000, weight: 0.1 }] },
});
t('override symbolId', r2.symbolId === 'X');
t('override bonusAccumulate=true', r2.bonusAccumulate === true);
t('override distribution', r2.distribution.length === 2 && r2.distribution[1].value === 1000);

const r3 = resolveConfig({ multiplierOrb: { symbolId: '!@#$' } });
t('rejects invalid symbolId', r3.symbolId === 'M');

const cssOff = emitMultiplierOrbCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitMultiplierOrbCSS(resolveConfig({ symbols: { specials: [{ id: 'M', name: 'Multiplier Orb' }] } }));
t('CSS has cell--orb class', css.includes('.cell--orb'));
t('CSS has orbPulse keyframe', css.includes('@keyframes orbPulse'));
t('CSS bakes chipColor', css.includes('#ffe680'));
t('CSS reduced-motion gate', css.includes('prefers-reduced-motion'));

const stub = emitMultiplierOrbRuntime(defaultConfig());
t('stub function annotateOrbs noop', stub.includes('function annotateOrbs()'));
t('stub accumulateOrbMultiplier returns 0', stub.includes('return 0'));

const rt = emitMultiplierOrbRuntime(resolveConfig({ symbols: { specials: [{ id: 'M', name: 'Multiplier Orb' }] } }));
t('runtime declares MULTIPLIER_ORB_ENABLED=true', rt.includes('MULTIPLIER_ORB_ENABLED = true'));
t('runtime bakes ID', rt.includes('MULTIPLIER_ORB_ID = "M"'));
t('runtime declares annotateOrbs', rt.includes('function annotateOrbs'));
t('runtime declares accumulateOrbMultiplier', rt.includes('function accumulateOrbMultiplier'));
t('runtime declares pickOrbValue', rt.includes('function pickOrbValue'));
t('runtime exposes annotateOrbs on window', rt.includes('window.annotateOrbs'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
