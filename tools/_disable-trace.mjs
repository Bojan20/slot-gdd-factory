#!/usr/bin/env node
/**
 * tools/_disable-trace.mjs
 *
 * Patch spinBtn.disabled setter to log STACK every time something sets it
 * to true. Find the exact caller that locks the button when phase=BASE.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const TARGET = `${REPO}/samples/grids/05_megaclusters_GAME_GDD.md`;
const PORT = 5271;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: '+e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
await page.setInputFiles('#fileInput', TARGET);
await page.waitForSelector('#previewFrame', { timeout: 25000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());

// Patch the disabled setter
await frame.evaluate(() => {
  window.__DISABLES = [];
  const b = document.getElementById('spinBtn');
  if (!b) return;
  // Save original descriptor — `disabled` is on HTMLButtonElement.prototype
  const proto = HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  if (!desc) return;
  // Define instance-level setter that logs + delegates
  let _disabled = b.disabled;
  Object.defineProperty(b, 'disabled', {
    get() { return _disabled; },
    set(v) {
      const phase = window.FSM ? window.FSM.phase : '?';
      const winPres = !!window.__SLOT_WIN_PRESENT_ACTIVE__;
      const bwWalk = window.BIG_WIN_TIER_STATE ? window.BIG_WIN_TIER_STATE.walkActive : false;
      const stack = new Error().stack || '';
      const frames = stack.split('\n').slice(2, 8).map(s => s.trim()).join(' ◀ ');
      window.__DISABLES.push({
        t: Date.now(),
        from: _disabled,
        to: !!v,
        phase, winPres, bwWalk,
        stack: frames,
      });
      _disabled = !!v;
    },
    configurable: true,
  });
});

// Spin loop
console.log('Spinning until button locks in BASE phase...');
for (let i = 0; i < 15; i++) {
  for (let j = 0; j < 40; j++) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ok) break;
    await page.waitForTimeout(150);
  }
  const phaseNow = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
  console.log(`  spin ${i}: phase=${phaseNow}`);
  if (phaseNow !== 'BASE') {
    console.log(`  → FS detected, watching lifecycle for 30s`);
    await page.waitForTimeout(30000);
    break;
  }
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(2200);
  // Check if button is stuck disabled in BASE
  const stuck = await frame.evaluate(() => {
    const b = document.getElementById('spinBtn');
    return b && b.disabled && !b.classList.contains('is-spinning') &&
           window.FSM && window.FSM.phase === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
  });
  if (stuck) {
    console.log(`  → STUCK at spin ${i+1}: phase=BASE, button disabled with no reason`);
    break;
  }
}

const disables = await frame.evaluate(() => window.__DISABLES);
console.log(`\nTotal disabled flips: ${disables.length}`);
const toTrue = disables.filter(d => d.to === true);
console.log(`Flips to TRUE: ${toTrue.length}`);
console.log(`\nDISABLE → TRUE events:`);
toTrue.forEach((d, i) => {
  console.log(`\n  #${i+1}: phase=${d.phase} winPres=${d.winPres} bwWalk=${d.bwWalk}`);
  console.log(`    stack: ${d.stack}`);
});

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
