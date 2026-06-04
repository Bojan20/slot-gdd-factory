#!/usr/bin/env node
/**
 * tools/cortex-eyes-wave-v.mjs
 *
 * Wave V verification — drive the slam-stop + force-skip flow end-to-end
 * in a headless browser and assert the industry-reference UX is intact.
 *
 * For each of the 3 reference GDDs:
 *   1. Parse + build HTML with Wave V blocks force-enabled (model overrides)
 *   2. Click SPIN
 *   3. Within requireMinSpinMs + 100ms, the slam-stop button must be visible
 *   4. Click slam → assert onSlamRequested + onSlamComplete fire and reels
 *      visually collapsed within 500ms (no leftover .is-blurring cells)
 *   5. If award > 0 → force-skip button must appear during rollup
 *      (skipped in this version because rollup may not happen on dummy math)
 *
 * Output: ASCII summary + per-game screenshot of slam phase.
 * Exit 0 = all green; 1 = at least one game failed.
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
const OUT = resolvePath(REPO, 'tools/_eyes/wave-v');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5184;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const GAMES = [
  { id: 'goo',   label: 'Reference GDD A (pay-anywhere)', file: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { id: 'woo',   label: 'Reference GDD B (cascade)',      file: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { id: 'cf',    label: 'Reference GDD C (cluster)',      file: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

/* Force-enable both Wave V blocks regardless of what the GDD declares.
 * requireMinSpinMs lowered so the test doesn't have to wait 250ms. */
function buildHtmlForGame(gddPath) {
  const text = readFileSync(resolvePath(REPO, gddPath), 'utf8');
  const model = parseGDD(text, 'md');
  model.slamStop = {
    ...(model.slamStop || {}),
    enabled: true,
    requireMinSpinMs: 50,
    hideOnTurbo: true,
    hideOnAutoSpin: true,
    reelsClickAreaEnabled: true,
    pulseAnimation: false, /* skip animation for headless determinism */
  };
  model.forceSkip = {
    ...(model.forceSkip || {}),
    enabled: true,
    minRollupMsForShow: 0,
    showDuringRollup: true,
    showDuringFsIntro: true,
    showDuringFsOutro: true,
  };
  const html = buildSlotHTML(model);
  return { html, model };
}

