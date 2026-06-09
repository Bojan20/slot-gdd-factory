#!/usr/bin/env node
/**
 * tools/_all-grids-force-probe.mjs
 *
 * Boki direktiva: "jedan po jedan grid da se odradi, overi svaki gdd takojde,
 * svaki fors mora da radi". Loop through all 20 dist/*_playable.html builds
 * and verify on each: SPIN works, TURBO works, FS chip works, BIG-WIN chip
 * works, BUY BONUS works (where applicable), Settings/Paytable/History modals
 * open. Report ONLY the failing rows so we can fix one grid at a time.
 *
 * Retry pattern (×3 per chip) with full state reset to avoid race-condition
 * false positives. If a chip is genuinely missing for a grid kind (e.g. no
 * Bonus Buy on plinko per gridProfile veto), we record n/a and skip.
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                                  from 'node:path';
import { fileURLToPath }                                     from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/all-grids-force');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

const PORT = 5274;
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
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 600));

/* Wait until the most recent preSpin has been matched by a postSpin OR
   onSpinResult — works across rectangular / hex / wheel / crash / plinko /
   slingo paths because every engine routes its settle through reelEngine's
   wrapped callback which emits onSpinResult. Falls back to DOM sentinels
   for kinds that may settle synchronously. */
async function _waitSettled(fr) {
  return fr.waitForFunction(
    () => {
      var obs = (window.__OBS__ || []);
      var lastPre  = -1, lastPost = -1, lastResult = -1;
      for (var i = obs.length - 1; i >= 0; i--) {
        var e = obs[i] && obs[i].event;
        if (lastPre === -1 && e === 'preSpin') lastPre = i;
        if (lastPost === -1 && e === 'postSpin') lastPost = i;
        if (lastResult === -1 && e === 'onSpinResult') lastResult = i;
        if (lastPre !== -1 && (lastPost !== -1 || lastResult !== -1)) break;
      }
      var spinDone = (lastPre === -1) ||
        (lastPost > lastPre) || (lastResult > lastPre);
      var rectQuiet = !window.allReelsActive && !document.querySelector('.is-spinning');
      return spinDone && rectQuiet;
    },
    null, { timeout: 10000 }
  ).catch(() => {});
}

