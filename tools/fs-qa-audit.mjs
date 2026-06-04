#!/usr/bin/env node
/**
 * Free-Spins QA audit — every fixture, full FS lifecycle.
 *
 * For each fixture:
 *   1. Open in headless Chromium.
 *   2. Verify dev FS button state matches FREESPINS.enabled.
 *   3. If FS enabled, click dev FS button.
 *   4. Assert intro overlay visible + correct copy + spins count.
 *   5. Screenshot intro.
 *   6. Click "TAP TO BEGIN" CTA.
 *   7. Assert overlay hidden, HUD visible, body has .fs-mode-* class.
 *   8. Screenshot mid-FS (during the 1st spin).
 *   9. Wait for FS round to complete (auto-driven).
 *  10. Assert outro overlay visible with TOTAL WIN copy.
 *  11. Screenshot outro.
 *  12. Click "RETURN TO BASE" CTA.
 *  13. Assert overlay hidden, HUD hidden, body has no fs-mode-* class.
 *  14. Screenshot back-to-base.
 *  15. Record console errors throughout.
 *
 * Output:
 *   reports/qa/fs/<slug>/{intro,active,outro,base}.png
 *   reports/fs-audit.md
 */
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const GALLERY = resolve(REPO, 'dist/gallery');
const QA_DIR = resolve(REPO, 'reports/qa/fs');

if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true });
mkdirSync(QA_DIR, { recursive: true });

const fixtures = readdirSync(GALLERY)
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .sort();

const browser = await chromium.launch();

/* Run fixtures in parallel batches — each FS round can take 30-90s, so
   serial execution is intolerable; parallel pulls it down to ~one full
   round per batch. 4-wide gives a good memory/perf balance. */
const BATCH = 4;
const audit = [];

