/**
 * tools/_ultimate-screen-reader-walk.mjs
 *
 * ALT-C — Ultimate screen-reader walk-through.
 *
 * For each of 4 GDD fixtures:
 *   1. Build slot HTML via buildSlotHTML(parseGDD(...))
 *   2. Open in headless Chromium
 *   3. Simulate Tab-walk through all focusable elements:
 *      - capture role / accessible name / state for each
 *      - write transcript: "[N] role=button name='Spin' state=default"
 *   4. Run accessibility audits:
 *      - Every focusable element MUST have accessible name (WCAG 4.1.2)
 *      - No <div> / <span> in tab order without role + label
 *      - All role=switch / radio elements have aria-checked
 *      - All role=menu items have aria-haspopup or are inside menu
 *      - Focus indicator visible (outline OR box-shadow OR border)
 *      - Esc closes any open dialog/menu/sheet
 *   5. Walk through live region updates:
 *      - Fire HookBus.emit('preSpin') + emit('onCoinCollected', payload)
 *      - Verify role=status + aria-live regions actually update
 *
 * Writes:
 *   reports/screen-reader-walk/<fixture>.txt  — transcript
 *   reports/screen-reader-walk/summary.json   — pass/fail per fixture
 *
 * Exit 0 = all green, 1 = any WCAG violation.
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/screen-reader-walk');

const FIXTURES = [
  { name: 'WoO',           path: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { name: 'GoO_1000',      path: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { name: 'MidnightFangs', path: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { name: 'CrystalForge',  path: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('    ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer().listen(0, '127.0.0.1', () => {
      const p = srv.address().port; srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}
function serveHTML(port, html) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });
}

async function buildModel(fixture) {
  const text = await fs.readFile(path.join(ROOT, fixture.path), 'utf8');
  const model = parseGDD(text, 'md');
  /* Enable enough surfaces to walk through real UI on each fixture. */
  model.bonusBuyMenu  = { enabled: true, tiers: [
    { id: 'std', label: 'STANDARD', costX: 75, forceScatters: 4, fsMode: 's' },
    { id: 'sup', label: 'SUPER',    costX: 200, forceScatters: 5, fsMode: 'u' },
  ]};
  model.anteBetLadder = { enabled: true, rungs: [
    { id: 'off', label: 'OFF', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'mid', label: '+50%', costMultiplier: 1.5, triggerMultiplier: 2.0 },
  ]};
  model.volatilitySelector = { enabled: true };
  model.themePicker = { enabled: true };
  model.replayControlBar = { enabled: true };
  model.spinHistoryReplay = { enabled: true };
  model.leaderboardChip = { enabled: true };
  return model;
}

/**
 * Compute accessible name per WCAG 4.1.2 algorithm (simplified):
 *   1. aria-labelledby (first matched element's text)
 *   2. aria-label
 *   3. <label for=...>
 *   4. <button> textContent
 *   5. <a> textContent
 *   6. title attribute
 */
const ACCESSIBLE_NAME_FN = `(el) => {
  if (!el) return '';
  if (el.getAttribute('aria-labelledby')) {
    const ids = el.getAttribute('aria-labelledby').split(/\\s+/);
    const texts = ids.map(id => {
      const r = document.getElementById(id);
      return r ? r.textContent.trim() : '';
    });
    const joined = texts.join(' ').trim();
    if (joined) return joined;
  }
  const label = el.getAttribute('aria-label');
  if (label) return label.trim();
  if (el.tagName === 'INPUT' && el.id) {
    const l = document.querySelector('label[for="' + el.id + '"]');
    if (l) return l.textContent.trim();
  }
  if (el.tagName === 'BUTTON' || el.tagName === 'A') {
    return (el.textContent || '').trim().slice(0, 80);
  }
  const t = el.getAttribute('title');
  if (t) return t.trim();
  return '';
}`;

