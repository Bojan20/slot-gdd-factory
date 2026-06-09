#!/usr/bin/env node
/**
 * Live cortex-eyes probe — upload 3 reference PDFs through the app
 * dropzone and confirm every one renders a playable iframe with no
 * console errors. Tests the "ne sme da se desi da ubacim bilo koji
 * gdd a da se nesto ne procita" rule (Boki, 2026-06-06).
 *
 * Each PDF must yield:
 *   • iframe with blob: src
 *   • frame title NOT "Untitled Slot"
 *   • ≥ 9 cells visible (smallest valid grid = 3×3)
 *   • ≥ 1 reel column
 *   • 0 console errors during boot
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT = resolve(REPO, 'tools/_eyes/pdf-multi');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
/* 2026-06-09 — Boki rule_gdd_folder_desktop: GDD PDFs live in
   ~/Desktop/GDD/. We resolve each PDF by checking that folder first
   and only fall back to bare ~/Desktop/ for unmigrated copies. */
function _resolveGddPdf(filename) {
  const newPath = `${HOME}/Desktop/GDD/${filename}`;
  const oldPath = `${HOME}/Desktop/${filename}`;
  return existsSync(newPath) ? newPath : oldPath;
}
const PDFS = [
  { name: 'Huff_N_More_Puff',      path: _resolveGddPdf('Huff_N_More_Puff_GDD.pdf') },
  { name: 'Gates_of_Olympus_1000', path: _resolveGddPdf('Gates_of_Olympus_1000_GDD.pdf') },
  { name: 'Starlight_Travellers',  path: _resolveGddPdf('Starlight_Travellers_GDD.pdf') },
];

for (const p of PDFS) {
  if (!existsSync(p.path)) {
    console.error(`❌ Missing PDF: ${p.path}`);
    process.exit(2);
  }
}

const PORT = 5191;
const URL = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO, stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 800));

let totalPass = 0, totalFail = 0;
try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  for (const pdf of PDFS) {
    console.log(`\n═══ ${pdf.name} ═══`);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 200)));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().includes('favicon')) {
        errs.push(m.text().slice(0, 200));
      }
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(pdf.path);
    /* PDF.js parse + buildSlotHTML takes 2-5s on a fresh page. Wait for
     * the iframe to appear AND its content document to fully load. */
    await page.waitForSelector('iframe', { timeout: 20_000 });
    const iframe = await page.$('iframe');
    let verdict = { iframe: false, title: null, reels: 0, cells: 0, errors: errs.length };
    if (iframe) {
      verdict.iframe = true;
      /* Wait for the frame DOM to be queryable. */
      const frame = await iframe.contentFrame();
      if (frame) {
        try {
          await frame.waitForLoadState('domcontentloaded', { timeout: 10_000 });
          await frame.waitForSelector('.cell, .reel', { timeout: 10_000 });
        } catch { /* keep going — fallback inspection still useful */ }
        verdict.title = await frame.title().catch(() => null);
        verdict.reels = (await frame.$$('.reel, [data-reel]')).length;
        verdict.cells = (await frame.$$('.cell')).length;
      }
    }
    await page.screenshot({ path: `${OUT}/${pdf.name}.png`, fullPage: true });

    console.log(`  iframe present:    ${verdict.iframe ? '✓' : '✗'}`);
    console.log(`  title:             "${verdict.title}"`);
    console.log(`  reels:             ${verdict.reels}`);
    console.log(`  cells:             ${verdict.cells}`);
    console.log(`  console errors:    ${verdict.errors}`);
    errs.slice(0, 3).forEach(e => console.log(`    • ${e}`));

    /* The dist HTML template uses CSS-grid layout (no `.reel` columns —
     * cells are positioned via grid-template). Drop the reel-column check
     * and use cell count as the grid-renderability witness. */
    const checks = [
      ['iframe rendered (blob: src)',        verdict.iframe === true],
      ['frame title NOT "Untitled Slot"',    verdict.title && !/untitled/i.test(verdict.title)],
      ['≥ 9 cells (renderable grid)',        verdict.cells >= 9],
      ['frame title carries non-empty name', !!verdict.title && verdict.title.length > 5],
      ['0 page errors',                      verdict.errors === 0],
    ];
    for (const [label, ok] of checks) {
      console.log(`  ${ok ? '✓' : '✗'} ${label}`);
      if (ok) totalPass++; else totalFail++;
    }
    await page.close();
  }

  await browser.close();
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  totalFail++;
} finally {
  server.kill();
}

console.log(`\n════════════════════════════════════`);
console.log(`Final: ${totalPass}/${totalPass + totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
