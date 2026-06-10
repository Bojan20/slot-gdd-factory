#!/usr/bin/env node
/**
 * tools/_huff-deep-live.mjs
 *
 * Boki direktiva (10.06): Huff bug DEEP analiza
 *   1. Nema win prezentacije
 *   2. Ćelije nestaju kad se win desi
 *   3. Multiplier force ne radi — kako treba multiplier da se prikaže?
 *
 * Plan: spinuj 30× tracking SVE PROMENE na .cell-ovima posle svake spin:
 *   - textContent (simbol)
 *   - className (visual state)
 *   - innerHTML (frame badge, mult chip, win highlight)
 *   - boundingRect (visibility)
 * Hvatam tačan momenat kad ćelija postane prazna / nestane.
 *
 * Plus multiplier force: gledam SVE što se desi posle klika.
 *
 * Plus win prezentacija: hvatam onWinPresentationStart/End i šta se
 *   stvarno renderuje.
 */
import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                     from 'node:path';
import { fileURLToPath }                        from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/huff-deep-live');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PORT = 5290;
const URL  = `http://127.0.0.1:${PORT}/`;
const srv  = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const R='${REPO}';
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join(R,p));
  if(!f.startsWith(R)){res.writeHead(403);return res.end();}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404 '+p);}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: ' + String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('input[type="file"]').first().setInputFiles(`${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`);
await page.waitForSelector('iframe', { timeout: 25000, state: 'attached' });
const fr = await (await page.$('iframe')).contentFrame();
await fr.waitForSelector('.cell', { timeout: 18000 });
await page.waitForTimeout(800);

const live = await fr.evaluate(() => ({
  shape: window.SHAPE && window.SHAPE.kind,
  reels: window.REELS,
  rows: window.ROWS,
  cellCount: document.querySelectorAll('.cell').length,
  multOrbEnabled: !!(window.MULT_ORB_STATE || window.multiplierOrbState),
  hwEnabled: !!(window.HW_STATE || window.holdAndWinIsActive),
  features: window.MODEL_FEATURES || (window.MODEL ? window.MODEL.features?.map(f => f.kind) : null),
}));
console.log('📋 Huff:', JSON.stringify(live));

/* Snapshot helper — captures every cell's textContent + innerHTML */
async function snapshot(label) {
  return fr.evaluate((lbl) => {
    const cells = Array.from(document.querySelectorAll('.cell'));
    return cells.map((c, i) => ({
      i,
      txt: (c.textContent || '').trim(),
      cls: c.className,
      hasFrame: !!c.querySelector('.frame-badge, .frame-overlay, .mult-chip, .multiplier-orb, [data-frame]'),
      bgImage: getComputedStyle(c).backgroundImage,
      data: Object.fromEntries(Array.from(c.attributes).filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])),
    }));
  }, label);
}

await fr.evaluate(() => {
  window.__OBS__ = [];
  if (window.HookBus) {
    ['preSpin','onSpinResult','postSpin','onWinPresentationStart','onWinPresentationEnd',
     'onForceFeatureRequested','onCascadeStart','onCascadeEnd','onMultiplierOrbAccumulate',
     'onScatterCelebrationStart','onScatterCelebrationEnd','onFsTrigger','onFsEnd',
     'onTumbleStep','onBalanceChanged','onWinHighlightApplied','onWinHighlightCleared']
      .forEach(e => HookBus.on(e, p => window.__OBS__.push({ e, t: Date.now(), p: p && JSON.parse(JSON.stringify(p)) })));
  }
});

const baseline = await snapshot('initial');
console.log(`\n🔍 INITIAL cells: ${baseline.length} populated, sample symbols:`);
console.log('   ' + baseline.slice(0, 10).map(c => `[${c.i}]${c.txt}`).join(' '));

/* ── PHASE 1: 30 base spins, log every transition ── */
console.log(`\n🔬 PHASE 1: 30 base spins — track cell state per spin`);
const spinTraces = [];
let lastEmptyCount = 0;
for (let i = 0; i < 30; i++) {
  await fr.evaluate(() => { window.__OBS__ = []; });
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await fr.waitForFunction(() => {
    const obs = window.__OBS__ || [];
    return obs.some(o => o.e === 'postSpin') && !window.allReelsActive;
  }, null, { timeout: 10000 }).catch(() => {});
  await fr.waitForTimeout(200);

  const post = await snapshot(`after-spin-${i + 1}`);
  const obs = await fr.evaluate(() => window.__OBS__.slice());
  const empty = post.filter(c => !c.txt || c.txt === '' || c.txt === '?').length;
  const winHighlights = await fr.$$eval('.cell.is-win, .cell.win-pulse, .cell[data-win], .cell.is-highlighted', els => els.length);
  const winPres = obs.some(o => o.e === 'onWinPresentationStart');
  const winPresEnd = obs.some(o => o.e === 'onWinPresentationEnd');
  const cascadeFires = obs.filter(o => o.e === 'onTumbleStep' || o.e === 'onCascadeStart').length;
  const totalCells = post.length;
  spinTraces.push({ spin: i + 1, totalCells, empty, winHighlights, winPres, winPresEnd, cascadeFires });
  if (empty > 0 || winPres || winHighlights > 0 || cascadeFires > 0) {
    console.log(`   spin ${i + 1}: cells=${totalCells} empty=${empty} win=${winHighlights} winPres=${winPres}/${winPresEnd} cascade=${cascadeFires}`);
  }
  /* If empty cells appear, dump the moment */
  if (empty > lastEmptyCount) {
    console.log(`     ⚠️ NEW empty cells at spin ${i + 1}:`);
    const emptyIdx = post.filter(c => !c.txt || c.txt === '' || c.txt === '?').map(c => c.i);
    console.log(`     indices: ${emptyIdx.join(',')}`);
    const sample = post.find(c => !c.txt || c.txt === '');
    if (sample) {
      console.log(`     sample cls: ${sample.cls}`);
      console.log(`     sample bgImage: ${sample.bgImage}`);
    }
    /* Take a screenshot at this moment */
    await page.screenshot({ path: resolve(OUT, `empty-cells-spin-${i + 1}.png`), fullPage: false });
    lastEmptyCount = empty;
  }
}

