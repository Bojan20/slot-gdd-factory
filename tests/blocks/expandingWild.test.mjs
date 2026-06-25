/**
 * tests/blocks/expandingWild.test.mjs — Wave L2
 */
import {
  defaultConfig, resolveConfig,
  emitExpandingWildCSS, emitExpandingWildRuntime,
} from '../../src/blocks/expandingWild.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== expandingWild block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default expandDurationMs=360', d.expandDurationMs === 360);

const r = resolveConfig({ features: [{ kind: 'expanding_wild' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'expanding_wild' }], expandingWild: { expandDurationMs: 800 } });
t('override expandDurationMs', r2.expandDurationMs === 800);

t('CSS empty when disabled', emitExpandingWildCSS(defaultConfig()) === '');
const css = emitExpandingWildCSS(r);
t('CSS has is-expanded-wild', css.includes('.cell.is-expanded-wild'));
// N+2-H (Boki 2026-06-25) — block was refactored to emit a four-phase
// keyframe set (`ewAnticipate` → `ewExpand` → `ewHoldPulse` → `ewClear`)
// instead of a single `expandWildGrow` keyframe. The intent of the test
// is still "the grow animation is emitted as a CSS keyframe"; pinning
// to the new `ewExpand` keyframe preserves that contract. If the block
// is ever refactored back to a single keyframe the test will catch
// that drift too.
t('CSS has ewExpand keyframe (grow phase)', css.includes('@keyframes ewExpand'));

t('runtime stub when disabled', emitExpandingWildRuntime(defaultConfig()).includes('disabled'));
const rt = emitExpandingWildRuntime(r);
t('runtime exposes applyExpandingWilds', rt.includes('window.applyExpandingWilds'));
t('runtime exposes clearExpandingWilds', rt.includes('window.clearExpandingWilds'));
t('runtime constants baked', rt.includes('EXPANDING_WILD_SYMBOL'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
