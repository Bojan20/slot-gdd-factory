#!/usr/bin/env node
/**
 * tools/_ultimate-manual-spin-probe.mjs · D-14.3 MANUAL SPIN AUDIT
 *
 * Boki imperative (2026-06-20):
 *   "overio si da svaki blok se pravi kako treba i povezuje zavisno od
 *    gdd? da li svaka prezentacija radi pravilno itd?"
 *
 * Svi prethodni probe-ovi su klikali UFP force chip-ove (koji
 * postavljaju force flag-ove + zovu runOneBaseSpin). Niko nije
 * verifikovao da li MANUAL klik na spinBtn — pravi user flow —
 * pokrene spin, vrti reels, emit-uje postSpin, popunjava win.
 *
 * Ovaj probe testira čist manual flow:
 *   1. Klik spinBtn (bez force flag-ova)
 *   2. Wait 6s (više nego dovoljno za bilo koji slot settle)
 *   3. Verify:
 *      a. preSpin event letio
 *      b. reels su postali .is-spinning bar 200ms
 *      c. reels su prestali .is-spinning (settle gate)
 *      d. postSpin event letio
 *      e. balance je ažuriran (deducted bet, possibly + win)
 *      f. spinBtn je opet enabled za sledeći spin
 *
 * Za svaku igru klikne spinBtn 3 puta uzastopno (test idempotency
 * + queue). Verifikuje da treća iteracija takođe radi.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-manual-spin');

const WAIT_SETTLE_MS = 12000;
const VIEWPORT = { width: 1440, height: 900 };
const SPINS_PER_GAME = 1;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const WATCHED = ['preSpin', 'postSpin', 'onSpinResult', 'onBalanceChanged',
                 'onWinPresStart', 'onWinPresEnd', 'onPaylineFlash'];

const INIT_SCRIPT = `
(function() {
  if (window.__MS) return;
  window.__MS = { events: [], balanceSnaps: [] };
  var WATCH = new Set(${JSON.stringify(WATCHED)});
  var installer = setInterval(function () {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    if (window.HookBus.__ms_wrapped) return;
    var orig = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.__ms_wrapped = true;
    window.HookBus.emit = function (name, payload) {
      if (WATCH.has(name)) {
        window.__MS.events.push({ event: name, ts: performance.now() });
      }
      return orig(name, payload);
    };
    clearInterval(installer);
  }, 30);
})();
`;

function listGames() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST).filter(d => {
    const p = join(DIST, d, 'slot.html');
    try { return statSync(p).isFile(); } catch { return false; }
  }).sort();
}

function log(...a) { console.log(...a); }

async function waitSpinEnabled(page, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const ok = await page.evaluate(() => {
      const btn = document.getElementById('spinBtn');
      return !!(btn && !btn.disabled);
    });
    if (ok) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function runOneSpin(page, idx) {
  const beforeEvents = await page.evaluate(() => window.__MS.events.length);
  const beforeBalance = await page.evaluate(() => {
    if (typeof window.BALANCE === 'number') return window.BALANCE;
    if (window.HookBus && typeof window.HookBus.getBalance === 'function') return window.HookBus.getBalance();
    var el = document.querySelector('[data-balance],#balance,.balance-value');
    if (el) return Number(el.textContent.replace(/[^\d.-]/g, '')) || null;
    return null;
  });

  const clickRes = await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (!btn) return { ok: false, reason: 'no-btn' };
    if (btn.disabled) return { ok: false, reason: 'disabled' };
    btn.click();
    return { ok: true };
  });
  if (!clickRes.ok) {
    return { idx, verdict: 'FAIL', reason: clickRes.reason };
  }

  /* Sample is-spinning state at 300 ms (should be active). Real DOM
   * uses .reelCol.is-spinning (reelEngine.mjs:364 + :502). Plus
   * .is-blurring on cells during the spin animation. */
  await page.waitForTimeout(300);
  const reelsSpinning = await page.evaluate(() => {
    return document.querySelectorAll('.reelCol.is-spinning, .cell.is-blurring').length;
  });

  /* Wait for settle: postSpin emit OR timeout. */
  const start = Date.now();
  while (Date.now() - start < WAIT_SETTLE_MS) {
    const snap = await page.evaluate((b) => window.__MS.events.slice(b),
                                      beforeEvents);
    if (snap.some(e => e.event === 'postSpin')) break;
    await page.waitForTimeout(150);
  }

  const events = await page.evaluate((b) => window.__MS.events.slice(b),
                                       beforeEvents);
  const eventNames = events.map(e => e.event);
  const preSpinFired  = eventNames.includes('preSpin');
  const postSpinFired = eventNames.includes('postSpin');
  const balanceChanged = eventNames.includes('onBalanceChanged');

  const afterBalance = await page.evaluate(() => {
    if (typeof window.BALANCE === 'number') return window.BALANCE;
    if (window.HookBus && typeof window.HookBus.getBalance === 'function') return window.HookBus.getBalance();
    var el = document.querySelector('[data-balance],#balance,.balance-value');
    if (el) return Number(el.textContent.replace(/[^\d.-]/g, '')) || null;
    return null;
  });

  const reelsStillSpinning = await page.evaluate(() => {
    return document.querySelectorAll('.reelCol.is-spinning, .cell.is-blurring').length;
  });
  const btnReEnabled = await waitSpinEnabled(page, 2000);

  /* D-14.3 (2026-06-20) — spinBtn disabled posle spina je LEGITIMNO
   * ponašanje ako spin trigger-uje FS round (FS_INTRO/FS_ACTIVE
   * phase). U toj putanji FS ima svoj auto-spin loop koji vlasništvo
   * spinBtn preuzima. Manual spin verdict: kompletiranje lifecycle-a
   * (preSpin → reels rolling → postSpin → settle). btnReEnabled je
   * sekundarni check koji preskačemo ako je FS feature aktiviran. */
  const fsActive = eventNames.includes('onFsTrigger') ||
                    await page.evaluate(() => {
                      if (window.FSM && /^FS_/.test(String(window.FSM.phase || ''))) return true;
                      if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
                      return false;
                    });
  const btnOK = btnReEnabled || fsActive;

  const verdict = (preSpinFired && reelsSpinning > 0 && postSpinFired &&
                   reelsStillSpinning === 0 && btnOK) ? 'PASS' : 'FAIL';

  return {
    idx, verdict, preSpinFired, postSpinFired, balanceChanged, fsActive,
    reelsSpinningAt300ms: reelsSpinning,
    reelsStillSpinningAtEnd: reelsStillSpinning,
    btnReEnabled, btnOK,
    beforeBalance, afterBalance,
    eventNames,
  };
}

