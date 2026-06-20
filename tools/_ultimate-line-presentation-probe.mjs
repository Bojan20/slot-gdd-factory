#!/usr/bin/env node
/**
 * tools/_ultimate-line-presentation-probe.mjs · D-8 LINE-PRESENTATION REAL
 *
 * Boki 2026-06-20: "Win linije prezentracije blokovi ne rade pravilno u
 *                   svakom gddu. ne prikazuju se pravilno. iskoristi agente
 *                   i resi taj problem da u svakom mogucewm gddu radi taj
 *                   blok savrseno"
 *
 * Real headless Chromium probe koji za SVAKU igru forsira drawPaylineOverlay
 * sa SVAKOM shape-om koju eval blokovi mogu da emituju:
 *
 *   1. DOM elementi          (line-pays, ways, pay_anywhere)
 *   2. {r, c, idx} metadata  (cluster-pays)
 *   3. {reel, row} legacy    (winLineFlash istorijski)
 *   4. {idx}-only            (linear index)
 *
 * Za svaku shape:
 *   • brišu se postojeći polyline-i iz #paylineOverlay
 *   • pozove se window.drawPaylineOverlay({ cells: <forsirana shape>, ... })
 *   • prebroje se <polyline> elementi
 *   • mora biti >= 1 polyline → PASS
 *
 * Bez ovog probe-a, klister-pays igre (Starlight 6×5) bi tiho prešle CI
 * jer postojeći payline-overlay-spot-check.mjs ne testira cluster mode.
 *
 * Output:
 *   • reports/_ultimate-line-presentation/run-<ts>.json
 *   • exit 0 ako sve igre × sve shape-ove daju polyline
 *   • exit 1 ako ijedna shape ne crta polyline u ijednoj igri
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-line-presentation');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

/**
 * Run all 4 shape tests on one game. Returns per-shape verdict.
 */
async function runOneGame(browser, gameDir) {
  const slot = resolve(DIST, gameDir, 'slot.html');
  if (!existsSync(slot)) return { game: gameDir, error: 'slot.html missing' };

  const url = pathToFileURL(slot).href;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.page.push(String(e).slice(0, 240)));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  /* Sanity: globals contract loaded, paylineOverlay present, resolver wired. */
  const sanity = await page.evaluate(() => ({
    hasDraw: typeof window.drawPaylineOverlay === 'function',
    hasResolver: typeof window.__resolveCellElement === 'function',
    hasReels: Array.isArray(window.RECT_REELS),
    reelsLen: Array.isArray(window.RECT_REELS) ? window.RECT_REELS.length : 0,
    shape: window.SHAPE ? { reels: window.SHAPE.reels, rows: window.SHAPE.rows } : null,
    svgPresent: !!document.getElementById('paylineOverlay'),
  }));

  /* Force each shape, count polylines drawn. */
  const shapes = ['dom', 'cluster-rcidx', 'legacy-reel-row', 'idx-only'];
  const perShape = {};

  for (const shape of shapes) {
    const result = await page.evaluate((shapeKind) => {
      /* Clear existing polylines */
      const svg = document.getElementById('paylineOverlay');
      if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);

      /* Determine grid shape to pick valid cells. */
      const reels = (window.SHAPE && window.SHAPE.reels) || window.REELS || 5;
      const rows = (window.SHAPE && window.SHAPE.rows) || window.ROWS || 3;

      /* Build a 4-cell horizontal payload in row 0, cols 0..3 (or shorter
         if grid is narrower). */
      const N = Math.min(4, reels);
      let cells = [];
      if (shapeKind === 'dom') {
        for (let c = 0; c < N; c++) {
          const reel = window.RECT_REELS && window.RECT_REELS[c];
          const el = reel && (typeof reel.cellAt === 'function' ? reel.cellAt(0) : reel.cells && reel.cells[1]);
          if (el) cells.push(el);
        }
      } else if (shapeKind === 'cluster-rcidx') {
        for (let c = 0; c < N; c++) {
          cells.push({ r: 0, c: c, idx: 0 * reels + c });
        }
      } else if (shapeKind === 'legacy-reel-row') {
        for (let c = 0; c < N; c++) {
          cells.push({ reel: c, row: 0 });
        }
      } else if (shapeKind === 'idx-only') {
        for (let c = 0; c < N; c++) {
          cells.push({ idx: c });
        }
      }

      /* Forge a synthetic event and call drawPaylineOverlay directly. */
      let drewError = null;
      try {
        window.drawPaylineOverlay({
          cells: cells,
          lineIndex: 0,
          tier: 'HP',
          symbol: 'A',
          matchLength: cells.length,
        });
      } catch (e) {
        drewError = String(e).slice(0, 240);
      }

      const polys = svg ? svg.querySelectorAll('polyline').length : 0;
      const firstPoly = svg && svg.querySelector('polyline');
      const pointsAttr = firstPoly ? firstPoly.getAttribute('points') : null;
      const pointsCount = pointsAttr ? pointsAttr.trim().split(/\s+/).length : 0;

      return {
        cellsPassed: cells.length,
        polylinesDrawn: polys,
        pointsCount: pointsCount,
        drewError: drewError,
      };
    }, shape);

    perShape[shape] = result;
  }

  await ctx.close();

  /* Verdict: every shape must produce >= 1 polyline. */
  const fails = [];
  for (const shape of shapes) {
    const r = perShape[shape];
    if (!r.polylinesDrawn || r.polylinesDrawn < 1) {
      fails.push(`${shape}: 0 polylines (passed ${r.cellsPassed} cells)`);
    }
    if (r.drewError) {
      fails.push(`${shape}: threw "${r.drewError}"`);
    }
  }
  /* Also count any console / page errors. */
  if (errors.console.length > 0 || errors.page.length > 0) {
    fails.push(`${errors.console.length + errors.page.length} console/page errors`);
  }

  return {
    game: gameDir,
    sanity,
    perShape,
    errors,
    verdict: fails.length === 0 ? 'PASS' : 'FAIL',
    fails,
  };
}

