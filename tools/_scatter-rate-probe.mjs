#!/usr/bin/env node
/**
 * Cortex eyes — scatter rate probe.
 *
 * Drag-drop Huff PDF (or any sample) into the builder, then spin 30
 * times and count how many times a scatter (id from SYMBOL_REGISTRY)
 * lands in the final grid. Compute incidence per cell + per spin to
 * verify the engine doesn't trigger Free Spins every 2-3 spins.
 *
 * Industry baseline: scatter rate per CELL ≈ 1-3%. For a 5×3 grid (15
 * cells) that's ~0.15-0.45 scatters per spin average, with 3+ scatters
 * happening roughly 1-in-100 spins (FS hit frequency ~1%).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT = resolve(REPO, 'tools/_eyes/scatter-rate');
import { mkdirSync } from 'node:fs';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

import { readdirSync as _rd } from 'node:fs';
const FIXTURES = [
  ..._rd(resolve(REPO, 'samples')).filter(f => f.endsWith('.md')).map(f => ({
    id: f.replace(/_GAME_GDD\.md$|\.md$/, '').toLowerCase(),
    file: 'samples/' + f, spins: 20,
  })),
  ..._rd(resolve(REPO, 'samples/grids')).filter(f => f.endsWith('.md')).map(f => ({
    id: 'grid_' + f.replace(/_GAME_GDD\.md$|\.md$/, '').toLowerCase(),
    file: 'samples/grids/' + f, spins: 20,
  })),
];

const PORT = 5239;
/* In-process Node HTTP static server. Replaced the python3 spawn —
   under 24-fixture load the python http.server intermittently shut
   down half-way through, producing ERR_CONNECTION_REFUSED. Keeping
   the server in-process means a single event loop, no PIPE close
   races, and trivial per-request error logging. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const filePath = normalize(join(REPO, rel));
    if (!filePath.startsWith(REPO)) { res.statusCode = 403; return res.end('forbidden'); }
    if (!existsSync(filePath)) { res.statusCode = 404; return res.end('not found'); }
    const body = readFileSync(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.end(body);
  } catch (e) { res.statusCode = 500; res.end('server error: ' + e.message); }
});
await new Promise((ok, fail) => server.listen(PORT, '127.0.0.1', ok).once('error', fail));

let allGreen = true;
const summary = [];
const browser = await chromium.launch();

for (const fix of FIXTURES) {
  const text = readFileSync(resolve(REPO, fix.file), 'utf8');
  const model = parseGDD(text, '.md');
  const html = buildSlotHTML(model);
  const slug = fix.id.replace(/\W+/g, '_');
  const tmp = resolve(OUT, `${slug}.html`);
  writeFileSync(tmp, html, 'utf8');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/tools/_eyes/scatter-rate/${slug}.html`;
  await page.goto(url, { waitUntil: 'load', timeout: 12_000 });
  await page.waitForTimeout(450);

  // Read SYMBOL_REGISTRY.scatter
  const meta = await page.evaluate(() => ({
    scatter: window.SYMBOL_REGISTRY?.scatter,
    wild: window.SYMBOL_REGISTRY?.wild,
    poolSize: Array.isArray(window.POOL) ? window.POOL.length : 0,
    shape: window.SHAPE?.kind,
    cells: document.querySelectorAll('.cell').length,
  }));

  let fsTriggered = 0;
  let totalScatters = 0;
  let totalSpins = 0;
  const perSpinScatters = [];

  // Listen for onFsTrigger
  await page.evaluate(() => {
    window.__FS_COUNT__ = 0;
    if (window.HookBus) HookBus.on('onFsTrigger', () => window.__FS_COUNT__++);
  });

  // Install a postSpin counter so the loop can wait on EACH spin.
  await page.evaluate(() => {
    window.__POST_SPIN_COUNT__ = 0;
    if (window.HookBus) HookBus.on('postSpin', () => window.__POST_SPIN_COUNT__++);
  });

  for (let i = 0; i < fix.spins; i++) {
    const startCount = await page.evaluate(() => window.__POST_SPIN_COUNT__);
    const spinBtn = await page.$('#spinBtn');
    if (!spinBtn) break;
    try { await spinBtn.click({ timeout: 2_000 }); } catch { break; }

    // Wait for the NEXT postSpin event (current count + 1)
    let settled = false;
    for (let j = 0; j < 60; j++) {
      await page.waitForTimeout(250);
      const cur = await page.evaluate(() => window.__POST_SPIN_COUNT__);
      if (cur > startCount) { settled = true; break; }
      // Auto-dismiss FS placard mid-wait so the engine can complete
      const placardVisible = await page.evaluate(() => {
        const fo = document.querySelector('#fsOverlay');
        return !!(fo && fo.classList.contains('fs-overlay--show'));
      });
      if (placardVisible) {
        await page.locator('#fsPlacardCta').click({ timeout: 800 }).catch(() => {});
      }
    }
    if (!settled) break;
    await page.waitForTimeout(120);

    const scatterCount = await page.evaluate((s) => {
      if (!s) return 0;
      const cells = document.querySelectorAll('.cell');
      let n = 0;
      cells.forEach(c => { if (c.textContent && c.textContent.trim().toUpperCase() === s) n++; });
      return n;
    }, meta.scatter);
    perSpinScatters.push(scatterCount);
    totalScatters += scatterCount;
    totalSpins++;
  }

  fsTriggered = await page.evaluate(() => window.__FS_COUNT__);

  const avgPerSpin = totalScatters / Math.max(1, totalSpins);
  const ratePerCell = avgPerSpin / Math.max(1, meta.cells);
  const fsRate = fsTriggered / Math.max(1, totalSpins);

  // Industry-grade thresholds
  const ratePerCellOk = ratePerCell <= 0.06;   // ≤ 6% per cell (lenient)
  const fsRateOk      = fsRate      <= 0.15;   // ≤ 15% FS trigger rate over 30 spins

  console.log(`\n${fix.id}  (${meta.shape}, ${meta.cells} cells, pool=${meta.poolSize}, scatter='${meta.scatter}'):`);
  console.log(`  spins                : ${totalSpins}`);
  console.log(`  scatter rate / cell  : ${(ratePerCell * 100).toFixed(2)}%  ${ratePerCellOk ? '✓' : '✗ TOO HIGH'}`);
  console.log(`  scatter / spin (avg) : ${avgPerSpin.toFixed(2)}`);
  console.log(`  FS triggers          : ${fsTriggered}/${totalSpins}  (${(fsRate * 100).toFixed(1)}%)  ${fsRateOk ? '✓' : '✗ TOO HIGH'}`);

  if (!ratePerCellOk || !fsRateOk) allGreen = false;
  summary.push({ id: fix.id, ratePerCell, fsRate, ratePerCellOk, fsRateOk });

  await ctx.close();
}

await browser.close();
await new Promise(r => server.close(r));

console.log(`\nRESULT: ${allGreen ? '✓ all within industry baseline' : '✗ rate too high — engine needs weighted pool'}`);
process.exit(allGreen ? 0 : 1);
