#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5253;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: '+e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame', { timeout: 15000 });
await page.waitForTimeout(1500);
const frame = page.frames().find(f => f !== page.mainFrame());
frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

// Check if big_win chip exists, then click it + spin
const chip = await frame.evaluate(() => {
  const c = document.querySelector('.ufp-chip[data-ufp-kind="big_win"]');
  if (!c) return null;
  return { text: c.textContent, disabled: c.hasAttribute('disabled'), aria: c.getAttribute('aria-disabled') };
});
console.log('big_win chip:', chip);

const beforeFlag = await frame.evaluate(() => ({
  ff: window.__FORCE_FEATURE__,
  ft: window.__FORCE_TRIGGER__,
  fbwt: window.__FORCE_BIG_WIN_TIER__,
}));
console.log('flags before click:', beforeFlag);

await frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="big_win"]').click());
await page.waitForTimeout(400);
const afterFlag = await frame.evaluate(() => ({
  ff: window.__FORCE_FEATURE__,
  ft: window.__FORCE_TRIGGER__,
  fbwt: window.__FORCE_BIG_WIN_TIER__,
  bwState: window.BIG_WIN_TIER_STATE,
}));
console.log('flags after click:', afterFlag);

await frame.evaluate(() => document.getElementById('spinBtn').click());

// poll BW state for 15s
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(300);
  const st = await frame.evaluate(() => ({
    phase: window.FSM ? window.FSM.phase : 'BASE',
    bwActive: !!(window.BIG_WIN_TIER_STATE && (window.BIG_WIN_TIER_STATE.current > 0 || window.BIG_WIN_TIER_STATE.walkActive || window.BIG_WIN_TIER_STATE.finalTier > 0)),
    bwState: window.BIG_WIN_TIER_STATE,
    forceBwTier: window.__FORCE_BIG_WIN_TIER__,
    presentInvoked: window.__PRESENT_EXTERNAL_WIN_LAST__,
  }));
  if (st.bwActive) {
    console.log(`tick#${i}: BW ACTIVE — ${JSON.stringify(st.bwState)}`);
    break;
  }
  if (i % 5 === 0) console.log(`tick#${i}: phase=${st.phase} bwActive=${st.bwActive} forceBwTier=${st.forceBwTier} bwState=${JSON.stringify(st.bwState)}`);
}

const finalErrs = errs.slice(0, 10);
console.log('errors:', errs.length);
finalErrs.forEach(e => console.log('  '+e.slice(0, 200)));

await ctx.close();
await browser.close();
server.kill('SIGTERM');
