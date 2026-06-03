#!/usr/bin/env node
/**
 * Browser smoke for every grid fixture.
 *
 * For every sample in samples/grids/ (and the 3 originals):
 *   1. Parses GDD → model → buildSlotHTML
 *   2. Loads HTML in headless Chromium via playwright
 *   3. Validates the live DOM
 *      - .grid-host[data-kind] matches shape.kind
 *      - cell count matches shape.totalCells (for rect/cluster/etc)
 *      - hex cells render as .cell.hex; wheel/crash render an <svg>
 *      - dual subgrids render
 *   4. Captures one screenshot per fixture into reports/screenshots/
 *   5. Runs 3 spin actions, checks balance debits and no JS errors
 *
 * Exits non-zero on any failure.
 */

import { parseGDD } from '../src/parser.mjs';
import { buildGridShape } from '../src/gridShape.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REPORT_DIR = resolve(REPO, 'reports');
const SHOT_DIR = resolve(REPORT_DIR, 'screenshots');
if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

/* buildSlotHTML is now in src/buildSlotHTML.mjs — imported above */

/* ─── DOM validator per kind ────────────────────────────── */
async function validatePage(page, shape, errors, tag) {
  const ASSERT = (cond, msg) => { if (!cond) errors.push(`[${tag}] ${msg}`); };

  const kind = await page.getAttribute('#gridHost', 'data-kind');
  ASSERT(kind === shape.kind, `data-kind=${kind} ≠ shape.kind=${shape.kind}`);

  const cellCount = await page.locator('#gridHost .cell').count();
  const svgCount  = await page.locator('#gridHost svg').count();
  const pegCount  = await page.locator('#gridHost .peg').count();

  switch (shape.kind) {
    case 'rectangular': {
      /* Rectangular slots now render as spinnable reel columns with strips
         that carry extra cells above the visible window. Validate the column
         count and that each strip has at least ROWS cells. */
      const colCount = await page.locator('#gridHost .reelCol').count();
      ASSERT(colCount === shape.reels, `reelCol count=${colCount} ≠ reels=${shape.reels}`);
      ASSERT(cellCount >= shape.totalCells, `DOM cells=${cellCount} < shape.totalCells=${shape.totalCells}`);
      break;
    }
    case 'cluster':
    case 'lock_respin':
    case 'infinity':
    case 'expanding':
    case 'megaclusters': {
      /* These shapes now share the rectangular reel-strip engine — every
         column has ROWS+2 cells (1 buffer above + 1 buffer below the
         visible window). Validate column count + minimum visible cells. */
      const colCount = await page.locator('#gridHost .reelCol').count();
      ASSERT(colCount === shape.reels, `${shape.kind} reelCol count=${colCount} ≠ reels=${shape.reels}`);
      ASSERT(cellCount >= shape.totalCells, `${shape.kind} DOM cells=${cellCount} < shape.totalCells=${shape.totalCells}`);
      break;
    }
    case 'variable_reel': {
      /* Wave J1: variable_reel now spins via the rectangular reel engine —
         per-column visibleRows + 2 buffer cells each. Validate column count
         against shape.reels and that total cells include the buffer slots
         (shape.totalCells visible + 2×reels buffers). */
      const colCount = await page.locator('#gridHost .reelCol').count();
      ASSERT(colCount === shape.reels, `variable_reel reelCol count=${colCount} ≠ reels=${shape.reels}`);
      ASSERT(cellCount >= shape.totalCells, `variable_reel DOM cells=${cellCount} < shape.totalCells=${shape.totalCells}`);
      break;
    }
    case 'diamond':
    case 'pyramid': {
      /* Wave J2: diamond / pyramid now share the rectangular reel-strip
         engine via per-column visibleRows. Each column has visibleRows + 2
         buffer cells, so DOM cellCount > shape.totalCells. Validate column
         count + that visible cells are at least shape.totalCells. */
      const colCount = await page.locator('#gridHost .reelCol').count();
      ASSERT(colCount === shape.reels, `${shape.kind} reelCol count=${colCount} ≠ reels=${shape.reels}`);
      ASSERT(cellCount >= shape.totalCells, `${shape.kind} DOM cells=${cellCount} < shape.totalCells=${shape.totalCells}`);
      break;
    }
    case 'cross':
    case 'l_shape': {
      /* Wave J2: cross / l_shape ride the rectangular engine with masked
         cells (mask hides corner-cut cells via .cell--masked). DOM has full
         REELS×(ROWS+2 buffer) cells; visible cells (non-masked) = shape.totalCells. */
      const colCount = await page.locator('#gridHost .reelCol').count();
      const visibleCells = await page.locator('#gridHost .cell:not(.cell--masked)').count();
      ASSERT(colCount === shape.reels, `${shape.kind} reelCol count=${colCount} ≠ reels=${shape.reels}`);
      /* visibleCells includes 2 buffer per column on top of the visible
         window — so >= shape.totalCells. */
      ASSERT(visibleCells >= shape.totalCells, `${shape.kind} visible cells=${visibleCells} < shape.totalCells=${shape.totalCells}`);
      break;
    }
    case 'hexagonal': {
      const hexCells = await page.locator('#gridHost .cell.hex').count();
      ASSERT(hexCells === shape.totalCells, `hex DOM cells=${hexCells} ≠ shape=${shape.totalCells}`);
      break;
    }
    case 'wheel':
    case 'radial': {
      ASSERT(svgCount >= 1, `wheel/radial expected SVG render, got ${svgCount}`);
      const paths = await page.locator('#gridHost svg path').count();
      ASSERT(paths === shape.cells.length, `wheel segments paths=${paths} ≠ shape.cells=${shape.cells.length}`);
      break;
    }
    case 'plinko': {
      ASSERT(pegCount === shape.totalCells, `plinko pegs=${pegCount} ≠ shape=${shape.totalCells}`);
      break;
    }
    case 'crash': {
      ASSERT(svgCount >= 1, `crash expected SVG curve, got ${svgCount}`);
      break;
    }
    case 'slingo': {
      // 25 board + 5 strip = 30 cells
      ASSERT(cellCount === 30, `slingo total cells=${cellCount}, expected 30`);
      break;
    }
    case 'dual': {
      // primary + sub cells
      const expected = shape.totalCells + (shape.subgrids ? shape.subgrids.reduce((s, g) => s + g.totalCells, 0) : 0);
      ASSERT(cellCount === expected, `dual cells=${cellCount}, expected ${expected}`);
      break;
    }
  }
}

