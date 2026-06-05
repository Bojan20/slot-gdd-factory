#!/usr/bin/env node
/**
 * FS-intro grid-hide probe — verifies H5.18 fix for Boki rule
 * 05.06.2026: "Fs reel grid ili grid bilo kog bonusa ne sme da se
 * pojavi u pozadini dok je plaketa za fs intro prikazana na ekranu.
 * tek kada pritisnem tap to begin, tada se fadinuju reel frame sa
 * svim celijama itd itd, za fs i bilo koji bonus feature."
 *
 * Three phases per demo:
 *   A. INTRO  — placard visible, body has is-feature-intro-active,
 *               .frame computed style: opacity 0 + visibility hidden
 *   B. CLICK  — TAP TO BEGIN clicked; body swaps to
 *               is-feature-intro-fadein; .frame ANIMATES from 0 → 1
 *   C. ACTIVE — animation completes (700ms); classes cleared,
 *               .frame back at full opacity:1 visibility:visible
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5235;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',      path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
];

const out = [];

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0,200)));
    page.on('console', m => { if (m.type()==='error') errors.push('CON ' + m.text().slice(0,200)); });
    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // ── Trigger FS intro via devFsBtn ──────────────────────────────
    const result = await page.evaluate(async () => {
      const devFs = document.getElementById('devFsBtn');
      if (!devFs || devFs.disabled) return { error: 'FS btn not available' };
      devFs.click();
      // Poll until intro placard is actually shown (max 8s)
      const t0 = performance.now();
      while (performance.now() - t0 < 8000) {
        const o = document.querySelector('.fs-overlay');
        if (o && o.classList.contains('fs-overlay--show')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      // Wait long enough for the 300ms hide transition + visibility delay
      // (visibility transition has a 300ms linear delay before flipping to hidden)
      await new Promise(r => setTimeout(r, 700));

      // ── A. INTRO PHASE ──
      const frame    = document.querySelector('.frame');
      const sideHud  = document.querySelector('.sideHud');
      const overlay  = document.querySelector('.fs-overlay');
      const introBody = {
        hasIntroActive: document.body.classList.contains('is-feature-intro-active'),
        hasIntroFadein: document.body.classList.contains('is-feature-intro-fadein'),
        overlayShown:   !!overlay?.classList?.contains('fs-overlay--show'),
      };
      const introFrame = {
        opacity:    getComputedStyle(frame).opacity,
        visibility: getComputedStyle(frame).visibility,
      };
      const introSideHud = sideHud ? {
        opacity:    getComputedStyle(sideHud).opacity,
        visibility: getComputedStyle(sideHud).visibility,
      } : null;

      // ── B. CLICK TAP TO BEGIN ──
      const cta = document.getElementById('fsPlacardCta');
      if (!cta) return { ...introBody, error: 'no CTA' };
      const tClick = performance.now() | 0;
      cta.click();

      // Sample @ 100ms (mid-fadein) and @ 800ms (post-fadein)
      await new Promise(r => setTimeout(r, 100));
      const midFadein = {
        hasIntroActive: document.body.classList.contains('is-feature-intro-active'),
        hasIntroFadein: document.body.classList.contains('is-feature-intro-fadein'),
        frameOpacity:   getComputedStyle(frame).opacity,
        frameVisibility: getComputedStyle(frame).visibility,
      };

      await new Promise(r => setTimeout(r, 800));
      const postFadein = {
        hasIntroActive: document.body.classList.contains('is-feature-intro-active'),
        hasIntroFadein: document.body.classList.contains('is-feature-intro-fadein'),
        frameOpacity:   getComputedStyle(frame).opacity,
        frameVisibility: getComputedStyle(frame).visibility,
      };

      return {
        intro: { ...introBody, ...introFrame, sideHud: introSideHud },
        midFadein,
        postFadein,
      };
    });

    const checks = [
      // INTRO phase — frame must be hidden
      ['INTRO: body has is-feature-intro-active',     result.intro?.hasIntroActive === true],
      ['INTRO: overlay visible',                       result.intro?.overlayShown === true],
      ['INTRO: frame opacity = 0',                     result.intro?.opacity === '0'],
      ['INTRO: frame visibility = hidden',             result.intro?.visibility === 'hidden'],

      // MID FADEIN — class swap happened
      ['MID: is-feature-intro-active cleared',         result.midFadein?.hasIntroActive === false],
      ['MID: is-feature-intro-fadein active',          result.midFadein?.hasIntroFadein === true],
      ['MID: frame visibility = visible',              result.midFadein?.frameVisibility === 'visible'],
      ['MID: frame opacity in [0.1, 1] (animating)',   parseFloat(result.midFadein?.frameOpacity) >= 0.1],

      // POST FADEIN — classes cleared, full opacity
      ['POST: both classes cleared',
        result.postFadein?.hasIntroActive === false && result.postFadein?.hasIntroFadein === false],
      ['POST: frame opacity = 1',                      parseFloat(result.postFadein?.frameOpacity) === 1],
      ['POST: frame visibility = visible',             result.postFadein?.frameVisibility === 'visible'],

      // Errors
      ['no console / page errors',                     errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, result, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ FS-INTRO GRID-HIDE PROBE (Wave H5.18) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  INTRO:    classes=active overlay=${r.result.intro?.overlayShown} frame opacity=${r.result.intro?.opacity} visibility=${r.result.intro?.visibility}`);
  console.log(`  MID:      classes(active=${r.result.midFadein?.hasIntroActive} fadein=${r.result.midFadein?.hasIntroFadein}) frame opacity=${r.result.midFadein?.frameOpacity}`);
  console.log(`  POST:     classes(active=${r.result.postFadein?.hasIntroActive} fadein=${r.result.postFadein?.hasIntroFadein}) frame opacity=${r.result.postFadein?.frameOpacity}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
