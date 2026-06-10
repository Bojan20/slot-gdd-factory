#!/usr/bin/env node
/**
 * tools/_live-walkthrough.mjs
 *
 * Boki direktiva: "kroz sve debilu samo se uveri da radi".
 *
 * Pokrećem headed browser sa video recording, snimam VEROVATAN play
 * lifecycle za oba GDD-a:
 *
 *   1. ubaci PDF → grid live u iframe
 *   2. 25 base spinova (čeka completion)
 *   3. svaki force chip → klik → spin → wait completion → snapshot
 *   4. FS chip → spin → klikni CTA na fsPlacard → wait FS_ACTIVE → 8 FS spinova → outro CTA → BASE
 *   5. BW chip → spin → wait walk → wait BASE
 *   6. final: snapshot, broji prazne, broji broken images, broji errors
 *
 * Output:
 *   tools/_eyes/live/<gdd>/video.webm   (full session)
 *   tools/_eyes/live/<gdd>/*.png        (po stage)
 *   tools/_eyes/live/REPORT.md          (verdikt po stage)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/live`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff',      path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const PORT = 5251;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const HEADLESS = String(process.env.HEADED || '0') === '0';
const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 80 });

const reportRows = [];

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) { console.log(`SKIP ${gdd.name}`); continue; }
  const gddDir = `${OUT}/${gdd.name}`;
  mkdirSync(gddDir, { recursive: true });
  console.log(`\n═══ ${gdd.name} — LIVE walkthrough (${HEADLESS ? 'headless' : 'headed'} + video) ═══`);

  const errs = [], warns = [], pageErrs = [];
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: gddDir, size: { width: 1400, height: 900 } },
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); if (m.type()==='warning') warns.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.screenshot({ path: `${gddDir}/01_landing.png` });

  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${gddDir}/02_gdd_loaded.png` });

  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) {
    reportRows.push({ gdd: gdd.name, stage: 'iframe', verdict: 'FAIL', detail: 'no iframe' });
    await ctx.close();
    continue;
  }
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });
  frame.on('pageerror', e => pageErrs.push('[iframe] '+e));

  const snap = async () => frame.evaluate(() => {
    const cells = document.querySelectorAll('.cell');
    let empty = 0, q = 0;
    cells.forEach(c => {
      const t = (c.textContent || '').trim();
      if (!t) empty++;
      else if (t === '?') q++;
    });
    return {
      total: cells.length,
      empty,
      q,
      phase: window.FSM ? window.FSM.phase : 'BASE',
      bal: window.__SLOT_BALANCE__,
      bet: window.__SLOT_BET__,
      bw: !!(window.BIG_WIN_TIER_STATE && (window.BIG_WIN_TIER_STATE.current > 0 || window.BIG_WIN_TIER_STATE.walkActive)),
      fsRemaining: (window.FSM && window.FSM.spinsRemaining) || 0,
    };
  });

  const waitBase = async (maxMs = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const r = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        const bw = !!(window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.walkActive);
        return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE' && !bw;
      });
      if (r) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };

  const initial = await snap();
  console.log(`  initial: cells=${initial.total} empty=${initial.empty} ?=${initial.q}`);
  const baseline = initial.total;

  // STAGE 3 — 25 base spinova
  let baseEmpties = 0, baseQs = 0;
  for (let i = 0; i < 25; i++) {
    await waitBase();
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(1800);
    const s = await snap();
    if (s.empty > 0) baseEmpties += s.empty;
    if (s.q > 0) baseQs += s.q;
  }
  await waitBase();
  await page.screenshot({ path: `${gddDir}/03_base_25spins.png` });
  const baseFinal = await snap();
  reportRows.push({
    gdd: gdd.name,
    stage: '25 base spinova',
    verdict: (baseFinal.total === baseline && baseEmpties === 0 && baseQs === 0) ? 'OK' : 'FAIL',
    detail: `cells ${baseline}→${baseFinal.total}, emptyHits=${baseEmpties}, qHits=${baseQs}`,
  });
  console.log(`  base 25: cells ${baseline}→${baseFinal.total}, emptyHits=${baseEmpties}, qHits=${baseQs}`);

  // STAGE 4 — svaki force chip, izolovano (reload kroz čišćenje force flag-a)
  const chips = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind'))
  );
  console.log(`  chips: ${chips.join(', ')}`);

  for (const chip of chips) {
    // wait BASE, clear force flag
    await waitBase(8000);
    await frame.evaluate(() => { window.__FORCE_FEATURE__ = null; window.__FORCE_TRIGGER__ = null; });
    const before = await snap();
    // click chip + spin
    const clicked = await frame.evaluate((k) => {
      const c = document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`);
      if (!c) return false;
      c.click();
      return true;
    }, chip);
    if (!clicked) {
      reportRows.push({ gdd: gdd.name, stage: `chip:${chip}`, verdict: 'SKIP', detail: 'chip absent' });
      continue;
    }
    await page.waitForTimeout(250);
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());

    // for FS chip — wait for FS_INTRO + click CTA + run FS spins to completion
    if (chip === 'free_spins') {
      // wait FS_INTRO
      let fsEntered = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const s = await snap();
        if (s.phase === 'FS_INTRO') { fsEntered = true; break; }
        await page.waitForTimeout(200);
      }
      await page.screenshot({ path: `${gddDir}/04_fs_intro.png` });
      // click CTA to enter FS_ACTIVE
      const ctaClicked = await frame.evaluate(() => {
        const cta = document.querySelector('#fsPlacardCta, .fs-placard-cta, [data-fs-cta]');
        if (cta) { cta.click(); return true; }
        return false;
      });
      if (!ctaClicked) {
        // fallback — emit fsIntro skip
        await frame.evaluate(() => window.HookBus && window.HookBus.emit('onSkipRequested', 'fsIntro'));
      }
      // wait FS_ACTIVE then run FS spins until spinsRemaining drops to 0 (outro)
      let fsActiveSeen = false;
      const tA = Date.now();
      while (Date.now() - tA < 8000) {
        const s = await frame.evaluate(() => window.FSM && window.FSM.phase);
        if (s === 'FS_ACTIVE') { fsActiveSeen = true; break; }
        await page.waitForTimeout(200);
      }
      let fsEmpties = 0;
      let fsSpinsExecuted = 0;
      const fsBudget = 40; // generous cap, FS configs go up to ~25 + retrigger
      while (fsSpinsExecuted < fsBudget) {
        // wait for spin button ready: not is-spinning, not disabled, FSM is FS_ACTIVE
        let ready = false;
        for (let j = 0; j < 80; j++) {
          const st = await frame.evaluate(() => ({
            phase: window.FSM ? window.FSM.phase : 'BASE',
            disabled: document.getElementById('spinBtn')?.disabled,
            spinning: document.getElementById('spinBtn')?.classList.contains('is-spinning'),
          }));
          if (st.phase !== 'FS_ACTIVE') { ready = false; break; }
          if (!st.disabled && !st.spinning) { ready = true; break; }
          await page.waitForTimeout(200);
        }
        const phaseNow = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
        if (phaseNow !== 'FS_ACTIVE') break;
        if (!ready) break;
        const before = await frame.evaluate(() => window.FSM.spinsRemaining);
        await frame.evaluate(() => document.getElementById('spinBtn')?.click());
        fsSpinsExecuted++;
        // wait until spinsRemaining drops OR FS exits
        for (let j = 0; j < 40; j++) {
          await page.waitForTimeout(200);
          const r = await frame.evaluate(() => ({ rem: window.FSM.spinsRemaining, phase: window.FSM.phase }));
          if (r.phase !== 'FS_ACTIVE' || r.rem !== before) break;
        }
        const ss = await snap();
        if (ss.empty > 0 || ss.q > 0) fsEmpties += ss.empty + ss.q;
      }
      console.log(`    FS spins executed=${fsSpinsExecuted}`);
      await page.screenshot({ path: `${gddDir}/05_fs_active.png` });
      // wait FS_OUTRO and click CTA
      const tO = Date.now();
      while (Date.now() - tO < 8000) {
        const s = await snap();
        if (s.phase === 'FS_OUTRO') break;
        await page.waitForTimeout(200);
      }
      await frame.evaluate(() => {
        const cta = document.querySelector('#fsPlacardCta, .fs-placard-cta, [data-fs-cta]');
        if (cta) cta.click();
      });
      await waitBase(8000);
      await page.screenshot({ path: `${gddDir}/06_fs_outro_back_to_base.png` });
      const fsFinal = await snap();
      reportRows.push({
        gdd: gdd.name,
        stage: 'FS full lifecycle (intro→active→outro→base)',
        verdict: (fsEntered && fsActiveSeen && fsFinal.phase === 'BASE' && fsFinal.total === baseline && fsEmpties === 0) ? 'OK' : 'FAIL',
        detail: `intro=${fsEntered?1:0} active=${fsActiveSeen?1:0} phase=${fsFinal.phase} cells=${fsFinal.total}/${baseline} fsEmpties=${fsEmpties}`,
      });
      console.log(`  FS lifecycle: intro=${fsEntered?1:0} active=${fsActiveSeen?1:0} → phase=${fsFinal.phase} cells=${fsFinal.total} fsEmpties=${fsEmpties}`);
    } else if (chip === 'big_win') {
      // BIG WIN — walk fires ~2-3s after spin click, runs 4 tiers × 4s + outro
      let bwSeen = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 25000) {
        const s = await snap();
        if (s.bw) { bwSeen = true; break; }
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `${gddDir}/07_bigwin_walk.png` });
      // settle to BASE — walk lifecycle can be 16-25s for tier 5
      await waitBase(40000);
      const bwFinal = await snap();
      reportRows.push({
        gdd: gdd.name,
        stage: 'BIG WIN walk',
        verdict: (bwSeen && bwFinal.total === baseline) ? 'OK' : 'FAIL',
        detail: `bw=${bwSeen?1:0} cells=${bwFinal.total}/${baseline}`,
      });
      console.log(`  BW: bw=${bwSeen?1:0} cells=${bwFinal.total}`);
    } else {
      // multiplier/cascade/ways/cluster_pays — banner/effect, wait BASE
      await page.waitForTimeout(2500);
      const sAfter = await snap();
      const banner = await frame.evaluate(() => !!document.querySelector('.gfb-banner, .feature-banner, .gfb-text, [data-feature-banner]'));
      await page.screenshot({ path: `${gddDir}/08_${chip}.png` });
      reportRows.push({
        gdd: gdd.name,
        stage: `chip:${chip}`,
        verdict: (banner && sAfter.total === baseline && sAfter.empty === 0) ? 'OK' : 'FAIL',
        detail: `banner=${banner?1:0} cells=${sAfter.total}/${baseline} empty=${sAfter.empty}`,
      });
      console.log(`  chip ${chip}: banner=${banner?1:0} cells=${sAfter.total} empty=${sAfter.empty}`);
      await waitBase(8000);
    }
  }

  await page.screenshot({ path: `${gddDir}/99_final.png` });
  console.log(`  errors: ${errs.length}  warns: ${warns.length}  pageErrs: ${pageErrs.length}`);
  if (errs.length) writeFileSync(`${gddDir}/_errors.txt`, errs.slice(0, 50).join('\n'));
  reportRows.push({
    gdd: gdd.name,
    stage: 'console health',
    verdict: errs.length === 0 && pageErrs.length === 0 ? 'OK' : 'FAIL',
    detail: `err=${errs.length} pageErr=${pageErrs.length} warn=${warns.length}`,
  });

  await page.close();
  await ctx.close();
  // rename video
  const vids = readdirSync(gddDir).filter(f => f.endsWith('.webm'));
  for (const v of vids) {
    try { renameSync(`${gddDir}/${v}`, `${gddDir}/walkthrough.webm`); } catch (e) {}
    break;
  }
}

await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));

// REPORT
const md = [
  '# Live Walkthrough — REPORT',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '| GDD | Stage | Verdict | Detail |',
  '|---|---|:-:|---|',
  ...reportRows.map(r => `| ${r.gdd} | ${r.stage} | ${r.verdict === 'OK' ? '✅' : (r.verdict === 'SKIP' ? '⊘' : '❌')} | ${r.detail} |`),
];
writeFileSync(`${OUT}/REPORT.md`, md.join('\n'));
console.log(`\n${OUT}/REPORT.md`);
const fails = reportRows.filter(r => r.verdict === 'FAIL');
console.log(`\nVerdikt: ${reportRows.length - fails.length}/${reportRows.length} OK${fails.length ? '  ('+fails.length+' fail)' : ''}`);
fails.forEach(f => console.log(`  ✗ ${f.gdd} · ${f.stage} · ${f.detail}`));
process.exit(fails.length ? 1 : 0);