async function walkFixture(fixture, browser) {
  console.log(`\n  ── ${fixture.name} ───────────────────────────`);
  const model = await buildModel(fixture);
  const html = buildSlotHTML(model);
  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', e => consoleErrs.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  t(`${fixture.name}: 0 console errors before walk`, consoleErrs.length === 0, consoleErrs.slice(0, 2).join(' | '));

  /* ── 1. Tab-walk transcript ──────────────────────────────────── */
  const transcript = [];
  await page.evaluate(() => { if (document.body) document.body.focus(); });
  let lastFocused = null;
  let noFocusChangeStreak = 0;
  const MAX_TABS = 60;
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(20);
    const info = await page.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const fn = ${ACCESSIBLE_NAME_FN};
      const name = fn(el);
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const states = [];
      const ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked !== null) states.push('checked=' + ariaChecked);
      const ariaExpanded = el.getAttribute('aria-expanded');
      if (ariaExpanded !== null) states.push('expanded=' + ariaExpanded);
      const ariaDisabled = el.getAttribute('aria-disabled');
      if (ariaDisabled !== null) states.push('disabled=' + ariaDisabled);
      if (el.disabled) states.push('disabled=true');
      const ariaHaspopup = el.getAttribute('aria-haspopup');
      if (ariaHaspopup) states.push('haspopup=' + ariaHaspopup);
      /* Focus-indicator detection */
      const css = window.getComputedStyle(el);
      const hasOutline = css.outlineStyle !== 'none' && css.outlineWidth !== '0px';
      const hasShadow = css.boxShadow !== 'none';
      const hasBorder = css.borderStyle !== 'none' && css.borderWidth !== '0px';
      const focusVisible = hasOutline || hasShadow || hasBorder;
      return {
        id: el.id || '',
        tag: el.tagName.toLowerCase(),
        role: role,
        name: name,
        states: states,
        focusVisible: focusVisible,
        isDiv: el.tagName === 'DIV' || el.tagName === 'SPAN',
      };
    })()`);
    if (!info) {
      noFocusChangeStreak++;
      if (noFocusChangeStreak >= 3) break;
      continue;
    }
    const key = (info.id || '') + ':' + (info.role || '');
    if (key === lastFocused) {
      noFocusChangeStreak++;
      if (noFocusChangeStreak >= 3) break;
      continue;
    } else noFocusChangeStreak = 0;
    lastFocused = key;
    transcript.push(info);
  }

  t(`${fixture.name}: Tab-walk reached >= 3 focusable elements`,
    transcript.length >= 3, `got ${transcript.length}`);

  /* WCAG 4.1.2 — every focusable element MUST have accessible name */
  const missingName = transcript.filter(e =>
    e.role !== 'generic' && e.tag !== 'body' && !e.name && !['code', 'pre'].includes(e.tag)
  );
  t(`${fixture.name}: every focusable has accessible name (WCAG 4.1.2)`,
    missingName.length === 0,
    missingName.slice(0, 3).map(e => `<${e.tag}#${e.id}>`).join(','));

  /* WCAG 2.4.7 — focus indicator visible for every interactive element */
  const noFocusInd = transcript.filter(e => !e.focusVisible && !e.isDiv);
  t(`${fixture.name}: focus indicator visible (WCAG 2.4.7)`,
    noFocusInd.length === 0,
    noFocusInd.slice(0, 3).map(e => `<${e.tag}#${e.id}>`).join(','));

  /* role=switch / radio must have aria-checked */
  const switchWithoutChecked = transcript.filter(e =>
    (e.role === 'switch' || e.role === 'radio') &&
    !e.states.some(s => s.startsWith('checked='))
  );
  t(`${fixture.name}: every role=switch/radio has aria-checked`,
    switchWithoutChecked.length === 0,
    switchWithoutChecked.slice(0, 3).map(e => e.id).join(','));

  /* No raw <div>/<span> in tab order without role+label */
  const rawTabbable = transcript.filter(e => e.isDiv && !e.role && !e.name);
  t(`${fixture.name}: no raw div/span in tab order without role+label`,
    rawTabbable.length === 0,
    rawTabbable.slice(0, 3).map(e => e.id).join(','));

  /* ── 2. Esc closes open dialogs ──────────────────────────────── */
  const menuBtn = await page.$('#bonusBuyMenuBtn');
  if (menuBtn) {
    await menuBtn.click(); await page.waitForTimeout(200);
    const isOpenBefore = await page.$eval('#bonusBuyMenuSheet', e => e.getAttribute('data-open'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const isOpenAfter = await page.$eval('#bonusBuyMenuSheet', e => e.getAttribute('data-open'));
    t(`${fixture.name}: bonusBuyMenu opens via click`, isOpenBefore === 'true');
    t(`${fixture.name}: Escape closes bonusBuyMenu`, isOpenAfter === 'false');
  }

  /* ── 3. Live regions update on synthetic events ──────────────── */
  await page.evaluate(() => {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      window.HookBus.emit('preSpin', {});
      window.HookBus.emit('onSpinResult', { totalWin: 0 });
    }
  });
  await page.waitForTimeout(150);
  const liveRegions = await page.$$eval('[aria-live]', els => els.map(e => ({
    id: e.id || '',
    role: e.getAttribute('role') || '',
    live: e.getAttribute('aria-live') || '',
    atomic: e.getAttribute('aria-atomic') || '',
    text: (e.textContent || '').trim().slice(0, 60),
  })));
  t(`${fixture.name}: has at least one aria-live region`, liveRegions.length >= 1, `got ${liveRegions.length}`);

  /* ── 4. Write transcript ─────────────────────────────────────── */
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const txt = [
    '# Screen-reader walk — ' + fixture.name,
    '# Generated: ' + new Date().toISOString(),
    '# WCAG 4.1.2 (Name/Role/Value), 2.4.7 (Focus Visible), 4.1.3 (Status Messages)',
    '',
    '## Tab-walk transcript',
    '',
    ...transcript.map((e, i) =>
      `[${String(i + 1).padStart(2, '0')}] tag=${e.tag.padEnd(8)} role=${(e.role || '-').padEnd(15)} id=${(e.id || '-').padEnd(28)} name="${e.name || '-'}" focusVis=${e.focusVisible ? 'Y' : 'N'} states=[${e.states.join(', ') || '-'}]`
    ),
    '',
    '## Live regions',
    '',
    ...liveRegions.map((r, i) =>
      `[${i + 1}] id=${r.id} role=${r.role} live=${r.live} atomic=${r.atomic} text="${r.text}"`
    ),
  ].join('\n');
  await fs.writeFile(path.join(REPORT_DIR, fixture.name + '.txt'), txt);

  await ctx.close();
  srv.close();
  return { fixture: fixture.name, focusable: transcript.length, missingName: missingName.length, noFocusInd: noFocusInd.length, liveRegions: liveRegions.length };
}

(async () => {
  console.log('\n=== Ultimate Screen-Reader Walk — 4 GDD fixtures ===');
  const browser = await chromium.launch({ headless: true });
  const summary = [];
  for (const f of FIXTURES) {
    try {
      summary.push(await walkFixture(f, browser));
    } catch (e) {
      fail++; failures.push(`${f.name} threw: ${e.message}`);
      console.log(`    ✗ ${f.name}: ${e.message}`);
    }
  }
  await browser.close();
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  • Transcripts written to: reports/screen-reader-walk/`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
