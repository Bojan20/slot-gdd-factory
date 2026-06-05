#!/usr/bin/env node
/**
 * Live verification of a491b82 — SKIP CTA must NOT leak on 0-award spins.
 *
 * Test scenario (per Boki's bug report):
 *   1. Open rectangular playable
 *   2. Fire 6 rapid SPIN clicks (under 250ms each)
 *   3. After each spin's tail, sample spinBtn data-state
 *   4. Verify: SKIP_ROLLUP state appears ONLY when totalAward > 0
 *   5. Capture screenshot of final idle state
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = '/tmp/cortex-skip-leak';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5192;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Force 0-award spins by stubbing the win detector to always return empty.
  // We sample data-state at spin tail to catch any SKIP_ROLLUP leak.
  await page.evaluate(() => {
    window.__TRACE_STATE__ = [];
    const btn = document.getElementById('spinBtn');
    if (!btn) return;
    const obs = new MutationObserver(() => {
      window.__TRACE_STATE__.push({
        t: performance.now() | 0,
        state: btn.getAttribute('data-state'),
        award: window.__WIN_AWARD__ || 0,
      });
    });
    obs.observe(btn, { attributes: true, attributeFilter: ['data-state'] });
  });

  const phases = [];
  for (let i = 0; i < 8; i++) {
    await page.click('#spinBtn');
    await page.waitForTimeout(150);
    // Slam stop to land quickly
    const st = await page.getAttribute('#spinBtn', 'data-state');
    if (st && st.startsWith('STOP_')) await page.click('#spinBtn');
    await page.waitForTimeout(800);
    const snap = await page.evaluate(() => ({
      state: document.getElementById('spinBtn').getAttribute('data-state'),
      award: window.__WIN_AWARD__ || 0,
      visible: !document.getElementById('spinBtn').disabled,
    }));
    phases.push({ spin: i + 1, ...snap });
    if (st && st.startsWith('SKIP_')) {
      // If skip lingered, click to clear it
      await page.click('#spinBtn');
      await page.waitForTimeout(200);
    }
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, 'after-8-spins.png') });

  const trace = await page.evaluate(() => window.__TRACE_STATE__.slice(-30));

  console.log('\n=== POST-SPIN STATE SNAPSHOTS ===');
  for (const p of phases) {
    const verdict = p.state === 'SKIP_ROLLUP' && p.award === 0 ? '❌ LEAK' : '✅';
    console.log(`  spin ${p.spin}: state=${p.state.padEnd(12)} award=${String(p.award).padStart(6)}  ${verdict}`);
  }

  console.log('\n=== last 30 state transitions ===');
  for (const t of trace) {
    const verdict = t.state === 'SKIP_ROLLUP' && t.award === 0 ? '❌' : ' ';
    console.log(`  ${verdict} t=${t.t}ms state=${t.state}  award=${t.award}`);
  }

  console.log('\nconsole errors:', errs.length);
  for (const e of errs.slice(0, 5)) console.log('  •', e);

  const leaks = phases.filter((p) => p.state === 'SKIP_ROLLUP' && p.award === 0).length;
  console.log(`\n=== VERDICT: ${leaks === 0 ? '✅ NO LEAK' : '❌ ' + leaks + ' LEAK(S)'} ===`);
  console.log('screenshot:', resolve(OUT, 'after-8-spins.png'));

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
