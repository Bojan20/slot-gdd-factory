#!/usr/bin/env node
/**
 * Deep trace single game (passed as --slug=NAME) with full timeline.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const slug = (process.argv.slice(2).find(a => a.startsWith('--slug=')) || '').slice(7) || '001-rect-fs-wild-mult';
const path = resolve(REPO, 'dist/real-games', slug, 'slot.html');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  await page.goto('file://' + path, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#gridHost .cell'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const mc = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => /MULT\s*[×x]\s*2/i.test((b.textContent || '').trim()));
    if (mc) mc.click();
  });

  const t0 = Date.now();
  const samples = [];
  for (let t = 0; t < 15000; t += 100) {
    await page.waitForTimeout(80);
    const s = await page.evaluate(() => {
      const grid = document.querySelector('#gridHost') || document.querySelector('.gridHost');
      const cells = Array.from(document.querySelectorAll('.cell'));
      const polys = document.querySelectorAll('#paylineOverlay polyline, .payline-path').length;
      const svg = document.querySelector('#paylineOverlay');
      const svgRect = svg ? svg.getBoundingClientRect() : null;
      return {
        gridClasses: grid ? Array.from(grid.classList) : [],
        cellCount: cells.length,
        winsym: cells.filter(c => c.classList.contains('cell--winsym')).length,
        polys,
        svgPresent: !!svg,
        svgRect: svgRect ? { w: Math.round(svgRect.width), h: Math.round(svgRect.height) } : null,
        winAward: typeof window !== 'undefined' ? window.__WIN_AWARD__ : null,
        forceBaselineFlag: typeof window !== 'undefined' ? window.__FORCE_BASELINE_WIN__ : null,
        wpActive: typeof window !== 'undefined' ? window.__SLOT_WIN_PRESENT_ACTIVE__ : null,
        gameEvalKind: typeof window !== 'undefined' ? window.GAME_EVAL_KIND : null,
        spinState: document.querySelector('#spinBtn') ? document.querySelector('#spinBtn').getAttribute('data-state') : null,
      };
    });
    samples.push({ t: Date.now() - t0, ...s });
  }

  await browser.close();

  // Print timeline transitions
  console.log('=== ' + slug + ' ===');
  console.log('GAME_EVAL_KIND: ' + samples[0].gameEvalKind);
  let last = '';
  for (const s of samples) {
    const key = `g=[${s.gridClasses.join(',')}] cells=${s.cellCount} winsym=${s.winsym} polys=${s.polys} spin=${s.spinState} award=${s.winAward} wpA=${s.wpActive} fbFlag=${s.forceBaselineFlag}`;
    if (key !== last) {
      console.log('t=' + String(s.t).padStart(4) + 'ms  ' + key);
      last = key;
    }
  }
  if (errs.length) console.log('\nERRORS (' + errs.length + '):');
  for (const e of errs.slice(0, 10)) console.log('  ' + e.slice(0, 300));
})();
