#!/usr/bin/env node
/**
 * Post-FS win-presentation probe — verifies H5.16 fix for Boki rule
 * 05.06.2026: "kad se vratim iz FS bonusa, treba da bude ako postoji
 * uslov za big win, onda mora big win da se pokaze, ako postoji uslov
 * za bilo koji win onda mora da se pokaze, dakle isto win animacija
 * counter itd."
 *
 * Tested via direct presentExternalWin(award) invocation (the helper
 * that freeSpins.FSM_enterBase wires up). Two scenarios per demo:
 *   A. Regular post-FS win (3× bet) — onWinPresentationStart fires
 *      with isBigWin:false, winRollup picks it up, end fires.
 *   B. Big post-FS win (50× bet) — onWinPresentationStart fires with
 *      isBigWin:true, symbol pulse on 8 grid cells for ~800ms, then
 *      onWinPresentationEnd, then bigWinTier walkthrough kicks in.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5231;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',      path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
];

const out = [];

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0,200)));
    page.on('console', m => { if (m.type()==='error') errors.push('CON ' + m.text().slice(0,200)); });
    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.presentExternalWin === 'function', { timeout: 8000 }).catch(()=>{});
    await page.waitForTimeout(400);

    // ── SCENARIO A: REGULAR POST-FS WIN ─────────────────────────────
    const scenarioA = await page.evaluate(async () => {
      window.__A__ = { events: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__A__.events.push({ n, t: performance.now()|0, ...p })));
      const bet = window.__SLOT_BET__ || 1;
      const award = 3 * bet;
      await window.presentExternalWin(award);
      // Sample winRollup state
      await new Promise(r => setTimeout(r, 200));
      const text = document.getElementById('winRollupAmount')?.textContent;
      const show = document.getElementById('winRollupBanner')?.getAttribute('data-show');
      const start = window.__A__.events.find(e => e.n === 'onWinPresentationStart');
      const end   = window.__A__.events.find(e => e.n === 'onWinPresentationEnd');
      const bwEntered = window.__A__.events.find(e => e.n === 'onBigWinTierEntered');
      return {
        award,
        startIsBigWin: start?.isBigWin,
        startSource:   start?.source,
        endIsBigWin:   end?.isBigWin,
        endSource:     end?.source,
        winRollupText: text,
        winRollupShow: show,
        bigWinTierEntered: !!bwEntered,
      };
    });

    // Wait briefly + clear state
    await page.evaluate(async () => {
      if (window.winRollupClear) window.winRollupClear();
      await new Promise(r => setTimeout(r, 200));
    });

    // ── SCENARIO B: BIG POST-FS WIN ─────────────────────────────────
    const scenarioB = await page.evaluate(async () => {
      window.__B__ = { events: [], samples: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered','onBigWinTierEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__B__.events.push({ n, t: performance.now()|0, ...p })));
      const sampler = setInterval(() => {
        window.__B__.samples.push({
          t: performance.now()|0,
          winsymCount: document.querySelectorAll('.cell--winsym').length,
        });
      }, 60);
      const bet = window.__SLOT_BET__ || 1;
      const award = 50 * bet;     // 50× = above default 10× big-win threshold
      const pPromise = window.presentExternalWin(award);
      await pPromise;
      clearInterval(sampler);

      // Sample short window AFTER end to verify bigWinTier started
      await new Promise(r => setTimeout(r, 600));

      const start = window.__B__.events.find(e => e.n === 'onWinPresentationStart');
      const end   = window.__B__.events.find(e => e.n === 'onWinPresentationEnd');
      const bwEntered = window.__B__.events.find(e => e.n === 'onBigWinTierEntered');
      const maxWinsymDuringCeleb = (start && end)
        ? window.__B__.samples
            .filter(s => s.t >= start.t && s.t <= end.t)
            .reduce((m, s) => Math.max(m, s.winsymCount), 0)
        : 0;
      const startToEnd = (start && end) ? (end.t - start.t) : null;
      return {
        award,
        startIsBigWin: start?.isBigWin,
        startSource:   start?.source,
        endIsBigWin:   end?.isBigWin,
        endSource:     end?.source,
        startToEnd,
        maxWinsymDuringCeleb,
        bigWinTierEntered: !!bwEntered,
        bwEnteredAfterEnd: (bwEntered && end) ? bwEntered.t >= end.t : null,
      };
    });

    const checks = [
      // SCENARIO A
      ['A. presentExternalWin emitted Start',         scenarioA.startIsBigWin === false],
      ['A. source="post-fs" on Start',                scenarioA.startSource === 'post-fs'],
      ['A. emitted End with isBigWin=false',          scenarioA.endIsBigWin === false],
      ['A. winRollup counter shows award amount',     scenarioA.winRollupText?.includes(scenarioA.award.toFixed(2))],
      ['A. winRollup banner visible',                 scenarioA.winRollupShow === 'true'],
      ['A. bigWinTier NOT entered (sub-big-win)',     scenarioA.bigWinTierEntered === false],

      // SCENARIO B
      ['B. Start emitted with isBigWin=true',         scenarioB.startIsBigWin === true],
      ['B. source="post-fs" on Start',                scenarioB.startSource === 'post-fs'],
      ['B. start→end ≈ 800 ms (700-1200)',            scenarioB.startToEnd >= 700 && scenarioB.startToEnd <= 1200],
      ['B. cells pulsed during celebration (count ≥ 5)', scenarioB.maxWinsymDuringCeleb >= 5],
      ['B. End emitted with isBigWin=true',           scenarioB.endIsBigWin === true],
      ['B. bigWinTier entered after End',             scenarioB.bwEnteredAfterEnd === true],

      // Errors
      ['no console / page errors',                    errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, scenarioA, scenarioB, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ POST-FS WIN-PRESENTATION PROBE (Wave H5.16) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A regular: award=${r.scenarioA.award} bigWin=${r.scenarioA.startIsBigWin} rollupText="${r.scenarioA.winRollupText}" rollupShow=${r.scenarioA.winRollupShow}`);
  console.log(`  B big:     award=${r.scenarioB.award} bigWin=${r.scenarioB.startIsBigWin} startToEnd=${r.scenarioB.startToEnd}ms pulsedCells=${r.scenarioB.maxWinsymDuringCeleb} bwAfterEnd=${r.scenarioB.bwEnteredAfterEnd}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
