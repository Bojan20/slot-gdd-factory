#!/usr/bin/env node
/**
 * tests/blocks/stormMultiplierReel.test.mjs
 *
 * W56 — Auxiliary multiplier reel block test.
 * Closes W49.T5.B GDD corpus RE gap (`aux_reel_multiplier` missing
 * block in cross-features atlas).
 */

import {
  defaultConfig,
  resolveConfig,
  emitStormMultiplierReelCSS,
  emitStormMultiplierReelRuntime,
} from '../../src/blocks/stormMultiplierReel.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— stormMultiplierReel block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false (opt-in only)', dflt.enabled === false);
t('default values = [2,3,5,10]', JSON.stringify(dflt.values) === '[2,3,5,10]');
t('default position=left', dflt.position === 'left');
t('default itemSizePx=64', dflt.itemSizePx === 64);
t('default spinSpeedNormalMs=700', dflt.spinSpeedNormalMs === 700);
t('default spinSpeedTurboMs=400', dflt.spinSpeedTurboMs === 400);
t('default landingMs=700', dflt.landingMs === 700);
t('default showMissGlyph=true', dflt.showMissGlyph === true);
t('default missGlyph=×', dflt.missGlyph === '×');
t('default valueSuffix=x', dflt.valueSuffix === 'x');
t('default role=img', dflt.role === 'img');
t('default ariaLabelPrefix="Multiplier reel"', dflt.ariaLabelPrefix === 'Multiplier reel');

/* 2. defaults returns fresh array (no mutation leak) */
dflt.values.push(999);
const dflt2 = defaultConfig();
t('defaults returns fresh values array (no mutation leak)',
  JSON.stringify(dflt2.values) === '[2,3,5,10]');

/* 3. resolveConfig — enabled toggle */
const enabled = resolveConfig({ stormMultiplierReel: { enabled: true } });
t('resolveConfig honors enabled=true', enabled.enabled === true);

/* 4. resolveConfig — values whitelist */
const customVals = resolveConfig({ stormMultiplierReel: { values: [2, 4, 8, 16, 32] } });
t('resolveConfig honors custom values',
  JSON.stringify(customVals.values) === '[2,4,8,16,32]');

/* 5. resolveConfig — values sanitization (drop bad entries) */
const dirtyVals = resolveConfig({ stormMultiplierReel: { values: [2, 'bad', 5, -1, NaN, 10, 999999] } });
t('resolveConfig sanitizes values (drop bad)',
  JSON.stringify(dirtyVals.values) === '[2,5,10]');

/* 6. resolveConfig — empty / all-bad values → defaults */
const allBad = resolveConfig({ stormMultiplierReel: { values: [] } });
t('resolveConfig empty values → defaults',
  JSON.stringify(allBad.values) === '[2,3,5,10]');
const allBadType = resolveConfig({ stormMultiplierReel: { values: ['a', 'b'] } });
t('resolveConfig all-bad values → defaults',
  JSON.stringify(allBadType.values) === '[2,3,5,10]');

/* 7. resolveConfig — position whitelist */
const posRight = resolveConfig({ stormMultiplierReel: { position: 'right' } });
t('resolveConfig honors position=right', posRight.position === 'right');
const posTop = resolveConfig({ stormMultiplierReel: { position: 'top' } });
t('resolveConfig honors position=top', posTop.position === 'top');
const posBottom = resolveConfig({ stormMultiplierReel: { position: 'bottom' } });
t('resolveConfig honors position=bottom', posBottom.position === 'bottom');
const posBad = resolveConfig({ stormMultiplierReel: { position: 'diagonal' } });
t('resolveConfig invalid position → default left', posBad.position === 'left');

/* 8. resolveConfig — int bounds clamping */
const tooBig = resolveConfig({ stormMultiplierReel: { itemSizePx: 9999 } });
t('resolveConfig itemSizePx out-of-bounds → default', tooBig.itemSizePx === 64);
const tooSmall = resolveConfig({ stormMultiplierReel: { itemSizePx: 1 } });
t('resolveConfig itemSizePx out-of-bounds (low) → default', tooSmall.itemSizePx === 64);
const ok = resolveConfig({ stormMultiplierReel: { itemSizePx: 100 } });
t('resolveConfig itemSizePx valid → applied', ok.itemSizePx === 100);

/* 9. resolveConfig — themeClass sanitization (no CSS/script injection) */
const evil = resolveConfig({ stormMultiplierReel: { themeClass: 'lightning;}body{display:none' } });
t('resolveConfig themeClass strips CSS-injection chars',
  !/;|\{|\}|:/.test(evil.themeClass));

/* 10. emitCSS — disabled → empty string */
const cssOff = emitStormMultiplierReelCSS(defaultConfig());
t('emitCSS disabled → empty string', cssOff === '');

/* 11. emitCSS — enabled vertical */
const cssVert = emitStormMultiplierReelCSS(resolveConfig({
  stormMultiplierReel: { enabled: true, position: 'left' }
}));
t('emitCSS contains .srm-host class', cssVert.includes('.srm-host'));
t('emitCSS contains .srm-strip class', cssVert.includes('.srm-strip'));
t('emitCSS contains .srm-item class', cssVert.includes('.srm-item'));
t('emitCSS contains .srm-miss class', cssVert.includes('.srm-miss'));
t('emitCSS uses translateY for vertical', cssVert.includes('translateY('));
t('emitCSS contains @keyframes srmScroll', cssVert.includes('@keyframes srmScroll'));
t('emitCSS contains reduced-motion media query',
  cssVert.includes('@media (prefers-reduced-motion: reduce)'));
