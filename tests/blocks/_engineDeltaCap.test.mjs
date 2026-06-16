#!/usr/bin/env node
/**
 * tests/blocks/_engineDeltaCap.test.mjs
 *
 * Wave W57.A1 — MAX_DELTA_MS=50 spiral-of-death cap pin test.
 *
 * Validates that reelEngine + hexReelEngine bake a per-frame delta
 * guard so background-tab throttling / OS sleep / devtools-paused rAF
 * resumes can't accumulate a multi-second offset in one tick. Pattern
 * source: agents/research-pool/woo-reels-RE.md §6 + engine-architect
 * W57 audit verdict.
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
const reelSrc = readFileSync(resolve(here, '../../src/blocks/reelEngine.mjs'), 'utf8');
const hexSrc  = readFileSync(resolve(here, '../../src/blocks/hexReelEngine.mjs'), 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. reelEngine.mjs delta cap
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngine.mjs MAX_DELTA_MS guard', () => {
  t('1.1 W57.A1 marker comment present',          /W57\.A1/.test(reelSrc));
  t('1.2 __reelLastTickWall declared inside tick scope',
    /let\s+__reelLastTickWall\s*=\s*0/.test(reelSrc));
  t('1.3 delta cap literal 50 ms used',           /__delta\s*>\s*50/.test(reelSrc));
  t('1.4 oversize-delta path re-arms rAF and returns',
    /__delta\s*>\s*50[\s\S]{0,400}__reelLastTickWall\s*=\s*__now[\s\S]{0,200}spinTicker\s*=\s*requestAnimationFrame\(tick\)[\s\S]{0,80}return/.test(reelSrc));
  t('1.5 wall-clock source prefers performance.now',
    /performance\.now\(\)/.test(reelSrc) && /Date\.now\(\)/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. hexReelEngine.mjs delta cap
 * ════════════════════════════════════════════════════════════════════ */
block('2. hexReelEngine.mjs MAX_DELTA_MS guard', () => {
  t('2.1 W57.A1 marker comment present',          /W57\.A1/.test(hexSrc));
  t('2.2 __hexLastTickWall declared',             /var\s+__hexLastTickWall\s*=\s*0/.test(hexSrc));
  t('2.3 delta cap literal 50 ms used',           /__hd\s*>\s*50/.test(hexSrc));
  t('2.4 oversize-delta path re-arms hexTicker and returns',
    /__hd\s*>\s*50[\s\S]{0,400}__hexLastTickWall\s*=\s*now[\s\S]{0,200}hexTicker\s*=\s*requestAnimationFrame\(hexTickAll\)[\s\S]{0,80}return/.test(hexSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Honest scope — crashSpinEngine intentionally excluded
 * ════════════════════════════════════════════════════════════════════ */
block('3. Honest scope (crashSpinEngine excluded)', () => {
  /* The W57 audit verdict listed crashSpinEngine alongside the rAF
   * engines, but its _counterTick already auto-clamps progress via
   * `Math.min(1, …)`. Adding a delta cap there would be redundant
   * noise. This test pins the design decision so it's not silently
   * reverted: crashSpinEngine.mjs has NO __crashLastTickWall guard. */
  const crashSrc = readFileSync(resolve(here, '../../src/blocks/crashSpinEngine.mjs'), 'utf8');
  t('3.1 crashSpinEngine has no W57.A1 marker (intentional)',
    !/W57\.A1/.test(crashSrc));
  t('3.2 crashSpinEngine still uses Math.min(1, t) progress clamp (the existing safety)',
    /Math\.min\(\s*1\s*,/.test(crashSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. KB citation — woo-reels-RE.md §6 pattern source
 * ════════════════════════════════════════════════════════════════════ */
block('4. Pattern source citation', () => {
  t('4.1 reelEngine references the spiral-of-death pattern by name',
    /spiral-of-death/i.test(reelSrc));
  t('4.2 hexReelEngine references the spiral-of-death pattern by name',
    /spiral-of-death/i.test(hexSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
