#!/usr/bin/env node
/**
 * Deep trace + capture events passed to playWinSymCycle in rainbow-riches.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

(async () => {
  const url = 'file://' + resolve(REPO, 'dist/real-games/25-rainbow-riches-online-ports-megaways-slingo-cluster/slot.html');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#gridHost'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Capture cells in flight
  await page.evaluate(() => {
    window.__capture__ = { events: null, forceCells: null };
    const origDraw = window.drawPaylineOverlay || (typeof drawPaylineOverlay !== 'undefined' ? drawPaylineOverlay : null);
    // Hook applyWinHighlight to read events
    const origAW = window.applyWinHighlight;
    if (origAW) {
      window.applyWinHighlight = async function () {
        const r = await origAW.apply(this, arguments);
        if (!window.__capture__.events) {
          window.__capture__.events = Array.isArray(r) ? r.map(e => ({
            symbol: e.symbol, tier: e.tier, lineIndex: e.lineIndex, payX: e.payX,
            forcedBaseline: e.forcedBaseline, cellsLen: Array.isArray(e.cells) ? e.cells.length : null,
            sampleCell: Array.isArray(e.cells) && e.cells[0] ? {
              tagName: e.cells[0].tagName,
              className: e.cells[0].className,
              textContent: (e.cells[0].textContent || '').slice(0, 20),
              hasClassList: !!e.cells[0].classList,
              isCell: e.cells[0].classList && e.cells[0].classList.contains('cell'),
            } : null,
          })) : null;
        }
        return r;
      };
    }
  });

  await page.evaluate(() => {
    const mc = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => /MULT\s*[×x]\s*2/i.test((b.textContent || '').trim()));
    if (mc) mc.click();
  });

  await page.waitForTimeout(5000);

  const r = await page.evaluate(() => {
    return { capture: window.__capture__ };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})();
