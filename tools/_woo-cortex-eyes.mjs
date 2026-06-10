import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const HTML = '/Users/vanvinklstudio/Desktop/GDD/Wrath_of_Olympus_playable.html';
if (!existsSync(HTML)) { console.error('missing playable:', HTML); process.exit(2); }
const PORT = 5264;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/Wrath_of_Olympus_playable.html';
  const ROOT='/Users/vanvinklstudio/Desktop/GDD';
  const f=path.normalize(path.join(ROOT, p));
  fs.stat(f,(e,st)=>{ if(e||!st.isFile()){res.writeHead(404);return res.end();} res.writeHead(200,{'Cache-Control':'no-store'}); fs.createReadStream(f).pipe(res); });
}).listen(${PORT},'127.0.0.1');
`], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [], warns = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
let pass = 0, fail = 0;
const ok = (s) => { console.log('  ✓', s); pass++; };
const bad = (s) => { console.log('  ✗', s); fail++; };
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.cell, [data-cell]', { timeout: 10000 });

const cells = await page.$$eval('.cell, [data-cell]', els => els.length);
cells >= 30 ? ok(`grid: ${cells} cells (6×5 = 30 min)`) : bad(`grid too thin: ${cells}`);
const title = await page.title();
title.includes('Wrath') ? ok(`title: "${title}"`) : bad(`title: "${title}"`);

await page.evaluate(() => {
  window.__OBS__ = [];
  ['preSpin','onSpinResult','postSpin','onFsTrigger','onScatterCelebrationStart','onBigWinTierEntered','onForceFeatureRequested','onTurboToggle']
    .forEach(e => HookBus.on(e, p => window.__OBS__.push({event:e,payload:p})));
});

for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await page.waitForFunction(() => !window.allReelsActive && !document.querySelector('.is-spinning'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
}
const after5 = await page.$$eval('.cell, [data-cell]', els => els.length);
after5 === cells ? ok(`cells stable after 5 spins: ${after5}/${cells}`) : bad(`cell loss: ${after5}/${cells}`);
const obs = await page.evaluate(() => window.__OBS__.slice());
const pre = obs.filter(o=>o.event==='preSpin').length;
const post = obs.filter(o=>o.event==='postSpin').length;
pre >= 5 ? ok(`preSpin emitted ${pre}× (≥ 5)`) : bad(`preSpin only ${pre}×`);
post >= 5 ? ok(`postSpin emitted ${post}× (≥ 5)`) : bad(`postSpin only ${post}×`);

// Turbo (off → spin → on → spin → measure)
const t0 = Date.now();
await page.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
await page.waitForFunction(() => !window.allReelsActive && !document.querySelector('.is-spinning'), null, { timeout: 8000 }).catch(() => {});
const offMs = Date.now() - t0;
await page.evaluate(() => window.turboModeOn && window.turboModeOn('test'));
const t1 = Date.now();
await page.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
await page.waitForFunction(() => !window.allReelsActive && !document.querySelector('.is-spinning'), null, { timeout: 8000 }).catch(() => {});
const onMs = Date.now() - t1;
(onMs < offMs * 0.75) ? ok(`turbo: ${Math.round((1 - onMs/offMs)*100)}% faster (off=${offMs}ms on=${onMs}ms)`) : bad(`turbo not faster: off=${offMs}ms on=${onMs}ms`);
await page.evaluate(() => window.turboModeOff && window.turboModeOff('test'));

// FS chip with 3-retry + 7s wait
let fsCele = false, fsTrig = false;
for (let attempt = 0; attempt < 3 && !(fsCele && fsTrig); attempt++) {
  await page.evaluate(() => {
    try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
    try { window.FORCE_TRIGGER = null; } catch (_) {}
    document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => { el.style.display='none'; el.style.pointerEvents='none'; });
    window.__OBS__ = [];
  });
  await page.evaluate(() => { const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'); if (c) c.click(); });
  await page.waitForTimeout(7000);
  const fsObs = await page.evaluate(() => window.__OBS__.slice());
  fsCele = fsCele || fsObs.some(o => o.event === 'onScatterCelebrationStart');
  fsTrig = fsTrig || fsObs.some(o => o.event === 'onFsTrigger');
}
fsCele ? ok('FS scatter celebration emitted') : bad('FS scatter celebration NOT emitted');
fsTrig ? ok('FS trigger fired') : bad('FS trigger NOT fired');

// BW chip
await page.evaluate(() => {
  try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
  try { window.FORCE_TRIGGER = null; } catch (_) {}
  document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => { el.style.display='none'; el.style.pointerEvents='none'; });
  window.__OBS__ = [];
});
await page.evaluate(() => { const c=document.querySelector('.ufp-chip[data-ufp-kind="big_win"]'); if(c) c.click(); });
await page.waitForTimeout(8000);
const bwObs = await page.evaluate(() => window.__OBS__.slice());
const bwTier = bwObs.find(o=>o.event==='onBigWinTierEntered');
bwTier ? ok(`BIG-WIN tier entered (tier ${bwTier.payload?.tier})`) : bad('BIG-WIN tier NOT entered');

// Modals
async function modal(name, sel, modalSel) {
  const btn = await page.$(sel);
  if (!btn) { bad(`${name} button not present (${sel})`); return; }
  await btn.click();
  await page.waitForTimeout(700);
  const visible = await page.$$eval(modalSel, els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
  visible ? ok(`${name} modal opens`) : bad(`${name} modal NOT visible`);
}
await modal('Settings', '.settings-btn, #settingsMenuBtn', '.settings-modal, .settings-backdrop');
await modal('Paytable', '.paytable-btn', '.paytable-modal, .paytable-backdrop');
await modal('History',  '.history-btn',  '.history-modal, .history-backdrop, .history-panel');

errs.length === 0 ? ok('0 console errors') : bad(`${errs.length} console errors: ${errs[0]?.slice(0,140)}`);
const ubeWarns = warns.filter(w => /\[HookBus\] unknown event/.test(w));
ubeWarns.length === 0 ? ok('0 unknown HookBus events') : bad(`${ubeWarns.length} unknown HookBus events`);

await browser.close();
srv.kill();
console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
