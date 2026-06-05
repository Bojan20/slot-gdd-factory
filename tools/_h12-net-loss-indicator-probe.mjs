#!/usr/bin/env node
/**
 * Live verification of Wave H12 — netLossIndicator on rectangular dist.
 *
 * Scenario:
 *   1. Open dist/01_rectangular_5x3_playable.html
 *   2. Verify block runtime is wired (NLI_STATE.enabled, cell mounted)
 *   3. Establish session start via fresh onBalanceChanged init event
 *   4. Simulate sequence of debits/credits; assert net updates, level
 *      transitions trigger onNetThresholdCrossed in correct direction
 *   5. Test nliResetSession clears state
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5200;
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
  await page.waitForTimeout(600);

  // ── PRESENCE CHECK ──
  const presence = await page.evaluate(() => ({
    nliState:     !!window.NLI_STATE,
    nliEnabled:   window.NLI_STATE && window.NLI_STATE.enabled === true,
    nliMounted:   window.NLI_STATE && window.NLI_STATE.mounted === true,
    netCellInDOM: !!document.getElementById('balanceHudNetCol'),
    netValueInDOM: !!document.getElementById('balanceHudNetValue'),
    thresholdsLen: window.NLI_STATE && Array.isArray(window.NLI_STATE.thresholds) ? window.NLI_STATE.thresholds.length : null,
    initialNet:   window.__NET_LOSS__,
    initialLevel: window.__NET_LOSS_LEVEL__,
    resetFn:      typeof window.nliResetSession,
    balanceHud:   !!document.getElementById('balanceHud'),
    netLabel:     (function () {
      var el = document.querySelector('.balance-hud__col--net .balance-hud__label');
      return el ? el.textContent : null;
    })(),
  }));
  console.log('Presence check:', presence);

  if (!presence.nliMounted) {
    console.error('❌ H12 cell not mounted — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1 — establish baseline + drop into CAUTION ──
  console.log('\n— SCENARIO 1: baseline establish + drop to CAUTION (net=-60) —');
  const r1 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onNetThresholdCrossed', p => trace.push(p));
    /* Reset NLI session so we have a fresh anchor */
    window.nliResetSession();
    /* Use balanceHud's debit API so we go through the real chain */
    if (typeof window.balanceSet === 'function') window.balanceSet(1000);
    await new Promise(r => setTimeout(r, 30));
    /* Now reset so sessionStart = 1000 */
    window.nliResetSession();
    /* Lose 60 */
    if (typeof window.balanceDebit === 'function') window.balanceDebit(60);
    await new Promise(r => setTimeout(r, 30));
    const cellSign = document.getElementById('balanceHudNetCol').getAttribute('data-sign');
    const cellLevel = document.getElementById('balanceHudNetCol').getAttribute('data-level');
    const valueText = document.getElementById('balanceHudNetValue').textContent;
    return {
      trace, cellSign, cellLevel, valueText,
      net: window.__NET_LOSS__,
      level: window.__NET_LOSS_LEVEL__,
      sessionStart: window.NLI_STATE.sessionStart,
    };
  });
  console.log(`  trace (${r1.trace.length}):`, JSON.stringify(r1.trace));
  console.log(`  cell sign: ${r1.cellSign}, level: ${r1.cellLevel}, value text: "${r1.valueText}"`);
  console.log(`  __NET_LOSS__: ${r1.net}, __NET_LOSS_LEVEL__: ${r1.level}, sessionStart: ${r1.sessionStart}`);

  // ── SCENARIO 2 — escalate to WARN (net=-200) ──
  console.log('\n— SCENARIO 2: escalate to WARN (net=-200) —');
  const r2 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onNetThresholdCrossed', p => trace.push(p));
    if (typeof window.balanceDebit === 'function') window.balanceDebit(140);
    await new Promise(r => setTimeout(r, 30));
    return {
      trace,
      net: window.__NET_LOSS__,
      level: window.__NET_LOSS_LEVEL__,
      cellLevel: document.getElementById('balanceHudNetCol').getAttribute('data-level'),
    };
  });
  console.log(`  trace:`, JSON.stringify(r2.trace));
  console.log(`  __NET_LOSS__: ${r2.net}, level: ${r2.level}, cell level: ${r2.cellLevel}`);

  // ── SCENARIO 3 — recover to back to CAUTION (net=-100) ──
  console.log('\n— SCENARIO 3: recover with credit (net=-100) —');
  const r3 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onNetThresholdCrossed', p => trace.push(p));
    if (typeof window.balanceCredit === 'function') window.balanceCredit(100);
    await new Promise(r => setTimeout(r, 30));
    return {
      trace,
      net: window.__NET_LOSS__,
      level: window.__NET_LOSS_LEVEL__,
      cellSign: document.getElementById('balanceHudNetCol').getAttribute('data-sign'),
    };
  });
  console.log(`  trace:`, JSON.stringify(r3.trace));
  console.log(`  net: ${r3.net}, level: ${r3.level}, cell sign: ${r3.cellSign}`);

  // ── SCENARIO 4 — deep ALERT (net <= -500) ──
  console.log('\n— SCENARIO 4: deep ALERT (net=-650) —');
  const r4 = await page.evaluate(async () => {
    const trace = [];
    window.HookBus.on('onNetThresholdCrossed', p => trace.push(p));
    if (typeof window.balanceDebit === 'function') window.balanceDebit(550);   /* net was -100, now -650 */
    await new Promise(r => setTimeout(r, 30));
    return {
      trace,
      net: window.__NET_LOSS__,
      level: window.__NET_LOSS_LEVEL__,
      cellLevel: document.getElementById('balanceHudNetCol').getAttribute('data-level'),
    };
  });
  console.log(`  trace:`, JSON.stringify(r4.trace));
  console.log(`  net: ${r4.net}, level: ${r4.level}, cell level: ${r4.cellLevel}`);

  // ── SCENARIO 5 — reset clears state ──
  console.log('\n— SCENARIO 5: nliResetSession clears state —');
  const r5 = await page.evaluate(async () => {
    window.nliResetSession();
    await new Promise(r => setTimeout(r, 30));
    return {
      net: window.__NET_LOSS__,
      level: window.__NET_LOSS_LEVEL__,
      cellSign: document.getElementById('balanceHudNetCol').getAttribute('data-sign'),
    };
  });
  console.log(`  net: ${r5.net}, level: ${r5.level}, cell sign: ${r5.cellSign}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['#balanceHud present (host HUD)',                        presence.balanceHud],
    ['NLI_STATE present + enabled + mounted',                  presence.nliState && presence.nliEnabled && presence.nliMounted],
    ['Net cell + value mounted in DOM',                        presence.netCellInDOM && presence.netValueInDOM],
    ['"Net" label rendered',                                    presence.netLabel === 'Net'],
    ['thresholds length === 3 (default loss ladder)',          presence.thresholdsLen === 3],
    ['__NET_LOSS__ initial = 0',                               presence.initialNet === 0],
    ['__NET_LOSS_LEVEL__ initial = ""',                        presence.initialLevel === ''],
    ['nliResetSession function exposed',                       presence.resetFn === 'function'],
    /* S1 baseline + caution */
    ['S1: net = -60 after 60 debit',                           r1.net === -60],
    ['S1: level === caution',                                  r1.level === 'caution'],
    ['S1: cell sign === neg, level data attr === caution',     r1.cellSign === 'neg' && r1.cellLevel === 'caution'],
    ['S1: value text shows -€60.00 (currency from balanceHud)', /-/.test(r1.valueText) && /60/.test(r1.valueText)],
    ['S1: onNetThresholdCrossed fired (to=caution)',           r1.trace.length >= 1 && r1.trace[r1.trace.length-1].to === 'caution'],
    /* S2 escalate */
    ['S2: net = -200 after 140 more debit',                    r2.net === -200],
    ['S2: level escalated to warn',                            r2.level === 'warn'],
    ['S2: emit from=caution to=warn direction=losing',
      r2.trace.length === 1 &&
      r2.trace[0].from === 'caution' && r2.trace[0].to === 'warn' &&
      r2.trace[0].direction === 'losing'],
    /* S3 recover */
    ['S3: net back to -100',                                   r3.net === -100],
    ['S3: level back to caution',                              r3.level === 'caution'],
    ['S3: emit direction=recovering',
      r3.trace.length === 1 && r3.trace[0].direction === 'recovering'],
    /* S4 alert */
    ['S4: net = -650 (deep loss)',                             r4.net === -650],
    ['S4: level === alert',                                    r4.level === 'alert'],
    ['S4: cell data-level === alert',                          r4.cellLevel === 'alert'],
    ['S4: emit threshold.amount === -500',
      r4.trace.length >= 1 && r4.trace[r4.trace.length-1].threshold && r4.trace[r4.trace.length-1].threshold.amount === -500],
    /* S5 reset */
    ['S5: nliResetSession clears net + level',                 r5.net === 0 && r5.level === ''],
    ['S5: cell sign returns to zero (neutral)',                r5.cellSign === 'zero'],
    /* No errors */
    ['0 page errors',                                          errs.length === 0],
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
