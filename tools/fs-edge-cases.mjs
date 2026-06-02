#!/usr/bin/env node
/**
 * Free-Spins EDGE CASE audit — hammer at every race/abuse vector that
 * could break the FSM. Runs against a single representative rectangular
 * fixture (WoO) plus one non-rectangular (pyramid).
 *
 * Scenarios:
 *   1. Double-click dev FS button mid-intro      — must not stack triggers
 *   2. Click SPIN button during FS_ACTIVE        — must be ignored
 *   3. Click SPIN during FS_INTRO                — must be ignored (disabled)
 *   4. Click dev FS during FS_ACTIVE             — must be ignored (disabled)
 *   5. Click dev FS during FS_OUTRO              — must be ignored (disabled)
 *   6. Skip intro CTA with rapid double-click    — must enter active once
 *   7. Full FS round → return → trigger again    — must work cleanly twice
 *   8. Trigger FS, refresh page mid-round        — must reset cleanly
 *   9. Window resize during FS_ACTIVE            — layout must not break
 *  10. FS round with multiplier progression      — mult must climb & cap
 *
 * Each scenario asserts post-state via window.FSM probes and counts
 * console errors. Reports any deviation.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'reports/qa/fs-edge');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

async function newPage(slug, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file://' + resolve(REPO, 'dist/gallery', slug + '.html'));
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

function record(name, slug, pass, note, errs) {
  const status = pass && (!errs || errs.length === 0) ? '✅' : '❌';
  results.push({ name, slug, status, note: note || '', errs: errs ? errs.length : 0 });
  process.stdout.write(`· ${name.padEnd(48)} [${slug.padEnd(28)}] ${status} ${note || ''}\n`);
}

const fix1 = 'wrath_of_olympus_game_gdd';        // rectangular, real FS GDD
const fix2 = '08_pyramid_game_gdd';              // non-rectangular, default FS
const click = (page, sel) =>
  page.evaluate((s) => document.getElementById(s.replace('#', '')).click(), sel);

/* Wait for FSM.phase to become target. The dev FS button now runs a real
   spin (rectangular ~2.5s, non-rect ~0.5s) before the intro placard, so a
   bare 300ms timeout is no longer enough. */
async function waitFor(page, targetPhase, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const p = await page.evaluate(() => window.FSM && window.FSM.phase);
    if (p === targetPhase) return p;
  }
  return null;
}

/* ─── Scenario 1: double-click dev FS mid-spin ──────────────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  /* Second click immediately — should be a no-op because btn is disabled. */
  await page.waitForTimeout(100);
  await click(page, '#devFsBtn');
  /* Now wait for the spin to settle and the intro to fade in. */
  await waitFor(page, 'FS_INTRO');
  const fsm = await page.evaluate(() => ({ phase: FSM.phase, total: FSM.spinsTotal }));
  record('1. double-click dev FS during forced spin', fix1,
    fsm.phase === 'FS_INTRO' && fsm.total >= 14,
    `phase=${fsm.phase} total=${fsm.total}`, errs);
  await ctx.close();
}

/* ─── Scenario 2: click SPIN during FS_ACTIVE ────────────────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta'); /* enter active */
  await page.waitForTimeout(600);
  const phaseBefore = await page.evaluate(() => FSM.phase);
  /* SPIN btn is disabled in active phase — verify .click() does nothing. */
  await page.evaluate(() => document.getElementById('spinBtn').click());
  await page.waitForTimeout(300);
  const phaseAfter = await page.evaluate(() => FSM.phase);
  record('2. SPIN click during FS_ACTIVE ignored', fix1,
    phaseBefore === 'FS_ACTIVE' && phaseAfter === 'FS_ACTIVE',
    `before=${phaseBefore} after=${phaseAfter}`, errs);
  await ctx.close();
}

