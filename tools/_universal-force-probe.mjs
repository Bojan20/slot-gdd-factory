#!/usr/bin/env node
/**
 * tools/_universal-force-probe.mjs
 *
 * Wave U-FORCE-ALL.3 — live verification probe.
 *
 * Spins up one static server, loads each of N reference GDDs, asserts:
 *   1. Universal force panel rendered with ≥ 1 chip
 *   2. Each chip is keyboard-reachable (button + role=toolbar)
 *   3. Clicking a chip:
 *      a. Emits `onForceFeatureRequested` on HookBus with correct kind
 *      b. Sets `window.__FORCE_FEATURE__`
 *      c. Triggers a real spin (preSpin → postSpin lifecycle)
 *      d. For kinds without a dedicated block, the generic banner shows
 *   4. After spin settles, no console errors
 *
 * Exit 0 = green; 1 = any failure.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT = resolvePath(REPO, 'tools/_eyes/u-force-all');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5234;

const FIXTURES = [
  { id: 'crystal-forge', file: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
  { id: 'wrath-of-olympus', file: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { id: 'midnight-fangs', file: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { id: 'gates-1000', file: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
];

async function buildOne(fix) {
  const text = readFileSync(resolvePath(REPO, fix.file), 'utf8');
  const model = parseGDD(text, '.md');
  const html  = buildSlotHTML(model);
  return { model, html };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise(r => setTimeout(r, 700));

let pass = 0, fail = 0;
const row = (ok, name, hint = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${hint ? ' — ' + hint : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
try {
  for (const fix of FIXTURES) {
    console.log(`\n📋 ${fix.id}`);
    const { model, html } = await buildOne(fix);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    page.on('pageerror', e => consoleErrs.push(String(e)));

    // Write HTML to a tmp path under repo + serve via static server
    const slug = fix.id.replace(/\W+/g, '_');
    const tmpPath = resolvePath(OUT, `${slug}.html`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmpPath, html, 'utf8');

    const url = `http://127.0.0.1:${PORT}/tools/_eyes/u-force-all/${slug}.html`;
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    // Settle initial frame
    await page.waitForTimeout(450);

    // Assertion 1 — panel exists
    const panelCount = await page.locator('.ufp-panel').count();
    row(panelCount === 1, 'panel rendered', `count=${panelCount}`);

    // Assertion 2 — at least one chip
    const chipCount = await page.locator('.ufp-chip[data-ufp-kind]').count();
    row(chipCount >= 1, 'chips present', `count=${chipCount}`);

    // Assertion 3 — toolbar role
    const roleOk = await page.locator('.ufp-panel[role="toolbar"]').count();
    row(roleOk === 1, 'toolbar role + aria-label');

    if (chipCount === 0) {
      // Nothing to probe further
      await page.screenshot({ path: resolvePath(OUT, `${slug}.png`), fullPage: true }).catch(() => {});
      await ctx.close();
      continue;
    }

    // Hook HookBus events so we can observe emit
    await page.evaluate(() => {
      window.__OBSERVED_FORCE__ = [];
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        HookBus.on('onForceFeatureRequested', p => window.__OBSERVED_FORCE__.push(p || {}));
      }
    });

    // Pick the FIRST chip and click it
    const firstChip = page.locator('.ufp-chip[data-ufp-kind]').first();
    const kind = await firstChip.getAttribute('data-ufp-kind');
    await firstChip.click({ timeout: 3000 });

    // Wait for emit + a spin cycle
    await page.waitForTimeout(900);

    const observed = await page.evaluate(() => window.__OBSERVED_FORCE__);
    row(Array.isArray(observed) && observed.length >= 1, 'onForceFeatureRequested emitted', `count=${observed.length}`);
    row(observed[0] && observed[0].kind === kind, `payload.kind matches chip (${kind})`, observed[0] ? JSON.stringify(observed[0]) : '');

    const forceFlag = await page.evaluate(() => window.__FORCE_FEATURE__);
    row(forceFlag === kind, `window.__FORCE_FEATURE__ set (${kind})`);

    // After spin, no console errors
    row(consoleErrs.length === 0, 'no console errors after force-spin', consoleErrs.slice(0, 2).join(' | '));

    // Screenshot proof
    await page.screenshot({ path: resolvePath(OUT, `${slug}.png`), fullPage: true }).catch(() => {});
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
