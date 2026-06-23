#!/usr/bin/env node
/**
 * tests/contracts/ingest-e2e.test.mjs
 *
 * MATH-DEEP C — End-to-end ingest contract test (2026-06-23).
 *
 * Purpose
 *   Verifies the FULL pipeline from a real PDF GDD on disk to a
 *   browser-ready slot.html, asserting:
 *     1. tools/ingest.mjs --file <pdf> --no-llm completes successfully
 *     2. Output dist/ingest/<slug>/ contains raw.txt, model.json, slot.html
 *     3. model.json passes UniversalGameSchema
 *     4. slot.html contains expected structural markers
 *     5. Pipeline is repeatable (second run produces identical model hash)
 *
 * Why
 *   Boki direktiva: "uveri se da ce bilo koji buduci gdd i math par sheet
 *   raditi savrseno". This is the END-TO-END proof: operator drops a PDF
 *   in ~/Desktop/GDD/, runs one command, gets a playable slot. If THIS
 *   fails, the production claim is hollow.
 *
 * Performance budget
 *   Ingest pipeline ≤ 15s per PDF (pdftotext + parser + smartDefaults +
 *   buildSlotHTML). Test runs on 2 baseline PDFs ≤ 30s total.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

import { validateModel } from '../../src/schema/universalGame.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const INGEST = join(REPO, 'tools/ingest.mjs');
const GDD_DIR = join(homedir(), 'Desktop/GDD');

let passed = 0, failed = 0;
const tmpRoot = mkdtempSync(join(tmpdir(), 'ingest-e2e-'));
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function sha256(s) { return createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex'); }

console.log('INGEST E2E contract · test suite');

/* ── PDF presence ─────────────────────────────────────────────────────── */

const PDFS = [
  { pdf: 'Cash_Eruption_Foundry_GDD.pdf',  slug: 'cash-eruption-foundry-gdd' },
  { pdf: 'Gates_of_Olympus_1000_GDD.pdf', slug: 'gates-of-olympus-1000-gdd' },
];

test('Real PDFs present in ~/Desktop/GDD/', () => {
  if (!existsSync(GDD_DIR)) throw new Error(`GDD dir missing: ${GDD_DIR}`);
  for (const { pdf } of PDFS) {
    const p = join(GDD_DIR, pdf);
    assert(existsSync(p), `${pdf} not found`);
    const sz = statSync(p).size;
    assert(sz > 1000, `${pdf} suspiciously small: ${sz} bytes`);
  }
});

/* ── For each PDF: run ingest --no-llm, validate artifacts ────────────── */

const results = [];
for (const { pdf, slug } of PDFS) {
  const pdfPath = join(GDD_DIR, pdf);
  const ingestSlug = `e2e-${slug}-${Date.now()}`;
  const outDir = join(REPO, 'dist/ingest', ingestSlug);

  test(`ingest ${pdf} produces dist/ingest/<slug>/`, () => {
    if (!existsSync(pdfPath)) throw new Error(`PDF missing: ${pdfPath}`);
    const r = spawnSync('node', [INGEST,
      '--file', pdfPath,
      '--slug', ingestSlug,  /* space-separated form per ingest's flag() */
      '--no-llm',
    ], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) throw new Error(`ingest exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
    assert(existsSync(outDir), `dist/ingest/${ingestSlug}/ not created`);
    results.push({ slug: ingestSlug, outDir });
  });
}

for (const r of results) {
  test(`${r.slug}: raw.txt + model.json + index.html exist`, () => {
    /* ingest.mjs writes index.html (not slot.html); confirmed in tool docstring. */
    assert(existsSync(join(r.outDir, 'raw.txt')), 'raw.txt missing');
    assert(existsSync(join(r.outDir, 'model.json')), 'model.json missing');
    assert(existsSync(join(r.outDir, 'index.html')), 'index.html missing');
  });

  test(`${r.slug}: model.json passes UniversalGameSchema`, () => {
    const obj = JSON.parse(readFileSync(join(r.outDir, 'model.json'), 'utf8'));
    const v = validateModel(obj);
    if (!v.ok) throw new Error(`schema fail: ${v.errors.slice(0, 3).join(' | ')}`);
  });

  test(`${r.slug}: index.html has structural markers`, () => {
    const html = readFileSync(join(r.outDir, 'index.html'), 'utf8');
    assert(html.length > 5000, `HTML suspiciously short: ${html.length}`);
    assert(html.includes('<html'), 'missing <html');
    assert(html.includes('</html>'), 'missing </html>');
    assert(html.includes('<body'), 'missing <body');
  });

  test(`${r.slug}: re-run produces identical model.json hash (idempotent)`, () => {
    const obj1 = JSON.parse(readFileSync(join(r.outDir, 'model.json'), 'utf8'));
    /* Run ingest again to a new slug, hash both. Should be deterministic. */
    const slug2 = r.slug + '-rerun';
    const out2 = join(REPO, 'dist/ingest', slug2);
    const r2 = spawnSync('node', [INGEST,
      '--file', join(GDD_DIR, r.slug.includes('cash-eruption') ? 'Cash_Eruption_Foundry_GDD.pdf' : 'Gates_of_Olympus_1000_GDD.pdf'),
      '--slug', slug2,
      '--no-llm',
    ], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
    if (r2.status !== 0) {
      throw new Error(`re-run ingest exit ${r2.status}`);
    }
    const obj2 = JSON.parse(readFileSync(join(out2, 'model.json'), 'utf8'));
    /* Strip non-deterministic fields (generatedAt, ts) before hash. */
    const strip = (o) => JSON.stringify(o, (k, v) => {
      if (k === 'generatedAt' || k === 'timestamp' || k === '_ts' || k === '__meta__') return undefined;
      return v;
    });
    const h1 = sha256(strip(obj1));
    const h2 = sha256(strip(obj2));
    assert(h1 === h2, `non-deterministic: ${h1.slice(0,12)} ≠ ${h2.slice(0,12)}`);
    /* Cleanup rerun output. */
    try { rmSync(out2, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test(`${r.slug}: cleanup output dir`, () => {
    try { rmSync(r.outDir, { recursive: true, force: true }); } catch { /* ignore */ }
    assert(!existsSync(r.outDir), 'cleanup failed');
  });
}

/* ── Cleanup ─────────────────────────────────────────────────────────── */

try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
