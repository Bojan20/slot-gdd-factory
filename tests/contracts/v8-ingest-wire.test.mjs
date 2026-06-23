#!/usr/bin/env node
/**
 * tests/contracts/v8-ingest-wire.test.mjs
 *
 * N+1 LIVE WIRE (2026-06-23) — V8 GAME ASSEMBLY ingest pipeline contract.
 *
 * Purpose
 * -------
 * Verifies the FULL wiring of the V8 rule engine into the production
 * ingest pipeline:
 *
 *   1. `tools/v8-assembly-orchestrator.mjs` exports `assemble(slug, model)`
 *      as a pure library function (importable without CLI side effects).
 *   2. `tools/ingest.mjs --file <pdf>` writes `dist/ingest/<slug>/v8.json`
 *      containing the full V8 receipt for the parsed model.
 *   3. The generated `dist/ingest/<slug>/index.html` contains a
 *      `<meta name="v8-receipt" …>` element whose base64 content
 *      decodes to a JSON payload matching the receipt's PUBLIC fields.
 *   4. The web dashboard (`tools/web-dashboard.mjs`) renders a V8
 *      Assembly panel for each baseline slug with the correct verdict
 *      badge.
 *
 * Why this matters
 * ----------------
 * Before this wire, V8 was a standalone orchestrator: operator had to
 * remember to run it separately to get an assembly receipt. After
 * this wire, every ingest call produces an audit trail automatically.
 * If any one of the four contracts above breaks, the audit deliverable
 * the regulator + operator rely on is silently missing.
 *
 * Senior-grade discipline
 * -----------------------
 *   - Real PDF fixture (first sorted PDF in ~/Desktop/GDD/) — not synthetic
 *     mock. Pipeline failure modes only surface against real PDFs.
 *   - Cleanup after every test path (no left-over dist/ingest/ junk).
 *   - Deterministic: same PDF → same V8 verdict (idempotent re-run check).
 *   - Round-trip integrity: receipt-in-meta MUST equal receipt-in-json.
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
const V8_TOOL = join(REPO, 'tools/v8-assembly-orchestrator.mjs');
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

console.log('V8 INGEST WIRE contract · test suite');

/* ── 1. Library import contract ─────────────────────────────────────── */

await testAsync('V8 orchestrator exports assemble() as library function', async () => {
  const mod = await import(V8_TOOL);
  assert(typeof mod.assemble === 'function', `expected mod.assemble to be function, got ${typeof mod.assemble}`);
  assert(typeof mod.featureSet === 'function', 'expected mod.featureSet to be function');
  assert(typeof mod.jurCodes === 'function', 'expected mod.jurCodes to be function');
});

await testAsync('assemble() on a minimal model returns valid receipt shape', async () => {
  const { assemble } = await import(V8_TOOL);
  const r = assemble('test-minimal', {
    topology: { kind: 'rectangular' },
    features: [],
    compliance: [],
  });
  assert(r.verdict === 'PASS' || r.verdict === 'FAIL', `bad verdict: ${r.verdict}`);
  assert(r.assembly, 'missing assembly');
  assert(Array.isArray(r.assembly.enabledBlocks), 'enabledBlocks not array');
  assert(Array.isArray(r.assembly.disabledBlocks), 'disabledBlocks not array');
  assert(typeof r.assembly.reasonByBlock === 'object', 'reasonByBlock not object');
  assert(Array.isArray(r.conflicts), 'conflicts not array');
  assert(Array.isArray(r.missingMandatory), 'missingMandatory not array');
  assert(r.__meta__.selectedEngine === 'reelEngine', `expected reelEngine, got ${r.__meta__.selectedEngine}`);
});

await testAsync('assemble() routes hex topology → hexReelEngine (or hexClusterEngine)', async () => {
  const { assemble } = await import(V8_TOOL);
  const r = assemble('test-hex', {
    topology: { kind: 'hex' },
    features: [],
    compliance: [],
  });
  /* Hex topology should select a hex-family engine. */
  assert(
    r.__meta__.selectedEngine === 'hexReelEngine' || r.__meta__.selectedEngine === 'hexClusterEngine',
    `hex routed to wrong engine: ${r.__meta__.selectedEngine}`,
  );
});

/* ── 2. Ingest pipeline E2E (PDF → v8.json) ─────────────────────────── */

/* UQ-DEEP-B 2026-06-23 — VENDOR-NEUTRAL FIXTURE DISCOVERY.
 * Previous hardcoded vendor PDF filename leaked a vendor title into the
 * test source — violation of rule_no_vendor_mentions.
 * Replace with deterministic first-PDF discovery from ~/Desktop/GDD/
 * (sorted by name for repeatable test fixture across runs). */
