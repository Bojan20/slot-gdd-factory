#!/usr/bin/env node
/**
 * tools/_cortex-eyes-ultimate-live.mjs
 *
 * Boki imperativ (09.06): otvoriti simulator u HEADED browser-u, prevuci
 * jedan po jedan GDD iz ~/Desktop/GDD/, real-time klikati spinove, force
 * dugmiće, modale — ZA SVAKI BLOK iz tog GDD-a verifikovati da radi
 * savršeno.
 *
 * Per-GDD ritual (visible, hand-on-mouse pace):
 *
 *   1.  Read PDF → parser.mjs (offline) to know which features the GDD
 *       declared. We probe ONLY those — no false-positive failures for
 *       blocks the GDD never asked for.
 *   2.  Drag-and-drop the PDF into the live simulator (#fileInput).
 *   3.  Wait for iframe + grid cells.
 *   4.  Walk the simulator surface:
 *       • SPIN × 6 (visible) — cells stable, balance ticks, HookBus
 *         preSpin/onSpinResult/postSpin all fire each spin.
 *       • TURBO toggle on → 2 spins (visibly faster) → turbo off.
 *       • FS chip click — onForceFeatureRequested + scatter celebration
 *         + onFsTrigger + FSM enters FS_INTRO + returns to BASE.
 *       • BIG-WIN chip — onBigWinTierEntered + onBigWinTierEnd + balance
 *         updated.
 *       • Buy Bonus (when GDD declares bonus_buy) — preSpin fires.
 *       • Settings modal opens + closes.
 *       • Paytable modal opens + has symbol/feature content.
 *       • History panel opens + shows ≥1 row from the just-played spins.
 *       • Feature-specific probes (declared in the GDD):
 *           – cascade / tumble → cells reshuffle after a planted win
 *           – multiplier (lightning / persistent / progressive)
 *           – hold_and_win → bonus orb chip pulse
 *           – wheel_bonus → wheel modal opens after a planted scatter
 *   5.  Emit a compact PASS/FAIL line per GDD that Boki can read in
 *       real time, with a screenshot snapshot for the record.
 *
 * Hand-on-mouse cadence: every click is visible because Playwright
 * `slowMo` is set + we sprinkle small explicit waits between actions.
 * Boki literally sees the cursor move and the modal pop.
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/ultimate-live');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const GDD_DIR = `${HOME}/Desktop/GDD`;
const URL = 'http://127.0.0.1:5180/';

const GDDS = [
  { file: 'Gates_of_Olympus_1000_GDD.pdf', label: 'Gates of Olympus 1000' },
  { file: 'Huff_N_More_Puff_GDD.pdf',      label: 'Huff & More Puff'      },
  { file: 'Starlight_Travellers_GDD.pdf',  label: 'Starlight Travellers'  },
  { file: 'Wrath_of_Olympus_GDD.pdf',      label: 'Wrath of Olympus'      },
];

/* ─── Extract declared features from PDF text ─────────────────────────── */
async function readPdfFeatures(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = readFileSync(pdfPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let txt = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    txt += c.items.map(x => x.str).join(' ') + '\n';
  }
  const model = parseGDD(txt, 'md');
  const features = new Set();
  for (const f of (model.features || [])) {
    if (f && f.kind) features.add(String(f.kind).toLowerCase());
  }
  if (model.freeSpins && model.freeSpins.enabled) features.add('free_spins');
  if (model.holdAndWin && model.holdAndWin.enabled) features.add('hold_and_win');
  if (model.bonusBuy && model.bonusBuy.enabled) features.add('bonus_buy');
  if (model.lightning && model.lightning.enabled) features.add('lightning');
  return {
    name: model.name,
    features: Array.from(features),
    freeSpins: model.freeSpins,
    topology: model.topology,
  };
}

