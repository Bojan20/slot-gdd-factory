#!/usr/bin/env node
/**
 * STOP-visibility probe — verify the STOP CTA is reliably visible during
 * rapid play, per Boki rule 05.06.2026 "Ne pojavljuje mi se uvek stop
 * dugme kad igram brzo".
 *
 * Root cause we just patched (H5.11): `requireMinSpinMs` config was baked
 * into the runtime but never read — a rapid double-press could collapse
 * STOP_PRE within ~50 ms before the player ever saw it.
 *
 * The fix queues the slam intent when the press lands < REQUIRE_MIN_SPIN_MS
 * after preSpin, drains it the moment the window closes. STOP icon must
 * be visible for at LEAST REQUIRE_MIN_SPIN_MS (default 250 ms) on every
 * spin that gets a rapid second press.
 *
 * Scenarios per demo:
 *   A. Single spin click — STOP_PRE must appear and stay visible
 *      for >= 250 ms before any further input.
 *   B. Rapid double-click (50 ms apart) — STOP_PRE must STILL be
 *      visible at the 200 ms mark (queued slam suppressed).
 *   C. Six rapid clicks (40 ms apart) — STOP icon visible during the
 *      window; queued slam drains once; spin engine settles normally.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5223;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular', path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus', path: '/dist/wrath-of-olympus.html' },
];

const out = [];

async function sampleCtaForMs(page, ms) {
  return await page.evaluate((duration) => {
    const samples = [];
    const t0 = performance.now();
    return new Promise(resolve => {
      const interval = setInterval(() => {
        const btn = document.getElementById('spinBtn');
        samples.push({
          t: (performance.now() - t0) | 0,
          state: btn?.getAttribute('data-state'),
          disabled: btn?.disabled,
        });
        if (performance.now() - t0 >= duration) {
          clearInterval(interval);
          resolve(samples);
        }
      }, 20);
    });
  }, ms);
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
      const b = document.getElementById('spinBtn');
      return b && !b.disabled && b.getAttribute('data-state') === 'SPIN';
    }, { timeout: 8000 }).catch(()=>{});
    await page.waitForTimeout(400);

    // ── SCENARIO A: single click, sample for 400 ms ──
    const startA = await page.evaluate(() => {
      const b = document.getElementById('spinBtn');
      b.click();
      return { t0: performance.now() | 0, requireMin: 250 };
    });
    const samplesA = await sampleCtaForMs(page, 400);
    const stopPreSamplesA = samplesA.filter(s => s.state === 'STOP_PRE');
    const stopPreDurationA = stopPreSamplesA.length > 0
      ? (stopPreSamplesA[stopPreSamplesA.length - 1].t - stopPreSamplesA[0].t)
      : 0;

    // Let the spin finish before scenario B
    await page.waitForFunction(() => {
      const b = document.getElementById('spinBtn');
      return b && !b.disabled && b.getAttribute('data-state') === 'SPIN';
    }, { timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(300);

    // ── SCENARIO B: rapid double-click (50 ms apart) ──
    await page.evaluate(async () => {
      const b = document.getElementById('spinBtn');
      window.__SC_TRACE__ = { stateAt200: null };
      b.click();
      // 50 ms later: 2nd click
      setTimeout(() => {
        const b2 = document.getElementById('spinBtn');
        if (b2 && !b2.disabled) b2.click();
      }, 50);
      // 200 ms after first click: sample state
      setTimeout(() => {
        const b3 = document.getElementById('spinBtn');
        window.__SC_TRACE__.stateAt200 = b3?.getAttribute('data-state');
        window.__SC_TRACE__.disabledAt200 = b3?.disabled;
      }, 200);
    });
    const samplesB = await sampleCtaForMs(page, 500);
    const traceB = await page.evaluate(() => window.__SC_TRACE__);
    const stopPreSamplesB = samplesB.filter(s => s.state === 'STOP_PRE');
    const stopPreDurationB = stopPreSamplesB.length > 0
      ? (stopPreSamplesB[stopPreSamplesB.length - 1].t - stopPreSamplesB[0].t)
      : 0;

    // Let it settle
    await page.waitForFunction(() => {
      const b = document.getElementById('spinBtn');
      return b && !b.disabled && b.getAttribute('data-state') === 'SPIN';
    }, { timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(300);

    // ── SCENARIO C: 6 rapid clicks (40 ms apart) ──
    await page.evaluate(async () => {
      window.__SC_C_TRACE__ = { presses: 0, slamEmits: 0 };
      if (window.HookBus) {
        window.HookBus.on('onSlamRequested', () => window.__SC_C_TRACE__.slamEmits += 1);
      }
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          const b = document.getElementById('spinBtn');
          if (b && !b.disabled) { b.click(); window.__SC_C_TRACE__.presses += 1; }
        }, i * 40);
      }
    });
    const samplesC = await sampleCtaForMs(page, 600);
    const traceC = await page.evaluate(() => window.__SC_C_TRACE__);
    const stopVisibleAt100C = samplesC.find(s => s.t >= 80 && s.t <= 130);

    const checks = [
      // SCENARIO A
      ['A. STOP_PRE became visible at all',           stopPreSamplesA.length > 0],
      ['A. STOP_PRE visible duration >= 220 ms',      stopPreDurationA >= 220],

      // SCENARIO B
      ['B. STOP_PRE still visible 200 ms after 1st click', traceB.stateAt200 === 'STOP_PRE'],
      ['B. button still disabled=false at 200ms',     traceB.disabledAt200 === false || traceB.disabledAt200 === undefined],
      ['B. STOP_PRE visible duration >= 200 ms',      stopPreDurationB >= 200],

      // SCENARIO C
      ['C. all 6 clicks reached the button',          traceC.presses === 6],
      ['C. STOP_PRE visible at the 100ms mark',       stopVisibleAt100C?.state === 'STOP_PRE'],
      ['C. exactly 1 slam emitted (queued drain)',    traceC.slamEmits === 1],

      // No errors
      ['no console / page errors',                    errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, samplesA, samplesB, samplesC, traceB, traceC, stopPreDurationA, stopPreDurationB, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ STOP-VISIBILITY PROBE (Wave H5.11) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  A: STOP_PRE visible duration = ${r.stopPreDurationA}ms (must >= 220)`);
  console.log(`  B: state at 200ms = ${r.traceB.stateAt200}, STOP_PRE duration = ${r.stopPreDurationB}ms`);
  console.log(`  C: presses=${r.traceC.presses}, slam emits=${r.traceC.slamEmits}`);
  console.log(`  C samples (first 10):`);
  r.samplesC.slice(0, 10).forEach(s => console.log(`    +${s.t}ms state=${s.state} disabled=${s.disabled}`));
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
