#!/usr/bin/env node
/** Debug BIG-WIN chip flow */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const HOME = process.env.HOME;
const PDF  = (existsSync(`${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`) ? `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` : `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`);
const PORT = 5239;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /BIG_WIN|TIER|forcedTier|winPresent|forcedBigWin/i.test(t)) {
    console.log(`  ${m.type()}:`, t.slice(0, 140));
  }
});
page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0,140)));
await page.goto(`http://127.0.0.1:${PORT}/`);
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame');
await page.waitForTimeout(800);
const f = page.frames().find((x) => x !== page.mainFrame());

console.log('— pre-click —');
console.log(await f.evaluate(() => ({
  bigWinEnabled: !!(window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.enabled),
  hasEnter: typeof window.bigWinTierEnter,
  hasUFP: !!document.querySelector('.ufp-chip[data-ufp-kind="big_win"]'),
})));

console.log('— spy on handlePostSpin —');
await f.evaluate(() => {
  window.__POSTSPIN_TRACE__ = [];
  /* Patch HookBus emit to log every event */
  const orig = window.HookBus.emit;
  window.HookBus.emit = function(name, p) {
    window.__POSTSPIN_TRACE__.push({ ev: name, ts: Math.round(performance.now()), forceFlag: window.__FORCE_BIG_WIN_TIER__ });
    return orig.call(window.HookBus, name, p);
  };
  /* Try direct applyWinHighlight after setting force flag, OUTSIDE of any spin. */
  window.__FORCE_BIG_WIN_TIER__ = 3;
  window.applyWinHighlight().then((events) => {
    window.__DIRECT_APPLY_RESULT__ = { events: events?.length, bigWinTier: window.BIG_WIN_TIER_STATE.current, finalTier: window.BIG_WIN_TIER_STATE.finalTier, winAward: window.__WIN_AWARD__ };
  });
});
await page.waitForTimeout(5000);
console.log('  direct apply result:', await f.evaluate(() => window.__DIRECT_APPLY_RESULT__));
console.log('  postSpin trace (last 12):');
const trace = await f.evaluate(() => window.__POSTSPIN_TRACE__);
trace.slice(-12).forEach(t => console.log(`     ${t.ts}ms · ${t.ev} (flag=${t.forceFlag})`));

for (let s = 0; s < 16; s++) {
  await page.waitForTimeout(500);
  const st = await f.evaluate(() => ({
    t: Math.round(performance.now() / 1000),
    phase: window.FSM ? window.FSM.phase : null,
    spinning: document.getElementById('spinBtn')?.classList.contains('is-spinning'),
    forceFlag: window.__FORCE_BIG_WIN_TIER__,
    winAward: window.__WIN_AWARD__,
    winPresentActive: window.__SLOT_WIN_PRESENT_ACTIVE__,
    bigWinState: window.BIG_WIN_TIER_STATE ? {
      current: window.BIG_WIN_TIER_STATE.current,
      finalTier: window.BIG_WIN_TIER_STATE.finalTier,
      walkActive: window.BIG_WIN_TIER_STATE.walkActive,
    } : null,
    bigWinTier: window.__BIG_WIN_TIER__,
  }));
  console.log(`  t+${(s+1)*0.5}s:`, st);
}
await browser.close();
server.kill('SIGTERM');
