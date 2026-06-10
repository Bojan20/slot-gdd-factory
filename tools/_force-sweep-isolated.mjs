#!/usr/bin/env node
/**
 * tools/_force-sweep-isolated.mjs
 *
 * Per-chip ISOLATED test:
 *   - reload PDF fresh for EVERY chip
 *   - click chip once
 *   - click spin once
 *   - validate the chip's SPECIFIC effect (multiplier ≠ FS, cascade ≠ FS, ...)
 *
 * Boki bug: "ne rade svi force-ovi" — chip-ovi se lepe za FS state zato
 * što sweep redom klika sve chip-ove i FS prethodnog klika curi u sledeći.
 * Ovaj probe reload-uje frame pre svakog chip-a → svaki klik dobija čist BASE.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff',      path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const EXPECT = {
  free_spins:  (st) => st.fsActive || st.phase === 'FS_INTRO',
  multiplier:  (st) => st.banner || st.multiplierActive,
  cascade:     (st) => st.cascadeRan || st.banner,
  ways:        (st) => st.banner || st.waysActive,
  cluster_pays:(st) => st.banner || st.clusterActive,
  big_win:     (st) => st.bwActive,
};

const PORT = 5238;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

async function snapshot(frame) {
  return frame.evaluate(() => ({
    cells:            document.querySelectorAll('.cell').length,
    phase:            window.FSM ? window.FSM.phase : 'BASE',
    fsActive:         !!(window.FSM && window.FSM.phase && window.FSM.phase !== 'BASE'),
    bwActive:         !!(window.BIG_WIN_TIER_STATE && (window.BIG_WIN_TIER_STATE.current > 0 || window.BIG_WIN_TIER_STATE.walkActive)) || (Number.isFinite(window.__BIG_WIN_TIER__) && window.__BIG_WIN_TIER__ > 0),
    banner:           !!document.querySelector('.gfb-banner, .feature-banner, [data-feature-banner], .gfb-text'),
    multiplierActive: !!(window.PERSISTENT_MULTIPLIER && window.PERSISTENT_MULTIPLIER.current > 1) || !!document.querySelector('.multiplier-orb, [data-multiplier]'),
    cascadeRan:       !!window.__CASCADE_RAN__ || !!document.querySelector('.cell[data-cascade]'),
    waysActive:       !!document.querySelector('[data-ways-active]'),
    clusterActive:    !!document.querySelector('[data-cluster-active]'),
    forceFlag:        window.__FORCE_FEATURE__ || null,
  }));
}

async function runChip(gdd, kind) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  await page.goto(URL, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1100);
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) { await page.close(); return { verdict: 'FAIL', reason: 'no iframe' }; }
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  const initialCells = (await snapshot(frame)).cells;

  // wait BASE
  for (let j = 0; j < 60; j++) {
    const r = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE';
    });
    if (r) break;
    await page.waitForTimeout(150);
  }

  const exists = await frame.evaluate((k) => {
    const c = document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`);
    if (!c) return false;
    return !c.hasAttribute('disabled') && c.getAttribute('aria-disabled') !== 'true';
  }, kind);
  if (!exists) { await page.close(); return { verdict: 'SKIP', reason: 'chip not present or disabled' }; }

  await frame.evaluate((k) => {
    document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`).click();
  }, kind);
  await page.waitForTimeout(250);
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  // wait for feature to materialize (up to 12s)
  let st = null;
  for (let j = 0; j < 80; j++) {
    await page.waitForTimeout(150);
    st = await snapshot(frame);
    const expected = EXPECT[kind];
    if (expected && expected(st)) break;
  }
  st = await snapshot(frame);
  const expected = EXPECT[kind];
  const cellOk = st.cells === initialCells;
  const featureOk = expected ? expected(st) : true;
  const verdict = cellOk && featureOk ? 'OK' : (!cellOk ? `cells ${initialCells}→${st.cells}` : `no feature evidence (phase=${st.phase} fs=${st.fsActive?1:0} bw=${st.bwActive?1:0} banner=${st.banner?1:0} mult=${st.multiplierActive?1:0})`);
  await page.close();
  return { verdict: verdict === 'OK' ? 'OK' : 'FAIL', reason: verdict === 'OK' ? '' : verdict, errs: errs.length };
}

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) { console.log(`SKIP ${gdd.name}: missing PDF`); continue; }
  console.log(`\n═══ ${gdd.name} ═══`);
  // discover chips once
  const probe = await ctx.newPage();
  await probe.goto(URL, { waitUntil: 'load' });
  await (await probe.$('#fileInput')).setInputFiles(gdd.path);
  await probe.waitForSelector('#previewFrame', { timeout: 15000 });
  await probe.waitForTimeout(1100);
  const pframe = probe.frames().find(f => f !== probe.mainFrame());
  const chips = await pframe.evaluate(() => Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')));
  await probe.close();
  console.log(`  chips: ${chips.join(', ')}`);

  for (const k of chips) {
    const r = await runChip(gdd, k);
    const mark = r.verdict === 'OK' ? '✓ OK   ' : (r.verdict === 'SKIP' ? '⊘ SKIP ' : '✗ FAIL ');
    console.log(`  ${mark} ${k.padEnd(14)} ${r.reason || ''}${r.errs ? ` [${r.errs} errs]` : ''}`);
  }
}

await ctx.close();
await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));
