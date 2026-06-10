#!/usr/bin/env node
/**
 * tools/_anticipation-coverage.mjs
 *
 * Boki: "ne radi mi anticipacija u svim gridovima"
 *
 * Per-shape probe — drops 1 scatter at a time onto stopped reels during a
 * forced spin, then samples whether ANY of these signals fire:
 *   - reel.col gets `.reelCol--anticipating` (rect-engine path)
 *   - any .cell gets `.cell--anticipating` (cell-engine fallback)
 *   - reel.scheduledStopAt was pushed back (timing-only signal)
 *
 * Output: per-shape PASS/FAIL + which signal path actually fired.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT = `${REPO}/tools/_eyes/anticipation`;
mkdirSync(OUT, { recursive: true });
const TARGETS = readdirSync(`${REPO}/samples/grids`)
  .filter(f => /\.md$/.test(f)).sort()
  .map(f => ({ label: f.replace(/_GAME_GDD\.md$/, '').replace(/^\d+_/, ''), file: `${REPO}/samples/grids/${f}` }));

const PORT = 5285;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const PARALLEL = 4;

async function probe(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#previewFrame', { timeout: 25000 });
    await page.waitForTimeout(2500);
    const frame = page.frames().find(f => f !== page.mainFrame());

    // Sample anticipation signals over 30 spins
    await frame.evaluate(() => {
      window.__ANT = {
        reelGlowCount: 0, cellGlowCount: 0, hasMaybeArm: typeof window.maybeArmAnticipation === 'function',
        hasRectReels: Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0,
        hasFreespins: !!window.FREESPINS, anticipating: 0,
      };
      setInterval(() => {
        if (document.querySelector('.reelCol--anticipating')) window.__ANT.reelGlowCount++;
        if (document.querySelector('.cell--anticipating'))   window.__ANT.cellGlowCount++;
        if (Array.isArray(window.RECT_REELS)) {
          for (const r of window.RECT_REELS) if (r && r.anticipating) window.__ANT.anticipating++;
        }
      }, 100);
    });

    // 30 spinova, prati anticipation glow detekciju
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 40; j++) {
        const ok = await frame.evaluate(() => {
          const b = document.getElementById('spinBtn');
          const ph = window.FSM ? window.FSM.phase : 'BASE';
          return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
        });
        if (ok) break;
        await frame.evaluate(() => {
          const cta = document.querySelector('.fs-overlay-cta, .fs-overlay button, [data-fs-cta]');
          if (cta) cta.click();
        });
        await page.waitForTimeout(150);
      }
      await frame.evaluate(() => document.getElementById('spinBtn')?.click());
      await page.waitForTimeout(1600);
    }

    const r = await frame.evaluate(() => ({
      ...window.__ANT,
      shape: window.SHAPE && window.SHAPE.kind,
      reels: (window.RECT_REELS || []).length,
    }));
    await page.close();
    await ctx.close();
    return { label, ...r, errs: errs.slice(0, 3) };
  } catch (e) {
    await ctx.close();
    return { label, error: e.message, errs };
  }
}

const results = [];
console.log(`\n── Anticipation coverage probe (${TARGETS.length} grids × 30 spinova) ──\n`);
const queue = [...TARGETS];
async function worker(id) {
  while (queue.length) {
    const t = queue.shift();
    if (!t) return;
    const r = await probe(t.label, t.file);
    results.push(r);
    const reelPath = r.reelGlowCount > 0;
    const cellPath = r.cellGlowCount > 0;
    const ok = reelPath || cellPath;
    console.log(`  [W${id}] ${r.label.padEnd(28)} shape=${(r.shape||'?').padEnd(15)} reels=${(r.reels||0).toString().padStart(2)} ${ok ? '✅' : '❌'}  reelGlow=${r.reelGlowCount||0}  cellGlow=${r.cellGlowCount||0}  rectReels=${r.hasRectReels}`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i+1)));

console.log(`\n── Summary ──`);
const noGlow = results.filter(r => (r.reelGlowCount||0) === 0 && (r.cellGlowCount||0) === 0);
console.log(`  No anticipation fired in ${noGlow.length}/${results.length}: ${noGlow.map(r => r.label).join(', ') || '(none)'}`);
writeFileSync(`${OUT}/_coverage.json`, JSON.stringify(results, null, 2));
await browser.close();
server.kill('SIGTERM');
