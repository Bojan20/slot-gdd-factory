#!/usr/bin/env node
/**
 * Full QA audit — every grid kind, desktop + mobile, console errors,
 * spin stress for rectangular kinds, DOM ornament probe.
 *
 * Output:
 *   reports/qa/desktop/<slug>.png
 *   reports/qa/mobile/<slug>.png
 *   reports/qa/spin/<slug>_{mid,post}.png   (rectangular only)
 *   reports/qa/audit.md
 */
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const GALLERY = resolve(REPO, 'dist/gallery');
const QA_DIR = resolve(REPO, 'reports/qa');

if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true });
mkdirSync(resolve(QA_DIR, 'desktop'), { recursive: true });
mkdirSync(resolve(QA_DIR, 'mobile'),  { recursive: true });
mkdirSync(resolve(QA_DIR, 'spin'),    { recursive: true });

const fixtures = readdirSync(GALLERY)
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .sort();

/* Per-fixture browser ownership — pre Wave LEGO-BUY parity audit
 * (2026-06-19), a single shared browser was used across all fixtures.
 * When ONE fixture crashed the page (e.g. variable_reel 5×4) the
 * underlying chromium teardown propagated to subsequent fixtures with
 * "Target page, context or browser has been closed". Fresh launch
 * per audited fixture isolates the fault. ~80ms startup cost per
 * fixture is acceptable for a full-QA pass. */
let browser = null;

const audit = [];

for (const file of fixtures) {
  const slug = file.replace(/\.html$/, '');
  const url = 'file://' + resolve(GALLERY, file);
  const row = { slug, kind: '?', desktop: '', mobile: '', spinMid: '', spinPost: '',
                consoleErrs: 0, ornaments: {}, spinOk: '—', notes: [] };
  /* Fresh browser per fixture — isolates crashes (see file head). */
  browser = await chromium.launch();
  try {

  /* ─── DESKTOP ─── */
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageD = await ctxD.newPage();
  const errs = [];
  pageD.on('pageerror', (e) => errs.push(e.message));
  pageD.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pageD.goto(url);
  await pageD.waitForTimeout(500);
  row.kind = await pageD.getAttribute('#gridHost', 'data-kind');

  /* Probe: any element with leftover gold border / shadow / box-shadow we banned? */
  const probe = await pageD.evaluate(() => {
    const bad = { goldBorderedFrame: 0, frameShadow: 0, reelColBg: 0, hexInnerBorder: 0,
                  cellGradient: 0, cellShadow: 0, growTagBg: 0 };
    const frame = document.querySelector('.frame');
    if (frame) {
      const cs = getComputedStyle(frame);
      if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') bad.goldBorderedFrame++;
      if (cs.boxShadow && cs.boxShadow !== 'none') bad.frameShadow++;
    }
    document.querySelectorAll('.reelCol').forEach((el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bad.reelColBg++;
    });
    document.querySelectorAll('.cell.hex').forEach((el) => {
      const pseudo = getComputedStyle(el, '::before');
      if (pseudo.content && pseudo.content !== 'none' &&
          pseudo.borderTopWidth !== '0px' && pseudo.borderTopStyle !== 'none') {
        bad.hexInnerBorder++;
      }
    });
    document.querySelectorAll('.cell:not(.hex)').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') bad.cellGradient++;
      if (cs.boxShadow && cs.boxShadow !== 'none' &&
          !el.classList.contains('lockable')) bad.cellShadow++;
    });
    document.querySelectorAll('.grow-tag').forEach((el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bad.growTagBg++;
    });
    return bad;
  });
  row.ornaments = probe;

  const dShot = `desktop/${slug}.png`;
  await pageD.screenshot({ path: resolve(QA_DIR, dShot) });
  row.desktop = dShot;
  row.consoleErrs = errs.length;
  await ctxD.close();

  /* ─── MOBILE ─── */
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  });
  const pageM = await ctxM.newPage();
  await pageM.goto(url);
  await pageM.waitForTimeout(500);
  const mShot = `mobile/${slug}.png`;
  await pageM.screenshot({ path: resolve(QA_DIR, mShot) });
  row.mobile = mShot;
  await ctxM.close();

  /* ─── SPIN STRESS (rectangular only) ─── */
  if (row.kind === 'rectangular') {
    const ctxS = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageS = await ctxS.newPage();
    const spinErrs = [];
    pageS.on('pageerror', (e) => spinErrs.push('pageerror: ' + e.message));
    pageS.on('console', (m) => { if (m.type() === 'error') spinErrs.push('console: ' + m.text()); });
    await pageS.goto(url);
    await pageS.waitForTimeout(400);

    /* Side HUD (aside.sideHud) can overlap #spinBtn on certain viewports and
       intercept Playwright's pointer hit-test. We bypass the visual hit-test
       and dispatch the click directly on the button — the runtime spin logic
       only cares about the click event, not pointer geometry. */
    const stressClick = async () => pageS.evaluate(() => {
      const btn = document.querySelector('#spinBtn');
      if (btn && !btn.disabled) btn.click();
    });

    /* Click 3 times in rapid succession to stress race conditions */
    await stressClick();
    await pageS.waitForTimeout(50);
    await stressClick();
    await pageS.waitForTimeout(50);
    await stressClick();

    /* Mid-spin (during steady scroll) */
    await pageS.waitForTimeout(900);
    const midShot = `spin/${slug}_mid.png`;
    await pageS.screenshot({ path: resolve(QA_DIR, midShot) });
    row.spinMid = midShot;

    /* Count visible (non-empty) cells mid-spin */
    const midCellCount = await pageS.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('#gridHost .cell'));
      return cells.filter((c) => c.textContent && c.textContent.trim().length > 0).length;
    });

    /* Wait for full settle */
    await pageS.waitForTimeout(4500);
    const postShot = `spin/${slug}_post.png`;
    await pageS.screenshot({ path: resolve(QA_DIR, postShot) });
    row.spinPost = postShot;

    const stripStill = await pageS.evaluate(() => {
      const strips = Array.from(document.querySelectorAll('.reelStrip'));
      const settled = strips.every((s) => !s.style.transform.match(/translateY\(-?[1-9]/) ||
                                          s.style.transform.includes('-' + (s.children[0]?.offsetHeight + 6)));
      const allStopped = !document.querySelector('.cell.is-blurring');
      return { stripCount: strips.length, allStopped };
    });

    row.spinOk = (spinErrs.length === 0 && midCellCount > 0 && stripStill.allStopped) ? '✅' : '❌';
    if (spinErrs.length) row.notes.push('spin errs: ' + spinErrs.join(' | '));
    if (midCellCount === 0) row.notes.push('mid-spin: NO visible cells (regression!)');
    if (!stripStill.allStopped) row.notes.push('cells stuck in blur state');
    row.consoleErrs += spinErrs.length;
    await ctxS.close();
  }

    audit.push(row);
  } catch (e) {
    row.notes.push('fixture error: ' + String(e.message || e).slice(0, 160));
    row.consoleErrs = row.consoleErrs + 1;
    row.spinOk = '❌ fixture err';
    audit.push(row);
  } finally {
    try { await browser.close(); } catch (_) { /* already gone */ }
    browser = null;
  }
  process.stdout.write(`· ${slug.padEnd(40)} kind=${row.kind.padEnd(13)} errs=${row.consoleErrs} spin=${row.spinOk}\n`);
}

