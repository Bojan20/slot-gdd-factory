/**
 * tests/blocks/cumulativeMeter.test.mjs
 * Wave LEGO-COLLECT (B-4 · 2/3)
 */
import {
  defaultConfig, resolveConfig,
  emitCumulativeMeterCSS, emitCumulativeMeterMarkup, emitCumulativeMeterRuntime,
} from '../../src/blocks/cumulativeMeter.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== cumulativeMeter block (LEGO-COLLECT B-4 · 2/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label COINS', d.label === 'COINS');
t('default resetMode subtract', d.resetMode === 'subtract');
t('default 3 thresholds', d.thresholds.length === 3);
t('default tier 0 bronze 50', d.thresholds[0].id === 'bronze' && d.thresholds[0].value === 50);
t('default tier 2 gold fs_trigger', d.thresholds[2].id === 'gold' && d.thresholds[2].awardKind === 'fs_trigger');
t('frozen thresholds', Object.isFrozen(d.thresholds));

const r1 = resolveConfig({ features: [{ kind: 'cumulative_meter' }] });
t('auto-enable cumulative_meter', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'collect_meter' }] });
t('auto-enable collect_meter alias', r1b.enabled === true);

const r2 = resolveConfig({
  cumulativeMeter: { enabled: true, label: 'ORBS', resetMode: 'full' },
});
t('explicit enabled honored', r2.enabled === true);
t('override label', r2.label === 'ORBS');
t('override resetMode full', r2.resetMode === 'full');

const r3 = resolveConfig({
  cumulativeMeter: { enabled: true, resetMode: 'invalid_mode' },
});
t('invalid resetMode falls back', r3.resetMode === 'subtract');

const rThresh = resolveConfig({
  cumulativeMeter: { enabled: true, thresholds: [
    { id: 'b', value: 1000, awardKind: 'credit', awardValue: 500 },
    { id: 'a', value: 100, awardKind: 'credit', awardValue: 50 },
    { id: 'a', value: 200, awardKind: 'multiplier', awardValue: 3 }, // duplicate
  ]},
});
t('thresholds sorted ascending', rThresh.thresholds[0].value === 100 && rThresh.thresholds[1].value === 1000);
t('dedupes duplicate threshold ids', rThresh.thresholds.length === 2);

const rClamp = resolveConfig({
  cumulativeMeter: { enabled: true, thresholds: [
    { id: 'a', value: -50, awardKind: 'credit', awardValue: 25 },
    { id: 'b', value: 999999999999, awardKind: 'invalid_kind', awardValue: 'oops' },
  ]},
});
t('clamp threshold value ≥ 1', rClamp.thresholds[0].value === 1);
t('clamp threshold value ≤ 1M', rClamp.thresholds[1].value === 1000000);
t('invalid awardKind falls back', rClamp.thresholds[1].awardKind === 'credit');

const cssOff = emitCumulativeMeterCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitCumulativeMeterCSS(r1);
t('CSS has cumulative-meter class', css.includes('.cumulative-meter'));
t('CSS has meter-bar + meter-fill', css.includes('.meter-bar') && css.includes('.meter-fill'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile breakpoint', css.includes('@media (max-width: 620px)'));

const markupOff = emitCumulativeMeterMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');
const markup = emitCumulativeMeterMarkup(r1);
t('markup has progressbar role', markup.includes('role="progressbar"'));
t('markup has aria-valuenow', markup.includes('aria-valuenow="0"'));
t('markup has aria-valuemax', markup.includes('aria-valuemax="50"'));
t('markup has aria-valuetext', markup.includes('aria-valuetext="0 of 50"'));
t('markup has fill element', markup.includes('id="cumulativeMeterFill"'));
t('markup HTML-escapes label', emitCumulativeMeterMarkup(resolveConfig({
  cumulativeMeter: { enabled: true, label: '<x>' },
})).includes('&lt;x&gt;'));

const rtOff = emitCumulativeMeterRuntime(defaultConfig());
t('runtime stub disabled', rtOff.includes('disabled'));
const rt = emitCumulativeMeterRuntime(r1);
t('runtime declares CM_THRESHOLDS', rt.includes('CM_THRESHOLDS'));
t('runtime declares CM_RESET_MODE', rt.includes('CM_RESET_MODE'));
t('runtime has nextThreshold function', rt.includes('function nextThreshold'));
t('runtime has render function', rt.includes('function render'));
t('runtime listens onCoinCollected', rt.includes("HookBus.on('onCoinCollected'"));
t('runtime emits onCumulativeMeterThresholdHit', rt.includes('onCumulativeMeterThresholdHit'));
t('runtime emits onCumulativeMeterReset', rt.includes('onCumulativeMeterReset'));
t('runtime supports full resetMode', rt.includes("'full'"));
t('runtime supports subtract resetMode', rt.includes("'subtract'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
