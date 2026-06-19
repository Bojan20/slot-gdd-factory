/**
 * tests/blocks/_crossBrowserProbe.test.mjs · C-4 LEGO-CROSS-BROWSER
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/cross-browser/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== cross-browser probe validator (C-4) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-cross-browser-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0 (all 3 browsers green)', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary has 3 browser results', summary.results.length === 3);
t('summary 0 failures', summary.fail === 0);

for (const browser of ['chromium', 'firefox', 'webkit']) {
  const r = summary.results.find(x => x.browser === browser);
  t(`${browser} result present`, !!r);
  if (r && !r.skipped) {
    t(`${browser} 0 console errors`,    r.consoleErrs === 0);
    t(`${browser} HookBus roundtrip`,    r.hookBusOk === true);
    t(`${browser} __SLOT_I18N__ works`,  r.i18nOk === true);
    t(`${browser} CSS custom props`,     r.cssVarOk === true);
    t(`${browser} screenshot generated`, typeof r.screenshot === 'string');
  }
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
