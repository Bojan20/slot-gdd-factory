#!/usr/bin/env node
/**
 * tools/_hw-orb-anchor-probe.mjs
 *
 * Boki imperative: "mora da se zadržava i bude vidljivo u reelu gde je
 * orb koji se dobio, ne da se pomerala sa rilom".
 *
 * Verification:
 *   1. Upload Huff GDD.
 *   2. Click H&W force chip → orbs seed on N random cells.
 *   3. Record their {row,col} + orb-value + tier.
 *   4. Run 3 base spins via spinBtn.
 *   5. After each settle, re-read the same {row,col} cells.
 *   6. Assert: orb-value + tier unchanged, .is-locked-bonus still set.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/hw-orb-anchor`;
mkdirSync(OUT, { recursive: true });
const PDF  = `${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5847;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page    = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console',  m => { if (m.type() === 'error') errs.push('CONSOLE: '+m.text()); });

const log = (s) => { process.stdout.write(s + '\n'); };
log('1. Goto');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
log('2. Input file');
await page.setInputFiles('#fileInput', PDF);
log('3. Wait #previewFrame');
await page.waitForSelector('#previewFrame', { timeout: 25000 });
log('4. Settle 3s');
await page.waitForTimeout(3000);
log('5. Acquire iframe');
const frame = page.frames().find(f => f !== page.mainFrame());
frame.on('pageerror', e => errs.push('FRAME: '+e));
frame.on('console',  m => { if (m.type() === 'error') errs.push('FRAME-CONSOLE: '+m.text()); });

// Step 1: click H&W force chip
const hwClick = await frame.evaluate(() => {
  const b = document.querySelector('.ufp-chip[data-ufp-kind="hold_and_win"]');
  if (!b) return false;
  b.click();
  return true;
});
console.log('hold_and_win chip clicked:', hwClick);
await frame.waitForTimeout(800);

await page.screenshot({ path: `${OUT}/01_after_force.png` });

const initial = await frame.evaluate(() => {
  const out = [];
  document.querySelectorAll('.cell.is-locked-bonus').forEach((c, idx) => {
    const all = document.querySelectorAll('.cell');
    const gridIdx = Array.prototype.indexOf.call(all, c);
    out.push({
      idx: gridIdx,
      orbValue: c.dataset.orbValue,
      orbTier: c.dataset.orbTier || '',
      lockedSym: c.dataset.lockedSymbol,
      text: (c.textContent || '').trim(),
      hasLockClass: c.classList.contains('is-locked-bonus'),
    });
  });
  return {
    HW_active: !!(window.HW_STATE && window.HW_STATE.active),
    respinsLeft: window.HW_STATE ? window.HW_STATE.respinsLeft : null,
    lockedCount: window.HW_STATE && window.HW_STATE.lockedCells ? window.HW_STATE.lockedCells.size : null,
    cells: out,
  };
});

console.log('\n=== After force-seed ===');
console.log('  HW_active:', initial.HW_active, '· respinsLeft:', initial.respinsLeft, '· lockedCount:', initial.lockedCount);
console.log('  Locked cells:');
initial.cells.forEach(c => console.log('    idx=' + c.idx + ' orbValue=' + c.orbValue + ' tier=' + (c.orbTier || '-')));

if (initial.cells.length === 0) {
  console.log('\n❌ NO ORBS SEEDED — abort');
  await browser.close(); server.kill(); process.exit(1);
}

// Step 2: run 3 spins
const SPIN_COUNT = 3;
const anchorReport = [];
for (let s = 0; s < SPIN_COUNT; s++) {
  await frame.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (btn) btn.click();
  });
  await frame.waitForTimeout(2800);

  const after = await frame.evaluate(initialIdx => {
    const all = document.querySelectorAll('.cell');
    return initialIdx.map(({ idx }) => {
      const c = all[idx];
      if (!c) return { idx, missing: true };
      return {
        idx,
        orbValue: c.dataset.orbValue || null,
        orbTier: c.dataset.orbTier || '',
        lockedSym: c.dataset.lockedSymbol || null,
        text: (c.textContent || '').trim(),
        hasLockClass: c.classList.contains('is-locked-bonus'),
      };
    });
  }, initial.cells.map(c => ({ idx: c.idx })));

  anchorReport.push({ spin: s + 1, cells: after });
  await page.screenshot({ path: `${OUT}/0${s + 2}_after_spin_${s + 1}.png` });
}

console.log('\n=== Per-spin anchor verification ===');
let pass = 0, fail = 0;
anchorReport.forEach(r => {
  console.log(`\n  --- After spin ${r.spin} ---`);
  r.cells.forEach((c, i) => {
    const orig = initial.cells[i];
    const ok = c.hasLockClass
      && c.orbValue === orig.orbValue
      && c.orbTier === orig.orbTier;
    if (ok) pass++; else fail++;
    console.log(`    idx=${c.idx}: hasLock=${c.hasLockClass} orbValue=${c.orbValue} tier=${c.orbTier || '-'} → ${ok ? 'PASS' : 'FAIL (was ' + orig.orbValue + '/' + (orig.orbTier || '-') + ')'}`);
  });
});

console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
if (errs.length) {
  console.log('\n--- ERRORS ---');
  errs.slice(0, 10).forEach(e => console.log(' ·', e.slice(0, 200)));
}

await browser.close();
server.kill();
process.exit(fail > 0 ? 1 : 0);
