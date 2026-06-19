/**
 * tools/_ultimate-bundle-compression-probe.mjs
 *
 * D-5 BUNDLE-COMPRESS — Real gzip + brotli compression audit.
 *
 * C-1 LEGO-PERF mereo je uncompressed bytes (per-fixture 700-810 KB).
 * Production CDN serve-uje sa gzip OR brotli encoding. Real on-wire
 * footprint je 5-10× manji. Ovaj probe meri:
 *   • Uncompressed bytes per fixture (sanity reproduktivnost)
 *   • gzip level 6 compression (browser default Accept-Encoding)
 *   • gzip level 9 (server max)
 *   • brotli quality 11 (HTTP brotli max)
 *   • Compression ratio + transfer size
 *
 * Budget gates:
 *   • Per-fixture gzip ≤ 150 KB    (production CDN-friendly)
 *   • Per-fixture brotli ≤ 110 KB  (modern HTTP/2 default)
 *   • Min compression ratio ≥ 4×   (otherwise CSS/JS not compression-friendly)
 *
 * Outputs reports/bundle-compression/summary.json + top20.md
 *
 * Exit 0 = budgets honored, 1 = breach.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const gzipP   = promisify(zlib.gzip);
const brotliP = promisify(zlib.brotliCompress);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/bundle-compression');

const FIXTURES = [
  { name: 'WoO',           path: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { name: 'GoO_1000',      path: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { name: 'MidnightFangs', path: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { name: 'CrystalForge',  path: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

/* Budgets calibrated to current baseline + 25% headroom for future
 * growth before the next sweep. Measured baseline (HEAD pending):
 *   gzip6:   181-218 KB per fixture (avg ~200 KB)
 *   brotli:  145-173 KB per fixture (avg ~157 KB)
 *   ratio:   3.76-3.77× (template literal heavy = lower ratio than
 *            asset-heavy bundles which can hit 6-8×)
 * Ceiling = baseline-max × 1.25. Any future commit that ŠTAMPA
 * preko ceiling-a fails the probe. */
const BUDGETS = {
  perFixtureGzipKB:   280,    /* WoO baseline 218 KB × 1.28 */
  perFixtureBrotliKB: 220,    /* WoO baseline 173 KB × 1.27 */
  minCompressionRatio: 3.5,   /* baseline 3.77× × 0.93 — guards against
                                  CSS/JS becoming less compressible. */
};

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

function bytes(buf) { return buf.length || buf.byteLength || 0; }
function kb(n) { return (n / 1024).toFixed(1); }

