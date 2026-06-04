#!/usr/bin/env node
/**
 * Cortex Eyes — Spin/Slam/Skip CTA walkthrough.
 *
 * Click-walks the unified-CTA flow on the rectangular playable build and
 * captures one screenshot per phase. Surfaces EVERY gap as a numbered
 * row in the verdict table so Boki can see exactly where the visual
 * contract breaks.
 *
 * Output dir: tools/_eyes/cta-walkthrough/
 *
 * Phases probed (in click order):
 *   1. IDLE              — pre-click; expect data-state="SPIN", gold icon
 *   2. SPIN_REQUESTED    — instant post-click; spin in flight
 *   3. STOP_PRE          — 300ms after click; reels rotating, CTA red ▣
 *   4. STOP_POST         — after onSpinResult emit; reels stopping
 *   5. SLAM_COMPLETE     — after STOP click; reels collapsed to landed strip
 *   6. WIN_OR_IDLE       — depending on award:
 *                            • award>0   → SKIP_ROLLUP cyan ⏵⏵
 *                            • award==0  → back to SPIN gold
 *   7. SKIP_COMPLETE     — after SKIP click; CTA back to SPIN
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT = resolvePath(REPO, 'tools/_eyes/cta-walkthrough');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const URL = 'http://127.0.0.1:5180/dist/01_rectangular_5x3_playable.html';

/* Helper: snapshot every relevant DOM state we need to reason about. */
async function probeButtonState(page) {
  return await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (!btn) return { error: 'spinBtn not in DOM' };
    const cs = getComputedStyle(btn);
    const visibleIcons = Array.from(btn.querySelectorAll('.spinIcon'))
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => Array.from(el.classList).join('+'));
    /* Also probe what OTHER potentially-conflicting CTAs exist + are visible. */
    const conflicts = [];
    for (const id of ['slamStopBtn', 'forceSkipBtn']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const hidden = el.hidden || getComputedStyle(el).display === 'none';
      if (!hidden) conflicts.push(`${id} visible (V1/V2 should be suppressed when V3 is active)`);
    }
    return {
      dataState: btn.getAttribute('data-state'),
      disabled: btn.disabled,
      ariaLabel: btn.getAttribute('aria-label') || null,
      visibleIcons,
      borderColor: cs.borderColor,
      boxShadowFirst: cs.boxShadow.slice(0, 80),
      conflicts,
    };
  });
}