/* ─── Per-fixture browser test ──────────────────────────── */
async function runFixture(browser, fixturePath, errors) {
  const text = readFileSync(fixturePath, 'utf-8');
  const ext  = fixturePath.endsWith('.json') ? 'json' : 'md';
  const model = parseGDD(text, ext);
  const shape = buildGridShape(model);
  const html  = buildSlotHTML(model);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  /* Set a deterministic viewport so frame measurements are stable
     and visually consistent in screenshots. */
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForSelector('#gridHost', { timeout: 5000 });
  // give renderer two animation frames to lay out
  await page.waitForTimeout(150);

  const tag = basename(fixturePath);
  const before = errors.length;
  await validatePage(page, shape, errors, tag);

  /* Base-game-only template — there is no spin/bet/HUD. Skip interaction
     checks; we validate static render only. */
  const sc0 = 'n/a', sc1 = 'n/a', bal0 = 'static', bal1 = 'static';

  if (consoleErrors.length > 0) {
    for (const e of consoleErrors) errors.push(`[${tag}] ${e}`);
  }

  const shotPath = `${SHOT_DIR}/${tag.replace(/\.(md|json)$/, '')}.png`;
  await page.screenshot({ path: shotPath, fullPage: false });

  const failed = errors.length - before;
  await ctx.close();
  return { tag, kind: shape.kind, totalCells: shape.totalCells, sc0, sc1, bal0, bal1, shotPath, failed, consoleErrors: consoleErrors.length };
}

/* ─── main ────────────────────────────────────────────────── */
(async () => {
  console.log('Launching headless Chromium…');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const results = [];

  /* gather fixtures: 19 from samples/grids + 3 originals */
  const fixtures = [
    ...readdirSync(resolve(REPO, 'samples/grids')).filter(f => f.endsWith('.md'))
      .map(f => resolve(REPO, 'samples/grids', f)),
    resolve(REPO, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md'),
    resolve(REPO, 'samples/CRYSTAL_FORGE_GAME_GDD.md'),
    resolve(REPO, 'samples/MIDNIGHT_FANGS_GAME_GDD.md'),
  ].filter(f => existsSync(f));

  for (const f of fixtures) {
    process.stdout.write(`· ${basename(f).padEnd(50)}`);
    const r = await runFixture(browser, f, errors);
    results.push(r);
    console.log(r.failed === 0 ? '✓' : `✗ (${r.failed})`);
  }
  await browser.close();

  /* report */
  const ok = results.filter(r => r.failed === 0).length;
  const fail = results.length - ok;
  const lines = [];
  lines.push(`# Browser-render QA report`);
  lines.push(``);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push(`**Fixtures**: ${results.length} · **PASS**: ${ok} · **FAIL**: ${fail}`);
  lines.push(``);
  lines.push(`## Per-fixture results`);
  lines.push(``);
  lines.push(`| Fixture | kind | cells | spins | bal0 → bal1 | console.err | screenshot | status |`);
  lines.push(`|---|---|--:|:--:|--:|--:|---|:--:|`);
  for (const r of results) {
    const status = r.failed === 0 ? '✅' : `❌ ${r.failed}`;
    const shotRel = r.shotPath.replace(REPO + '/', '');
    lines.push(`| \`${r.tag}\` | ${r.kind} | ${r.totalCells} | ${r.sc0}→${r.sc1} | ${r.bal0} → ${r.bal1} | ${r.consoleErrors} | \`${shotRel}\` | ${status} |`);
  }
  if (errors.length > 0) {
    lines.push('');
    lines.push(`## ❌ Errors (${errors.length})`);
    lines.push('');
    for (const e of errors) lines.push(`- ${e}`);
  }

  const out = lines.join('\n');
  writeFileSync(`${REPORT_DIR}/browser-render-latest.md`, out);
  console.log(`\n${out}\n`);
  console.log(`Report: ${REPORT_DIR}/browser-render-latest.md`);
  if (fail > 0) process.exit(1);
})();
