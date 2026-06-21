#!/usr/bin/env node
/**
 * Live verification of Wave H2 — realityCheck on rectangular dist.
 *
 * Scenarios:
 *   1. Presence — modal DOM, RC_STATE, public APIs
 *   2. Spin-based trigger (25 spinInterval) → modal shows
 *   3. Continue dismiss
 *   4. Loss-based trigger via onNetThresholdCrossed → modal shows reason=loss
 *   5. Pause flow → __REALITY_PAUSE_ACTIVE__ flips true
 *   6. Quit flow → counters cleared
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5201;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 200));
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ── PRESENCE ──
  const presence = await page.evaluate(() => ({
    overlay:        !!document.getElementById('rcOverlay'),
    cont:           !!document.getElementById('rcBtnContinue'),
    pause:          !!document.getElementById('rcBtnPause'),
    quit:           !!document.getElementById('rcBtnQuit'),
    pauseOpts:      document.getElementById('rcPauseOptions') &&
                    document.getElementById('rcPauseOptions').querySelectorAll('.rc-pause-btn').length,
    rcState:        !!window.RC_STATE,
    rcEnabled:      window.RC_STATE && window.RC_STATE.enabled === true,
    showFn:         typeof window.rcShow,
    dismissFn:      typeof window.rcDismiss,
    resetFn:        typeof window.rcResetSession,
    pauseFlag:      window.__REALITY_PAUSE_ACTIVE__,
    initialSpins:   window.RC_STATE && window.RC_STATE.spins,
  }));
  console.log('Presence:', presence);

  if (!presence.overlay || !presence.rcEnabled) {
    console.error('❌ H2 not wired — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1: spin-based trigger ──
  console.log('\n— S1: 25 preSpin events → modal shows (reason=spins) —');
  const s1 = await page.evaluate(async () => {
    const trace = { shown: [], dismissed: [], paused: [], resumed: [], quit: [] };
    window.HookBus.on('onRealityCheckShown',     p => trace.shown.push(p));
    window.HookBus.on('onRealityCheckDismissed', p => trace.dismissed.push(p));
    window.HookBus.on('onRealityCheckPaused',    p => trace.paused.push(p));
    window.HookBus.on('onRealityCheckResumed',   p => trace.resumed.push(p));
    window.HookBus.on('onRealityCheckQuit',      p => trace.quit.push(p));
    /* Reset and fire 25 preSpin events */
    window.rcResetSession();
    for (let i = 0; i < 25; i++) window.HookBus.emit('preSpin');
    await new Promise(r => setTimeout(r, 60));
    return {
      trace,
      overlayShow: document.getElementById('rcOverlay').getAttribute('data-show'),
      spins: window.RC_STATE.spins,
    };
  });
  console.log(`  spins counted: ${s1.spins}, overlay data-show: ${s1.overlayShow}`);
  console.log(`  shown events: ${s1.trace.shown.length}, last reason: ${s1.trace.shown.length ? s1.trace.shown[s1.trace.shown.length-1].reason : 'none'}`);

  // ── SCENARIO 2: continue dismiss ──
  console.log('\n— S2: click CONTINUE → onRealityCheckDismissed —');
  const s2 = await page.evaluate(async () => {
    const t = [];
    window.HookBus.on('onRealityCheckDismissed', p => t.push(p));
    document.getElementById('rcBtnContinue').click();
    await new Promise(r => setTimeout(r, 60));
    return {
      t,
      overlayShow: document.getElementById('rcOverlay').getAttribute('data-show'),
    };
  });
  console.log(`  trace: ${JSON.stringify(s2.t)}, overlay data-show: ${s2.overlayShow}`);

  // ── SCENARIO 3: loss-based trigger ──
  console.log('\n— S3: emit onNetThresholdCrossed alert → reason=loss —');
  const s3 = await page.evaluate(async () => {
    const t = [];
    window.HookBus.on('onRealityCheckShown', p => t.push(p));
    window.HookBus.emit('onNetThresholdCrossed', {
      to: 'alert', from: 'warn', direction: 'losing', net: -650,
    });
    await new Promise(r => setTimeout(r, 60));
    return {
      t,
      reason: t[0] && t[0].reason,
    };
  });
  console.log(`  shown count: ${s3.t.length}, reason: ${s3.reason}`);

  // ── SCENARIO 4: pause flow ──
  console.log('\n— S4: click PAUSE → choose 5 MIN → __REALITY_PAUSE_ACTIVE__ true —');
  const s4 = await page.evaluate(async () => {
    const t = [];
    window.HookBus.on('onRealityCheckPaused', p => t.push(p));
    document.getElementById('rcBtnPause').click();
    await new Promise(r => setTimeout(r, 30));
    const pauseOptsShow = document.getElementById('rcPauseOptions').getAttribute('data-show');
    const firstPauseBtn = document.getElementById('rcPauseOptions').querySelectorAll('.rc-pause-btn')[0];
    firstPauseBtn.click();
    await new Promise(r => setTimeout(r, 30));
    return {
      pauseOptsShow,
      pauseEvents: t,
      pauseActiveFlag: window.__REALITY_PAUSE_ACTIVE__,
      paused: window.RC_STATE.paused,
    };
  });
  console.log(`  pauseOpts data-show after PAUSE click: ${s4.pauseOptsShow}`);
  console.log(`  pause event durationMs: ${s4.pauseEvents[0] && s4.pauseEvents[0].durationMs}`);
  console.log(`  __REALITY_PAUSE_ACTIVE__: ${s4.pauseActiveFlag}, RC_STATE.paused: ${s4.paused}`);

  // ── SCENARIO 5: force quit ──
  console.log('\n— S5: rcShow + click QUIT → onRealityCheckQuit + counters cleared —');
  const s5 = await page.evaluate(async () => {
    /* Clear pause flag for clean test */
    window.RC_STATE.paused = false;
    window.RC_STATE._shown = false;
    window.__REALITY_PAUSE_ACTIVE__ = false;
    /* Fake some session activity */
    window.RC_STATE.spins = 80;
    window.RC_STATE.totalWin = 200;
    window.RC_STATE.totalLoss = 350;
    const t = [];
    window.HookBus.on('onRealityCheckQuit', p => t.push(p));
    window.rcShow('time');
    await new Promise(r => setTimeout(r, 30));
    document.getElementById('rcBtnQuit').click();
    await new Promise(r => setTimeout(r, 60));
    return {
      t,
      spinsAfter: window.RC_STATE.spins,
      winAfter: window.RC_STATE.totalWin,
      lossAfter: window.RC_STATE.totalLoss,
    };
  });
  console.log(`  quit event stats: ${JSON.stringify(s5.t[0] && s5.t[0].stats)}`);
  console.log(`  counters after quit: spins=${s5.spinsAfter}, win=${s5.winAfter}, loss=${s5.lossAfter}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['Modal overlay present in DOM',                        presence.overlay],
    ['Continue/Pause/Quit buttons present',                  presence.cont && presence.pause && presence.quit],
    ['3 pause-option buttons mounted (default 5/15/30)',     presence.pauseOpts === 3],
    ['RC_STATE present + enabled',                            presence.rcState && presence.rcEnabled],
    ['Public APIs exposed (rcShow / rcDismiss / rcResetSession)',
                                                              presence.showFn === 'function' && presence.dismissFn === 'function' && presence.resetFn === 'function'],
    ['__REALITY_PAUSE_ACTIVE__ starts false',                 presence.pauseFlag === false],
    /* S1 */
    ['S1: 25 spins counted',                                  s1.spins === 25],
    ['S1: overlay flips data-show=true',                      s1.overlayShow === 'true'],
    ['S1: ≥1 onRealityCheckShown event (reason=spins)',
                                                              s1.trace.shown.some(e => e.reason === 'spins')],
    /* S2 */
    ['S2: CONTINUE emits onRealityCheckDismissed{reason:continue}',
                                                              s2.t.length === 1 && s2.t[0].reason === 'continue'],
    ['S2: overlay data-show=false after dismiss',             s2.overlayShow === 'false'],
    /* S3 */
    ['S3: net threshold alert → modal shown with reason=loss', s3.t.length === 1 && s3.reason === 'loss'],
    /* S4 */
    ['S4: PAUSE click reveals pause-options panel',           s4.pauseOptsShow === 'true'],
    ['S4: choosing 5 MIN emits onRealityCheckPaused{durationMs:300000}',
                                                              s4.pauseEvents.length === 1 && s4.pauseEvents[0].durationMs === 300000],
    ['S4: __REALITY_PAUSE_ACTIVE__ flipped true',             s4.pauseActiveFlag === true],
    ['S4: RC_STATE.paused === true',                          s4.paused === true],
    /* S5 */
    ['S5: QUIT emits onRealityCheckQuit with stats',          s5.t.length === 1 && !!s5.t[0].stats],
    ['S5: stats.net === -150 (200 win - 350 loss)',           s5.t[0] && s5.t[0].stats && s5.t[0].stats.net === -150],
    ['S5: counters reset (spins=0, win=0, loss=0)',           s5.spinsAfter === 0 && s5.winAfter === 0 && s5.lossAfter === 0],
    /* errors */
    ['0 page errors',                                         errs.length === 0],
  ];
  let pass = 0, fail = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\nResult: ${pass}/${pass+fail} pass, errors: ${errs.length}`);
  if (errs.length) errs.slice(0, 5).forEach(e => console.log('  console:', e));

  await browser.close();
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  server.kill();
  process.exit(2); /* UQ-FORTIFY6 #3: probe internal error → exit 2 (HARD-FAIL category, CI must not treat as soft-warn) */
}