t('emitCSS reduced-motion kills animation',
  /prefers-reduced-motion[\s\S]+animation: none/.test(cssVert));
t('emitCSS uses pointer-events: none', cssVert.includes('pointer-events: none'));

/* 12. emitCSS — horizontal layout uses translateX */
const cssHoriz = emitStormMultiplierReelCSS(resolveConfig({
  stormMultiplierReel: { enabled: true, position: 'top' }
}));
t('emitCSS uses translateX for horizontal', cssHoriz.includes('translateX('));

/* 13. emitRuntime — disabled → empty */
const rtOff = emitStormMultiplierReelRuntime(defaultConfig());
t('emitRuntime disabled → empty string', rtOff === '');

/* 14. emitRuntime — enabled contains lifecycle wiring */
const rt = emitStormMultiplierReelRuntime(resolveConfig({
  stormMultiplierReel: { enabled: true }
}));
t('emitRuntime contains preSpin listener', rt.includes("HookBus.on('preSpin'"));
t('emitRuntime contains onSpinResult listener', rt.includes("HookBus.on('onSpinResult'"));
t('emitRuntime contains postSpin listener', rt.includes("HookBus.on('postSpin'"));
t('emitRuntime contains onSlamStop listener', rt.includes("HookBus.on('onSlamStop'"));

/* 15. emitRuntime — sole-owner emit contract */
t('emitRuntime emits onStormMultiplierStart (sole)',
  rt.includes("HookBus.emit('onStormMultiplierStart'"));
t('emitRuntime emits onStormMultiplierStop (sole)',
  rt.includes("HookBus.emit('onStormMultiplierStop'"));

/* 16. emitRuntime — force-chip contract per rule_force_buttons_real_spin */
t('emitRuntime exposes window.stormMultiplierForceAt',
  rt.includes('window.stormMultiplierForceAt'));
t('emitRuntime force chip sets __FORCE_STORM_MULTIPLIER__ flag',
  rt.includes('__FORCE_STORM_MULTIPLIER__'));
t('emitRuntime force chip calls runOneBaseSpin (NOT a direct stopSpin shortcut)',
  rt.includes('runOneBaseSpin') && !/force.*stopSpin\s*\(/i.test(rt));

/* 17. emitRuntime — force chip flag CONSUMED in onSpinResult (no leak across spins) */
t('emitRuntime consumes __FORCE_STORM_MULTIPLIER__ flag after use',
  /__FORCE_STORM_MULTIPLIER__\s*=\s*undefined/.test(rt));

/* 18. emitRuntime — math-blind contract (no internal weighting) */
t('emitRuntime has NO internal RNG / probability draw',
  !/Math\.random|weightedDraw|cumulative.*prob|drawValue/i.test(rt));

/* 19. emitRuntime — vendor neutrality (NO Wrath / Olympus / IGT / Lightning Link string) */
const VENDORS = /(wrath\s*of\s*olympus|lightning\s*link|igt|pragmatic|aristocrat|netent|microgaming)/i;
t('emitRuntime vendor-neutral', !VENDORS.test(rt));
t('emitCSS vertical vendor-neutral', !VENDORS.test(cssVert));

/* 20. emitRuntime — ARIA contract */
t('emitRuntime sets ARIA role', rt.includes("setAttribute('role'"));
t('emitRuntime sets ARIA label dynamically', rt.includes("setAttribute('aria-label'"));

/* 21. CSS — landing transition cubic-bezier (industry standard ease-out) */
t('emitCSS landing uses cubic-bezier ease-out', cssVert.includes('cubic-bezier'));

/* 22. CSS — turbo class accelerates animation */
t('emitCSS turbo class overrides animation-duration',
  cssVert.includes('.srm-host.is-spinning.is-turbo') && cssVert.includes('animation-duration'));

/* 23. JSDoc — purpose / industry-ref / public API / lifecycle / GDD keys present */
const src = (await import('node:fs')).readFileSync(
  new URL('../../src/blocks/stormMultiplierReel.mjs', import.meta.url), 'utf8');
t('JSDoc declares aux_reel_multiplier kind reference',
  src.includes('aux_reel_multiplier'));
t('JSDoc cites W49.T5.B gap closure',
  src.includes('W49.T5.B'));
t('JSDoc declares math gate honesty (rule_no_math_unless_asked)',
  src.includes('rule_no_math_unless_asked'));
t('JSDoc declares force chip contract (rule_force_buttons_real_spin)',
  src.includes('rule_force_buttons_real_spin'));
t('JSDoc enumerates GDD knobs',
  /GDD knobs/.test(src) && /enabled[\s\S]+values[\s\S]+position/.test(src));
t('JSDoc enumerates Lifecycle hook attachments',
  /Lifecycle/.test(src) && /preSpin[\s\S]+onSpinResult[\s\S]+postSpin/.test(src));

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
if (fail > 0) process.exit(1);
