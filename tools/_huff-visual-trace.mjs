#!/usr/bin/env node
/**
 * tools/_huff-visual-trace.mjs
 *
 * Boki vidi "nestajanje ćelija" — ali mutation observer ne hvata jer
 * textContent ostaje. To znači ćelije nestaju VIZUELNO (opacity, transform,
 * visibility, display, ili child element prekriva tekst).
 *
 * Probe metoda:
 *   - poll svake 80ms svaku .cell sa getComputedStyle + getBoundingClientRect
 *   - kategorije:
 *     • visible      → opacity ≥ 0.5, visibility=visible, display!=none, rect>0, text ima sadržaj
 *     • dim          → opacity 0.05–0.5  (tumble is-removing mid-animation)
 *     • ghost        → opacity < 0.05    (vizuelno prazno)
 *     • mini         → transform scale < 0.5
 *     • hidden       → visibility hidden ili display none ili rect 0
 *     • textless     → text === '' ili '?'
 *   - hvata trenutak kad VISIBLE cell broj padne ispod startnog
 *   - takođe poll PHASE + winPresActive + spinning state
 *
 * Output:
 *   tools/_eyes/huff-visual/_visual.json
 *   tools/_eyes/huff-visual/{huff,rect}_video.webm
 *   tools/_eyes/huff-visual/{huff,rect}_*.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-visual`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const HUFF_PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const RECT_MD  = `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md`;

const PORT = 5262;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

async function runOnce(label, file, spinCount = 25) {
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

  await frame.evaluate(() => {
    window.__VPROBE = {
      samples: [],     // every poll
      events: [],      // visible-count drops, HookBus events
      startVisible: 0,
    };
    function classify(cell) {
      const cs = getComputedStyle(cell);
      const rect = cell.getBoundingClientRect();
      const op = parseFloat(cs.opacity) || 0;
      const vis = cs.visibility;
      const disp = cs.display;
      const tr = cs.transform || 'none';
      const sx = (() => {
        const m = tr.match(/matrix\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map(Number);
          return parts[0];
        }
        return 1;
      })();
      const txt = (cell.textContent || '').trim();
      const hasRect = rect.width > 2 && rect.height > 2;
      const hidden = vis !== 'visible' || disp === 'none' || !hasRect;
      const ghost = op < 0.05;
      const dim = op >= 0.05 && op < 0.5;
      const mini = sx < 0.5;
      const textless = txt === '' || txt === '?';
      const cls = Array.from(cell.classList);
      let cat;
      if (hidden) cat = 'hidden';
      else if (ghost) cat = 'ghost';
      else if (mini) cat = 'mini';
      else if (textless) cat = 'textless';
      else if (dim) cat = 'dim';
      else cat = 'visible';
      return { cat, op, sx, vis, disp, txt, classes: cls };
    }
    window.__VPROBE.classify = classify;
    const startCells = Array.from(document.querySelectorAll('.cell'));
    window.__VPROBE.startVisible = startCells.filter(c => classify(c).cat === 'visible').length;

    setInterval(() => {
      const cells = Array.from(document.querySelectorAll('.cell'));
      const cats = { visible:0, dim:0, ghost:0, mini:0, hidden:0, textless:0 };
      const bad = [];
      cells.forEach((c, i) => {
        const k = classify(c);
        cats[k.cat]++;
        if (k.cat !== 'visible') bad.push({ idx:i, cat:k.cat, op:k.op.toFixed(2), sx:k.sx.toFixed(2), txt:k.txt, cls:k.classes.join(',') });
      });
      const sample = {
        t: Date.now(),
        total: cells.length,
        cats,
        bad: bad.slice(0, 6),
        phase: window.FSM ? window.FSM.phase : '?',
        winPresActive: !!window.__SLOT_WIN_PRESENT_ACTIVE__,
        spinning: !!document.getElementById('spinBtn')?.classList.contains('is-spinning'),
      };
      window.__VPROBE.samples.push(sample);
    }, 80);

    if (window.HookBus) {
      ['onSpinResult','onTumbleStep','onWinPresentationStart','onWinPresentationEnd',
       'postSpin','preSpin','onFsStart','onFsEnd','onBigWinTierStart'].forEach(ev =>
        window.HookBus.on(ev, (p) => window.__VPROBE.events.push({ t: Date.now(), ev, p: p && JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([_,v]) => typeof v !== 'object' || v === null)))) }))
      );
    }
  });

  const cfg = await frame.evaluate(() => ({
    shape: window.SHAPE,
    tumbleEnabled: typeof window.runTumbleChain === 'function' && (window.TUMBLE_MAX_CHAIN || 0) > 0,
    rectReels: (window.RECT_REELS || []).length,
    visibleLens: (window.RECT_REELS || []).map(r => (r && r.visible || []).length),
    chips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')),
    cellCount: document.querySelectorAll('.cell').length,
    startVisible: window.__VPROBE.startVisible,
  }));

  // Spin loop
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
    await page.waitForTimeout(2500);
  }

  const result = await frame.evaluate(() => ({
    startVisible: window.__VPROBE.startVisible,
    samples: window.__VPROBE.samples,
    events: window.__VPROBE.events,
    finalCells: document.querySelectorAll('.cell').length,
  }));

  await page.screenshot({ path: `${OUT}/${label}_final.png` });
  await page.close();
  await ctx.close();
  return { label, cfg, result, errs };
}

console.log('\n══ HUFF ══');
const huff = await runOnce('huff', HUFF_PDF, 20);
console.log('\n══ RECT 01 ══');
const rect = await runOnce('rect', RECT_MD, 20);

writeFileSync(`${OUT}/_visual.json`, JSON.stringify({ huff, rect }, null, 2));

function summarize(r) {
  const ss = r.result.samples;
  const start = r.result.startVisible;
  console.log(`  shape.kind: ${r.cfg.shape && r.cfg.shape.kind}`);
  console.log(`  total cells: ${r.cfg.cellCount} (start visible: ${start})`);
  // Aggregate
  const peak = {};
  ['visible','dim','ghost','mini','hidden','textless'].forEach(k => peak[k] = 0);
  let dropFrames = 0;
  for (const s of ss) {
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s.cats[k]);
    if (s.cats.visible < start) dropFrames++;
  }
  console.log(`  peak categories: ${JSON.stringify(peak)}`);
  console.log(`  frames where visible < start: ${dropFrames}/${ss.length}`);
  // Phase breakdown of drops
  const phaseDrops = {};
  for (const s of ss) {
    if (s.cats.visible < start) {
      const k = `${s.phase}/${s.winPresActive?'win':'idle'}/${s.spinning?'spin':'still'}`;
      phaseDrops[k] = (phaseDrops[k]||0)+1;
    }
  }
  console.log(`  drops by phase: ${JSON.stringify(phaseDrops)}`);
  // Show 3 worst frames (lowest visible)
  const sorted = [...ss].sort((a,b) => a.cats.visible - b.cats.visible).slice(0, 3);
  console.log(`  3 worst frames (lowest visible):`);
  sorted.forEach(s => {
    console.log(`    visible=${s.cats.visible}/${start} cats=${JSON.stringify(s.cats)} phase=${s.phase} winPres=${s.winPresActive}`);
    if (s.bad.length) s.bad.forEach(b => console.log(`      idx=${b.idx} cat=${b.cat} op=${b.op} sx=${b.sx} txt="${b.txt}" cls="${b.cls}"`));
  });
  // Event histogram
  const evCounts = {};
  for (const e of r.result.events) evCounts[e.ev] = (evCounts[e.ev]||0)+1;
  console.log(`  HookBus events: ${JSON.stringify(evCounts)}`);
  console.log(`  errors: ${r.errs.length}`);
}
console.log('\n── HUFF visual summary ──');
summarize(huff);
console.log('\n── RECT visual summary ──');
summarize(rect);

await browser.close();
server.kill('SIGTERM');
console.log(`\nDetail in ${OUT}/_visual.json`);
