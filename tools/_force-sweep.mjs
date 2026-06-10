import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff', path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const PORT = 5237;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) { console.log(`SKIP ${gdd.name}: missing PDF`); continue; }
  console.log(`\n═══ ${gdd.name} ═══`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; const warns = []; const pageErrs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); if (m.type()==='warning') warns.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) { console.log('  ✗ no iframe'); await ctx.close(); continue; }
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });
  frame.on('pageerror', e => pageErrs.push('[iframe] '+e));

  const initialCells = await frame.evaluate(() => document.querySelectorAll('.cell').length);
  console.log(`  initial cells: ${initialCells}`);

  // List ALL force chips
  const chips = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('.ufp-chip')).map(c => ({
      kind: c.getAttribute('data-ufp-kind'),
      text: c.textContent.trim().slice(0, 40),
      disabled: c.hasAttribute('disabled') || c.getAttribute('aria-disabled') === 'true',
    }));
  });
  console.log(`  force chips: ${chips.length} → ${chips.map(c => c.kind).join(',')}`);

  // Spin 20 times, snapshot cells after each
  const spinLog = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 50; j++) {
      const r = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE';
      });
      if (r) break;
      await page.waitForTimeout(150);
    }
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2500);
    const cells = await frame.evaluate(() => document.querySelectorAll('.cell').length);
    spinLog.push(cells);
    if (cells !== initialCells) console.log(`  ⚠ spin#${i+1}: cells dropped ${initialCells} → ${cells}`);
  }
  const finalCells = spinLog[spinLog.length-1];
  console.log(`  after 20 spins: ${finalCells} (baseline ${initialCells}) ${finalCells===initialCells?'✓':'✗ CELLS LOST'}`);

  // Click EVERY force chip
  console.log('  — force chip sweep —');
  for (const chip of chips) {
    if (chip.disabled) { console.log(`    ⊘ ${chip.kind} (disabled)`); continue; }
    // close any modal first
    await frame.evaluate(() => {
      document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], .bb-backdrop, .autoplay-backdrop, .paytable-backdrop, .settings-backdrop, .gamble-backdrop').forEach(el => { try { el.click(); } catch(e){} });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    // wait BASE phase
    for (let j = 0; j < 60; j++) {
      const ok = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        const bwActive = !!(window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.walkActive);
        return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE' && !bwActive;
      });
      if (ok) break;
      await page.waitForTimeout(200);
    }
    const before = await frame.evaluate(() => ({
      cells: document.querySelectorAll('.cell').length,
      ff: window.__FORCE_FEATURE__,
      ft: window.__FORCE_TRIGGER__,
      phase: window.FSM ? window.FSM.phase : 'BASE',
    }));
    const clicked = await frame.evaluate((k) => {
      const c = document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`);
      if (!c) return false;
      c.click();
      return true;
    }, chip.kind);
    if (!clicked) { console.log(`    ✗ ${chip.kind}: chip not found at click time`); continue; }
    // trigger a spin
    await page.waitForTimeout(300);
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(3000);
    const after = await frame.evaluate(() => ({
      cells: document.querySelectorAll('.cell').length,
      phase: window.FSM ? window.FSM.phase : 'BASE',
      bwActive: !!(window.BIG_WIN_TIER_STATE && (window.BIG_WIN_TIER_STATE.current > 0 || window.BIG_WIN_TIER_STATE.walkActive)),
      fsActive: !!(window.FSM && window.FSM.phase && window.FSM.phase !== 'BASE'),
      banner: !!document.querySelector('.gfb-banner, .feature-banner, [data-feature-banner]'),
    }));
    const cellOk = after.cells === initialCells;
    const visible = after.bwActive || after.fsActive || after.banner || after.phase !== 'BASE';
    const verdict = cellOk && visible ? '✓' : (cellOk ? '⚠ no visible effect' : `✗ cells ${after.cells}/${initialCells}`);
    console.log(`    ${verdict} ${chip.kind}: phase=${after.phase} bw=${after.bwActive?1:0} fs=${after.fsActive?1:0} banner=${after.banner?1:0}`);
    // wait for effect to clear
    for (let j = 0; j < 80; j++) {
      const ok = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE';
      });
      if (ok) break;
      await page.waitForTimeout(200);
    }
  }

  console.log(`  console.error: ${errs.length}, warn: ${warns.length}, pageerror: ${pageErrs.length}`);
  if (errs.length) errs.slice(0, 5).forEach(e => console.log(`    err: ${e.slice(0,150)}`));
  await ctx.close();
}

await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));
