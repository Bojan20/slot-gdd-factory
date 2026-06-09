#!/usr/bin/env node
/** Headed Chromium debug — see exactly where spin gets stuck. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const HOME = process.env.HOME;
const PDF  = (existsSync(`${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`) ? `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` : `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`);
const PORT = 5238;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/`);
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame');
await page.waitForTimeout(800);
const f = page.frames().find((x) => x !== page.mainFrame());
await f.evaluate(() => {
  window.__T0 = performance.now();
  window.__TICK_COUNT = 0;
  /* Patch requestAnimationFrame so we know if it actually ticks. */
  const _raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function(fn) {
    return _raf(function(t) {
      window.__TICK_COUNT++;
      try { fn(t); } catch (e) { window.__TICK_ERR = String(e); }
    });
  };
});

const FREESPINS = await f.evaluate(() => ({
  enabled: window.FREESPINS.enabled,
  triggerSymbol: window.FREESPINS.triggerSymbol,
  triggerCounts: window.FREESPINS.triggerCounts,
  countMode: window.FREESPINS.countMode,
  awards: window.FREESPINS.awards,
}));
console.log('FREESPINS:', FREESPINS);

console.log('— click FS chip (UFP) —');
await f.evaluate(() => {
  const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]');
  c.click();
});
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  const st = await f.evaluate(() => {
    const reels = (typeof RECT_REELS !== 'undefined' && RECT_REELS) ? RECT_REELS.length : 'n/a';
    let stoppedReels = 'n/a';
    try {
      stoppedReels = RECT_REELS.filter(r => !r.spinning).length + '/' + RECT_REELS.length;
    } catch (e) {}
    return {
      ms: Math.round(performance.now() - window.__T0),
      tickCount: window.__TICK_COUNT,
      isSpinning: document.getElementById('spinBtn').classList.contains('is-spinning'),
      stoppedReels,
      tickErr: window.__TICK_ERR || null,
      phase: window.FSM ? window.FSM.phase : null,
      forceTrigger: window.FORCE_TRIGGER,
      lastScatterCount: window.__LAST_SCATTER_COUNT__,
      lastScatterAward: window.__LAST_SCATTER_AWARD__,
      /* sample a few centre-row cells to confirm plant landed */
      centreRowSample: (typeof RECT_REELS !== 'undefined' && RECT_REELS) ? RECT_REELS.slice(0,5).map(r => (r.cells[Math.max(1, Math.ceil((r.visibleRows||3)/2))]?.textContent || '?')) : null,
      allCellSCount: Array.from(document.querySelectorAll('.cell')).filter(c => (c.textContent||'').toUpperCase()==='S').length,
      perReelHits: (typeof RECT_REELS !== 'undefined' && RECT_REELS) ? RECT_REELS.map(r => {
        let h=0; const v=r.visibleRows||3;
        for (let i=1;i<=v;i++) { if ((r.cells[i].textContent||'').toUpperCase()==='S') h++; }
        return h;
      }) : null,
      reelCount: (typeof RECT_REELS !== 'undefined' && RECT_REELS) ? RECT_REELS.length : 'n/a',
      shapeKind: typeof SHAPE !== 'undefined' ? SHAPE.kind : 'n/a',
      manualCount: (typeof countTriggerSymbols === 'function') ? countTriggerSymbols() : 'n/a',
    };
  });
  console.log(`  t+${(i+1)*300}ms:`, st);
}
await browser.close();
server.kill('SIGTERM');
