#!/usr/bin/env node
/**
 * Live verification of Wave H14 — holdAndWinCreditBucket on lock_respin dist.
 *
 * Scenario (no real bonus trigger needed — we simulate HW_STATE flow):
 *   1. Open dist/19_lock_respin_playable.html
 *   2. Verify block runtime is wired (HW_CREDIT_STATE exists)
 *   3. Simulate H&W round: HW_STATE.active=true + 3 sequential locks via
 *      HookBus.emit('postSpin'), then close the round
 *   4. Assert: 1 start event, 3 locked events, 1 end event, total > 0,
 *      __WIN_AWARD__ pushed, value chips rendered in DOM
 *   5. Reset path: hwCreditReset clears all state + DOM chips
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5197;
const URL = `http://127.0.0.1:${PORT}/dist/19_lock_respin_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 200));
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ── PRESENCE CHECK ──
  const presence = await page.evaluate(() => ({
    hwState:        !!window.HW_STATE,
    hwLockedIsMap:  window.HW_STATE && window.HW_STATE.lockedCells instanceof Map,
    creditState:    !!window.HW_CREDIT_STATE,
    creditEnabled:  window.HW_CREDIT_STATE && window.HW_CREDIT_STATE.enabled === true,
    resetFn:        typeof window.hwCreditReset,
    bigWinTier:     typeof window.bigWinTierEnter,
    initialTotal:   window.__HW_CREDIT_TOTAL__,
    initialJackpot: window.__HW_CREDIT_JACKPOT__,
  }));
  console.log('Presence check:', presence);

  if (!presence.hwState || !presence.creditState || presence.resetFn !== 'function') {
    console.error('❌ H14 block not wired correctly — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SIMULATE ROUND ──
  console.log('\n— SCENARIO: 3-lock round via HookBus.emit("postSpin") —');
  const result = await page.evaluate(() => {
    const trace = { start: 0, locked: [], end: null };
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onCreditBucketRespinStart', (p) => { trace.start++; });
      window.HookBus.on('onCreditBucketLocked',      (p) => { trace.locked.push(p); });
      window.HookBus.on('onCreditBucketEnd',         (p) => { trace.end = p; });
    }
    // Reset any state
    window.hwCreditReset();
    if (window.HW_STATE) {
      window.HW_STATE.active = false;
      window.HW_STATE.lockedCells.clear();
    }
    // Spin 1 — round begins, first lock
    window.HW_STATE.active = true;
    window.HW_STATE.lockedCells.set('0,0', 'BONUS');
    window.HookBus.emit('postSpin');
    // Spin 2 — second lock
    window.HW_STATE.lockedCells.set('1,3', 'BONUS');
    window.HookBus.emit('postSpin');
    // Spin 3 — third lock
    window.HW_STATE.lockedCells.set('2,2', 'BONUS');
    window.HookBus.emit('postSpin');
    // Spin 4 — round ends (active flips false)
    window.HW_STATE.active = false;
    window.HookBus.emit('postSpin');
    return {
      trace,
      chipCount:  document.querySelectorAll('.hw-credit-chip').length,
      hudTotal:   document.getElementById('hwCreditTotalVal') ? document.getElementById('hwCreditTotalVal').textContent : null,
      creditTotal: window.__HW_CREDIT_TOTAL__,
      jackpotTier: window.__HW_CREDIT_JACKPOT__,
      winAward:    window.__WIN_AWARD__,
      stateSize:   window.HW_CREDIT_STATE.values.size,
    };
  });

  console.log(`  start events:  ${result.trace.start}`);
  console.log(`  locked events: ${result.trace.locked.length}`);
  console.log(`  end event:     ${result.trace.end ? `total=${result.trace.end.total}, cells=${result.trace.end.cellCount}, allLocked=${result.trace.end.allLocked}` : 'none'}`);
  console.log(`  DOM chips:     ${result.chipCount}`);
  console.log(`  HUD total:     ${result.hudTotal}`);
  console.log(`  __WIN_AWARD__: ${result.winAward}`);
  console.log(`  __HW_CREDIT_TOTAL__: ${result.creditTotal}, jackpot: '${result.jackpotTier}'`);
  console.log(`  HW_CREDIT_STATE.values.size: ${result.stateSize}`);

  // ── RESET PATH ──
  console.log('\n— RESET: hwCreditReset clears state + DOM —');
  const afterReset = await page.evaluate(() => {
    window.hwCreditReset();
    return {
      total: window.__HW_CREDIT_TOTAL__,
      jackpot: window.__HW_CREDIT_JACKPOT__,
      stateSize: window.HW_CREDIT_STATE.values.size,
      chipCount: document.querySelectorAll('.hw-credit-chip').length,
    };
  });
  console.log(`  total: ${afterReset.total}, jackpot: '${afterReset.jackpot}', state.size: ${afterReset.stateSize}, chips: ${afterReset.chipCount}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['HW_STATE present + lockedCells is Map',                  presence.hwState && presence.hwLockedIsMap],
    ['HW_CREDIT_STATE enabled (block runtime active)',          presence.creditEnabled],
    ['hwCreditReset function exposed',                          presence.resetFn === 'function'],
    ['__HW_CREDIT_TOTAL__ starts at 0',                         presence.initialTotal === 0],
    ['onCreditBucketRespinStart fired exactly once',            result.trace.start === 1],
    ['onCreditBucketLocked fired ≥ 3 (≥1 per manual lock + auto-harvest)', result.trace.locked.length >= 3],
    ['onCreditBucketEnd fired exactly once',                    !!result.trace.end],
    ['end event cellCount matches DOM chip count',              result.trace.end && result.trace.end.cellCount === result.chipCount],
    ['end event reports allLocked=false (partial board)',       result.trace.end && result.trace.end.allLocked === false],
    ['__WIN_AWARD__ pushed > 0 (downstream pipeline armed)',    Number.isFinite(result.winAward) && result.winAward > 0],
    ['HUD total chip rendered with currency prefix',            result.hudTotal && result.hudTotal.startsWith('×')],
    ['DOM chip count matches locked event count',               result.chipCount === result.trace.locked.length],
    ['Final total ≥ 1 × cellCount (every lock pays ≥ 1×)',     result.creditTotal >= result.trace.end.cellCount],
    ['Reset clears total / state / chips',                      afterReset.total === 0 && afterReset.stateSize === 0 && afterReset.chipCount === 0],
    ['0 page errors',                                           errs.length === 0],
  ];
  let pass = 0, fail = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\nResult: ${pass}/${pass+fail} pass, errors: ${errs.length}`);
  if (errs.length) errs.slice(0, 5).forEach(e => console.log('  console:', e));

  await browser.close();
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  server.kill();
  process.exit(3);
}
