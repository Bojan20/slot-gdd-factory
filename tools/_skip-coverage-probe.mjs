#!/usr/bin/env node
/**
 * Skip-coverage probe — verifies that the SKIP CTA correctly fast-finalizes
 * every presentation surface a player can interrupt, in line with Boki's
 * 05.06.2026 spec:
 *
 *   1. "skip treba da skipuje i osnovni counter" — winRollup must snap to
 *      the final amount the moment phase==='rollup' is emitted.
 *   2. "Kada se preskoci win linija, treba da se skipuje na rollup end"
 *      — win-line cycle (winPresentation) AND winRollup counter must
 *      land on the same final frame together.
 *   3. "neka sve radi sa skipom i Kada forsujem big win" — BW-force
 *      click path: skip during the big-win walkthrough still jumps to
 *      the climax frame (already verified in H5.9, regression here).
 *
 * Reference flow audited (industry baseline statusBarController + bigWin
 * controller): skip during a presentation phase MUST settle that phase's
 * own surface in a single frame, not just bump to the next phase.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5219;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular', path: '/dist/01_rectangular_5x3_playable.html' },
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
    await page.waitForTimeout(800);

    // ── SCENARIO A: SKIP during rollup phase — winRollup counter must snap ──
    const scenarioA = await page.evaluate(async () => {
      window.__SA__ = { events: [] };
      ['onWinPresentationStart','onWinPresentationEnd','onSkipRequested','onSkipComplete']
        .forEach(n => window.HookBus.on(n, p => window.__SA__.events.push({ n, t: performance.now()|0, ...p })));
      const bet = window.__SLOT_BET__ || 1;
      const award = 3 * bet;     // 3× bet = sub-big-win, winRollup territory
      window.__WIN_AWARD__ = award;
      window.HookBus.emit('onWinPresentationStart', { award, eventCount: 1 });
      // Let rollup begin (ramp ~600 ms for 3× bet)
      await new Promise(r => setTimeout(r, 150));
      const midText = document.getElementById('winRollupAmount')?.textContent;
      const midCount = Number(document.getElementById('winRollupAmount')?.getAttribute('data-count')||0);
      const midActive = window.WIN_ROLLUP_STATE?.active;
      // Skip mid-ramp
      const skipT0 = performance.now() | 0;
      window.HookBus.emit('onSkipRequested', { phase: 'rollup', source: 'probe' });
      // Sample immediately + 50 ms later
      const justAfter = {
        text: document.getElementById('winRollupAmount')?.textContent,
        count: Number(document.getElementById('winRollupAmount')?.getAttribute('data-count')||0),
      };
      await new Promise(r => setTimeout(r, 50));
      const after50 = {
        text: document.getElementById('winRollupAmount')?.textContent,
        count: Number(document.getElementById('winRollupAmount')?.getAttribute('data-count')||0),
      };
      return { award, midText, midCount, midActive, skipT0, justAfter, after50 };
    });

    // ── SCENARIO B: BW force click — skip during big-win walkthrough ──
    const scenarioB = await page.evaluate(async () => {
      // Reset
      window.winRollupClear?.();
      await new Promise(r => setTimeout(r, 200));
      window.__SB__ = { events: [] };
      ['onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd','onSkipRequested','onSkipComplete']
        .forEach(n => window.HookBus.on(n, p => window.__SB__.events.push({ n, t: performance.now()|0, ...p })));
      // Programmatic BW enter (same code path as BW dugme reaching bigWinTierEnter)
      window.bigWinTierEnter(5, 1500);
      // Wait 5 s — should be in tier 2 (0-4 s = tier 1, 4-8 s = tier 2)
      await new Promise(r => setTimeout(r, 5500));
      const beforeSkip = {
        tier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
        amount: document.querySelector('.big-win-tier-amount')?.textContent,
        state: window.BIG_WIN_TIER_STATE?.current,
      };
      const skipT0 = performance.now() | 0;
      window.HookBus.emit('onSkipRequested', { phase: 'bigWinTier', source: 'probe' });
      // Snap sample is immediate (within one frame), but onBigWinTierEnd
      // fires only after SKIP_GLIMPSE_MS (180) + FADE_MS (300) ≈ 480 ms.
      // Wait long enough to capture the End event in the trace.
      await new Promise(r => setTimeout(r, 80));
      const afterSkip = {
        tier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
        amount: document.querySelector('.big-win-tier-amount')?.textContent,
        state: window.BIG_WIN_TIER_STATE?.current,
      };
      await new Promise(r => setTimeout(r, 700));
      const events = window.__SB__.events.filter(e => e.t >= skipT0);
      const newEntered = events.filter(e => e.n === 'onBigWinTierEntered');
      const end = events.find(e => e.n === 'onBigWinTierEnd');
      return { beforeSkip, afterSkip, newEntered: newEntered.length, end };
    });

    // ── SCENARIO C: BW dugme click → full pipeline → skip during rollup ──
    // The BW button kicks runOneBaseSpin → reels settle → winPresentation
    // synthesises an award → onWinPresentationStart → winRollup starts +
    // win-line cycle starts → onWinPresentationEnd → bigWinTier walkthrough.
    // We skip DURING the win-line cycle and verify winRollup snaps in lockstep.
    const scenarioC = await page.evaluate(async () => {
      // Reset state
      window.winRollupClear?.();
      // The bigWinTier walkthrough from scenario B is still ending — wait it out
      while (window.BIG_WIN_TIER_STATE?.walkActive) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 400));
      window.__SC__ = { events: [], rollupSamples: [] };
      ['onWinPresentationStart','onWinPresentationEnd','onSkipRequested','onSkipComplete',
       'onBigWinTierEntered','onBigWinTierEnd']
        .forEach(n => window.HookBus.on(n, p => window.__SC__.events.push({ n, t: performance.now()|0, ...p })));
      // For this scenario we directly drive a rollup + skip — emulates the
      // race where the player taps the SKIP CTA during the per-line cycle.
      // (Driving a full real spin + winRollup + winPresentation skip is
      // covered by the existing _bw-click-probe.mjs end-to-end probe; here
      // we focus on the skip-snap behavior alone.)
      const bet = window.__SLOT_BET__ || 1;
      const award = 5 * bet;
      window.__WIN_AWARD__ = award;
      window.HookBus.emit('onWinPresentationStart', { award, eventCount: 3 });
      await new Promise(r => setTimeout(r, 100));
      // Player clicks SKIP — both winPresentation (line cycle owner) and
      // winRollup (counter owner) must snap to terminal state.
      window.HookBus.emit('onSkipRequested', { phase: 'rollup', source: 'probe' });
      await new Promise(r => setTimeout(r, 60));
      return {
        award,
        rollupText: document.getElementById('winRollupAmount')?.textContent,
        rollupCount: Number(document.getElementById('winRollupAmount')?.getAttribute('data-count')||0),
        rollupActive: window.WIN_ROLLUP_STATE?.active,
        rollupShown: document.getElementById('winRollupBanner')?.getAttribute('data-show'),
      };
    });

    const aTargetText = scenarioA.award.toFixed(2);
    const cTargetText = scenarioC.award.toFixed(2);

    const checks = [
      // SCENARIO A: rollup skip
      ['A. Rollup was actively ramping before skip',     scenarioA.midActive === true && scenarioA.midCount > 0 && scenarioA.midCount < scenarioA.award],
      ['A. Skip → immediate snap to final amount',       scenarioA.justAfter.text?.includes(aTargetText)],
      ['A. data-count = full award after skip',          Math.abs(scenarioA.justAfter.count - scenarioA.award) < 0.01],
      ['A. 50ms later: still on final amount (no decay)', scenarioA.after50.text?.includes(aTargetText)],

      // SCENARIO B: BW walkthrough skip — H5.9 regression
      ['B. Before skip: tier 2 active',                  scenarioB.beforeSkip.state === 2 || scenarioB.beforeSkip.state === 3],
      ['B. After skip: tier=5 in DOM',                   scenarioB.afterSkip.tier === '5'],
      ['B. After skip: amount = €1500.00',               scenarioB.afterSkip.amount?.includes('1500.00')],
      ['B. After skip: state.current = 5',               scenarioB.afterSkip.state === 5],
      ['B. 0 new onBigWinTierEntered after skip',        scenarioB.newEntered === 0],
      ['B. onBigWinTierEnd fired with reason=skipped',   scenarioB.end?.reason === 'skipped'],
      ['B. onBigWinTierEnd carries finalTier=5',         scenarioB.end?.tier === 5],

      // SCENARIO C: combined rollup + counter snap
      ['C. After skip: rollup counter text = full award', scenarioC.rollupText?.includes(cTargetText)],
      ['C. After skip: data-count = full award',         Math.abs(scenarioC.rollupCount - scenarioC.award) < 0.01],
      ['C. After skip: banner still visible',            scenarioC.rollupShown === 'true'],

      // Errors
      ['no console / page errors',                        errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, scenarioA, scenarioB, scenarioC, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ SKIP COVERAGE PROBE (rollup + BW + combined) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A (rollup skip): mid="${r.scenarioA.midText}" → after="${r.scenarioA.justAfter.text}" (target=€${r.scenarioA.award.toFixed(2)})`);
  console.log(`  B (BW skip):     before tier=${r.scenarioB.beforeSkip.tier} amt="${r.scenarioB.beforeSkip.amount}" → after tier=${r.scenarioB.afterSkip.tier} amt="${r.scenarioB.afterSkip.amount}"`);
  console.log(`  C (combined):    after skip text="${r.scenarioC.rollupText}" (target=€${r.scenarioC.award.toFixed(2)}) shown=${r.scenarioC.rollupShown}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