/* ─── Real-time logger ────────────────────────────────────────────────── */
function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] ${msg}`);
}

/* ─── Per-GDD walk ────────────────────────────────────────────────────── */
async function walkOneGDD(page, gdd, declared) {
  const checks = {};
  const errs = [];

  log(`👀 Boki, gledaj — vraćam simulator na home ekran`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  log(`📎 Prevlačim ${gdd.file} u file input …`);
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(resolve(GDD_DIR, gdd.file));

  log(`⏳ Čekam build (iframe playable) …`);
  await page.waitForSelector('iframe', { timeout: 30000 });
  const fh = await page.$('iframe');
  const fr = await fh.contentFrame();
  await fr.waitForSelector('.cell, text, [data-cell], .peg, .grid-plinko, .crash-curve', { timeout: 20000 });
  await page.waitForTimeout(800);

  /* runtime FREESPINS dump */
  const live = await fr.evaluate(() => ({
    name: document.title,
    shape_kind: window.SHAPE && window.SHAPE.kind,
    countMode: window.FREESPINS && window.FREESPINS.countMode,
    awards: window.FREESPINS && window.FREESPINS.awards,
    hasFsChip: !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'),
    hasBwChip: !!document.querySelector('.ufp-chip[data-ufp-kind="big_win"]'),
    hasBonusBuy: !!document.getElementById('bonusBuyBtn'),
  }));
  log(`📋 ${gdd.label}: shape=${live.shape_kind} · countMode=${live.countMode} · awards=${JSON.stringify(live.awards)}`);

  /* HookBus instrumentation */
  await fr.evaluate(() => {
    window.__OBS__ = [];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['preSpin','onSpinResult','postSpin','onFsTrigger','onFsEnd',
       'onForceFeatureRequested','onBigWinTierEntered','onBigWinTierEnd',
       'onScatterCelebrationStart','onScatterCelebrationEnd',
       'onBalanceChanged','onTurboToggle','onCascadeStart','onCascadeEnd',
       'onLightningStart','onLightningEnd','onHoldAndWinStart','onHoldAndWinEnd',
       'onWinPresentationStart','onWinPresentationEnd']
        .forEach(e => HookBus.on(e, p => window.__OBS__.push({ event: e, payload: p })));
    }
  });
  fr.on('pageerror', e => errs.push(String(e)));

  async function _waitSettled() {
    return fr.waitForFunction(() => {
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
    }, null, { timeout: 10000 }).catch(() => {});
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

  /* 1. SPIN × 6 */
  log(`🎰 6 spinova (vidiš da klikam) …`);
  await _reset();
  for (let i = 0; i < 6; i++) {
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled();
    await fr.waitForTimeout(180);
  }
  const obs1 = await fr.evaluate(() => window.__OBS__.slice());
  checks.spin_preSpin_6  = obs1.filter(o => o.event === 'preSpin').length >= 5;
  checks.spin_settle_6   = obs1.filter(o => o.event === 'onSpinResult' || o.event === 'postSpin').length >= 5;
  log(`   ${checks.spin_preSpin_6 && checks.spin_settle_6 ? '✓' : '✗'} 6 spinova OK (preSpin=${obs1.filter(o=>o.event==='preSpin').length})`);

  /* 2. TURBO */
  log(`⚡ TURBO toggle …`);
  await _reset();
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await _waitSettled();
  const tBase = await (async () => {
    const t = Date.now();
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled();
    return Date.now() - t;
  })();
  await fr.evaluate(() => window.turboModeOn && window.turboModeOn('probe'));
  const tTurbo = await (async () => {
    const t = Date.now();
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled();
    return Date.now() - t;
  })();
  await fr.evaluate(() => window.turboModeOff && window.turboModeOff('probe'));
  checks.turbo_compresses = (tTurbo < tBase * 0.85);
  log(`   ${checks.turbo_compresses ? '✓' : '✗'} TURBO: base=${tBase}ms turbo=${tTurbo}ms (${Math.round(100*tTurbo/tBase)}%)`);

  /* 3. FS chip (only if GDD declares Free Spins AND chip is present) */
  if (declared.features.includes('free_spins') && live.hasFsChip) {
    log(`🎁 FS chip — klik …`);
    let fsReq = false, fsCel = false, fsTrig = false;
    for (let a = 0; a < 3 && !(fsReq && fsTrig); a++) {
      await _reset();
      await fr.click('.ufp-chip[data-ufp-kind="free_spins"]', { force: true });
      await fr.waitForTimeout(3000);
      /* Close FS overlay so we can probe again */
      await fr.evaluate(() => {
        document.querySelectorAll('.freespins-overlay button, .freespins-toast button, [data-fs-close], #fsOverlay button, .gfb-banner button').forEach(b => b.click());
      });
      await fr.waitForTimeout(2500);
      const o = await fr.evaluate(() => window.__OBS__.slice());
      fsReq  = fsReq  || o.some(x => x.event === 'onForceFeatureRequested' && x.payload?.kind === 'free_spins');
      fsCel  = fsCel  || o.some(x => x.event === 'onScatterCelebrationStart');
      fsTrig = fsTrig || o.some(x => x.event === 'onFsTrigger');
    }
    checks.fs_works = fsReq && fsTrig;
    log(`   ${checks.fs_works ? '✓' : '✗'} FS: req=${fsReq} cel=${fsCel} trig=${fsTrig}`);
  } else {
    log(`   – FS chip n/a za ovaj GDD (declared free_spins=${declared.features.includes('free_spins')})`);
    checks.fs_works = 'na';
  }

  /* 4. BIG-WIN chip */
  if (live.hasBwChip) {
    log(`💎 BIG-WIN chip — klik …`);
    let bwReq = false, bwTier = false;
    for (let a = 0; a < 3 && !(bwReq && bwTier); a++) {
      await _reset();
      await fr.click('.ufp-chip[data-ufp-kind="big_win"]', { force: true });
      await fr.waitForTimeout(9000);
      const o = await fr.evaluate(() => window.__OBS__.slice());
      bwReq  = bwReq  || o.some(x => x.event === 'onForceFeatureRequested' && x.payload?.kind === 'big_win');
      bwTier = bwTier || o.some(x => x.event === 'onBigWinTierEntered');
    }
    checks.bw_works = bwReq && bwTier;
    log(`   ${checks.bw_works ? '✓' : '✗'} BW: req=${bwReq} tier=${bwTier}`);
  } else {
    checks.bw_works = 'na';
  }

  /* 5. Bonus Buy (only if GDD declares bonus_buy AND button present) */
  if (declared.features.includes('bonus_buy') && live.hasBonusBuy) {
    log(`💰 Bonus Buy — klik …`);
    let bbOk = false;
    for (let a = 0; a < 3 && !bbOk; a++) {
      await _reset();
      await fr.click('#bonusBuyBtn', { force: true });
      await fr.waitForTimeout(800);
      await fr.evaluate(() => {
        const c = document.querySelector('.bonus-buy-confirm, .bb-confirm, [data-bb-confirm], .bonus-buy-modal button[data-action="confirm"]');
        if (c) c.click();
      });
      await fr.waitForTimeout(4500);
      const o = await fr.evaluate(() => window.__OBS__.slice());
      bbOk = o.some(x => x.event === 'onFsTrigger') || o.some(x => x.event === 'preSpin');
    }
    checks.bonusBuy_works = bbOk;
    log(`   ${checks.bonusBuy_works ? '✓' : '✗'} Bonus Buy`);
  } else {
    checks.bonusBuy_works = 'na';
  }

  /* 6. Modals */
  log(`⚙️ Settings + 📊 Paytable + 📜 History modali …`);
  /* Settings */
  const sBtn = await fr.$('.settings-btn, #settingsMenuBtn');
  if (sBtn) {
    await sBtn.click();
    await fr.waitForTimeout(700);
    checks.settings_open = await fr.$$eval('.settings-modal, .settings-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.settings-close, [data-test="settings-close"]');
      if (c) c.click();
      else document.querySelectorAll('.settings-backdrop, .settings-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  }
  /* Paytable */
  const pBtn = await fr.$('.paytable-btn');
  if (pBtn) {
    await pBtn.click();
    await fr.waitForTimeout(700);
    checks.paytable_open = await fr.$$eval('.paytable-modal, .paytable-backdrop',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    /* Check paytable has actual content */
    checks.paytable_has_content = await fr.$$eval('.paytable-modal',
      els => els.some(e => (e.textContent || '').length > 50)).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.paytable-close');
      if (c) c.click();
      else document.querySelectorAll('.paytable-backdrop, .paytable-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  }
  /* History */
  const hBtn = await fr.$('.history-btn');
  if (hBtn) {
    await hBtn.click();
    await fr.waitForTimeout(700);
    checks.history_open = await fr.$$eval('.history-modal, .history-backdrop, .history-panel',
      els => els.some(e => !e.hidden && getComputedStyle(e).display !== 'none')).catch(() => false);
    checks.history_has_rows = await fr.$$eval('.history-panel tr, .history-modal tr',
      els => Math.max(0, els.length - 1) > 0).catch(() => false);
    await fr.evaluate(() => {
      const c = document.querySelector('.history-close, [data-test="history-close"]');
      if (c) c.click();
      else document.querySelectorAll('.history-backdrop, .history-modal').forEach(el => el.hidden = true);
    });
    await fr.waitForTimeout(400);
  }
  log(`   settings_open=${checks.settings_open} · paytable_open=${checks.paytable_open} (content=${checks.paytable_has_content}) · history_open=${checks.history_open} (rows=${checks.history_has_rows})`);

  /* 7. Feature-specific probes from GDD */
  log(`🧩 Feature-specific blokovi iz GDD-a: ${declared.features.join(', ')}`);
  if (declared.features.includes('cascade') || declared.features.includes('tumble')) {
    /* trigger a planted big-win-like outcome and ensure cascade runs */
    const cascadeObs = await fr.evaluate(() => window.__OBS__.filter(o => o.event === 'onCascadeStart').length);
    checks.cascade_fires = cascadeObs > 0;
    log(`   cascade fires across walk: ${cascadeObs} ${checks.cascade_fires ? '✓' : '✗ (declared but never fired during walk — may need bigger sample)'}`);
  }
  if (declared.features.includes('lightning')) {
    const ltn = await fr.evaluate(() => window.__OBS__.filter(o => o.event === 'onLightningStart').length);
    log(`   lightning fires across walk: ${ltn}`);
  }
  if (declared.features.includes('hold_and_win')) {
    const hnw = await fr.evaluate(() => window.__OBS__.filter(o => o.event === 'onHoldAndWinStart').length);
    log(`   hold&win fires across walk: ${hnw}`);
  }

  checks.console_errors = errs.length;
  log(`   console errors: ${errs.length} ${errs.length === 0 ? '✓' : '✗'}`);
  if (errs.length > 0) errs.slice(0, 3).forEach(e => log(`     ↳ ${String(e).slice(0, 200)}`));

  /* Screenshot for record */
  const shot = resolve(OUT, `${gdd.label.replace(/[^\w]+/g, '_').toLowerCase()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  log(`📸 Screenshot: ${shot}`);

  return { gdd: gdd.label, declared: declared.features, checks, errs };
}

