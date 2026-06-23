#!/usr/bin/env node
/**
 * tests/contracts/v9-ingest-wire.test.mjs
 *
 * N+1 LIVE WIRE (2026-06-23) — V9 VISUAL QA ingest pipeline contract.
 *
 * Purpose
 * -------
 * Verifies the deterministic V9 structural-QA pass is wired into the
 * production ingest pipeline:
 *
 *   1. `tools/v9-visual-qa.mjs` exports `verifyHtml(slug, model, html)`
 *      (plus parseSlot / deterministicChecks / scoreChecks /
 *      verdictFromChecks helpers) as pure library functions — no CLI
 *      side effects when imported.
 *   2. `tools/ingest.mjs --file <pdf>` writes `dist/ingest/<slug>/v9.json`
 *      containing the full V9 receipt for the just-built HTML.
 *   3. The generated `dist/ingest/<slug>/index.html` contains a
 *      `<meta name="v9-verdict" data-verdict data-score data-checks>`
 *      element whose attributes match the receipt.
 *   4. The web dashboard (`tools/web-dashboard.mjs`) renders a V9
 *      Visual QA panel for each baseline slug with the correct verdict
 *      badge.
 *
 * Why this matters
 * ----------------
 * Before this wire, V9 only ran across the dist/real-games/ corpus.
 * Operators ingesting a NEW GDD got no QA verdict against the freshly
 * generated HTML — a CSS regression or missing block could ship
 * unnoticed until the next corpus sweep. After this wire, every
 * ingest emits a per-slug receipt + embedded verdict in the HTML.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const INGEST = join(REPO, 'tools/ingest.mjs');
const GDD_DIR = join(homedir(), 'Desktop/GDD');
const V9_TOOL = join(REPO, 'tools/v9-visual-qa.mjs');
const DASH    = join(REPO, 'tools/web-dashboard.mjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('V9 INGEST WIRE contract · test suite');

/* ── 1. Library import contract ─────────────────────────────────────── */

await testAsync('V9 tool exports verifyHtml + helpers', async () => {
  const mod = await import(V9_TOOL);
  for (const fn of ['verifyHtml', 'parseSlot', 'deterministicChecks', 'scoreChecks', 'verdictFromChecks']) {
    assert(typeof mod[fn] === 'function', `expected ${fn} to be function, got ${typeof mod[fn]}`);
  }
});

await testAsync('verifyHtml on a healthy minimal HTML returns PASS', async () => {
  const { verifyHtml } = await import(V9_TOOL);
  /* Minimal HTML that satisfies all 10 deterministic invariants.
   *
   * UQ-DEEP-A 2026-06-23 — UPDATED FIXTURE.
   * After CRIT #4 (strict-selector hardening), hub controls require
   * structural markers (class/id), NOT bare word mentions. Updated
   * fixture uses `.paytable-btn`, `.settings-btn`, etc. to reflect
   * the new contract. */
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta name="viewport" content="width=device-width">',
    '<title>Test Slot</title>',
    '<link rel="manifest" href="manifest.json">',
    '<style>:root { --bg: #000; --accent: #fff; }</style>',
    '</head>',
    '<body>',
    '<div class="hub">',
    '<div class="balance-hud"></div>',
    '<div class="bet-steps"></div>',
    '<button class="spin-btn"></button>',
    '<button class="paytable-btn">Paytable</button>',
    '<button class="settings-btn">Settings</button>',
    '<button class="history-btn">History</button>',
    '<div class="audio-host"></div>',
    '<div class="win-presentation"></div>',
    '<div class="paytable-row"></div>'.repeat(10),
    /* BLOCK marker for reelEngine — deterministicChecks looks for it. */
    '<!-- BLOCK (reelEngine) -->',
    '</div>',
    /* Padding to clear the 50 KB body-length sanity check. */
    '<div>' + 'x'.repeat(55_000) + '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  const r = verifyHtml('test-clean', { topology: { kind: 'rectangular' }, symbols: [] }, html);
  assert(r.verdict === 'PASS', `expected PASS, got ${r.verdict} (score ${r.score})`);
  assert(r.score >= 9.0, `expected score ≥ 9, got ${r.score}`);
  assert(r.__meta__.mode === 'deterministic', `wrong mode: ${r.__meta__.mode}`);
});

await testAsync('verifyHtml flags missing hub controls as FAIL', async () => {
  const { verifyHtml } = await import(V9_TOOL);
  /* HTML with NO hub controls — should FAIL on C2. */
  const html = '<html><head><title>X</title></head><body></body></html>';
  const r = verifyHtml('test-broken', { topology: { kind: 'rectangular' }, symbols: [] }, html);
  assert(r.verdict === 'FAIL', `expected FAIL on missing controls, got ${r.verdict}`);
  const fails = r.checks.filter(c => c.verdict === 'FAIL');
  assert(fails.length >= 3, `expected ≥3 FAIL checks, got ${fails.length}`);
});

/* ── 2. Ingest pipeline E2E (PDF → v9.json) ─────────────────────────── */

/* UQ-DEEP-B 2026-06-23 — VENDOR-NEUTRAL FIXTURE DISCOVERY.
 * See v8-ingest-wire.test.mjs for rationale (rule_no_vendor_mentions). */
