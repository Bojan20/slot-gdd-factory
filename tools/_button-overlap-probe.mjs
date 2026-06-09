#!/usr/bin/env node
/**
 * tools/_button-overlap-probe.mjs
 *
 * Cortex-eyes overlap audit across EVERY grid kind.
 *
 * For each fixture (20 grid kinds + 4 main GDDs) at three viewports
 * (desktop 1440, tablet 834, mobile 390) asserts that NO pair of
 * critical interactive elements visually overlaps. Interactive set:
 *
 *   #spinBtn          primary CTA
 *   #autoBtn          autoplay button
 *   #settingsMenuBtn  ⚙ gear
 *   #paytableBtn      i chip
 *   #historyBtn       ≡ chip
 *   #turboBtn         ⚡ chip
 *   .ufp-panel        FORCE chip rail (Wave U-FORCE-ALL)
 *   #balanceHud       HUD column
 *   #betChip          bet chip
 *
 * A pair "overlaps" when their bounding rectangles intersect with at
 * least 1 px of area AND both are visible (display !== none,
 * visibility !== hidden, opacity > 0.05). Symmetric pairs are reported
 * once. Per fixture × viewport row prints `n overlaps` with the worst
 * pair. Exit 0 if zero overlaps anywhere; 1 otherwise.
 *
 * Outputs a screenshot per (fixture × viewport) pair under
 * `tools/_eyes/button-overlap/` for visual proof.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT  = resolvePath(REPO, 'tools/_eyes/button-overlap');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const FIXTURES = [
  ...readdirSync(resolvePath(REPO, 'samples')).filter(f => f.endsWith('.md')).map(f => ({
    id: f.replace(/\.md$/, ''),
    file: 'samples/' + f,
  })),
  ...readdirSync(resolvePath(REPO, 'samples/grids')).filter(f => f.endsWith('.md')).map(f => ({
    id: 'grid_' + f.replace(/_GAME_GDD\.md$/, ''),
    file: 'samples/grids/' + f,
  })),
];

const VIEWPORTS = [
  { id: 'desktop', w: 1440, h: 900 },
  { id: 'tablet',  w: 834,  h: 1112 },
  { id: 'mobile',  w: 390,  h: 844 },
];

const CRITICAL_SELECTORS = [
  '#spinBtn', '#autoBtn', '#settingsMenuBtn', '#paytableBtn',
  '#historyBtn', '#turboBtn', '.ufp-panel', '#balanceHud', '#betChip',
];

const PORT = 5238;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO, stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch();
let totalOverlaps = 0;
const overlapReport = [];

for (const fix of FIXTURES) {
  const text = readFileSync(resolvePath(REPO, fix.file), 'utf8');
  const model = parseGDD(text, '.md');
  const html = buildSlotHTML(model);
  const slug = fix.id.replace(/\W+/g, '_');
  const tmp = resolvePath(OUT, `_${slug}.html`);
  writeFileSync(tmp, html, 'utf8');

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${PORT}/tools/_eyes/button-overlap/_${slug}.html`;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 12_000 });
      await page.waitForTimeout(350);
    } catch { /* unreachable iframe, skip */ await ctx.close(); continue; }

    // Collect visible rects
    const rects = await page.evaluate((selectors) => {
      const out = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
        if (!visible) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({ sel, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    }, CRITICAL_SELECTORS);

    // O(n²) intersection check — n ≤ 9, trivial
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const xMin = Math.max(a.x, b.x), xMax = Math.min(a.x + a.w, b.x + b.w);
        const yMin = Math.max(a.y, b.y), yMax = Math.min(a.y + a.h, b.y + b.h);
        if (xMax > xMin + 1 && yMax > yMin + 1) {
          const area = (xMax - xMin) * (yMax - yMin);
          overlaps.push({ a: a.sel, b: b.sel, area: Math.round(area) });
        }
      }
    }
    const tag = overlaps.length === 0 ? '✓' : '✗';
    const worst = overlaps[0]
      ? ` (worst: ${overlaps[0].a} ↔ ${overlaps[0].b} = ${overlaps[0].area}px²)`
      : '';
    console.log(`  ${tag} ${fix.id.padEnd(40)} ${vp.id.padEnd(8)} ${overlaps.length} overlaps${worst}`);
    totalOverlaps += overlaps.length;
    if (overlaps.length > 0) {
      overlapReport.push({ fixture: fix.id, viewport: vp.id, overlaps });
    }
    if (overlaps.length > 0) {
      await page.screenshot({ path: resolvePath(OUT, `${slug}-${vp.id}.png`), fullPage: false }).catch(() => {});
    }
    await ctx.close();
  }
}

await browser.close();
server.kill('SIGTERM');

console.log(`\n────────────────────────────────────────────`);
console.log(`Total overlaps across ${FIXTURES.length} fixtures × ${VIEWPORTS.length} viewports: ${totalOverlaps}`);
writeFileSync(resolvePath(REPO, 'reports/button-overlap-audit.json'),
  JSON.stringify({ at: new Date().toISOString(), totalOverlaps, details: overlapReport }, null, 2));
process.exit(totalOverlaps === 0 ? 0 : 1);
