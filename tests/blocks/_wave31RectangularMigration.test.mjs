#!/usr/bin/env node
/**
 * tests/blocks/_wave31RectangularMigration.test.mjs
 *
 * W3.1 — Rectangular engine migration to shared motionOverlay block.
 *
 * Pre-W3.1 the rectangular grid had its own inline ::after / ::before
 * streak overlay inside reelEngineCSS.mjs (since pre-W54). W54 landed
 * the shared motionOverlay block for hex / wheel / crash / plinko /
 * slingo but left rect on the legacy inline emit — the two had
 * different knob defaults (rect: 0.04/4/0.20/0.04/150 vs shared
 * 0.10/6/0.22/0.06/600) so a tihi migration would have visually
 * regressed the rect grid.
 *
 * W3.1 closes the gap by:
 *   1. Extending motionOverlay with per-surface `configOverride` opt
 *   2. Registering '.reelCol.is-spinning' in MOTION_OVERLAY_SURFACES
 *      with the pre-W54 knob vintage as the override
 *   3. Dropping the inline overlay block from reelEngineCSS.mjs
 *
 * This test pins the migration so a future refactor can't silently
 * un-do it (reverting to the duplicate inline emit OR forgetting the
 * configOverride and visually regressing the rect grid).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const reelCssSrc   = readFileSync(resolve(here, '../../src/blocks/reelEngineCSS.mjs'), 'utf8');
const motionSrc    = readFileSync(resolve(here, '../../src/blocks/motionOverlay.mjs'), 'utf8');
const orchSrc      = readFileSync(resolve(here, '../../src/buildSlotHTML.mjs'), 'utf8');

const { defaultConfig, emitMotionOverlayCSS } = await import('../../src/blocks/motionOverlay.mjs');
const cssRect = emitMotionOverlayCSS(defaultConfig(), {
  surfaceSelector: '.reelCol.is-spinning',
  kindKey: 'rect',
  configOverride: {
    streakAlpha:      0.04,
    streakSpacingPx:  4,
    shadowAlpha:      0.20,
    speedLinesAlpha:  0.04,
    speedLineSpeedMs: 150,
  },
});

/* ════════════════════════════════════════════════════════════════════
 * 1. reelEngineCSS.mjs no longer emits the overlay block
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngineCSS overlay block removed', () => {
  t('1.1 W3.1 marker comment present in reelEngineCSS',
    /W3\.1/.test(reelCssSrc));
  t('1.2 .reelCol.is-spinning::after rule REMOVED',
    !/\.reelCol\.is-spinning::after\s*\{/.test(reelCssSrc));
  t('1.3 .reelCol.is-spinning::before rule REMOVED',
    !/\.reelCol\.is-spinning::before\s*\{/.test(reelCssSrc));
  t('1.4 @keyframes reelStreakIn REMOVED',
    !/@keyframes\s+reelStreakIn/.test(reelCssSrc));
  t('1.5 @keyframes reelSpeedLines REMOVED',
    !/@keyframes\s+reelSpeedLines/.test(reelCssSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. motionOverlay.mjs supports per-surface configOverride
 * ════════════════════════════════════════════════════════════════════ */
