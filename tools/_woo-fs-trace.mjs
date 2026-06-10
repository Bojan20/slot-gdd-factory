import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 5263;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/Wrath_of_Olympus_playable.html';
  const f=path.normalize(path.join('/Users/vanvinklstudio/Desktop/GDD',p));
  fs.stat(f,(e,st)=>{ if(e||!st.isFile()){res.writeHead(404);return res.end();} res.writeHead(200,{'Cache-Control':'no-store'}); fs.createReadStream(f).pipe(res); });
}).listen(${PORT},'127.0.0.1');
`], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.type(), m.text().slice(0, 200)); });
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForSelector('.cell', { timeout: 10000 });
const ctx = await p.evaluate(() => ({
  POOL_unique: [...new Set(POOL)],
  POOL_size: POOL.length,
  FREESPINS_enabled: FREESPINS?.enabled,
  FREESPINS_triggerSymbol: FREESPINS?.triggerSymbol,
  FREESPINS_triggerCounts: FREESPINS?.triggerCounts,
  FREESPINS_awards: FREESPINS?.awards,
  shape_kind: SHAPE?.kind,
  shape_evaluation: GAME_EVAL_KIND,
  cascade_enabled: !!(SHAPE?.cascade?.enabled),
  ANTI_present: typeof window.maybeArmAnticipation,
  countTriggerSymbols_present: typeof window.countTriggerSymbols,
}));
console.log('— context —');
console.log(JSON.stringify(ctx, null, 2));

await p.evaluate(() => {
  window.__OBS__ = [];
  ['preSpin','onSpinResult','postSpin','onFsTrigger','onScatterCelebrationStart','onForceFeatureRequested','onTumbleStep']
    .forEach(e => HookBus.on(e, p => window.__OBS__.push({event:e, payload:p})));
});
console.log('\n— clicking FS chip + wait 6s —');
await p.evaluate(() => { const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'); if (c) c.click(); });
await p.waitForTimeout(6000);
const obs = await p.evaluate(() => window.__OBS__.slice());
console.log('events captured:', obs.length);
obs.forEach(o => console.log('  ', o.event, JSON.stringify(o.payload || {}).slice(0, 120)));
const post = await p.evaluate(() => ({
  FORCE_TRIGGER: window.FORCE_TRIGGER || null,
  FSM_phase: window.FSM?.phase,
  cellTexts: Array.from(document.querySelectorAll('.cell')).slice(0, 12).map(c => c.textContent),
  scatterCellsOnGrid: Array.from(document.querySelectorAll('.cell')).filter(c => (c.textContent||'').toUpperCase() === (FREESPINS?.triggerSymbol||'S').toUpperCase()).length,
}));
console.log('\n— after click —');
console.log(JSON.stringify(post, null, 2));
await b.close(); srv.kill();
