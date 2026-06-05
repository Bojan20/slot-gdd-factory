#!/usr/bin/env node
/**
 * Live verification of Wave H15 — weightedWheelSegments on rectangular dist.
 *
 * Scenario:
 *   1. Open dist/01_rectangular_5x3_playable.html
 *   2. Verify wheelBonus runtime present (window.wbSpin defined)
 *   3. Verify H15 patched wbSpin (window.__origWbSpin preserved,
 *      window.wbSpin replaced, WWS_STATE.patched === true)
 *   4. Force a GRAND-tier win via deterministic Math.random override,
 *      open the wheel, fire wbSpin(), assert emit events + award
 *   5. Force a low-weight credit win (first segment), repeat
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
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
    wbSpinFn:        typeof window.wbSpin,
    wbCloseFn:       typeof window.wbClose,
    origWbSpin:      typeof window.__origWbSpin,
    wbSegments:      Array.isArray(window.WB_SEGMENTS) ? window.WB_SEGMENTS.length : null,
    wwsState:        !!window.WWS_STATE,
    wwsPatched:      window.WWS_STATE && window.WWS_STATE.patched,
    wwsEnabled:      window.WWS_STATE && window.WWS_STATE.enabled,
    weightsLen:      window.WWS_STATE && Array.isArray(window.WWS_STATE.weights) ? window.WWS_STATE.weights.length : null,
    jackpotMapLen:   window.WWS_STATE && Array.isArray(window.WWS_STATE.jackpotMap) ? window.WWS_STATE.jackpotMap.length : null,
    drawHelper:      typeof window.wwsDraw,
  }));
  console.log('Presence check:', presence);

  if (presence.wbSpinFn !== 'function' || !presence.wwsPatched) {
    console.error('❌ H15 patch not active — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1 — GRAND tier hit (Math.random=0.99 → last segment) ──
  console.log('\n— SCENARIO 1: GRAND tier hit (force Math.random=0.99) —');
  const r1 = await page.evaluate(async () => {
    const trace = { chosen: null, jackpot: null, collected: null };
    window.HookBus.on('onWheelSegmentChosen',  p => trace.chosen = p);
    window.HookBus.on('onWheelJackpotHit',     p => trace.jackpot = p);
    window.HookBus.on('onWheelAwardCollected', p => trace.collected = p);

    /* Override Math.random to force last index */
    const origRandom = Math.random;
    Math.random = () => 0.999;
    /* __SLOT_BET__ may not be set yet on a fresh load — set it */
    window.__SLOT_BET__ = 2;
    window.wbOpen();
    await new Promise(r => setTimeout(r, 100));
    window.wbSpin();
    /* Wait for animation completion (WB_DUR=3800 + 80 + margin) */
    await new Promise(r => setTimeout(r, 4200));
    const segState = {
      lastResult: window.WWS_STATE.lastResult ? { ...window.WWS_STATE.lastResult } : null,
      resultText: document.getElementById('wbResult') ? document.getElementById('wbResult').textContent : null,
      resultIsJackpot: document.getElementById('wbResult') && document.getElementById('wbResult').getAttribute('data-jackpot') === 'true',
    };
    window.wbClose();
    await new Promise(r => setTimeout(r, 100));
    /* Restore */
    Math.random = origRandom;
    return { trace, segState, winAward: window.__WIN_AWARD__ };
  });
  console.log(`  chosen: ${JSON.stringify(r1.trace.chosen)}`);
  console.log(`  jackpot: ${JSON.stringify(r1.trace.jackpot)}`);
  console.log(`  collected: ${JSON.stringify(r1.trace.collected)}`);
  console.log(`  result text: "${r1.segState.resultText}"  jackpot styled: ${r1.segState.resultIsJackpot}`);
  console.log(`  __WIN_AWARD__: ${r1.winAward}`);

  // ── SCENARIO 2 — Credit segment hit (Math.random=0.001 → first segment) ──
  console.log('\n— SCENARIO 2: Credit segment hit (force Math.random=0.001) —');
  const r2 = await page.evaluate(async () => {
    const trace = { chosen: null, jackpot: null, collected: null };
    window.HookBus.on('onWheelSegmentChosen',  p => trace.chosen = p);
    window.HookBus.on('onWheelJackpotHit',     p => trace.jackpot = p);
    window.HookBus.on('onWheelAwardCollected', p => trace.collected = p);
    const origRandom = Math.random;
    Math.random = () => 0.001;
    /* Reset prior state */
    window.WWS_STATE.lastResult = null;
    window.__WIN_AWARD__ = 0;
    window.wbOpen();
    await new Promise(r => setTimeout(r, 100));
    window.wbSpin();
    await new Promise(r => setTimeout(r, 4200));
    const seg = window.WWS_STATE.lastResult ? { ...window.WWS_STATE.lastResult } : null;
    window.wbClose();
    await new Promise(r => setTimeout(r, 100));
    Math.random = origRandom;
    return { trace, seg, winAward: window.__WIN_AWARD__ };
  });
  console.log(`  chosen: ${JSON.stringify(r2.trace.chosen)}`);
  console.log(`  jackpot: ${JSON.stringify(r2.trace.jackpot)}`);  /* should be null */
  console.log(`  collected: ${JSON.stringify(r2.trace.collected)}`);
  console.log(`  __WIN_AWARD__: ${r2.winAward}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['wbSpin function present (wheelBonus active)',                  presence.wbSpinFn === 'function'],
    ['__origWbSpin preserved (extension patched)',                   presence.origWbSpin === 'function'],
    ['WB_SEGMENTS length === 8',                                      presence.wbSegments === 8],
    ['WWS_STATE.enabled === true',                                    presence.wwsEnabled === true],
    ['WWS_STATE.patched === true',                                    presence.wwsPatched === true],
    ['weights array length === 8',                                    presence.weightsLen === 8],
    ['jackpotMap length === 4 (MINI/MINOR/MAJOR/GRAND)',              presence.jackpotMapLen === 4],
    ['wwsDraw helper exposed',                                        presence.drawHelper === 'function'],
    /* Scenario 1 — GRAND */
    ['S1: onWheelSegmentChosen fired with index=7 (last seg)',        r1.trace.chosen && r1.trace.chosen.index === 7],
    ['S1: chosen.jackpotTier === GRAND',                              r1.trace.chosen && r1.trace.chosen.jackpotTier === 'GRAND'],
    ['S1: chosen.jackpotX === 1000',                                  r1.trace.chosen && r1.trace.chosen.jackpotX === 1000],
    ['S1: onWheelJackpotHit fired (tier=GRAND, x=1000)',              r1.trace.jackpot && r1.trace.jackpot.tier === 'GRAND' && r1.trace.jackpot.x === 1000],
    ['S1: result text mentions GRAND',                                r1.segState.resultText && r1.segState.resultText.includes('GRAND')],
    ['S1: result data-jackpot="true" (CSS pulse engaged)',            r1.segState.resultIsJackpot === true],
    ['S1: onWheelAwardCollected fired isJackpot=true, award=1000',    r1.trace.collected && r1.trace.collected.isJackpot === true && r1.trace.collected.award === 1000],
    ['S1: __WIN_AWARD__ === 1000 × bet(2) = 2000',                    r1.winAward === 2000],
    /* Scenario 2 — credit */
    ['S2: onWheelSegmentChosen fired with index=0',                   r2.trace.chosen && r2.trace.chosen.index === 0],
    ['S2: chosen.jackpotTier undefined (not a jackpot)',              r2.trace.chosen && !r2.trace.chosen.jackpotTier],
    ['S2: onWheelJackpotHit NOT fired',                               r2.trace.jackpot === null],
    ['S2: onWheelAwardCollected isJackpot=false, award=2 (×2 segment)', r2.trace.collected && r2.trace.collected.isJackpot === false && r2.trace.collected.award === 2],
    ['S2: __WIN_AWARD__ === 2 × bet(2) = 4',                         r2.winAward === 4],
    /* No errors */
    ['0 page errors',                                                 errs.length === 0],
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
