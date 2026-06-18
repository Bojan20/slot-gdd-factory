#!/usr/bin/env node
/**
 * tools/_hw-pixel-drift-probe.mjs
 *
 * Boki: "Sada kada sam pritisnuo spin, pomerile su se svi simboli za
 * jedan red nanize, kada sam uso u hold and win."
 *
 * Pixel-level drift probe. Measures the y-coordinate (getBoundingClientRect)
 * of every locked bonus cell at THREE points:
 *   T1. The moment INTRO mounts (last base-spin pose).
 *   T2. The moment RUNNING starts (after intro dismiss, before respin).
 *   T3. The moment FIRST RESPIN finishes (per-cell respin completes).
 *
 * Asserts every locked cell's y-coordinate changes by ≤ 2px (sub-pixel
 * snap tolerance) across T1, T2, T3. Anything > 2px is a visual drift
 * bug — the one-row shift Boki reported.
 *
 * Output:
 *   reports/hw-pixel-drift/result.json
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5294;
const OUT = `${REPO}/reports/hw-pixel-drift`;
mkdirSync(OUT, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', RST = '\x1b[0m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push({ kind: 'pageerror', msg: e.message }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 30000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());
await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
await frame.waitForTimeout(800);

console.log('═══ H&W PIXEL DRIFT PROBE ═══════════════════════════════════════════════');

async function shot(label) {
  const p = `${OUT}/${label}.png`;
  try { await page.screenshot({ path: p, fullPage: false }); } catch (_) {}
}

async function snapshot(label) {
  return await frame.evaluate((lbl) => {
    const out = [];
    const reels = window.RECT_REELS || [];
    for (let r = 0; r < reels.length; r++) {
      const vr = reels[r].visibleRows || 0;
      for (let row = 0; row < vr; row++) {
        const cell = reels[r].cells && reels[r].cells[row + 1];
        if (!cell) continue;
        if (cell.classList && cell.classList.contains('is-locked-bonus')) {
          const rect = cell.getBoundingClientRect();
          out.push({
            r, row,
            y: Math.round(rect.top),
            x: Math.round(rect.left),
            h: Math.round(rect.height),
            stripTransform: cell.parentElement && cell.parentElement.style ? cell.parentElement.style.transform : null,
          });
        }
      }
    }
    return { label: lbl, t: Math.round(performance.now()), cells: out };
  }, label);
}

// Click H&W chip
console.log(`${D}→ Click H&W chip${RST}`);
await frame.evaluate(() => {
  const c = document.querySelector('[data-ufp-kind="hold_and_win"]');
  if (c) c.click();
});

// Wait for INTRO mount
await frame.waitForFunction(() => window.HW_STATE && window.HW_STATE.phase === 'INTRO', { timeout: 15000 });
await page.waitForTimeout(400);
await shot('01-intro');
const T1 = await snapshot('T1_intro');
console.log(`${D}T1 INTRO: ${T1.cells.length} locked cells${RST}`);

// Dismiss intro → RUNNING
await frame.evaluate(() => { const i = document.querySelector('.hw-intro'); if (i) i.click(); });
await frame.waitForFunction(() => window.HW_STATE && window.HW_STATE.phase === 'RUNNING', { timeout: 8000 });
await page.waitForTimeout(500);
await shot('02-running-pre-respin');
const T2 = await snapshot('T2_running_pre_respin');
console.log(`${D}T2 RUNNING (pre-respin): ${T2.cells.length} locked cells${RST}`);

// Press SPIN — first respin
await frame.evaluate(() => { const b = document.getElementById('spinBtn'); if (b && !b.disabled) b.click(); });
await page.waitForTimeout(3000);
await shot('03-after-first-respin');
const T3 = await snapshot('T3_after_first_respin');
console.log(`${D}T3 after 1st respin: ${T3.cells.length} locked cells${RST}`);

// Compare T1 ↔ T2 ↔ T3 cell positions
const keyOf = c => `${c.r},${c.row}`;
const mapT1 = new Map(T1.cells.map(c => [keyOf(c), c]));
const mapT2 = new Map(T2.cells.map(c => [keyOf(c), c]));
const mapT3 = new Map(T3.cells.map(c => [keyOf(c), c]));

const drifts = [];
const TOL_PX = 2;
for (const [key, c1] of mapT1) {
  const c2 = mapT2.get(key);
  const c3 = mapT3.get(key);
  if (!c2) { drifts.push({ key, kind: 'missing_T2' }); continue; }
  if (!c3) { drifts.push({ key, kind: 'missing_T3' }); continue; }
  const d12 = Math.abs(c1.y - c2.y);
  const d23 = Math.abs(c2.y - c3.y);
  const d13 = Math.abs(c1.y - c3.y);
  if (d12 > TOL_PX || d23 > TOL_PX || d13 > TOL_PX) {
    drifts.push({ key, c1: c1.y, c2: c2.y, c3: c3.y, d12, d23, d13 });
  }
}

console.log(`\n${Y}═══ PIXEL POSITIONS (locked cells) ═══${RST}`);
console.log(`${'cell'.padEnd(6)}  ${'T1.y'.padStart(5)}  ${'T2.y'.padStart(5)}  ${'T3.y'.padStart(5)}  ${'Δ12'.padStart(5)}  ${'Δ23'.padStart(5)}  ${'Δ13'.padStart(5)}`);
for (const [key, c1] of mapT1) {
  const c2 = mapT2.get(key) || { y: NaN };
  const c3 = mapT3.get(key) || { y: NaN };
  const d12 = Math.abs(c1.y - c2.y);
  const d23 = Math.abs(c2.y - c3.y);
  const d13 = Math.abs(c1.y - c3.y);
  const bad = d12 > TOL_PX || d23 > TOL_PX || d13 > TOL_PX;
  const col = bad ? R : G;
  console.log(`  ${col}${key.padEnd(6)}  ${String(c1.y).padStart(5)}  ${String(c2.y).padStart(5)}  ${String(c3.y).padStart(5)}  ${String(d12).padStart(5)}  ${String(d23).padStart(5)}  ${String(d13).padStart(5)}${RST}`);
}

console.log(`\n${Y}═══ STRIP TRANSFORMS ═══${RST}`);
const stripT1 = T1.cells[0] ? T1.cells[0].stripTransform : null;
const stripT2 = T2.cells[0] ? T2.cells[0].stripTransform : null;
const stripT3 = T3.cells[0] ? T3.cells[0].stripTransform : null;
console.log(`  T1 strip: "${stripT1}"`);
console.log(`  T2 strip: "${stripT2}"`);
console.log(`  T3 strip: "${stripT3}"`);

console.log(`\n${Y}═══ DRIFT VERDICT ═══${RST}`);
if (drifts.length === 0) {
  console.log(`  ${G}✓ PASS — all ${mapT1.size} locked cells stay within ±${TOL_PX}px across T1→T2→T3${RST}`);
} else {
  console.log(`  ${R}✗ FAIL — ${drifts.length}/${mapT1.size} cells drifted >${TOL_PX}px:${RST}`);
  for (const d of drifts.slice(0, 8)) console.log(`    ${R}${JSON.stringify(d)}${RST}`);
}

console.log(`\n  console/page errors: ${errs.length} ${errs.length ? R+'(BAD)'+RST : G+'(ok)'+RST}`);

writeFileSync(`${OUT}/result.json`, JSON.stringify({ T1, T2, T3, drifts, errs }, null, 2));

await ctx.close();
await browser.close();
server.kill();
process.exit(drifts.length === 0 && errs.length === 0 ? 0 : 1);
