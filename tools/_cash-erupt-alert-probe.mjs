// Probe: spin Cash Eruption N times, capture alerts/console/DOM drift state.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5181/preview/cash-eruption-foundry-gdd';
const SPINS = 30;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const events = [];
page.on('console', m => events.push({ t: 'console', type: m.type(), text: m.text() }));
page.on('pageerror', e => events.push({ t: 'pageerror', msg: String(e) }));
page.on('dialog', async d => { events.push({ t: 'dialog', type: d.type(), msg: d.message() }); await d.dismiss(); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

// Read initial HUD + backend state
const initial = await page.evaluate(() => ({
  backendOk: window.__LIVE_RTP_HUD__ && window.__LIVE_RTP_HUD__.backendOk,
  target: window.__LIVE_RTP_TARGET__,
  hookbus: !!window.HookBus,
  spinBtn: !!document.querySelector('#spinBtn'),
  hudOnPage: !!document.querySelector('#liveRtpHud'),
  toastOnPage: !!document.querySelector('#driftToast'),
}));

const spinBtn = await page.$('#spinBtn');
let spinsPerformed = 0;
if (spinBtn) {
  for (let i = 0; i < SPINS; i++) {
    try {
      await spinBtn.click({ timeout: 1000 });
      spinsPerformed++;
    } catch (_) { /* might be disabled mid-spin */ }
    await page.waitForTimeout(350);
  }
}

await page.waitForTimeout(1500);

const final = await page.evaluate(() => {
  const hud = window.__LIVE_RTP_HUD__ || {};
  const drift = document.getElementById('lrhDrift');
  const toast = document.getElementById('driftToast');
  return {
    n: hud.n, rtpSum: hud.rtpSum, hits: hud.hits, backendOk: hud.backendOk,
    measured: hud.n > 0 ? (hud.rtpSum / hud.n) : null,
    target: window.__LIVE_RTP_TARGET__,
    driftLabel: drift ? drift.textContent : null,
    driftClass: drift ? drift.className : null,
    toastClass: toast ? toast.className : null,
    toastHead: document.getElementById('dtHead')?.textContent || null,
    toastBody: document.getElementById('dtBody')?.textContent || null,
    lastWin: window.__LAST_SPIN_WIN__,
    bet: window.__SLOT_BET__,
  };
});

console.log('INITIAL:', JSON.stringify(initial, null, 2));
console.log('SPINS_PERFORMED:', spinsPerformed);
console.log('FINAL:', JSON.stringify(final, null, 2));
console.log('EVENTS_COUNT:', events.length);
for (const e of events.slice(0, 80)) console.log('EV', JSON.stringify(e));

await browser.close();
