#!/usr/bin/env node
/**
 * FS manual STOP + SKIP repro probe.
 *
 * Boki bug 05.06.2026: "kada rucno stopiram i skiopujem winove u FS,
 * zabaguje i blokira FS blok."
 *
 * Scenario:
 *   1. devFs trigger → FS_INTRO placard
 *   2. Tap TO BEGIN → FS_ACTIVE → first FS spin starts
 *   3. Slam stop during spin (emit onSlamRequested)
 *   4. If win presentation starts, emit onSkipRequested
 *   5. Wait for next FS spin to start (preSpin duringFs:true)
 *
 * Verify:
 *   - FSM.phase stays FS_ACTIVE
 *   - allReelsActive resets to false
 *   - Next FS spin's preSpin fires within ~3s of skip
 *   - spinsRemaining decreases
 *   - No console errors
 *   - FS completes naturally (reaches FS_OUTRO)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5243;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('CON ' + m.text().slice(0, 200)); });

  // Use rectangular dist — has FS enabled
  await page.goto(`http://127.0.0.1:${PORT}/dist/wrath-of-olympus.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Trigger FS
  await page.evaluate(() => {
    window.__T__ = { events: [] };
    const evs = ['preSpin','onSpinResult','onSlamRequested','onSlamComplete',
                 'onSkipRequested','onSkipComplete','onWinPresentationStart',
                 'onWinPresentationEnd','onFsTrigger','onFsSpinResult',
                 'onFsEnd','postSpin'];
    if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__T__.events.push({ n, t: performance.now()|0, ...p })));
    document.getElementById('devFsBtn')?.click();
  });
  // Wait for FS placard to appear
  await page.waitForFunction(() => {
    const o = document.querySelector('.fs-overlay');
    return o && o.classList.contains('fs-overlay--show');
  }, { timeout: 10000 }).catch(()=>{});
  await page.waitForTimeout(700);

  // Tap TO BEGIN
  await page.evaluate(() => document.getElementById('fsPlacardCta')?.click());
  // Wait for FS_ACTIVE + first FS spin's preSpin
  await page.waitForFunction(() => window.__T__?.events?.some(e => e.n === 'preSpin' && e.duringFs), { timeout: 8000 }).catch(()=>{});

  const fsState1 = await page.evaluate(() => ({
    phase: typeof FSM !== 'undefined' && FSM?.phase,
    spinsRemaining: typeof FSM !== 'undefined' && FSM?.spinsRemaining,
    spinsTotal: typeof FSM !== 'undefined' && FSM?.spinsTotal,
  }));
  console.log('After TAP TO BEGIN:', JSON.stringify(fsState1));

  // Run 3 spins with manual STOP + SKIP for each
  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Spin ${i} ---`);
    // Wait briefly for reels to be spinning
    await page.waitForTimeout(400);
    const beforeStop = await page.evaluate(() => ({
      phase: FSM?.phase,
      spinsRemaining: FSM?.spinsRemaining,
      allReelsActive: typeof allReelsActive !== 'undefined' ? allReelsActive : (typeof window !== 'undefined' && window.allReelsActive),
    }));
    console.log('  before STOP:', JSON.stringify(beforeStop));

    // Emit STOP (slam request) via reelsHost click
    await page.evaluate(() => {
      window.HookBus.emit('onSlamRequested', { phase: 'pre', source: 'probe' });
    });
    // Wait for onSpinResult (reels settled)
    await page.waitForFunction((spinNum) => {
      const evs = window.__T__?.events || [];
      return evs.filter(e => e.n === 'onSpinResult').length >= spinNum;
    }, i, { timeout: 5000 }).catch(()=>{});

    // Wait for win presentation (may or may not occur)
    await page.waitForFunction((spinNum) => {
      const evs = window.__T__?.events || [];
      return evs.filter(e => e.n === 'onWinPresentationStart').length >= spinNum
          || evs.filter(e => e.n === 'postSpin' && e.duringFs).length >= spinNum;
    }, i, { timeout: 5000 }).catch(()=>{});

    // Emit SKIP if win presentation started
    await page.evaluate(() => {
      // Skip both rollup + bigWinTier — whichever is active
      window.HookBus.emit('onSkipRequested', { phase: 'rollup', source: 'probe' });
      window.HookBus.emit('onSkipRequested', { phase: 'bigWinTier', source: 'probe' });
    });

    // Wait briefly + check whether NEXT preSpin fires
    await page.waitForTimeout(2500);
    const afterCount = await page.evaluate(() =>
      (window.__T__?.events || []).filter(e => e.n === 'preSpin' && e.duringFs).length);
    console.log(`  preSpin (duringFs) count after spin ${i}: ${afterCount} (expect >= ${i + 1} or in FS_OUTRO)`);
    const phaseNow = await page.evaluate(() => FSM?.phase);
    console.log(`  FSM.phase: ${phaseNow}`);
    if (phaseNow !== 'FS_ACTIVE') break;
  }

  // Final state
  const finalState = await page.evaluate(() => ({
    phase: FSM?.phase,
    spinsRemaining: FSM?.spinsRemaining,
    totalWin: FSM?.totalWin,
    allReelsActive: typeof allReelsActive !== 'undefined' ? allReelsActive : null,
    preSpinCount: (window.__T__?.events || []).filter(e => e.n === 'preSpin' && e.duringFs).length,
    onSpinResultCount: (window.__T__?.events || []).filter(e => e.n === 'onSpinResult').length,
    postSpinCount: (window.__T__?.events || []).filter(e => e.n === 'postSpin' && e.duringFs).length,
    fsEndCount: (window.__T__?.events || []).filter(e => e.n === 'onFsEnd').length,
  }));
  console.log('\nFinal state:', JSON.stringify(finalState));
  console.log('Errors:', errors.slice(0, 5));

  await browser.close();
} finally { srv.kill(); }