async function runProbe(browser, gridLabel, navUrl) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(navUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const fr = page;
  try {
    /* sentinel: any rendered grid cell across all kinds —
       .cell (rect/cluster/megaclusters/hex/diamond/pyramid/cross/lshape/dual/slingo/lock_respin),
       text (wheel/radial SVG segment text), .peg (plinko), .crash-curve (crash svg) */
    await fr.waitForSelector('.cell, text, [data-cell], .peg, .crash-curve, .grid-plinko, .grid-crash', { timeout: 12000 });
  } catch (e) {
    await ctx.close();
    return { grid: gridLabel, fatal: 'no-cells-rendered', errs };
  }

  const r = { grid: gridLabel, checks: {} };

  // Hook bus instrumentation
  await fr.evaluate(() => {
    window.__OBS__ = [];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['preSpin','onSpinResult','postSpin','onFsTrigger','onFsEnd',
       'onForceFeatureRequested','onBigWinTierEntered','onBigWinTierEnd',
       'onScatterCelebrationStart','onScatterCelebrationEnd','onBalanceChanged',
       'onTurboToggle']
        .forEach(e => HookBus.on(e, p => window.__OBS__.push({ event: e, payload: p })));
    }
  });

  /* 1. TURBO + SPIN — measure min across 2 samples each to filter
     JIT / fonts variance that creates single-shot false positives. */
  async function _resetState() {
    await fr.evaluate(() => {
      try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
      try { window.FORCE_TRIGGER = null; } catch (_) {}
      try { window.__FORCE_BIG_WIN_TIER__ = 0; } catch (_) {}
      document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
        el.style.display = 'none'; el.style.pointerEvents = 'none'; el.setAttribute('aria-hidden', 'true');
      });
    });
  }
  await _resetState();
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await _waitSettled(fr);
  let baseT = Infinity;
  for (let s = 0; s < 2; s++) {
    await _resetState();
    const t = Date.now();
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled(fr);
    baseT = Math.min(baseT, Date.now() - t);
  }
  await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
  let turboT = Infinity;
  for (let s = 0; s < 2; s++) {
    await _resetState();
    const t = Date.now();
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled(fr);
    turboT = Math.min(turboT, Date.now() - t);
  }
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  r.checks.turbo_off_ms = baseT;
  r.checks.turbo_on_ms  = turboT;
  r.checks.turbo_works  = (turboT < baseT * 0.85);
  r.checks.spin_works   = baseT > 0 && baseT < 30000;

  /* 2. FS chip — present? if yes, must fire onForceFeatureRequested + (celebration|onFsTrigger) */
  const fsChipPresent = await fr.$('.ufp-chip[data-ufp-kind="free_spins"]').then(el => !!el);
  r.checks.fs_chip_present = fsChipPresent;
  if (fsChipPresent) {
    let fsReq = false, fsCel = false, fsTrig = false;
    for (let a = 0; a < 3 && !(fsReq && fsTrig); a++) {
      await fr.evaluate(() => {
        try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
        try { window.FORCE_TRIGGER = null; } catch (_) {}
        try { window.__SLOT_DEV_FORCE_FS__ = false; } catch (_) {}
        document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
          el.style.display = 'none'; el.style.pointerEvents = 'none'; el.setAttribute('aria-hidden', 'true');
        });
        window.__OBS__ = [];
      });
      await fr.evaluate(() => {
        const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]');
        if (c) c.click();
      });
      await fr.waitForTimeout(2800);
      await fr.evaluate(() => {
        document.querySelectorAll('.freespins-overlay button, .freespins-toast button, [data-fs-close], .gfb-banner button, #fsOverlay button').forEach(b => b.click());
        document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
          el.style.display = 'none'; el.style.pointerEvents = 'none'; el.setAttribute('aria-hidden', 'true');
        });
      });
      await fr.waitForTimeout(2500);
      const obs = await fr.evaluate(() => window.__OBS__.slice());
      fsReq  = fsReq  || obs.some(o => o.event === 'onForceFeatureRequested' && o.payload?.kind === 'free_spins');
      fsCel  = fsCel  || obs.some(o => o.event === 'onScatterCelebrationStart');
      fsTrig = fsTrig || obs.some(o => o.event === 'onFsTrigger');
    }
    r.checks.fs_force_requested = fsReq;
    r.checks.fs_celebration     = fsCel;
    r.checks.fs_trigger_emitted = fsTrig;
    r.checks.fs_works           = fsReq && fsTrig;
  }

  /* 3. BIG-WIN chip */
  const bwChipPresent = await fr.$('.ufp-chip[data-ufp-kind="big_win"]').then(el => !!el);
  r.checks.bw_chip_present = bwChipPresent;
  if (bwChipPresent) {
    let bwReq = false, bwTier = false;
    for (let a = 0; a < 3 && !(bwReq && bwTier); a++) {
      await fr.evaluate(() => {
        try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
        try { window.FORCE_TRIGGER = null; } catch (_) {}
        try { window.__FORCE_BIG_WIN_TIER__ = 0; } catch (_) {}
        document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
          el.style.display = 'none'; el.style.pointerEvents = 'none'; el.setAttribute('aria-hidden', 'true');
        });
        window.__OBS__ = [];
      });
      await fr.evaluate(() => {
        const c = document.querySelector('.ufp-chip[data-ufp-kind="big_win"]');
        if (c) c.click();
      });
      await fr.waitForTimeout(9000);
      const obs = await fr.evaluate(() => window.__OBS__.slice());
      bwReq  = bwReq  || obs.some(o => o.event === 'onForceFeatureRequested' && o.payload?.kind === 'big_win');
      bwTier = bwTier || obs.some(o => o.event === 'onBigWinTierEntered');
    }
    r.checks.bw_force_requested = bwReq;
    r.checks.bw_tier_entered    = bwTier;
    r.checks.bw_works           = bwReq && bwTier;
  }

  /* 4. BUY BONUS */
  const buyBtn = await fr.$('#bonusBuyBtn');
  r.checks.bonusBuy_present = !!buyBtn;
  if (buyBtn) {
    let bbOk = false;
    for (let a = 0; a < 3 && !bbOk; a++) {
      await fr.evaluate(() => {
        try { if (typeof window.FSM !== 'undefined' && FSM) FSM.phase = 'BASE'; } catch (_) {}
        try { window.FORCE_TRIGGER = null; } catch (_) {}
        document.querySelectorAll('#fsOverlay, .fs-overlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
          el.style.display = 'none'; el.style.pointerEvents = 'none'; el.setAttribute('aria-hidden', 'true');
        });
        // Close any bonusBuy modal/confirmation first attempt
        document.querySelectorAll('.bonus-buy-modal, .bonus-buy-backdrop').forEach(el => { el.hidden = true; });
        window.__OBS__ = [];
      });
      await fr.evaluate(() => document.getElementById('bonusBuyBtn').click());
      await fr.waitForTimeout(800);
      // Confirm modal if present
      await fr.evaluate(() => {
        const cbtn = document.querySelector('.bonus-buy-confirm, .bb-confirm, [data-bb-confirm], .bonus-buy-modal button[data-action="confirm"]');
        if (cbtn) cbtn.click();
      });
      await fr.waitForTimeout(4500);
      const obs = await fr.evaluate(() => window.__OBS__.slice());
      bbOk = obs.some(o => o.event === 'onFsTrigger') || obs.some(o => o.event === 'preSpin');
    }
    r.checks.bonusBuy_works = bbOk;
  }

  /* 5. Modals */
  const settingsBtn = await fr.$('.settings-btn, #settingsMenuBtn');
  if (settingsBtn) {
    await settingsBtn.click();
    await fr.waitForTimeout(500);
    r.checks.settings_open = await fr.$$eval('.settings-modal, .settings-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.settings-close, [data-test="settings-close"]');
      if (c) c.click();
      else document.querySelectorAll('.settings-backdrop, .settings-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(300);
  }
  const paytableBtn = await fr.$('.paytable-btn');
  if (paytableBtn) {
    await paytableBtn.click();
    await fr.waitForTimeout(500);
    r.checks.paytable_open = await fr.$$eval('.paytable-modal, .paytable-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.paytable-close');
      if (c) c.click();
      else document.querySelectorAll('.paytable-backdrop, .paytable-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(300);
  }
  const historyBtn = await fr.$('.history-btn');
  if (historyBtn) {
    await historyBtn.click();
    await fr.waitForTimeout(500);
    r.checks.history_open = await fr.$$eval('.history-modal, .history-backdrop, .history-panel',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.history-close, [data-test="history-close"]');
      if (c) c.click();
      else document.querySelectorAll('.history-backdrop, .history-modal').forEach(el => el.hidden = true);
    });
  }

  r.checks.console_errors = errs.length;
  await ctx.close();
  return r;
}

