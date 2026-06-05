#!/usr/bin/env node
/**
 * Autoplay wait-for-win probe — verifies H5.17 fix for Boki rule
 * 05.06.2026: "Kada se ukljuci auto play mora da se saceka svaki win
 * do kraja pa cak i big win, ne sme da se preskace odmah, nego realna
 * igra bez skipovanja."
 *
 * Three scenarios per demo:
 *   A. No-win postSpin → next spin scheduled after INTER_SPIN_MS (~250).
 *   B. Regular-win postSpin → next spin scheduled after WIN_HOLD_MS
 *      (default 1500ms) — counter has time to settle visually.
 *   C. Big-win postSpin → next spin DOES NOT fire after a fixed timeout;
 *      it waits for onBigWinTierEnd. Verify by measuring the elapsed time
 *      from postSpin → next preSpin: must be ≥ 4 s (one tier walkthrough
 *      minimum) which we approximate by checking it's much greater than
 *      WIN_HOLD_MS.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5233;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',      path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
];

const out = [];

async function runScenario(page, name, setupFn) {
  return await page.evaluate(async (args) => {
    const { label, setup } = args;
    // Reset state
    window.__AP__ = { events: [], scheduledAt: null };
    if (window.HookBus) {
      const evs = ['postSpin','preSpin','onBigWinTierEntered','onBigWinTierEnd','onWinPresentationStart','onWinPresentationEnd'];
      evs.forEach(n => window.HookBus.on(n, p => window.__AP__.events.push({ n, t: performance.now()|0, ...p })));
    }

    // Simulate autoplay state
    window.AUTOPLAY_STATE = window.AUTOPLAY_STATE || {};
    if (typeof window.autoplayStart === 'function') {
      try { window.autoplayStart(10, 1); } catch (_) {}
    }
    // Force STATE.active = true + remaining > 0
    if (window.AUTOPLAY_STATE) {
      window.AUTOPLAY_STATE.active = true;
      window.AUTOPLAY_STATE.paused = false;
      window.AUTOPLAY_STATE.remaining = 10;
      window.AUTOPLAY_STATE.completed = 0;
      window.AUTOPLAY_STATE.step = 10;
    }

    // Setup award + bigwin flags
    eval(setup);

    // Mark t0, emit postSpin (simulates handlePostSpin completion)
    const t0 = performance.now() | 0;
    window.__AP_T0__ = t0;

    // Inject hook to detect when autoplay would have clicked spinBtn next
    // (we replace spinBtn.click temporarily)
    const spinBtn = document.getElementById('spinBtn');
    let clickedAt = null;
    const origClick = spinBtn?.click?.bind(spinBtn);
    if (spinBtn) {
      spinBtn.click = function () {
        clickedAt = performance.now() | 0;
        // Don't actually fire — we just measure timing
      };
    }

    // Emit postSpin so autoplay handler fires
    if (window.HookBus) window.HookBus.emit('postSpin', { duringFs: false });

    // Wait long enough to cover all 3 scenarios
    await new Promise(r => setTimeout(r, 3000));

    // Restore click
    if (spinBtn && origClick) spinBtn.click = origClick;

    return {
      scenario: label,
      t0,
      clickedAt,
      elapsedToNext: (clickedAt !== null) ? (clickedAt - t0) : null,
      eventCount: window.__AP__.events.length,
    };
  }, { label: name, setup: setupFn.toString().match(/{([\s\S]*)}/)[1] });
}

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

    // ── SCENARIO A: NO WIN — next spin in ~250ms ──
    const sA = await runScenario(page, 'no-win', () => { window.__WIN_AWARD__ = 0; });

    // ── SCENARIO B: REGULAR WIN — next spin in ~1500ms ──
    const sB = await runScenario(page, 'regular-win', () => {
      const bet = window.__SLOT_BET__ || 1;
      window.__WIN_AWARD__ = 3 * bet;
    });

    // ── SCENARIO C: BIG WIN — next spin waits for onBigWinTierEnd ──
    const sC = await page.evaluate(async () => {
      window.__AP__ = { events: [] };
      window.AUTOPLAY_STATE = window.AUTOPLAY_STATE || {};
      if (window.AUTOPLAY_STATE) {
        window.AUTOPLAY_STATE.active = true;
        window.AUTOPLAY_STATE.paused = false;
        window.AUTOPLAY_STATE.remaining = 10;
        window.AUTOPLAY_STATE.completed = 0;
        window.AUTOPLAY_STATE.step = 10;
      }
      const bet = window.__SLOT_BET__ || 1;
      const award = 50 * bet;     // 50× = above 10× big-win trigger
      window.__WIN_AWARD__ = award;
      window.BIG_WIN_TIER_STATE = window.BIG_WIN_TIER_STATE || { enabled: true, thresholds: [10,25,50,200,1000] };
      window.BIG_WIN_TIER_STATE.enabled = true;

      const t0 = performance.now() | 0;
      const spinBtn = document.getElementById('spinBtn');
      let clickedAt = null;
      const origClick = spinBtn?.click?.bind(spinBtn);
      if (spinBtn) spinBtn.click = function () { clickedAt = performance.now() | 0; };

      window.HookBus.emit('postSpin', { duringFs: false });

      // Wait 2 seconds — autoplay should NOT have clicked yet (big-win
      // walkthrough would just be starting tier 1)
      await new Promise(r => setTimeout(r, 2000));
      const clickedAt2s = clickedAt;

      // Now manually emit onBigWinTierEnd to simulate walkthrough completion
      window.HookBus.emit('onBigWinTierEnd', { tier: 5, x: award, reason: 'natural' });

      // Wait another 500ms for the autoplay listener to schedule the next spin
      await new Promise(r => setTimeout(r, 500));
      const clickedAtAfterEnd = clickedAt;

      if (spinBtn && origClick) spinBtn.click = origClick;
      return {
        t0,
        clickedAt2s,
        clickedAtAfterEnd,
        timeToNextAfterPostSpin: clickedAtAfterEnd !== null ? (clickedAtAfterEnd - t0) : null,
      };
    });

    const checks = [
      // SCENARIO A — no win: ~INTER_SPIN_MS (250ms ±200ms)
      ['A. no-win: next spin scheduled',                    sA.clickedAt !== null],
      ['A. no-win: delay ≈ 250ms (100-700ms)',              sA.elapsedToNext >= 100 && sA.elapsedToNext <= 700],

      // SCENARIO B — regular win: ~WIN_HOLD_MS (1500ms ±300ms)
      ['B. regular-win: next spin scheduled',               sB.clickedAt !== null],
      ['B. regular-win: delay ≈ 1500ms (1200-1900ms)',      sB.elapsedToNext >= 1200 && sB.elapsedToNext <= 1900],
      ['B. regular-win: NOT fired in 250ms window',         sB.elapsedToNext > 700],

      // SCENARIO C — big win: WAITS for End event
      ['C. big-win: NOT fired at 2s mark',                  sC.clickedAt2s === null],
      ['C. big-win: fires AFTER End event arrives',         sC.clickedAtAfterEnd !== null],
      ['C. big-win: total delay > 2000ms (waited for End)', sC.timeToNextAfterPostSpin > 2000],

      // Errors
      ['no console / page errors',                          errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, sA, sB, sC, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ AUTOPLAY WAIT-FOR-WIN PROBE (Wave H5.17) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A no-win:      next click after ${r.sA.elapsedToNext}ms`);
  console.log(`  B regular-win: next click after ${r.sB.elapsedToNext}ms`);
  console.log(`  C big-win:     at 2s mark clicked=${r.sC.clickedAt2s !== null ? 'YES' : 'no'}, after End=${r.sC.clickedAtAfterEnd !== null ? 'YES' : 'no'}, total=${r.sC.timeToNextAfterPostSpin}ms`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
