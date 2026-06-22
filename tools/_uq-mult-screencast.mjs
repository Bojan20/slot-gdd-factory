#!/usr/bin/env node
/**
 * UQ-MULT screencast — 8 sequential screenshots over 2.4s to see animation.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT = resolve(REPO, 'reports/uq-mult-screencast');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const GAMES = [
  { slug: 'cash-eruption', path: 'dist/real-games/cash-eruption-foundry-gdd/slot.html' },
  { slug: 'huff-n-more',   path: 'dist/real-games/huff-n-more-puff-gdd/slot.html' },
];

(async () => {
  for (const g of GAMES) {
    if (!existsSync(resolve(REPO, g.path))) continue;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
    await page.goto('file://' + resolve(REPO, g.path), { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#gridHost .cell'), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const mc = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(b => /MULT\s*[×x]\s*2/i.test((b.textContent || '').trim()));
      if (mc) mc.click();
    });

    // 8 frames over 3.5s (covers reel stop + winsym + rollup phases)
    const frames = [200, 600, 1400, 2000, 2200, 2400, 2700, 3200];
    for (let i = 0; i < frames.length; i++) {
      const targetT = frames[i];
      const prev = i === 0 ? 0 : frames[i - 1];
      await page.waitForTimeout(targetT - prev);
      // Annotate with current state
      await page.evaluate(({ idx, t }) => {
        const old = document.getElementById('__shotAnnotate');
        if (old) old.remove();
        const winsym = document.querySelectorAll('.cell--winsym').length;
        const polys = document.querySelectorAll('#paylineOverlay polyline').length;
        const spinBtn = document.querySelector('#spinBtn');
        const ann = document.createElement('div');
        ann.id = '__shotAnnotate';
        ann.style.cssText = 'position:fixed;top:0;left:0;z-index:9999999;background:black;color:cyan;font:14px monospace;padding:8px;';
        ann.textContent = `FRAME ${idx + 1}/8  t≈${t}ms  winsym=${winsym}  polys=${polys}  spin=${spinBtn ? spinBtn.getAttribute('data-state') : 'N/A'}`;
        document.body.appendChild(ann);
      }, { idx: i, t: targetT });
      await page.screenshot({ path: resolve(OUT, `${g.slug}-f${String(i+1).padStart(2,'0')}-${targetT}ms.png`), fullPage: false });
    }
    console.log('CAST ' + g.slug);
    await browser.close();
  }
})();
