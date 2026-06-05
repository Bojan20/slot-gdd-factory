#!/usr/bin/env node
/**
 * winRollup live probe — verifikuje H5.8 base-game counter:
 *   1. Idle (no win): banner data-show="false", invisible to player
 *   2. Regular win (ratio < bigWinTriggerRatio):
 *      - Counter rams 0 → award digit-by-digit
 *      - Final text == _fmtMoney(award)
 *      - data-show="true" during + after rollup
 *      - is-celebrate class added when ratio >= 1
 *   3. Big win (ratio >= bigWinTriggerRatio):
 *      - Counter STAYS hidden (suppressed)
 *      - bigWinTier overlay takes the screen
 *   4. preSpin: counter clears, hides
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5215;
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
    page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0, 220)));
    page.on('console', m => { if (m.type() === 'error') errors.push('CON ' + m.text().slice(0, 220)); });
    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // ── 1. IDLE state (no win) ─────────────────────────────────────
    const idle = await page.evaluate(() => {
      const banner = document.getElementById('winRollupBanner');
      const amount = document.getElementById('winRollupAmount');
      return {
        bannerExists: !!banner,
        amountExists: !!amount,
        bannerShow:   banner?.getAttribute('data-show'),
        amountText:   amount?.textContent,
        amountDataCount: amount?.getAttribute('data-count'),
        hasCelebrate: !!banner?.classList?.contains('is-celebrate'),
        bet: window.__SLOT_BET__,
      };
    });

    // ── 2. REGULAR WIN — programmatic dispatch (bypass spin entirely) ──
    // Simulate a real win at 3× bet (well below default 10× big-win trigger)
    const regular = await page.evaluate(async () => {
      const bet = window.__SLOT_BET__ || 1;
      const award = 3 * bet;
      window.__WIN_AWARD__ = award;
      if (window.HookBus?.emit) window.HookBus.emit('onWinPresentationStart', { award, eventCount: 1 });
      // Sample during rollup
      const samples = [];
      const sampleTick = setInterval(() => {
        const a = document.getElementById('winRollupAmount');
        const b = document.getElementById('winRollupBanner');
        samples.push({
          text: a?.textContent,
          dataCount: Number(a?.getAttribute('data-count')||0),
          show: b?.getAttribute('data-show'),
          celebrate: !!b?.classList?.contains('is-celebrate'),
        });
      }, 50);
      await new Promise(r => setTimeout(r, 800));
      clearInterval(sampleTick);
      // Final state
      const a = document.getElementById('winRollupAmount');
      const b = document.getElementById('winRollupBanner');
      return {
        award,
        samples,
        finalText: a?.textContent,
        finalShow: b?.getAttribute('data-show'),
        finalCelebrate: !!b?.classList?.contains('is-celebrate'),
        finalDataCount: Number(a?.getAttribute('data-count')||0),
      };
    });

    // ── 3. BIG WIN — counter must suppress ─────────────────────────
    const bigWin = await page.evaluate(async () => {
      // Clear first
      if (window.winRollupClear) window.winRollupClear();
      await new Promise(r => setTimeout(r, 100));
      const bet = window.__SLOT_BET__ || 1;
      const award = 50 * bet;     // 50× = well above default 10× trigger
      window.__WIN_AWARD__ = award;
      if (window.HookBus?.emit) window.HookBus.emit('onWinPresentationStart', { award, eventCount: 1 });
      await new Promise(r => setTimeout(r, 300));
      const a = document.getElementById('winRollupAmount');
      const b = document.getElementById('winRollupBanner');
      return {
        award,
        showAfter: b?.getAttribute('data-show'),
        suppressed: window.WIN_ROLLUP_STATE?.suppressed,
        active:     window.WIN_ROLLUP_STATE?.active,
      };
    });

    // ── 4. preSpin clears ──────────────────────────────────────────
    const preSpinReset = await page.evaluate(async () => {
      // Set up a visible state first
      const bet = window.__SLOT_BET__ || 1;
      window.winRollupShow?.(2 * bet);
      await new Promise(r => setTimeout(r, 200));
      const beforeShow = document.getElementById('winRollupBanner')?.getAttribute('data-show');
      // Now fire preSpin
      if (window.HookBus?.emit) window.HookBus.emit('preSpin', { spinId: 'test' });
      await new Promise(r => setTimeout(r, 100));
      const a = document.getElementById('winRollupAmount');
      const b = document.getElementById('winRollupBanner');
      return {
        beforeShow,
        afterShow: b?.getAttribute('data-show'),
        amountText: a?.textContent,
        amountDataCount: Number(a?.getAttribute('data-count')||0),
        active: window.WIN_ROLLUP_STATE?.active,
      };
    });

    // ── 5. Layout position — must be ABOVE the hub ────────────────
    const layout = await page.evaluate(() => {
      const host = document.getElementById('winRollupHost');
      const hub  = document.querySelector('.hub');
      if (!host || !hub) return null;
      const hostR = host.getBoundingClientRect();
      const hubR  = hub.getBoundingClientRect();
      return {
        hostY: hostR.y | 0,
        hubY:  hubR.y  | 0,
        hostAboveHub: hostR.y < hubR.y,
        // Visual sanity: host horizontally centered relative to viewport
        hostCx: ((hostR.x + hostR.width / 2) | 0),
        viewportCx: (window.innerWidth / 2) | 0,
        hostBet: window.__SLOT_BET__,
      };
    });

    const checks = [
      ['1. Banner element exists',           idle.bannerExists],
      ['1. Amount element exists',           idle.amountExists],
      ['1. Idle: data-show="false"',         idle.bannerShow === 'false'],
      ['1. Idle: no is-celebrate class',     !idle.hasCelebrate],
      ['2. Regular win: data-show="true"',   regular.finalShow === 'true'],
      ['2. Regular win: final text formatted', regular.finalText && /[€$£¥USD]/.test(regular.finalText) && regular.finalText.includes((regular.award).toFixed(2))],
      ['2. Regular win: data-count == award', Math.abs(regular.finalDataCount - regular.award) < 0.01],
      ['2. Regular win (3×bet): is-celebrate set', regular.finalCelebrate === true],
      ['2. Rollup actually ramped (≥3 distinct values)',
        new Set(regular.samples.filter(s => s.text).map(s => s.text)).size >= 3],
      ['3. Big win: data-show="false"',      bigWin.showAfter === 'false'],
      ['3. Big win: state.suppressed = true', bigWin.suppressed === true],
      ['3. Big win: state.active = false',   bigWin.active === false],
      ['4. preSpin: was visible before',     preSpinReset.beforeShow === 'true'],
      ['4. preSpin: hidden after',           preSpinReset.afterShow === 'false'],
      ['4. preSpin: amount reset to 0.00',   preSpinReset.amountText && preSpinReset.amountText.includes('0.00')],
      ['4. preSpin: data-count = 0',         preSpinReset.amountDataCount === 0],
      ['5. Layout: host above hub',          layout && layout.hostAboveHub],
      ['5. Layout: host horizontally centered (±20px of viewport center)',
        layout && Math.abs(layout.hostCx - layout.viewportCx) <= 20],
      ['no console / page errors',           errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, idle, regular, bigWin, preSpinReset, layout, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ WIN-ROLLUP LIVE PROBE ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  idle banner show=${r.idle.bannerShow}, text="${r.idle.amountText}"`);
  console.log(`  regular: award=${r.regular.award}, finalText="${r.regular.finalText}", celebrate=${r.regular.finalCelebrate}, samples=${r.regular.samples.length}`);
  console.log(`  bigwin:  award=${r.bigWin.award}, showAfter=${r.bigWin.showAfter}, suppressed=${r.bigWin.suppressed}`);
  console.log(`  preSpin: beforeShow=${r.preSpinReset.beforeShow}, afterShow=${r.preSpinReset.afterShow}`);
  console.log(`  layout: hostY=${r.layout?.hostY}, hubY=${r.layout?.hubY}, above=${r.layout?.hostAboveHub}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
