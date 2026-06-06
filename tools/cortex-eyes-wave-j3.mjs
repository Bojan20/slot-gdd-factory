#!/usr/bin/env node
/**
 * tools/cortex-eyes-wave-j3.mjs
 *
 * Wave J3 verification — render every SVG-kind fixture, boot headless,
 * click SPIN, audit:
 *
 *   For each kind in [wheel, crash, slingo, plinko]:
 *     1. Zero console errors at boot
 *     2. window.__SLOT_KIND_RUNSPIN__[kind] registered
 *     3. SPIN click kicks the kind-specific animation (state probe
 *        verifies engine entered + exited the spinning state)
 *     4. Zero console errors after spin
 *
 * Output: ASCII summary + screenshot per kind in tools/_eyes/wave-j3/.
 * Exit 0 = all green; 1 = any failure.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT = resolvePath(REPO, 'tools/_eyes/wave-j3');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5188;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const KINDS = [
  { id: 'wheel',  fixture: 'samples/grids/18_wheel_GAME_GDD.md',  stateGlobal: '__SLOT_WHEEL_STATE__',  settleMs: 2900 },
  { id: 'crash',  fixture: 'samples/grids/17_crash_GAME_GDD.md',  stateGlobal: '__SLOT_CRASH_STATE__',  settleMs: 2200 },
  { id: 'slingo', fixture: 'samples/grids/15_slingo_GAME_GDD.md', stateGlobal: '__SLOT_SLINGO_STATE__', settleMs: 2400 },
  { id: 'plinko', fixture: 'samples/grids/16_plinko_GAME_GDD.md', stateGlobal: '__SLOT_PLINKO_STATE__', settleMs: 3500 },
];

async function run() {
  console.log('── Cortex Eyes ── Wave J3 (SVG kinds spin engines) ─────────');

  /* Build all four fixtures upfront */
  for (const k of KINDS) {
    const text = readFileSync(resolvePath(REPO, k.fixture), 'utf8');
    const model = parseGDD(text, 'md');
    const html = buildSlotHTML(model);
    const stagePath = resolvePath(REPO, `tools/_eyes/wave-j3/${k.id}.html`);
    writeFileSync(stagePath, html);
  }

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 700));

  let pass = 0, fail = 0;
  const check = (ok, name, hint = '') => {
    if (ok) { pass++; console.log('  ✓', name); }
    else    { fail++; console.log('  ✗', name, hint ? ' — ' + hint : ''); }
  };

  const browser = await chromium.launch({ headless: true });
  try {
    for (const kind of KINDS) {
      console.log(`\n── ${kind.id.toUpperCase()} ──`);
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('console',   (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));

      const url = `${SERVER_URL}/tools/_eyes/wave-j3/${kind.id}.html`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      check(consoleErrors.length === 0, `${kind.id} 1. zero console errors at boot`, consoleErrors[0] || '');

      /* 2. registry entry present */
      const registered = await page.evaluate((k) => {
        return typeof (window.__SLOT_KIND_RUNSPIN__ || {})[k] === 'function';
      }, kind.id);
      check(registered, `${kind.id} 2. registry entry registered (__SLOT_KIND_RUNSPIN__.${kind.id})`);

      /* 3. state global exposed */
      const stateBefore = await page.evaluate((g) => {
        const s = window[g];
        if (!s) return null;
        /* extract a boolean snapshot to avoid serialising DOM refs */
        return {
          rotating: !!s.rotating,
          dropping: !!s.dropping,
          running:  !!s.running,
        };
      }, kind.stateGlobal);
      check(stateBefore !== null, `${kind.id} 3. ${kind.stateGlobal} exposed pre-spin`);

      /* 4. click SPIN */
      const btn = await page.$('#spinBtn');
      if (btn) {
        await btn.click();
      }
      /* During spin we want the relevant boolean flag to be true at least
         briefly. Poll for 400ms. */
      let sawSpinning = false;
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(50);
        const live = await page.evaluate((g) => {
          const s = window[g];
          if (!s) return false;
          return !!(s.rotating || s.dropping || s.running);
        }, kind.stateGlobal);
        if (live) { sawSpinning = true; break; }
      }
      check(sawSpinning, `${kind.id} 4. engine entered active state after SPIN click`);

      /* 5. wait for settle */
      await page.waitForTimeout(kind.settleMs);
      const stateAfter = await page.evaluate((g) => {
        const s = window[g];
        if (!s) return null;
        return { rotating: !!s.rotating, dropping: !!s.dropping, running: !!s.running };
      }, kind.stateGlobal);
      const settled = stateAfter && !(stateAfter.rotating || stateAfter.dropping || stateAfter.running);
      check(settled, `${kind.id} 5. engine returned to settled state after spin`,
        settled ? '' : JSON.stringify(stateAfter));

      check(consoleErrors.length === 0, `${kind.id} 6. zero console errors after spin`,
        consoleErrors[0] || '');

      await page.screenshot({ path: resolvePath(OUT, `${kind.id}.png`) });
      await ctx.close();
    }
  } catch (e) {
    fail++;
    console.log('✗ fatal:', e.message);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 SUMMARY  pass: ${pass}  fail: ${fail}`);
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
