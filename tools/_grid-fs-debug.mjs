#!/usr/bin/env node
/** Debug FS chip per grid kind. Usage: node tools/_grid-fs-debug.mjs <grid-num> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const num = process.argv[2] || '19';
const url = `http://127.0.0.1:5311/dist/${num}_lock_respin_playable.html`;
const map = { '11':'radial', '15':'slingo', '18':'wheel', '19':'lock_respin' };
const kind = map[num] || 'lock_respin';
const URL = `http://127.0.0.1:5311/dist/${num}_${kind}_playable.html?v=${Date.now()}`;
const PORT = 5311;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /unknown|FORCE_TRIGGER|FREESPINS|FSM\.phase|trigger/i.test(t)) {
    console.log(`  ${m.type()}:`, t.slice(0,140));
  }
});
page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0,140)));
await page.goto(URL);
await page.waitForTimeout(800);

console.log('— before click —');
console.log(await page.evaluate(() => ({
  shape: typeof SHAPE !== 'undefined' ? SHAPE.kind : 'n/a',
  triggerSymbol: window.FREESPINS?.triggerSymbol,
  triggerCounts: window.FREESPINS?.triggerCounts,
  awards: window.FREESPINS?.awards,
  fsEnabled: window.FREESPINS?.enabled,
  hasRectReels: typeof RECT_REELS !== 'undefined' ? RECT_REELS?.length : 'n/a',
  hasFsChip: !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'),
})));

await page.evaluate(() => {
  window.__DBG_PRE = 0; window.__DBG_RESULT = 0; window.__DBG_FS = 0;
  window.HookBus.on('preSpin', () => { window.__DBG_PRE++; });
  window.HookBus.on('onSpinResult', () => { window.__DBG_RESULT++; });
  window.HookBus.on('onFsTrigger', () => { window.__DBG_FS++; });
});
console.log('\n— click FS chip —');
await page.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]')?.click());
for (let s = 0; s < 12; s++) {
  await page.waitForTimeout(600);
  console.log(`  t+${(s+1)*0.6}s:`, await page.evaluate(() => ({
    phase: window.FSM?.phase,
    spinning: document.getElementById('spinBtn')?.classList.contains('is-spinning'),
    forceTrigger: window.FORCE_TRIGGER,
    lastScatter: window.__LAST_SCATTER_COUNT__,
    lastAward: window.__LAST_SCATTER_AWARD__,
    pre: window.__DBG_PRE, result: window.__DBG_RESULT, fs: window.__DBG_FS,
    cellSCount: Array.from(document.querySelectorAll('.cell, text')).filter(c => (c.textContent||'').toUpperCase() === (window.FREESPINS?.triggerSymbol||'S').toUpperCase()).length,
  })));
}
await browser.close();
server.kill('SIGTERM');
