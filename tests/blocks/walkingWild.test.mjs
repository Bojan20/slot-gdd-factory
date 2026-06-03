/**
 * tests/blocks/walkingWild.test.mjs — Wave L3
 */
import {
  defaultConfig, resolveConfig,
  emitWalkingWildCSS, emitWalkingWildRuntime,
} from '../../src/blocks/walkingWild.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== walkingWild block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default direction=left', d.direction === 'left');
t('default triggerRespin=true', d.triggerRespin === true);

const r = resolveConfig({ features: [{ kind: 'walking_wild' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'walking_wild' }], walkingWild: { direction: 'right', triggerRespin: false } });
t('override direction', r2.direction === 'right');
t('override triggerRespin', r2.triggerRespin === false);

t('CSS empty when disabled', emitWalkingWildCSS(defaultConfig()) === '');
const css = emitWalkingWildCSS(r);
t('CSS has is-walking-wild', css.includes('.cell.is-walking-wild'));

t('runtime stub when disabled', emitWalkingWildRuntime(defaultConfig()).includes('disabled'));
const rt = emitWalkingWildRuntime(r);
t('runtime DX=-1 (left)', rt.includes('WALKING_WILD_DX       = -1'));
t('runtime exposes harvestWalkingWilds', rt.includes('window.harvestWalkingWilds'));
t('runtime exposes stepWalkingWilds', rt.includes('window.stepWalkingWilds'));
t('runtime exposes applyWalkingWilds', rt.includes('window.applyWalkingWilds'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