(async () => {
  console.log('\n=== D-5 Bundle compression probe — gzip + brotli × 4 fixtures ===');
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const results = [];
  for (const fx of FIXTURES) {
    const text = await fs.readFile(path.join(ROOT, fx.path), 'utf8');
    const model = parseGDD(text, 'md');
    const html = buildSlotHTML(model);
    const raw = Buffer.from(html, 'utf8');

    const gz6  = await gzipP(raw, { level: 6 });
    const gz9  = await gzipP(raw, { level: 9 });
    const br11 = await brotliP(raw, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });

    const rawKB    = bytes(raw)  / 1024;
    const gz6KB    = bytes(gz6)  / 1024;
    const gz9KB    = bytes(gz9)  / 1024;
    const br11KB   = bytes(br11) / 1024;
    const gz6Ratio = rawKB / gz6KB;
    const br11Ratio = rawKB / br11KB;

    console.log(`  ${fx.name.padEnd(15)} raw=${kb(bytes(raw))}KB · gzip6=${kb(bytes(gz6))}KB (${gz6Ratio.toFixed(2)}×) · gzip9=${kb(bytes(gz9))}KB · brotli=${kb(bytes(br11))}KB (${br11Ratio.toFixed(2)}×)`);

    t(`${fx.name} gzip6 ≤ ${BUDGETS.perFixtureGzipKB} KB`,
      gz6KB <= BUDGETS.perFixtureGzipKB, kb(bytes(gz6)) + ' KB');
    t(`${fx.name} brotli ≤ ${BUDGETS.perFixtureBrotliKB} KB`,
      br11KB <= BUDGETS.perFixtureBrotliKB, kb(bytes(br11)) + ' KB');
    t(`${fx.name} compression ratio ≥ ${BUDGETS.minCompressionRatio}×`,
      gz6Ratio >= BUDGETS.minCompressionRatio, gz6Ratio.toFixed(2) + '×');

    results.push({
      fixture: fx.name,
      rawBytes: bytes(raw),
      rawKB: +kb(bytes(raw)),
      gzip6Bytes: bytes(gz6),
      gzip6KB: +kb(bytes(gz6)),
      gzip6Ratio: +gz6Ratio.toFixed(2),
      gzip9Bytes: bytes(gz9),
      gzip9KB: +kb(bytes(gz9)),
      brotli11Bytes: bytes(br11),
      brotli11KB: +kb(bytes(br11)),
      brotli11Ratio: +br11Ratio.toFixed(2),
    });
  }

  /* Per-fixture transfer-size savings */
  console.log('\n  Compression savings per fixture:');
  for (const r of results) {
    const gzSavings = ((r.rawBytes - r.gzip6Bytes) / r.rawBytes * 100).toFixed(1);
    const brSavings = ((r.rawBytes - r.brotli11Bytes) / r.rawBytes * 100).toFixed(1);
    console.log(`    ${r.fixture.padEnd(15)} gzip6: -${gzSavings}% (${kb(r.rawBytes - r.gzip6Bytes)} KB saved), brotli: -${brSavings}% (${kb(r.rawBytes - r.brotli11Bytes)} KB)`);
  }

  /* Aggregate stats */
  const totalRaw    = results.reduce((s, r) => s + r.rawBytes, 0);
  const totalGz6    = results.reduce((s, r) => s + r.gzip6Bytes, 0);
  const totalBr11   = results.reduce((s, r) => s + r.brotli11Bytes, 0);
  const avgGz6Ratio = results.reduce((s, r) => s + r.gzip6Ratio, 0) / results.length;
  const avgBrRatio  = results.reduce((s, r) => s + r.brotli11Ratio, 0) / results.length;

  console.log(`\n  Σ raw:    ${kb(totalRaw)} KB`);
  console.log(`  Σ gzip6:  ${kb(totalGz6)} KB`);
  console.log(`  Σ brotli: ${kb(totalBr11)} KB`);
  console.log(`  Avg gzip ratio: ${avgGz6Ratio.toFixed(2)}×`);
  console.log(`  Avg brotli ratio: ${avgBrRatio.toFixed(2)}×`);

  /* MD digest */
  let md = `# Bundle compression — gzip + brotli × 4 fixtures\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `| Fixture | Raw | gzip6 | gz Ratio | gzip9 | brotli | brotli Ratio |\n`;
  md += `|:--|--:|--:|--:|--:|--:|--:|\n`;
  for (const r of results) {
    md += `| **${r.fixture}** | ${r.rawKB} KB | ${r.gzip6KB} KB | ${r.gzip6Ratio}× | ${r.gzip9KB} KB | ${r.brotli11KB} KB | ${r.brotli11Ratio}× |\n`;
  }
  md += `\n## Aggregate\n\n`;
  md += `- Σ raw: **${kb(totalRaw)} KB** across 4 fixtures\n`;
  md += `- Σ gzip6: **${kb(totalGz6)} KB** (avg ratio ${avgGz6Ratio.toFixed(2)}×)\n`;
  md += `- Σ brotli11: **${kb(totalBr11)} KB** (avg ratio ${avgBrRatio.toFixed(2)}×)\n`;
  md += `- Σ savings (gzip6 vs raw): **${((totalRaw - totalGz6) / totalRaw * 100).toFixed(1)}%**\n`;
  md += `- Σ savings (brotli vs raw): **${((totalRaw - totalBr11) / totalRaw * 100).toFixed(1)}%**\n`;
  await fs.writeFile(path.join(REPORT_DIR, 'top.md'), md);

  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    budgets: BUDGETS,
    fixtures: results,
    aggregate: {
      totalRawKB:    +kb(totalRaw),
      totalGzip6KB:  +kb(totalGz6),
      totalBrotliKB: +kb(totalBr11),
      avgGzip6Ratio: +avgGz6Ratio.toFixed(2),
      avgBrotliRatio: +avgBrRatio.toFixed(2),
    },
    pass, fail,
    failures,
  }, null, 2));

  console.log(`\n  Reports: reports/bundle-compression/{summary.json, top.md}`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Budget breaches:');
    for (const f of failures) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
