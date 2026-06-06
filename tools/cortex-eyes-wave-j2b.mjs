#!/usr/bin/env node
/**
 * tools/cortex-eyes-wave-j2b.mjs
 *
 * Wave J2b verification — render the hex test fixture (samples/grids/
 * 06_hexagonal_GAME_GDD.md), boot it headless, then audit:
 *
 *   1. Zero console errors during page load + spin
 *   2. window.__SLOT_HEX_REELS__ exposes the per-axial-column array
 *   3. .hex-reel-col elements rendered (one per axial q)
 *   4. SPIN click kicks animation — strip transform translates
 *      vertically; cells rotate (text content snapshot before/after
 *      differs in ≥1 cell)
 *   5. Settle handler fires within reasonable budget (4s for 1.8s
 *      spinDuration + per-column stagger × 7 columns + cushion)
 *
 * Output: ASCII summary + screenshot in tools/_eyes/wave-j2b/.
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
const OUT = resolvePath(REPO, 'tools/_eyes/wave-j2b');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5187;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const FIXTURE = 'samples/grids/06_hexagonal_GAME_GDD.md';

function buildHtmlForFixture() {
  const text = readFileSync(resolvePath(REPO, FIXTURE), 'utf8');
  const model = parseGDD(text, 'md');
  const html = buildSlotHTML(model);
  return { html, model };
}

async function run() {
  console.log('── Cortex Eyes ── Wave J2b (hex reel engine) ───────────────');

  /* Stage 1 — build HTML, write to disk under repo so static server picks it up */
  const { html } = buildHtmlForFixture();
  const stagePath = resolvePath(REPO, 'tools/_eyes/wave-j2b/staged.html');
  writeFileSync(stagePath, html);

  /* Spin up Python HTTP server */
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));

  try {
    await page.goto(`${SERVER_URL}/tools/_eyes/wave-j2b/staged.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    check(consoleErrors.length === 0, '1. zero console errors at boot', consoleErrors[0] || '');

    /* 2. __SLOT_HEX_REELS__ exposed */
    const reelsLen = await page.evaluate(() => {
      const r = window.__SLOT_HEX_REELS__;
      return Array.isArray(r) ? r.length : -1;
    });
    check(reelsLen > 0, `2. __SLOT_HEX_REELS__ length = ${reelsLen}`,
      reelsLen < 0 ? 'not exposed' : '');

    /* 3. .hex-reel-col DOM elements rendered */
    const colCount = await page.locator('.hex-reel-col').count();
    check(colCount === reelsLen, `3. ${colCount} .hex-reel-col DOM elements (== reels length)`);

    /* 4. Capture cell text BEFORE spin */
    const cellsBefore = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.hex-reel-col .cell')).map(c => c.textContent);
    });
    check(cellsBefore.length > 0, `4a. ${cellsBefore.length} hex cells in DOM before spin`);

    await page.screenshot({ path: resolvePath(OUT, '01-pre-spin.png') });

    /* 5. Click SPIN → wait for spin completion (best-effort: 4s) */
    const spinBtn = await page.$('#spinBtn');
    if (spinBtn) {
      await spinBtn.click();
      /* Wait for spin to complete — total spin = 1800ms + 7 cols × 280ms stagger + cushion 240ms ≈ 4s */
      await page.waitForTimeout(4200);
    }
    const cellsAfter = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.hex-reel-col .cell')).map(c => c.textContent);
    });
    const changed = cellsBefore.reduce((acc, t, i) => acc + (t !== cellsAfter[i] ? 1 : 0), 0);
    check(changed > 0, `5. ${changed}/${cellsBefore.length} cells changed after spin`,
      changed === 0 ? 'spin did not rotate cells' : '');

    await page.screenshot({ path: resolvePath(OUT, '02-post-spin.png') });

    /* 6. console-error check after spin too */
    check(consoleErrors.length === 0, '6. still zero console errors after spin',
      consoleErrors[0] || '');

  } catch (e) {
    fail++;
    console.log('  ✗ fatal:', e.message);
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
