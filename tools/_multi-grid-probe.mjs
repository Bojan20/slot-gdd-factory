#!/usr/bin/env node
/**
 * tools/_multi-grid-probe.mjs
 *
 * Boki direktiva (09.06.2026): rectangle radi savršeno; svaki drugi grid
 * mora se ponašati isto savršeno. Probe svaki dist/*_playable.html, klikni
 * isti contract na rectangle, izvesti pas/fail po grid kindu.
 *
 * Test contract per grid:
 *   • spin × 3  — preSpin emits, cells stable (count)
 *   • TURBO     — __SLOT_TURBO_ACTIVE__ flip
 *   • paytable  — modal opens
 *   • settings  — modal opens
 *   • autoBtn   — modal opens (cancel)
 *   • BIG-WIN   — BIG_WIN_TIER_STATE.current > 0 (only if chip present)
 *   • FS chip   — FSM.phase !== 'BASE' (only if chip present)
 *   • Buy Bonus — FSM.phase !== 'BASE' (only if button present)
 *
 * Exit 0 = ZERO red anywhere; 1 = any per-grid FAIL.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(REPO, 'dist');
const OUT  = resolve(REPO, 'tools/_eyes/multi-grid');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5311;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const files = readdirSync(DIST)
  .filter(f => /^\d+_.*_playable\.html$/.test(f))
  .sort();
console.log(`— Multi-Grid Probe — ${files.length} playables\n`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const ALL = [];

for (const file of files) {
  const url = `http://127.0.0.1:${PORT}/dist/${file}?v=${Date.now()}`;
  const page = await ctx.newPage();
  const errs = []; const warns = []; const unk = []; const pageErrs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errs.push(t);
    if (m.type() === 'warning') warns.push(t);
    if (/unknown event/i.test(t)) unk.push(t);
  });
  page.on('pageerror', (e) => pageErrs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const present = await page.evaluate(() => ({
    hasGrid       : !!document.getElementById('grid') || !!document.querySelector('.grid-rect, .grid-host'),
    cellCount     : document.querySelectorAll('.cell').length,
    hasSpinBtn    : !!document.getElementById('spinBtn'),
    hasTurbo      : !!document.querySelector('#turboBtn, [data-turbo-toggle], button[aria-label*="urbo"]'),
    hasPaytable   : !!document.querySelector('#paytableBtn, button[aria-label*="aytable"], button[aria-label*="ymbol"]'),
    hasSettings   : !!document.querySelector('#settingsMenuBtn, #settingsBtn, button[aria-label*="ettings"]'),
    hasAuto       : !!document.getElementById('autoBtn'),
    hasBuyBonus   : !!document.getElementById('bonusBuyBtn'),
    hasFsChip     : !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'),
    hasBwChip     : !!document.querySelector('.ufp-chip[data-ufp-kind="big_win"]'),
    shape         : (typeof SHAPE !== 'undefined') ? SHAPE.kind : null,
  }));

  /* ── tiny helpers in page scope ── */
  async function snap() {
    return page.evaluate(() => ({
      phase    : window.FSM ? window.FSM.phase : null,
      turbo    : !!window.__SLOT_TURBO_ACTIVE__,
      cellCount: document.querySelectorAll('.cell').length,
      bigWinCur: window.BIG_WIN_TIER_STATE ? window.BIG_WIN_TIER_STATE.current : 0,
      bigWinFinal: window.BIG_WIN_TIER_STATE ? window.BIG_WIN_TIER_STATE.finalTier : 0,
      bigWinWalk: window.BIG_WIN_TIER_STATE ? !!window.BIG_WIN_TIER_STATE.walkActive : false,
      isSpinning: document.getElementById('spinBtn')?.classList.contains('is-spinning'),
    }));
  }
  async function closeAll() {
    await page.evaluate(() => {
      document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], .bb-backdrop, .autoplay-backdrop, .paytable-backdrop, .settings-backdrop, .gamble-backdrop').forEach(el => { try { el.click(); } catch (e) {} });
      document.querySelectorAll('[aria-label="Close"], [aria-label="Cancel"], .close-btn, .modal-close, [data-modal-close]').forEach(el => { try { el.click(); } catch (e) {} });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await page.waitForTimeout(150);
  }

  const tests = [];
  const baselineCells = present.cellCount;

  if (present.hasBwChip) tests.push(['BIG-WIN', async () => {
    await closeAll();
    await page.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="big_win"]').click());
    for (let i = 0; i < 80; i++) {
      const s = await snap();
      if (s.bigWinCur > 0 || s.bigWinFinal > 0 || s.bigWinWalk) return;
      await page.waitForTimeout(150);
    }
    throw new Error('BIG-WIN never activated');
  }]);

  if (present.hasSpinBtn) tests.push(['spin × 3', async () => {
    await closeAll();
    await page.evaluate(() => {
      window.__P_PRE__ = 0;
      window.HookBus.on('preSpin', () => { window.__P_PRE__++; });
    });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 80; j++) {
        const s = await snap();
        if (!s.isSpinning && s.phase === 'BASE') break;
        await page.waitForTimeout(150);
      }
      await page.evaluate(() => document.getElementById('spinBtn')?.click());
      await page.waitForTimeout(2800);
    }
    const fires = await page.evaluate(() => window.__P_PRE__);
    const s = await snap();
    if (fires < 1) throw new Error(`only ${fires}/3 preSpin emits`);
    if (s.cellCount !== baselineCells && baselineCells > 0) throw new Error(`cells ${baselineCells} → ${s.cellCount}`);
  }]);

  if (present.hasTurbo) tests.push(['TURBO', async () => {
    await closeAll();
    const a = await page.evaluate(() => !!window.__SLOT_TURBO_ACTIVE__);
    await page.evaluate(() => document.querySelector('#turboBtn, [data-turbo-toggle], button[aria-label*="urbo"]')?.click());
    await page.waitForTimeout(250);
    const b = await page.evaluate(() => !!window.__SLOT_TURBO_ACTIVE__);
    if (a === b) throw new Error('turbo did not flip');
  }]);

  if (present.hasPaytable) tests.push(['paytable', async () => {
    await closeAll();
    await page.evaluate(() => document.querySelector('#paytableBtn, button[aria-label*="aytable"], button[aria-label*="ymbol"]')?.click());
    await page.waitForTimeout(350);
    const open = await page.evaluate(() => !!document.querySelector('.paytable-modal, .pt-modal, #paytableModal, #ptModal'));
    if (!open) throw new Error('paytable did not open');
  }]);

  if (present.hasSettings) tests.push(['settings', async () => {
    await closeAll();
    await page.evaluate(() => document.querySelector('#settingsMenuBtn, #settingsBtn, button[aria-label*="ettings"]')?.click());
    await page.waitForTimeout(350);
    const open = await page.evaluate(() => !!document.querySelector('.settings-modal, #settingsModal, .sp-modal'));
    if (!open) throw new Error('settings did not open');
  }]);

  if (present.hasAuto) tests.push(['autoplay', async () => {
    await closeAll();
    await page.evaluate(() => document.getElementById('autoBtn')?.click());
    await page.waitForTimeout(350);
    const open = await page.evaluate(() => !!document.querySelector('.autoplay-modal, #autoplayBackdrop, .ap-modal'));
    if (!open) throw new Error('autoplay did not open');
    await closeAll();
  }]);

  if (present.hasFsChip) tests.push(['FS chip', async () => {
    await closeAll();
    await page.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]')?.click());
    /* Up to 20 s — slingo + wheel + lock_respin spin animations are
     * slower than rectangular; we wait for FSM.phase to leave BASE
     * (FS_INTRO is the entry phase). */
    for (let i = 0; i < 140; i++) {
      const s = await snap();
      if (s.phase && s.phase !== 'BASE') return;
      await page.waitForTimeout(150);
    }
    throw new Error('FS phase never entered');
  }]);

  if (present.hasBuyBonus) tests.push(['BUY BONUS', async () => {
    await closeAll();
    /* wait until BASE */
    for (let i = 0; i < 60; i++) {
      const s = await snap();
      if (s.phase === 'BASE') break;
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.getElementById('bonusBuyBtn')?.click());
    for (let i = 0; i < 80; i++) {
      const s = await snap();
      if (s.phase && s.phase !== 'BASE') return;
      await page.waitForTimeout(150);
    }
    throw new Error('Buy Bonus did not trigger FS');
  }]);

  const result = { file, kind: present.shape, cells: present.cellCount, present, tests: [] };
  for (const [name, fn] of tests) {
    try { await fn(); result.tests.push({ name, verdict: 'OK', reason: '' }); }
    catch (e) { result.tests.push({ name, verdict: 'FAIL', reason: e.message }); }
    await closeAll();
  }
  const okCount = result.tests.filter(t => t.verdict === 'OK').length;
  const failCount = result.tests.length - okCount;
  result.errs = errs.length;
  result.warns = warns.length;
  result.unk = unk.length;
  result.pageErrs = pageErrs.length;
  result.firstErr = errs[0] ? errs[0].slice(0, 100) : null;
  const overall = (failCount === 0 && errs.length === 0 && pageErrs.length === 0 && unk.length === 0);
  const flag = overall ? '✅' : '❌';
  console.log(`${flag} ${file.padEnd(48)} kind=${(present.shape||'?').padEnd(15)} tests=${okCount}/${result.tests.length}  err=${errs.length} pg=${pageErrs.length} unk=${unk.length}`);
  if (failCount > 0 || errs.length > 0 || pageErrs.length > 0 || unk.length > 0) {
    for (const t of result.tests.filter(x => x.verdict === 'FAIL')) console.log(`     ✗ ${t.name}: ${t.reason}`);
    if (errs.length) console.log(`     err: ${errs[0].slice(0, 120)}`);
    if (pageErrs.length) console.log(`     pg : ${pageErrs[0].slice(0, 120)}`);
    if (unk.length) console.log(`     unk: ${unk[0].slice(0, 120)}`);
  }
  ALL.push(result);
  await page.close();
}

await browser.close();
server.kill('SIGTERM');

writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(ALL, null, 2));

const greens = ALL.filter(r => r.tests.every(t => t.verdict === 'OK') && r.errs === 0 && r.pageErrs === 0 && r.unk === 0).length;
console.log(`\n▶ Result: ${greens}/${ALL.length} grids fully green`);
process.exit(greens === ALL.length ? 0 : 1);
