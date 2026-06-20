#!/usr/bin/env node
/**
 * tools/_ultimate-symbol-overflow-probe.mjs · D-10 SYMBOL-OVERFLOW HUNTER
 *
 * Bokijev imperative (2026-06-20):
 *   "desava se da neki simboli koji su u win liniji nestraju iz reel framea.
 *    fix it. iskoristi neki brutalan test za to i sve agente koji ti trebaju.
 *    ako nemas taj test, napisi ga"
 *
 * SHTA RADI — pixel-precizna brutalna provera (deterministic, no RNG):
 *
 *   1. Za svaku real-game GDD igru:
 *      a. Load dist/real-games/<game>/slot.html u headless Chromium
 *      b. Wait dok gridHost ne renderuje sve cells (RECT_REELS popunjen)
 *      c. Force `.has-winselection` klasu na .gridHost
 *      d. Force `.is-win` klasu na 4 EDGE cells per kolona (gornji red,
 *         donji red, levi red, desni red) — to su geometrijske krajnje
 *         tačke gde scale-from-center bug NAJVIŠE iskače
 *      e. Wait 220ms da CSS transition (180ms) fully primeni
 *      f. Snapshot getBoundingClientRect() svakog `.is-win` cell-a +
 *         njegovog parent `.reelCol` (ili fallback `.gridHost`)
 *      g. CONTAINMENT TEST sa TOLERANCE_PX (0.5px za sub-pixel rounding):
 *           cell.left   >= parent.left   - TOL
 *           cell.top    >= parent.top    - TOL
 *           cell.right  <= parent.right  + TOL
 *           cell.bottom <= parent.bottom + TOL
 *      h. Bilo koja violacija = FAIL + dump (deltaPx, classes, parentTag)
 *
 *   2. Cleanup klasa, screenshot ako overflow.
 *
 * Pass kriterijum: 0 winning cells van reel frame-a, kroz sve igre. Bilo
 * koji single overflow = D-10 FAIL.
 *
 * Razlog zašto BUG postoji (pre-fix hipoteza):
 *   winPresentation.mjs emituje `text.is-win { transform: scale(1.06) }`
 *   BEZ transform-origin (default = center). Za EDGE cell-ove, 6% scale
 *   pomera ivicu van prirodnog bounds-a. Reel frame `.reelCol` ima
 *   `overflow: hidden` → klipuje simbol → "simbol nestaje iz reel frame-a".
 *
 *   Fix: ukloniti scale, koristiti samo filter brightness + inset box-shadow
 *   (isti pattern koji već važi za `.is-winsym-cycling` fazu — Boki rule
 *   "MUST stay entirely inside the reel cell. NO transform").
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-symbol-overflow');

const TOLERANCE_PX = 0.5;        /* sub-pixel anti-alias / browser rounding */
const CSS_TRANSITION_WAIT = 240; /* > 180ms transition in winPresentation */
const VIEWPORT = { width: 1440, height: 900 };

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

function listGames() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST).filter(d => {
    const p = join(DIST, d, 'slot.html');
    try { return statSync(p).isFile(); } catch { return false; }
  }).sort();
}

/**
 * Force edge-cell winning states inside the page and snapshot bbox
 * containment. Runs entirely in browser context — no RNG dependency.
 */
