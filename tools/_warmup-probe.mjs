import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrs = [];
page.on('pageerror', e => consoleErrs.push(`PAGEERROR: ${e.message}`));
page.on('dialog', async d => { consoleErrs.push(`DIALOG: ${d.type()} - ${d.message()}`); await d.dismiss(); });

await page.goto('http://127.0.0.1:5181/preview/cash-eruption-foundry-gdd', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

const initial = await page.evaluate(() => ({
  hudExists: !!document.getElementById('liveRtpHud'),
  badgeClass: document.getElementById('lrhDrift')?.className,
  badgeText: document.getElementById('lrhDrift')?.textContent,
  cfg: window.LRH_CFG || null,
  n: window.__LIVE_RTP_HUD__?.n,
  warmup: document.documentElement.outerHTML.match(/warmupSpins["\s:]+(\d+)/)?.[1],
}));
console.log('INITIAL:', JSON.stringify(initial, null, 2));

// click spin 30 puta
for (let i = 0; i < 30; i++) {
  try {
    await page.evaluate(() => {
      const btn = document.querySelector('#spinBtn, .spin-btn, [data-action="spin"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(120);
  } catch {}
}
await page.waitForTimeout(500);

const after = await page.evaluate(() => ({
  badgeClass: document.getElementById('lrhDrift')?.className,
  badgeText: document.getElementById('lrhDrift')?.textContent,
  n: window.__LIVE_RTP_HUD__?.n,
  hits: window.__LIVE_RTP_HUD__?.hits,
  rtpSum: window.__LIVE_RTP_HUD__?.rtpSum,
  measuredCheck: window.__LIVE_RTP_HUD__ && window.__LIVE_RTP_HUD__.n > 0
    ? (window.__LIVE_RTP_HUD__.rtpSum / window.__LIVE_RTP_HUD__.n)
    : null,
  toastVisible: document.getElementById('driftToast')?.classList.contains('visible'),
}));
console.log('\nAFTER 30 SPINS:', JSON.stringify(after, null, 2));
console.log('\nCONSOLE ERRORS:', consoleErrs.length === 0 ? 'NONE' : consoleErrs.slice(0, 5));

await browser.close();