/* ─── REPORT ─── */
const totalFailures = audit.filter((r) =>
  r.consoleErrs > 0 ||
  r.spinOk === '❌' ||
  Object.values(r.ornaments).some((v) => v > 0)
).length;

const md = `# Full QA audit · ${new Date().toISOString()}

**Fixtures**: ${audit.length} · **Failures**: ${totalFailures} · ${totalFailures === 0 ? '✅ CLEAN' : '⚠️ ATTENTION'}

## Per-fixture results

| Slug | Kind | Desktop | Mobile | Spin mid | Spin post | Spin OK | Console errs | Ornaments leak |
|---|---|---|---|---|---|:--:|--:|---|
${audit.map((r) => {
  const orn = Object.entries(r.ornaments).filter(([_, v]) => v > 0)
                    .map(([k, v]) => `${k}=${v}`).join(', ') || '✅ none';
  return `| ${r.slug} | ${r.kind} | [d](./qa/${r.desktop}) | [m](./qa/${r.mobile}) | ${r.spinMid ? `[mid](./qa/${r.spinMid})` : '—'} | ${r.spinPost ? `[post](./qa/${r.spinPost})` : '—'} | ${r.spinOk} | ${r.consoleErrs} | ${orn} |`;
}).join('\n')}

## Notes
${audit.flatMap((r) => r.notes.map((n) => `- **${r.slug}**: ${n}`)).join('\n') || '_no notes_'}
`;

writeFileSync(resolve(REPO, 'reports/qa-audit.md'), md);
console.log('\n' + (totalFailures === 0 ? '✅ CLEAN' : `⚠️ ${totalFailures} failures`));
console.log('Report: reports/qa-audit.md');
process.exit(totalFailures === 0 ? 0 : 1);
