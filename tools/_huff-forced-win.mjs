#!/usr/bin/env node
/**
 * tools/_huff-forced-win.mjs
 *
 * Plant identical symbols on cells so detectWaysWins() finds a win,
 * then trace win presentation lifecycle + cell state moment-by-moment.
 *
 * Goal: Reproducirati Boki bug "ćelije nestaju kad se win desi".
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/huff-forced-win');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5292;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const R='${REPO}';
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join(R,p));
  if(!f.startsWith(R)){res.writeHead(403);return res.end();}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404');}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore','pipe','pipe'] });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, recordVideo: { dir: OUT } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: ' + String(e)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.locator('input[type="file"]').first().setInputFiles(`${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`);
await page.waitForSelector('iframe', { timeout: 25000 });
const fr = await (await page.$('iframe')).contentFrame();
await fr.waitForSelector('.cell', { timeout: 18000 });
await page.waitForTimeout(800);

await fr.evaluate(() => {
  window.__OBS__ = [];
  if (window.HookBus) {
    ['preSpin','onSpinResult','postSpin','onWinPresentationStart','onWinPresentationEnd',
     'onTumbleStep','onCascadeStart','onCascadeEnd','onBalanceChanged']
      .forEach(e => HookBus.on(e, p => window.__OBS__.push({ e, t: Date.now() })));
  }
});

/* Snapshot all cells */
async function snap() {
  return fr.evaluate(() => Array.from(document.querySelectorAll('.cell')).map((c, i) => ({
    i, txt: (c.textContent || '').trim(), cls: c.className,
    visible: getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden',
    opacity: getComputedStyle(c).opacity,
  })));
}

const baseline = await snap();
console.log(`\n📋 baseline cells: ${baseline.length}, visible: ${baseline.filter(c => c.visible).length}`);

/* === Plant a strong win: same HP symbol on first row, all reels === */
console.log(`\n🎯 Forcing win: plant 'PIGGY' across reel 0 row 0`);
await fr.evaluate(() => {
  const symbols = window.POOL || [];
  const pick = symbols.find(s => /piggy|tm|h1/i.test(String(s))) || symbols[0];
  console.log('Planting symbol:', pick);
  /* For lock_respin/ways, plant same symbol on top row of all reels.
     RECT_REELS has reel.cells[] indexed 0..rows-1 visible. */
  if (window.RECT_REELS && window.RECT_REELS.length > 0) {
    for (const reel of window.RECT_REELS) {
      const vis = reel.visibleRows || window.ROWS || 3;
      for (let r = 1; r <= vis; r++) {
        if (reel.cells[r]) reel.cells[r].textContent = pick;
      }
    }
  } else {
    /* fallback: just paint .cell elements */
    document.querySelectorAll('.cell').forEach(c => { c.textContent = pick; });
  }
});

/* Capture cell state after plant */
const planted = await snap();
console.log(`After plant: ${planted.length} cells, sample: ${planted.slice(0, 5).map(c => c.txt).join(',')}`);

/* === Now directly trigger applyWinHighlight to fire win presentation === */
console.log(`\n⚡ Triggering applyWinHighlight() directly`);
await fr.evaluate(() => { window.__OBS__ = []; });

const beforeWin = Date.now();
const result = await fr.evaluate(async () => {
  try {
    if (typeof window.applyWinHighlight === 'function') {
      const r = await window.applyWinHighlight();
      return { events: Array.isArray(r) ? r.slice(0, 3) : r, winAward: window.__WIN_AWARD__ };
    }
    return { error: 'applyWinHighlight not on window' };
  } catch (e) { return { error: String(e) }; }
});
const winElapsed = Date.now() - beforeWin;
console.log(`   applyWinHighlight returned in ${winElapsed}ms:`, JSON.stringify(result));

/* === Capture cells DURING win presentation === */
await page.waitForTimeout(200);
const duringWin = await snap();
console.log(`\n🔍 DURING win presentation (200ms in):`);
console.log(`   cells: ${duringWin.length}`);
const emptyDuring = duringWin.filter(c => !c.txt);
const invisibleDuring = duringWin.filter(c => !c.visible || parseFloat(c.opacity) < 0.5);
console.log(`   empty: ${emptyDuring.length}`);
console.log(`   invisible/low-opacity: ${invisibleDuring.length} (sample: ${invisibleDuring.slice(0, 3).map(c => `[${c.i}] op=${c.opacity}`).join(',')})`);

await page.screenshot({ path: resolve(OUT, 'during-win.png'), fullPage: false });

/* Wait for presentation to finish */
await page.waitForTimeout(4000);

const after = await snap();
console.log(`\n🔍 AFTER win presentation (4s later):`);
console.log(`   cells: ${after.length}`);
const emptyAfter = after.filter(c => !c.txt);
const invisAfter = after.filter(c => !c.visible || parseFloat(c.opacity) < 0.5);
console.log(`   empty: ${emptyAfter.length}`);
console.log(`   invisible: ${invisAfter.length}`);

await page.screenshot({ path: resolve(OUT, 'after-win.png'), fullPage: false });

const obs = await fr.evaluate(() => window.__OBS__.slice());
console.log(`\n📜 HookBus events: ${obs.map(o => o.e).join(' → ')}`);
console.log(`Console errors: ${errs.length}`);
errs.slice(0, 5).forEach(e => console.log(`   ERR: ${e.slice(0, 150)}`));

writeFileSync(resolve(OUT, 'forced-win.json'), JSON.stringify({
  baseline: baseline.length, planted: planted.slice(0, 5),
  result, duringWin: { total: duringWin.length, empty: emptyDuring.length, invisible: invisibleDuring.length },
  after: { total: after.length, empty: emptyAfter.length, invisible: invisAfter.length },
  events: obs.map(o => o.e),
  errs: errs.slice(0, 10),
}, null, 2));

await ctx.close();
await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}
