/**
 * tests/blocks/_bundleCompressionProbe.test.mjs · D-5 BUNDLE-COMPRESS
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/bundle-compression/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== bundle-compression validator (D-5) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-bundle-compression-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary has budgets', typeof summary.budgets === 'object');
t('summary 0 failures', summary.fail === 0);
t('4 fixtures measured', summary.fixtures.length === 4);
t('aggregate present', typeof summary.aggregate === 'object');

for (const f of summary.fixtures) {
  t(`${f.fixture} raw > 0`, f.rawKB > 0);
  t(`${f.fixture} gzip6 < raw (compressed)`, f.gzip6KB < f.rawKB);
  t(`${f.fixture} brotli < gzip6 (better compression)`, f.brotli11KB <= f.gzip6KB);
  t(`${f.fixture} gzip6 within budget`, f.gzip6KB <= summary.budgets.perFixtureGzipKB);
  t(`${f.fixture} brotli within budget`, f.brotli11KB <= summary.budgets.perFixtureBrotliKB);
  t(`${f.fixture} compression ratio meets min`, f.gzip6Ratio >= summary.budgets.minCompressionRatio);
}

/* aggregate stats sanity */
t('aggregate avg gzip ratio > 3.0×', summary.aggregate.avgGzip6Ratio > 3.0);
t('aggregate avg brotli ratio > gzip ratio', summary.aggregate.avgBrotliRatio > summary.aggregate.avgGzip6Ratio);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