async function runOne(file) {
  const slug = file.replace(/\.html$/, '');
  const slugDir = resolve(QA_DIR, slug);
  mkdirSync(slugDir, { recursive: true });
  const url = 'file://' + resolve(GALLERY, file);
  const row = {
    slug, kind: '?', fsEnabled: false,
    introOk: '—', activeOk: '—', outroOk: '—', baseOk: '—',
    spinsPlayed: 0, totalWin: 0, retrigCount: 0, finalMult: 1,
    consoleErrs: 0, notes: [],
    screens: {},
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(400);

  row.kind = await page.getAttribute('#gridHost', 'data-kind');
  const fsState = await page.evaluate(() => ({
    enabled: window.FREESPINS && window.FREESPINS.enabled,
    awards: window.FREESPINS && window.FREESPINS.awards,
    mult: window.FREESPINS && window.FREESPINS.multiplier,
    retrig: window.FREESPINS && window.FREESPINS.retrigger,
    bgMode: window.FREESPINS && window.FREESPINS.bgMode,
  }));
  row.fsEnabled = !!fsState.enabled;

  if (!row.fsEnabled) {
    /* No FS in this GDD — just verify the dev FS button is disabled. */
    const devDisabled = await page.evaluate(() => {
      const b = document.getElementById('devFsBtn');
      return !!(b && b.disabled);
    });
    row.introOk = devDisabled ? '✅ FS off (button disabled)' : '⚠️ FS off but button enabled';
    row.consoleErrs = errs.length;
    await ctx.close();
    process.stdout.write(`· ${slug.padEnd(40)} kind=${row.kind.padEnd(13)} FS=disabled\n`);
    return row;
  }

  /* ── 1. Click dev FS button → spin sequence → intro overlay ─────────
     The dev FS button no longer jumps straight to the placard — it forces
     a real spin with the trigger outcome planted. We poll the FSM phase
     until it reports FS_INTRO (rectangular: ~2.5s spin + 0.55s settle;
     non-rectangular: ~0.5s reroll + 0.55s settle). */
  await page.evaluate(() => document.getElementById('devFsBtn').click());
  const introWait = Date.now() + 8000;
  while (Date.now() < introWait) {
    await page.waitForTimeout(200);
    const ph = await page.evaluate(() => window.FSM && window.FSM.phase);
    if (ph === 'FS_INTRO') break;
  }
  await page.waitForTimeout(400); /* let the fade-in finish */
  const introState = await page.evaluate(() => {
    const ov = document.getElementById('fsOverlay');
    const placardSpins = document.getElementById('fsPlacardSpins');
    return {
      overlayVisible: ov.classList.contains('fs-overlay--show'),
      cta: document.getElementById('fsPlacardCta').textContent.trim(),
      placardSpins: placardSpins.textContent.trim(),
      title: document.getElementById('fsPlacardTitle').textContent.trim(),
      spinBtnDisabled: document.getElementById('spinBtn').disabled,
      devBtnDisabled:  document.getElementById('devFsBtn').disabled,
    };
  });
  /* Award must be ONE of the spin counts in the configured ladder. We can't
     pin it to awards[0] anymore because the new force-trigger flow plants
     N scatters on the first N reels but the rest of the grid is random —
     so an extra scatter can organically bump the award up the ladder. */
  const ladderSpins = fsState.awards.map(a => String(a.spins));
  if (introState.overlayVisible &&
      introState.cta === 'TAP TO BEGIN' &&
      ladderSpins.includes(introState.placardSpins) &&
      introState.spinBtnDisabled && introState.devBtnDisabled) {
    row.introOk = '✅ ' + introState.placardSpins + ' FS';
  } else {
    row.introOk = '❌ intro state wrong';
    row.notes.push('intro: ' + JSON.stringify(introState));
  }
  row.screens.intro = `qa/fs/${slug}/intro.png`;
  await page.screenshot({ path: resolve(QA_DIR, slug, 'intro.png') });

  /* ── 2. Click CTA → enter active ─────────────────────────────── */
  await page.evaluate(() => document.getElementById('fsPlacardCta').click());
  await page.waitForTimeout(700);  /* enterActive delay + first spin start */
  const activeState = await page.evaluate(() => ({
    overlayVisible: document.getElementById('fsOverlay').classList.contains('fs-overlay--show'),
    hudVisible: document.getElementById('fsHud').classList.contains('fs-hud--active'),
    bodyMode: Array.from(document.body.classList).find(c => c.startsWith('fs-mode-')) || null,
    status: document.getElementById('status').textContent,
    phase: window.FSM && window.FSM.phase,
  }));
  if (!activeState.overlayVisible && activeState.hudVisible &&
      activeState.bodyMode && activeState.phase === 'FS_ACTIVE') {
    row.activeOk = '✅ ' + activeState.bodyMode;
  } else {
    row.activeOk = '❌';
    row.notes.push('active: ' + JSON.stringify(activeState));
  }
  /* Screenshot mid-FS — should show the HUD + an FS mode background. */
  await page.waitForTimeout(800);
  row.screens.active = `qa/fs/${slug}/active.png`;
  await page.screenshot({ path: resolve(QA_DIR, slug, 'active.png') });

  /* ── 3. Wait for the whole FS round to finish (poll the FSM phase) ─ */
  /* Budget raised to 300s — BG and FS now share the same cinematic
     SPIN_PROFILE (no faster FS tempo). Cluster 7×7 + 35-spin FS round =
     ~120s spin time + intro/outro overhead, so 120s budget no longer
     fits. 300s is generous; a real FS round on real hardware finishes
     well under the cap. */
  const maxWaitMs = 300_000;
  const pollMs    = 400;
  const start     = Date.now();
  /* Defensive try/catch: under parallel-batch execution Playwright may
     decide to tear down the context if another fixture in the same batch
     throws — the throw bubbles up via `Target page, context or browser
     has been closed`. We swallow it locally and let the outer post-loop
     code mark the row as failed so the whole audit run can complete. */
  let pageClosedDuringPoll = false;
  while ((Date.now() - start) < maxWaitMs) {
    try {
      await page.waitForTimeout(pollMs);
      const phase = await page.evaluate(() => window.FSM && window.FSM.phase);
      if (phase === 'FS_OUTRO') break;
      if (phase === 'BASE') break;  /* shouldn't happen before outro, but bail safely */
    } catch (e) {
      /* Browser/context/page closed mid-poll. Record and exit the loop
         so the batch finalizer can still print a row for this fixture. */
      pageClosedDuringPoll = true;
      row.notes.push('outro-wait: page closed mid-poll — ' + String(e.message || e).slice(0, 120));
      break;
    }
  }
  if (pageClosedDuringPoll) {
    /* Skip downstream waitForSelector + evaluate calls — they would
       throw on a closed page. Mark row as failed and return early. */
    row.outroOk = '❌ page closed';
    row.baseOk  = '❌ page closed';
    row.consoleErrs = 1;
    process.stdout.write(`· ${slug.padEnd(40)} kind=${row.kind.padEnd(13)} ` +
      `intro=${row.introOk} active=${row.activeOk.split(' ')[0]} ` +
      `outro=${row.outroOk} base=${row.baseOk} spins=? retrig=? errs=1\n`);
    try { await ctx.close(); } catch (_) { /* already gone */ }
    return row;
  }

  /* Outro overlay fade-in is 320ms; wait for the CTA to actually be visible
     before probing & clicking. waitForSelector handles animation properly. */
  try {
    await page.waitForSelector('#fsPlacardCta', { state: 'visible', timeout: 5000 });
  } catch (_) { /* fall through — outroState check will flag failure */ }

  /* ── 4. Outro state ─────────────────────────────────────────────── */
  const outroState = await page.evaluate(() => ({
    phase: window.FSM && window.FSM.phase,
    overlayVisible: document.getElementById('fsOverlay').classList.contains('fs-overlay--show'),
    title: document.getElementById('fsPlacardTitle').textContent.trim(),
    total: document.getElementById('fsPlacardSpins').textContent.trim(),
    cta: document.getElementById('fsPlacardCta').textContent.trim(),
    fsm: { ...window.FSM },
  }));
  if (outroState.phase === 'FS_OUTRO' &&
      outroState.overlayVisible &&
      outroState.title === 'TOTAL WIN' &&
      outroState.cta === 'RETURN TO BASE') {
    row.outroOk = '✅';
  } else {
    row.outroOk = '❌';
    row.notes.push('outro: ' + JSON.stringify(outroState));
  }
  row.spinsPlayed   = outroState.fsm.spinsTotal;
  row.totalWin      = Number((outroState.fsm.totalWin || 0).toFixed(2));
  row.retrigCount   = outroState.fsm.retrigCount || 0;
  row.finalMult     = outroState.fsm.mult || 1;
  row.screens.outro = `qa/fs/${slug}/outro.png`;
  await page.screenshot({ path: resolve(QA_DIR, slug, 'outro.png') });

  /* ── 5. Click "RETURN TO BASE" → back to base state ───────────── */
  await page.evaluate(() => document.getElementById('fsPlacardCta').click());
  await page.waitForTimeout(400);
  const baseState = await page.evaluate(() => ({
    phase: window.FSM && window.FSM.phase,
    overlayVisible: document.getElementById('fsOverlay').classList.contains('fs-overlay--show'),
    hudVisible: document.getElementById('fsHud').classList.contains('fs-hud--active'),
    bodyMode: Array.from(document.body.classList).find(c => c.startsWith('fs-mode-')) || null,
    spinBtnDisabled: document.getElementById('spinBtn').disabled,
    status: document.getElementById('status').textContent,
  }));
  if (baseState.phase === 'BASE' &&
      !baseState.overlayVisible && !baseState.hudVisible &&
      !baseState.bodyMode && !baseState.spinBtnDisabled) {
    row.baseOk = '✅';
  } else {
    row.baseOk = '❌';
    row.notes.push('base: ' + JSON.stringify(baseState));
  }
  row.screens.base = `qa/fs/${slug}/base.png`;
  await page.screenshot({ path: resolve(QA_DIR, slug, 'base.png') });

  row.consoleErrs = errs.length;
  if (errs.length) row.notes.push('console errs: ' + errs.join(' | '));

  process.stdout.write(`· ${slug.padEnd(40)} kind=${row.kind.padEnd(13)} ` +
    `intro=${row.introOk} active=${row.activeOk.split(' ')[0]} ` +
    `outro=${row.outroOk} base=${row.baseOk} spins=${row.spinsPlayed} ` +
    `retrig=${row.retrigCount} errs=${row.consoleErrs}\n`);

  await ctx.close();
  return row;
}

/* Batched parallel execution. */
for (let i = 0; i < fixtures.length; i += BATCH) {
  const batch = fixtures.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(runOne));
  audit.push(...results);
}

