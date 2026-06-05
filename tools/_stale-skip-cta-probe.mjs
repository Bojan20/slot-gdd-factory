#!/usr/bin/env node
/**
 * Stale-SKIP-CTA probe — verifies the H5.12 fix for Boki bug 05.06.2026:
 * "kada sam igrao brzo, opet mi se skipo pojavio na kraju spina a nije
 *  bilo nikakvog win-a. I ostao je vidljiv dok ga nisam pritisnuo,
 *  a kada sam ga pritisnuo, pokrenuli su se rilovi."
 *
 * Root cause was that _finalizeRound in spinControl unconditionally
 * re-set SKIP_ROLLUP whenever __WIN_AWARD__ > 0 — even after the
 * onWinPresentationEnd handler had already settled the state to SPIN.
 * Result: stale SKIP CTA on the button after the cycle naturally
 * ended OR after a skip click.
 *
 * Three scenarios per demo:
 *   A. Natural win cycle completion — terminal state must be SPIN,
 *      not SKIP_ROLLUP, after onWinPresentationEnd + postSpin land.
 *   B. Mid-cycle skip — terminal state must be SPIN after onSkipComplete
 *      and the trailing postSpin.
 *   C. No-win round (totalAward = 0) — terminal state must be SPIN,
 *      not SKIP_ROLLUP.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5225;
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

    // ── SCENARIO A: emulate full win cycle (Start + End + postSpin) ──
    const scenarioA = await page.evaluate(async () => {
      window.__SA__ = { events: [] };
      ['onWinPresentationStart','onWinPresentationEnd','onSkipComplete','postSpin']
        .forEach(n => window.HookBus.on(n, p => window.__SA__.events.push({ n, t: performance.now()|0, ...p })));
      // Simulate fresh round: preSpin → STOP_PRE → onSpinResult → STOP_POST
      window.HookBus.emit('preSpin', { spinId: 1 });
      await new Promise(r => setTimeout(r, 300));     // allow STOP_PRE min-window
      window.HookBus.emit('onSpinResult', { events: [{ payX: 5 }] });
      await new Promise(r => setTimeout(r, 20));
      // Simulate win cycle (Start → End)
      const bet = window.__SLOT_BET__ || 1;
      const award = 5 * bet;
      window.__WIN_AWARD__ = award;
      window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      window.HookBus.emit('onWinPresentationStart', { award, eventCount: 1 });
      await new Promise(r => setTimeout(r, 200));
      window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      window.HookBus.emit('onWinPresentationEnd', { award });
      // postSpin fires AFTER End (handlePostSpin order)
      window.HookBus.emit('postSpin', { events: [{ payX: award }] });
      await new Promise(r => setTimeout(r, 100));
      const btn = document.getElementById('spinBtn');
      return {
        award,
        terminalState: btn?.getAttribute('data-state'),
        terminalDisabled: btn?.disabled,
      };
    });

    // ── SCENARIO B: mid-cycle skip → check terminal state ──
    const scenarioB = await page.evaluate(async () => {
      window.__SB__ = { events: [] };
      ['onWinPresentationStart','onWinPresentationEnd','onSkipRequested','onSkipComplete','postSpin']
        .forEach(n => window.HookBus.on(n, p => window.__SB__.events.push({ n, t: performance.now()|0, ...p })));
      // Reset state
      window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      window.__WIN_AWARD__ = 0;
      window.HookBus.emit('preSpin', { spinId: 2 });
      await new Promise(r => setTimeout(r, 300));
      window.HookBus.emit('onSpinResult', { events: [{ payX: 8 }] });
      await new Promise(r => setTimeout(r, 20));
      const bet = window.__SLOT_BET__ || 1;
      const award = 8 * bet;
      window.__WIN_AWARD__ = award;
      window.__SLOT_WIN_PRESENT_ACTIVE__ = true;
      window.HookBus.emit('onWinPresentationStart', { award, eventCount: 1 });
      await new Promise(r => setTimeout(r, 100));
      // SKIP click mid-cycle
      window.HookBus.emit('onSkipRequested', { phase: 'rollup', source: 'probe' });
      // winPresentation listener fires onSkipComplete; then End + postSpin land
      await new Promise(r => setTimeout(r, 40));
      window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      window.HookBus.emit('onWinPresentationEnd', { award });
      window.HookBus.emit('postSpin', { events: [{ payX: award }] });
      await new Promise(r => setTimeout(r, 100));
      const btn = document.getElementById('spinBtn');
      return {
        award,
        terminalState: btn?.getAttribute('data-state'),
        terminalDisabled: btn?.disabled,
      };
    });

    // ── SCENARIO C: no-win round — must terminate to SPIN ──
    const scenarioC = await page.evaluate(async () => {
      window.__SC__ = { events: [] };
      ['postSpin','onSkipComplete'].forEach(n => window.HookBus.on(n, p => window.__SC__.events.push({ n, t: performance.now()|0, ...p })));
      // Reset
      window.__SLOT_WIN_PRESENT_ACTIVE__ = false;
      window.__WIN_AWARD__ = 0;
      window.HookBus.emit('preSpin', { spinId: 3 });
      await new Promise(r => setTimeout(r, 300));
      window.HookBus.emit('onSpinResult', { events: [] });
      await new Promise(r => setTimeout(r, 20));
      // No win cycle. postSpin fires directly.
      window.HookBus.emit('postSpin', { events: [] });
      await new Promise(r => setTimeout(r, 100));
      const btn = document.getElementById('spinBtn');
      return {
        terminalState: btn?.getAttribute('data-state'),
        terminalDisabled: btn?.disabled,
      };
    });

    const checks = [
      ['A. After natural cycle end: terminal state = SPIN', scenarioA.terminalState === 'SPIN'],
      ['A. After natural cycle end: button enabled',         scenarioA.terminalDisabled === false],
      ['B. After mid-cycle skip: terminal state = SPIN',     scenarioB.terminalState === 'SPIN'],
      ['B. After mid-cycle skip: button enabled',            scenarioB.terminalDisabled === false],
      ['C. No-win round: terminal state = SPIN',             scenarioC.terminalState === 'SPIN'],
      ['C. No-win round: button enabled',                    scenarioC.terminalDisabled === false],
      ['no console / page errors',                           errors.length === 0],
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
console.log('\n════ STALE-SKIP-CTA PROBE (Wave H5.12) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A natural cycle: terminal=${r.scenarioA.terminalState} disabled=${r.scenarioA.terminalDisabled}`);
  console.log(`  B mid-skip:      terminal=${r.scenarioB.terminalState} disabled=${r.scenarioB.terminalDisabled}`);
  console.log(`  C no-win:        terminal=${r.scenarioC.terminalState} disabled=${r.scenarioC.terminalDisabled}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
