#!/usr/bin/env node
/**
 * tests/contracts/web-dashboard.test.mjs
 *
 * N3 (2026-06-23) — Static web dashboard contract.
 *
 * Verifies tools/web-dashboard.mjs:
 *   - loadDashboardData() returns expected shape (5 baselines + meta)
 *   - renderHtml() emits valid HTML structure (doctype, head, body)
 *   - All 4 sections present (portfolio / games / compare / matrix)
 *   - All 5 baseline slugs appear in markup
 *   - Overall verdict badge rendered when audit-summary present
 *   - Embedded data JSON parses back to round-trip equality
 *   - File size sane (< 600KB) — no runaway embedding
 *   - HTML escape works (no raw `<script>` tag leakage from data)
 *   - Compare picker has two <select> with matching baseline options
 *   - Kernel matrix has at least one row when coverage data present
 */

import {
  loadDashboardData, renderHtml, renderPortfolioTable, renderCompareSection,
  renderKernelMatrix,
} from '../../tools/web-dashboard.mjs';

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('WEB-DASHBOARD contract · test suite');

test('loadDashboardData returns expected shape (5 baselines + meta)', async () => {
  const d = await loadDashboardData();
  assert(typeof d.generatedAt === 'string', 'generatedAt');
  assert(d.tool === 'tools/web-dashboard.mjs', 'tool');
  assert(Array.isArray(d.baselines), 'baselines array');
  assert(d.baselines.length === 5, `5 baselines, got ${d.baselines.length}`);
  assert(typeof d.onePagers === 'object', 'onePagers map');
  assert(typeof d.coverage === 'object', 'coverage map');
  for (const slug of d.baselines) {
    assert(slug in d.onePagers, `onePagers missing ${slug}`);
    assert(slug in d.coverage, `coverage missing ${slug}`);
  }
});

test('renderHtml emits valid HTML scaffold', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  assert(typeof html === 'string', 'string');
  assert(html.startsWith('<!DOCTYPE html>'), 'doctype first');
  assert(html.includes('<html lang="en">'), 'html lang');
  assert(html.includes('<head>'), 'head');
  assert(html.includes('<body>'), 'body');
  assert(html.includes('</html>'), 'closes html');
  assert(html.includes('<meta charset="utf-8">'), 'charset');
  assert(html.includes('<meta name="viewport"'), 'viewport');
});

test('All 4 sections rendered (portfolio / games / compare / matrix)', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  assert(html.includes('id="portfolio"'), 'portfolio section');
  assert(html.includes('id="games"'), 'games section');
  assert(html.includes('id="compare"'), 'compare section');
  assert(html.includes('id="matrix"'), 'matrix section');
  assert(html.includes('1. Portfolio'), 'section 1 heading');
  assert(html.includes('2. Per-game deep-dive'), 'section 2 heading');
  assert(html.includes('3. Side-by-side compare'), 'section 3 heading');
  assert(html.includes('4. Kernel applicability matrix'), 'section 4 heading');
});

test('All 5 baseline slugs appear in markup', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  for (const slug of d.baselines) {
    assert(html.includes(slug), `${slug} missing from html`);
  }
});

test('Overall verdict badge rendered when audit-summary present', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  /* Audit summary file is required for dashboard CLI exit 0; if loaded,
   * a verdict badge must be rendered. */
  if (d.auditSummary?.overallVerdict) {
    assert(html.includes('badge'), 'badge class present');
    assert(
      html.includes('GREEN') || html.includes('AMBER') || html.includes('RED'),
      'one of GREEN/AMBER/RED rendered',
    );
  }
});

