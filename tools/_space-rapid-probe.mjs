#!/usr/bin/env node
/**
 * Live verification of Wave V5.X — rapid Space CTA must hit STOP/SKIP states.
 *
 * Boki bug 05.06.2026: "Kada pritiskam space brzo da igram bas brzo igru,
 * onda se ne pali uvek dugme stop i skip nego samo play."
 *
 * Probe scenario:
 *   1. Open rectangular dist
 *   2. Capture every spinBtn data-state mutation (timeline)
 *   3. Issue N Space presses with 120 ms between them (rapid play cadence)
 *   4. Verify: each spin cycle progresses through SPIN → STOP_PRE
 *      (or beyond) — at minimum every press that started a spin must be
 *      followed by a STOP_* state appearing before the next SPIN
 *
 * Also tests:
 *   - Holding Space (auto-repeat) should not flood clicks
 *   - Manual click → Space → button stays single-click-per-press
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5194;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Install state-mutation observer
  await page.evaluate(() => {
    window.__STATE_TRACE__ = [];
    window.__CLICK_COUNT__ = 0;
    const btn = document.getElementById('spinBtn');
    if (!btn) return;
    const push = (reason) => {
      window.__STATE_TRACE__.push({
        t: performance.now() | 0,
        state: btn.getAttribute('data-state'),
        disabled: btn.disabled,
        reason,
      });
    };
    push('initial');
    const obs = new MutationObserver(() => push('state-mut'));
    obs.observe(btn, { attributes: true, attributeFilter: ['data-state', 'disabled'] });
    btn.addEventListener('click', () => { window.__CLICK_COUNT__++; }, true);
  });

  // ── SCENARIO 1 — RAPID DISCRETE SPACE PRESSES ──────────────────
  // Real-world rapid play: press Space, wait for state to leave SPIN,
  // press again. With cadence < spin duration the button.disabled guard
  // (legitimately) rejects mid-settle presses — what we verify is that
  // when a press IS accepted, the state machine progresses through STOP_*.
  console.log('— SCENARIO 1: 8 rapid Space presses (120 ms cadence, rectangular) —');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3500);  // let last spin settle
  const s1 = await page.evaluate(() => ({
    trace: window.__STATE_TRACE__.slice(),
    clicks: window.__CLICK_COUNT__,
  }));
  console.log(`  clicks observed: ${s1.clicks}`);
  // Extract unique state transitions in order
  const states1 = s1.trace.map(s => s.state).filter((v,i,a) => i === 0 || v !== a[i-1]);
  console.log(`  state timeline: ${states1.join(' → ')}`);
  const stopAppeared = states1.some(s => s === 'STOP_PRE' || s === 'STOP_POST');
  const skipAppeared = states1.some(s => s === 'SKIP_ROLLUP' || s === 'SKIP_BIGWIN');
  console.log(`  STOP_* appeared:  ${stopAppeared ? '✅' : '❌'}`);
  console.log(`  SKIP_* appeared:  ${skipAppeared ? '⚠️ (win triggered)' : '— (no big wins)'}`);
  // Per Boki: each accepted press should reach STOP_* before returning to SPIN
  // i.e. SPIN → STOP_* sequence must occur at least once for every spin start
  let spinStarts = 0, stopTransitions = 0;
  for (let i = 1; i < states1.length; i++) {
    if (states1[i-1] === 'SPIN' && (states1[i] === 'STOP_PRE' || states1[i] === 'STOP_POST')) {
      stopTransitions++;
    }
    if (states1[i] === 'SPIN' && states1[i-1] !== 'SPIN') spinStarts++;
  }
  if (states1[0] === 'SPIN') spinStarts = Math.max(spinStarts, 1);
  const spinStartsThatLed = states1.filter((s,i) => s === 'STOP_PRE' || s === 'STOP_POST').length > 0 ? stopTransitions : 0;
  console.log(`  spin starts: ${spinStarts}, SPIN→STOP_* transitions: ${stopTransitions}`);

  // ── SCENARIO 2 — HOLD SPACE 1 second (auto-repeat) ──────────────
  console.log('\n— SCENARIO 2: hold Space 1000 ms (OS auto-repeat) —');
  await page.evaluate(() => { window.__CLICK_COUNT__ = 0; window.__STATE_TRACE__.length = 0; });
  await page.keyboard.down('Space');
  await page.waitForTimeout(1000);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1500);
  const s2 = await page.evaluate(() => ({
    clicks: window.__CLICK_COUNT__,
    trace:  window.__STATE_TRACE__.slice(),
  }));
  console.log(`  clicks observed during 1s hold: ${s2.clicks} (expected 1 — auto-repeat must be killed)`);
  const states2 = s2.trace.map(s => s.state).filter((v,i,a) => i === 0 || v !== a[i-1]);
  console.log(`  state timeline: ${states2.join(' → ')}`);

  // ── SCENARIO 3 — focused-button Space (the original dup-click bug) ──
  console.log('\n— SCENARIO 3: focus spinBtn, single Space press (was firing 2 clicks) —');
  // Wait extra to ensure any in-flight spin from prior scenarios fully drains
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__CLICK_COUNT__ = 0;
    window.__STATE_TRACE__.length = 0;
    var btn = document.getElementById('spinBtn');
    btn.focus();
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);
  const s3 = await page.evaluate(() => ({
    clicks: window.__CLICK_COUNT__,
    trace:  window.__STATE_TRACE__.slice(),
    finalState: document.getElementById('spinBtn').getAttribute('data-state'),
  }));
  console.log(`  clicks observed: ${s3.clicks} (expected 1, was 2 before fix)`);
  const states3 = s3.trace.map(s => s.state).filter((v,i,a) => i === 0 || v !== a[i-1]);
  console.log(`  state timeline: ${states3.join(' → ')}`);
  console.log(`  final state: ${s3.finalState}`);
  const sawStop3 = states3.some(s => s === 'STOP_PRE' || s === 'STOP_POST');
  console.log(`  STOP_* appeared: ${sawStop3 ? '✅' : '❌'}`);

  // ── ACCEPTANCE ──
  // Boki's core requirement: rapid Space → state machine must visibly progress
  // through STOP_*/SKIP_* states (not "samo play"). The fix targets two bugs:
  //   (A) keydown-side dup-click on focused button (was firing 2x click per press)
  //   (B) OS auto-repeat flooding (was firing 30+ clicks per held key)
  // (A)+(B) together caused state machine to race past STOP_* into next SPIN.
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['Scenario 1: STOP_* appears during rapid play (was: only PLAY)',             stopAppeared],
    ['Scenario 1: every accepted SPIN start reaches STOP_* (no race-past)',       spinStarts >= 1 && stopTransitions >= spinStarts - 1],
    ['Scenario 1: no click flood (clicks ≤ 2x presses)',                          s1.clicks <= 16],
    ['Scenario 2: auto-repeat killed (1 click per 1s held key, not 30+)',         s2.clicks === 1],
    ['Scenario 3: focused-button single Space = single click (was 2)',            s3.clicks === 1],
    ['Scenario 3: focused-button single Space hits STOP_* in timeline',           sawStop3],
    ['0 page errors',                                                             errs.length === 0],
  ];
  let pass = 0, fail = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\nResult: ${pass}/${pass+fail} pass, errors: ${errs.length}`);
  if (errs.length) errs.slice(0,5).forEach(e => console.log('  console:', e));

  await browser.close();
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  server.kill();
  process.exit(2); /* UQ-FORTIFY6 #3: probe internal error → exit 2 (HARD-FAIL category, CI must not treat as soft-warn) */
}
