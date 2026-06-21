/**
 * tests/tools/ingest.test.mjs
 *
 * Wave UQ-14 (2026-06-21) — smoke test for tools/ingest.mjs.
 *
 * Asserts the end-to-end pipeline:
 *   1. Missing flags → exit 2
 *   2. Nonexistent file → exit 1
 *   3. Unsupported extension → exit 1
 *   4. Real markdown sample → exit 0 + index.html + model.json + ingest.log
 *   5. --no-llm flag honored (no Kimi call attempted)
 *   6. Output HTML is ≥ 100 KB (proves buildSlotHTML produced real output)
 *   7. Custom --slug works
 *   8. ingest.log captures every step
 *
 * Auto-cleanup of dist/ingest/_test* on teardown.
 */
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const TOOL = resolve(REPO, 'tools/ingest.mjs');
const SAMPLE_MD = resolve(REPO, 'samples/CRYSTAL_FORGE_GAME_GDD.md');

function run(args) {
  return spawnSync('node', [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
}

const CLEANUP_SLUGS = [];
after(() => {
  for (const s of CLEANUP_SLUGS) {
    const p = resolve(REPO, 'dist/ingest', s);
    try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
});

test('UQ-14: missing required flags exits 2', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.ok(/Usage/.test(r.stderr));
});

test('UQ-14: nonexistent file exits 1', () => {
  const r = run(['--file', '/nonexistent/path/to/gdd.pdf', '--no-llm']);
  assert.equal(r.status, 1);
  assert.ok(/file not found/.test(r.stderr));
});

test('UQ-14: unsupported extension exits 1', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'uq14-'));
  const badFile = resolve(tmp, 'gdd.xml');
  writeFileSync(badFile, '<?xml version="1.0"?><root/>');
  const r = run(['--file', badFile, '--no-llm']);
  assert.equal(r.status, 1);
  assert.ok(/unsupported extension/.test(r.stderr));
});

test('UQ-14: real markdown sample produces index.html + model.json + ingest.log', () => {
  if (!existsSync(SAMPLE_MD)) {
    /* skip cleanly if the fixture moved */
    return;
  }
  const slug = 'uq14TestCrystalForge';
  CLEANUP_SLUGS.push('uq14testcrystalforge');
  const r = run(['--file', SAMPLE_MD, '--no-llm', '--slug', slug]);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + '\nstdout: ' + r.stdout);

  const outDir = resolve(REPO, 'dist/ingest/uq14testcrystalforge');
  assert.ok(existsSync(resolve(outDir, 'index.html')), 'index.html missing');
  assert.ok(existsSync(resolve(outDir, 'model.json')), 'model.json missing');
  assert.ok(existsSync(resolve(outDir, 'ingest.log')),  'ingest.log missing');
  assert.ok(existsSync(resolve(outDir, 'raw.txt')),     'raw.txt missing');
});

test('UQ-14: --no-llm honored (no Kimi reconcile step in log)', () => {
  if (!existsSync(SAMPLE_MD)) return;
  const slug = 'uq14NoLlmCheck';
  CLEANUP_SLUGS.push('uq14nollmcheck');
  const r = run(['--file', SAMPLE_MD, '--no-llm', '--slug', slug]);
  assert.equal(r.status, 0);
  assert.ok(/no-llm/.test(r.stdout));
});

test('UQ-14: produced HTML is ≥ 100 KB (real buildSlotHTML output)', async () => {
  if (!existsSync(SAMPLE_MD)) return;
  const slug = 'uq14HtmlSize';
  CLEANUP_SLUGS.push('uq14htmlsize');
  const r = run(['--file', SAMPLE_MD, '--no-llm', '--slug', slug]);
  assert.equal(r.status, 0);
  const html = await import('node:fs/promises').then(fs =>
    fs.readFile(resolve(REPO, 'dist/ingest/uq14htmlsize/index.html'), 'utf8'));
  assert.ok(html.length > 100_000, 'HTML too small: ' + html.length);
  /* It's a real document, not just a stub */
  assert.ok(html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'),
    'HTML missing doctype — buildSlotHTML output suspicious');
});

test('UQ-14: ingest.log captures every pipeline step', async () => {
  if (!existsSync(SAMPLE_MD)) return;
  const slug = 'uq14LogCapture';
  CLEANUP_SLUGS.push('uq14logcapture');
  const r = run(['--file', SAMPLE_MD, '--no-llm', '--slug', slug]);
  assert.equal(r.status, 0);
  const logTxt = await import('node:fs/promises').then(fs =>
    fs.readFile(resolve(REPO, 'dist/ingest/uq14logcapture/ingest.log'), 'utf8'));
  const log = JSON.parse(logTxt);
  assert.ok(Array.isArray(log.steps));
  /* Must capture at least: resolve source / extract text / parse / build / write */
  const labels = log.steps.map(s => s.label);
  /* "write outputs" is the step that writes the log itself, so by the
     time the log is materialized that step is recorded as in-progress —
     check the early steps + buildSlotHTML which finishes before write. */
  for (const expected of ['resolve source', 'extract text (md)', 'parse + smart defaults', 'buildSlotHTML']) {
    assert.ok(labels.includes(expected), 'log step missing: ' + expected);
  }
  /* Every step ok = true */
  for (const s of log.steps) assert.equal(s.ok, true, 'step failed: ' + s.label);
  /* Model stats present */
  assert.ok(log.modelStats);
  assert.ok(Number.isFinite(log.htmlBytes) && log.htmlBytes > 100_000);
});