await browser.close();

const failures = audit.filter((r) =>
  r.consoleErrs > 0 ||
  (r.fsEnabled && (r.introOk[0] === '❌' || r.activeOk[0] === '❌' ||
                   r.outroOk[0] === '❌' || r.baseOk[0] === '❌'))
).length;

const md = `# Free-Spins QA audit · ${new Date().toISOString()}

**Fixtures**: ${audit.length} · **FS-enabled**: ${audit.filter(r => r.fsEnabled).length} · **Failures**: ${failures} · ${failures === 0 ? '✅ CLEAN' : '⚠️ ATTENTION'}

## Per-fixture results

| Slug | Kind | FS | Intro | Active | Outro | Base | Spins | Retrig | Mult | Total | Errs |
|---|---|:--:|---|---|---|---|--:|--:|--:|--:|--:|
${audit.map((r) => `| ${r.slug} | ${r.kind} | ${r.fsEnabled ? '✅' : '⊝'} | ${r.introOk} | ${r.activeOk} | ${r.outroOk} | ${r.baseOk} | ${r.spinsPlayed} | ${r.retrigCount} | ×${r.finalMult} | ${r.totalWin} | ${r.consoleErrs} |`).join('\n')}

## Screenshots (FS-enabled fixtures only)

${audit.filter(r => r.fsEnabled).map((r) => `### ${r.slug} (${r.kind})

- intro: [\`${r.screens.intro}\`](./${r.screens.intro})
- active: [\`${r.screens.active}\`](./${r.screens.active})
- outro: [\`${r.screens.outro}\`](./${r.screens.outro})
- base:  [\`${r.screens.base}\`](./${r.screens.base})`).join('\n\n')}

## Notes
${audit.flatMap((r) => r.notes.map((n) => `- **${r.slug}**: ${n}`)).join('\n') || '_no notes_'}
`;

writeFileSync(resolve(REPO, 'reports/fs-audit.md'), md);
console.log('\n' + (failures === 0 ? '✅ CLEAN' : `⚠️ ${failures} failures`));
console.log('Report: reports/fs-audit.md');
process.exit(failures === 0 ? 0 : 1);
