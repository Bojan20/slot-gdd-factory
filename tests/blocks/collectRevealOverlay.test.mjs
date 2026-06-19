/**
 * tests/blocks/collectRevealOverlay.test.mjs
 * Wave LEGO-COLLECT (B-4 · 3/3)
 */
import {
  defaultConfig, resolveConfig,
  emitCollectRevealOverlayCSS, emitCollectRevealOverlayMarkup, emitCollectRevealOverlayRuntime,
} from '../../src/blocks/collectRevealOverlay.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== collectRevealOverlay block (LEGO-COLLECT B-4 · 3/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label COLLECT REWARD', d.label === 'COLLECT REWARD');
t('default autoDismiss 0 (manual claim)', d.autoDismissMs === 0);
t('default 5 tier names', d.tierNames.length === 5);
t('default tier 0 BRONZE', d.tierNames[0] === 'BRONZE');
t('default tier 2 GOLD', d.tierNames[2] === 'GOLD');
t('default ctaLabel CLAIM', d.ctaLabel === 'CLAIM');

const r1 = resolveConfig({ features: [{ kind: 'collect_reveal' }] });
t('auto-enable collect_reveal', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'cumulative_meter' }] });
t('auto-enable cumulative_meter complement', r1b.enabled === true);
const r1c = resolveConfig({ features: [{ kind: 'collect_meter' }] });
t('auto-enable collect_meter complement', r1c.enabled === true);

const r2 = resolveConfig({
  collectRevealOverlay: { enabled: true, label: 'BIG WIN!', autoDismissMs: 3000, ctaLabel: 'NEXT' },
});
t('explicit enabled honored', r2.enabled === true);
t('override label', r2.label === 'BIG WIN!');
t('override autoDismissMs', r2.autoDismissMs === 3000);
t('override ctaLabel', r2.ctaLabel === 'NEXT');

const rTiers = resolveConfig({
  collectRevealOverlay: { enabled: true, tierNames: ['ALFA', 'BETA', 'GAMA'] },
});
t('override tierNames', rTiers.tierNames[0] === 'ALFA' && rTiers.tierNames.length === 3);

const rBad = resolveConfig({
  collectRevealOverlay: { enabled: true, autoDismissMs: 99999, tierNames: ['', null, 'OK'] },
});
t('clamp autoDismissMs ≤ 60000', rBad.autoDismissMs === 60000);
t('invalid tier names fallback to TIER', rBad.tierNames[0] === 'TIER');

const cssOff = emitCollectRevealOverlayCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitCollectRevealOverlayCSS(r1);
t('CSS has backdrop class', css.includes('.collect-reveal-backdrop'));
t('CSS has card class', css.includes('.collect-reveal-card'));
t('CSS has tier class', css.includes('.collect-reveal-tier'));
t('CSS has cta class', css.includes('.collect-reveal-cta'));
t('CSS has focus-visible ring', css.includes('focus-visible'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile breakpoint', css.includes('@media (max-width: 620px)'));

const markupOff = emitCollectRevealOverlayMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');
const markup = emitCollectRevealOverlayMarkup(r1);
t('markup has backdrop', markup.includes('id="collectRevealBackdrop"'));
t('markup has card', markup.includes('id="collectRevealCard"'));
t('markup has role=alertdialog', markup.includes('role="alertdialog"'));
t('markup has aria-live=assertive', markup.includes('aria-live="assertive"'));
t('markup has aria-labelledby', markup.includes('aria-labelledby="collectRevealTier"'));
t('markup has CTA button', markup.includes('id="collectRevealCta"'));
t('markup HTML-escapes label', emitCollectRevealOverlayMarkup(resolveConfig({
  collectRevealOverlay: { enabled: true, label: '<x>' },
})).includes('&lt;x&gt;'));

const rtOff = emitCollectRevealOverlayRuntime(defaultConfig());
t('runtime stub disabled', rtOff.includes('disabled'));
const rt = emitCollectRevealOverlayRuntime(r1);
t('runtime declares CRO_TIER_NAMES', rt.includes('CRO_TIER_NAMES'));
t('runtime declares CRO_AUTO_DISMISS', rt.includes('CRO_AUTO_DISMISS'));
t('runtime has formatAward function', rt.includes('function formatAward'));
t('runtime has open function', rt.includes('function open'));
t('runtime has claim function', rt.includes('function claim'));
t('runtime listens onCumulativeMeterThresholdHit', rt.includes("HookBus.on('onCumulativeMeterThresholdHit'"));
t('runtime emits onCollectRevealOpened', rt.includes('onCollectRevealOpened'));
t('runtime emits onCollectRevealClaimed', rt.includes('onCollectRevealClaimed'));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime keyboard Escape/Enter/Space', rt.includes("'Escape'") && rt.includes("'Enter'") && rt.includes("' '"));
t('runtime supports all 4 award kinds', rt.includes("'credit'") && rt.includes("'multiplier'")
                                       && rt.includes("'scatter'") && rt.includes("'fs_trigger'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