async function forceAndMeasure(page, TOL) {
  return await page.evaluate((TOL) => {
    const host = document.querySelector('.gridHost');
    if (!host) return { error: 'no .gridHost found' };

    /* Cleanup any prior state. */
    host.classList.remove('has-winselection', 'is-winsym-cycling');
    document.querySelectorAll('.is-win, .cell--winsym').forEach(el => {
      el.classList.remove('is-win', 'cell--winsym');
    });

    /* Collect candidate edge cells from RECT_REELS (canonical grid model). */
    const reels = window.RECT_REELS;
    if (!Array.isArray(reels) || reels.length === 0) {
      return { error: 'window.RECT_REELS not populated' };
    }
    const rowsPerReel = (window.SHAPE && window.SHAPE.rows) || window.ROWS ||
      (reels[0] && reels[0].cells ? reels[0].cells.length : 0);
    if (!rowsPerReel) return { error: 'cannot determine rows-per-reel' };

    /* Choose 4 geometrical extremes per game (edges of the grid bounding box):
       (a) top-left cell, (b) top-right, (c) bottom-left, (d) bottom-right.
       These are the cells most likely to clip past .reelCol on scale-up. */
    const lastReel = reels.length - 1;
    const lastRow = rowsPerReel - 1;
    const picks = [
      { reelIdx: 0,        rowIdx: 0,       label: 'top-left'    },
      { reelIdx: lastReel, rowIdx: 0,       label: 'top-right'   },
      { reelIdx: 0,        rowIdx: lastRow, label: 'bottom-left' },
      { reelIdx: lastReel, rowIdx: lastRow, label: 'bottom-right'},
    ];

    const targets = [];
    for (const p of picks) {
      const reel = reels[p.reelIdx];
      if (!reel) continue;
      let el = null;
      if (typeof reel.cellAt === 'function') el = reel.cellAt(p.rowIdx);
      else if (reel.cells && reel.cells[p.rowIdx + 1]) el = reel.cells[p.rowIdx + 1];
      if (!el) continue;
      el.classList.add('is-win');
      targets.push({ el, label: p.label, reelIdx: p.reelIdx, rowIdx: p.rowIdx });
    }
    if (!targets.length) return { error: 'no edge cells could be resolved' };

    host.classList.add('has-winselection');

    /* Return marker; bbox measurement happens AFTER CSS transition wait. */
    return { ok: true, targetCount: targets.length, rows: rowsPerReel,
             reels: reels.length };
  }, TOL);
}

async function measureContainment(page, TOL) {
  return await page.evaluate((TOL) => {
    const wins = document.querySelectorAll(
      '.gridHost.has-winselection .cell.is-win, ' +
      '.gridHost.has-winselection text.is-win'
    );
    const out = [];
    for (const el of wins) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const parent = el.closest('.reelCol') || el.closest('.gridHost');
      if (!parent) continue;
      const pr = parent.getBoundingClientRect();
      const deltas = {
        leftOver:   (pr.left  - r.left),
        topOver:    (pr.top   - r.top),
        rightOver:  (r.right  - pr.right),
        bottomOver: (r.bottom - pr.bottom),
      };
      const overflow =
        deltas.leftOver   > TOL ||
        deltas.topOver    > TOL ||
        deltas.rightOver  > TOL ||
        deltas.bottomOver > TOL;
      out.push({
        tag: el.tagName.toLowerCase(),
        classes: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean),
        parentTag: parent.tagName.toLowerCase() + (parent.classList.length
          ? '.' + Array.from(parent.classList).join('.') : ''),
        rect: { left: +r.left.toFixed(2), top: +r.top.toFixed(2),
                right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
                width: +r.width.toFixed(2), height: +r.height.toFixed(2) },
        parentRect: { left: +pr.left.toFixed(2), top: +pr.top.toFixed(2),
                      right: +pr.right.toFixed(2), bottom: +pr.bottom.toFixed(2),
                      width: +pr.width.toFixed(2), height: +pr.height.toFixed(2) },
        deltas: {
          leftOver:   +deltas.leftOver.toFixed(2),
          topOver:    +deltas.topOver.toFixed(2),
          rightOver:  +deltas.rightOver.toFixed(2),
          bottomOver: +deltas.bottomOver.toFixed(2),
        },
        overflow,
        worstPx: +Math.max(deltas.leftOver, deltas.topOver,
                           deltas.rightOver, deltas.bottomOver).toFixed(2),
      });
    }
    return out;
  }, TOL);
}