console.log('\n🔬 All-grids force probe — 20 builds × 5 force lanes\n');
const browser = await chromium.launch({ headless: true });

const all = readdirSync(resolve(REPO, 'dist'))
  .filter(f => /^\d{2}_.+_playable\.html$/.test(f))
  .sort();

const results = [];
for (const file of all) {
  const label = file.replace('_playable.html', '');
  if (ONLY && !ONLY.has(label) && !ONLY.has(label.slice(0, 2))) continue;
  process.stdout.write(`▶ ${label.padEnd(42)} …`);
  try {
    const r = await runProbe(browser, label, `${URL}dist/${file}`);
    results.push(r);
    if (r.fatal) console.log(`  ❌ FATAL: ${r.fatal}`);
    else {
      const c = r.checks;
      const bits = [
        c.spin_works ? 'spin' : '✗spin',
        c.turbo_works ? 'turbo' : '✗turbo',
        c.fs_chip_present ? (c.fs_works ? 'fs' : '✗fs') : 'fs-na',
        c.bw_chip_present ? (c.bw_works ? 'bw' : '✗bw') : 'bw-na',
        c.bonusBuy_present ? (c.bonusBuy_works ? 'bb' : '✗bb') : 'bb-na',
      ].join(' ');
      console.log(`  ${bits}  err=${c.console_errors}`);
    }
  } catch (e) {
    console.log(`  💥 ${String(e).slice(0, 120)}`);
    results.push({ grid: label, fatal: String(e) });
  }
}

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

/* ─── Tabular report ─── */
console.log('\n\n┌─── grid ────────────────────────────────────┬─spin─┬─turbo─┬──fs──┬──bw──┬──bb──┬─err─┐');
let failing = [];
for (const r of results) {
  if (r.fatal) {
    console.log(`│ ${r.grid.padEnd(43)} │ FATAL: ${r.fatal.slice(0, 50)}`);
    failing.push(r.grid);
    continue;
  }
  const c = r.checks;
  const cell = (ok, na = false) => na ? '  -  ' : (ok ? '  ✓  ' : '  ✗  ');
  const fs = c.fs_chip_present === false ? cell(false, true) : cell(c.fs_works);
  const bw = c.bw_chip_present === false ? cell(false, true) : cell(c.bw_works);
  const bb = c.bonusBuy_present === false ? cell(false, true) : cell(c.bonusBuy_works);
  const broke =
    !c.spin_works || !c.turbo_works ||
    (c.fs_chip_present && !c.fs_works) ||
    (c.bw_chip_present && !c.bw_works) ||
    (c.bonusBuy_present && !c.bonusBuy_works);
  if (broke) failing.push(r.grid);
  console.log(`│ ${r.grid.padEnd(43)} │${cell(c.spin_works)}│${cell(c.turbo_works)}│${fs}│${bw}│${bb}│ ${String(c.console_errors).padStart(3)} │`);
}
console.log('└────────────────────────────────────────────┴─────┴───────┴──────┴──────┴──────┴─────┘');
console.log(`\nFailing grids: ${failing.length}/${results.length}`);
for (const f of failing) console.log(`  ✗ ${f}`);

writeFileSync(resolve(OUT, 'all-grids-force.json'), JSON.stringify(results, null, 2));
process.exit(failing.length === 0 ? 0 : 1);
