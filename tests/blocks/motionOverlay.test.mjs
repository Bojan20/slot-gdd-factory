#!/usr/bin/env node
/**
 * tests/blocks/motionOverlay.test.mjs
 *
 * Wave 3 unit test — motionOverlay shared block.
 */

import {
  defaultConfig,
  resolveConfig,
  emitMotionOverlayCSS,
} from '../../src/blocks/motionOverlay.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— motionOverlay block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default shadowAlpha=0.22', dflt.shadowAlpha === 0.22);
t('default streakAlpha=0.10', dflt.streakAlpha === 0.10);
t('default streakSpacingPx=6', dflt.streakSpacingPx === 6);
t('default speedLinesAlpha=0.06', dflt.speedLinesAlpha === 0.06);
t('default speedLineSpeedMs=600', dflt.speedLineSpeedMs === 600);
t('default enableShadow=true', dflt.enableShadow === true);
t('default enableStreaks=true', dflt.enableStreaks === true);
t('default enableSpeedLines=true', dflt.enableSpeedLines === true);

/* 2. resolveConfig override */
const r = resolveConfig({
  motionOverlay: { shadowAlpha: 0.4, streakSpacingPx: 8, enableSpeedLines: false }
});
t('resolve overrides shadowAlpha', r.shadowAlpha === 0.4);
t('resolve overrides streakSpacingPx', r.streakSpacingPx === 8);
t('resolve overrides enableSpeedLines', r.enableSpeedLines === false);
t('resolve keeps default for unspec keys', r.streakAlpha === 0.10);

/* 3. bounds clamping */
const clamped = resolveConfig({
  motionOverlay: { shadowAlpha: 99, streakAlpha: -1, streakSpacingPx: 999 }
});
t('out-of-bounds shadowAlpha ignored', clamped.shadowAlpha === 0.22);
t('negative streakAlpha ignored', clamped.streakAlpha === 0.10);
t('out-of-bounds streakSpacingPx ignored', clamped.streakSpacingPx === 6);

/* 4. emit — all layers */
const css1 = emitMotionOverlayCSS(dflt, {
  surfaceSelector: '.reelCol.is-spinning',
  kindKey: 'rect'
});
t('emit contains surface selector', css1.includes('.reelCol.is-spinning::after'));
t('emit contains ::before for speed lines', css1.includes('.reelCol.is-spinning::before'));
t('emit contains keyframes In rule', css1.includes('@keyframes motionOverlayIn_rect'));
t('emit contains keyframes speed rule', css1.includes('@keyframes motionOverlaySpeedLines_rect'));
t('emit contains reduced-motion media', css1.includes('@media (prefers-reduced-motion: reduce)'));
t('emit contains pointer-events: none', css1.includes('pointer-events: none'));
t('emit contains z-index 5 (after)', css1.includes('z-index: 5'));
t('emit contains z-index 4 (before)', css1.includes('z-index: 4'));

/* 5. unique kindKey isolates animation names */
const css2 = emitMotionOverlayCSS(dflt, {
  surfaceSelector: '.hex-reel-col.is-spinning',
  kindKey: 'hex'
});
t('hex emit has hex-suffixed keyframes', css2.includes('motionOverlayIn_hex'));
t('hex emit does not collide with rect keyframes', !css2.includes('motionOverlayIn_rect'));

/* 6. per-call layer override */
const cssNoSpeed = emitMotionOverlayCSS(dflt, {
  surfaceSelector: '.wheel-frame.is-spinning',
  kindKey: 'wheel',
  layers: { speedLines: false }
});
t('wheel no-speed-lines emit drops ::before', !cssNoSpeed.includes('::before'));
t('wheel no-speed-lines emit drops speed keyframes', !cssNoSpeed.includes('motionOverlaySpeedLines_wheel'));
t('wheel no-speed-lines emit keeps ::after', cssNoSpeed.includes('.wheel-frame.is-spinning::after'));

/* 7. all-off → empty string */
const cssOff = emitMotionOverlayCSS({
  ...dflt, enableShadow: false, enableStreaks: false, enableSpeedLines: false
}, { surfaceSelector: '.x.is-spinning', kindKey: 'x' });
t('all layers off → empty string', cssOff === '');

/* 8. empty selector → empty string */
const cssNoSel = emitMotionOverlayCSS(dflt, { surfaceSelector: '', kindKey: 'x' });
t('empty selector → empty string', cssNoSel === '');

/* 9. kindKey sanitization */
const cssWeird = emitMotionOverlayCSS(dflt, {
  surfaceSelector: '.foo.is-spinning',
  kindKey: 'evil"key)/*'
});
t('kindKey sanitized of non-alnum', cssWeird.includes('motionOverlayIn_evil_key__'));
t('kindKey sanitized leaves no quote chars', !/"/.test(cssWeird));

/* 10. vendor neutrality */
const VENDORS = /(igt|pragmatic|megaways|cleopatra|buffalo|wolf[- ]run|cash[- ]eruption|netent|microgaming|l[& ]?w)/i;
t('emit is vendor-neutral', !VENDORS.test(css1) && !VENDORS.test(css2));

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
