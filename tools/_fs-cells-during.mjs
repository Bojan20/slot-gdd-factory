#!/usr/bin/env node
/**
 * Snapshot cells & screenshots DURING the FS lifecycle for Huff and Starlight.
 * Polls every 250ms during FS_INTRO → FS_SPINNING → FS_EXIT, logs cell counts
 * and any empty/? cells. Saves PNG at each phase transition.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/fs-cells`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff',      path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const PORT = 5240;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) continue;
  console.log(`\n═══ ${gdd.name} — FS lifecycle cell tracking ═══`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().find(f => f !== page.mainFrame());

  const snap = async () => frame.evaluate(() => {
    const cells = document.querySelectorAll('.cell');
    let empty = 0, question = 0;
    cells.forEach(c => {
      const t = (c.textContent || '').trim();
      if (!t) empty++;
      else if (t === '?') question++;
    });
    return {
      total: cells.length,
      empty,
      question,
      phase: window.FSM ? window.FSM.phase : 'BASE',
    };
  });

  await frame.evaluate(() => {
    document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]')?.click();
  });
  await page.waitForTimeout(300);
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());

  const samples = [];
  const phaseShots = new Set();
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(250);
    const s = await snap();
    samples.push({ t: i * 250, ...s });
    if (!phaseShots.has(s.phase)) {
      phaseShots.add(s.phase);
      await page.screenshot({ path: `${OUT}/${gdd.name}_${s.phase}_${Date.now()}.png` });
    }
    // exit when back to BASE after going non-BASE
    if (samples.length > 4 && samples.slice(-3).every(x => x.phase === 'BASE') && samples.some(x => x.phase !== 'BASE')) break;
  }
  // Summarize by phase
  const byPhase = {};
  for (const s of samples) {
    if (!byPhase[s.phase]) byPhase[s.phase] = { count: 0, minCells: Infinity, maxCells: 0, totalEmpty: 0, totalQ: 0 };
    const p = byPhase[s.phase];
    p.count++;
    p.minCells = Math.min(p.minCells, s.total);
    p.maxCells = Math.max(p.maxCells, s.total);
    p.totalEmpty += s.empty;
    p.totalQ += s.question;
  }
  for (const [ph, v] of Object.entries(byPhase)) {
    console.log(`  ${ph.padEnd(15)} samples=${v.count} cells=${v.minCells}..${v.maxCells} totalEmpty=${v.totalEmpty} total?=${v.totalQ}`);
  }

  await ctx.close();
}

await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));
console.log(`\nScreenshots at: ${OUT}`);
