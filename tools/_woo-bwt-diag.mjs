import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 5239;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/dist/wrath-of-olympus.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const r = await page.evaluate(async () => {
    const before = {
      bwtFn: typeof window.bigWinTierEnter,
      stateExists: !!window.BIG_WIN_TIER_STATE,
      enabled: window.BIG_WIN_TIER_STATE?.enabled,
      walkActive: window.BIG_WIN_TIER_STATE?.walkActive,
      bodyClasses: document.body.className,
    };
    if (window.bigWinTierEnter) window.bigWinTierEnter(5, 1500);
    await new Promise(r => setTimeout(r, 500));
    const after = {
      walkActive: window.BIG_WIN_TIER_STATE?.walkActive,
      current: window.BIG_WIN_TIER_STATE?.current,
      bannerExists: !!document.querySelector('.big-win-tier-banner'),
      bannerDataTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
    };
    return { before, after };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
} finally { srv.kill(); }
