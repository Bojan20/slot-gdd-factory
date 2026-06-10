#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5252;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') console.log('ERR:', m.text()); });
page.on('pageerror', e => console.log('PAGEERR:', e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame', { timeout: 15000 });
await page.waitForTimeout(1500);
const frame = page.frames().find(f => f !== page.mainFrame());

const fs = await frame.evaluate(() => ({
  FREESPINS: window.FREESPINS,
  FSM: window.FSM,
}));
console.log('FREESPINS:', JSON.stringify(fs.FREESPINS, null, 2));
console.log('FSM init:', JSON.stringify(fs.FSM));

// Click FS chip + spin
await frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]').click());
await page.waitForTimeout(300);
await frame.evaluate(() => document.getElementById('spinBtn').click());

// Wait for FS_INTRO
for (let i = 0; i < 40; i++) {
  const ph = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
  if (ph === 'FS_INTRO') break;
  await page.waitForTimeout(200);
}
console.log('  reached FS_INTRO');
// Click CTA
const cta = await frame.evaluate(() => {
  const c = document.querySelector('#fsPlacardCta, .fs-placard-cta, [data-fs-cta]');
  if (c) { c.click(); return c.tagName + '#' + (c.id||'') + '.' + (c.className||''); }
  return null;
});
console.log('  CTA:', cta);
for (let i = 0; i < 30; i++) {
  const ph = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
  if (ph === 'FS_ACTIVE') break;
  await page.waitForTimeout(200);
}
const total = await frame.evaluate(() => window.FSM.spinsTotal);
console.log(`  FS_ACTIVE entered, spinsTotal=${total}`);

// Run spins WHILE FS_ACTIVE
let n = 0;
while (n < 50) {
  const st = await frame.evaluate(() => ({
    phase: window.FSM.phase,
    remaining: window.FSM.spinsRemaining,
    btnDisabled: document.getElementById('spinBtn').disabled,
    isSpinning: document.getElementById('spinBtn').classList.contains('is-spinning'),
  }));
  if (st.phase !== 'FS_ACTIVE') {
    console.log(`  FS exited after ${n} spins, phase=${st.phase}, remaining=${st.remaining}`);
    break;
  }
  if (!st.btnDisabled && !st.isSpinning) {
    await frame.evaluate(() => document.getElementById('spinBtn').click());
    n++;
    await page.waitForTimeout(150);
    const after = await frame.evaluate(() => ({
      remaining: window.FSM.spinsRemaining,
      phase: window.FSM.phase,
    }));
    console.log(`  spin#${n} clicked → remaining=${after.remaining} phase=${after.phase}`);
  }
  await page.waitForTimeout(300);
}

const final = await frame.evaluate(() => ({ phase: window.FSM.phase, remaining: window.FSM.spinsRemaining, totalWin: window.FSM.totalWin }));
console.log('  final FSM:', JSON.stringify(final));

await ctx.close();
await browser.close();
server.kill('SIGTERM');
