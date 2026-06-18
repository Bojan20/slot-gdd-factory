#!/usr/bin/env node
/**
 * tools/_hw-bonus-position-pinning-probe.mjs
 *
 * Boki: "Sad kad se padnu simboli u base game, moraju da ostanu i u
 * hold and win. Pogledaj detaljno kako treba da bude ta logika iz svih
 * izvora."
 *
 * Dedicated probe — measures bonus-glyph DOM positions at THREE points:
 *   T1. The moment all reels settle in base game (post-trigger).
 *   T2. The moment INTRO placard mounts (still pre-respin).
 *   T3. After 3 respin clicks have completed.
 *
 * Captures cell IDENTITY (by composite CSS selector :nth-of-type chain)
 * for each .is-locked-bonus cell and asserts the set is STRICTLY MONOTONE
 * — the T1 set must be a subset of T2 and T3 (new orbs may add, but no
 * original orb may move or disappear).
 *
 * Output:
 *   reports/hw-bonus-position-pinning/result.json
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5293;
const OUT = `${REPO}/reports/hw-bonus-position-pinning`;
mkdirSync(OUT, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', RST = '\x1b[0m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push({ kind: 'pageerror', msg: e.message }));
page.on('console', m => { if (m.type() === 'error') errs.push({ kind: 'console.error', msg: m.text() }); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 30000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());
await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
await frame.waitForTimeout(800);

console.log('═══ H&W BONUS POSITION PINNING PROBE ═════════════════════════════════════');

// Capture utility — for each B cell, return reel+row by walking RECT_REELS
async function snapshot(label) {
  return await frame.evaluate((lbl) => {
    const out = [];
    const reels = window.RECT_REELS || [];
    for (let r = 0; r < reels.length; r++) {
      const vr = reels[r].visibleRows || 0;
      for (let row = 0; row < vr; row++) {
        const cell = reels[r].cells && reels[r].cells[row + 1];
        if (!cell) continue;
        const txt = (cell.textContent || '').trim().toUpperCase();
        const locked = cell.classList && cell.classList.contains('is-locked-bonus');
        if (txt === 'B' || locked) {
          out.push({
            r, row,
            txt,
            locked: !!locked,
            hasOrb: cell.classList ? cell.classList.contains('cell--orb') : false,
            dls: cell.getAttribute ? cell.getAttribute('data-locked-symbol') : null,
          });
        }
      }
    }
    return { label: lbl, t: Math.round(performance.now()), cells: out };
  }, label);
}

// Trigger via H&W chip
console.log(`${D}→ Click H&W chip${RST}`);
await frame.evaluate(() => {
  const c = document.querySelector('[data-ufp-kind="hold_and_win"]');
  if (c) c.click();
});

// T1 — wait for reels to truly settle then snapshot
await frame.waitForFunction(() => {
  const reels = window.RECT_REELS || [];
  return reels.length > 0 && !reels.some(r => r.spinning || r.stopping || r.bouncing);
}, { timeout: 15000 });
await page.waitForTimeout(150);   // small breath past settle
const T1 = await snapshot('T1_after_settle');
console.log(`${D}T1: reels settled, ${T1.cells.length} bonus cells found${RST}`);

// T2 — wait for INTRO phase (placard mounted)
await frame.waitForFunction(() => window.HW_STATE && window.HW_STATE.phase === 'INTRO', { timeout: 12000 });
await page.waitForTimeout(200);
const T2 = await snapshot('T2_intro_mounted');
console.log(`${D}T2: INTRO phase, ${T2.cells.length} bonus cells${RST}`);

// Wait for RUNNING + dismiss intro
await frame.evaluate(() => { const i = document.querySelector('.hw-intro'); if (i) i.click(); });
await frame.waitForFunction(() => window.HW_STATE && window.HW_STATE.phase === 'RUNNING', { timeout: 8000 });
await page.waitForTimeout(400);

// Drive 3 respins
for (let i = 0; i < 3; i++) {
  const phase = await frame.evaluate(() => window.HW_STATE && window.HW_STATE.phase);
  if (phase !== 'RUNNING') break;
  await frame.evaluate(() => { const b = document.getElementById('spinBtn'); if (b && !b.disabled) b.click(); });
  await page.waitForTimeout(3000);
}
const T3 = await snapshot('T3_after_3_respins');
console.log(`${D}T3: after 3 respins, ${T3.cells.length} bonus cells${RST}`);

// Compute set comparisons
const keyOf = c => `${c.r},${c.row}`;
const setT1 = new Set(T1.cells.map(keyOf));
const setT2 = new Set(T2.cells.map(keyOf));
const setT3 = new Set(T3.cells.map(keyOf));

console.log(`\n${Y}═══ POSITION SETS ═══${RST}`);
console.log(`  T1 (settle):       {${[...setT1].sort().join(' · ')}}  (${setT1.size} cells)`);
console.log(`  T2 (INTRO):        {${[...setT2].sort().join(' · ')}}  (${setT2.size} cells)`);
console.log(`  T3 (3 respins):    {${[...setT3].sort().join(' · ')}}  (${setT3.size} cells)`);

const missingT2 = [...setT1].filter(k => !setT2.has(k));
const missingT3 = [...setT1].filter(k => !setT3.has(k));
const driftedT2 = missingT2.length > 0;
const driftedT3 = missingT3.length > 0;

console.log(`\n${Y}═══ DRIFT VERDICT ═══${RST}`);
console.log(`  T1 ⊆ T2 (no drift settle→INTRO): ${driftedT2 ? R+'✗ DRIFTED — missing: '+missingT2.join(',')+RST : G+'✓ all pinned'+RST}`);
console.log(`  T1 ⊆ T3 (no drift settle→respins): ${driftedT3 ? R+'✗ DRIFTED — missing: '+missingT3.join(',')+RST : G+'✓ all pinned'+RST}`);

// Also verify is-locked-bonus class present at T1
const unlockedAtT1 = T1.cells.filter(c => !c.locked);
console.log(`  T1: every bonus cell carries is-locked-bonus: ${unlockedAtT1.length === 0 ? G+'✓'+RST : R+'✗ '+unlockedAtT1.length+' unlocked'+RST}`);

console.log(`\n${Y}═══ ERRORS ═══${RST}`);
console.log(`  console/page errors: ${errs.length} ${errs.length ? R+'(BAD)'+RST : G+'(ok)'+RST}`);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(`    ${R}${e.kind}${RST}: ${e.msg}`);

writeFileSync(`${OUT}/result.json`, JSON.stringify({ T1, T2, T3, missingT2, missingT3, unlockedAtT1, errs }, null, 2));

const verdict = !driftedT2 && !driftedT3 && unlockedAtT1.length === 0 && errs.length === 0;
console.log(`\n${verdict ? G+'🟢 PASS — bonus positions pinned from settle through respins'+RST : R+'🔴 FAIL — drift detected'+RST}`);

await ctx.close();
await browser.close();
server.kill();
process.exit(verdict ? 0 : 1);
