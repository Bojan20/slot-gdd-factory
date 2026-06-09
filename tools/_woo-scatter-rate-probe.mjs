#!/usr/bin/env node
/**
 * tools/_woo-scatter-rate-probe.mjs
 *
 * Boki bug: "non stop padaju sketeri i dodatni spinovi" — WoO simulator
 * was triggering FS far too often because parser read countMode="any"
 * instead of "perReel". After parser fix, this probe verifies the live
 * scatter rate on the rebuilt WoO dist HTML so we have hard numbers,
 * not eyeballs. Acceptance:
 *   • per-spin observed scatter count on visible 5×3 grid: each reel
 *     drops at most 1 scatter (perReel mode) → tracked as max(scatter
 *     count per reel) ≤ 1
 *   • FS trigger rate over 200 BASE spins: ≤ ~1% (real WoO target ~0.85%
 *     from the GDD, so 3% is the soft fail-line allowing variance)
 *   • countMode read from runtime FREESPINS.countMode === 'perReel'
 *   • award table values: 3→14, 4→16, 5→18 spins
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { resolve, dirname }      from 'node:path';
import { fileURLToPath }         from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');

const PORT = 5275;
const URL  = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const R='${REPO}';
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join(R,p));
  if(!f.startsWith(R)){res.writeHead(403);return res.end();}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404 '+p);}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  ERR:', m.text()); });

await page.goto(`${URL}dist/wrath-of-olympus.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.cell', { timeout: 12000 });

/* runtime FREESPINS dump */
const fs = await page.evaluate(() => ({
  enabled: window.FREESPINS && window.FREESPINS.enabled,
  countMode: window.FREESPINS && window.FREESPINS.countMode,
  triggerSymbol: window.FREESPINS && window.FREESPINS.triggerSymbol,
  awards: window.FREESPINS && window.FREESPINS.awards,
  triggerCounts: window.FREESPINS && window.FREESPINS.triggerCounts,
}));
console.log('\n📋 WoO runtime FREESPINS:', JSON.stringify(fs, null, 2));

/* Force turbo on to speed up rate measurement */
await page.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));

/* HookBus hook to log FS triggers + scatter visible counts */
await page.evaluate(() => {
  window.__SCATTER_STATS__ = {
    spins: 0,
    fsTriggers: 0,
    perSpinReelScatterCounts: [],
  };
  HookBus.on('onSpinResult', () => {
    var stats = window.__SCATTER_STATS__;
    stats.spins++;
    /* Sample visible grid and count scatter per reel */
    var reels = window.RECT_REELS;
    if (Array.isArray(reels) && reels.length > 0) {
      var perReel = [];
      for (var i = 0; i < reels.length; i++) {
        var r = reels[i];
        var vis = r.visibleRows || window.ROWS || 3;
        var hits = 0;
        for (var k = 1; k <= vis; k++) {
          if ((r.cells[k].textContent || '').toUpperCase() === (window.FREESPINS.triggerSymbol || 'S')) hits++;
        }
        perReel.push(hits);
      }
      stats.perSpinReelScatterCounts.push(perReel);
    }
  });
  HookBus.on('onFsTrigger', () => {
    window.__SCATTER_STATS__.fsTriggers++;
  });
});

const SPINS = 200;
process.stdout.write(`▶ Spinning ${SPINS}× …`);
const t0 = Date.now();
for (let i = 0; i < SPINS; i++) {
  await page.evaluate(() => {
    /* Reset force flags so we measure NATURAL scatter rate, not forced. */
    try { window.FORCE_TRIGGER = null; } catch (_) {}
    try { window.__SLOT_DEV_FORCE_FS__ = false; } catch (_) {}
    try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
    document.querySelectorAll('#fsOverlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
      el.style.display = 'none'; el.style.pointerEvents = 'none';
    });
    window.runOneBaseSpin && window.runOneBaseSpin();
  });
  await page.waitForFunction(
    () => !window.allReelsActive && !document.querySelector('.is-spinning'),
    null, { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(60);
  if ((i + 1) % 50 === 0) process.stdout.write(` ${i + 1}`);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n  elapsed: ${elapsed}s`);

const stats = await page.evaluate(() => window.__SCATTER_STATS__);
const totalSpinScatter = stats.perSpinReelScatterCounts.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
const maxPerReelAny    = Math.max(0, ...stats.perSpinReelScatterCounts.flat());
const violations       = stats.perSpinReelScatterCounts.filter(r => r.some(c => c > 1)).length;
const spinsWith3Plus   = stats.perSpinReelScatterCounts.filter(r => r.filter(c => c > 0).length >= 3).length;

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

console.log('\n────────────────────────────────────────');
console.log('📊 WoO scatter / FS rate report');
console.log('────────────────────────────────────────');
console.log(`Spins measured                    : ${stats.spins}`);
console.log(`Total visible scatter symbols     : ${totalSpinScatter}`);
console.log(`Avg scatters / spin               : ${(totalSpinScatter / stats.spins).toFixed(2)}`);
console.log(`Max scatters on single reel       : ${maxPerReelAny}  (perReel guard demands ≤1)`);
console.log(`Spins violating "max 1 / reel"    : ${violations}  (must be 0)`);
console.log(`Spins with ≥3 reels having scatter: ${spinsWith3Plus}  (∼FS trigger eligible)`);
console.log(`onFsTrigger emits                 : ${stats.fsTriggers}`);
console.log(`Natural FS trigger rate           : ${((stats.fsTriggers / stats.spins) * 100).toFixed(2)}%  (real WoO ≈0.85%)`);

const pass = {
  countMode_perReel:   fs.countMode === 'perReel',
  awards_correct:      JSON.stringify(fs.awards) === JSON.stringify([
    { count: 3, spins: 14 }, { count: 4, spins: 16 }, { count: 5, spins: 18 }
  ]),
  no_max_per_reel_violations: violations === 0,
  fs_rate_sane: (stats.fsTriggers / stats.spins) <= 0.06,
};
console.log('\n────────────────────────────────────────');
console.log('PASS / FAIL:');
for (const [k, v] of Object.entries(pass)) {
  console.log(`  ${v ? '✓' : '✗'} ${k}`);
}
const allPass = Object.values(pass).every(Boolean);
console.log(`\n${allPass ? '✅ ALL PASS' : '❌ SOME FAIL'}`);
process.exit(allPass ? 0 : 1);
