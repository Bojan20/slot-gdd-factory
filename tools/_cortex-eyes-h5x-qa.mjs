#!/usr/bin/env node
/**
 * Cortex Eyes — full H5.x QA review.
 * Captures screenshots at every key moment of the BW + FS flows on
 * rectangular dist so Boki can visually review:
 *   01_idle.png                  — base game idle
 *   02_bw_after_spin.png         — BW dugme posle spin, simbol pulse 800ms
 *   03_bw_tier1.png              — tier 1 banner
 *   04_bw_tier3.png              — tier 3 banner mid-walkthrough
 *   05_bw_tier5_climax.png       — tier 5 climax sa €1500.00 counter
 *   06_bw_endhold.png            — endHold pre fade-out
 *   07_fs_intro_placard.png      — FS placard sa hidden grid u pozadini
 *   08_fs_mid_fadein.png         — frame mid fadein posle TAP TO BEGIN
 *   09_fs_active_round.png       — FS round aktivan
 *   10_regular_rollup_counter.png — winRollup counter sa €3.00
 *   11_skip_during_bw_climax.png — skip → climax snap
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const PORT = 5241;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = '/tmp/cortex-eyes-h5x';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

let pass = 0, fail = 0;
const checks = [];

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('CON ' + m.text().slice(0, 200)); });

  await page.goto(`http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 01 - IDLE
  await page.screenshot({ path: `${OUT}/01_idle.png` });
  checks.push(['01_idle.png saved', true]);

  // ── BW dugme press → wait for tier 1 banner
  await page.evaluate(() => document.getElementById('devBwBtn')?.click());
  // Wait until onWinPresentationStart (BW dugme triggers spin 1.5s + applyWinHighlight)
  await page.waitForFunction(() => document.querySelectorAll('.cell--winsym').length > 0, { timeout: 8000 }).catch(()=>{});

  // 02 - Symbol pulse celebration
  await page.screenshot({ path: `${OUT}/02_bw_symbol_pulse.png` });
  const pulseCellCount = await page.evaluate(() => document.querySelectorAll('.cell--winsym').length);
  checks.push([`02 symbol pulse — ${pulseCellCount} cells with cell--winsym`, pulseCellCount >= 5]);

  // Wait for tier 1 banner to appear
  await page.waitForFunction(() => document.querySelector('.big-win-tier-banner'), { timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/03_bw_tier1.png` });
  const tier1State = await page.evaluate(() => ({
    dataTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
    label:    document.querySelector('.big-win-tier-label')?.textContent,
    amount:   document.querySelector('.big-win-tier-amount')?.textContent,
  }));
  checks.push([`03 tier 1 active — dataTier=${tier1State.dataTier}, label="${tier1State.label}", amount="${tier1State.amount}"`, tier1State.dataTier === '1']);

  // Wait for tier 3 (8s posle tier 1 enter — 2 × 4000ms)
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/04_bw_tier3.png` });
  const tier3State = await page.evaluate(() => ({
    dataTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
    amount:   document.querySelector('.big-win-tier-amount')?.textContent,
  }));
  checks.push([`04 tier 3 active — dataTier=${tier3State.dataTier}, amount="${tier3State.amount}"`, tier3State.dataTier === '3'])

  // Wait until tier 5 climax (poll for data-tier=5 + counter equal target)
  await page.waitForFunction(() => {
    const b = document.querySelector('.big-win-tier-banner');
    const a = document.querySelector('.big-win-tier-amount');
    return b?.getAttribute('data-tier') === '5' && a?.textContent?.includes('1500.00');
  }, { timeout: 30000 }).catch(()=>{});
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/05_bw_tier5_climax.png` });
  const tier5State = await page.evaluate(() => ({
    dataTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
    amount:   document.querySelector('.big-win-tier-amount')?.textContent,
    show:     document.querySelector('.big-win-tier-banner')?.getAttribute('data-show'),
  }));
  checks.push([`05 tier 5 climax — dataTier=${tier5State.dataTier}, amount="${tier5State.amount}", show="${tier5State.show}"`,
               tier5State.dataTier === '5' && tier5State.amount?.includes('1500.00')]);

  // 06 - endHold pre fade
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/06_bw_endhold.png` });

  // Wait for full walkthrough to complete
  await page.waitForFunction(() => !document.querySelector('.big-win-tier-banner'), { timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(500);

  // ── FS intro flow (via devFsBtn) ──
  await page.evaluate(() => document.getElementById('devFsBtn')?.click());
  // Wait until FS overlay appears
  await page.waitForFunction(() => {
    const o = document.querySelector('.fs-overlay');
    return o && o.classList.contains('fs-overlay--show');
  }, { timeout: 10000 }).catch(()=>{});
  await page.waitForTimeout(700); // wait for hide transition

  await page.screenshot({ path: `${OUT}/07_fs_intro_placard.png` });
  const fsIntroState = await page.evaluate(() => ({
    bodyClasses: document.body.className,
    overlayShown: !!document.querySelector('.fs-overlay')?.classList?.contains('fs-overlay--show'),
    frameOpacity: getComputedStyle(document.querySelector('.frame')).opacity,
    frameVisibility: getComputedStyle(document.querySelector('.frame')).visibility,
  }));
  checks.push([`07 FS intro — overlay shown, frame opacity=${fsIntroState.frameOpacity}, visibility=${fsIntroState.frameVisibility}`,
               fsIntroState.overlayShown && fsIntroState.frameOpacity === '0']);

  // 08 - Click TAP TO BEGIN, snapshot mid-fadein
  await page.evaluate(() => document.getElementById('fsPlacardCta')?.click());
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/08_fs_mid_fadein.png` });
  const fadeinState = await page.evaluate(() => ({
    hasFadein: document.body.classList.contains('is-feature-intro-fadein'),
    frameOpacity: getComputedStyle(document.querySelector('.frame')).opacity,
  }));
  checks.push([`08 mid fadein — hasFadein=${fadeinState.hasFadein}, frame opacity=${fadeinState.frameOpacity}`,
               fadeinState.hasFadein === true]);

  // 09 - FS round active
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/09_fs_active_round.png` });

  // 10 - Regular rollup counter — switch to fresh page state for clean test
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    if (typeof window.presentExternalWin === 'function') {
      await window.presentExternalWin(3);
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/10_regular_rollup_counter.png` });
  const rollupState = await page.evaluate(() => ({
    text: document.getElementById('winRollupAmount')?.textContent,
    show: document.getElementById('winRollupBanner')?.getAttribute('data-show'),
  }));
  checks.push([`10 winRollup — text="${rollupState.text}", show="${rollupState.show}"`,
               rollupState.text?.includes('3.00') && rollupState.show === 'true']);

  // 11 - Skip during BW walkthrough — fresh page reload for clean state
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.bigWinTierEnter(5, 1500));
  // Wait for tier 2 (5.5s)
  await page.waitForTimeout(5500);
  // Fire skip
  await page.evaluate(() => {
    if (window.HookBus) window.HookBus.emit('onSkipRequested', { phase: 'bigWinTier', source: 'eyes' });
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/11_skip_climax_snap.png` });
  const skipState = await page.evaluate(() => ({
    dataTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
    amount:   document.querySelector('.big-win-tier-amount')?.textContent,
  }));
  checks.push([`11 skip → tier 5 instant snap — dataTier=${skipState.dataTier}, amount="${skipState.amount}"`,
               skipState.dataTier === '5' && skipState.amount?.includes('1500.00')]);

  // No console errors check
  checks.push([`0 page/console errors (saw ${errors.length})`, errors.length === 0]);

  await browser.close();
} finally {
  srv.kill();
}

console.log('\n════ CORTEX EYES — H5.x QA REVIEW ════\n');
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (ok) pass++; else fail++;
}
console.log(`\nSummary: ${pass}/${pass+fail} pass`);
console.log(`Screenshots: ${OUT}/01..11_*.png`);
process.exit(fail === 0 ? 0 : 1);
