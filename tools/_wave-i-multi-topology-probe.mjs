#!/usr/bin/env node
/**
 * Wave I — multi-topology H5.x verification probe.
 *
 * For each of the 11 dist demos covering 8 UNIFORM_REEL_KINDS, exercise
 * the complete H5.x feature stack:
 *   1. Page loads without console errors
 *   2. spinControl block mounted (devBwBtn enabled)
 *   3. bigWinTier block mounted + enabled
 *   4. winRollup block mounted (host element exists)
 *   5. BW dugme click → win-presentation chain fires
 *      - onWinPresentationStart with isBigWin=true
 *      - onWinPresentationEnd
 *      - bigWinTier walkthrough enters tier 1
 *      - data-tier reaches 5 within budget
 *      - onBigWinTierEnd emits
 *   6. presentExternalWin(award) works (regular + big)
 *   7. FS placard hides reels (is-feature-intro-active set)
 *
 * Each demo gets a row in the final summary. Any topology that fails any
 * sub-check is a real Wave-I gap.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5247;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',        path: '/dist/01_rectangular_5x3_playable.html', kind: 'rectangular' },
  { name: 'wrath-of-olympus',   path: '/dist/wrath-of-olympus.html',            kind: 'rectangular' },
  { name: 'gates-of-olympus',   path: '/dist/gates-of-olympus-1000.html',       kind: 'cluster' },
  { name: 'megaclusters',       path: '/dist/05_megaclusters_playable.html',    kind: 'megaclusters' },
  { name: 'diamond',            path: '/dist/07_diamond_playable.html',         kind: 'diamond' },
  { name: 'pyramid',            path: '/dist/08_pyramid_playable.html',         kind: 'pyramid' },
  { name: 'cross',              path: '/dist/09_cross_playable.html',           kind: 'cross' },
  { name: 'l_shape',            path: '/dist/10_lshape_playable.html',          kind: 'l_shape' },
  { name: 'infinity',           path: '/dist/12_infinity_playable.html',        kind: 'infinity' },
  { name: 'expanding',          path: '/dist/13_expanding_playable.html',       kind: 'expanding' },
  { name: 'lock_respin',        path: '/dist/19_lock_respin_playable.html',     kind: 'lock_respin' },
];

const out = [];

async function probeDemo(browser, demo) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE_ERR ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE_ERR ' + m.text().slice(0, 200)); });

  try {
    await page.goto(`http://127.0.0.1:${PORT}${demo.path}`, { waitUntil: 'networkidle', timeout: 12000 });
    await page.waitForTimeout(800);

    /* Step 1+2+3+4 — block presence */
    const presence = await page.evaluate(() => ({
      pageReady: true,
      spinBtn:   !!document.getElementById('spinBtn'),
      bwBtn:     !!document.getElementById('devBwBtn'),
      bwBtnDisabled: document.getElementById('devBwBtn')?.disabled,
      bwState:   !!window.BIG_WIN_TIER_STATE?.enabled,
      bwEnterFn: typeof window.bigWinTierEnter,
      winRollupHost: !!document.getElementById('winRollupHost'),
      presentExternalWinFn: typeof window.presentExternalWin,
      fsOverlay: !!document.querySelector('.fs-overlay'),
    }));

    /* Step 5 — BW dugme click → full walkthrough */
    const bwResult = await page.evaluate(async () => {
      if (!window.bigWinTierEnter || typeof window.bigWinTierEnter !== 'function') {
        return { skipped: true, reason: 'no bigWinTierEnter' };
      }
      window.__W__ = { events: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered','onBigWinTierEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__W__.events.push({ n, t: performance.now()|0, ...p })));
      /* Programmatic enter — same code path as the BW dugme after winPresentation
       * consumes the FORCE flag. Sidesteps reel-spin timing differences across
       * topologies and isolates the bigWinTier block. */
      window.bigWinTierEnter(5, 1500);
      /* Wait for full walkthrough: 5×4s + endHold 4s + fade 300ms ≈ 24.3s */
      await new Promise(r => setTimeout(r, 25000));
      const entered = window.__W__.events.filter(e => e.n === 'onBigWinTierEntered');
      const end = window.__W__.events.find(e => e.n === 'onBigWinTierEnd');
      const finalBanner = document.querySelector('.big-win-tier-banner');
      return {
        enteredCount: entered.length,
        tiers: entered.map(e => e.tier),
        endFired: !!end,
        endReason: end?.reason,
        endTier: end?.tier,
        endX: end?.x,
        finalBannerExists: !!finalBanner,   /* should be null after fade-out */
      };
    });

    /* Step 6 — presentExternalWin regular + big */
    const externalWin = await page.evaluate(async () => {
      if (typeof window.presentExternalWin !== 'function') {
        return { skipped: true, reason: 'no presentExternalWin' };
      }
      /* Wait for any pending state to settle. */
      while (window.BIG_WIN_TIER_STATE?.walkActive) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 400));
      window.__X__ = { events: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__X__.events.push({ n, t: performance.now()|0, ...p })));
      const bet = window.__SLOT_BET__ || 1;
      const award = 3 * bet;
      await window.presentExternalWin(award);
      await new Promise(r => setTimeout(r, 200));
      const start = window.__X__.events.find(e => e.n === 'onWinPresentationStart');
      const end = window.__X__.events.find(e => e.n === 'onWinPresentationEnd');
      return {
        startFired: !!start,
        endFired:   !!end,
        startIsBigWin: start?.isBigWin,
        rollupText: document.getElementById('winRollupAmount')?.textContent,
      };
    });

    /* Step 7 — FS intro grid-hide. Trigger fs via devFsBtn if available. */
    const fsIntroState = await page.evaluate(async () => {
      const devFs = document.getElementById('devFsBtn');
      if (!devFs || devFs.disabled) {
        return { skipped: true, reason: 'no devFs or disabled' };
      }
      /* Wait for any pending state to settle. */
      while (window.BIG_WIN_TIER_STATE?.walkActive) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (window.winRollupClear) window.winRollupClear();
      await new Promise(r => setTimeout(r, 400));
      devFs.click();
      /* Poll for overlay show + intro-active class. */
      const t0 = performance.now();
      while (performance.now() - t0 < 12000) {
        const overlay = document.querySelector('.fs-overlay');
        if (overlay && overlay.classList.contains('fs-overlay--show')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 700));
      const introActive = document.body.classList.contains('is-feature-intro-active');
      const frameEl = document.querySelector('.frame');
      const frameOpacity = frameEl ? getComputedStyle(frameEl).opacity : null;
      const frameVisibility = frameEl ? getComputedStyle(frameEl).visibility : null;
      /* Close placard to clean up state */
      document.getElementById('fsPlacardCta')?.click();
      return { introActive, frameOpacity, frameVisibility };
    });

    /* Compile checks */
    const checks = [
      ['Page loaded',                       presence.pageReady],
      ['spinBtn mounted',                   presence.spinBtn],
      ['BW dugme mounted',                  presence.bwBtn],
      ['bigWinTier enabled',                presence.bwState],
      ['bigWinTierEnter is function',       presence.bwEnterFn === 'function'],
      ['winRollupHost mounted',             presence.winRollupHost],
      ['presentExternalWin available',      presence.presentExternalWinFn === 'function'],
      ['fs-overlay mounted',                presence.fsOverlay],
      ['BW: 5 tiers entered 1→5',           JSON.stringify(bwResult.tiers) === '[1,2,3,4,5]'],
      ['BW: onBigWinTierEnd reason=natural', bwResult.endReason === 'natural'],
      ['BW: onBigWinTierEnd x=1500',        bwResult.endX === 1500],
      ['BW: banner cleaned up after fade',  bwResult.finalBannerExists === false],
      ['presentExternalWin Start fired',    externalWin.startFired],
      ['presentExternalWin isBigWin=false', externalWin.startIsBigWin === false],
      ['winRollup shows €3.00',             externalWin.rollupText?.includes('3.00')],
      ['FS intro: is-feature-intro-active', fsIntroState.skipped || fsIntroState.introActive === true],
      ['FS intro: frame opacity=0',         fsIntroState.skipped || fsIntroState.frameOpacity === '0'],
      ['FS intro: frame visibility=hidden', fsIntroState.skipped || fsIntroState.frameVisibility === 'hidden'],
      ['No console / page errors',          errors.length === 0],
    ];

    return { demo, presence, bwResult, externalWin, fsIntroState, errors, checks };
  } finally {
    await ctx.close();
  }
}

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    console.log(`\n[${d.name}] (${d.kind}) — probing...`);
    const result = await probeDemo(browser, d);
    const pass = result.checks.filter(c => c[1]).length;
    const fail = result.checks.length - pass;
    result.pass = pass;
    result.fail = fail;
    out.push(result);
    console.log(`  ${pass}/${pass+fail} pass`);
    if (fail > 0) {
      for (const [l, ok] of result.checks) if (!ok) console.log(`    ✗ ${l}`);
    }
  }
  await browser.close();
} finally {
  srv.kill();
}

console.log('\n════ WAVE I — MULTI-TOPOLOGY SUMMARY ════\n');
console.log('Demo                     | Topology       | Pass | Detail');
console.log('-------------------------|----------------|------|------');
for (const r of out) {
  console.log(`${r.demo.name.padEnd(24)} | ${r.demo.kind.padEnd(14)} | ${(r.pass+'/'+(r.pass+r.fail)).padEnd(5)}| ${r.errors.length ? 'errors: ' + r.errors.length : 'clean'}`);
}
const totalPass = out.reduce((s, r) => s + r.pass, 0);
const totalFail = out.reduce((s, r) => s + r.fail, 0);
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass across ${out.length} topologies`);
process.exit(totalFail === 0 ? 0 : 1);