/* ─── Scenario 3: SPIN click during FS_INTRO ─────────────────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(200);
  /* SPIN btn must be disabled while intro overlay is up. */
  const disabled = await page.evaluate(() => document.getElementById('spinBtn').disabled);
  await page.evaluate(() => document.getElementById('spinBtn').click());
  await page.waitForTimeout(200);
  const phase = await page.evaluate(() => FSM.phase);
  record('3. SPIN click during FS_INTRO blocked', fix1,
    disabled === true && phase === 'FS_INTRO',
    `btnDisabled=${disabled} phase=${phase}`, errs);
  await ctx.close();
}

/* ─── Scenario 4-5 combined: dev FS during FS_ACTIVE & FS_OUTRO ──────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta'); /* active */
  await page.waitForTimeout(600);
  /* During active, dev btn must be disabled. */
  const devDisabledActive = await page.evaluate(() => document.getElementById('devFsBtn').disabled);
  /* Wait for outro. */
  const max = Date.now() + 90_000;
  while (Date.now() < max) {
    await page.waitForTimeout(400);
    const p = await page.evaluate(() => FSM.phase);
    if (p === 'FS_OUTRO') break;
  }
  const devDisabledOutro = await page.evaluate(() => document.getElementById('devFsBtn').disabled);
  record('4. dev FS during FS_ACTIVE disabled', fix1,
    devDisabledActive === true, `disabled=${devDisabledActive}`, errs);
  record('5. dev FS during FS_OUTRO disabled', fix1,
    devDisabledOutro === true, `disabled=${devDisabledOutro}`, errs);
  await ctx.close();
}

/* ─── Scenario 6: rapid double-click intro CTA ───────────────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');
  await click(page, '#fsPlacardCta'); /* 2nd should be ignored (phase changed) */
  await page.waitForTimeout(700);
  const phase = await page.evaluate(() => FSM.phase);
  record('6. rapid double-click intro CTA', fix1,
    phase === 'FS_ACTIVE',
    `phase=${phase}`, errs);
  await ctx.close();
}

/* ─── Scenario 7: full FS round → return → trigger again ─────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  /* Round 1 */
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');
  /* Wait for outro */
  let max = Date.now() + 120_000;
  while (Date.now() < max) {
    await page.waitForTimeout(400);
    const p = await page.evaluate(() => FSM.phase);
    if (p === 'FS_OUTRO') break;
  }
  await page.waitForTimeout(500);
  await click(page, '#fsPlacardCta'); /* back to base */
  await page.waitForTimeout(400);
  const phaseAfterReturn = await page.evaluate(() => FSM.phase);

  /* Round 2 — should work identically. With the new force-trigger flow the
     dev btn kicks a spin first, so we must waitFor(FS_INTRO) before probing. */
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  const intro2 = await page.evaluate(() => ({
    phase: FSM.phase, total: FSM.spinsTotal, mult: FSM.mult, retrig: FSM.retrigCount,
  }));
  record('7. round → return → round again (state reset)', fix1,
    phaseAfterReturn === 'BASE' && intro2.phase === 'FS_INTRO' &&
    intro2.total >= 14 && intro2.mult === 1 && intro2.retrig === 0,
    `phase=${intro2.phase} total=${intro2.total} mult=${intro2.mult} retrig=${intro2.retrig}`,
    errs);
  await ctx.close();
}

/* ─── Scenario 8: page refresh during FS_ACTIVE resets cleanly ───────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');
  await page.waitForTimeout(1500); /* mid-round */
  await page.reload();
  await page.waitForTimeout(500);
  const phase = await page.evaluate(() => FSM.phase);
  const overlayHidden = await page.evaluate(() => !document.getElementById('fsOverlay').classList.contains('fs-overlay--show'));
  const bodyClean = await page.evaluate(() => !Array.from(document.body.classList).some(c => c.startsWith('fs-mode-')));
  record('8. page reload mid-FS resets to BASE cleanly', fix1,
    phase === 'BASE' && overlayHidden && bodyClean,
    `phase=${phase} overlayHidden=${overlayHidden} bodyClean=${bodyClean}`, errs);
  await ctx.close();
}

