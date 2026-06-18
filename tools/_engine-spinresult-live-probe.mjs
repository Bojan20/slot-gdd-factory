#!/usr/bin/env node
/**
 * tools/_engine-spinresult-live-probe.mjs
 *
 * 2026-06-18 WASH PASS — Live verification that all 5 topology engines
 * actually emit `onSpinResult` at runtime in Chromium. Pairs with the
 * static `_engineSpinResultEmit.test.mjs` source-pin test.
 *
 * Probe flow per topology:
 *   1. Boot a grid sample HTML that uses the engine (e.g. crash topology
 *      → samples/17_crash_GAME_GDD.md → grid render).
 *   2. Tap HookBus.emit so every emit is recorded.
 *   3. Trigger one spin via spin button.
 *   4. Wait sufficient settle window.
 *   5. Assert onSpinResult appears in the emit log.
 *
 * Engines + grid samples:
 *   crash   → 17_crash_GAME_GDD.md
 *   plinko  → 16_plinko_GAME_GDD.md
 *   hex     → 11_hex_GAME_GDD.md
 *   slingo  → 15_slingo_GAME_GDD.md
 *   wheel   → 18_wheel_GAME_GDD.md
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const REPO = pathResolve(new URL('..', import.meta.url).pathname);
const OUT  = `${REPO}/tools/_eyes/engine-spinresult-live`;
mkdirSync(OUT, { recursive: true });

const PORT = 6001;
const log = (s = '') => process.stdout.write(s + '\n');

const TARGETS = [
  { engine: 'crash',  htmlPath: 'dist/17_crash_playable.html' },
  { engine: 'plinko', htmlPath: 'dist/16_plinko_playable.html' },
  { engine: 'hex',    htmlPath: 'dist/06_hexagonal_playable.html' },
  { engine: 'slingo', htmlPath: 'dist/15_slingo_playable.html' },
  { engine: 'wheel',  htmlPath: 'dist/18_wheel_playable.html' },
];

const SETTLE_MS = 5500;

async function probeOne(page, target) {
  const url = `http://127.0.0.1:${PORT}/${target.htmlPath}`;
  const consoleErrors = [];
  const pageErrors    = [];
  const onCon = (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); };
  const onErr = (e) => pageErrors.push(String(e && e.message || e));
  page.on('console', onCon);
  page.on('pageerror', onErr);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    window.__SR_EMIT_LOG__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit.bind(window.HookBus);
      window.HookBus.emit = function(name, payload) {
        try { window.__SR_EMIT_LOG__.push({ name, payload }); } catch (_) {}
        return orig(name, payload);
      };
    }
  });

  /* Trigger one spin. */
  const btn = await page.$('#spinBtn');
  if (!btn) {
    page.off('console', onCon); page.off('pageerror', onErr);
    return { engine: target.engine, ok: false, reason: 'no-spin-btn' };
  }
  await btn.click({ force: true });
  await page.waitForTimeout(SETTLE_MS);

  const log = await page.evaluate(() => window.__SR_EMIT_LOG__ || []);
  page.off('console', onCon); page.off('pageerror', onErr);

  const spinResultEmits = log.filter(e => e.name === 'onSpinResult');
  const realErr = consoleErrors.filter(e => !/Failed to load resource|favicon|net::ERR_FILE_NOT_FOUND/i.test(e));
  const ok = spinResultEmits.length >= 1 && realErr.length === 0 && pageErrors.length === 0;

  return {
    engine: target.engine, ok,
    spinResultCount: spinResultEmits.length,
    samplePayload: spinResultEmits[0] && spinResultEmits[0].payload,
    consoleErrors: realErr,
    pageErrors,
  };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();

log(`\n══ ENGINE onSpinResult LIVE PROBE · ${TARGETS.length} topologies ══\n`);

const reports = [];
let pass = 0;
for (const target of TARGETS) {
  const exists = existsSync(`${REPO}/${target.htmlPath}`);
  if (!exists) {
    log(`▼ ${target.engine.padEnd(10)} — SKIP (no built artifact at ${target.htmlPath})`);
    continue;
  }
  log(`▼ ${target.engine.padEnd(10)} — click #spinBtn, wait ${SETTLE_MS}ms, expect onSpinResult emit`);
  const r = await probeOne(page, target);
  reports.push(r);
  if (r.ok) {
    pass++;
    log(`  ✓ PASS  count=${r.spinResultCount}  payload=${JSON.stringify(r.samplePayload)}  ce=${r.consoleErrors.length}  pe=${r.pageErrors.length}\n`);
  } else {
    log(`  ✗ FAIL  count=${r.spinResultCount}  reason=${r.reason || 'no-emit'}  ce=${r.consoleErrors.length}  pe=${r.pageErrors.length}\n`);
  }
}

await browser.close();
server.kill();

writeFileSync(`${OUT}/audit.json`, JSON.stringify({ ts: new Date().toISOString(), reports }, null, 2));
log('═════════════════════════════════════════════════════════════════');
log(`SUMMARY: ${pass}/${reports.length} engines emit onSpinResult in live render`);
log(`Report:  ${OUT}/audit.json`);
log('═════════════════════════════════════════════════════════════════\n');

process.exit(pass === reports.length ? 0 : 1);
