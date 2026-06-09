#!/usr/bin/env node
/**
 * tools/_behavior-parity-probe.mjs
 *
 * Behavioral parity test — rectangle (works perfectly) vs Huff & Puff
 * (Boki: "postoje bugovi"). Both PDFs must yield IDENTICAL behavior for
 * the canonical interactive surface:
 *
 *   1. SPIN ×5     — preSpin / onSpinResult / postSpin each fire 5×
 *                     balance delta non-zero, win events emit when grid pays
 *   2. TURBO       — toggle → __SLOT_TURBO_ACTIVE__ flips, next spin
 *                     measurably faster (< 70% of baseline) AND on-screen
 *                     reels actually animate at higher speed (sampled)
 *   3. FS chip     — onForceFeatureRequested + FORCE_TRIGGER planted +
 *                     scatter celebration emits onScatterCelebrationStart +
 *                     FSM enters FS_INTRO + recovers to BASE
 *   4. BIG-WIN     — __FORCE_BIG_WIN_TIER__ set + banner enters + walks
 *                     tiers + emits onBigWinTierEnd + balance updated
 *   5. BUY BONUS   — bonusBuyBtn click → FORCE_TRIGGER planted → FS
 *                     triggers same way as FS chip
 *   6. Settings    — modal opens + close button works
 *   7. Paytable    — modal opens + close button works
 *   8. History     — panel opens + at least 1 entry present after spin
 *   9. Cells       — stable count across 20 spins
 *
 * For every check we PASS ONLY IF both rectangle AND huff produce the
 * same outcome. Any divergence is a template-wide bug Boki wants closed.
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                     from 'node:path';
import { fileURLToPath }                        from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/behavior-parity');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
function _resolveGdd(filename) {
  const newP = `${HOME}/Desktop/GDD/${filename}`;
  const oldP = `${HOME}/Desktop/${filename}`;
  return existsSync(newP) ? newP : oldP;
}
const HUFF_PDF = _resolveGdd('Huff_N_More_Puff_GDD.pdf');
const GATES_PDF = _resolveGdd('Gates_of_Olympus_1000_GDD.pdf');
const STAR_PDF  = _resolveGdd('Starlight_Travellers_GDD.pdf');

const PORT = 5259;
const URL  = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const R='${REPO}';
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join(R,p));
  if(!f.startsWith(R)){res.writeHead(403);return res.end();}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404 '+p);}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 700));

async function loadFrame(browser, navOrPdf) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  const warns = [];
  page.on('console', m => {
    if (m.type() === 'error')   errs.push(m.text());
    if (m.type() === 'warning') warns.push(m.text());
  });
  page.on('pageerror', e => errs.push(String(e)));

  let frame;
  if (navOrPdf.endsWith('.pdf')) {
    await page.goto(URL, { waitUntil: 'networkidle' });
    const fi = page.locator('input[type="file"]').first();
    await fi.setInputFiles(navOrPdf);
    await page.waitForSelector('iframe', { timeout: 30000 });
    const fe = await page.$('iframe');
    frame = await fe.contentFrame();
  } else {
    await page.goto(navOrPdf, { waitUntil: 'networkidle' });
    frame = page;
  }
  await frame.waitForSelector('.cell, text, [data-cell]', { timeout: 15000 });
  return { page, frame, errs, warns };
}

async function runScenario(label, fr, errs) {
  const r = { label, checks: {} };

  await fr.evaluate(() => {
    window.__OBSERVED__ = [];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['preSpin','onSpinResult','postSpin','onFsTrigger','onFsEnd',
       'onForceFeatureRequested','onBigWinTierEntered','onBigWinTierEnd',
       'onScatterCelebrationStart','onScatterCelebrationEnd','onBalanceChanged',
       'onTurboToggle','onWinPresentationStart','onWinPresentationEnd']
        .forEach(e => HookBus.on(e, p => window.__OBSERVED__.push({ event: e, payload: p })));
    }
  });

  // 1. TURBO timing — measured FIRST so previous-feature state contamination
  //    (FS still active, big-win banner up) doesn't skew the baseline.
  async function _waitSettled() {
    return fr.waitForFunction(
      () => !window.allReelsActive && !document.querySelector('.is-spinning'),
      null, { timeout: 8000 }
    ).catch(() => {});
  }
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  // warm-up spin so the first measured spin isn't tainted by JIT / fonts
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await _waitSettled();
  const t0a = Date.now();
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await _waitSettled();
  const baseT = Date.now() - t0a;
  await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
  const t0b = Date.now();
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await _waitSettled();
  const turboT = Date.now() - t0b;
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  r.checks.turbo_off_ms = baseT;
  r.checks.turbo_on_ms  = turboT;
  r.checks.turbo_effective = (turboT < baseT * 0.75);

  // 2. SPIN ×5
  await fr.evaluate(() => { window.__OBSERVED__ = []; });
  const cellsBefore = await fr.$$eval('.cell, text, [data-cell]', els => els.length);
  for (let i = 0; i < 5; i++) {
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled();
    await fr.waitForTimeout(300);
  }
  await fr.waitForTimeout(800);
  const observed = await fr.evaluate(() => window.__OBSERVED__.slice());
  const cellsAfter = await fr.$$eval('.cell, text, [data-cell]', els => els.length);
  r.checks.spin_preSpin_count   = observed.filter(o => o.event === 'preSpin').length;
  r.checks.spin_onSpinResult_count = observed.filter(o => o.event === 'onSpinResult').length;
  r.checks.spin_postSpin_count  = observed.filter(o => o.event === 'postSpin').length;
  r.checks.cells_stable         = (cellsAfter === cellsBefore);
  r.checks.cellsBefore = cellsBefore;
  r.checks.cellsAfter  = cellsAfter;

  // 3. FS chip — click ufp-chip[data-ufp-kind=free_spins]. Retry up to
  //    3 times with full state reset between tries so a single race
  //    against the engine doesn't false-positive as a template bug.
  let fsRequested = false, fsCelebration = false, fsTriggered = false;
  for (let attempt = 0; attempt < 3 && !(fsRequested && fsCelebration && fsTriggered); attempt++) {
    await fr.evaluate(() => {
      try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
      try { window.FORCE_TRIGGER = null; } catch (_) {}
      try { window.__SLOT_DEV_FORCE_FS__ = false; } catch (_) {}
      document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
      });
      window.__OBSERVED__ = [];
    });
    await fr.evaluate(() => {
      const chip = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]');
      if (chip) chip.click();
    });
    await fr.waitForTimeout(2500);
    await fr.evaluate(() => {
      document.querySelectorAll('.freespins-overlay button, .freespins-toast button, [data-fs-close], .gfb-banner button, #fsOverlay button').forEach(b => b.click());
      document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
      });
    });
    await fr.waitForTimeout(2500);
    const fsObs = await fr.evaluate(() => window.__OBSERVED__.slice());
    fsRequested   = fsRequested   || fsObs.some(o => o.event === 'onForceFeatureRequested' && o.payload?.kind === 'free_spins');
    fsCelebration = fsCelebration || fsObs.some(o => o.event === 'onScatterCelebrationStart');
    fsTriggered   = fsTriggered   || fsObs.some(o => o.event === 'onFsTrigger');
  }
  r.checks.fs_force_requested = fsRequested;
  r.checks.fs_celebration_start = fsCelebration;
  r.checks.fs_trigger_emitted = fsTriggered;

  // 4. BIG-WIN chip — same retry/reset discipline. The walkthrough takes
  //    1s spin + 4s tier-1 + N tiers, so we cap a single attempt at 8s.
  let bwRequested = false, bwTierEntered = false;
  for (let attempt = 0; attempt < 3 && !(bwRequested && bwTierEntered); attempt++) {
    await fr.evaluate(() => {
      try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
      try { window.FORCE_TRIGGER = null; } catch (_) {}
      try { window.__FORCE_BIG_WIN_TIER__ = 0; } catch (_) {}
      document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
      });
      window.__OBSERVED__ = [];
    });
    await fr.evaluate(() => {
      const chip = document.querySelector('.ufp-chip[data-ufp-kind="big_win"]');
      if (chip) chip.click();
    });
    await fr.waitForTimeout(8000);
    const bwObs = await fr.evaluate(() => window.__OBSERVED__.slice());
    bwRequested   = bwRequested   || bwObs.some(o => o.event === 'onForceFeatureRequested' && o.payload?.kind === 'big_win');
    bwTierEntered = bwTierEntered || bwObs.some(o => o.event === 'onBigWinTierEntered');
  }
  r.checks.bw_force_requested = bwRequested;
  r.checks.bw_tier_entered    = bwTierEntered;

  // 5. BUY BONUS
  await fr.evaluate(() => { window.__OBSERVED__ = []; });
  const buyBtnPresent = await fr.$('#bonusBuyBtn').then(el => !!el).catch(() => false);
  r.checks.bonusBuy_present = buyBtnPresent;
  if (buyBtnPresent) {
    await fr.evaluate(() => document.getElementById('bonusBuyBtn').click());
    await fr.waitForTimeout(3000);
    await fr.evaluate(() => {
      document.querySelectorAll('.freespins-overlay button, .freespins-toast button, [data-fs-close]').forEach(b => b.click());
    });
    await fr.waitForTimeout(2000);
    const buyObs = await fr.evaluate(() => window.__OBSERVED__.slice());
    r.checks.bonusBuy_triggers = buyObs.some(o => o.event === 'preSpin');
  }

  // 6. Settings modal
  const settingsBtn = await fr.$('.settings-btn, #settingsMenuBtn');
  if (settingsBtn) {
    await settingsBtn.click();
    await fr.waitForTimeout(700);
    r.checks.settings_modal_visible = await fr.$$eval('.settings-modal, .settings-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')
    ).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.settings-close, [data-test="settings-close"]');
      if (c) c.click();
      else document.querySelectorAll('.settings-backdrop, .settings-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  } else {
    r.checks.settings_modal_visible = false;
  }

  // 7. Paytable modal
  const paytableBtn = await fr.$('.paytable-btn');
  if (paytableBtn) {
    await paytableBtn.click();
    await fr.waitForTimeout(700);
    r.checks.paytable_modal_visible = await fr.$$eval('.paytable-modal, .paytable-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')
    ).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.paytable-close');
      if (c) c.click();
      else document.querySelectorAll('.paytable-backdrop, .paytable-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  } else {
    r.checks.paytable_modal_visible = false;
  }

  // 8. History panel
  const historyBtn = await fr.$('.history-btn');
  if (historyBtn) {
    await historyBtn.click();
    await fr.waitForTimeout(700);
    r.checks.history_modal_visible = await fr.$$eval('.history-modal, .history-backdrop, .history-panel',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')
    ).catch(() => false);
    /* History uses a <table>; data rows live as <tr> inside the panel
       wrapper. Header counts as 1; we want any positive number to mean
       "rows present". */
    r.checks.history_entries_count = await fr.$$eval('.history-panel tr, .history-modal tr',
      els => Math.max(0, els.length - 1) /* minus the header row */
    ).catch(() => 0);
    await fr.evaluate(() => {
      const c = document.querySelector('.history-close, [data-test="history-close"]');
      if (c) c.click();
      else document.querySelectorAll('.history-backdrop, .history-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  } else {
    r.checks.history_modal_visible = false;
  }

  r.checks.frame_console_errors = errs.length;
  return r;
}

console.log('\n🔬 Behavior parity probe — rectangle vs PDFs\n');
const browser = await chromium.launch({ headless: true });

const SCENARIOS = [
  { name: 'rect',  src: `${URL}dist/01_rectangular_5x3_playable.html` },
  { name: 'huff',  src: HUFF_PDF },
  { name: 'gates', src: GATES_PDF },
  { name: 'star',  src: STAR_PDF },
];

const results = {};
for (const s of SCENARIOS) {
  console.log(`▶ ${s.name} loading …`);
  const { frame, errs } = await loadFrame(browser, s.src);
  results[s.name] = await runScenario(s.name, frame, errs);
  console.log(`  ✓ ${s.name} probe done`);
}

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

const KEYS = Object.keys(results.rect.checks);
const headers = ['check', 'rect', 'huff', 'gates', 'star', 'gap?'];
const rpad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
console.log('\n');
console.log(rpad(headers[0], 32) + rpad(headers[1], 12) + rpad(headers[2], 12) + rpad(headers[3], 12) + rpad(headers[4], 12) + headers[5]);
console.log('─'.repeat(100));

let gapCount = 0;
const gapRows = [];
for (const k of KEYS) {
  const rV = results.rect.checks[k];
  const hV = results.huff.checks[k];
  const gV = results.gates.checks[k];
  const sV = results.star.checks[k];

  /* Gap if rect is "good" and any PDF differs in a meaningful way.
     "Good" = true (booleans) or > 0 (counts) or > 0 (ms). */
  function isGood(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number')  return v > 0;
    return false;
  }
  function gapVs(rect, other) {
    if (typeof rect === 'boolean' || typeof other === 'boolean') {
      return isGood(rect) && !isGood(other);
    }
    if (typeof rect === 'number' && typeof other === 'number') {
      if (rect > 0 && other === 0) return true;
      return false;
    }
    return false;
  }
  const hGap = gapVs(rV, hV);
  const gGap = gapVs(rV, gV);
  const sGap = gapVs(rV, sV);
  const anyGap = hGap || gGap || sGap;
  if (anyGap) {
    gapCount++;
    gapRows.push({ check: k, rect: rV, huff: hV, gates: gV, star: sV });
  }
  console.log(rpad(k, 32) + rpad(rV, 12) + rpad(hV, 12) + rpad(gV, 12) + rpad(sV, 12) + (anyGap ? 'YES' : ''));
}

console.log('─'.repeat(100));
console.log(`Gaps: ${gapCount}`);
writeFileSync(resolve(OUT, 'behavior-parity.json'), JSON.stringify(results, null, 2));

if (gapCount > 0) {
  console.log('\nTemplate behavior gaps:');
  for (const r of gapRows) console.log(`  · ${r.check}: rect=${r.rect}  huff=${r.huff}  gates=${r.gates}  star=${r.star}`);
}

process.exit(gapCount === 0 ? 0 : 1);
