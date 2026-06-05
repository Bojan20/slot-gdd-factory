#!/usr/bin/env node
/**
 * BW button click probe — emuluje real Boki klikove na BW dugme i prati
 * šta se TAČNO dešava: spin -> winPresentation -> bigWinTier walkthrough.
 *
 * 3 scenarija:
 *   1. rectangular dist (default BIGWINTIER1..5 labele)
 *   2. wrath-of-olympus dist
 *   3. gates-of-olympus-1000 dist
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5195;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular', path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
  { name: 'gates-of-olympus-1000', path: '/dist/gates-of-olympus-1000.html' },
];

const out = [];

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const events = [];
    page.on('pageerror', e => consoleErrors.push('PAGE_ERR ' + e.message.slice(0, 240)));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('CONSOLE_ERR ' + m.text().slice(0, 240)); });

    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Wire trace listeners
    await page.evaluate(() => {
      window.__BWT__ = { events: [], samples: [] };
      const ev = ['preSpin','postSpin','onWinPresentationStart','onWinPresentationEnd',
                  'onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd'];
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        ev.forEach(name => window.HookBus.on(name, p => {
          window.__BWT__.events.push({ name, t: (performance.now()|0), ...p });
        }));
      }
      window.__BWT__.sampler = setInterval(() => {
        const amt = document.querySelector('.big-win-tier-amount');
        const banner = document.querySelector('.big-win-tier-banner');
        window.__BWT__.samples.push({
          t: (performance.now()|0),
          award: window.__WIN_AWARD__,
          forceFlag: window.__FORCE_BIG_WIN_TIER__,
          count: amt ? Number(amt.getAttribute('data-count') || 0) : null,
          tier: banner ? Number(banner.getAttribute('data-tier') || 0) : null,
          show: banner ? banner.getAttribute('data-show') : null,
          nodes: document.querySelectorAll('.big-win-tier-banner').length,
        });
      }, 250);
    });

    // Read BW button state before click
    const before = await page.evaluate(() => {
      const bw = document.getElementById('devBwBtn');
      return {
        bwExists: !!bw,
        bwDisabled: bw ? bw.disabled : null,
        bigWinTierState: window.BIG_WIN_TIER_STATE,
        slotBet: window.__SLOT_BET__,
        fsmPhase: (typeof FSM !== 'undefined') ? FSM.phase : (window.FSM?.phase),
      };
    });

    // CLICK BW
    const clickResult = await page.evaluate(() => {
      const bw = document.getElementById('devBwBtn');
      if (!bw) return { clicked: false, reason: 'no-button' };
      if (bw.disabled) return { clicked: false, reason: 'disabled' };
      bw.click();
      return { clicked: true };
    });

    // Wait long enough for FULL compound walkthrough — 5×4000 + endHold 4000 + fade 300 = 24.3s
    // Plus spin time (~3s) + winPresentation cycle (~1-2s)
    await page.waitForTimeout(30000);

    const trace = await page.evaluate(() => {
      clearInterval(window.__BWT__.sampler);
      return window.__BWT__;
    });

    const entered = trace.events.filter(e => e.name === 'onBigWinTierEntered');
    const exited = trace.events.filter(e => e.name === 'onBigWinTierExited');
    const ended = trace.events.filter(e => e.name === 'onBigWinTierEnd');
    const winStart = trace.events.filter(e => e.name === 'onWinPresentationStart');
    const winEnd = trace.events.filter(e => e.name === 'onWinPresentationEnd');
    const preSpin = trace.events.filter(e => e.name === 'preSpin');
    const postSpin = trace.events.filter(e => e.name === 'postSpin');
    const maxNodes = trace.samples.reduce((m, s) => Math.max(m, s.nodes || 0), 0);
    const maxCount = trace.samples.reduce((m, s) => Math.max(m, s.count || 0), 0);
    const tiersReached = [...new Set(entered.map(e => e.tier))];

    const checks = [
      ['BW button exists', before.bwExists],
      ['BW button initially enabled', before.bwDisabled === false],
      ['click landed', clickResult.clicked],
      ['preSpin emitted (real spin)', preSpin.length >= 1],
      ['postSpin emitted', postSpin.length >= 1],
      ['onWinPresentationStart emitted', winStart.length >= 1],
      ['onWinPresentationEnd emitted', winEnd.length >= 1],
      ['5 onBigWinTierEntered events', entered.length === 5],
      ['tiers 1→5', JSON.stringify(tiersReached) === '[1,2,3,4,5]'],
      ['5 onBigWinTierExited events', exited.length === 5],
      ['1 onBigWinTierEnd event', ended.length === 1],
      ['onBigWinTierEnd reason=natural', ended[0]?.reason === 'natural'],
      ['onBigWinTierEnd finalTier=5', ended[0]?.tier === 5],
      ['max simultaneous banners ≤ 1', maxNodes <= 1],
      ['counter reached high value (≥1000)', maxCount >= 1000],
      ['no console / page errors', consoleErrors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, before, clickResult, entered: entered.length, exited: exited.length, ended: ended.length, winStart: winStart.length, winEnd: winEnd.length, preSpin: preSpin.length, postSpin: postSpin.length, maxNodes, maxCount, tiersReached, errors: consoleErrors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

console.log('\n══════════════ BW CLICK PROBE RESULTS ══════════════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  before: bwExists=${r.before.bwExists}, bwDisabled=${r.before.bwDisabled}, bet=${r.before.slotBet}, phase=${r.before.fsmPhase}`);
  console.log(`  click: ${JSON.stringify(r.clickResult)}`);
  console.log(`  events: preSpin=${r.preSpin}, postSpin=${r.postSpin}, winStart=${r.winStart}, winEnd=${r.winEnd}, entered=${r.entered}, exited=${r.exited}, ended=${r.ended}`);
  console.log(`  tiers reached: ${JSON.stringify(r.tiersReached)}`);
  console.log(`  max counter value: ${r.maxCount}, max simultaneous nodes: ${r.maxNodes}`);
  if (r.errors.length) {
    console.log(`  ERRORS:`);
    r.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
  }
  console.log(`  checks: ${r.pass}/${r.checks.length} pass`);
  for (const [label, ok] of r.checks) {
    if (!ok) console.log(`    ✗ ${label}`);
  }
}
const totalPass = out.reduce((s, r) => s + r.pass, 0);
const totalFail = out.reduce((s, r) => s + r.fail, 0);
console.log(`\nTOTAL: ${totalPass}/${totalPass + totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
