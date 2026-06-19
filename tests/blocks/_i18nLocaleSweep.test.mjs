/**
 * tests/blocks/_i18nLocaleSweep.test.mjs · C-2 LEGO-I18N
 * Validates the locale sweep summary artifact.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/i18n-locale-sweep/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== i18n locale sweep validator (C-2 LEGO-I18N) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-i18n-locale-sweep.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('locale sweep probe exits 0', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary has 14 locales', summary.localeCount === 14);
t('summary 0 failures', summary.fail === 0);

const required = ['en-US', 'sr-Latn', 'sr-RS', 'pl-PL', 'nl-NL', 'ar-SA', 'de-DE', 'fr-FR'];
for (const loc of required) {
  const r = summary.results.find(x => x.locale === loc);
  t(`${loc} present in summary`, !!r);
  if (r) {
    t(`${loc} balance translated`, typeof r.balance === 'string' && r.balance.length > 0);
    t(`${loc} spin translated`,    typeof r.spin === 'string' && r.spin.length > 0);
    t(`${loc} 0 console errors`,   r.errors === 0);
  }
}

/* sr-RS — Bokijev jezik */
const sr = summary.results.find(x => x.locale === 'sr-RS');
if (sr) {
  t('sr-RS balance is "Stanje"', sr.balance === 'Stanje');
  t('sr-RS spin is "Vrti"', sr.spin === 'Vrti');
}

/* ar-SA — RTL semantic */
const ar = summary.results.find(x => x.locale === 'ar-SA');
if (ar) {
  t('ar-SA has Arabic balance', /[؀-ۿ]/.test(ar.balance));
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
