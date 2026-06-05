#!/usr/bin/env node
/**
 * SKIP probe — verify a skip click jumps DIRECTLY to climax (tier 5 + final
 * award), not walks through tier 3 / 4 first.
 *
 * Boki rule 05.06.2026: "Skip treba da u big winu ode na kraju big wina, a
 * ne da presence jedan po jedan tier."
 *
 * Trace: tier-promotion events from skip request → onBigWinTierEnd. There
 * must be ZERO new onBigWinTierEntered events with intermediate tiers
 * after the skip — only the exit of current tier + the end emit.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5217;
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

    // Start tier 5 compound walkthrough
    await page.evaluate(() => {
      window.__SKIP_TRACE__ = { events: [] };
      const evs = ['onBigWinTierEntered', 'onBigWinTierExited', 'onBigWinTierEnd', 'onSkipRequested'];
      if (window.HookBus) evs.forEach(n =>
        window.HookBus.on(n, p => window.__SKIP_TRACE__.events.push({ n, t: performance.now()|0, ...p })));
      const bet = window.__SLOT_BET__ || 1;
      window.bigWinTierEnter(5, 1500);
    });

    // Wait ~5 seconds → tier 2 active (tier 1 visible 0-4s, tier 2 visible 4-8s)
    await page.waitForTimeout(5500);

    const stateAtSkip = await page.evaluate(() => ({
      current: window.BIG_WIN_TIER_STATE?.current,
      walkActive: window.BIG_WIN_TIER_STATE?.walkActive,
      finalTier: window.BIG_WIN_TIER_STATE?.finalTier,
      bannerTier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier'),
      amountText: document.querySelector('.big-win-tier-amount')?.textContent,
    }));

    // Mark skip request timestamp + sample DOM after skip
    const skipResult = await page.evaluate(async () => {
      const skipT0 = performance.now() | 0;
      window.__SKIP_T0__ = skipT0;
      // Fire skip via HookBus (same path as spinControl click would take)
      window.HookBus.emit('onSkipRequested', { phase: 'bigWinTier', source: 'probe' });
      const samples = [];
      const interval = setInterval(() => {
        const banner = document.querySelector('.big-win-tier-banner');
        samples.push({
          t: (performance.now()|0),
          dt: (performance.now()|0) - skipT0,
          dataTier: banner?.getAttribute('data-tier'),
          dataShow: banner?.getAttribute('data-show'),
          amount: document.querySelector('.big-win-tier-amount')?.textContent,
          stateCurrent: window.BIG_WIN_TIER_STATE?.current,
        });
      }, 50);
      await new Promise(r => setTimeout(r, 1200));
      clearInterval(interval);
      return { skipT0, samples };
    });

    const trace = await page.evaluate(() => window.__SKIP_TRACE__);
    const allEntered = trace.events.filter(e => e.n === 'onBigWinTierEntered');
    const allExited  = trace.events.filter(e => e.n === 'onBigWinTierExited');
    const allEnd     = trace.events.filter(e => e.n === 'onBigWinTierEnd');

    // Events AFTER the skip
    const skipT0 = skipResult.skipT0;
    const enteredAfterSkip = allEntered.filter(e => e.t >= skipT0);
    const exitedAfterSkip  = allExited.filter(e => e.t >= skipT0);
    const endAfterSkip     = allEnd.filter(e => e.t >= skipT0);

    // First sample after skip — what does the player SEE first?
    const firstFrame = skipResult.samples.find(s => s.dt >= 0);
    // Within 100 ms of skip — must already be at finalTier
    const within100ms = skipResult.samples.find(s => s.dt >= 50 && s.dt <= 120);

    const checks = [
      ['skip fired during tier 2',          stateAtSkip.current === 2 || stateAtSkip.current === 3],
      ['walkActive=true at skip',           stateAtSkip.walkActive === true],
      ['0 NEW onBigWinTierEntered after skip', enteredAfterSkip.length === 0],
      ['exactly 1 onBigWinTierExited (skipped reason)', exitedAfterSkip.length === 1 && exitedAfterSkip[0].reason === 'skipped'],
      ['exactly 1 onBigWinTierEnd (skipped)', endAfterSkip.length === 1 && endAfterSkip[0].reason === 'skipped'],
      ['onBigWinTierEnd carries finalTier=5', endAfterSkip[0]?.tier === 5],
      ['onBigWinTierEnd carries finalX=1500', endAfterSkip[0]?.x === 1500],
      ['within 100ms: data-tier=5',         within100ms?.dataTier === '5'],
      ['within 100ms: amount shows 1500.00', within100ms?.amount?.includes('1500.00')],
      ['within 100ms: state.current=5',     within100ms?.stateCurrent === 5],
      ['no console / page errors',          errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, stateAtSkip, enteredAfterSkipTiers: enteredAfterSkip.map(e => e.tier), exitedAfterSkipReason: exitedAfterSkip.map(e => ({tier:e.tier, reason:e.reason})), endAfterSkip, firstFrame, within100ms, samples: skipResult.samples.slice(0, 8), checks, pass, fail, errors });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ BW SKIP PROBE — must jump to climax, NOT walk tiers ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  state at skip: current=${r.stateAtSkip.current}, banner data-tier=${r.stateAtSkip.bannerTier}, amount="${r.stateAtSkip.amountText}"`);
  console.log(`  ENTERED tiers AFTER skip: ${JSON.stringify(r.enteredAfterSkipTiers)} (must be empty)`);
  console.log(`  EXITED  AFTER skip: ${JSON.stringify(r.exitedAfterSkipReason)}`);
  console.log(`  END     AFTER skip: ${JSON.stringify(r.endAfterSkip.map(e => ({tier:e.tier, x:e.x, reason:e.reason})))}`);
  console.log(`  first 8 samples after skip:`);
  for (const s of r.samples) console.log(`    +${s.dt}ms  tier=${s.dataTier} show=${s.dataShow} amount="${s.amount}" state=${s.stateCurrent}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  console.log(`  checks:`);
  for (const [l, ok] of r.checks) console.log(`    ${ok ? '✓' : '✗'} ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