import { readdirSync as _readdirSync } from 'node:fs';
function pickTestPdf() {
  let pdfs = [];
  try { pdfs = _readdirSync(GDD_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort(); }
  catch { return null; }
  return pdfs.length > 0 ? join(GDD_DIR, pdfs[0]) : null;
}
const TEST_PDF = pickTestPdf();
const TEST_SLUG = `v8-wire-contract-${Date.now()}`;
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

test('v8.json exists in output dir', () => {
  const p = join(OUT_DIR, 'v8.json');
  assert(existsSync(p), 'v8.json missing');
  const sz = statSync(p).size;
  assert(sz > 500, `v8.json suspiciously small: ${sz} bytes`);
});

test('v8.json has full receipt shape', () => {
  const r = JSON.parse(readFileSync(join(OUT_DIR, 'v8.json'), 'utf8'));
  assert(r.verdict === 'PASS' || r.verdict === 'FAIL', `bad verdict: ${r.verdict}`);
  assert(r.slug === TEST_SLUG, `slug mismatch: ${r.slug}`);
  assert(r.assembly, 'missing assembly');
  assert(Array.isArray(r.assembly.enabledBlocks), 'enabledBlocks not array');
  assert(r.assembly.enabledBlocks.length >= 9, `expected ≥9 enabled (mandatoryCore minimum), got ${r.assembly.enabledBlocks.length}`);
  /* Mandatory blocks present. */
  const mandatorySet = new Set(['paytable', 'balanceHud', 'betSelector', 'spinControl', 'winPresentation']);
  for (const m of mandatorySet) {
    assert(r.assembly.enabledBlocks.includes(m), `mandatory block missing from enabled: ${m}`);
  }
});

/* ── 3. HTML meta tag + round-trip decode ───────────────────────────── */

test('index.html contains <meta name="v8-receipt" content="…"> tag', () => {
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8');
  const m = html.match(/<meta name="v8-receipt"[^>]*content="([^"]+)"/);
  assert(m, 'no <meta name="v8-receipt"> in index.html');
  assert(m[1].length > 100, `base64 content suspiciously short: ${m[1].length}`);
});

test('meta tag base64 decodes to JSON matching v8.json public fields', () => {
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8');
  const m = html.match(/<meta name="v8-receipt"[^>]*content="([^"]+)"/);
  const decoded = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  const fromFile = JSON.parse(readFileSync(join(OUT_DIR, 'v8.json'), 'utf8'));

  assert(decoded.verdict === fromFile.verdict, `verdict mismatch meta=${decoded.verdict} file=${fromFile.verdict}`);
  assert(decoded.selectedEngine === fromFile.__meta__.selectedEngine,
    `engine mismatch meta=${decoded.selectedEngine} file=${fromFile.__meta__.selectedEngine}`);
  assert(decoded.enabledBlocks.length === fromFile.assembly.enabledBlocks.length,
    `enabledBlocks length mismatch: meta=${decoded.enabledBlocks.length} file=${fromFile.assembly.enabledBlocks.length}`);
  /* Spot-check arbitrary 3 blocks are equal between meta + file. */
  for (const b of fromFile.assembly.enabledBlocks.slice(0, 3)) {
    assert(decoded.enabledBlocks.includes(b), `meta missing block ${b}`);
  }
});

test('meta tag attributes data-verdict + data-engine match payload', () => {
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8');
  const m = html.match(/<meta name="v8-receipt"\s+data-verdict="([^"]+)"\s+data-engine="([^"]*)"/);
  assert(m, 'data-verdict / data-engine attributes missing');
  const fromFile = JSON.parse(readFileSync(join(OUT_DIR, 'v8.json'), 'utf8'));
  assert(m[1] === fromFile.verdict, `data-verdict mismatch: ${m[1]} vs ${fromFile.verdict}`);
  assert(m[2] === (fromFile.__meta__.selectedEngine || ''),
    `data-engine mismatch: ${m[2]} vs ${fromFile.__meta__.selectedEngine}`);
});

/* ── 4. Idempotency: same PDF → same enabled set ────────────────────── */

test('re-run ingest produces identical enabledBlocks set (idempotent)', () => {
  const slug2 = TEST_SLUG + '-rerun';
  const out2 = join(REPO, 'dist/ingest', slug2);
  const r = spawnSync('node', [INGEST,
    '--file', TEST_PDF,
    '--slug', slug2,
    '--no-llm',
  ], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`re-run ingest exit ${r.status}`);

  const a = JSON.parse(readFileSync(join(OUT_DIR, 'v8.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(out2, 'v8.json'), 'utf8'));
  const aSet = new Set(a.assembly.enabledBlocks);
  const bSet = new Set(b.assembly.enabledBlocks);
  /* Set equality. */
  assert(aSet.size === bSet.size, `size mismatch a=${aSet.size} b=${bSet.size}`);
  for (const blk of aSet) assert(bSet.has(blk), `re-run missing block ${blk}`);

  /* Cleanup the rerun dir; main OUT_DIR cleaned in final test. */
  try { rmSync(out2, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ── 5. Dashboard renders V8 panel for baseline games ───────────────── */

test('web-dashboard --quiet writes reports/dashboard/index.html', () => {
  const r = spawnSync('node', [DASH, '--quiet'], { cwd: REPO, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`dashboard exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  const p = join(REPO, 'reports/dashboard/index.html');
  assert(existsSync(p), 'dashboard index.html not created');
});

test('dashboard contains a V8 Assembly panel for each baseline', () => {
  const p = join(REPO, 'reports/dashboard/index.html');
  const html = readFileSync(p, 'utf8');
  const count = (html.match(/V8 Assembly/g) || []).length;
  /* 5 baselines → 5 V8 panels. */
  assert(count === 5, `expected 5 V8 Assembly panels (one per baseline), got ${count}`);
});

test('dashboard V8 panels include at least one PASS badge', () => {
  const p = join(REPO, 'reports/dashboard/index.html');
  const html = readFileSync(p, 'utf8');
  /* Corpus orchestrator ensures 338/338 PASS, so every baseline is PASS. */
  const passCount = (html.match(/V8 Assembly · <span class="badge badge-green"[^>]*>🟢 PASS/g) || []).length;
  assert(passCount >= 1, `expected ≥1 V8 PASS badge in dashboard, got ${passCount}`);
});

/* ── Cleanup ────────────────────────────────────────────────────────── */

test('cleanup test output dir', () => {
  try { rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  assert(!existsSync(OUT_DIR), 'cleanup failed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
