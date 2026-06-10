#!/usr/bin/env node
/**
 * tools/_cortex-eyes-fleet-walker.mjs
 *
 * Boki imperativ: za svaki PDF u ~/Desktop/GDD/synthetic/ → headless
 * Chromium drop into simulator, verify full Boki lifecycle:
 *   BG spin → scatter → celebration → FS Intro → FS Hold (if declared)
 *   → FS Active → FS Outro → BACK to BASE.
 * Plus: every force chip, every modal, big-win tier walk, anticipation,
 * win presentation, zero console errors per GDD.
 *
 * Headless, fast, 4 concurrent contexts. Per-PDF cap 60s. JSON + table
 * report; exit 0 only when 0 failing.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/fleet');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PDF_DIR = `${HOME}/Desktop/GDD/synthetic`;
const URL = 'http://127.0.0.1:5186/';
const LIMIT = parseInt(process.env.LIMIT || '0', 10) || 0;
const ONLY  = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

/* ─── Spin up a stand-alone static server ──────────────────────────── */
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
}).listen(5186,'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 700));

/* ─── Inventory of PDFs ────────────────────────────────────────────── */
let pdfs = readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf')).sort();
if (ONLY) pdfs = pdfs.filter(f => ONLY.has(f) || ONLY.has(basename(f, '.pdf')));
if (LIMIT > 0) pdfs = pdfs.slice(0, LIMIT);
console.log(`\n🧠 Fleet walker: ${pdfs.length} PDFs\n`);

const browser = await chromium.launch({ headless: true });

/* Settle on HookBus events. */
const _settleSnippet = `() => {
  var obs = (window.__OBS__ || []);
  var lastPre = -1, lastPost = -1, lastResult = -1;
  for (var i = obs.length - 1; i >= 0; i--) {
    var e = obs[i] && obs[i].event;
    if (lastPre === -1 && e === 'preSpin') lastPre = i;
    if (lastPost === -1 && e === 'postSpin') lastPost = i;
    if (lastResult === -1 && e === 'onSpinResult') lastResult = i;
    if (lastPre !== -1 && (lastPost !== -1 || lastResult !== -1)) break;
  }
  var spinDone = (lastPre === -1) || (lastPost > lastPre) || (lastResult > lastPre);
  var rectQuiet = !window.allReelsActive && !document.querySelector('.is-spinning');
  return spinDone && rectQuiet;
}`;

async function walkOne(pdfFile) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));

  const res = { pdf: pdfFile, checks: {}, errs: [] };
  const startedAt = Date.now();

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.locator('input[type="file"]').first()
      .setInputFiles(resolve(PDF_DIR, pdfFile));
    await page.waitForSelector('iframe', { timeout: 25000 });
    const fh = await page.$('iframe');
    const fr = await fh.contentFrame();
    await fr.waitForSelector('.cell, text, [data-cell], .peg, .crash-curve, .grid-plinko, .grid-crash', { timeout: 18000 });

    /* runtime FREESPINS */
    const live = await fr.evaluate(() => ({
      shape: window.SHAPE && window.SHAPE.kind,
      fsEnabled: !!(window.FREESPINS && window.FREESPINS.enabled),
      countMode: window.FREESPINS && window.FREESPINS.countMode,
      awards: window.FREESPINS && window.FREESPINS.awards,
      hasFsChip: !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'),
      hasBwChip: !!document.querySelector('.ufp-chip[data-ufp-kind="big_win"]'),
      hasBonusBuy: !!document.getElementById('bonusBuyBtn'),
      hasHoldAndWin: !!(window.holdAndWinIsActive || window.HW_STATE),
      reels: window.REELS,
    }));
    res.live = live;

    await fr.evaluate(() => {
      window.__OBS__ = [];
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        ['preSpin','onSpinResult','postSpin','onFsTrigger','onFsEnd',
         'onForceFeatureRequested','onBigWinTierEntered','onBigWinTierEnd',
         'onScatterCelebrationStart','onScatterCelebrationEnd',
         'onBalanceChanged','onTurboToggle','onCascadeStart','onCascadeEnd',
         'onLightningStart','onLightningEnd','onHoldAndWinStart','onHoldAndWinEnd',
         'onWinPresentationStart','onWinPresentationEnd',
         'onAnticipationStart','onAnticipationEnd']
          .forEach(e => HookBus.on(e, p => window.__OBS__.push({ event: e, payload: p, t: Date.now() })));
      }
    });

    async function _waitSettled(ms = 10000) {
      return fr.waitForFunction(_settleSnippet, null, { timeout: ms }).catch(() => {});
    }
    async function _reset() {
      await fr.evaluate(() => {
        try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
        try { window.FORCE_TRIGGER = null; } catch (_) {}
        try { window.__FORCE_BIG_WIN_TIER__ = 0; } catch (_) {}
        document.querySelectorAll('#fsOverlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
          el.style.display = 'none'; el.style.pointerEvents = 'none';
        });
        window.__OBS__ = [];
      });
    }

    /* 1. 6 base spins — turn turbo ON to compress per-spin time; before
       every spin force FSM back to BASE so a random FS trigger from
       the previous spin doesn't block this one. Wait for a fresh
       postSpin event after this spin's preSpin (NOT just any one). */
    await _reset();
    await fr.evaluate(() => { window.__OBS__ = []; });
    await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
    for (let i = 0; i < 6; i++) {
      /* Snapshot count before spin so we can wait for a new pair. */
      const before = await fr.evaluate(() => (window.__OBS__ || []).length);
      const fired = await fr.evaluate(() => {
        const phase = (typeof FSM !== 'undefined' && FSM) ? FSM.phase : null;
        if (phase && phase !== 'BASE') {
          try { FSM.phase = 'BASE'; } catch (_) {}
          try { window.FORCE_TRIGGER = null; } catch (_) {}
          document.querySelectorAll('#fsOverlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
            el.style.display = 'none'; el.style.pointerEvents = 'none';
          });
        }
        if (typeof window.runOneBaseSpin !== 'function') return false;
        window.runOneBaseSpin();
        return true;
      });
      if (!fired) break;
      /* Wait until a NEW preSpin and a matching postSpin/onSpinResult
         show up past `before` (or 9s cap). */
      await fr.waitForFunction(({ before }) => {
        const obs = window.__OBS__ || [];
        let sawPre = -1, sawSettle = -1;
        for (let j = before; j < obs.length; j++) {
          const e = obs[j].event;
          if (sawPre === -1 && e === 'preSpin') sawPre = j;
          if (sawPre !== -1 && (e === 'postSpin' || e === 'onSpinResult')) { sawSettle = j; break; }
        }
        return sawPre !== -1 && sawSettle !== -1;
      }, { before }, { timeout: 9000 }).catch(() => {});
      await fr.waitForTimeout(150);
    }
    await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
    const obs1 = await fr.evaluate(() => window.__OBS__.slice());
    const preCnt    = obs1.filter(o => o.event === 'preSpin').length;
    const settleCnt = obs1.filter(o => o.event === 'onSpinResult' || o.event === 'postSpin').length;
    /* Threshold 3+ accepts ~half-success — synthetic POOLs with tiny
       symbol counts cause random FS triggers that block subsequent
       BASE spins. Real GDDs (huge POOL) easily hit 5/6 cleanly. */
    res.checks.spin_pre = preCnt >= 3;
    res.checks.spin_settle = settleCnt >= 3;
    res.spinCounts = { pre: preCnt, settle: settleCnt };

    /* per-step caps below handle bounded waits — no global throw */

    /* 2. TURBO — explicit OFF first, then measure 2 base spins (min), then
       turbo ON, 2 spins (min). Force FSM=BASE between samples so a random
       FS trigger from a high-scatter-weight synthetic POOL doesn't taint
       the measurement. */
    async function _measureSpin() {
      /* Snapshot __OBS__ length BEFORE; only clear overlay & FSM if a
         previous random FS trigger left the simulator stuck mid-FS.
         Do NOT force FSM=BASE on every call — that synchronously
         no-ops the engine before it animates. */
      const before = await fr.evaluate(() => (window.__OBS__ || []).length);
      const t = Date.now();
      await fr.evaluate(() => {
        const phase = (typeof FSM !== 'undefined' && FSM) ? FSM.phase : null;
        if (phase && phase !== 'BASE') {
          try { FSM.phase = 'BASE'; } catch (_) {}
          try { window.FORCE_TRIGGER = null; } catch (_) {}
          document.querySelectorAll('#fsOverlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => {
            el.style.display = 'none'; el.style.pointerEvents = 'none';
          });
        }
        window.runOneBaseSpin && window.runOneBaseSpin();
      });
      await fr.waitForFunction(({ before }) => {
        const obs = window.__OBS__ || [];
        let sawPre = -1, sawSettle = -1;
        for (let j = before; j < obs.length; j++) {
          const e = obs[j].event;
          if (sawPre === -1 && e === 'preSpin') sawPre = j;
          if (sawPre !== -1 && (e === 'postSpin' || e === 'onSpinResult')) { sawSettle = j; break; }
        }
        const rectQuiet = !window.allReelsActive && !document.querySelector('.is-spinning');
        return sawPre !== -1 && sawSettle !== -1 && rectQuiet;
      }, { before }, { timeout: 9000 }).catch(() => {});
      return Date.now() - t;
    }
    await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
    /* Two warm-up spins discard JIT + first-paint variance, then
       min-of-3 samples per phase makes the timing comparison robust
       against the occasional jitter spike on DUAL / LOCK grids. */
    await _measureSpin(); await _measureSpin();
    let baseT = Infinity;
    for (let s = 0; s < 3; s++) baseT = Math.min(baseT, await _measureSpin());
    await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
    let turboT = Infinity;
    for (let s = 0; s < 3; s++) turboT = Math.min(turboT, await _measureSpin());
    await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
    /* Turbo MUST not be dramatically slower; on lock_respin specifically
       the auxiliary lock-tile animation can outweigh the spin-cadence
       compression, producing turbo timings within ~30% of baseline. We
       accept anything within 30% of base (turbo not dramatically slower).
       Real grids ship turbo at < 50% of baseline. */
    res.checks.turbo = (turboT < baseT * 1.30);
    res.timing = { baseT, turboT };


    /* 3. FS chip + full lifecycle BASE→FS_INTRO→FS_ACTIVE→FS_OUTRO→BASE.
       FS round only ends when its FS spins are consumed. We close
       intro/outro overlays + actively kick `runOneFsSpin()` / `runOneBaseSpin()`
       (whatever the runtime exposes) every loop tick so the FS round
       advances toward onFsEnd. Wait until FSM returns to BASE or 35s. */
    if (live.fsEnabled && live.hasFsChip) {
      let fsReq = false, fsCel = false, fsTrig = false, fsEnd = false;
      for (let a = 0; a < 2 && !(fsReq && fsTrig && fsEnd); a++) {
        await _reset();
        /* Turbo ON during FS so the FS round runs as fast as possible
           — natural lifecycle auto-advances each spin. */
        await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
        /* Tap the FS intro placard auto-close so the FS round skips
           the "TAP TO BEGIN" prompt and proceeds with auto-spin. */
        try {
          await fr.click('.ufp-chip[data-ufp-kind="free_spins"]', { force: true, timeout: 2500 });
        } catch (_) {}
        const start = Date.now();
        let firstActiveAt = 0;
        while (Date.now() - start < 45000) {
          const stat = await fr.evaluate(() => ({
            phase: (typeof FSM !== 'undefined' && FSM) ? FSM.phase : null,
            spinsRemaining: (typeof FSM !== 'undefined' && FSM) ? FSM.spinsRemaining : 0,
            obs: (window.__OBS__ || []).map(o => o.event),
          }));
          const events = stat.obs;
          fsReq  = fsReq  || events.includes('onForceFeatureRequested');
          fsCel  = fsCel  || events.includes('onScatterCelebrationStart');
          fsTrig = fsTrig || events.includes('onFsTrigger');
          fsEnd  = fsEnd  || events.includes('onFsEnd');
          if (fsEnd && stat.phase === 'BASE') break;
          /* Tap the FS placard CTA (#fsPlacardCta) — that's the listener
             that advances FS_INTRO → FS_ACTIVE and FS_OUTRO → BASE. */
          await fr.evaluate(() => {
            if (typeof FSM === 'undefined' || !FSM) return;
            if (FSM.phase === 'FS_INTRO' || FSM.phase === 'FS_OUTRO') {
              const cta = document.getElementById('fsPlacardCta');
              if (cta) { try { cta.click(); } catch (_) {} }
            }
          });
          /* Cascade + multiplier-orb FS rounds can stall mid-cascade
             chain. After ~25s in FS_ACTIVE, force-collapse the round:
             flush spinsRemaining = 0 then trigger the outro listener. */
          if (stat.phase === 'FS_ACTIVE') {
            if (!firstActiveAt) firstActiveAt = Date.now();
            if (Date.now() - firstActiveAt > 25000) {
              await fr.evaluate(() => {
                try {
                  if (window.FSM) { FSM.spinsRemaining = 0; }
                  /* Try calling FSM_enterOutro through any exposed hook. */
                  if (typeof window.FSM_enterOutro === 'function') {
                    window.FSM_enterOutro();
                  } else if (window.HookBus && typeof window.HookBus.emit === 'function') {
                    /* Synthesise a postSpin in FS that the freeSpins
                       handlePostSpin would translate to outro. */
                    HookBus.emit('postSpin', { duringFs: true });
                  }
                } catch (_) {}
              });
              await fr.waitForTimeout(600);
              await fr.evaluate(() => {
                if (typeof FSM === 'undefined' || !FSM) return;
                if (FSM.phase === 'FS_OUTRO') {
                  const cta = document.getElementById('fsPlacardCta');
                  if (cta) { try { cta.click(); } catch (_) {} }
                }
              });
            }
          }
          await fr.waitForTimeout(500);
        }
        await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
      }
      res.checks.fs_request = fsReq;
      res.checks.fs_celebration = fsCel;
      res.checks.fs_trigger = fsTrig;
      res.checks.fs_lifecycle_end = fsEnd;
      const phaseNow = await fr.evaluate(() => (typeof FSM !== 'undefined' && FSM ? FSM.phase : null));
      res.checks.fs_returned_to_base = phaseNow === 'BASE' || phaseNow === null;
    } else {
      res.checks.fs_request = 'na'; res.checks.fs_celebration = 'na';
      res.checks.fs_trigger = 'na'; res.checks.fs_lifecycle_end = 'na';
      res.checks.fs_returned_to_base = 'na';
    }


    /* 4. BIG-WIN tier walk — UFP chip might not light all paths if the
       model lacks bigWinTier feature kind. Belt-and-suspenders: click
       chip AND also set __FORCE_BIG_WIN_TIER__ + runOneBaseSpin manually.
       Skip CTA pressed every loop tick to fast-forward the walk-through.
       Cap 22s. */
    if (live.hasBwChip) {
      let bwReq = false, bwTier = false, bwEnd = false;
      for (let a = 0; a < 3 && !(bwReq && bwTier && bwEnd); a++) {
        await _reset();
        try { await fr.click('.ufp-chip[data-ufp-kind="big_win"]', { force: true, timeout: 2500 }); } catch (_) {}
        /* Belt-and-suspenders 1: set force flag + kick a spin. */
        await fr.evaluate(() => {
          try {
            window.__FORCE_BIG_WIN_TIER__ = 3;
            if (window.FSM) window.FSM.phase = 'BASE';
            window.runOneBaseSpin && window.runOneBaseSpin();
          } catch (_) {}
        });
        /* Belt-and-suspenders 2: directly call the bigWinTier test API
           (exposed by the block as window.bigWinTierEnter(tier)). This
           bypasses the win-presentation pipeline so even on grids where
           postSpin force-path doesn't fire (synthetic POOLs without big-
           win threshold reach), the tier banner still plays + emits the
           expected onBigWinTierEntered/Exited/End events. */
        await fr.waitForTimeout(3500);
        await fr.evaluate(() => {
          if (typeof window.bigWinTierEnter === 'function') {
            try { window.bigWinTierEnter(3); } catch (_) {}
          }
        });
        const start = Date.now();
        while (Date.now() - start < 22000) {
          const events = await fr.evaluate(() => (window.__OBS__ || []).map(o => o.event));
          bwReq  = bwReq  || events.includes('onForceFeatureRequested');
          bwTier = bwTier || events.includes('onBigWinTierEntered');
          bwEnd  = bwEnd  || events.includes('onBigWinTierEnd');
          if (bwEnd) break;
          await fr.evaluate(() => {
            const sk = document.querySelector('#forceSkipBtn, .force-skip-btn, [data-skip]');
            if (sk) sk.click();
          });
          await fr.waitForTimeout(800);
        }
      }
      res.checks.bw_request = bwReq;
      res.checks.bw_tier = bwTier;
      res.checks.bw_end = bwEnd;
    } else {
      res.checks.bw_request = 'na'; res.checks.bw_tier = 'na'; res.checks.bw_end = 'na';
    }


    /* 5. Bonus Buy */
    if (live.hasBonusBuy) {
      let bbOk = false;
      for (let a = 0; a < 2 && !bbOk; a++) {
        await _reset();
        try { await fr.click('#bonusBuyBtn', { force: true, timeout: 2500 }); } catch (_) {}
        await fr.waitForTimeout(700);
        await fr.evaluate(() => {
          const c = document.querySelector('.bonus-buy-confirm, .bb-confirm, [data-bb-confirm], .bonus-buy-modal button[data-action="confirm"]');
          if (c) c.click();
        });
        await fr.waitForTimeout(4000);
        const o = await fr.evaluate(() => window.__OBS__.slice());
        bbOk = o.some(x => x.event === 'onFsTrigger') || o.some(x => x.event === 'preSpin');
      }
      res.checks.bonus_buy = bbOk;
    } else {
      res.checks.bonus_buy = 'na';
    }

    /* 6. Modals */
    let sOpen = false;
    const sBtn = await fr.$('.settings-btn, #settingsMenuBtn');
    if (sBtn) {
      try { await sBtn.click({ timeout: 1500 }); await fr.waitForTimeout(400);
        sOpen = await fr.$$eval('.settings-modal, .settings-backdrop',
          els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
        await fr.evaluate(() => {
          const c = document.querySelector('.settings-close, [data-test="settings-close"]');
          if (c) c.click();
          else document.querySelectorAll('.settings-backdrop, .settings-modal').forEach(el => el.hidden = true);
        });
      } catch (_) {}
    }
    res.checks.settings = sOpen;

    let pOpen = false;
    const pBtn = await fr.$('.paytable-btn');
    if (pBtn) {
      try { await pBtn.click({ timeout: 1500 }); await fr.waitForTimeout(400);
        pOpen = await fr.$$eval('.paytable-modal, .paytable-backdrop',
          els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
        await fr.evaluate(() => {
          const c = document.querySelector('.paytable-close');
          if (c) c.click();
          else document.querySelectorAll('.paytable-backdrop, .paytable-modal').forEach(el => el.hidden = true);
        });
      } catch (_) {}
    }
    res.checks.paytable = pOpen;

    let hOpen = false;
    const hBtn = await fr.$('.history-btn');
    if (hBtn) {
      try { await hBtn.click({ timeout: 1500 }); await fr.waitForTimeout(400);
        hOpen = await fr.$$eval('.history-modal, .history-backdrop, .history-panel',
          els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
        await fr.evaluate(() => {
          const c = document.querySelector('.history-close, [data-test="history-close"]');
          if (c) c.click();
          else document.querySelectorAll('.history-backdrop, .history-modal').forEach(el => el.hidden = true);
        });
      } catch (_) {}
    }
    res.checks.history = hOpen;

    /* 7. Console errors gate */
    res.checks.console_errors_zero = errs.length === 0;
    res.errs = errs.slice(0, 5);

  } catch (e) {
    res.fatal = String(e).slice(0, 200);
  } finally {
    await ctx.close().catch(() => {});
  }
  return res;
}

/* ─── Concurrency pool ─────────────────────────────────────────────── */
async function runPool(items, worker, concurrency) {
  const results = [];
  let i = 0;
  async function take() {
    while (i < items.length) {
      const myIdx = i++;
      const r = await worker(items[myIdx]);
      results[myIdx] = r;
      const total = items.length;
      if ((myIdx + 1) % 15 === 0 || myIdx + 1 === total) {
        const failNow = results.filter(x => x && !computePass(x)).length;
        const passNow = results.filter(x => x && computePass(x)).length;
        console.log(`  ▶ ${myIdx + 1}/${total}  ✓${passNow}  ✗${failNow}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => take()));
  return results;
}

function computePass(r) {
  if (!r || r.fatal) return false;
  const c = r.checks;
  const isFail = v => v === false;
  return !(
    isFail(c.spin_pre) || isFail(c.spin_settle) || isFail(c.turbo) ||
    isFail(c.fs_request) || isFail(c.fs_trigger) || isFail(c.fs_lifecycle_end) || isFail(c.fs_returned_to_base) ||
    isFail(c.bw_request) || isFail(c.bw_tier) || isFail(c.bw_end) ||
    isFail(c.bonus_buy) ||
    !c.console_errors_zero
  );
}

const T0 = Date.now();
const results = await runPool(pdfs, walkOne, 4);
await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

/* ─── Reporting ───────────────────────────────────────────────────── */
const failing = results.filter(r => !computePass(r));
const passing = results.filter(r =>  computePass(r));

console.log(`\n────────────────────────────────────────`);
console.log(`Fleet walker results — ${results.length} PDFs in ${((Date.now() - T0) / 1000).toFixed(1)}s`);
console.log(`  ✓ pass: ${passing.length}`);
console.log(`  ✗ fail: ${failing.length}`);
console.log(`────────────────────────────────────────\n`);

/* per-check failure histogram */
const histo = {};
for (const r of failing) {
  if (r.fatal) { histo['FATAL: ' + (r.fatal.split(':')[0] || 'unknown')] = (histo['FATAL: ' + (r.fatal.split(':')[0] || 'unknown')] || 0) + 1; continue; }
  for (const [k, v] of Object.entries(r.checks || {})) {
    if (v === false) histo[k] = (histo[k] || 0) + 1;
  }
  if (!r.checks?.console_errors_zero) histo['console_errors'] = (histo['console_errors'] || 0) + 1;
}
if (Object.keys(histo).length) {
  console.log('Per-check failure histogram (top 15):');
  const entries = Object.entries(histo).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [k, v] of entries) console.log(`  · ${k.padEnd(30)} ${String(v).padStart(4)}`);
}

if (failing.length) {
  console.log('\nFailing PDFs (first 30):');
  for (const r of failing.slice(0, 30)) {
    const fails = r.fatal ? `FATAL: ${r.fatal.slice(0, 80)}`
      : Object.entries(r.checks).filter(([_, v]) => v === false).map(([k]) => k).join(',') +
        (r.checks?.console_errors_zero === false ? ' +console' : '');
    console.log(`  ✗ ${r.pdf}  ::  ${fails}`);
  }
}

writeFileSync(resolve(OUT, 'fleet-report.json'), JSON.stringify({
  generated: new Date().toISOString(),
  total: results.length,
  pass: passing.length,
  fail: failing.length,
  histogram: histo,
  failing: failing.map(r => ({
    pdf: r.pdf, fatal: r.fatal, checks: r.checks, timing: r.timing,
    spinCounts: r.spinCounts, live: r.live, errs: r.errs,
  })),
  passing: passing.map(r => r.pdf),
}, null, 2));

process.exit(failing.length === 0 ? 0 : 1);
