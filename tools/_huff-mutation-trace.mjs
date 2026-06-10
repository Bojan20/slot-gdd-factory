#!/usr/bin/env node
/**
 * tools/_huff-mutation-trace.mjs
 *
 * Boki: "i dalje nestaju ćelije iz grida". 4 prethodna fix-a nisu
 * uhvatila ovo. Plan ovog probe-a — naći **TAČAN trenutak i izvor**
 * kad ćelija postane prazna u Huff PDF, i da li 01_rectangular_5x3
 * to NE radi sa istim akcijama.
 *
 * Metoda (jača od svih ranijih):
 *   1. MutationObserver na svaku .cell — characterData + childList +
 *      attributes (class). Svaka promena log-uje stack trace mutatora.
 *   2. Patch CharacterData.prototype textContent setter da snima
 *      origin stack-a kad se .textContent dodeli prazno ('' ili '?').
 *   3. Probe 50 spinova na Huff, pa 50 spinova na 01_rectangular —
 *      uporediv broj empty-cell event-ova.
 *   4. Za svaki empty event: text BEFORE, text AFTER, stack frame koji
 *      ga je izazvao (zapisano u __PROBE.empties).
 *
 * Output:
 *   tools/_eyes/huff-mut/_trace.json
 *     { huff: { empties, spinResults, ... }, rect: { ... } }
 *   tools/_eyes/huff-mut/huff_video.webm
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-mut`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const HUFF_PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const RECT_MD  = `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md`;

const PORT = 5261;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

async function runOnce(label, file, spinCount = 30) {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1400, height: 900 } },
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(file);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });
  await page.waitForTimeout(2000);
  const frame = page.frames().find(f => f !== page.mainFrame());
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  // Install mutation observer + empty-detector
  await frame.evaluate(() => {
    window.__PROBE = {
      empties: [],            // { t, cellIdx, before, after, stack, phase, source }
      mutations: 0,
      spinResults: 0,
      tumbleSteps: 0,
      winStarts: 0,
      winEnds: 0,
      postSpins: 0,
      cellCountTimeline: [],  // { t, cellCount, emptyCount }
    };
    const cellList = () => Array.from(document.querySelectorAll('.cell'));
    // index map for quick lookup
    const cellIndex = new WeakMap();
    function reindex() {
      cellList().forEach((c, i) => cellIndex.set(c, i));
    }
    reindex();

    const obs = new MutationObserver((mlist) => {
      window.__PROBE.mutations += mlist.length;
      for (const m of mlist) {
        if (m.type === 'childList' || m.type === 'characterData') {
          const target = m.target.nodeType === 3 ? m.target.parentElement : m.target;
          if (!target || !target.classList || !target.classList.contains('cell')) continue;
          const after = (target.textContent || '').trim();
          if (after === '' || after === '?') {
            const idx = cellIndex.get(target);
            const stack = new Error().stack || '';
            // Capture top frames excluding our own
            const frames = stack.split('\n').slice(2, 6).map(s => s.trim()).join(' | ');
            window.__PROBE.empties.push({
              t: Date.now(),
              cellIdx: idx,
              after,
              stack: frames,
              phase: window.FSM ? window.FSM.phase : 'BASE',
              winPresActive: !!window.__SLOT_WIN_PRESENT_ACTIVE__,
              spinning: !!document.getElementById('spinBtn')?.classList.contains('is-spinning'),
            });
          }
        }
      }
    });
    cellList().forEach(c => obs.observe(c, { characterData: true, childList: true, subtree: true }));
    // Re-attach observer when new cells appear
    const rootObs = new MutationObserver(() => {
      reindex();
      cellList().forEach(c => obs.observe(c, { characterData: true, childList: true, subtree: true }));
    });
    rootObs.observe(document.body, { childList: true, subtree: true });
    window.__PROBE._observer = obs;
    window.__PROBE._rootObserver = rootObs;

    // Hook key HookBus events
    if (window.HookBus) {
      window.HookBus.on('onSpinResult', () => { window.__PROBE.spinResults++; });
      window.HookBus.on('onTumbleStep', () => { window.__PROBE.tumbleSteps++; });
      window.HookBus.on('onWinPresentationStart', () => { window.__PROBE.winStarts++; });
      window.HookBus.on('onWinPresentationEnd', () => { window.__PROBE.winEnds++; });
      window.HookBus.on('postSpin', () => { window.__PROBE.postSpins++; });
    }

    // Periodic snapshot — total cells + how many are empty
    setInterval(() => {
      const cells = cellList();
      let empty = 0;
      cells.forEach(c => {
        const t = (c.textContent || '').trim();
        if (!t) empty++;
      });
      window.__PROBE.cellCountTimeline.push({
        t: Date.now(),
        cellCount: cells.length,
        emptyCount: empty,
        phase: window.FSM ? window.FSM.phase : 'BASE',
      });
    }, 200);
  });

  // Inspect config + initial cell count
  const cfg = await frame.evaluate(() => ({
    shape: window.SHAPE,
    rectReels: (window.RECT_REELS || []).length,
    visibleLens: (window.RECT_REELS || []).map(r => (r && r.visible || []).length),
    chips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')),
    cells: document.querySelectorAll('.cell').length,
    cellsNonEmpty: Array.from(document.querySelectorAll('.cell')).filter(c => (c.textContent||'').trim()).length,
  }));

  // Spin loop — wait for ready, click spin, sleep 2500ms
  for (let i = 0; i < spinCount; i++) {
    for (let j = 0; j < 50; j++) {
      const ok = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.disabled && !b.classList.contains('is-spinning') &&
               ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
      });
      if (ok) break;
      await page.waitForTimeout(150);
    }
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2200);
  }

  // Final dump
  const result = await frame.evaluate(() => ({
    empties: window.__PROBE.empties.slice(0, 60),
    emptiesTotal: window.__PROBE.empties.length,
    mutations: window.__PROBE.mutations,
    spinResults: window.__PROBE.spinResults,
    tumbleSteps: window.__PROBE.tumbleSteps,
    winStarts: window.__PROBE.winStarts,
    winEnds: window.__PROBE.winEnds,
    postSpins: window.__PROBE.postSpins,
    timeline: window.__PROBE.cellCountTimeline,
    finalCells: document.querySelectorAll('.cell').length,
    finalEmpty: Array.from(document.querySelectorAll('.cell')).filter(c => !(c.textContent||'').trim()).length,
  }));

  await page.screenshot({ path: `${OUT}/${label}_final.png` });
  await page.close();
  await ctx.close();
  return { label, cfg, result, errs };
}

console.log('\n══ HUFF ══');
const huff = await runOnce('huff', HUFF_PDF, 30);
console.log('\n══ RECT 01 ══');
const rect = await runOnce('rect', RECT_MD, 30);

writeFileSync(`${OUT}/_trace.json`, JSON.stringify({ huff, rect }, null, 2));

// Summary
function summarize(r) {
  console.log(`  shape.kind: ${r.cfg.shape && r.cfg.shape.kind}`);
  console.log(`  cells initial: ${r.cfg.cells} (nonEmpty: ${r.cfg.cellsNonEmpty})`);
  console.log(`  cells final: ${r.result.finalCells} (empty: ${r.result.finalEmpty})`);
  console.log(`  postSpins: ${r.result.postSpins}, spinResults: ${r.result.spinResults}, tumbles: ${r.result.tumbleSteps}`);
  console.log(`  winStarts: ${r.result.winStarts}, winEnds: ${r.result.winEnds}`);
  console.log(`  empty mutations TOTAL: ${r.result.emptiesTotal}`);
  console.log(`  unique cells that went empty: ${new Set(r.result.empties.map(e => e.cellIdx)).size}`);
  const phases = {};
  r.result.empties.forEach(e => { phases[e.phase] = (phases[e.phase]||0)+1; });
  console.log(`  empties by phase: ${JSON.stringify(phases)}`);
  const dur = r.result.timeline.length ? r.result.timeline[r.result.timeline.length-1].t - r.result.timeline[0].t : 0;
  const peakEmpty = r.result.timeline.reduce((a, s) => Math.max(a, s.emptyCount), 0);
  console.log(`  timeline peak empty: ${peakEmpty} over ${(dur/1000).toFixed(1)}s`);
  if (r.result.empties.length) {
    console.log(`  first 3 empty events:`);
    r.result.empties.slice(0, 3).forEach(e => {
      console.log(`    cellIdx=${e.cellIdx} phase=${e.phase} winPresActive=${e.winPresActive} stack=${e.stack.slice(0, 200)}`);
    });
  }
  console.log(`  errors: ${r.errs.length}`);
  r.errs.slice(0, 3).forEach(e => console.log(`    ${e.slice(0, 200)}`));
}
console.log('\n── HUFF summary ──');
summarize(huff);
console.log('\n── RECT summary ──');
summarize(rect);

await browser.close();
server.kill('SIGTERM');
console.log(`\nDetail in ${OUT}/_trace.json`);