async function main() {
  log('\n🎰 ULTIMATE LINE PRESENTATION PROBE · D-8');
  log('   Forsira drawPaylineOverlay sa 4 cell shape-a per igri.\n');
  const games = readdirSync(DIST).filter((g) => existsSync(resolve(DIST, g, 'slot.html'))).sort();
  if (games.length === 0) {
    console.error('FATAL: nema dist/real-games/<game>/slot.html');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const reports = [];
  for (const g of games) {
    const t0 = Date.now();
    log(`▸ ${g}`);
    try {
      const r = await runOneGame(browser, g);
      reports.push(r);
      const sym = r.verdict === 'PASS' ? '✓' : '✗';
      log(`   ${sym} ${r.verdict.padEnd(4)} · ` +
          Object.entries(r.perShape).map(([s, v]) => `${s}=${v.polylinesDrawn}p`).join(' · ') +
          ` · ${((Date.now()-t0)/1000).toFixed(1)}s`);
      if (r.fails.length > 0) log(`     fails: ${r.fails.join(' | ')}`);
    } catch (e) {
      log('   ❌ FAILED:', String(e).slice(0, 200));
      reports.push({ game: g, error: String(e), verdict: 'ERROR' });
    }
  }
  await browser.close();

  const stamp = Date.now();
  const outPath = resolve(OUT, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ stamp, reports }, null, 2));

  log('\n══════════════════════════════════════════════════════════════════════');
  log('SUMMARY');
  log('══════════════════════════════════════════════════════════════════════');
  for (const r of reports) {
    const sym = r.verdict === 'PASS' ? '✓' : (r.verdict === 'FAIL' ? '✗' : '!');
    const shapeCounts = r.perShape
      ? Object.entries(r.perShape).map(([s, v]) => `${s.padEnd(16)}=${v.polylinesDrawn}p`).join(' · ')
      : (r.error || '?');
    log(`  ${sym} ${r.game.padEnd(36)} ${(r.verdict || '?').padEnd(6)} ${shapeCounts}`);
  }
  const failed = reports.filter((r) => r.verdict !== 'PASS').length;
  log(`\n   Σ ${reports.length - failed}/${reports.length} PASS · report ${outPath}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
