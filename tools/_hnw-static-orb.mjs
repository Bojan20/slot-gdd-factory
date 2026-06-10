#!/usr/bin/env node
/**
 * tools/_hnw-static-orb.mjs
 *
 * Boki: "mora da se zadrzava i bude vidljivo u reelu gde je orb koji se
 * dobio, ne da se pomera sa rilom"
 *
 * WoO reference pattern: locked orbs stay STATIC across respins. They
 * don't travel with the rotating reel cells.
 *
 * Test: force H&W chip on Huff PDF → mock 1 bonus cell, spin → confirm
 * the locked cell's text doesn't change mid-spin even as other cells
 * rotate.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5273;
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
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 25000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());

// Spin once so RECT_REELS is populated
await frame.evaluate(() => document.getElementById('spinBtn')?.click());
await page.waitForTimeout(2500);

// Force-lock 2 cells: pick first 2 .cell elements, mark them as locked orbs
const lockSetup = await frame.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('.cell'));
  if (cells.length < 2) return { error: 'not enough cells' };
  // Choose cell idx 6 (middle row reel 1) and 12 (middle row reel 2)
  const lockedIdx = [6, 12];
  const result = [];
  lockedIdx.forEach(i => {
    const c = cells[i];
    if (!c) return;
    c.textContent = 'B';
    c.classList.add('is-locked-bonus');
    c.dataset.lockedSymbol = 'B';
    if (window.HW_STATE) {
      const REELS = window.REELS || 5;
      const r = Math.floor(i / REELS);
      const col = i % REELS;
      window.HW_STATE.lockedCells.set(r + ',' + col, 'B');
      window.HW_STATE.active = true;
    }
    result.push({ idx: i, before: c.textContent, hasClass: c.classList.contains('is-locked-bonus') });
  });
  return result;
});
console.log('Locked setup:', JSON.stringify(lockSetup));

// Now spin and SAMPLE the locked cell's text every 50ms during spin
const samples = await frame.evaluate(async () => {
  const lockedCells = Array.from(document.querySelectorAll('.cell.is-locked-bonus'));
  if (lockedCells.length === 0) return { error: 'no locked cells' };
  const cellPath = lockedCells.map(c => Array.from(document.querySelectorAll('.cell')).indexOf(c));
  // Trigger spin
  document.getElementById('spinBtn')?.click();
  const samples = [];
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 60));
    samples.push({
      t: i * 60,
      cells: lockedCells.map(c => ({
        text: (c.textContent || '').trim(),
        cls: Array.from(c.classList).join(' '),
        rect: c.getBoundingClientRect ? { x: Math.round(c.getBoundingClientRect().left), y: Math.round(c.getBoundingClientRect().top) } : null,
      })),
    });
  }
  return { cellPath, samples };
});

console.log(`\nLocked cell indices: ${JSON.stringify(samples.cellPath)}`);
console.log(`\nSamples (every 60ms across spin):`);
samples.samples.forEach(s => {
  const c0 = s.cells[0];
  const c1 = s.cells[1];
  console.log(`  t=${s.t.toString().padStart(4)}ms  cell0: "${c0.text}" @(${c0.rect.x},${c0.rect.y})  cell1: "${c1.text}" @(${c1.rect.x},${c1.rect.y})`);
});

// Check: did text stay 'B' throughout?
const cell0Texts = new Set(samples.samples.map(s => s.cells[0].text));
const cell1Texts = new Set(samples.samples.map(s => s.cells[1].text));
console.log(`\nCell 0 unique texts during spin: ${JSON.stringify([...cell0Texts])}`);
console.log(`Cell 1 unique texts during spin: ${JSON.stringify([...cell1Texts])}`);
const cell0Stable = cell0Texts.size === 1 && cell0Texts.has('B');
const cell1Stable = cell1Texts.size === 1 && cell1Texts.has('B');
console.log(`\n${cell0Stable ? '✅' : '❌'} Cell 0 stayed locked: ${cell0Stable}`);
console.log(`${cell1Stable ? '✅' : '❌'} Cell 1 stayed locked: ${cell1Stable}`);

console.log(`\nErrors: ${errs.length}`);
errs.slice(0, 5).forEach(e => console.log('  ', e.slice(0, 200)));

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
