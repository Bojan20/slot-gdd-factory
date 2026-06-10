#!/usr/bin/env node
/**
 * tools/_fs-outro-stuck.mjs
 *
 * 5 GDD-ova (megaclusters, cluster7x7, hexagonal, wheel, starlight) sa
 * istim simptomom: posle 1 spina koji triggeruje FS, walker se zaglavi —
 * phase=BASE, but spinBtn.disabled=true, hasFsCta=true (FS overlay still
 * in DOM).
 *
 * Hypothesis: FS_OUTRO → BASE radi __postFsCleanup. If totalWin > 0, ide
 * kroz presentExternalWin → check bigWinTier → wait onBigWinTierEnd → reEnable.
 * Ako BW walk se pokreće ali ne completes (npr. bigWinTier nije configured),
 * onBigWinTierEnd nikad ne fires → 30s safety lock.
 *
 * Trace: FSM phase + spinBtn.disabled + BW state every 200ms across the
 * entire FS lifecycle.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/fs-outro-stuck`;
mkdirSync(OUT, { recursive: true });

const TARGET = `${REPO}/samples/grids/05_megaclusters_GAME_GDD.md`;

const PORT = 5270;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: '+e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
await page.setInputFiles('#fileInput', TARGET);
await page.waitForSelector('#previewFrame', { timeout: 25000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());

// Trace
await frame.evaluate(() => {
  window.__TRACE = [];
  setInterval(() => {
    const b = document.getElementById('spinBtn');
    window.__TRACE.push({
      t: Date.now(),
      phase: window.FSM ? window.FSM.phase : null,
      disabled: !!(b && b.disabled),
      spinning: !!(b && b.classList.contains('is-spinning')),
      winPresActive: !!window.__SLOT_WIN_PRESENT_ACTIVE__,
      winAward: window.__WIN_AWARD__,
      bwState: window.BIG_WIN_TIER_STATE ? {
        enabled: window.BIG_WIN_TIER_STATE.enabled,
        walkActive: window.BIG_WIN_TIER_STATE.walkActive,
        activeTier: window.BIG_WIN_TIER_STATE.activeTier,
      } : null,
      fsmTotalWin: window.FSM ? window.FSM.totalWin : null,
      fsmSpinsRemaining: window.FSM ? window.FSM.spinsRemaining : null,
      hasFsCta: !!document.querySelector('.fs-overlay-cta, .fs-overlay button, [data-fs-cta]'),
      fsOverlayDisplay: (() => {
        const o = document.querySelector('.fs-overlay, [data-fs-overlay]');
        return o ? getComputedStyle(o).display : null;
      })(),
    });
  }, 250);
});

// Natural spin loop — wait for FS to trigger naturally (megaclusters has high scatter density)
console.log('Spinning to trigger FS naturally...');
for (let i = 0; i < 30; i++) {
  for (let j = 0; j < 30; j++) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ok) break;
    await page.waitForTimeout(150);
  }
  const phaseNow = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
  if (phaseNow !== 'BASE') {
    console.log(`  spin ${i}: phase=${phaseNow} — FS detected, stop spinning, watch lifecycle`);
    break;
  }
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(2000);
}

// Wait for FS lifecycle to complete or 60s
console.log('Waiting up to 60s for FS lifecycle...');
let inFsAtSomePoint = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const s = await frame.evaluate(() => ({
    phase: window.FSM ? window.FSM.phase : null,
    disabled: !!(document.getElementById('spinBtn') && document.getElementById('spinBtn').disabled),
  }));
  if (s.phase && s.phase.startsWith('FS_')) inFsAtSomePoint = true;
  if (s.phase === 'BASE' && !s.disabled) {
    console.log(`  ✅ BASE re-enabled at ${i+1}s`);
    break;
  }
  if (i % 5 === 4) console.log(`  ${i+1}s: phase=${s.phase} disabled=${s.disabled}`);
}

const trace = await frame.evaluate(() => window.__TRACE);
console.log(`\nTrace samples: ${trace.length}`);

// Find FS_OUTRO → BASE transition
let lastOutro = -1, firstBaseAfter = -1, firstBaseEnabled = -1;
for (let i = 0; i < trace.length; i++) {
  if (trace[i].phase === 'FS_OUTRO') lastOutro = i;
  if (lastOutro >= 0 && trace[i].phase === 'BASE' && firstBaseAfter < 0) firstBaseAfter = i;
  if (firstBaseAfter >= 0 && trace[i].phase === 'BASE' && !trace[i].disabled && firstBaseEnabled < 0) firstBaseEnabled = i;
}
if (lastOutro >= 0) console.log(`\nFS_OUTRO last index: ${lastOutro} (t=${trace[lastOutro].t})`);
if (firstBaseAfter >= 0) console.log(`First BASE after FS: index ${firstBaseAfter} (${((trace[firstBaseAfter].t - trace[lastOutro].t)/1000).toFixed(1)}s after OUTRO)`);
if (firstBaseEnabled >= 0) console.log(`First BASE + enabled: index ${firstBaseEnabled}`);
else console.log(`⚠️  BASE + enabled NEVER reached in trace`);

// Print 6 samples around outro→base transition
console.log(`\nSamples around OUTRO→BASE transition:`);
const start = Math.max(0, lastOutro - 2);
const end = Math.min(trace.length, lastOutro + 12);
for (let i = start; i < end; i++) {
  const s = trace[i];
  console.log(`  ${i}: phase=${s.phase} dis=${s.disabled} winPres=${s.winPresActive} bw=${s.bwState ? JSON.stringify(s.bwState) : 'null'} fsTotal=${s.fsmTotalWin}`);
}

writeFileSync(`${OUT}/_trace.json`, JSON.stringify({ trace, errs, lastOutro, firstBaseAfter, firstBaseEnabled }, null, 2));
console.log(`\nErrors: ${errs.length}`);
errs.slice(0, 5).forEach(e => console.log(`  ${e.slice(0, 200)}`));

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
