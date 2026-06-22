#!/usr/bin/env node
/**
 * UQ-MULTIPLIER screenshot capture — frame where win presentation is peak.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT = resolve(REPO, 'reports/uq-mult-deep-trace');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const GAMES = [
  { slug: 'cash-eruption-V10',  path: 'dist/real-games/cash-eruption-foundry-gdd/slot.html' },
  { slug: 'huff-n-more-V10',    path: 'dist/real-games/huff-n-more-puff-gdd/slot.html' },
  { slug: 'wrath-olympus-V10',  path: 'dist/real-games/wrath-of-olympus-gdd/slot.html' },
  { slug: 'gates-olympus-V10',  path: 'dist/real-games/gates-of-olympus-1000-gdd/slot.html' },
];

(async () => {
  for (const g of GAMES) {
    if (!existsSync(resolve(REPO, g.path))) continue;
    const url = 'file://' + resolve(REPO, g.path);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#gridHost .cell'), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    // Find + click MULT chip, await STOP_POST + winsym
    const fired = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const mc = candidates.find(b => /MULT\s*[×x]\s*2/i.test((b.textContent || '').trim()));
      if (!mc) return false;
      mc.click();
      return true;
    });
    if (!fired) { await browser.close(); continue; }
    // Wait until cell--winsym appears (peak of win line)
    await page.waitForFunction(() => document.querySelector('.cell--winsym'), { timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(400); // hold so polyline draws
    // Capture geometry data inline on screenshot
    await page.evaluate(() => {
      const grid = document.querySelector('#gridHost');
      const reelsHost = document.querySelector('.reelsHost') || document.querySelector('#reelsHost') || grid.querySelector('.reelsHost');
      const svg = document.querySelector('#paylineOverlay');
      const gr = grid && grid.getBoundingClientRect();
      const rr = reelsHost && reelsHost.getBoundingClientRect();
      const sr = svg && svg.getBoundingClientRect();
      const winCells = document.querySelectorAll('.cell--winsym');
      const cellRects = [];
      winCells.forEach(c => { const r = c.getBoundingClientRect(); cellRects.push({ x: r.left, y: r.top, w: r.width, h: r.height }); });
      // Draw overlay on document for screenshot annotation
      const dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;top:0;left:0;z-index:999999;background:rgba(0,0,0,0.85);color:lime;font:11px monospace;padding:6px;border:1px solid lime;max-width:600px;white-space:pre-wrap;';
      dbg.textContent =
        'gridHost:  ' + (gr ? `${Math.round(gr.left)},${Math.round(gr.top)} ${Math.round(gr.width)}x${Math.round(gr.height)}` : 'NONE') + '\n' +
        'reelsHost: ' + (rr ? `${Math.round(rr.left)},${Math.round(rr.top)} ${Math.round(rr.width)}x${Math.round(rr.height)}` : 'NONE') + '\n' +
        'svg:       ' + (sr ? `${Math.round(sr.left)},${Math.round(sr.top)} ${Math.round(sr.width)}x${Math.round(sr.height)}` : 'NONE') + '\n' +
        'svg viewBox: ' + (svg ? svg.getAttribute('viewBox') : '-') + '\n' +
        'winCells (' + cellRects.length + '): ' + cellRects.map(c => `${Math.round(c.x)},${Math.round(c.y)} ${Math.round(c.w)}x${Math.round(c.h)}`).join(' | ');
      document.body.appendChild(dbg);
    });
    await page.screenshot({ path: resolve(OUT, g.slug + '-peak.png'), fullPage: false });
    console.log('SHOT ' + g.slug);
    await browser.close();
  }
})();