/* ── PHASE 2: Force multiplier — what actually shows? ── */
console.log(`\n🔬 PHASE 2: Force MULTIPLIER chip — what renders?`);
await fr.evaluate(() => { window.__OBS__ = []; });
const mInitial = await snapshot('before-mult');
await fr.click('.ufp-chip[data-ufp-kind="multiplier"]', { force: true });
await fr.waitForTimeout(800);
/* Also peek parent page for ufp-mult-chip (rendered at document.body, not iframe) */
const parentMultChip = await page.evaluate(() => {
  const ufpChip = document.querySelector('.ufp-mult-chip');
  return ufpChip ? ufpChip.textContent : null;
});
console.log(`   ufp-mult-chip on PARENT page: ${parentMultChip || 'none'}`);
const mImmediate = await fr.evaluate(() => {
  const gfb = document.querySelector('.gfb-banner');
  const mults = Array.from(document.querySelectorAll('.multiplier-orb, .mult-chip, .mult-overlay, [data-mult-chip], .frame-badge, .ufp-mult-chip'));
  const newEls = Array.from(document.querySelectorAll('*[class*="mult"], *[class*="orb"], *[class*="frame"]')).slice(0, 20);
  return {
    gfbVisible: gfb && gfb.getAttribute('data-visible') === 'true',
    gfbText: gfb ? gfb.textContent.trim() : null,
    multElements: mults.length,
    multClasses: mults.map(m => m.className).slice(0, 5),
    classMultOrbHits: newEls.map(e => e.className).slice(0, 10),
    multOrbState: window.MULT_ORB_STATE,
    multiplierMap: window.MULTIPLIER_MAP || (window.MODEL ? window.MODEL.multiplierOrb : null),
  };
});
console.log(`   gfb banner visible: ${mImmediate.gfbVisible}`);
console.log(`   gfb banner text: ${mImmediate.gfbText}`);
console.log(`   mult/orb/frame elements: ${mImmediate.multElements}`);
console.log(`   multOrbState: ${JSON.stringify(mImmediate.multOrbState)}`);
console.log(`   mult-related classes found: ${mImmediate.classMultOrbHits.join(' | ')}`);

await fr.waitForTimeout(3000);

/* ── PHASE 3: Force win prezentaciju ── */
console.log(`\n🔬 PHASE 3: Force BIG WIN — kakvu win prezentaciju vidimo?`);
await fr.evaluate(() => {
  window.__OBS__ = [];
  window.__FORCE_BIG_WIN_TIER__ = 3;
});
await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
await fr.waitForTimeout(2500);
const wpSnap = await fr.evaluate(() => {
  const banner = document.querySelector('.big-win-tier-banner, .win-presentation, .win-banner, .bw-banner');
  const winCells = document.querySelectorAll('.cell.is-win, .cell.win-pulse');
  return {
    bannerVisible: banner ? getComputedStyle(banner).display !== 'none' : false,
    bannerText: banner ? banner.textContent.trim().slice(0, 80) : null,
    winCellCount: winCells.length,
    winAward: window.__WIN_AWARD__,
  };
});
console.log(`   BW banner: vis=${wpSnap.bannerVisible} text="${wpSnap.bannerText}" winCells=${wpSnap.winCellCount} award=${wpSnap.winAward}`);
const obsWP = await fr.evaluate(() => window.__OBS__.map(o => o.e));
console.log(`   Events: ${obsWP.slice(0, 15).join(',')}`);

/* ── Final report ── */
console.log(`\n\n══════ SUMMARY ══════`);
const totalEmpty = spinTraces.reduce((s, t) => s + t.empty, 0);
const anyWinPres = spinTraces.some(t => t.winPres);
const anyWinHighlight = spinTraces.some(t => t.winHighlights > 0);
const cellsConsistent = spinTraces.every(t => t.totalCells === spinTraces[0].totalCells);
console.log(`Cells stable across 30 spins: ${cellsConsistent ? '✅' : '❌'} (${spinTraces[0].totalCells})`);
console.log(`Empty cells across spins: ${totalEmpty}`);
console.log(`Win presentation fired during 30 base spins: ${anyWinPres ? '✅' : '❌ NEVER'}`);
console.log(`Win highlights ever appeared: ${anyWinHighlight ? '✅' : '❌ NEVER'}`);
console.log(`Multiplier force banner: ${mImmediate.gfbVisible ? '✅' : '❌'} ("${mImmediate.gfbText}")`);
console.log(`Multiplier ORB renderuje DOM: ${mImmediate.multElements > 0 ? '✅' : '❌ NIJEDAN'}`);
console.log(`Big-win banner visible after force: ${wpSnap.bannerVisible ? '✅' : '❌'}`);
console.log(`Console errors: ${errs.length}`);
errs.slice(0, 5).forEach(e => console.log(`   ERR: ${e.slice(0, 200)}`));

writeFileSync(resolve(OUT, 'huff-deep-trace.json'), JSON.stringify({
  live, spinTraces, mImmediate, wpSnap, errs: errs.slice(0, 20),
}, null, 2));

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}
