#!/usr/bin/env node
/* Payline overlay spot-check
   Loads each line-pays HTML, force-seeds the RECT_REELS strips with a
   guaranteed 5-of-a-kind on the middle row, calls applyWinHighlight(),
   then inspects #paylineOverlay for at least one rendered <polyline>.
   PASS if the SVG contains a polyline whose `points` attribute has
   >= 3 coordinate pairs. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gallery = resolve(__dirname, '..', 'dist', 'gallery');
const wanted = readdirSync(gallery).filter(f => f.endsWith('.html') && f !== 'index.html');

const results = [];
const browser = await chromium.launch();
try {
  for (const file of wanted) {
    const url = 'file://' + resolve(gallery, file);
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => !!window.RECT_REELS, { timeout: 5000 }).catch(() => {});
    /* Only line-pays kinds have PAYLINE_POOL; skip the rest cleanly. */
    const isLinePays = await page.evaluate(() => {
      return Array.isArray(window.PAYLINE_POOL) && window.PAYLINE_POOL.length > 0;
    });
    if (!isLinePays) {
      results.push({ file, mode: 'cluster', polylinePts: 0, ok: true, note: 'cluster — skipped' });
      await page.close();
      continue;
    }
    /* Force-seed: stamp the middle visible row of every reel with the
       first registered HP symbol so every middle-row payline becomes
       a 5-of-a-kind. Then invoke applyWinHighlight directly. */
    const seedResult = await page.evaluate(() => {
      const sym = (window.SYMBOL_REGISTRY?.regularPay || [])[0] || 'A';
      const reels = window.RECT_REELS || [];
      for (const r of reels) {
        const vis = r.visibleRows || 3;
        const mid = 1 + Math.floor((vis - 1) / 2);
        if (r.cells && r.cells[mid]) r.cells[mid].textContent = sym;
      }
      /* Probe the overlay synchronously: call detectLineWins → get the
         winning events → draw the FIRST one. This bypasses the async
         cycle (which would draw, then clear on the last tick — the
         async resolve only fires after the SVG is wiped clean). */
      const events = (typeof window.detectLineWins === 'function')
        ? window.detectLineWins() : [];
      if (events.length > 0 && typeof window.drawPaylineOverlay === 'function') {
        window.drawPaylineOverlay(events[0]);
      }
      const svg = document.getElementById('paylineOverlay');
      const polylines = svg ? Array.from(svg.querySelectorAll('polyline')) : [];
      const ptsCount = polylines.length > 0
        ? polylines[0].getAttribute('points').split(/\s+/).filter(Boolean).length
        : 0;
      return {
        sym,
        eventCount: events.length,
        firstEvSymbol: events[0]?.symbol,
        firstEvLine: events[0]?.lineIndex,
        firstEvLen: events[0]?.matchLength,
        polylineCount: polylines.length,
        polylinePts: ptsCount,
      };
    });
    results.push({
      file,
      mode: 'line',
      eventCount: seedResult.eventCount,
      polylineCount: seedResult.polylineCount,
      polylinePts: seedResult.polylinePts,
      ok: seedResult.polylineCount >= 1 && seedResult.polylinePts >= 3,
      sym: seedResult.sym,
      firstEvLine: seedResult.firstEvLine,
      firstEvLen: seedResult.firstEvLen,
      errs: errs.length,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

const fail = results.filter(r => !r.ok);
console.log('| file | mode | events | line | len | polys | pts | sym | errs | ok |');
console.log('|---|---|---:|---:|---:|---:|---:|---|---:|:---:|');
for (const r of results) {
  console.log('| ' + r.file + ' | ' + r.mode +
              ' | ' + (r.eventCount ?? '-') +
              ' | ' + (r.firstEvLine ?? '-') +
              ' | ' + (r.firstEvLen ?? '-') +
              ' | ' + (r.polylineCount ?? '-') +
              ' | ' + (r.polylinePts ?? '-') +
              ' | ' + (r.sym ?? '-') +
              ' | ' + (r.errs ?? '-') +
              ' | ' + (r.ok ? '✅' : '❌') + ' |');
}
console.log('');
console.log(fail.length === 0 ? '✅ ALL ' + results.length + ' fixtures pass' : '❌ ' + fail.length + ' / ' + results.length + ' failed');
process.exit(fail.length === 0 ? 0 : 1);
