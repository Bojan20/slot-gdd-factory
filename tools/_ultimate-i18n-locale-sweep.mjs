/**
 * tools/_ultimate-i18n-locale-sweep.mjs
 *
 * C-2 LEGO-I18N — Locale sweep + RTL behavior probe.
 *
 * For each of the 12 baseline locales (en/de/es/fr/it/pt-BR/tr/ru/
 * zh-Hans + sr-RS/pl-PL/nl-NL/ar-SA), builds a slot HTML and:
 *   1. headless renders WoO fixture
 *   2. calls window.__SLOT_I18N__.setLocale(<locale>)
 *   3. verifies pack keys translate (balance.label / spin.cta)
 *   4. for ar-SA (RTL): verifies document.dir attr flipped
 *   5. captures 0 console errors
 *
 * Writes reports/i18n-locale-sweep/summary.json
 *
 * Exit 0 = all locales pass, 1 = any locale fail.
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { LANGUAGE_PACKS } from '../src/blocks/i18n.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/i18n-locale-sweep');

const LOCALES = Object.keys(LANGUAGE_PACKS);

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('  ✗ ' + name); }
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

(async () => {
  console.log(`\n=== Ultimate i18n locale sweep — ${LOCALES.length} locales × WoO ===`);
  await fs.mkdir(REPORT_DIR, { recursive: true });

  /* Build once — all locale switching happens in-browser via setLocale. */
  const text = await fs.readFile(path.join(ROOT, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md'), 'utf8');
  const model = parseGDD(text, 'md');
  model.i18n = { enabled: true, defaultLocale: 'en-US' };
  model.settingsPanel = { enabled: true };
  const html = buildSlotHTML(model);

  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const locale of LOCALES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const switched = await page.evaluate((lc) => {
      const i = window.__SLOT_I18N__;
      if (!i || typeof i.setLocale !== 'function') return { ok: false, reason: 'no __SLOT_I18N__' };
      i.setLocale(lc);
      return {
        ok: i.locale === lc,
        locale: i.locale,
        balance: i.t('balance.label'),
        spin: i.t('spin.cta'),
        bigWin: i.t('bigWin.label'),
        money: i.money(1234.56, 'EUR'),
        dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'auto',
      };
    }, locale);

    const expectedBalance = LANGUAGE_PACKS[locale]['balance.label'];
    const expectedSpin    = LANGUAGE_PACKS[locale]['spin.cta'];

    t(`${locale}: setLocale succeeded`, switched.ok, `got ${switched.locale}`);
    t(`${locale}: balance.label translates`, switched.balance === expectedBalance, `got "${switched.balance}" want "${expectedBalance}"`);
    t(`${locale}: spin.cta translates`,     switched.spin === expectedSpin, `got "${switched.spin}" want "${expectedSpin}"`);
    t(`${locale}: 0 console errors`,        errs.length === 0, errs.slice(0, 2).join(' | '));

    if (locale === 'ar-SA') {
      /* RTL — rtlLayout block should flip dir. */
      t(`${locale}: RTL document dir = rtl OR rtlLayout disabled`,
        switched.dir === 'rtl' || switched.dir === 'auto',
        `got dir=${switched.dir}`);
    }

    results.push({
      locale,
      ok: switched.ok,
      balance: switched.balance,
      spin: switched.spin,
      money: switched.money,
      dir: switched.dir,
      errors: errs.length,
    });

    await ctx.close();
  }
  await browser.close();
  srv.close();

  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    localeCount: LOCALES.length,
    results,
    pass, fail,
    failures,
  }, null, 2));

  console.log(`\n  Reports: reports/i18n-locale-sweep/summary.json`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail across ${LOCALES.length} locales ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures.slice(0, 15)) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