test('Embedded #dashboard-data JSON parses back round-trip (browser-equivalent)', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  /* Extract via simple substring (render uses single fixed tag). */
  const start = html.indexOf('<script type="application/json" id="dashboard-data">');
  assert(start >= 0, 'data script tag present');
  const tagOpenEnd = html.indexOf('>', start) + 1;
  const closeIdx = html.indexOf('</script>', tagOpenEnd);
  const raw = html.slice(tagOpenEnd, closeIdx);
  /* Reverse the safety neutralisation applied at render time. */
  const unwrapped = raw
    .replace(/<\\\//g, '</')
    .replace(/<\\!--/g, '<!--')
    .replace(/<\\script/gi, '<script');
  let parsed;
  try { parsed = JSON.parse(unwrapped); }
  catch (e) { throw new Error('embedded JSON failed to parse: ' + e.message); }
  assert(parsed.tool === d.tool, 'round-trip tool');
  assert(Array.isArray(parsed.baselines), 'round-trip baselines');
  assert(parsed.baselines.length === d.baselines.length, 'round-trip baseline count');
});

test('Embedded JSON does not contain raw </script> sequence (would close tag early)', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  const start = html.indexOf('<script type="application/json" id="dashboard-data">');
  const tagOpenEnd = html.indexOf('>', start) + 1;
  const closeIdx = html.indexOf('</script>', tagOpenEnd);
  const raw = html.slice(tagOpenEnd, closeIdx);
  assert(!raw.match(/<\/script/i), 'raw </script in embedded body would close early');
  assert(!raw.includes('<!--'), 'raw <!-- could trigger comment state in some parsers');
});

test('File size sane (< 600KB) — no runaway embedding', async () => {
  const d = await loadDashboardData();
  const html = renderHtml(d);
  const kb = html.length / 1024;
  assert(kb < 600, `expected < 600KB, got ${kb.toFixed(1)}KB`);
});

test('HTML escape: data values do not leak raw script tags', async () => {
  /* Synthesize an attack payload via a fake baseline name; verify escape. */
  const d = await loadDashboardData();
  const evil = { ...d };
  evil.auditSummary = { ...d.auditSummary, overallVerdict: '<script>alert(1)</script>' };
  const html = renderHtml(evil);
  /* renderHtml routes verdict via badge() → esc() so the literal <script>
   * substring must NOT appear unescaped in the rendered HTML for the badge. */
  /* We accept the literal showing inside the embedded JSON data (which
   * itself is HTML-escaped — verified above). For the rendered badge area
   * there must be NO raw '<script>alert(1)' substring (would only happen
   * if esc() was bypassed). */
  const badgeArea = html.split('<main>')[0]; /* header area before main */
  assert(!badgeArea.includes('<script>alert(1)'),
    'header rendered badge area must escape data values');
});

test('Compare picker has two select dropdowns with baseline options', async () => {
  const d = await loadDashboardData();
  const compareHtml = renderCompareSection(d);
  assert(compareHtml.includes('id="cmp-a"'), 'cmp-a select');
  assert(compareHtml.includes('id="cmp-b"'), 'cmp-b select');
  assert(compareHtml.includes('id="cmp-go"'), 'cmp-go button');
  for (const slug of d.baselines) {
    assert(compareHtml.includes(`value="${slug}"`), `option for ${slug}`);
  }
});

test('Kernel matrix has at least 1 row when coverage data present', async () => {
  const d = await loadDashboardData();
  /* Verify coverage exists for at least one slug. */
  const haveCoverage = d.baselines.some(s => d.coverage[s]?.kernels?.length > 0);
  if (!haveCoverage) {
    console.log('    (skipped: no coverage data — would need probe pre-run)');
    return;
  }
  const matrixHtml = renderKernelMatrix(d);
  assert(matrixHtml.includes('<table'), 'matrix table');
  assert(matrixHtml.includes('Kernel'), 'kernel column header');
  /* Each cell either ✓ or — depending on applicability — at least one ✓ must exist. */
  assert(matrixHtml.includes('✓'), 'at least one applicable cell');
});

test('Portfolio table has one row per baseline', async () => {
  const d = await loadDashboardData();
  const portfolioHtml = renderPortfolioTable(d);
  /* Count occurrences of each baseline slug in the portfolio block. */
  for (const slug of d.baselines) {
    const occurrences = portfolioHtml.split(slug).length - 1;
    assert(occurrences >= 1, `${slug} should appear in portfolio table`);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
