#!/usr/bin/env node
/**
 * tools/_huff-win-diag.mjs
 *
 * Huff win detection vraća 0 events kad su sve cells H1. Zašto?
 * Sumnja: PAYLINE_POOL prazan, ili evaluation kind pogrešno routiran.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-win-diag`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const PORT = 5264;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

async function probe(file, label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  // #fileInput is display:none, so wait via attached state
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#fileInput', file);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const frame = page.frames().find(f => f !== page.mainFrame());
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  const info = await frame.evaluate(() => ({
    shape: window.SHAPE && { kind: window.SHAPE.kind, reels: window.SHAPE.reels, rows: window.SHAPE.rows, evaluation: window.SHAPE.evaluation },
    gameEvalKind: window.GAME_EVAL_KIND,
    paylineCount: (window.PAYLINE_POOL || []).length,
    firstPayline: (window.PAYLINE_POOL || [])[0],
    paytableKeys: window.PAYTABLE ? Object.keys(window.PAYTABLE).slice(0, 20) : null,
    paytableH1: window.PAYTABLE && window.PAYTABLE.H1,
    paytableHasH1: !!(window.PAYTABLE && window.PAYTABLE.H1),
    symPool: window.SYMBOL_POOL ? window.SYMBOL_POOL.slice(0, 20) : null,
    detectWinCombosAvail: typeof window.detectWinCombos === 'function',
    detectWaysWinsAvail: typeof window.detectWaysWins === 'function',
    detectClusterWinsAvail: typeof window.detectClusterWins === 'function',
    detectPayAnywhereWinsAvail: typeof window.detectPayAnywhereWins === 'function',
    rectReels: (window.RECT_REELS || []).length,
    visible: (window.RECT_REELS || []).map(r => r && r.visible),
    cells: Array.from(document.querySelectorAll('.cell')).map(c => (c.textContent||'').trim()),
  }));

  // SPIN once first to populate RECT_REELS.visible
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(3000);

  // Determine the actual symbol IDs the parser is using
  const symbols = await frame.evaluate(() => ({
    symRegistry: window.SYMBOL_REGISTRY ? {
      wild: window.SYMBOL_REGISTRY.wild,
      scatter: window.SYMBOL_REGISTRY.scatter,
      regularPay: window.SYMBOL_REGISTRY.regularPay,
      tierKeys: window.SYMBOL_REGISTRY.tier ? Object.keys(window.SYMBOL_REGISTRY.tier) : null,
    } : null,
    cellsNow: Array.from(document.querySelectorAll('.cell')).map(c => (c.textContent||'').trim()),
    wildId: window.WILD_ID,
    scatterId: window.SCATTER_ID,
    reels: window.REELS,
    rows: window.ROWS,
  }));
  console.log(`  ${label} SYMBOL_REGISTRY: ${JSON.stringify(symbols.symRegistry)}`);
  console.log(`  ${label} cells POST-SPIN: ${symbols.cellsNow.join('|')}`);
  console.log(`  ${label} REELS=${symbols.reels} ROWS=${symbols.rows}`);
  // Pick first regularPay symbol
  const plantSym = (symbols.symRegistry && symbols.symRegistry.regularPay && symbols.symRegistry.regularPay[0]) || 'H1';
  console.log(`  ${label} plant symbol: ${plantSym}`);

  // Force plant plantSym on every reel.visible position + cell.textContent
  await frame.evaluate((sym) => {
    if (!window.RECT_REELS) return;
    for (const reel of window.RECT_REELS) {
      if (!reel || !Array.isArray(reel.visible)) continue;
      for (let r = 0; r < reel.visible.length; r++) reel.visible[r] = sym;
    }
    document.querySelectorAll('.cell').forEach(c => { c.textContent = sym; });
  }, plantSym);

  // Now run every available detector
  const detections = await frame.evaluate(() => {
    const out = {};
    if (typeof window.detectWinCombos === 'function') {
      try { out.detectWinCombos = (window.detectWinCombos() || []).map(e => ({ symbol: e.symbol, tier: e.tier, payX: e.payX, cells: (e.cells||[]).length })); }
      catch (e) { out.detectWinCombos = { error: String(e) }; }
    }
    if (typeof window.detectWaysWins === 'function') {
      try { out.detectWaysWins = (window.detectWaysWins() || []).map(e => ({ symbol: e.symbol, payX: e.payX, cells: (e.cells||[]).length })); }
      catch (e) { out.detectWaysWins = { error: String(e) }; }
    }
    if (typeof window.detectClusterWins === 'function') {
      try { out.detectClusterWins = (window.detectClusterWins() || []).map(e => ({ symbol: e.symbol, payX: e.payX, cells: (e.cells||[]).length })); }
      catch (e) { out.detectClusterWins = { error: String(e) }; }
    }
    if (typeof window.detectPayAnywhereWins === 'function') {
      try { out.detectPayAnywhereWins = (window.detectPayAnywhereWins() || []).map(e => ({ symbol: e.symbol, payX: e.payX, cells: (e.cells||[]).length })); }
      catch (e) { out.detectPayAnywhereWins = { error: String(e) }; }
    }
    return out;
  });

  // Try applyWinHighlight
  const apply = await frame.evaluate(async () => {
    if (typeof window.applyWinHighlight !== 'function') return { error: 'none' };
    const events = await window.applyWinHighlight();
    return { events: (events||[]).length, payXSum: (events||[]).reduce((a,e) => a + (e.payX || 0), 0), award: window.__WIN_AWARD__ };
  });

  await page.close();
  await ctx.close();
  return { label, info, detections, apply, errs };
}

const HUFF_PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const RECT_MD  = `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md`;

const huff = await probe(HUFF_PDF, 'HUFF');
const rect = await probe(RECT_MD, 'RECT');

writeFileSync(`${OUT}/_diag.json`, JSON.stringify({ huff, rect }, null, 2));

function dump(label, r) {
  console.log(`\n── ${label} ──`);
  console.log(`  shape: ${JSON.stringify(r.info.shape)}`);
  console.log(`  gameEvalKind: ${r.info.gameEvalKind}, paylineCount: ${r.info.paylineCount}`);
  console.log(`  firstPayline: ${JSON.stringify(r.info.firstPayline)}`);
  console.log(`  PAYTABLE keys: ${r.info.paytableKeys ? r.info.paytableKeys.join(',') : 'none'}`);
  console.log(`  PAYTABLE.H1 = ${JSON.stringify(r.info.paytableH1)}`);
  console.log(`  detectors avail: combos=${r.info.detectWinCombosAvail} ways=${r.info.detectWaysWinsAvail} cluster=${r.info.detectClusterWinsAvail} payAny=${r.info.detectPayAnywhereWinsAvail}`);
  console.log(`  visible: ${JSON.stringify(r.info.visible)}`);
  console.log(`  cells text: ${r.info.cells.join('|')}`);
  console.log(`  DETECTIONS:`);
  for (const [k, v] of Object.entries(r.detections)) console.log(`    ${k}: ${JSON.stringify(v)}`);
  console.log(`  applyWinHighlight: ${JSON.stringify(r.apply)}`);
  console.log(`  errors: ${r.errs.length}`);
}
dump('HUFF', huff);
dump('RECT', rect);

await browser.close();
server.kill('SIGTERM');
console.log(`\nDetail in ${OUT}/_diag.json`);
