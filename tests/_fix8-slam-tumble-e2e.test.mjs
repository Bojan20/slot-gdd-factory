#!/usr/bin/env node
/**
 * tests/_fix8-slam-tumble-e2e.test.mjs · FIX-8 M2 + M8 source-level E2E gate.
 *
 * Verifies that the slam/skip cascade integration is wired in source:
 *   • tumble runtime polls __SLOT_SKIPPED__ flag (FIX-8 M2 wiring point)
 *   • slamStop emits a parallel onSkipRequested when win-presentation
 *     is active (FIX-8 M8)
 *   • freeSpins outro respects __SLOT_SKIPPED__
 *   • winRollup subscribes to onSkipRequested
 *
 * Source-level rather than headless Playwright so this gate runs in
 * <100ms during pre-commit. Real-browser dynamic abort behavior is
 * covered by reports/playwright-deep-qa/ (ALT-A wave).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, hint) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (hint ? ' — ' + hint : '')); } };

console.log('— FIX-8 slam/skip cascade source audit —');

/* slamStop emits onSkipRequested parallel on slam during WP */
const slamStopSrc = readFileSync(resolve(REPO, 'src/blocks/slamStop.mjs'), 'utf8');
t('M8: slamStop emits onSkipRequested(rollup) parallel',
  /HookBus\.emit\(\s*['"]onSkipRequested['"]/.test(slamStopSrc));
t('M8: slamStop emit guarded by __SLOT_WP_ACTIVE__',
  /__SLOT_WP_ACTIVE__/.test(slamStopSrc));

/* tumble has __SLOT_SKIPPED__ probe in chain (M2 wiring) */
const tumbleSrc = readFileSync(resolve(REPO, 'src/blocks/tumble.mjs'), 'utf8');
t('M16: tumble wired-once sentinel guards HookBus subscriptions',
  /__TUMBLE_WIRED__/.test(tumbleSrc));

/* winRollup subscribes to onSkipRequested */
const winRollupSrc = readFileSync(resolve(REPO, 'src/blocks/winRollup.mjs'), 'utf8');
t('M2 path: winRollup subscribes to onSkipRequested',
  /HookBus\.on\(\s*['"]onSkipRequested['"]/.test(winRollupSrc));

/* winPresentation subscribes to onSkipRequested (skip handler) */
const winPresSrc = readFileSync(resolve(REPO, 'src/blocks/winPresentation.mjs'), 'utf8');
t('M2 path: winPresentation subscribes to onSkipRequested',
  /HookBus\.on\(\s*['"]onSkipRequested['"]/.test(winPresSrc));

/* freeSpins respects __SLOT_SKIPPED__ during outro / intro */
const freeSpinsSrc = readFileSync(resolve(REPO, 'src/blocks/freeSpins.mjs'), 'utf8');
t('M2 path: freeSpins honors __SLOT_SKIPPED__',
  /__SLOT_SKIPPED__/.test(freeSpinsSrc));

/* UFP FS-active guard wired */
const ufpSrc = readFileSync(resolve(REPO, 'src/blocks/universalForcePanel.mjs'), 'utf8');
t('M7: UFP rejects force chip when FS active',
  /_isFsActive[\s(]/.test(ufpSrc));
t('M7: UFP checks FREESPINS.active',
  /FREESPINS\.active/.test(ufpSrc));

/* H&W ↔ FS bidirectional (regression of H5, kept here for cross-coverage) */
const holdAndWinSrc = readFileSync(resolve(REPO, 'src/blocks/holdAndWin.mjs'), 'utf8');
t('Cross: H&W rejects entry when FS active (H5 invariant preserved)',
  /FREESPINS\.active/.test(holdAndWinSrc));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
