#!/usr/bin/env node
/**
 * BW tier-cadence probe — verifikuje H5.6: tier promotion je TIME-BASED,
 * 4 s per tier, nezavisno od award magnitude. BW dugme i prirodni big-win
 * moraju da imaju IDENTIČAN ritam tier-ova.
 *
 * 2 scenarija po igri:
 *   1. BW button click (forces tier 5, award = 1.5 × top threshold × bet)
 *   2. Programmatic bigWinTierEnter(5, award=10*bet) — simulira "tighter"
 *      win koji bi pre fixa skratio walkthrough na ~2s
 *
 * Validacija: u obe verzije, onBigWinTierEntered timestamp-i 1→5 moraju
 * biti uniformno na ~4000 ms intervalima.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5199;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular', path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
  { name: 'gates-of-olympus-1000', path: '/dist/gates-of-olympus-1000.html' },
];

const TARGET = 4000;   // expected per-tier interval (DURATIONS default)
const TOL    = 250;    // tolerance ms (event-loop + rAF jitter)

const out = [];

async function runScenario(page, scenario, label) {
  await page.evaluate(() => {
    window.__C__ = { events: [] };
    if (window.HookBus) ['onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd'].forEach(n =>
      window.HookBus.on(n, p => window.__C__.events.push({ n, t: performance.now()|0, ...p })));
  });
  if (scenario === 'bw-click') {
    // Wait for FSM=BASE + BW button + spin button enabled (some demos have
    // longer intro / FS-CTA initialization than others).
    await page.waitForFunction(() => {
      const bw = document.getElementById('devBwBtn');
      const sb = document.getElementById('spinBtn');
      const phase = (typeof FSM !== 'undefined' && FSM?.phase) || window.FSM?.phase;
      return bw && !bw.disabled && sb && !sb.disabled && (!phase || phase === 'BASE');
    }, { timeout: 10000 }).catch(()=>{});
    await page.waitForTimeout(200);
    // Retry up to 3 times in case state momentarily leaves BASE during click
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      const result = await page.evaluate(() => {
        const bw = document.getElementById('devBwBtn');
        if (!bw || bw.disabled) return false;
        bw.click();
        return true;
      });
      // Wait briefly to see if click was accepted
      await page.waitForTimeout(800);
      const fired = await page.evaluate(() =>
        window.__C__?.events?.some(e => e.n === 'onBigWinTierEntered') ||
        !!window.BIG_WIN_TIER_STATE?.walkActive
      );
      if (fired) { clicked = true; break; }
      if (result) await page.waitForTimeout(600);
    }
  } else if (scenario === 'tight-prog') {
    await page.evaluate(() => {
      const bet = window.__SLOT_BET__ || 1;
      // tight award: just barely past tier-5 threshold = THRESHOLDS[4] * bet
      const tight = (window.BIG_WIN_TIER_STATE?.thresholds?.[4] || 1000) * bet;
      window.bigWinTierEnter(5, tight);
    });
  }
  await page.waitForTimeout(30000);
  const trace = await page.evaluate(() => window.__C__);
  const entered = trace.events.filter(e => e.n === 'onBigWinTierEntered').sort((a,b)=>a.t-b.t);
  const intervals = [];
  for (let i = 1; i < entered.length; i++) intervals.push(entered[i].t - entered[i-1].t);
  const ended = trace.events.find(e => e.n === 'onBigWinTierEnd');
  return { label, scenario, entered: entered.map(e=>e.tier), intervals, ended, eventCount: trace.events.length };
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
    await page.waitForFunction(() => {
      const bw = document.getElementById('devBwBtn');
      return bw && !bw.disabled;
    }, { timeout: 8000 }).catch(()=>{});
    await page.waitForTimeout(500);

    const s1 = await runScenario(page, 'bw-click', d.name);
    // Wait state to settle, reload, then second scenario
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = ctx2.pages()[0] || await ctx2.newPage();
    p2.on('pageerror', e => errors.push('ERR2 ' + e.message.slice(0,200)));
    await p2.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(800);
    const s2 = await runScenario(p2, 'tight-prog', d.name);
    await ctx2.close();

    out.push({ demo: d.name, s1, s2, errors });
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ BW TIER-CADENCE PROBE (TIME-BASED PROMOTION) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  for (const s of [r.s1, r.s2]) {
    console.log(`  scenario: ${s.scenario}`);
    console.log(`    tiers entered: ${JSON.stringify(s.entered)}`);
    console.log(`    intervals between enters (ms): ${JSON.stringify(s.intervals)}`);
    const expectedTiers = '[1,2,3,4,5]';
    const checks = [
      ['5 tiers entered 1→5', JSON.stringify(s.entered) === expectedTiers],
      ['4 intervals (between 5 tiers)', s.intervals.length === 4],
      ...s.intervals.map((v, i) => [`interval ${i+1}→${i+2} ≈ ${TARGET}ms (got ${v})`, Math.abs(v - TARGET) <= TOL]),
      ['onBigWinTierEnd emitted', !!s.ended],
      ['onBigWinTierEnd reason=natural', s.ended?.reason === 'natural'],
    ];
    for (const [l, ok] of checks) {
      console.log(`    ${ok ? '✓' : '✗'} ${l}`);
      if (ok) totalPass++; else totalFail++;
    }
  }
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
