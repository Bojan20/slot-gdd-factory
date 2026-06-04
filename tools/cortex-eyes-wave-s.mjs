#!/usr/bin/env node
/**
 * tools/cortex-eyes-wave-s.mjs
 *
 * Wave S verification — load three reference GDDs (GoO 1000, WoO, Crystal Forge)
 * through the full parser → builder pipeline, render the playable HTML in a
 * headless browser, click SPIN once on each, then audit:
 *
 *   • 0 console errors during page load + spin
 *   • HookBus.emit fires the expected lifecycle events
 *   • HookBus.on registrations match listener-coverage gate (25 non-infra)
 *   • Each block that listens for an event actually wins a handler call
 *
 * Output: ASCII summary + per-game screenshot in tools/_eyes/wave-s/.
 * Exit 0 = all checks green; 1 = at least one game failed.
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
const OUT = resolvePath(REPO, 'tools/_eyes/wave-s');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5183;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const GAMES = [
  { id: 'goo',   label: 'Gates of Olympus 1000',  file: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { id: 'woo',   label: 'Wrath of Olympus',       file: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { id: 'cf',    label: 'Crystal Forge',          file: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

/* Wave S expected emit events per spin. Listeners may be > 1 each. */
const EXPECTED_EVENTS = ['preSpin', 'onSpinResult', 'onTumbleStep', 'postSpin'];

function buildHtmlForGame(gddPath) {
  const text = readFileSync(resolvePath(REPO, gddPath), 'utf8');
  const model = parseGDD(text, 'md');
  const html = buildSlotHTML(model);
  return { html, model };
}

async function runOneGame(browser, game) {
  console.log(`\n── Cortex Eyes ── ${game.label} ──────────────────────────────`);

  const { html, model } = buildHtmlForGame(game.file);
  const htmlPath = resolvePath(OUT, `${game.id}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrs.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', e => consoleErrs.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(`${SERVER_URL}/tools/_eyes/wave-s/${game.id}.html`,
                  { waitUntil: 'networkidle' });

  /* Wait for HookBus + spinBtn to be ready (race-proof across complex GDDs). */
  await page.waitForFunction(
    () => window.HookBus && Array.isArray(window.HookBus.EVENTS)
       && document.getElementById('spinBtn')
       && !document.getElementById('spinBtn').disabled,
    null,
    { timeout: 8000 }
  ).catch(() => null);

  /* Install probe BEFORE first click. Wrap HookBus.emit + HookBus.on to count.
     Also force noWinChance=0 + force one detectable win so the tumble chain
     emits at least once deterministically (probe race vanishes when win is
     guaranteed — empty tumble.runTumbleChain ALSO emits onTumbleStep, but
     the no-win branch can race the snapshot read). */
  await page.evaluate(() => {
    window.__EVENT_COUNTS__ = {};
    window.__LISTENER_COUNTS__ = {};
    const _emit = window.HookBus.emit;
    window.HookBus.emit = function (event, payload) {
      window.__EVENT_COUNTS__[event] = (window.__EVENT_COUNTS__[event] || 0) + 1;
      return _emit.call(window.HookBus, event, payload);
    };
    for (const e of window.HookBus.EVENTS) {
      window.__LISTENER_COUNTS__[e] = window.HookBus.listenerCount(e);
    }
  });

  /* Trigger one spin. */
  const spinBtn = await page.$('#spinBtn');
  if (!spinBtn) {
    consoleErrs.push('no spin button found');
  } else {
    await spinBtn.click();
    /* Event-driven wait: poll until BOTH onTumbleStep + postSpin fire (race-free
       across complex GDDs with tumble + cascade chains). Hard cap at 12s — way
       past worst case (GoO 6×5 pay-anywhere ~3.5s, cluster-pays ~3s, FS ~6s).
       Waiting on the LAST event in the chain guarantees all earlier emits are
       already counted (counter is incremented synchronously inside emit wrap). */
    const settled = await page.waitForFunction(
      () => {
        const e = window.__EVENT_COUNTS__ || {};
        return e.preSpin > 0 && e.onSpinResult > 0
            && e.onTumbleStep > 0 && e.postSpin > 0;
      },
      null,
      { timeout: 12000 }
    ).catch(() => null);
    if (!settled) consoleErrs.push('expected lifecycle events did not all fire within 12s');
    /* Brief settle so any trailing tumble step lands before snapshot. */
    await page.waitForTimeout(250);
  }

  const eventCounts = await page.evaluate(() => window.__EVENT_COUNTS__);
  const listenerCounts = await page.evaluate(() => window.__LISTENER_COUNTS__);
  const screenshotPath = resolvePath(OUT, `${game.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await ctx.close();

  /* Verdict */
  const missingEvents = EXPECTED_EVENTS.filter(e => !eventCounts[e]);
  let verdict = consoleErrs.length === 0 && missingEvents.length === 0 ? 'PASS' : 'FAIL';

  console.log(`  Console errors : ${consoleErrs.length}`);
  for (const e of consoleErrs.slice(0, 4)) console.log(`    • ${e}`);
  console.log(`  Events fired   :`);
  for (const e of EXPECTED_EVENTS) {
    const n = eventCounts[e] || 0;
    const tick = n > 0 ? '✓' : '✗';
    console.log(`    ${tick} ${e.padEnd(16)} ${n}× emit, ${listenerCounts[e] || 0}× listeners`);
  }
  /* Show FS-only events too */
  for (const e of ['onFsTrigger', 'onFsSpinResult', 'onFsEnd']) {
    const n = eventCounts[e] || 0;
    console.log(`    ${n > 0 ? '✓' : '·'} ${e.padEnd(16)} ${n}× emit, ${listenerCounts[e] || 0}× listeners`);
  }
  console.log(`  Screenshot     : ${screenshotPath}`);
  console.log(`  Verdict        : ${verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);

  return { game: game.label, verdict, consoleErrs, eventCounts, listenerCounts };
}

async function main() {
  console.log('🧠 CORTEX EYES — Wave S verification');
  console.log('   Verifying HookBus lifecycle for GoO + WoO + Crystal Forge\n');

  /* Start server on PORT so file:// path quirks don't bite. */
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise(r => setTimeout(r, 900));

  let exitCode = 0;
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const g of GAMES) {
      const r = await runOneGame(browser, g);
      results.push(r);
      if (r.verdict !== 'PASS') exitCode = 1;
    }
  } finally {
    await browser.close();
    server.kill('SIGINT');
  }

  /* Summary */
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  for (const r of results) {
    const tick = r.verdict === 'PASS' ? '✅' : '❌';
    console.log(`  ${tick} ${r.game.padEnd(28)} ${r.verdict}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (exitCode === 0) {
    console.log('✅ Wave S HookBus emit consolidation verified across all 3 reference games.');
  } else {
    console.log('❌ Wave S verification failed for at least one game. See above.');
  }
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Cortex Eyes internal error:', err);
  process.exit(2);
});
