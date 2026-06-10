#!/usr/bin/env node
/**
 * tools/_huff-multiplier-trace.mjs
 *
 * Boki: "multiplier force ne radi" — opet, posle prethodnih fixova.
 *
 * Metoda:
 *   1. Otvori Huff PDF
 *   2. Pre klika: snimi HookBus.getMult, persistentMult, banner, win events
 *   3. Klik multiplier chip → 200ms wait → snimi sve isto
 *   4. Spin → wait 4000ms → snimi: applied mult, win award, banner text
 *   5. Forsiraj win (plant H1 across) → spin → snimi konačni award
 *   6. Compare to RECT 01 ponašanje — ima li razlika
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-mult`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const HUFF_PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const RECT_MD  = `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md`;

const PORT = 5263;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

async function runOnce(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(file);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const frame = page.frames().find(f => f !== page.mainFrame());
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  // Hook all relevant events
  await frame.evaluate(() => {
    window.__MULT = {
      multClicks: [],
      banners: [],
      multEvents: [],
      winPresStarts: [],
      hookBusMults: [],
      forceFeatureEvents: [],
    };
    if (window.HookBus) {
      window.HookBus.on('onWinPresentationStart', (p) => window.__MULT.winPresStarts.push({ award: p.award, isBigWin: p.isBigWin }));
      window.HookBus.on('onForceFeatureRequested', (p) => window.__MULT.forceFeatureEvents.push(p));
      window.HookBus.on('onForceMultiplier', (p) => window.__MULT.multEvents.push(p));
      window.HookBus.on('postSpin', () => window.__MULT.hookBusMults.push({ t: Date.now(), mult: window.HookBus.getMult ? window.HookBus.getMult() : null }));
    }
  });

  const cfg = await frame.evaluate(() => ({
    shape: window.SHAPE,
    topologyKind: window.SHAPE && window.SHAPE.kind,
    chips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => ({
      kind: c.getAttribute('data-ufp-kind'),
      label: (c.textContent || '').trim(),
    })),
    hasMultChip: !!document.querySelector('.ufp-chip[data-ufp-kind="multiplier"]'),
    hookBusGetMultAvail: !!(window.HookBus && window.HookBus.getMult),
    initialMult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
    persistentMult: window.PERSISTENT_MULTIPLIER && window.PERSISTENT_MULTIPLIER.current,
  }));

  // BEFORE click
  const before = await frame.evaluate(() => ({
    mult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
    persistent: window.PERSISTENT_MULTIPLIER && window.PERSISTENT_MULTIPLIER.current,
    banner: document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent || null,
  }));

  // CLICK multiplier chip
  const clickResult = await frame.evaluate(() => {
    const chip = document.querySelector('.ufp-chip[data-ufp-kind="multiplier"]');
    if (!chip) return { error: 'no chip' };
    chip.click();
    return { clicked: true };
  });
  await page.waitForTimeout(400);

  // AFTER click (before spin)
  const afterClick = await frame.evaluate(() => ({
    mult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
    persistent: window.PERSISTENT_MULTIPLIER && window.PERSISTENT_MULTIPLIER.current,
    bannerVisible: !!document.querySelector('.gfb-banner.visible, .feature-banner.visible, [data-banner-visible="true"]'),
    bannerText: document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent?.trim() || null,
    forceFlag: window.__FORCE_FEATURE__,
    forceEvents: window.__MULT.forceFeatureEvents,
    multEvents: window.__MULT.multEvents,
  }));

  // SPIN
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(4500);

  const afterSpin = await frame.evaluate(() => ({
    mult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
    persistent: window.PERSISTENT_MULTIPLIER && window.PERSISTENT_MULTIPLIER.current,
    bannerText: document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent?.trim() || null,
    winPresStarts: window.__MULT.winPresStarts,
    hookBusMults: window.__MULT.hookBusMults,
    multEvents: window.__MULT.multEvents,
    forceEvents: window.__MULT.forceFeatureEvents,
  }));

  // FORCE WIN — click mult chip, then plant H1 across line 0, then spin
  await frame.evaluate(() => {
    document.querySelector('.ufp-chip[data-ufp-kind="multiplier"]')?.click();
  });
  await page.waitForTimeout(400);
  await frame.evaluate(() => {
    if (!window.RECT_REELS) return;
    for (const reel of window.RECT_REELS) {
      if (!reel || !Array.isArray(reel.visible)) continue;
      for (let r = 0; r < reel.visible.length; r++) reel.visible[r] = 'H1';
      if (Array.isArray(reel.cells)) reel.cells.forEach((c) => { if (c) c.textContent = 'H1'; });
    }
  });
  // Trigger applyWinHighlight directly
  const forceResult = await frame.evaluate(async () => {
    const multBefore = window.HookBus.getMult ? window.HookBus.getMult() : null;
    if (typeof window.applyWinHighlight === 'function') {
      const events = await window.applyWinHighlight();
      return {
        multBefore,
        events: (events || []).length,
        totalPayX: (events || []).reduce((a, e) => a + (Number.isFinite(e.payX) ? e.payX : 0), 0),
        winAward: window.__WIN_AWARD__,
      };
    }
    return { error: 'no applyWinHighlight' };
  });

  await page.screenshot({ path: `${OUT}/${label}_mult_after_force.png` });

  await page.close();
  await ctx.close();
  return { label, cfg, before, clickResult, afterClick, afterSpin, forceResult, errs };
}

console.log('\n══ HUFF ══');
const huff = await runOnce('huff', HUFF_PDF);
console.log('\n══ RECT 01 ══');
const rect = await runOnce('rect', RECT_MD);

writeFileSync(`${OUT}/_mult.json`, JSON.stringify({ huff, rect }, null, 2));

function dump(label, r) {
  console.log(`\n── ${label} ──`);
  console.log(`  shape: ${r.cfg.topologyKind}, chips: ${r.cfg.chips.map(c => c.kind).join(',')}`);
  console.log(`  hasMultChip: ${r.cfg.hasMultChip}, hookBusGetMult: ${r.cfg.hookBusGetMultAvail}, initialMult: ${r.cfg.initialMult}`);
  console.log(`  BEFORE: mult=${r.before.mult} persistent=${r.before.persistent}`);
  console.log(`  AFTER CLICK: mult=${r.afterClick.mult} bannerText="${r.afterClick.bannerText}" forceEvents=${r.afterClick.forceEvents.length} multEvents=${r.afterClick.multEvents.length}`);
  console.log(`  AFTER SPIN: mult=${r.afterSpin.mult} winStarts=${r.afterSpin.winPresStarts.length} multEvents=${r.afterSpin.multEvents.length}`);
  console.log(`  FORCE WIN: multBefore=${r.forceResult.multBefore} events=${r.forceResult.events} totalPayX=${r.forceResult.totalPayX} winAward=${r.forceResult.winAward}`);
  console.log(`  errors: ${r.errs.length}`);
  r.errs.slice(0, 3).forEach(e => console.log(`    ${e.slice(0, 200)}`));
}
dump('HUFF', huff);
dump('RECT', rect);

await browser.close();
server.kill('SIGTERM');
console.log(`\nDetail in ${OUT}/_mult.json`);
