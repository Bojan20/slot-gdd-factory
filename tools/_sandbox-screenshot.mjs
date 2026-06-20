import { chromium } from 'playwright';
const URL = 'file:///Users/vanvinklstudio/Projects/slot-gdd-factory/dist/sandbox/sandbox.html';
const OUT = '/tmp/sandbox-shot.png';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const warns = [];
page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text().slice(0, 300));
  if (msg.type() === 'warning' && !msg.text().startsWith('[HookBus] unknown event')) warns.push(msg.text().slice(0, 200));
});
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (e) { console.log('NAVIGATION FAIL:', e.message); }
await page.waitForTimeout(3000);
const bodyDims = await page.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight, bg: getComputedStyle(document.body).backgroundColor, text: document.body.innerText.slice(0,200) }));
const reelCount = await page.evaluate(() => document.querySelectorAll('.reelCol').length);
const cellCount = await page.evaluate(() => document.querySelectorAll('.cell').length);
const spinBtnVisible = await page.evaluate(() => { const b = document.getElementById('spinBtn'); if (!b) return 'NOT-FOUND'; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? 'visible' : 'hidden'; });
const sandboxPanel = await page.evaluate(() => !!document.getElementById('corti-sandbox-panel'));
const ufpChips = await page.evaluate(() => document.querySelectorAll('.ufp-chip[data-ufp-kind]').length);
console.log('body:', bodyDims);
console.log('reels:', reelCount, 'cells:', cellCount);
console.log('spinBtn:', spinBtnVisible);
console.log('sandbox panel:', sandboxPanel, '· UFP chips:', ufpChips);
console.log('errors:', errors.length);
errors.slice(0, 5).forEach(e => console.log('  ERR:', e));
console.log('warns:', warns.length);
warns.slice(0, 5).forEach(w => console.log('  WARN:', w));
await page.screenshot({ path: OUT, fullPage: false });
console.log('screenshot:', OUT);
await browser.close();
