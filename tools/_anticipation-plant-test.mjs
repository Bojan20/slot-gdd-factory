#!/usr/bin/env node
/**
 * Plant scatter on FIRST 2 stopped reels mid-spin, then check whether
 * maybeArmAnticipation() arms remaining reels. This tests the engine,
 * not the natural scatter rate.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const TARGETS = readdirSync(`${REPO}/samples/grids`)
  .filter(f => /\.md$/.test(f)).sort()
  .map(f => ({ label: f.replace(/_GAME_GDD\.md$/, '').replace(/^\d+_/, ''), file: `${REPO}/samples/grids/${f}` }));

const PORT = 5286;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });

async function probe(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#fileInput', file);
  await page.waitForSelector('#previewFrame', { timeout: 25000 });
  await page.waitForTimeout(2500);
  const frame = page.frames().find(f => f !== page.mainFrame());

  // First populate by spinning once
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(2500);

  // Test: manually plant trigger symbol on first 2 visible cells, then call
  // maybeArmAnticipation manually with fake remaining reels.
  const result = await frame.evaluate(() => {
    const out = { hasMaybeArm: typeof window.maybeArmAnticipation === 'function',
                  shape: window.SHAPE && window.SHAPE.kind,
                  trig: (window.FREESPINS && window.FREESPINS.triggerSymbol) || 'S',
                  hasRect: Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0,
                  rectReels: (window.RECT_REELS || []).length };
    if (!Array.isArray(window.RECT_REELS) || window.RECT_REELS.length === 0) {
      out.armable = false; out.reason = 'no RECT_REELS for this shape';
      return out;
    }
    // Plant trigger symbol on visible cells of first 2 reels
    const trig = out.trig;
    for (let r = 0; r < Math.min(2, window.RECT_REELS.length); r++) {
      const reel = window.RECT_REELS[r];
      if (!reel) continue;
      reel.spinning = false;
      const vis = reel.visibleRows || window.ROWS || 3;
      for (let i = 1; i <= vis; i++) {
        if (reel.cells[i]) reel.cells[i].textContent = trig;
      }
    }
    // Mark remaining reels as still-spinning
    for (let r = 2; r < window.RECT_REELS.length; r++) {
      const reel = window.RECT_REELS[r];
      if (reel) { reel.spinning = true; reel.anticipating = false; reel.scheduledStopAt = performance.now() + 1000; }
    }
    out.armable = true;
    // Call the engine
    try { window.maybeArmAnticipation(); }
    catch (e) { out.callError = e.message; }
    // Sample 1.5s for glow class
    return out;
  });

  // Watch for the glow signal
  const samples = await frame.evaluate(async () => {
    const seen = { reelGlow: 0, cellGlow: 0, lastReelClasses: '' };
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 50));
      const rg = document.querySelectorAll('.reelCol--anticipating').length;
      const cg = document.querySelectorAll('.cell--anticipating').length;
      if (rg > seen.reelGlow) seen.reelGlow = rg;
      if (cg > seen.cellGlow) seen.cellGlow = cg;
    }
    if (Array.isArray(window.RECT_REELS)) {
      seen.anticipatingReels = window.RECT_REELS.filter(r => r && r.anticipating).length;
    }
    return seen;
  });

  await page.close();
  await ctx.close();
  return { label, ...result, ...samples };
}

console.log('\n── Anticipation plant test (engine fires when 2 scatter on stopped reels) ──\n');
const queue = [...TARGETS];
async function worker(id) {
  while (queue.length) {
    const t = queue.shift();
    if (!t) return;
    try {
      const r = await probe(t.label, t.file);
      const fired = (r.reelGlow > 0) || (r.cellGlow > 0) || ((r.anticipatingReels || 0) > 0);
      console.log(`  [W${id}] ${r.label.padEnd(28)} shape=${(r.shape||'?').padEnd(15)} hasRect=${r.hasRect}  ${fired ? '✅' : '❌'}  reelGlow=${r.reelGlow} cellGlow=${r.cellGlow} antReels=${r.anticipatingReels||0}  ${r.reason ? '— '+r.reason : ''}`);
    } catch (e) {
      console.log(`  [W${id}] ${t.label} FAIL: ${e.message}`);
    }
  }
}
await Promise.all([worker(1), worker(2), worker(3), worker(4)]);
await browser.close();
server.kill('SIGTERM');
