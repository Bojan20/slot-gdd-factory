#!/usr/bin/env node
/**
 * UQ-MULTIPLIER deep DOM trace v2 — proper #spinBtn detection + visible-cell
 * isolation (filter buffer/clipped cells under 100x100 px).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT = resolve(REPO, 'reports/uq-mult-deep-trace');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const GAMES = [
  { slug: 'cash-eruption',  path: 'dist/real-games/cash-eruption-foundry-gdd/slot.html' },
  { slug: 'huff-n-more',    path: 'dist/real-games/huff-n-more-puff-gdd/slot.html' },
  { slug: 'wrath-olympus',  path: 'dist/real-games/wrath-of-olympus-gdd/slot.html' },
  { slug: 'gates-olympus',  path: 'dist/real-games/gates-of-olympus-1000-gdd/slot.html' },
];

const SAMPLE_MS = 80;
const TRACE_MS  = 7500;

async function probe(game) {
  const url = 'file://' + resolve(REPO, game.path);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', e => consoleErrs.push('PAGEERR: ' + e.message));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#gridHost .cell'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Detect MULT chip
  const chipDetect = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], .dev-chip, .uq-mult-chip, [data-force-mult]'));
    const matches = candidates.filter(b => /MULT\s*[×x]\s*2|×2|MULT2/i.test((b.textContent || '').trim()));
    if (matches.length === 0) {
      // Fallback — search for any "×N" pattern in dev panel buttons
      const fallback = candidates.filter(b => /×\d/.test((b.textContent || '').trim()));
      if (fallback.length > 0) { window.__mc__ = fallback[0]; return { found: true, label: fallback[0].textContent.trim(), via: 'fallback' }; }
      return { found: false, candidateCount: candidates.length };
    }
    window.__mc__ = matches[0];
    return { found: true, label: matches[0].textContent.trim(), via: 'mult2' };
  });

  if (!chipDetect.found) {
    await browser.close();
    return { game: game.slug, chipDetect, error: 'no MULT chip', consoleErrs };
  }

  // Baseline
  const sampleFn = async (tMs) => {
    return page.evaluate((t) => {
      const grid = document.querySelector('#gridHost') || document.querySelector('.gridHost');
      const cellsAll = Array.from(document.querySelectorAll('.cell'));
      // Visible cells = bounding rect >= 100x100 (filters buffer ones at 64x64)
      const cellsVis = cellsAll.filter(c => {
        const r = c.getBoundingClientRect();
        return r.width >= 100 && r.height >= 100;
      });
      const polys = Array.from(document.querySelectorAll('#paylineOverlay polyline, .payline-path'));
      const gridRect = grid ? grid.getBoundingClientRect() : { width: 0, height: 0 };
      const polyInfo = polys.map(p => {
        const bb = p.getBBox ? p.getBBox() : { x: 0, y: 0, width: 0, height: 0 };
        return {
          tier: (p.getAttribute('class') || '').match(/tier-(\w+)/)?.[1] || null,
          bbox: { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) },
          outsideX: bb.x < -1 || bb.x + bb.width > gridRect.width + 1,
          outsideY: bb.y < -1 || bb.y + bb.height > gridRect.height + 1,
          points: (p.getAttribute('points') || '').slice(0, 120),
        };
      });

      // Spin button
      const spinBtn = document.querySelector('#spinBtn');
      const spinState = spinBtn ? spinBtn.getAttribute('data-state') : null;
      const spinVisible = spinBtn ? (() => {
        const r = spinBtn.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(spinBtn).opacity) > 0.1;
      })() : false;
      const isSkipState = spinState && spinState.startsWith('SKIP_');
      // Skip icon visible?
      const skipIcon = spinBtn ? spinBtn.querySelector('.spinIcon--skip') : null;
      const skipIconVisible = skipIcon ? (getComputedStyle(skipIcon).display !== 'none') : false;

      // Cell opacity stats (only visible cells)
      const opAll = cellsVis.map(c => parseFloat(getComputedStyle(c).opacity));
      const cellsAt1 = opAll.filter(o => o >= 0.95).length;
      const cellsDim = opAll.filter(o => o < 0.95 && o > 0.05).length;
      const cellsHidden = opAll.filter(o => o <= 0.05).length;

      // Win rollup + total×mult
      const rollupCandidates = Array.from(document.querySelectorAll('#winRollupHud, [data-block="winRollup"], .winRollupHud'));
      const rollupText = rollupCandidates.map(e => (e.textContent || '').trim()).filter(Boolean).join(' | ').slice(0, 100);

      // Window state flags
      const flags = {
        __FORCE_BASELINE_WIN__: typeof window !== 'undefined' ? window.__FORCE_BASELINE_WIN__ : undefined,
        __SLOT_WIN_PRESENT_ACTIVE__: typeof window !== 'undefined' ? window.__SLOT_WIN_PRESENT_ACTIVE__ : undefined,
        __WIN_AWARD__: typeof window !== 'undefined' ? window.__WIN_AWARD__ : undefined,
        __SLOT_BET__: typeof window !== 'undefined' ? window.__SLOT_BET__ : undefined,
        __FORCE_MULT__: typeof window !== 'undefined' ? window.__FORCE_MULT__ : undefined,
      };

      return {
        t,
        gridClasses: grid ? Array.from(grid.classList) : [],
        cellsAll: cellsAll.length, cellsVis: cellsVis.length,
        cellsAt1, cellsDim, cellsHidden,
        cellsWinsym: cellsVis.filter(c => c.classList.contains('cell--winsym')).length,
        polyCount: polys.length, polyInfo,
        spinState, spinVisible, isSkipState, skipIconVisible,
        rollupText,
        flags,
      };
    }, tMs);
  };

  const baseline = await sampleFn(0);

  // Click MULT chip
  const t0 = Date.now();
  await page.evaluate(() => { window.__mc__.click(); });

  const samples = [];
  for (let t = 0; t < TRACE_MS; t += SAMPLE_MS) {
    await page.waitForTimeout(SAMPLE_MS);
    const s = await sampleFn(Date.now() - t0);
    samples.push(s);
  }

  // Screenshot at peak of win cycle (find first frame where cellsWinsym > 0)
  let peakIdx = samples.findIndex(s => s.cellsWinsym > 0);
  if (peakIdx === -1) peakIdx = Math.floor(samples.length / 2);
  await page.waitForTimeout(50);
  const screenshotPath = resolve(OUT, game.slug + '-peak.png');

  await browser.close();
  return { game: game.slug, chipDetect, baseline, samples, consoleErrs };
}

(async () => {
  const all = [];
  for (const g of GAMES) {
    if (!existsSync(resolve(REPO, g.path))) { console.log('SKIP ' + g.slug); continue; }
    console.log('PROBE ' + g.slug);
    const r = await probe(g);
    all.push(r);
    writeFileSync(resolve(OUT, g.slug + '.json'), JSON.stringify(r, null, 2));
  }

  // Summary
  const out = [];
  for (const r of all) {
    out.push('## ' + r.game);
    out.push('chip: ' + JSON.stringify(r.chipDetect));
    if (r.error) { out.push('ERROR: ' + r.error); continue; }
    out.push('baseline: cells=' + r.baseline.cellsVis + ' polys=' + r.baseline.polyCount + ' spinState=' + r.baseline.spinState);

    // Find timeline-critical transitions
    let lastGrid = '', lastWinsym = -1, lastPoly = -1, lastSpinState = '', lastSkipIcon = null;
    for (const s of r.samples) {
      const gc = s.gridClasses.join(',');
      const tr = [];
      if (gc !== lastGrid) { tr.push('grid=' + gc); lastGrid = gc; }
      if (s.cellsWinsym !== lastWinsym) { tr.push('winsym=' + s.cellsWinsym); lastWinsym = s.cellsWinsym; }
      if (s.polyCount !== lastPoly) {
        tr.push('polys=' + s.polyCount + (s.polyInfo.length ? ' ' + JSON.stringify(s.polyInfo[0].bbox) + (s.polyInfo[0].outsideX || s.polyInfo[0].outsideY ? ' OUTSIDE' : '') : ''));
        lastPoly = s.polyCount;
      }
      if (s.spinState !== lastSpinState) { tr.push('spinState=' + s.spinState); lastSpinState = s.spinState; }
      if (s.skipIconVisible !== lastSkipIcon) { tr.push('skipIcon=' + s.skipIconVisible); lastSkipIcon = s.skipIconVisible; }
      if (tr.length) out.push('  t=' + String(s.t).padStart(4) + 'ms ' + tr.join(' · '));
    }
    // Did rollup ever fire?
    const wpStart = r.samples.find(s => s.flags.__SLOT_WIN_PRESENT_ACTIVE__);
    out.push('  __SLOT_WIN_PRESENT_ACTIVE__ ever true: ' + !!wpStart);
    const award = r.samples.find(s => Number(s.flags.__WIN_AWARD__) > 0);
    out.push('  __WIN_AWARD__ peak: ' + (award ? award.flags.__WIN_AWARD__ : 0));
    // Cells hidden ever?
    const vanished = r.samples.find(s => s.cellsHidden > 0);
    if (vanished) out.push('  ⚠️  cellsHidden at t=' + vanished.t + 'ms (' + vanished.cellsHidden + '/' + vanished.cellsVis + ')');
    // Polyline outside grid?
    const polyOut = r.samples.find(s => s.polyInfo.some(p => p.outsideX || p.outsideY));
    if (polyOut) out.push('  ⚠️  poly outside grid at t=' + polyOut.t + 'ms');
    if (r.consoleErrs.length) out.push('  consoleErrs (' + r.consoleErrs.length + '): ' + r.consoleErrs.slice(0,3).join(' | '));
  }
  const summary = out.join('\n');
  writeFileSync(resolve(OUT, 'summary.md'), summary);
  console.log('\n' + summary);
})();