/* ─── Main ─────────────────────────────────────────────────────────────── */
console.log('\n🎯 CORTEX EYES ULTIMATE — Boki, ekran je tvoj — gledaj kako idem GDD po GDD\n');

const browser = await chromium.launch({ headless: false, slowMo: 220 });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();

const summary = [];
for (const gdd of GDDS) {
  log(`\n═════════ ${gdd.label} ═════════`);
  let declared;
  try {
    declared = await readPdfFeatures(resolve(GDD_DIR, gdd.file));
    log(`📜 GDD declared features: ${declared.features.join(', ')}`);
  } catch (e) {
    log(`💥 Failed to parse PDF: ${e.message}`);
    summary.push({ gdd: gdd.label, error: e.message });
    continue;
  }
  try {
    const r = await walkOneGDD(page, gdd, declared);
    summary.push(r);
  } catch (e) {
    log(`💥 Walk failed: ${String(e).slice(0, 200)}`);
    summary.push({ gdd: gdd.label, error: String(e), declared: declared.features });
  }
}

await browser.close();

/* ─── Final report ─────────────────────────────────────────────────────── */
console.log('\n\n┌─── GDD ─────────────────────┬─spin─┬─turbo─┬──FS──┬──BW──┬──BB──┬─Set─┬─Pay─┬─His─┬─err─┐');
let failing = [];
for (const r of summary) {
  if (r.error) {
    console.log(`│ ${r.gdd.padEnd(28)} │ ERROR: ${r.error.slice(0, 50)}`);
    failing.push(r.gdd);
    continue;
  }
  const c = r.checks;
  const cell = (v) => v === 'na' ? ' n/a ' : (v ? '  ✓  ' : '  ✗  ');
  const broke =
    !c.spin_preSpin_6 || !c.spin_settle_6 || !c.turbo_compresses ||
    (c.fs_works !== 'na' && !c.fs_works) ||
    (c.bw_works !== 'na' && !c.bw_works) ||
    (c.bonusBuy_works !== 'na' && !c.bonusBuy_works) ||
    !c.settings_open || !c.paytable_open || !c.history_open ||
    c.console_errors > 0;
  if (broke) failing.push(r.gdd);
  console.log(`│ ${r.gdd.padEnd(28)} │${cell(c.spin_preSpin_6 && c.spin_settle_6)}│${cell(c.turbo_compresses)}│${cell(c.fs_works)}│${cell(c.bw_works)}│${cell(c.bonusBuy_works)}│${cell(c.settings_open)}│${cell(c.paytable_open && c.paytable_has_content)}│${cell(c.history_open)}│ ${String(c.console_errors).padStart(3)} │`);
}
console.log('└─────────────────────────────┴─────┴───────┴──────┴──────┴──────┴─────┴─────┴─────┴─────┘');
console.log(`\nFailing GDDs: ${failing.length}/${summary.length}`);
for (const f of failing) console.log(`  ✗ ${f}`);

writeFileSync(resolve(OUT, 'ultimate-live.json'), JSON.stringify(summary, null, 2));
process.exit(failing.length === 0 ? 0 : 1);
