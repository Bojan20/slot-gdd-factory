/**
 * tests/blocks/wildReel.test.mjs — Wave L4
 */
import {
  defaultConfig, resolveConfig,
  emitWildReelCSS, emitWildReelRuntime,
} from '../../src/blocks/wildReel.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== wildReel block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default chancePerSpin=0.18', d.chancePerSpin === 0.18);

const r = resolveConfig({ features: [{ kind: 'wild_reel' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'wild_reel' }], wildReel: { chancePerSpin: 0.5, maxReelsPerSpin: 3 } });
t('override chancePerSpin', r2.chancePerSpin === 0.5);
t('override maxReelsPerSpin', r2.maxReelsPerSpin === 3);

const r3 = resolveConfig({ features: [{ kind: 'wild_reel' }], wildReel: { chancePerSpin: 5 } });
t('clamp chancePerSpin<=1', r3.chancePerSpin === 1);

t('CSS empty when disabled', emitWildReelCSS(defaultConfig()) === '');
const css = emitWildReelCSS(r);
t('CSS has is-wild-reel', css.includes('.cell.is-wild-reel'));

t('runtime stub when disabled', emitWildReelRuntime(defaultConfig()).includes('disabled'));
const rt = emitWildReelRuntime(r);
t('runtime exposes maybeFireWildReel', rt.includes('window.maybeFireWildReel'));
t('runtime exposes clearWildReels', rt.includes('window.clearWildReels'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
