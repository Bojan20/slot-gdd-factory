#!/usr/bin/env node
/**
 * tools/_block-by-block-probe.mjs
 *
 * Boki direktiva (10.06): "svaki jebeni blok da radi zasebno. kada gdd
 * se ubaci u simulator i simulator procita svaki blok mora da radi."
 * Plus: ne nestaju ćelije/simboli posle nekoliko spinova. Svaki force radi.
 *
 * Detaljan po-block probe za Huff & Puff i Starlight (real PDFs):
 *   1. Open PDF in iframe
 *   2. Spin 10× — verify cell count STAYS constant
 *   3. Click EVERY visible force chip → verify per-block event
 *   4. Click bonusBuyBtn → verify response
 *   5. Open Settings / Paytable / History modals → verify populated
 *   6. Report per-block PASS/FAIL with concrete evidence
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                     from 'node:path';
import { fileURLToPath }                        from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/block-by-block');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PORT = 5276;
const URL  = `http://127.0.0.1:${PORT}/`;
const srv  = spawn('node', ['-e', `
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

const PDFS = [
  { name: 'Huff_N_More_Puff', path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight_Travellers', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
  { name: 'Gates_of_Olympus_1000', path: `${HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf` },
  { name: 'Wrath_of_Olympus', path: `${HOME}/Desktop/GDD/Wrath_of_Olympus_GDD.pdf` },
];

const browser = await chromium.launch({ headless: true });

async function _waitSettled(fr) {
  return fr.waitForFunction(() => {
    const obs = window.__OBS__ || [];
    let lastPre = -1, lastPost = -1, lastResult = -1;
    for (let i = obs.length - 1; i >= 0; i--) {
      const e = obs[i] && obs[i].event;
      if (lastPre === -1 && e === 'preSpin') lastPre = i;
      if (lastPost === -1 && e === 'postSpin') lastPost = i;
      if (lastResult === -1 && e === 'onSpinResult') lastResult = i;
      if (lastPre !== -1 && (lastPost !== -1 || lastResult !== -1)) break;
    }
    const spinDone = (lastPre === -1) || (lastPost > lastPre) || (lastResult > lastPre);
    const quiet = !window.allReelsActive && !document.querySelector('.is-spinning');
    return spinDone && quiet;
  }, null, { timeout: 10000 }).catch(() => {});
}

const allResults = [];

for (const pdf of PDFS) {
  console.log(`\n═════════════════════ ${pdf.name} ═════════════════════`);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').first().setInputFiles(pdf.path);
  await page.waitForSelector('iframe', { timeout: 25000 });
  const fr = await (await page.$('iframe')).contentFrame();
  await fr.waitForSelector('.cell, text, [data-cell], .peg, .grid-plinko, .crash-curve', { timeout: 18000 });
  await page.waitForTimeout(500);

  const live = await fr.evaluate(() => ({
    shape: window.SHAPE && window.SHAPE.kind,
    reels: window.REELS,
    rows: window.ROWS,
    countMode: window.FREESPINS && window.FREESPINS.countMode,
    awards: window.FREESPINS && window.FREESPINS.awards,
    fsEnabled: !!(window.FREESPINS && window.FREESPINS.enabled),
  }));
  console.log(`📋 shape=${live.shape} ${live.reels}×${live.rows} · countMode=${live.countMode} · fsEnabled=${live.fsEnabled}`);

  await fr.evaluate(() => {
    window.__OBS__ = [];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['preSpin','onSpinResult','postSpin','onFsTrigger','onFsEnd',
       'onForceFeatureRequested','onBigWinTierEntered','onBigWinTierEnd',
       'onScatterCelebrationStart','onScatterCelebrationEnd',
       'onBalanceChanged','onTurboToggle','onCascadeStart','onCascadeEnd',
       'onLightningStart','onLightningEnd','onHoldAndWinStart','onHoldAndWinEnd',
       'onWinPresentationStart','onWinPresentationEnd',
       'onMultiplierOrbAccumulate','onStickyWildPlaced',
       'onWildReelSpawn','onMysteryReveal','onExpandingWildExpand',
       'onWalkingWildMove','onSuperSymbolReveal','onPersistentMultBump',
       'onProgressiveMultBump','onRespinStart','onRespinEnd']
        .forEach(e => HookBus.on(e, p => window.__OBS__.push({ event: e, payload: p, t: Date.now() })));
    }
  });

  const results = { pdf: pdf.name, live, checks: [], cellTrace: [] };

  /* === 1. CELL STABILITY TEST — Boki bug: "nestaju ćelije posle nekoliko spinova" === */
  console.log(`\n🔬 Cell stability test — 10 spinova`);
  const cellsBefore = await fr.$$eval('.cell, text, [data-cell]', els => els.length);
  results.cellTrace.push({ when: 'before-any-spin', cells: cellsBefore });
  console.log(`   cells initial: ${cellsBefore}`);

  for (let i = 0; i < 10; i++) {
    await fr.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
    await _waitSettled(fr);
    await fr.waitForTimeout(150);
    const cellsNow = await fr.$$eval('.cell, text, [data-cell]', els => els.length);
    results.cellTrace.push({ when: `after-spin-${i + 1}`, cells: cellsNow });
    if (cellsNow !== cellsBefore) {
      console.log(`   ❌ spin ${i + 1}: cells ${cellsBefore} → ${cellsNow}`);
    }
  }
  const cellsAfter = await fr.$$eval('.cell, text, [data-cell]', els => els.length);
  const cellStable = cellsAfter === cellsBefore;
  results.checks.push({ name: 'cells_stable_after_10_spins', pass: cellStable, evidence: `${cellsBefore} → ${cellsAfter}` });
  console.log(`   ${cellStable ? '✓' : '✗'} cells_stable: ${cellsBefore} → ${cellsAfter}`);

  /* === 2. INVENTORY ALL CHIPS/BUTTONS === */
  const chips = await fr.evaluate(() => {
    const ufpChips = Array.from(document.querySelectorAll('.ufp-chip')).map(c => ({
      kind: c.dataset.ufpKind || c.getAttribute('data-ufp-kind'),
      text: c.textContent?.trim().slice(0, 30),
      visible: getComputedStyle(c).display !== 'none',
    }));
    return {
      ufpChips,
      bonusBuyBtn: !!document.getElementById('bonusBuyBtn'),
      settingsBtn: !!document.querySelector('.settings-btn, #settingsMenuBtn'),
      paytableBtn: !!document.querySelector('.paytable-btn'),
      historyBtn: !!document.querySelector('.history-btn'),
      turboBtn: !!document.getElementById('turboBtn'),
      autoBtn: !!document.querySelector('.autoBtn, #autoBtn'),
      spinBtn: !!document.getElementById('spinBtn'),
    };
  });
  console.log(`\n🎛️ Chips/buttons inventory:`);
  console.log(`   UFP chips: ${chips.ufpChips.map(c => c.kind).join(', ') || '(none)'}`);
  console.log(`   Buttons: bonusBuy=${chips.bonusBuyBtn} turbo=${chips.turboBtn} auto=${chips.autoBtn} settings=${chips.settingsBtn} paytable=${chips.paytableBtn} history=${chips.historyBtn}`);
  results.checks.push({ name: 'ufp_chip_inventory', pass: chips.ufpChips.length > 0, evidence: chips.ufpChips.map(c => c.kind).join(',') });
  results.chips = chips;

  /* === 3. CLICK EACH UFP CHIP === */
  console.log(`\n🎯 Click EACH force chip:`);
  for (const chip of chips.ufpChips) {
    await fr.evaluate(() => {
      try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
      try { window.FORCE_TRIGGER = null; } catch (_) {}
      try { window.__FORCE_BIG_WIN_TIER__ = 0; } catch (_) {}
      document.querySelectorAll('#fsOverlay, .freespins-overlay, .freespins-toast, .gfb-banner').forEach(el => { el.style.display = 'none'; });
      window.__OBS__ = [];
    });
    try {
      await fr.click(`.ufp-chip[data-ufp-kind="${chip.kind}"]`, { force: true, timeout: 3000 });
    } catch (e) {
      console.log(`   ❌ ${chip.kind}: click failed (${String(e).slice(0, 80)})`);
      results.checks.push({ name: `chip_${chip.kind}_click`, pass: false, evidence: 'click threw' });
      continue;
    }
    /* Quick check WHILE banner still up (dwellMs default 1200ms). */
    await fr.waitForTimeout(500);
    const bannerSeenEarly = await fr.evaluate(() => {
      const gfb = document.querySelector('.gfb-banner');
      return gfb && gfb.getAttribute('data-visible') === 'true' ? gfb.textContent.trim().slice(0, 40) : null;
    });
    await fr.waitForTimeout(3500);
    /* close any overlay that appeared */
    await fr.evaluate(() => {
      document.querySelectorAll('.freespins-overlay button, .freespins-toast button, [data-fs-close], #fsOverlay button, .gfb-banner button, #fsPlacardCta').forEach(b => b.click());
    });
    await fr.waitForTimeout(1500);
    /* Capture banner visibility BEFORE close-overlay step erases it. */
    const bannerSeen = await fr.evaluate(() => {
      /* generic banner persists with data-visible="true" until dwellMs */
      const gfb = document.querySelector('.gfb-banner');
      if (gfb && gfb.getAttribute('data-visible') === 'true') return 'gfb_visible';
      const txt = gfb && gfb.textContent ? gfb.textContent.trim().slice(0, 40) : '';
      if (txt && txt.length > 0) return 'gfb_text:' + txt;
      return null;
    });
    const obs = await fr.evaluate(() => window.__OBS__.slice());
    const requested = obs.some(o => o.event === 'onForceFeatureRequested' && o.payload?.kind === chip.kind);
    const evidence = [];
    if (requested) evidence.push('request');
    if (bannerSeen || bannerSeenEarly) evidence.push('banner' + (bannerSeenEarly ? `(${bannerSeenEarly})` : ''));
    if (obs.some(o => o.event === 'onScatterCelebrationStart')) evidence.push('celebration');
    if (obs.some(o => o.event === 'onFsTrigger')) evidence.push('fs');
    if (obs.some(o => o.event === 'onBigWinTierEntered')) evidence.push('bwTier');
    if (obs.some(o => o.event === 'onBigWinTierEnd')) evidence.push('bwEnd');
    if (obs.some(o => o.event === 'onHoldAndWinStart')) evidence.push('hwStart');
    if (obs.some(o => o.event === 'onCascadeStart')) evidence.push('cascadeStart');
    if (obs.some(o => o.event === 'onLightningStart')) evidence.push('lightningStart');
    if (obs.some(o => o.event === 'onMysteryReveal')) evidence.push('mysteryReveal');
    if (obs.some(o => o.event === 'onStickyWildPlaced')) evidence.push('stickyWild');
    if (obs.some(o => o.event === 'onWildReelSpawn')) evidence.push('wildReel');
    if (obs.some(o => o.event === 'onExpandingWildExpand')) evidence.push('expandWild');
    if (obs.some(o => o.event === 'onWalkingWildMove')) evidence.push('walkWild');
    if (obs.some(o => o.event === 'onSuperSymbolReveal')) evidence.push('superSym');
    if (obs.some(o => o.event === 'onMultiplierOrbAccumulate')) evidence.push('multOrb');
    if (obs.some(o => o.event === 'onProgressiveMultBump')) evidence.push('progMult');
    if (obs.some(o => o.event === 'onPersistentMultBump')) evidence.push('persistMult');
    if (obs.some(o => o.event === 'onRespinStart')) evidence.push('respinStart');
    if (obs.some(o => o.event === 'onWinPresentationStart')) evidence.push('winPresStart');
    const allEvents = obs.map(o => o.event);
    const pass = evidence.length > 1; /* request alone isn't enough */
    console.log(`   ${pass ? '✓' : '✗'} ${chip.kind}: ${evidence.join(',') || 'NO RESPONSE'} (total events: ${allEvents.length})`);
    results.checks.push({
      name: `chip_${chip.kind}`,
      pass,
      evidence: evidence.join(',') || `dead — only got: ${allEvents.slice(0, 5).join(',')}`,
    });
  }

  /* === 4. BONUS BUY === */
  if (chips.bonusBuyBtn) {
    await fr.evaluate(() => {
      try { if (window.FSM) window.FSM.phase = 'BASE'; } catch (_) {}
      window.__OBS__ = [];
    });
    try { await fr.click('#bonusBuyBtn', { force: true, timeout: 2500 }); } catch (_) {}
    await fr.waitForTimeout(700);
    await fr.evaluate(() => {
      const c = document.querySelector('.bonus-buy-confirm, .bb-confirm, [data-bb-confirm], .bonus-buy-modal button[data-action="confirm"]');
      if (c) c.click();
    });
    await fr.waitForTimeout(4500);
    const obs = await fr.evaluate(() => window.__OBS__.slice());
    const ok = obs.some(o => o.event === 'onFsTrigger') || obs.some(o => o.event === 'preSpin');
    console.log(`   ${ok ? '✓' : '✗'} bonusBuyBtn`);
    results.checks.push({ name: 'bonus_buy', pass: ok, evidence: ok ? 'fired' : 'dead' });
  }

  /* === 5. MODALS === */
  console.log(`\n📁 Modals:`);
  for (const [name, sel] of [['Settings', '.settings-btn, #settingsMenuBtn'], ['Paytable', '.paytable-btn'], ['History', '.history-btn']]) {
    const btn = await fr.$(sel);
    if (!btn) continue;
    try { await btn.click({ timeout: 2000 }); await fr.waitForTimeout(700);
      const visible = await fr.evaluate(() => {
        const els = document.querySelectorAll('.settings-modal, .settings-backdrop, .paytable-modal, .paytable-backdrop, .history-modal, .history-backdrop, .history-panel');
        return Array.from(els).some(e => !e.hidden && getComputedStyle(e).display !== 'none');
      });
      const contentLen = await fr.evaluate(() => {
        const els = document.querySelectorAll('.settings-modal, .paytable-modal, .history-modal, .history-panel');
        return Array.from(els).reduce((sum, e) => sum + (e.textContent || '').length, 0);
      });
      console.log(`   ${visible && contentLen > 50 ? '✓' : '✗'} ${name}: visible=${visible}, content=${contentLen} chars`);
      results.checks.push({ name: `modal_${name.toLowerCase()}`, pass: visible && contentLen > 50, evidence: `vis=${visible},len=${contentLen}` });
      await fr.evaluate(() => {
        document.querySelectorAll('.settings-close, .paytable-close, .history-close').forEach(c => c.click());
        document.querySelectorAll('.settings-backdrop, .paytable-backdrop, .history-backdrop, .history-modal').forEach(el => { el.hidden = true; });
      });
      await fr.waitForTimeout(300);
    } catch (e) { console.log(`   ✗ ${name}: ${String(e).slice(0, 80)}`); }
  }

  results.consoleErrors = errs.slice(0, 10);
  results.totalErrors = errs.length;
  console.log(`\n📊 Console errors: ${errs.length}`);
  for (const e of errs.slice(0, 5)) console.log(`     · ${e.slice(0, 120)}`);
  allResults.push(results);
  await ctx.close();
}

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

writeFileSync(resolve(OUT, 'block-by-block.json'), JSON.stringify(allResults, null, 2));

console.log(`\n\n══════════════════ SUMMARY ══════════════════`);
for (const r of allResults) {
  const failed = r.checks.filter(c => !c.pass);
  console.log(`\n${r.pdf}: ${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} FAILS`} · errors: ${r.totalErrors}`);
  for (const f of failed) console.log(`   ✗ ${f.name}: ${f.evidence}`);
}
process.exit(0);
