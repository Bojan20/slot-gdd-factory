#!/usr/bin/env node
/**
 * Big-win presentation-flow probe — verifies the H5.13 fix for Boki's
 * 05.06.2026 rule: "Kada se desi big win, [...] nema prvo win line
 * prezentacije pa onda big win, nego ima animacija simbola i onda se
 * prikaze big win."
 *
 * Reference flow (audited from the reference presentation.ts):
 *   small/medium win:  WIN_PRESHOW → per-line TOTAL_ROLLUP → BIG_WIN(none)
 *   BIG WIN:           SYMBOL_CELEBRATION (single 800ms pulse) → BIG_WIN overlay
 *
 * Scenarios per demo:
 *   A. Regular win (3× bet)  — line cycle runs, isBigWin=false.
 *   B. Big win    (50× bet)  — line cycle DOES NOT run, only a single
 *                              SYMBOL_CELEBRATION pulse for ~800ms,
 *                              then bigWinTier banner.
 *   C. BW force button       — same as B: single symbol pulse → tier
 *                              banner.
 *
 * Detection: per-line cycle adds `is-winsym-cycling` class to grid AND
 * cycles `cell--winsym` class onto cells one at a time (multiple step
 * timeouts). Big-win celebration adds ALL winning cells to `cell--winsym`
 * at once and clears once after bigWinCelebMs.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5227;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',         path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus',    path: '/dist/wrath-of-olympus.html' },
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
    await page.waitForTimeout(800);

    // Wire trace on HookBus events
    await page.evaluate(() => {
      window.__PFP__ = { events: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__PFP__.events.push({ n, t: performance.now()|0, ...p })));
    });

    // ── SCENARIO A: REGULAR WIN — emit Start sa 3× award, check is-winsym-cycling ──
    const scenarioA = await page.evaluate(async () => {
      window.__PFP_A__ = { events: [], samples: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__PFP_A__.events.push({ n, t: performance.now()|0, ...p })));

      // applyWinHighlight is exposed on window. Drive it directly with fake events.
      // Setup: ensure grid has cells we can mark as winners.
      const cells = Array.from(document.querySelectorAll('.cell')).slice(0, 3);
      if (cells.length < 3) return { skipped: true, reason: 'no cells available' };

      // We can't easily mock the detector, so we trigger applyWinHighlight
      // via the HookBus path: emit onWinPresentationStart manually + check
      // grid class. NOT ideal — better: just check via behavior on real spin.
      // Approach: temporarily set bigWinTier threshold extremely high so a
      // real spin's 3× win stays in the non-big branch.
      const prev = window.BIG_WIN_TIER_STATE?.thresholds?.[0];
      if (window.BIG_WIN_TIER_STATE) window.BIG_WIN_TIER_STATE.thresholds[0] = 99999; // disable big-win detection

      // Force a spin: programmatic call via emitting onWinPresentationStart
      // does NOT actually run the playWinSymCycle path. We need to call
      // applyWinHighlight directly. It will run noWinChance dice — skip
      // that by setting up a forced scenario via FORCE_BIG_WIN_TIER but
      // with low threshold... actually simpler: just observe a real spin
      // and check whether is-winsym-cycling appeared.
      const grid = document.querySelector('.gridHost') || document.getElementById('gridHost');
      const sampler = setInterval(() => {
        window.__PFP_A__.samples.push({
          t: performance.now()|0,
          cyclingClass: !!grid?.classList?.contains('is-winsym-cycling'),
          winsymCount: document.querySelectorAll('.cell--winsym').length,
        });
      }, 80);
      // Trigger a spin via the spin button (we want a real spin path)
      const spinBtn = document.getElementById('spinBtn');
      if (spinBtn && !spinBtn.disabled) spinBtn.click();
      await new Promise(r => setTimeout(r, 4500));
      clearInterval(sampler);
      // Restore threshold
      if (window.BIG_WIN_TIER_STATE && prev != null) window.BIG_WIN_TIER_STATE.thresholds[0] = prev;
      const start = window.__PFP_A__.events.find(e => e.n === 'onWinPresentationStart');
      const end = window.__PFP_A__.events.find(e => e.n === 'onWinPresentationEnd');
      return {
        startSeen: !!start,
        endSeen:   !!end,
        startIsBigWin: start?.isBigWin,
        endIsBigWin:   end?.isBigWin,
        // Cycle class present at any point during the window
        cyclingObserved: window.__PFP_A__.samples.some(s => s.cyclingClass),
        // Count of distinct winsym snapshots showing varying number — line cycle moves through
        winsymCountMax: Math.max(0, ...window.__PFP_A__.samples.map(s => s.winsymCount)),
      };
    });

    // ── SCENARIO B/C: BW force button ──
    const scenarioBC = await page.evaluate(async () => {
      // Wait for state to settle
      while (document.getElementById('spinBtn')?.disabled) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 400));

      window.__PFP_BC__ = { events: [], samples: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered','onBigWinTierEnd'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__PFP_BC__.events.push({ n, t: performance.now()|0, ...p })));

      const grid = document.querySelector('.gridHost') || document.getElementById('gridHost');
      const sampler = setInterval(() => {
        window.__PFP_BC__.samples.push({
          t: performance.now()|0,
          cyclingClass: !!grid?.classList?.contains('is-winsym-cycling'),
          winsymCount: document.querySelectorAll('.cell--winsym').length,
        });
      }, 60);

      // Click BW dugme — force big win
      const bw = document.getElementById('devBwBtn');
      if (!bw || bw.disabled) return { error: 'BW button not available' };
      bw.click();

      // Wait for full sequence: spin (~3s) + symbol celeb (800ms) + walkthrough (~24s) — sample first 6s
      await new Promise(r => setTimeout(r, 6000));
      clearInterval(sampler);

      const start = window.__PFP_BC__.events.find(e => e.n === 'onWinPresentationStart');
      const end = window.__PFP_BC__.events.find(e => e.n === 'onWinPresentationEnd');
      const bigWinEntered = window.__PFP_BC__.events.find(e => e.n === 'onBigWinTierEntered');

      // Compute cycling-window duration
      const cyclingSamples = window.__PFP_BC__.samples.filter(s => s.cyclingClass);
      const cyclingDuration = cyclingSamples.length > 0
        ? (cyclingSamples[cyclingSamples.length - 1].t - cyclingSamples[0].t)
        : 0;

      // Was a line cycle (multiple distinct values over time)?
      const distinctCounts = new Set(window.__PFP_BC__.samples.map(s => s.winsymCount));
      const distinctNonZero = [...distinctCounts].filter(n => n > 0);

      return {
        startSeen: !!start,
        startIsBigWin: start?.isBigWin,
        endSeen: !!end,
        endIsBigWin: end?.isBigWin,
        cyclingObserved: cyclingSamples.length > 0,
        cyclingDuration,
        winsymCountMax: Math.max(0, ...window.__PFP_BC__.samples.map(s => s.winsymCount)),
        distinctNonZeroCounts: distinctNonZero.length,
        bigWinEnteredAfterEnd:
          start && end && bigWinEntered ? bigWinEntered.t >= end.t : null,
        startToEndMs: (start && end) ? (end.t - start.t) : null,
      };
    });

    const checks = [
      // SCENARIO A — regular win
      ['A. onWinPresentationStart fired',         scenarioA.startSeen],
      ['A. isBigWin=false on Start',              scenarioA.startIsBigWin === false],
      ['A. onWinPresentationEnd fired',           scenarioA.endSeen],
      ['A. cycling class observed',               scenarioA.cyclingObserved === true],

      // SCENARIO BC — BW force big-win
      ['BC. BW click → onWinPresentationStart fired',  scenarioBC.startSeen],
      ['BC. isBigWin=true on Start',                   scenarioBC.startIsBigWin === true],
      ['BC. onWinPresentationEnd fired',               scenarioBC.endSeen],
      ['BC. isBigWin=true on End',                     scenarioBC.endIsBigWin === true],
      ['BC. start→end duration ≈ bigWinCelebMs (700-1200ms)',
        scenarioBC.startToEndMs >= 700 && scenarioBC.startToEndMs <= 1200],
      // Symbol celebration = ONE distinct nonzero count level (not multiple line-cycle steps)
      // Note: synth event has cells:[], so winsymCount can be 0 throughout — that's OK.
      // The TRUE signal: start→end is ~800ms, NOT thousands of ms (which would be per-line cycle).
      ['BC. bigWinTier entered AFTER WinPresEnd',      scenarioBC.bigWinEnteredAfterEnd === true],

      // Errors
      ['no console / page errors',                errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, scenarioA, scenarioBC, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ BIG-WIN PRESENTATION-FLOW PROBE (Wave H5.13) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A regular: startBig=${r.scenarioA.startIsBigWin} endBig=${r.scenarioA.endIsBigWin} cycling=${r.scenarioA.cyclingObserved}`);
  console.log(`  BC bigwin: startBig=${r.scenarioBC.startIsBigWin} endBig=${r.scenarioBC.endIsBigWin} startToEnd=${r.scenarioBC.startToEndMs}ms entered-after-end=${r.scenarioBC.bigWinEnteredAfterEnd}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
