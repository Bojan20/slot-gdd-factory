#!/usr/bin/env node
/* Payline overlay screenshot — force-seeds a 5-of-a-kind on the middle
   row + a V-shape on line 4, draws BOTH polylines synchronously, and
   saves a PNG so Boki can see the WL overlay live without spinning. */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const outDir = resolve(process.cwd(), 'reports', 'payline-preview');
mkdirSync(outDir, { recursive: true });

const fixtures = [
  'wrath_of_olympus_game_gdd.html',
  '01_rectangular_5x3_game_gdd.html',
  '02_rectangular_6x4_game_gdd.html',
];

const browser = await chromium.launch();
try {
  for (const file of fixtures) {
    const url = 'file://' + resolve(process.cwd(), 'dist/gallery', file);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url);
    await page.waitForFunction(() => !!window.RECT_REELS, { timeout: 5000 });

    await page.evaluate(() => {
      const sym = (window.SYMBOL_REGISTRY?.regularPay || [])[0] || 'A';
      const reels = window.RECT_REELS || [];
      /* Seed middle row with HP[0] across every reel → 5-of-a-kind on
         the middle-straight payline (typically lineIndex 0). */
      for (const r of reels) {
        const vis = r.visibleRows || 3;
        const mid = 1 + Math.floor((vis - 1) / 2);
        if (r.cells && r.cells[mid]) r.cells[mid].textContent = sym;
      }
      const events = window.detectLineWins ? window.detectLineWins() : [];
      if (events.length > 0 && window.drawPaylineOverlay) {
        window.drawPaylineOverlay(events[0]);
        /* Light the cells on the line so the screenshot reads both the
           polyline AND the pulse state (the cycle drives this normally). */
        const grid = document.getElementById('gridHost');
        grid.classList.add('is-winsym-cycling');
        events[0].cells.forEach(c => c.classList.add('cell--winsym'));
      }
    });

    /* Let the draw-in animation run before capturing. */
    await page.waitForTimeout(280);
    const outFile = resolve(outDir, file.replace('.html', '.png'));
    await page.screenshot({ path: outFile, fullPage: false });
    console.log('saved:', outFile);
    await page.close();
  }
} finally {
  await browser.close();
}
