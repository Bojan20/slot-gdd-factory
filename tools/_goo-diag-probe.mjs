import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 5237;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE_ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CON_ERR ' + m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${PORT}/dist/gates-of-olympus-1000.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const bw = document.getElementById('devBwBtn');
    return bw && !bw.disabled;
  }, { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__TRACE__ = { events: [] };
    const evs = ['preSpin','onSpinResult','onWinPresentationStart','onWinPresentationEnd',
                 'onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd','postSpin'];
    if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__TRACE__.events.push({ n, t: performance.now()|0, ...p })));
    document.getElementById('devBwBtn').click();
  });
  await page.waitForTimeout(28000);
  const trace = await page.evaluate(() => window.__TRACE__);
  console.log('Events:');
  trace.events.forEach(e => console.log(`  +${e.t}ms ${e.n}${e.tier !== undefined ? ' tier=' + e.tier : ''}${e.reason !== undefined ? ' reason=' + e.reason : ''}${e.x !== undefined ? ' x=' + e.x : ''}`));
  console.log('Errors:');
  errors.slice(0, 10).forEach(e => console.log('  ' + e));
  await browser.close();
} finally { srv.kill(); }
