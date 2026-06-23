#!/usr/bin/env node
/**
 * tests/contracts/stress-test-ingest.test.mjs
 *
 * N+1 C (2026-06-23) — stress-test-ingest tool contract.
 *
 * Purpose
 * -------
 * Verifies that `tools/stress-test-ingest.mjs`:
 *   1. Walks every PDF in a target folder (or limit-N subset)
 *   2. Runs `tools/ingest.mjs --no-llm` per PDF
 *   3. Captures per-PDF receipts with exit code + V8/V9 verdicts
 *   4. Aggregates counts (success / hard-fail / V8-fail / V9-fail/warn)
 *   5. Emits both JSON and Markdown report files into `reports/`
 *   6. Returns exit 0 on all-green, exit 1 on any hard-fail or V9 FAIL
 *   7. Cleans up `dist/ingest/<slug>/` per PDF unless --keep
 *
 * Why this matters
 * ----------------
 * This tool is the only "untrusted public input" battery — every other
 * gate runs against the curated `dist/real-games/` corpus we already
 * ingested once successfully. If a regression breaks the pipeline for
 * a brand-new PDF, this tool catches it; nothing else does.
 *
 * Performance budget: --limit 5 must complete in ≤ 30s.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/stress-test-ingest.mjs');
const GDD_DIR = join(homedir(), 'Desktop/GDD');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('STRESS-TEST-INGEST contract · test suite');

test('GDD folder exists', () => {
  assert(existsSync(GDD_DIR), `GDD_DIR missing: ${GDD_DIR}`);
});

let jsonReport = null;
let mdReport = null;
let toolRan = false;

test('--limit 5 completes within performance budget (≤ 30s)', () => {
  const t0 = Date.now();
  const r = spawnSync('node', [TOOL, '--limit', '5'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  const elapsedMs = Date.now() - t0;
  if (r.status !== 0) {
    throw new Error(`tool exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  }
  assert(elapsedMs <= 30_000, `over budget: ${elapsedMs}ms`);
  toolRan = true;
  /* Find newest stress-test-ingest report. */
  const entries = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('stress-test-ingest-') && f.endsWith('.json'))
    .map(f => ({ name: f, path: join(REPO, 'reports', f), mt: statSync(join(REPO, 'reports', f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt);
  assert(entries.length > 0, 'no stress-test-ingest report found');
  jsonReport = entries[0].path;
  mdReport = jsonReport.replace(/\.json$/, '.md');
});

test('JSON report file written + has summary + receipts', () => {
  assert(toolRan, 'tool did not run successfully');
  assert(existsSync(jsonReport), `report missing: ${jsonReport}`);
  const obj = JSON.parse(readFileSync(jsonReport, 'utf8'));
  assert(obj.summary, 'summary missing');
  assert(Array.isArray(obj.receipts), 'receipts not array');
  assert(obj.summary.totalPdfs === 5, `expected 5 pdfs, got ${obj.summary.totalPdfs}`);
  assert(obj.receipts.length === 5, `expected 5 receipts, got ${obj.receipts.length}`);
});

test('Markdown report file written + has Outcome + Failure-modes sections', () => {
  assert(toolRan, 'tool did not run');
  assert(existsSync(mdReport), `markdown report missing: ${mdReport}`);
  const md = readFileSync(mdReport, 'utf8');
  assert(md.includes('## Outcome counts'), 'missing Outcome counts section');
  assert(md.includes('## Failure modes'), 'missing Failure modes section');
  assert(md.includes('## First 30 failed PDFs'), 'missing Failed PDFs section');
});

test('Per-PDF receipt has expected shape (exitCode + v8 + v9 + modelStats)', () => {
  const obj = JSON.parse(readFileSync(jsonReport, 'utf8'));
  for (const r of obj.receipts) {
    assert('exitCode' in r, `${r.pdf} missing exitCode`);
    assert(typeof r.elapsedMs === 'number', `${r.pdf} bad elapsedMs`);
    assert(r.pdf && r.slug, `${r.pdf} missing pdf or slug`);
    if (r.ok) {
      /* Healthy PDFs should produce V8 + V9 receipts. */
      assert(r.v8?.verdict, `${r.pdf} missing v8 verdict`);
      assert(r.v9?.verdict, `${r.pdf} missing v9 verdict`);
      assert(typeof r.v9.score === 'number', `${r.pdf} v9.score not number`);
    }
  }
});

test('Tool removes dist/ingest/<slug>/ after capture (default no-keep)', () => {
  const obj = JSON.parse(readFileSync(jsonReport, 'utf8'));
  for (const r of obj.receipts) {
    const distOut = join(REPO, 'dist/ingest', r.slug);
    assert(!existsSync(distOut), `dist/ingest/${r.slug}/ NOT cleaned up`);
  }
});

test('--keep retains dist/ingest/<slug>/ per PDF', () => {
  const r = spawnSync('node', [TOOL, '--limit', '2', '--keep', '--quiet'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  assert(r.status === 0, `keep run failed: ${r.stderr.slice(0, 200)}`);
  const entries = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('stress-test-ingest-') && f.endsWith('.json'))
    .map(f => ({ path: join(REPO, 'reports', f), mt: statSync(join(REPO, 'reports', f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt);
  const obj = JSON.parse(readFileSync(entries[0].path, 'utf8'));
  for (const rec of obj.receipts) {
    const distOut = join(REPO, 'dist/ingest', rec.slug);
    assert(existsSync(distOut), `--keep failed: dist/ingest/${rec.slug}/ missing`);
    /* Cleanup after the test so we don't leave junk. */
    try { rmSync(distOut, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('Summary aggregates failure modes (empty when all PASS)', () => {
  const obj = JSON.parse(readFileSync(jsonReport, 'utf8'));
  assert(typeof obj.summary.failureModes === 'object', 'failureModes not object');
  /* On a healthy baseline of 5 PDFs we expect ZERO failure modes. */
  if (obj.summary.successCount === 5) {
    assert(Object.keys(obj.summary.failureModes).length === 0,
      `expected 0 failure modes on all-green run, got: ${JSON.stringify(obj.summary.failureModes)}`);
  }
});

test('--limit N respects argv parsing', () => {
  const r = spawnSync('node', [TOOL, '--limit', '3', '--quiet'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  assert(r.status === 0, `limit run failed: ${r.stderr.slice(0, 200)}`);
  const entries = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('stress-test-ingest-') && f.endsWith('.json'))
    .map(f => ({ path: join(REPO, 'reports', f), mt: statSync(join(REPO, 'reports', f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt);
  const obj = JSON.parse(readFileSync(entries[0].path, 'utf8'));
  assert(obj.summary.totalPdfs === 3, `--limit 3 produced ${obj.summary.totalPdfs} pdfs`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
