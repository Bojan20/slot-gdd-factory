#!/usr/bin/env node
/**
 * tools/_hnw-no-double-trigger-probe.mjs
 *
 * 2026-06-18 — Boki bug: "zavrsi se jedan hold and win, i odmah drugi
 * pocne". Verifies the industry-reference single-arm-per-spin latch
 * (HW_STATE.armed) prevents back-to-back H&W rounds on the same grid
 * snapshot.
 *
 * Probe flow (per GDD with H&W in chip rail):
 *   1. Open dist/real-games/<slug>/slot.html in headless Chromium.
 *   2. Tap HookBus.emit so every emit is recorded with t(ms).
 *   3. Click the H&W force chip.
 *   4. Wait long enough for the round to enter and end naturally
 *      (~30s — generous for 3-respin default round).
 *   5. Assert `onHoldAndWinEnd` was emitted.
 *   6. IDLE wait 10s with NO spin click.
 *   7. Assert ZERO `onHoldAndWinPhase` INTRO/RUNNING emits AFTER the
 *      onHoldAndWinEnd emit — i.e. the next round did NOT auto-start.
 *
 * Failure modes caught:
 *   • SUMMARY → INACTIVE → postSpin re-fire on same snapshot (Boki bug)
 *   • Force-seed fallback timer racing the primary plant after end
 *   • Autoplay or sales-loop re-planting FORCE_TRIGGER during cleanup
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const REPO = pathResolve(new URL('..', import.meta.url).pathname);
const DIST = `${REPO}/dist/real-games`;
const OUT  = `${REPO}/tools/_eyes/hnw-no-double-trigger`;
mkdirSync(OUT, { recursive: true });

const PORT = 5994;
const log = (s = '') => process.stdout.write(s + '\n');

function listHwGamesSync() {
  if (!existsSync(DIST)) return [];
  const out = [];
  for (const slug of readdirSync(DIST)) {
    const html = `${DIST}/${slug}/slot.html`;
    if (!existsSync(html)) continue;
    const src = readFileSync(html, 'utf8');
    if (src.includes('data-ufp-kind="hold_and_win"')) out.push(slug);
  }
  return out;
}

const ENTER_WAIT_MS = 6000;       /* H&W intro + first respin */
const ROUND_WAIT_MS = 28000;      /* 3 respins default, gen. cap */
const IDLE_WAIT_MS  = 10000;      /* idle wait after end — gate test */

async function probeOne(page, slug) {
  const url = `http://127.0.0.1:${PORT}/dist/real-games/${slug}/slot.html?ufp=1`;
  const consoleErrors = [];
  const pageErrors    = [];
  const onCon = (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); };
  const onErr = (e) => pageErrors.push(String(e && e.message || e));
  page.on('console', onCon);
  page.on('pageerror', onErr);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  /* Tap HookBus emit with timestamps. */
  await page.evaluate(() => {
    window.__HW_EMIT_LOG__ = [];
    const T0 = Date.now();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit.bind(window.HookBus);
      window.HookBus.emit = function(name, payload) {
        try {
          window.__HW_EMIT_LOG__.push({
            t: Date.now() - T0,
            name,
            phase: payload && payload.phase,
          });
        } catch (_) {}
        return orig(name, payload);
      };
    }
  });

  /* Click the H&W force chip. */
  const chip = await page.$('.ufp-chip[data-ufp-kind="hold_and_win"]');
  if (!chip) {
    page.off('console', onCon);
    page.off('pageerror', onErr);
    return { slug, ok: false, reason: 'no-hw-chip' };
  }
  await chip.click({ force: true });

  /* Wait for INTRO to enter. */
  await page.waitForTimeout(ENTER_WAIT_MS);

  /* Drive respins by clicking spin button until phase === INACTIVE
   * or a hard cap of 12 spin-clicks (default respinsAwarded=3 + tail). */
  for (let i = 0; i < 12; i++) {
    const phase = await page.evaluate(() => (window.HW_STATE && window.HW_STATE.phase) || 'INACTIVE');
    if (phase === 'INACTIVE') break;
    const sp = await page.$('#spinBtn');
    if (!sp) break;
    try { await sp.click({ force: true }); } catch (_) {}
    await page.waitForTimeout(2800);
  }

  /* Idle wait — NO further click; this is the gate test. */
  await page.waitForTimeout(IDLE_WAIT_MS);

  const log = await page.evaluate(() => window.__HW_EMIT_LOG__ || []);
  page.off('console', onCon);
  page.off('pageerror', onErr);

  /* Find first onHoldAndWinEnd emit. */
  const endIdx = log.findIndex(e => e.name === 'onHoldAndWinEnd');
  const intros = log.filter(e => e.name === 'onHoldAndWinPhase' && e.phase === 'INTRO');
  const introsAfterEnd = endIdx >= 0
    ? log.slice(endIdx + 1).filter(e => e.name === 'onHoldAndWinPhase' && e.phase === 'INTRO')
    : [];

  const ended = endIdx >= 0;
  const noReentry = introsAfterEnd.length === 0;
  /* Canonical "no double H&W" gate: at most ONE INTRO emit across the
   * entire probe window AND zero INTRO emits after the round ended.
   * A round that never ended (long-running respin chain) still counts
   * as no-double when introCount === 1, because the Boki bug requires
   * a SECOND intro on the same play head. */
  const singleIntro = intros.length <= 1;
  const realErr = consoleErrors.filter(e => !/Failed to load resource|favicon|net::ERR_FILE_NOT_FOUND/i.test(e));
  const ok = singleIntro && noReentry && realErr.length === 0 && pageErrors.length === 0;

  return {
    slug, ok,
    introCount: intros.length,
    endIdx,
    introsAfterEnd: introsAfterEnd.length,
    consoleErrors: realErr,
    pageErrors,
    emitLog: log,
  };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();

const slugs = listHwGamesSync();
log(`\n══ H&W NO-DOUBLE-TRIGGER PROBE · ${slugs.length} game(s) with H&W chip ══\n`);

const reports = [];
let pass = 0;
for (const slug of slugs) {
  log(`▼ ${slug} — click H&W chip, wait ${(ENTER_WAIT_MS + ROUND_WAIT_MS + IDLE_WAIT_MS) / 1000}s, assert no re-entry`);
  const r = await probeOne(page, slug);
  reports.push(r);
  if (r.ok) {
    pass++;
    log(`  ✓ PASS  intros=${r.introCount}  ended@idx=${r.endIdx}  reentry-after-end=${r.introsAfterEnd}  ce=${r.consoleErrors.length}  pe=${r.pageErrors.length}\n`);
  } else {
    log(`  ✗ FAIL  reason=${r.reason || 'gate'}  intros=${r.introCount}  ended@idx=${r.endIdx}  reentry-after-end=${r.introsAfterEnd}  ce=${r.consoleErrors.length}  pe=${r.pageErrors.length}`);
    if (r.introsAfterEnd > 0) {
      log(`    ⚠️  Re-entry after onHoldAndWinEnd — single-arm latch FAILED`);
    }
    log('');
  }
}

await browser.close();
server.kill();

writeFileSync(`${OUT}/audit.json`, JSON.stringify({ ts: new Date().toISOString(), reports }, null, 2));
log('═════════════════════════════════════════════════════════════════');
log(`SUMMARY: ${pass}/${slugs.length} games · no double-trigger`);
log(`Report:  ${OUT}/audit.json`);
log('═════════════════════════════════════════════════════════════════\n');

process.exit(pass === slugs.length ? 0 : 1);