import { readdirSync as _readdirSync } from 'node:fs';
function pickTestPdf() {
  let pdfs = [];
  try { pdfs = _readdirSync(GDD_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort(); }
  catch { return null; }
  return pdfs.length > 0 ? join(GDD_DIR, pdfs[0]) : null;
}
const TEST_PDF = pickTestPdf();
const TEST_SLUG = `v9-wire-contract-${Date.now()}`;
const OUT_DIR = join(REPO, 'dist/ingest', TEST_SLUG);

test('Test PDF discovered in ~/Desktop/GDD/', () => {
  assert(TEST_PDF, `no PDF found in ${GDD_DIR}`);
  assert(existsSync(TEST_PDF), `PDF missing: ${TEST_PDF}`);
});

test(`ingest --no-llm produces dist/ingest/${TEST_SLUG}/`, () => {
  const r = spawnSync('node', [INGEST,
    '--file', TEST_PDF,
    '--slug', TEST_SLUG,
    '--no-llm',
  ], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(`ingest exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  }
  assert(existsSync(OUT_DIR), `${OUT_DIR} not created`);
});

test('v9.json exists in output dir', () => {
  const p = join(OUT_DIR, 'v9.json');
  assert(existsSync(p), 'v9.json missing');
  const sz = statSync(p).size;
  assert(sz > 200, `v9.json suspiciously small: ${sz} bytes`);
});

test('v9.json has full receipt shape', () => {
  const r = JSON.parse(readFileSync(join(OUT_DIR, 'v9.json'), 'utf8'));
  assert(['PASS', 'WARN', 'FAIL'].includes(r.verdict), `bad verdict: ${r.verdict}`);
  assert(r.slug === TEST_SLUG, `slug mismatch: ${r.slug}`);
  assert(Array.isArray(r.checks), 'checks not array');
  assert(r.checks.length >= 8, `expected ≥8 checks, got ${r.checks.length}`);
  assert(typeof r.score === 'number', 'score not number');
  assert(r.score >= 0 && r.score <= 10, `score out of range: ${r.score}`);
  assert(r.__meta__.mode === 'deterministic', `wrong mode: ${r.__meta__.mode}`);
});

/* ── 3. HTML meta tag round-trip ────────────────────────────────────── */

test('index.html contains <meta name="v9-verdict" …> tag', () => {
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8');
  const m = html.match(/<meta name="v9-verdict"\s+data-verdict="([^"]+)"\s+data-score="([^"]+)"\s+data-checks="([^"]+)"/);
  assert(m, 'no <meta name="v9-verdict"> in index.html');
});

test('v9-verdict meta attributes match v9.json receipt', () => {
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8');
  const m = html.match(/<meta name="v9-verdict"\s+data-verdict="([^"]+)"\s+data-score="([^"]+)"\s+data-checks="([^"]+)"/);
  const receipt = JSON.parse(readFileSync(join(OUT_DIR, 'v9.json'), 'utf8'));
  assert(m[1] === receipt.verdict, `verdict mismatch meta=${m[1]} file=${receipt.verdict}`);
  /* Numeric score embedded with toFixed(2). */
  assert(parseFloat(m[2]) === parseFloat(receipt.score.toFixed(2)),
    `score mismatch meta=${m[2]} file=${receipt.score}`);
  assert(parseInt(m[3], 10) === receipt.checks.length,
    `checks-count mismatch meta=${m[3]} file=${receipt.checks.length}`);
});

/* ── 4. Real-PDF ingest: produces PASS verdict on healthy HTML ──────── */

test('real-PDF ingest produces PASS or WARN (not FAIL)', () => {
  const r = JSON.parse(readFileSync(join(OUT_DIR, 'v9.json'), 'utf8'));
  /* Real PDF + healthy buildSlotHTML SHOULD produce ≥ WARN; FAIL would
   * mean a regression in the build pipeline. */
  assert(['PASS', 'WARN'].includes(r.verdict),
    `unexpected FAIL on real PDF — possible build regression. checks: ${r.checks.filter(c => c.verdict === 'FAIL').map(c => c.name).join(', ')}`);
});

/* ── 5. Dashboard renders V9 panel ──────────────────────────────────── */

test('web-dashboard --quiet writes reports/dashboard/index.html', () => {
  const r = spawnSync('node', [DASH, '--quiet'], { cwd: REPO, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`dashboard exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  assert(existsSync(join(REPO, 'reports/dashboard/index.html')), 'dashboard index.html not created');
});

test('dashboard contains a V9 Visual QA panel for each baseline', () => {
  const p = join(REPO, 'reports/dashboard/index.html');
  const html = readFileSync(p, 'utf8');
  const count = (html.match(/V9 Visual QA/g) || []).length;
  assert(count === 5, `expected 5 V9 Visual QA panels (one per baseline), got ${count}`);
});

test('dashboard V9 panels include at least one PASS badge', () => {
  const p = join(REPO, 'reports/dashboard/index.html');
  const html = readFileSync(p, 'utf8');
  const passCount = (html.match(/V9 Visual QA · <span class="badge badge-green"[^>]*>🟢 PASS/g) || []).length;
  assert(passCount >= 1, `expected ≥1 V9 PASS badge in dashboard, got ${passCount}`);
});

/* ── Cleanup ────────────────────────────────────────────────────────── */

test('cleanup test output dir', () => {
  try { rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  assert(!existsSync(OUT_DIR), 'cleanup failed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