block('2. motionOverlay configOverride API', () => {
  t('2.1 JSDoc documents opts.configOverride',
    /opts\.configOverride/.test(motionSrc));
  t('2.2 W3.1 marker comment present in emitMotionOverlayCSS',
    /W3\.1/.test(motionSrc));
  t('2.3 Source merges override into c via spread (base cfg untouched)',
    /const\s+c\s*=\s*\{\s*\.\.\.baseCfg\s*\}/.test(motionSrc));
  t('2.4 Source whitelists float knobs (shadowAlpha/streakAlpha/speedLinesAlpha)',
    /floatKeys\s*=\s*\[[\s\S]{0,200}shadowAlpha[\s\S]{0,200}streakAlpha[\s\S]{0,200}speedLinesAlpha/.test(motionSrc));
  t('2.5 Source whitelists int knobs (streakSpacingPx/speedLineSpeedMs)',
    /intKeys\s*=\s*\[[\s\S]{0,200}streakSpacingPx[\s\S]{0,200}speedLineSpeedMs/.test(motionSrc));
  t('2.6 Source applies BOUNDS clamp to override values (same as resolveConfig)',
    /BOUNDS\[k\]\[0\][\s\S]{0,200}BOUNDS\[k\]\[1\]/.test(motionSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Orchestrator registers '.reelCol.is-spinning' with the override
 * ════════════════════════════════════════════════════════════════════ */
block('3. MOTION_OVERLAY_SURFACES has rect entry', () => {
  t('3.1 W3.1 marker comment in MOTION_OVERLAY_SURFACES',
    /W3\.1/.test(orchSrc));
  t('3.2 rect entry surfaceSelector .reelCol.is-spinning',
    /surfaceSelector:\s*['"]\.reelCol\.is-spinning['"]/.test(orchSrc));
  t('3.3 rect entry kindKey rect',
    /kindKey:\s*['"]rect['"]/.test(orchSrc));
  t('3.4 configOverride streakAlpha 0.04 (preW3.1 vintage)',
    /streakAlpha:\s*0\.04/.test(orchSrc));
  t('3.5 configOverride streakSpacingPx 4 (preW3.1 vintage)',
    /streakSpacingPx:\s*4/.test(orchSrc));
  t('3.6 configOverride shadowAlpha 0.20 (preW3.1 vintage)',
    /shadowAlpha:\s*0\.20/.test(orchSrc));
  t('3.7 configOverride speedLinesAlpha 0.04 (preW3.1 vintage)',
    /speedLinesAlpha:\s*0\.04/.test(orchSrc));
  t('3.8 configOverride speedLineSpeedMs 150 (preW3.1 vintage)',
    /speedLineSpeedMs:\s*150/.test(orchSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Live emit — full migration round-trip
 * ════════════════════════════════════════════════════════════════════ */
block('4. Live emit round-trip', () => {
  t('4.1 emit contains .reelCol.is-spinning::after',
    cssRect.includes('.reelCol.is-spinning::after'));
  t('4.2 emit bakes streakAlpha 0.04 (pixel parity with pre-W3.1)',
    cssRect.includes('rgba(255,255,255,0.04)'));
  t('4.3 emit bakes shadowAlpha 0.20',
    cssRect.includes('rgba(0,0,0,0.2)'));
  t('4.4 emit bakes speedLinesAlpha 0.04',
    cssRect.includes('rgba(200,220,255,0.04)'));
  t('4.5 emit bakes speedLineSpeedMs 150ms',
    cssRect.includes('150ms linear infinite'));
  t('4.6 emit bakes streakSpacingPx 4 in repeating-linear-gradient',
    /transparent\s+4px/.test(cssRect));
  /* The animation-name uses the rect kindKey so it won't collide with
   * hex/wheel/etc emits in the same stylesheet. */
  t('4.7 emit uses motionOverlayIn_rect keyframe (no collision with other engines)',
    cssRect.includes('motionOverlayIn_rect'));
  t('4.8 emit uses motionOverlaySpeedLines_rect keyframe',
    cssRect.includes('motionOverlaySpeedLines_rect'));
  t('4.9 prefers-reduced-motion gate present (a11y preserved across migration)',
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(cssRect));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('5. Honest scope', () => {
  t('5.1 reelEngineCSS source explains the migration in JSDoc',
    /W3\.1 — Motion overlay migrated to shared motionOverlay\.mjs block/.test(reelCssSrc));
  t('5.2 reelEngineCSS source cites the pre-W3.1 knob vintage values',
    /0\.04[\s\S]{0,100}4[\s\S]{0,100}0\.20[\s\S]{0,100}0\.04[\s\S]{0,100}150/.test(reelCssSrc));
  t('5.3 Orchestrator source documents why the override is needed',
    /preserve[\s\S]{0,200}visual identity/.test(orchSrc) ||
    /visual[\s\S]{0,200}preserve/.test(orchSrc) ||
    /pixel\s*output/.test(orchSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