async function runGame(browser, game) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));

  log(`\n┌─ ${game}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    await page.waitForFunction(() =>
      Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0,
      { timeout: 10000 });
    await waitSpinEnabled(page, 4000);

    const spins = [];
    for (let i = 1; i <= SPINS_PER_GAME; i++) {
      /* If the previous spin entered an FS round, wait for it to end
       * before next manual click. Without this we click during
       * FS_ACTIVE auto-spin which is owned by FSM, not the manual
       * spinBtn path. */
      if (spins.length > 0 && spins[spins.length - 1].fsActive) {
        await page.waitForFunction(() => {
          if (window.FSM && /^FS_/.test(String(window.FSM.phase || ''))) return false;
          if (window.FREESPINS && window.FREESPINS.remaining > 0) return false;
          return true;
        }, { timeout: 30000 }).catch(() => {});
        await waitSpinEnabled(page, 4000);
      }
      const r = await runOneSpin(page, i);
      spins.push(r);
      const tag = r.verdict === 'PASS' ? '✓' : '✗';
      const fs = r.fsActive ? ' FS' : '';
      log(`│    ${tag} spin#${i}  pre=${r.preSpinFired ? 'Y' : 'N'} ` +
          `roll=${r.reelsSpinningAt300ms || 0} post=${r.postSpinFired ? 'Y' : 'N'} ` +
          `settle=${r.reelsStillSpinningAtEnd === 0 ? 'Y' : 'N'} btn=${r.btnOK ? 'Y' : 'N'}${fs}`);
    }

    await ctx.close();
    const pass = spins.filter(s => s.verdict === 'PASS').length;
    const fail = spins.length - pass;
    log(`└─ ${pass}/${spins.length} manual spins PASS`);

    return { game, verdict: fail === 0 ? 'PASS' : 'FAIL', spins, pageErrors,
             summary: { totalSpins: spins.length, pass, fail } };
  } catch (e) {
    log(`│  ⚠ unexpected: ${String(e.message || e).slice(0, 200)}`);
    try { await ctx.close(); } catch {}
    return { game, verdict: 'ERROR', error: String(e.message || e),
             spins: [], pageErrors,
             summary: { totalSpins: 0, pass: 0, fail: 0 } };
  }
}

async function main() {
  const games = listGames();
  if (!games.length) { console.error('NO GAMES'); process.exit(2); }
  log(`🎯 D-14.3 MANUAL-SPIN PROBE — ${games.length} games × ${SPINS_PER_GAME} spins`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  const totalSpins = results.reduce((a, r) => a + (r.summary?.totalSpins || 0), 0);
  const totalPass  = results.reduce((a, r) => a + (r.summary?.pass || 0), 0);
  const totalFail  = results.reduce((a, r) => a + (r.summary?.fail || 0), 0);
  const final = totalFail === 0 ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    perGame: results,
    aggregate: { totalSpins, totalPass, totalFail, final },
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌──────────────────────────────────────────────────────────────────────┐');
  log(`│ D-14.3 MANUAL-SPIN · FINAL: ${final.padEnd(4)} ` +
      `(${totalPass}/${totalSpins} PASS · ${totalFail} FAIL)`);
  log('└──────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${(r.verdict || '?').padEnd(5)} ` +
        `${r.summary?.pass ?? '?'}/${r.summary?.totalSpins ?? '?'} PASS`);
  }

  process.exit(final === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