/* ─── Scenario 9: viewport resize during FS_ACTIVE ───────────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 380, height: 700 });
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => ({
    phase: FSM.phase,
    hudVisible: document.getElementById('fsHud').classList.contains('fs-hud--active'),
    framePresent: !!document.getElementById('frameHost'),
  }));
  record('9. viewport resize mid-FS doesn\'t break layout', fix1,
    layout.phase === 'FS_ACTIVE' && layout.hudVisible && layout.framePresent,
    JSON.stringify(layout), errs);
  await page.screenshot({ path: resolve(OUT, 'resize_mid_fs.png') });
  await ctx.close();
}

/* ─── Scenario 10: progressive multiplier climbs & caps ──────────────── */
{
  const { ctx, page, errs } = await newPage(fix1);
  /* WoO multiplier: progressive, start=1, step=1, cap=10 */
  const cfg = await page.evaluate(() => FREESPINS.multiplier);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');

  /* Snapshot mult after each detected phase change to verify monotone climb. */
  const samples = [];
  const max = Date.now() + 120_000;
  while (Date.now() < max) {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({
      phase: FSM.phase, mult: FSM.mult, spinsRem: FSM.spinsRemaining, total: FSM.spinsTotal,
    }));
    samples.push(s.mult);
    if (s.phase === 'FS_OUTRO') break;
  }
  const monotone = samples.every((v, i) => i === 0 || v >= samples[i - 1]);
  const capped   = Math.max(...samples) <= cfg.cap;
  const climbed  = Math.max(...samples) > cfg.start; /* should rise above start */
  record('10. multiplier monotone climb & cap respected', fix1,
    monotone && capped && climbed,
    `start=${cfg.start} cap=${cfg.cap} maxSeen=${Math.max(...samples)} samples=${samples.length}`,
    errs);
  await ctx.close();
}

/* ─── Scenario 11: non-rectangular static reroll still completes ─────── */
{
  const { ctx, page, errs } = await newPage(fix2);
  await click(page, '#devFsBtn');
  await waitFor(page, 'FS_INTRO');
  await page.waitForTimeout(300);
  await click(page, '#fsPlacardCta');
  const max = Date.now() + 120_000;
  while (Date.now() < max) {
    await page.waitForTimeout(400);
    const p = await page.evaluate(() => FSM.phase);
    if (p === 'FS_OUTRO') break;
  }
  await page.waitForTimeout(500);
  await click(page, '#fsPlacardCta');
  await page.waitForTimeout(400);
  const finalPhase = await page.evaluate(() => FSM.phase);
  record('11. non-rectangular runStaticReroll round completes', fix2,
    finalPhase === 'BASE', `phase=${finalPhase}`, errs);
  await ctx.close();
}

await browser.close();

const failures = results.filter((r) => r.status === '❌').length;

const md = `# Free-Spins edge-case audit · ${new Date().toISOString()}

**Scenarios**: ${results.length} · **Failures**: ${failures} · ${failures === 0 ? '✅ CLEAN' : '⚠️ ATTENTION'}

| # | Scenario | Fixture | Status | Note | Errs |
|---|---|---|:--:|---|--:|
${results.map((r, i) => `| ${i + 1} | ${r.name.replace(/^\d+\.\s*/, '')} | ${r.slug} | ${r.status} | ${r.note} | ${r.errs} |`).join('\n')}
`;

writeFileSync(resolve(REPO, 'reports/fs-edge-audit.md'), md);
console.log('\n' + (failures === 0 ? '✅ CLEAN' : `⚠️ ${failures} failures`));
console.log('Report: reports/fs-edge-audit.md');
process.exit(failures === 0 ? 0 : 1);
