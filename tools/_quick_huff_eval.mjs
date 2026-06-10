import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join('${REPO}',p));
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404');}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(5291,'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore','pipe','pipe'] });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5291/', { waitUntil: 'networkidle' });
await page.locator('input[type="file"]').first().setInputFiles(`${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`);
await page.waitForSelector('iframe', { timeout: 20000 });
const fr = await (await page.$('iframe')).contentFrame();
await fr.waitForSelector('.cell', { timeout: 15000 });
await page.waitForTimeout(500);

const info = await fr.evaluate(() => ({
  GAME_EVAL_KIND: window.GAME_EVAL_KIND,
  shape: window.SHAPE?.kind,
  PAYLINE_POOL_len: window.PAYLINE_POOL?.length,
  hasDetectLineWins: typeof window.detectLineWins,
  hasDetectWaysWins: typeof window.detectWaysWins,
  hasApplyWinHighlight: typeof window.applyWinHighlight,
  topology: window.SHAPE,
}));
console.log(JSON.stringify(info, null, 2));

// Now spin once and check what detector returns
await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
await page.waitForTimeout(2500);
const debug = await fr.evaluate(() => {
  // Force-call detector to see what it returns
  let events = [];
  try {
    if (typeof window.detectLineWins === 'function') events = window.detectLineWins() || [];
    else if (typeof window.detectWaysWins === 'function') events = window.detectWaysWins() || [];
  } catch (e) { return { err: String(e) }; }
  const win = window.__WIN_AWARD__;
  // Sample first 3 events
  return {
    eventCount: events.length,
    sampleEvents: events.slice(0, 3),
    winAward: win,
    cells: Array.from(document.querySelectorAll('.cell')).slice(0, 5).map(c => c.textContent),
  };
});
console.log('After 1 spin:', JSON.stringify(debug, null, 2));

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}
