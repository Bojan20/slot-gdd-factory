/**
 * tests/blocks/volatilitySelector.test.mjs
 * Wave LEGO-VOLATILITY (B-6)
 */
import {
  defaultConfig, resolveConfig,
  emitVolatilitySelectorCSS, emitVolatilitySelectorMarkup, emitVolatilitySelectorRuntime,
} from '../../src/blocks/volatilitySelector.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== volatilitySelector block (LEGO-VOLATILITY B-6) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label STYLE', d.label === 'STYLE');
t('default 3 tiers', d.tiers.length === 3);
t('default tier 0 low', d.tiers[0].id === 'low' && d.tiers[0].label === 'LOW');
t('default tier 2 high', d.tiers[2].id === 'high');
t('default tier index 1 (medium)', d.defaultTierIndex === 1);
t('frozen tiers', Object.isFrozen(d.tiers));

const r1 = resolveConfig({ features: [{ kind: 'volatility_selector' }] });
t('auto-enable volatility_selector', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'volatility_chooser' }] });
t('auto-enable volatility_chooser alias', r1b.enabled === true);

const r2 = resolveConfig({
  volatilitySelector: { enabled: true, label: 'STIL', defaultTierIndex: 2 },
});
t('explicit enabled honored', r2.enabled === true);
t('override label', r2.label === 'STIL');
t('override defaultTierIndex', r2.defaultTierIndex === 2);

const rTiers = resolveConfig({
  volatilitySelector: { enabled: true, tiers: [
    { id: 'a', label: 'A', subtitle: 'frequent' },
    { id: 'a', label: 'A2', subtitle: 'dup' }, // duplicate id
    { id: 'b', label: 'B', subtitle: 'rare' },
  ]},
});
t('dedupes duplicate tier ids', rTiers.tiers.length === 2);

const rCap = resolveConfig({
  volatilitySelector: { enabled: true, tiers: [
    { id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }, { id: 't6' }, { id: 't7' },
  ]},
});
t('caps tiers to 5', rCap.tiers.length === 5);

const rDeg = resolveConfig({
  volatilitySelector: { enabled: true, tiers: [{ id: 'only' }] },
});
t('single-tier collapses (disabled)', rDeg.enabled === false);
t('collapsedToSingleTier flag', rDeg.collapsedToSingleTier === true);

const rIdx = resolveConfig({
  volatilitySelector: { enabled: true, defaultTierIndex: 99, tiers: [
    { id: 'a' }, { id: 'b' },
  ]},
});
t('clamps defaultTierIndex to last valid', rIdx.defaultTierIndex === 1);

const cssOff = emitVolatilitySelectorCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitVolatilitySelectorCSS(r1);
t('CSS has selector class', css.includes('.volatility-selector'));
t('CSS has rail class', css.includes('.vs-rail'));
t('CSS has tier class', css.includes('.vs-tier'));
t('CSS has subtitle class', css.includes('.vs-subtitle'));
t('CSS has focus-visible ring', css.includes('focus-visible'));
t('CSS has aria-checked styling', css.includes('aria-checked="true"'));
t('CSS has locked state', css.includes('data-locked'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile breakpoint', css.includes('@media (max-width: 620px)'));

const markupOff = emitVolatilitySelectorMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');
const markup = emitVolatilitySelectorMarkup(r1);
t('markup has host id', markup.includes('id="volatilitySelector"'));
t('markup has role=radiogroup', markup.includes('role="radiogroup"'));
t('markup has 3 radio roles', (markup.match(/role="radio"/g) || []).length === 3);
t('markup has aria-checked true on default', (markup.match(/aria-checked="true"/g) || []).length === 1);
t('markup has 3 tier labels', markup.includes('LOW') && markup.includes('MED') && markup.includes('HIGH'));
t('markup has subtitle element', markup.includes('id="vsSubtitle"'));
t('markup HTML-escapes label', emitVolatilitySelectorMarkup(resolveConfig({
  volatilitySelector: { enabled: true, label: '<x>' },
})).includes('&lt;x&gt;'));

const rtOff = emitVolatilitySelectorRuntime(defaultConfig());
t('runtime stub disabled', rtOff.includes('disabled'));
const rt = emitVolatilitySelectorRuntime(r1);
t('runtime declares VS_DEFAULT_INDEX', rt.includes('VS_DEFAULT_INDEX'));
t('runtime declares VS_SUBTITLES', rt.includes('VS_SUBTITLES'));
t('runtime has applyTier function', rt.includes('function applyTier'));
t('runtime sets window.VOLATILITY_TIER', rt.includes('window.VOLATILITY_TIER'));
t('runtime sets window.VOLATILITY_TIER_INDEX', rt.includes('window.VOLATILITY_TIER_INDEX'));
t('runtime emits onVolatilityChanged', rt.includes('onVolatilityChanged'));
t('runtime keyboard nav ArrowRight/Left', rt.includes('ArrowRight') && rt.includes('ArrowLeft'));
t('runtime keyboard Home/End', rt.includes("'Home'") && rt.includes("'End'"));
t('runtime locks on onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime unlocks on onFsEnd', rt.includes("HookBus.on('onFsEnd'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