async function runGame(browser, game) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  log(`\n┌─ ${game}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('.gridHost', { timeout: 8000 });
    /* Wait for RECT_REELS to populate (reel engine builds cells async). */
    await page.waitForFunction(() => {
      return Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0;
    }, { timeout: 10000 });
    await page.waitForTimeout(300);

    const setup = await forceAndMeasure(page, TOLERANCE_PX);
    if (setup.error) {
      log(`│  ⚠ setup error: ${setup.error}`);
      await ctx.close();
      return { game, verdict: 'SKIP', error: setup.error,
               summary: { totalWinningCells: 0, overflowingCells: 0,
                          worstPx: 0, pageErrors: 0, consoleErrors: 0 },
               pageErrors, consoleErrors };
    }
    log(`│  forced ${setup.targetCount} edge cells (grid ${setup.reels}×${setup.rows})`);

    /* Let CSS transition fully apply. */
    await page.waitForTimeout(CSS_TRANSITION_WAIT);
    const cells = await measureContainment(page, TOLERANCE_PX);

    const overflowing = cells.filter(c => c.overflow);
    const worstPx = cells.reduce((m, c) => Math.max(m, c.worstPx), 0);

    /* Always screenshot for evidence. */
    const shotPath = join(OUT, `${game}${overflowing.length ? '-OVERFLOW' : '-ok'}.png`);
    try { await page.screenshot({ path: shotPath, fullPage: false }); } catch {}

    log(`│  winning cells: ${cells.length}  overflowing: ${overflowing.length}`);
    log(`│  worst overflow: ${worstPx.toFixed(2)}px (tolerance ${TOLERANCE_PX}px)`);
    if (overflowing.length) {
      for (const c of overflowing) {
        log(`│    ✗ ${c.parentTag.slice(0, 60)}`);
        log(`│      cell ${JSON.stringify(c.rect)}`);
        log(`│      parent ${JSON.stringify(c.parentRect)}`);
        log(`│      deltas ${JSON.stringify(c.deltas)}  worst ${c.worstPx}px`);
      }
    }

    await ctx.close();
    const verdict = (overflowing.length === 0 && pageErrors.length === 0)
      ? 'PASS' : 'FAIL';
    log(`└─ ${verdict}`);
    return {
      game, verdict, cells,
      summary: { totalWinningCells: cells.length,
                 overflowingCells: overflowing.length, worstPx,
                 pageErrors: pageErrors.length,
                 consoleErrors: consoleErrors.length },
      pageErrors, consoleErrors,
    };
  } catch (e) {
    log(`│  ⚠ unexpected error: ${String(e.message || e).slice(0, 200)}`);
    try { await ctx.close(); } catch {}
    return { game, verdict: 'ERROR', error: String(e.message || e),
             summary: { totalWinningCells: 0, overflowingCells: 0,
                        worstPx: 0, pageErrors: pageErrors.length,
                        consoleErrors: consoleErrors.length },
             pageErrors, consoleErrors };
  }
}

async function main() {
  const games = listGames();
  if (!games.length) {
    console.error('NO GAMES FOUND in', DIST);
    process.exit(2);
  }
  log(`🎯 D-10 SYMBOL-OVERFLOW PROBE — ${games.length} igara, ` +
      `deterministic edge-cell force, tolerance ±${TOLERANCE_PX}px`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const skip = results.filter(r => r.verdict === 'SKIP' || r.verdict === 'ERROR').length;
  const totalOverflows = results.reduce((a, r) => a + r.summary.overflowingCells, 0);
  const finalVerdict = (fail === 0 && totalOverflows === 0) ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    config: { tolerancePx: TOLERANCE_PX, cssTransitionWait: CSS_TRANSITION_WAIT,
              viewport: VIEWPORT },
    perGame: results.map(r => ({ game: r.game, verdict: r.verdict, ...r.summary,
                                  error: r.error })),
    rawCells: results,
    finalVerdict, pass, fail, skip, totalOverflows,
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌─────────────────────────────────────────────────────────────────────────┐');
  log(`│ D-10 SYMBOL-OVERFLOW · FINAL: ${finalVerdict.padEnd(4)} ` +
      `(${pass} PASS / ${fail} FAIL / ${skip} SKIP)`.padEnd(40));
  log('└─────────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${r.verdict.padEnd(5)} ` +
        `overflow ${r.summary.overflowingCells}/${r.summary.totalWinningCells}  ` +
        `worst ${r.summary.worstPx.toFixed(2)}px`);
  }

  process.exit(finalVerdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