async function shot(page, name) {
  const p = resolvePath(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

const verdicts = [];

async function record(phaseNo, label, state, expectedDataState, expectedIcon, screenshot) {
  const dataStateOk  = state.dataState === expectedDataState;
  const iconOk       = state.visibleIcons.includes(expectedIcon);
  const conflictsOk  = state.conflicts.length === 0;
  const pass = dataStateOk && iconOk && conflictsOk;
  verdicts.push({
    phase: `${phaseNo}. ${label}`,
    dataState: `${state.dataState} ${dataStateOk ? '✅' : `❌ expected ${expectedDataState}`}`,
    icon: state.visibleIcons.join(',') + ` ${iconOk ? '✅' : `❌ expected ${expectedIcon}`}`,
    conflicts: state.conflicts.length === 0 ? '✅ none' : `❌ ${state.conflicts.join(' | ')}`,
    screenshot,
    pass,
  });
}

async function main() {
  console.log('🧠 CORTEX EYES — Spin/Slam/Skip CTA walkthrough\n');
  console.log(`URL: ${URL}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(URL, { waitUntil: 'networkidle' });

  /* Make sure HookBus is up + capture every emit we care about. */
  await page.evaluate(() => {
    window.__EV__ = [];
    const tracked = [
      'preSpin', 'onSpinResult', 'postSpin',
      'onSlamRequested', 'onSlamComplete',
      'onSkipRequested', 'onSkipComplete',
    ];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      for (const e of tracked) {
        window.HookBus.on(e, (p) => window.__EV__.push({
          t: performance.now(),
          e,
          state: document.getElementById('spinBtn')?.getAttribute('data-state'),
          p,
        }));
      }
    }
  });

  /* ── Phase 1: IDLE ──────────────────────────────────────────────── */
  await page.waitForSelector('#spinBtn', { state: 'visible', timeout: 5000 });
  let snap = await probeButtonState(page);
  let p1 = await shot(page, '01-idle');
  await record(1, 'IDLE (pre-click)', snap, 'SPIN', 'spinIcon+spinIcon--spin', p1);

  /* ── Phase 2 + 3: SPIN_REQUESTED → STOP_PRE ─────────────────────── */
  await page.click('#spinBtn');
  /* Wait long enough for spinControl to flip SPIN → STOP_PRE on preSpin emit. */
  await page.waitForTimeout(120);
  snap = await probeButtonState(page);
  let p2 = await shot(page, '02-stop-pre');
  await record(2, 'STOP_PRE (~120ms post-click)', snap, 'STOP_PRE', 'spinIcon+spinIcon--stop', p2);

  /* ── Phase 4: STOP_POST ───────────────────────────────────────────
   * Wait for onSpinResult emit. spinControl listens at priority -10
   * and flips STOP_PRE → STOP_POST. */
  await page.waitForFunction(
    () => (window.__EV__ || []).some((x) => x.e === 'onSpinResult'),
    null,
    { timeout: 8000 },
  ).catch(() => null);
  await page.waitForTimeout(50);
  snap = await probeButtonState(page);
  let p3 = await shot(page, '03-stop-post');
  await record(3, 'STOP_POST (post onSpinResult)', snap, 'STOP_POST', 'spinIcon+spinIcon--stop', p3);

  /* ── Phase 5: click STOP → slam collapse ─────────────────────────── */
  await page.click('#spinBtn');
  /* Wait for postSpin (means slam → collapse → finalized). */
  await page.waitForFunction(
    () => (window.__EV__ || []).some((x) => x.e === 'postSpin'),
    null,
    { timeout: 8000 },
  ).catch(() => null);
  await page.waitForTimeout(120);
  snap = await probeButtonState(page);
  let p4 = await shot(page, '04-post-slam');
  /* Expected state branches:
   *   if win → SKIP_ROLLUP
   *   if no win → SPIN
   * Both branches valid per industry contract. We accept either, but
   * record which branch. */
  const expectedAfterSlam = (snap.dataState === 'SKIP_ROLLUP') ? 'SKIP_ROLLUP' : 'SPIN';
  const expectedIconAfter = (expectedAfterSlam === 'SKIP_ROLLUP')
    ? 'spinIcon+spinIcon--skip'
    : 'spinIcon+spinIcon--spin';
  await record(4, `POST_SLAM (→ ${expectedAfterSlam})`, snap, expectedAfterSlam, expectedIconAfter, p4);

  /* ── Phase 6: click SKIP if visible, else verify settled IDLE ────── */
  if (snap.dataState === 'SKIP_ROLLUP') {
    await page.click('#spinBtn');
    await page.waitForFunction(
      () => (window.__EV__ || []).some((x) => x.e === 'onSkipComplete'),
      null,
      { timeout: 4000 },
    ).catch(() => null);
    await page.waitForTimeout(80);
    snap = await probeButtonState(page);
    let p5 = await shot(page, '05-after-skip');
    await record(5, 'POST_SKIP (back to IDLE)', snap, 'SPIN', 'spinIcon+spinIcon--spin', p5);
  } else {
    /* No skip phase to test — record N/A. */
    verdicts.push({
      phase: '5. POST_SKIP',
      dataState: 'n/a (spin had no rollup-worthy win)',
      icon: '—',
      conflicts: '—',
      screenshot: '—',
      pass: true,
    });
  }

  /* ── Final dump of every captured event for the audit trail. ────── */
  const events = await page.evaluate(() => window.__EV__);

  await browser.close();

  /* ── Summary table ───────────────────────────────────────────────── */
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 PHASE-BY-PHASE VERDICT');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const v of verdicts) {
    console.log(`\n  ${v.pass ? '✅' : '❌'}  ${v.phase}`);
    console.log(`     data-state : ${v.dataState}`);
    console.log(`     icon       : ${v.icon}`);
    console.log(`     conflicts  : ${v.conflicts}`);
    console.log(`     screenshot : ${v.screenshot}`);
  }
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`📡 ${events.length} HookBus events captured during walk`);
  for (const ev of events) {
    console.log(`   [${Math.round(ev.t).toString().padStart(5)}ms] ${ev.e.padEnd(18)} state=${ev.state || '∅'}`);
  }

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`Console errors: ${consoleErrs.length}`);
  for (const e of consoleErrs.slice(0, 8)) console.log(`   • ${e}`);

  const passed = verdicts.filter((v) => v.pass).length;
  const failed = verdicts.length - passed;
  console.log(`\n${failed === 0 ? '✅' : '❌'} OVERALL: ${passed}/${verdicts.length} phases pass · ${consoleErrs.length} console errors\n`);
  process.exit(failed === 0 && consoleErrs.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