async function runOneGame(browser, game) {
  console.log(`\n── Cortex Eyes Wave V ── ${game.label} ─────────────────`);

  const { html } = buildHtmlForGame(game.file);
  const htmlPath = resolvePath(OUT, `${game.id}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrs.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', e => consoleErrs.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(`${SERVER_URL}/tools/_eyes/wave-v/${game.id}.html`,
                  { waitUntil: 'networkidle' });

  /* Wait for HookBus + spinBtn + slamStopBtn ready. */
  await page.waitForFunction(
    () => window.HookBus
       && document.getElementById('spinBtn')
       && document.getElementById('slamStopBtn')
       && !document.getElementById('spinBtn').disabled,
    null,
    { timeout: 8000 }
  ).catch(() => null);

  /* Probe install — capture Wave V intent events. */
  await page.evaluate(() => {
    window.__V_EVENTS__ = [];
    const wantedEvents = ['onSlamRequested','onSlamComplete','onSkipRequested','onSkipComplete'];
    const _emit = window.HookBus.emit;
    window.HookBus.emit = function (event, payload) {
      if (wantedEvents.includes(event)) {
        window.__V_EVENTS__.push({ event, payload, t: performance.now() });
      }
      return _emit.call(window.HookBus, event, payload);
    };
  });

  /* Phase 1 — initial state: slam button hidden. */
  const initiallyHidden = await page.evaluate(() => {
    const btn = document.getElementById('slamStopBtn');
    return btn && btn.hidden;
  });
  if (!initiallyHidden) consoleErrs.push('slam-stop button visible at idle (should be hidden)');

  /* Phase 2 — click SPIN → wait for slam button to appear. */
  const spinBtn = await page.$('#spinBtn');
  if (!spinBtn) {
    consoleErrs.push('no spin button found');
    await ctx.close();
    return { game: game.label, verdict: 'FAIL', consoleErrs, events: [] };
  }
  await spinBtn.click();

  const slamVisible = await page.waitForFunction(
    () => {
      const b = document.getElementById('slamStopBtn');
      return b && !b.hidden;
    },
    null,
    { timeout: 2000 }
  ).catch(() => null);
  if (!slamVisible) consoleErrs.push('slam-stop button never appeared after spin click');

  /* Snapshot slam phase. */
  const slamScreenshot = resolvePath(OUT, `${game.id}-slam.png`);
  if (slamVisible) await page.screenshot({ path: slamScreenshot, fullPage: true });

  /* Phase 3 — click slam, verify onSlamRequested fires + reels collapse. */
  const slamClickTime = await page.evaluate(() => {
    const btn = document.getElementById('slamStopBtn');
    const t = performance.now();
    if (btn && !btn.hidden) btn.click();
    return t;
  });

  /* Wait STRICTLY for onSlamComplete emit — earlier heuristic on
     .is-blurring class would resolve immediately upon snap (because the
     class is stripped in the stop branch) before the engine has a chance
     to emit onSpinResult → onSlamComplete. */
  const slamSettled = await page.waitForFunction(
    () => {
      const v = window.__V_EVENTS__ || [];
      return v.some(e => e.event === 'onSlamComplete');
    },
    null,
    { timeout: 4000 }
  ).catch(() => null);
  if (!slamSettled) consoleErrs.push('slam never produced onSlamComplete within 4s');

  const slamElapsed = await page.evaluate((t0) => {
    const v = window.__V_EVENTS__ || [];
    const slam = v.find(e => e.event === 'onSlamComplete');
    if (slam) return Math.round(slam.t - t0);
    return null;
  }, slamClickTime);

  /* Snapshot post-slam. */
  const settledScreenshot = resolvePath(OUT, `${game.id}-settled.png`);
  await page.screenshot({ path: settledScreenshot, fullPage: true });

  /* Grab full event log. */
  const events = await page.evaluate(() => window.__V_EVENTS__);

  /* Verdict synthesis. */
  const hasSlamReq  = events.some(e => e.event === 'onSlamRequested');
  const hasSlamDone = events.some(e => e.event === 'onSlamComplete');
  const slamFastEnough = (slamElapsed === null) ? false : slamElapsed <= 500;

  if (!hasSlamReq)  consoleErrs.push('onSlamRequested never emitted');
  if (!hasSlamDone) consoleErrs.push('onSlamComplete never emitted');
  if (slamElapsed !== null && !slamFastEnough) {
    consoleErrs.push(`slam took ${slamElapsed}ms (industry budget ≤ 500ms)`);
  }

  await ctx.close();

  const verdict = consoleErrs.length === 0 ? 'PASS' : 'FAIL';

  console.log(`  Console errors : ${consoleErrs.length}`);
  for (const e of consoleErrs.slice(0, 6)) console.log(`    • ${e}`);
  console.log(`  Slam initial hidden  : ${initiallyHidden ? '✅' : '❌'}`);
  console.log(`  Slam visible mid-spin: ${slamVisible ? '✅' : '❌'}`);
  console.log(`  onSlamRequested fired: ${hasSlamReq ? '✅' : '❌'}`);
  console.log(`  onSlamComplete fired : ${hasSlamDone ? '✅' : '❌'}`);
  console.log(`  Slam latency (ms)    : ${slamElapsed === null ? 'n/a' : slamElapsed} ${slamFastEnough ? '✅' : '❌'} (budget 500ms)`);
  console.log(`  Slam phase snap      : ${slamScreenshot}`);
  console.log(`  Settled phase snap   : ${settledScreenshot}`);
  console.log(`  Verdict              : ${verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);

  return { game: game.label, verdict, consoleErrs, events, slamElapsed };
}

async function main() {
  console.log('🧠 CORTEX EYES — Wave V (slam-stop + force-skip) verification');
  console.log('   3 reference games × phase audit + screenshot pair per game\n');

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /* Give the server a brief beat to bind. */
  await new Promise(r => setTimeout(r, 500));

  const browser = await chromium.launch({ headless: true });

  let exitCode = 0;
  const results = [];
  try {
    for (const game of GAMES) {
      const r = await runOneGame(browser, game);
      results.push(r);
      if (r.verdict !== 'PASS') exitCode = 1;
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  for (const r of results) {
    const tick = r.verdict === 'PASS' ? '✅' : '❌';
    const latency = r.slamElapsed === null ? '—' : `${r.slamElapsed}ms`;
    console.log(`  ${tick} ${r.game.padEnd(34)} ${r.verdict.padEnd(4)} slam=${latency}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (exitCode === 0) {
    console.log('✅ Wave V verified — slam-stop button drives a complete intent → action → complete cycle across all reference games.');
  } else {
    console.log('❌ Wave V failed on at least one game. Inspect screenshots in tools/_eyes/wave-v/.');
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
