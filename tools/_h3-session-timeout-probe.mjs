#!/usr/bin/env node
/**
 * Live verification of Wave H3 — sessionTimeout on rectangular dist.
 *
 * Scenarios (all use injected ST_STATE.sessionMs to skip real-time wait):
 *   1. Presence — modal DOM, ST_STATE, public APIs, __SESSION_BREAK_ACTIVE__ false
 *   2. Warning trigger — sessionMs at (maxMs - warnMs) → modal shown reason=warning
 *   3. Extend CTA — onSessionExtended + warned reset
 *   4. Force-break trigger — sessionMs ≥ maxMs → __SESSION_BREAK_ACTIVE__ true
 *   5. Manual resume — stResumeFromBreak('manual') releases break
 *   6. realityCheck pause integration — preSpin during pause does NOT fire timeout
 *   7. realityCheck resume releases pause
 *   8. 0 page errors throughout
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5202;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 900));

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
    overlay:       !!document.getElementById('stOverlay'),
    title:         !!document.getElementById('stTitle'),
    counter:       !!document.getElementById('stCounter'),
    btnExtend:     !!document.getElementById('stBtnExtend'),
    /* forceLogout=false on demo → btnQuit must NOT be in DOM */
    btnQuit:       !!document.getElementById('stBtnQuit'),
    stState:       !!window.ST_STATE,
    stEnabled:     window.ST_STATE && window.ST_STATE.enabled === true,
    showFn:        typeof window.stShowWarning,
    forceFn:       typeof window.stForceTimeout,
    resumeFn:      typeof window.stResumeFromBreak,
    resetFn:       typeof window.stResetSession,
    breakFlag:     window.__SESSION_BREAK_ACTIVE__,
    maxMs:         window.ST_STATE && window.ST_STATE.enabled ? window.ST_STATE : null,
  }));
  console.log('Presence:', JSON.stringify(presence, null, 2).slice(0, 600));

  if (!presence.overlay || !presence.stEnabled) {
    console.error('❌ H3 not wired — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1: warning trigger ──
  console.log('\n— S1: sessionMs at (maxMs - warnMs) → onSessionWarningShown —');
  const s1 = await page.evaluate(async () => {
    const trace = { warning: [], fired: [], resumed: [], extended: [], logout: [] };
    window.HookBus.on('onSessionWarningShown',    p => trace.warning.push(p));
    window.HookBus.on('onSessionTimeoutFired',    p => trace.fired.push(p));
    window.HookBus.on('onSessionResumed',         p => trace.resumed.push(p));
    window.HookBus.on('onSessionExtended',        p => trace.extended.push(p));
    window.HookBus.on('onSessionLogoutRequested', p => trace.logout.push(p));

    /* Reset + nudge sessionMs to warning threshold. Demo config:
     * maxMs=90s, warnMs=20s, so we set sessionMs to 70_001. */
    window.stResetSession();
    window.ST_STATE.sessionMs = 70 * 1000 + 1;
    window.ST_STATE.lastTickWall = performance.now();
    window.HookBus.emit('preSpin');
    await new Promise(r => setTimeout(r, 60));
    return {
      trace,
      overlayShow: document.getElementById('stOverlay').getAttribute('data-show'),
      mode: document.getElementById('stOverlay').getAttribute('data-mode'),
      warned: window.ST_STATE.warned,
    };
  });
  console.log(`  warning events: ${s1.trace.warning.length}, mode: ${s1.mode}, warned: ${s1.warned}`);
  console.log(`  overlay data-show: ${s1.overlayShow}, payload remainingMs ≈ ${s1.trace.warning[0] && s1.trace.warning[0].remainingMs}`);

  // ── SCENARIO 2: EXTEND CTA ──
  console.log('\n— S2: click EXTEND → onSessionExtended + warned reset —');
  const s2 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onSessionExtended', p => trace.push(p));
    document.getElementById('stBtnExtend').click();
    await new Promise(r => setTimeout(r, 60));
    return {
      trace,
      sessionMs: window.ST_STATE.sessionMs,
      warned: window.ST_STATE.warned,
      overlayShow: document.getElementById('stOverlay').getAttribute('data-show'),
    };
  });
  console.log(`  extended events: ${s2.trace.length}, sessionMs=${s2.sessionMs}, warned=${s2.warned}, overlay=${s2.overlayShow}`);

  // ── SCENARIO 3: FORCE-BREAK trigger ──
  console.log('\n— S3: sessionMs ≥ maxMs → onSessionTimeoutFired + break flag true —');
  const s3 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onSessionTimeoutFired', p => trace.push(p));
    window.stResetSession();
    window.ST_STATE.sessionMs = 100 * 1000;  /* > 90s maxMs */
    window.ST_STATE.lastTickWall = performance.now();
    window.HookBus.emit('preSpin');
    await new Promise(r => setTimeout(r, 60));
    return {
      trace,
      breakFlag:     window.__SESSION_BREAK_ACTIVE__,
      breakActive:   window.ST_STATE.breakActive,
      overlayMode:   document.getElementById('stOverlay').getAttribute('data-mode'),
      overlayShow:   document.getElementById('stOverlay').getAttribute('data-show'),
      title:         document.getElementById('stTitle').textContent,
    };
  });
  console.log(`  fired events: ${s3.trace.length}, breakFlag: ${s3.breakFlag}, mode: ${s3.overlayMode}, title: "${s3.title}"`);
  console.log(`  fired.breakMs: ${s3.trace[0] && s3.trace[0].breakMs}, forceLogout: ${s3.trace[0] && s3.trace[0].forceLogout}`);

  // ── SCENARIO 4: MANUAL RESUME ──
  console.log('\n— S4: stResumeFromBreak("manual") → onSessionResumed + break flag false —');
  const s4 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onSessionResumed', p => trace.push(p));
    window.stResumeFromBreak('manual');
    await new Promise(r => setTimeout(r, 60));
    return {
      trace,
      breakFlag:     window.__SESSION_BREAK_ACTIVE__,
      sessionMs:     window.ST_STATE.sessionMs,
      warned:        window.ST_STATE.warned,
      overlayShow:   document.getElementById('stOverlay').getAttribute('data-show'),
    };
  });
  console.log(`  resumed events: ${s4.trace.length}, reason: ${s4.trace[0] && s4.trace[0].reason}, breakFlag: ${s4.breakFlag}`);
  console.log(`  post-resume: sessionMs=${s4.sessionMs}, warned=${s4.warned}, overlay=${s4.overlayShow}`);

  // ── SCENARIO 5: realityCheck pause integration ──
  console.log('\n— S5: onRealityCheckPaused → ST_STATE.paused true + preSpin no-op —');
  const s5 = await page.evaluate(async () => {
    const trace = { fired: [], warning: [] };
    window.HookBus.on('onSessionTimeoutFired', p => trace.fired.push(p));
    window.HookBus.on('onSessionWarningShown', p => trace.warning.push(p));
    window.stResetSession();
    window.HookBus.emit('onRealityCheckPaused', { durationMs: 60000 });
    const pausedBefore = window.ST_STATE.paused;
    /* Now push sessionMs high enough that a non-paused preSpin would fire. */
    window.ST_STATE.sessionMs = 100 * 1000;
    window.HookBus.emit('preSpin');
    await new Promise(r => setTimeout(r, 60));
    return {
      pausedBefore,
      pausedAfter:   window.ST_STATE.paused,
      breakFlag:     window.__SESSION_BREAK_ACTIVE__,
      firedCount:    trace.fired.length,
      warningCount:  trace.warning.length,
    };
  });
  console.log(`  pausedBefore=${s5.pausedBefore}, pausedAfter=${s5.pausedAfter}`);
  console.log(`  preSpin while paused: fired=${s5.firedCount}, warning=${s5.warningCount}, breakFlag=${s5.breakFlag}`);

  // ── SCENARIO 6: realityCheck RESUME releases pause ──
  console.log('\n— S6: onRealityCheckResumed → ST_STATE.paused false —');
  const s6 = await page.evaluate(async () => {
    window.HookBus.emit('onRealityCheckResumed', {});
    await new Promise(r => setTimeout(r, 60));
    return { paused: window.ST_STATE.paused };
  });
  console.log(`  paused after resume: ${s6.paused}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['Modal overlay present in DOM',                          presence.overlay],
    ['Title + counter present',                                presence.title && presence.counter],
    ['EXTEND button present (extendable=true default)',        presence.btnExtend],
    ['QUIT button absent (forceLogout=false default)',         presence.btnQuit === false],
    ['ST_STATE present + enabled',                              presence.stState && presence.stEnabled],
    ['Public APIs exposed (stShow/Force/Resume/Reset)',
                                                                presence.showFn === 'function' &&
                                                                presence.forceFn === 'function' &&
                                                                presence.resumeFn === 'function' &&
                                                                presence.resetFn === 'function'],
    ['__SESSION_BREAK_ACTIVE__ starts false',                  presence.breakFlag === false],
    /* S1 */
    ['S1: warning threshold → 1 onSessionWarningShown',         s1.trace.warning.length === 1],
    ['S1: warning payload has remainingMs + sessionMs',
                                                                s1.trace.warning[0] &&
                                                                Number.isFinite(s1.trace.warning[0].remainingMs) &&
                                                                Number.isFinite(s1.trace.warning[0].sessionMs)],
    ['S1: overlay data-show=true after warning',                s1.overlayShow === 'true'],
    ['S1: overlay data-mode=warning',                           s1.mode === 'warning'],
    ['S1: ST_STATE.warned=true',                                s1.warned === true],
    /* S2 */
    ['S2: EXTEND click emits onSessionExtended',                s2.trace.length === 1],
    ['S2: sessionMs reset to 0 after extend',                   s2.sessionMs === 0],
    ['S2: warned reset to false',                                s2.warned === false],
    ['S2: overlay hidden after extend',                          s2.overlayShow === 'false'],
    /* S3 */
    ['S3: hard cap → 1 onSessionTimeoutFired',                  s3.trace.length === 1],
    ['S3: fired.breakMs === 30000 (demo)',                       s3.trace[0] && s3.trace[0].breakMs === 30 * 1000],
    ['S3: fired.forceLogout === false (demo)',                  s3.trace[0] && s3.trace[0].forceLogout === false],
    ['S3: __SESSION_BREAK_ACTIVE__ flipped true',               s3.breakFlag === true],
    ['S3: ST_STATE.breakActive=true',                            s3.breakActive === true],
    ['S3: overlay data-mode=break',                              s3.overlayMode === 'break'],
    ['S3: title flipped to TAKE A BREAK',                       /BREAK|REST/i.test(s3.title)],
    /* S4 */
    ['S4: manual resume → 1 onSessionResumed',                  s4.trace.length === 1],
    ['S4: resume.reason === manual',                            s4.trace[0] && s4.trace[0].reason === 'manual'],
    ['S4: __SESSION_BREAK_ACTIVE__ released',                   s4.breakFlag === false],
    ['S4: sessionMs reset (0)',                                  s4.sessionMs === 0],
    ['S4: warned reset (false)',                                 s4.warned === false],
    ['S4: overlay hidden after resume',                          s4.overlayShow === 'false'],
    /* S5 */
    ['S5: realityCheck pause flips ST_STATE.paused',            s5.pausedAfter === true],
    ['S5: preSpin while paused does NOT fire timeout',          s5.firedCount === 0],
    ['S5: preSpin while paused does NOT fire warning',          s5.warningCount === 0],
    ['S5: __SESSION_BREAK_ACTIVE__ still false during pause',   s5.breakFlag === false],
    /* S6 */
    ['S6: realityCheck resume clears ST_STATE.paused',          s6.paused === false],
    /* errors */
    ['0 page errors throughout probe',                          errs.length === 0],
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
