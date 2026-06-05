#!/usr/bin/env node
/**
 * BW money-counter probe — verifikuje H5.5 fix:
 *   • counter NEMA "×" prefiks, prikazuje money (€N.NN)
 *   • na kraju climax-a, counter pokazuje EXACT win amount
 *   • walkthrough kroz tier 1→5 sa money ramping linearly
 *   • format = same kao balanceHud (currency + position inheritance)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5197;
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
    const errors = [];
    page.on('pageerror', e => errors.push('PAGE_ERR ' + e.message.slice(0, 220)));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE_ERR ' + m.text().slice(0, 220)); });
    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    // Wait until spin button is enabled (state machine settles into BASE)
    await page.waitForFunction(() => {
      const sb = document.getElementById('spinBtn') || document.querySelector('[data-spin-btn]');
      const bw = document.getElementById('devBwBtn');
      return bw && !bw.disabled && sb && !sb.disabled;
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);

    // Pre-state
    const pre = await page.evaluate(() => ({
      bet: window.__SLOT_BET__,
      balance: window.__SLOT_BALANCE__,
      bwEnabled: !!window.BIG_WIN_TIER_STATE?.enabled,
      bwBtn: !!document.getElementById('devBwBtn'),
      hudWin: document.getElementById('balanceHudWinValue')?.textContent || null,
    }));

    // Sampler
    await page.evaluate(() => {
      window.__BWM__ = { events: [], samples: [], finalText: null };
      const ev = ['onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd','onWinPresentationEnd'];
      if (window.HookBus) ev.forEach(n => window.HookBus.on(n, p => window.__BWM__.events.push({ n, t: performance.now()|0, ...p })));
      window.__BWM__.sampler = setInterval(() => {
        const amt = document.querySelector('.big-win-tier-amount');
        window.__BWM__.samples.push({
          t: performance.now()|0,
          text: amt ? amt.textContent : null,
          dataCount: amt ? Number(amt.getAttribute('data-count')||0) : null,
          tier: document.querySelector('.big-win-tier-banner')?.getAttribute('data-tier') || null,
          show: document.querySelector('.big-win-tier-banner')?.getAttribute('data-show') || null,
        });
      }, 300);
    });

    // Click BW
    await page.evaluate(() => document.getElementById('devBwBtn')?.click());

    // Wait for full walkthrough: spin(~3s) + 5×4s tiers + 4s endHold + 0.3s fade ≈ 28s
    /* H5.19 — GoO has a long pre-presentation tumble chain (~17s),
     * so the full sequence (spin + tumble + 5×4s walkthrough + 4s endHold
     * + fade) lands near ~50s. Allow margin. */
    await page.waitForTimeout(55000);

    const trace = await page.evaluate(() => {
      clearInterval(window.__BWM__.sampler);
      // Last non-null text seen during sampling = the text the player saw at climax
      const lastSeen = [...window.__BWM__.samples].reverse().find(s => s.text != null);
      window.__BWM__.finalText = lastSeen ? lastSeen.text : null;
      window.__BWM__.finalDataCount = lastSeen ? lastSeen.dataCount : null;
      window.__BWM__.winAward = window.__WIN_AWARD__ || window.__BWM__.events.find(e => e.n === 'onBigWinTierEnd')?.x || null;
      return window.__BWM__;
    });

    const entered = trace.events.filter(e => e.n === 'onBigWinTierEntered');
    const ended = trace.events.filter(e => e.n === 'onBigWinTierEnd');
    const winEnd = trace.events.filter(e => e.n === 'onWinPresentationEnd');
    const moneyTexts = trace.samples.filter(s => s.text).map(s => s.text);
    const xCount = moneyTexts.filter(t => t.startsWith('×') || t.startsWith('x')).length;
    const currencyHits = moneyTexts.filter(t => /[€$£¥₹]/.test(t)).length;
    const maxCount = trace.samples.reduce((m, s) => Math.max(m, s.dataCount || 0), 0);

    const checks = [
      ['BW enabled + bet known', pre.bwEnabled && pre.bet > 0],
      ['preSpin → onWinPresentationEnd fired', winEnd.length >= 1],
      ['5 tiers entered', entered.length === 5],
      ['1 onBigWinTierEnd', ended.length === 1],
      ['onBigWinTierEnd x = absolute award', ended[0] && Math.abs(ended[0].x - (trace.winAward || 0)) < 0.001],
      ['NO "×" prefix in any counter text', xCount === 0],
      ['currency symbol present in counter', currencyHits >= 1],
      ['climax-frame counter text === currency-formatted award',
        trace.finalText !== null && trace.finalText.includes((trace.winAward || 0).toFixed(2))],
      ['climax-frame counter captured before cleanup', trace.finalText !== null],
      ['counter value reached award', Math.abs(maxCount - (trace.winAward || 0)) <= (trace.winAward || 0) * 0.02],
      ['no console / page errors', errors.length === 0],
    ];
    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, pre, winAward: trace.winAward, finalText: trace.finalText, sampleTexts: [...new Set(moneyTexts)].slice(0, 6), xCount, currencyHits, entered: entered.length, ended: ended.length, endX: ended[0]?.x, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

console.log('\n════ BW MONEY-COUNTER PROBE ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  bet=${r.pre.bet}, balance=${r.pre.balance}, winAward=${r.winAward}`);
  console.log(`  finalText: "${r.finalText}"`);
  console.log(`  unique counter texts (sample): ${r.sampleTexts.map(t => JSON.stringify(t)).join(' ')}`);
  console.log(`  × prefix occurrences: ${r.xCount} (must be 0)`);
  console.log(`  currency symbol occurrences: ${r.currencyHits} (must ≥1)`);
  console.log(`  events: entered=${r.entered}, end=${r.ended}, endX=${r.endX}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
}
const tp = out.reduce((s,r) => s+r.pass, 0);
const tf = out.reduce((s,r) => s+r.fail, 0);
console.log(`\nTOTAL: ${tp}/${tp+tf} pass`);
process.exit(tf === 0 ? 0 : 1);
